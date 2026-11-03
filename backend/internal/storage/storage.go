// Package storage abstracts file bytes behind the R2-shaped contract.
//
// Live: Cloudflare R2 (S3-compatible). Presign returns R2 presigned PUT/GET
// URLs with 5-min expiry. Public bucket holds menus/avatars; private bucket
// holds IDs/selfie/proof/agreements and is only served via presigned GET.
//
// Dev/tests: when R2 is not configured (no TF_R2_ENDPOINT), the local disk
// fallback in TF_UPLOAD_DIR is used with the same file-row contract.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"Trackfud/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	awscreds "github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// PresignTTL is the 5-minute expiry for upload and private-download URLs.
const PresignTTL = 5 * time.Minute

// MaxObjectBytes caps server-side object reads. It equals the 5 MiB presign
// upload cap, so no file accepted through the upload contract exceeds it.
const MaxObjectBytes int64 = 5 << 20

// remoteKeyPrefix marks storage keys that live in R2 ("s3://bucket/key");
// any other non-empty key is a path under the local upload dir.
const remoteKeyPrefix = "s3://"

// Read errors (low-cardinality; callers fall back, never surface the key).
var (
	// ErrObjectTooLarge means the stored object exceeds MaxObjectBytes.
	ErrObjectTooLarge = errors.New("storage: object exceeds the read cap")
	// ErrRemoteUnavailable means an s3:// key was read without live R2.
	ErrRemoteUnavailable = errors.New("storage: R2 object but R2 is not configured")
	// ErrOutsideUploadDir means a local key does not resolve inside the
	// configured upload dir (defense in depth against path traversal).
	ErrOutsideUploadDir = errors.New("storage: local key outside the upload dir")
	// ErrBadKey means the storage key is empty or malformed.
	ErrBadKey = errors.New("storage: malformed storage key")
)

// Store serves presigned upload/download URLs and server-side reads.
type Store interface {
	// Configured reports whether live R2 is in use (vs local fallback).
	Configured() bool
	// BucketFor maps the API bucket contract ("private" vs anything else)
	// to the live bucket name.
	BucketFor(bucket string) string
	// PresignPUT returns an upload URL + storage key for one file.
	PresignPUT(ctx context.Context, bucket, fileID, contentType string) (uploadURL, storageKey string, err error)
	// PresignGET returns a 5-min download URL for a private file.
	PresignGET(ctx context.Context, bucket, storageKey string) (string, error)
	// PublicURL returns the stable public URL for a public file ("" when the
	// public base is not configured — callers then serve via the API).
	PublicURL(bucket, storageKey string) string
	// Read returns a stored file's bytes for server-side use (AI vision
	// inputs): "s3://bucket/key" objects come from R2, other keys from the
	// local upload dir. Reads are capped at MaxObjectBytes (bigger objects
	// fail with ErrObjectTooLarge); bytes never leave the server here.
	Read(ctx context.Context, storageKey string) ([]byte, error)
}

// objectGetter is the slice of the S3 API that Read needs; *s3.Client
// satisfies it and tests swap in a fake (no network).
type objectGetter interface {
	GetObject(ctx context.Context, in *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error)
}

// R2Store presigns via the S3 API against the R2 endpoint.
type R2Store struct {
	cfg     *config.Config
	client  *s3.Client
	objects objectGetter
	pres    *s3.PresignClient
}

// New builds a Store: live R2 when TF_R2_* is complete, else local fallback.
// It never dials the network — R2 failures surface at presign time.
func New(cfg *config.Config) Store {
	if !cfg.R2Configured() {
		return &localStore{cfg: cfg}
	}
	creds := awscreds.NewStaticCredentialsProvider(cfg.R2AccessKey, cfg.R2SecretKey, "")
	s3cfg := aws.Config{
		Region:       "auto",
		Credentials:  creds,
		BaseEndpoint: aws.String(cfg.R2Endpoint),
	}
	cli := s3.NewFromConfig(s3cfg, func(o *s3.Options) { o.UsePathStyle = true })
	return &R2Store{cfg: cfg, client: cli, objects: cli, pres: s3.NewPresignClient(cli)}
}

func (s *R2Store) Configured() bool { return true }

func (s *R2Store) BucketFor(bucket string) string { return s.cfg.R2BucketFor(bucket) }

// keyFor namespaces every object by owner-scoped file id: files/<bucket>/<id>.
func keyFor(bucket, fileID string) string {
	b := strings.ToLower(strings.TrimSpace(bucket))
	if b != "private" {
		b = "public"
	}
	return "files/" + b + "/" + fileID
}

func (s *R2Store) PresignPUT(ctx context.Context, bucket, fileID, contentType string) (string, string, error) {
	name := s.BucketFor(bucket)
	key := keyFor(bucket, fileID)
	req, err := s.pres.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(name),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, s3.WithPresignExpires(PresignTTL))
	if err != nil {
		return "", "", fmt.Errorf("storage: presign put: %w", err)
	}
	return req.URL, "s3://" + name + "/" + key, nil
}

func (s *R2Store) PresignGET(ctx context.Context, bucket, storageKey string) (string, error) {
	name, key := splitKey(storageKey, s.BucketFor(bucket))
	req, err := s.pres.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(name),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(PresignTTL))
	if err != nil {
		return "", fmt.Errorf("storage: presign get: %w", err)
	}
	return req.URL, nil
}

func (s *R2Store) PublicURL(bucket, storageKey string) string {
	if bucket == "private" || s.cfg.R2PublicBaseURL == "" {
		return ""
	}
	// One endpoint for everything: when the public base IS the raw R2 API
	// endpoint (same host), no bucket is implicit in the host, so a plain
	// base+key URL would 404. Return "" so callers fall back to presigned
	// GETs, which carry the bucket explicitly and work on the raw endpoint.
	if sameHost(s.cfg.R2PublicBaseURL, s.cfg.R2Endpoint) {
		return ""
	}
	_, key := splitKey(storageKey, s.BucketFor(bucket))
	return strings.TrimRight(s.cfg.R2PublicBaseURL, "/") + "/" + strings.TrimLeft(key, "/")
}

// Read implements Store: R2 objects through the S3 client, and local keys
// (rows written before R2 was configured) from the upload dir.
func (s *R2Store) Read(ctx context.Context, storageKey string) ([]byte, error) {
	if !isRemoteKey(storageKey) {
		return readLocal(s.cfg.UploadDir, storageKey, MaxObjectBytes)
	}
	bucket, key := splitKey(storageKey, "")
	if bucket == "" || key == "" {
		return nil, ErrBadKey
	}
	return readObject(ctx, s.objects, bucket, key, MaxObjectBytes)
}

// sameHost reports whether two URLs share a hostname. Unparseable input
// never matches, so callers keep their previous behavior on bad config.
func sameHost(a, b string) bool {
	ua, err := url.Parse(strings.TrimSpace(a))
	if err != nil || ua.Hostname() == "" {
		return false
	}
	ub, err := url.Parse(strings.TrimSpace(b))
	if err != nil || ub.Hostname() == "" {
		return false
	}
	return strings.EqualFold(ua.Hostname(), ub.Hostname())
}

func splitKey(storageKey, fallbackBucket string) (bucket, key string) {
	if strings.HasPrefix(storageKey, "s3://") {
		rest := strings.TrimPrefix(storageKey, "s3://")
		if i := strings.Index(rest, "/"); i > 0 {
			return rest[:i], rest[i+1:]
		}
		return fallbackBucket, rest
	}
	return fallbackBucket, strings.TrimLeft(storageKey, "/")
}

// localStore keeps the dev/test disk fallback behind the same interface.
type localStore struct {
	cfg *config.Config
}

func (s *localStore) Configured() bool { return false }

func (s *localStore) BucketFor(bucket string) string {
	if bucket == "private" {
		return "private"
	}
	return "public"
}

func (s *localStore) PresignPUT(_ context.Context, _, _, _ string) (string, string, error) {
	return "", "", fmt.Errorf("storage: R2 not configured (local fallback serves /v1/files/local)")
}

func (s *localStore) PresignGET(_ context.Context, _, _ string) (string, error) {
	return "", fmt.Errorf("storage: R2 not configured")
}

func (s *localStore) PublicURL(_, _ string) string { return "" }

// Read implements Store for the disk fallback. An s3:// key here means the
// row was uploaded while R2 was configured; without R2 it cannot be read.
func (s *localStore) Read(_ context.Context, storageKey string) ([]byte, error) {
	if isRemoteKey(storageKey) {
		return nil, ErrRemoteUnavailable
	}
	return readLocal(s.cfg.UploadDir, storageKey, MaxObjectBytes)
}

// isRemoteKey reports whether a storage key names an R2 object.
func isRemoteKey(storageKey string) bool {
	return strings.HasPrefix(storageKey, remoteKeyPrefix)
}

// readObject fetches one R2 object, refusing anything above max before and
// while reading (Content-Length can be absent, so the body is capped too).
func readObject(ctx context.Context, get objectGetter, bucket, key string, max int64) ([]byte, error) {
	out, err := get.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		return nil, fmt.Errorf("storage: get object: %w", err)
	}
	defer out.Body.Close()
	if out.ContentLength != nil && *out.ContentLength > max {
		return nil, ErrObjectTooLarge
	}
	return readCapped(out.Body, max)
}

// readLocal reads one upload from disk. The path must resolve inside the
// upload dir: storage paths are server-written, so anything else is a bug
// or tampering and is refused instead of read.
func readLocal(uploadDir, path string, max int64) ([]byte, error) {
	if strings.TrimSpace(path) == "" {
		return nil, ErrBadKey
	}
	if !withinDir(uploadDir, path) {
		return nil, ErrOutsideUploadDir
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("storage: open local file: %w", err)
	}
	defer f.Close()
	if st, err := f.Stat(); err == nil && st.Size() > max {
		return nil, ErrObjectTooLarge
	}
	return readCapped(f, max)
}

// readCapped reads at most max bytes; one byte more means the object is
// over the cap.
func readCapped(r io.Reader, max int64) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, fmt.Errorf("storage: read: %w", err)
	}
	if int64(len(b)) > max {
		return nil, ErrObjectTooLarge
	}
	return b, nil
}

// withinDir reports whether path resolves strictly inside dir.
func withinDir(dir, path string) bool {
	if strings.TrimSpace(dir) == "" {
		return false
	}
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return false
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absDir, absPath)
	if err != nil || rel == "." || filepath.IsAbs(rel) {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
