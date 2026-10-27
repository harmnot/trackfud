package app

import (
	"testing"

	"Trackfud/internal/ai"
	"Trackfud/internal/config"
)

// Webhook-style double delivery of an AI job must run side effects once:
// the second claim of a finished job is a no-op, while crash retries still
// proceed (their domain writes are convergent upserts).
func TestAIClaimDoubleDelivery(t *testing.T) {
	cases := []struct {
		name     string
		status   string
		attempts int
		wantRun  bool
	}{
		{"fresh insert runs", "pending", 0, true},
		{"finished duplicate skips", "done", 1, false},
		{"finished triple delivery skips", "done", 2, false},
		{"crash retry runs", "pending", 1, true},
		{"failed retry runs", "failed", 3, true},
	}
	for _, tc := range cases {
		if got := aiClaimRunnable(tc.status, tc.attempts); got != tc.wantRun {
			t.Fatalf("%s: runnable=%v want %v", tc.name, got, tc.wantRun)
		}
	}
}

// All five B6 job kinds are registered with distinct keys.
func TestAIJobKindsDistinct(t *testing.T) {
	kinds := []string{AIJobMenuImport, AIJobTranslate, AIJobTrustBrief, AIJobProofCheck, AIJobFeedbackLabels}
	seen := map[string]bool{}
	for _, k := range kinds {
		if k == "" || seen[k] {
			t.Fatalf("bad job kind %q", k)
		}
		seen[k] = true
	}
}

// The server builds its AI client from env-backed config with no key by
// default (fallback mode), and the key never comes from the request path.
func TestAIConfigDefaultsToFallback(t *testing.T) {
	t.Setenv("TB_META_API_KEY", "")
	t.Setenv("TB_CONFIG", "/tmp/tb-no-such-config.yaml")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	ac := aiConfigOf(cfg)
	if ac.APIKey != "" {
		t.Fatalf("default key must be empty (fallback mode)")
	}
	if ac.BaseURL == "" || ac.SparkModel == "" || ac.TranscribeModel == "" {
		t.Fatalf("model defaults missing: %+v", ac)
	}
	c := ai.New(ac)
	if c.HasKey() {
		t.Fatalf("client must report no key")
	}
}
