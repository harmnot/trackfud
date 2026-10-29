package config

import (
	"os"
	"path/filepath"
	"testing"
)

// TestLoad_UploadDir verifies TF_UPLOAD_DIR handling for local dev vs container.
// Default is relative "data/uploads" for `go run`. Env overrides win, and
// container absolute "/data/uploads" must be respected when set explicitly.
func TestLoad_UploadDir(t *testing.T) {
	dir := t.TempDir()
	// Isolate from repo config.yaml which sets demo_mode:false
	t.Setenv("TF_CONFIG", filepath.Join(dir, "nope.yaml"))

	t.Setenv("TF_UPLOAD_DIR", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.UploadDir != "data/uploads" {
		t.Fatalf("default UploadDir = %q, want data/uploads", c.UploadDir)
	}

	t.Setenv("TF_UPLOAD_DIR", "data/uploads")
	c, _ = Load()
	if c.UploadDir != "data/uploads" {
		t.Fatalf("relative UploadDir = %q, want data/uploads", c.UploadDir)
	}

	t.Setenv("TF_UPLOAD_DIR", "/data/uploads")
	c, _ = Load()
	if c.UploadDir != "/data/uploads" {
		t.Fatalf("absolute UploadDir = %q, want /data/uploads", c.UploadDir)
	}
	// Ensure absolute value is not mangled by MkdirAll caller — Load must keep it verbatim.
	if !filepath.IsAbs(c.UploadDir) {
		t.Fatalf("UploadDir should be absolute when set to /data/uploads, got %q", c.UploadDir)
	}

	// Cleanup
	_ = os.Unsetenv("TF_UPLOAD_DIR")

	// Verify that an empty env falls back to default even when config.yaml absent.
	t.Setenv("TF_UPLOAD_DIR", "")
	c, _ = Load()
	if c.UploadDir == "" {
		t.Fatalf("UploadDir should not be empty after fallback")
	}
}

// TestLoad_DemoMode ensures realistic (non-demo) runs still load correctly.
// PLAN says TF_DEMO_MODE=false should give a usable DB via SeedTestAccounts,
// not an empty DB. Config must respect TF_DEMO_MODE env over config.yaml.
func TestLoad_DemoMode(t *testing.T) {
	dir := t.TempDir()
	// Write a config.yaml that explicitly sets demo_mode:false (as repo does)
	p := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(p, []byte("server:\n  demo_mode: false\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TF_CONFIG", p)

	t.Setenv("TF_DEMO_MODE", "false")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.Server.DemoMode != false {
		t.Fatalf("DemoMode = %v, want false (from env false)", c.Server.DemoMode)
	}

	t.Setenv("TF_DEMO_MODE", "true")
	c, _ = Load()
	if c.Server.DemoMode != true {
		t.Fatalf("DemoMode = %v, want true (from env true)", c.Server.DemoMode)
	}

	// Empty env should leave config.yaml value (false) in place.
	t.Setenv("TF_DEMO_MODE", "")
	c, _ = Load()
	if c.Server.DemoMode != false {
		t.Fatalf("DemoMode = %v, want false (from config.yaml when env empty)", c.Server.DemoMode)
	}
}
