package storage

import (
	"strings"
	"testing"

	"Trackfud/internal/config"
)

func testConfig() *config.Config {
	c := &config.Config{}
	c.R2Endpoint = "http://localhost:9000"
	c.R2AccessKey = "test-key"
	c.R2SecretKey = "test-secret"
	c.R2PublicBucket = "tf-public"
	c.R2PrivateBucket = "tf-private"
	c.R2PublicBaseURL = "https://cdn.example.com"
	return c
}

// Without TF_R2_* the server keeps the local-disk fallback (dev/tests).
func TestLocalFallback(t *testing.T) {
	s := New(&config.Config{})
	if s.Configured() {
		t.Fatal("empty config must not be Configured")
	}
	if got := s.BucketFor("private"); got != "private" {
		t.Fatalf("BucketFor private = %q", got)
	}
	if got := s.BucketFor("public"); got != "public" {
		t.Fatalf("BucketFor public = %q", got)
	}
	if _, _, err := s.PresignPUT(t.Context(), "public", "id", "image/png"); err == nil {
		t.Fatal("local fallback PresignPUT must error")
	}
	if s.PublicURL("public", "x") != "" {
		t.Fatal("local fallback PublicURL must be empty")
	}
}

// Live presigning is pure request-signing (no network): assert the 5-min
// expiry, the right bucket, and the public/private contract.
func TestR2PresignShapes(t *testing.T) {
	cfg := testConfig()
	if !cfg.R2Configured() {
		t.Fatal("fixture must be R2Configured")
	}
	s := New(cfg)
	if !s.Configured() {
		t.Fatal("must be Configured")
	}
	if got := s.BucketFor("private"); got != "tf-private" {
		t.Fatalf("private bucket = %q", got)
	}
	if got := s.BucketFor("public"); got != "tf-public" {
		t.Fatalf("public bucket = %q", got)
	}
	if got := s.BucketFor("menus"); got != "tf-public" {
		t.Fatalf("unknown bucket must map to public, got %q", got)
	}

	putURL, key, err := s.PresignPUT(t.Context(), "private", "file-1", "image/jpeg")
	if err != nil {
		t.Fatalf("PresignPUT: %v", err)
	}
	if !strings.HasPrefix(key, "s3://tf-private/files/private/file-1") {
		t.Fatalf("storage key = %q", key)
	}
	if !strings.Contains(putURL, "tf-private") || !strings.Contains(putURL, "X-Amz-Expires=300") {
		t.Fatalf("PUT url missing bucket/expiry: %s", putURL)
	}

	getURL, err := s.PresignGET(t.Context(), "private", key)
	if err != nil {
		t.Fatalf("PresignGET: %v", err)
	}
	if !strings.Contains(getURL, "X-Amz-Expires=300") {
		t.Fatalf("GET url missing 5-min expiry: %s", getURL)
	}

	// Public files serve from the CDN base; private files never do.
	if got := s.PublicURL("public", "s3://tf-public/files/public/m1"); got != "https://cdn.example.com/files/public/m1" {
		t.Fatalf("public url = %q", got)
	}
	if got := s.PublicURL("private", key); got != "" {
		t.Fatalf("private PublicURL must be empty, got %q", got)
	}
}

func TestKeyNamespacing(t *testing.T) {
	if got := keyFor("private", "abc"); got != "files/private/abc" {
		t.Fatalf("keyFor = %q", got)
	}
	if got := keyFor("PUBLIC", "abc"); got != "files/public/abc" {
		t.Fatalf("keyFor normalizes to public: %q", got)
	}
	b, k := splitKey("s3://tf-private/files/private/abc", "tf-private")
	if b != "tf-private" || k != "files/private/abc" {
		t.Fatalf("splitKey = %q %q", b, k)
	}
}

// Single-endpoint setup: when the public base IS the raw R2 API endpoint,
// PublicURL stays empty so the API falls back to presigned GETs (which
// carry the bucket explicitly). A genuinely different base (CDN / custom
// domain / r2.dev) keeps the plain public URL.
func TestPublicURLSameEndpointFallsBack(t *testing.T) {
	cfg := testConfig()
	cfg.R2Endpoint = "https://abc.r2.cloudflarestorage.com"
	cfg.R2PublicBaseURL = "https://abc.r2.cloudflarestorage.com"
	s := New(cfg)
	if got := s.PublicURL("public", "s3://tf-public/files/public/m1"); got != "" {
		t.Fatalf("same-endpoint base must fall back, got %q", got)
	}
	cfg.R2PublicBaseURL = "https://pub-0123456789abcdef.r2.dev"
	s = New(cfg)
	if got := s.PublicURL("public", "s3://tf-public/files/public/m1"); got != "https://pub-0123456789abcdef.r2.dev/files/public/m1" {
		t.Fatalf("r2.dev base = %q", got)
	}
	if sameHost("https://cdn.example.com/", "https://cdn.example.com") != true {
		t.Fatal("identical hosts must match")
	}
	if sameHost("https://abc.r2.cloudflarestorage.com", "https://xyz.r2.cloudflarestorage.com") {
		t.Fatal("different account hosts must not match")
	}
	if sameHost("::::", "https://x.example") {
		t.Fatal("garbage must never match")
	}
}
