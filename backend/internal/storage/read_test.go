package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"Trackfud/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// fakeObjects records GetObject calls instead of dialing R2.
type fakeObjects struct {
	body       []byte
	length     *int64
	err        error
	gotBucket  string
	gotKey     string
	calls      int
	bodyClosed bool
}

type trackedBody struct {
	io.Reader
	f *fakeObjects
}

func (b trackedBody) Close() error { b.f.bodyClosed = true; return nil }

func (f *fakeObjects) GetObject(_ context.Context, in *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	f.calls++
	f.gotBucket, f.gotKey = aws.ToString(in.Bucket), aws.ToString(in.Key)
	if f.err != nil {
		return nil, f.err
	}
	return &s3.GetObjectOutput{Body: trackedBody{Reader: bytes.NewReader(f.body), f: f}, ContentLength: f.length}, nil
}

// writeUpload stores bytes the way localUpload does: <dir>/<owner>/<id>.
func writeUpload(t *testing.T, dir string, b []byte) string {
	t.Helper()
	owner := filepath.Join(dir, "5d3f1c9e-owner")
	if err := os.MkdirAll(owner, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(owner, "9b1e7a52-file")
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// A JPEG-ish menu photo prefix: realistic enough for byte round-trips.
var menuPhoto = append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, []byte("JFIF menu photo Sate Senayan GBK")...)

// Without R2 the local disk path still serves vision inputs, and an s3://
// key fails cleanly instead of reading a bogus path.
func TestLocalStoreRead(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{UploadDir: dir}
	s := New(cfg)
	path := writeUpload(t, dir, menuPhoto)

	got, err := s.Read(t.Context(), path)
	if err != nil || !bytes.Equal(got, menuPhoto) {
		t.Fatalf("local read = %q, %v", got, err)
	}
	if _, err := s.Read(t.Context(), "s3://tf-public/files/public/abc"); !errors.Is(err, ErrRemoteUnavailable) {
		t.Fatalf("s3 key without R2 must be ErrRemoteUnavailable, got %v", err)
	}
	if _, err := s.Read(t.Context(), filepath.Join(dir, "5d3f1c9e-owner", "missing")); err == nil {
		t.Fatal("missing local file must error")
	}
	if _, err := s.Read(t.Context(), ""); !errors.Is(err, ErrBadKey) {
		t.Fatalf("empty key must be ErrBadKey, got %v", err)
	}
}

// Local keys must resolve inside the upload dir (no traversal).
func TestLocalReadStaysInUploadDir(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("not an upload"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(&config.Config{UploadDir: dir})
	for _, key := range []string{outside, filepath.Join(dir, "..", filepath.Base(outside)), dir} {
		if _, err := s.Read(t.Context(), key); !errors.Is(err, ErrOutsideUploadDir) {
			t.Fatalf("key %q must be refused, got %v", key, err)
		}
	}
	if _, err := New(&config.Config{}).Read(t.Context(), outside); !errors.Is(err, ErrOutsideUploadDir) {
		t.Fatalf("empty upload dir must refuse local reads, got %v", err)
	}
}

// The cap equals the 5 MiB presign upload cap and is enforced on disk.
func TestReadCap(t *testing.T) {
	if MaxObjectBytes != 5*1024*1024 {
		t.Fatalf("read cap must match the 5 MiB upload cap, got %d", MaxObjectBytes)
	}
	dir := t.TempDir()
	path := writeUpload(t, dir, []byte("12345"))
	if _, err := readLocal(dir, path, 4); !errors.Is(err, ErrObjectTooLarge) {
		t.Fatalf("5 bytes over a 4-byte cap must be ErrObjectTooLarge, got %v", err)
	}
	if b, err := readLocal(dir, path, 5); err != nil || string(b) != "12345" {
		t.Fatalf("exactly-at-cap read must pass, got %q %v", b, err)
	}
	if _, err := readCapped(bytes.NewReader(make([]byte, 6)), 5); !errors.Is(err, ErrObjectTooLarge) {
		t.Fatalf("stream over cap must fail, got %v", err)
	}
}

// With R2 configured, s3:// keys go to GetObject (bucket/key split from the
// key) and local keys still read from disk — no network in either case.
func TestR2ReadDispatch(t *testing.T) {
	dir := t.TempDir()
	cfg := testConfig()
	cfg.UploadDir = dir
	r2, ok := New(cfg).(*R2Store)
	if !ok {
		t.Fatal("configured store must be *R2Store")
	}
	fake := &fakeObjects{body: menuPhoto}
	r2.objects = fake

	got, err := r2.Read(t.Context(), "s3://tf-private/files/private/proof-1")
	if err != nil || !bytes.Equal(got, menuPhoto) {
		t.Fatalf("r2 read = %q, %v", got, err)
	}
	if fake.gotBucket != "tf-private" || fake.gotKey != "files/private/proof-1" {
		t.Fatalf("GetObject got bucket=%q key=%q", fake.gotBucket, fake.gotKey)
	}
	if !fake.bodyClosed {
		t.Fatal("object body must be closed")
	}

	local := writeUpload(t, dir, []byte("legacy local upload"))
	if b, err := r2.Read(t.Context(), local); err != nil || string(b) != "legacy local upload" {
		t.Fatalf("local key under R2 must read disk, got %q %v", b, err)
	}
	if fake.calls != 1 {
		t.Fatalf("local key must not call GetObject, calls=%d", fake.calls)
	}

	for _, bad := range []string{"s3://", "s3://tf-public", "s3://tf-public/"} {
		if _, err := r2.Read(t.Context(), bad); !errors.Is(err, ErrBadKey) {
			t.Fatalf("malformed key %q must be ErrBadKey, got %v", bad, err)
		}
	}
}

// Oversized objects are refused from Content-Length (before reading) and
// from the capped body when the length header is absent.
func TestR2ReadCapAndErrors(t *testing.T) {
	big := MaxObjectBytes + 1
	r2 := New(testConfig()).(*R2Store)
	r2.objects = &fakeObjects{body: []byte("x"), length: &big}
	if _, err := r2.Read(t.Context(), "s3://tf-public/files/public/menu-1"); !errors.Is(err, ErrObjectTooLarge) {
		t.Fatalf("Content-Length over cap must fail, got %v", err)
	}
	if _, err := readObject(t.Context(), &fakeObjects{body: []byte("123456")}, "b", "k", 5); !errors.Is(err, ErrObjectTooLarge) {
		t.Fatalf("body over cap without length must fail, got %v", err)
	}
	upstream := errors.New("NoSuchKey")
	r2.objects = &fakeObjects{err: upstream}
	if _, err := r2.Read(t.Context(), "s3://tf-public/files/public/menu-2"); !errors.Is(err, upstream) {
		t.Fatalf("GetObject error must wrap upstream, got %v", err)
	}
}
