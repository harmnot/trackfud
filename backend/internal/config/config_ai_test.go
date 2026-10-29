package config

import (
	"os"
	"path/filepath"
	"testing"
)

// The ai: YAML block selects the provider; env always wins; Modal proxy
// credentials are env-only and must never come from the file.
func TestLoadAISectionAndModalEnv(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	body := "ai:\n  base_url: \"https://modal.example/v1\"\n  spark_model: \"muse-spark-open\"\n" +
		"  contributor_model: \"contrib-x\"\n  transcribe_model: \"trans-x\"\n  sam_model: \"sam-x\"\n"
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TF_CONFIG", p)
	t.Setenv("TF_META_BASE_URL", "")
	t.Setenv("TF_META_SPARK_MODEL", "")
	t.Setenv("TF_MODAL_KEY", "wk-test")
	t.Setenv("TF_MODAL_SECRET", "ws-test")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.AI.MetaBaseURL != "https://modal.example/v1" {
		t.Fatalf("ai base_url not parsed: %q", c.AI.MetaBaseURL)
	}
	if c.AI.SparkModel != "muse-spark-open" {
		t.Fatalf("ai spark_model not parsed: %q", c.AI.SparkModel)
	}
	if c.AI.ContributorModel != "contrib-x" || c.AI.TranscribeModel != "trans-x" || c.AI.SAMModel != "sam-x" {
		t.Fatalf("ai models not parsed: %+v", c.AI)
	}
	if c.AI.ModalKey != "wk-test" || c.AI.ModalSecret != "ws-test" {
		t.Fatalf("Modal pair not mapped: %+v", c.AI)
	}

	// Env overrides the file.
	t.Setenv("TF_META_BASE_URL", "https://api.meta.ai/v1")
	t.Setenv("TF_META_SPARK_MODEL", "muse-spark-1.3")
	d, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if d.AI.MetaBaseURL != "https://api.meta.ai/v1" || d.AI.SparkModel != "muse-spark-1.3" {
		t.Fatalf("env must win over ai block: %+v", d.AI)
	}

	// Missing file: Meta-direct fallback defaults, no Modal pair.
	t.Setenv("TF_CONFIG", filepath.Join(dir, "missing.yaml"))
	t.Setenv("TF_META_BASE_URL", "")
	t.Setenv("TF_META_SPARK_MODEL", "")
	t.Setenv("TF_MODAL_KEY", "")
	t.Setenv("TF_MODAL_SECRET", "")
	e, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if e.AI.MetaBaseURL != "https://api.meta.ai/v1" || e.AI.SparkModel != "muse-spark-1.3" {
		t.Fatalf("fallback defaults wrong: %+v", e.AI)
	}
}
