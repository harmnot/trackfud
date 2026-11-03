package app

import (
	"testing"

	"Trackfud/internal/ai"
	"Trackfud/internal/config"
)

// The Modal proxy-token pair must flow from server config into the AI
// client, and a pair-only setup must report live (chat via Modal,
// transcription cleanly falling back without a Meta key).
func TestAIConfigMapsModalPair(t *testing.T) {
	cfg := &config.Config{}
	cfg.AI.MetaBaseURL = ai.DefaultModalBaseURL
	cfg.AI.SparkModel = "muse-spark-open"
	cfg.AI.ModalKey = "wk-test"
	cfg.AI.ModalSecret = "ws-test"

	ac := aiConfigOf(cfg)
	if ac.ModalKey != "wk-test" || ac.ModalSecret != "ws-test" {
		t.Fatalf("Modal pair lost in mapping: %+v", ac)
	}
	c := ai.New(ac)
	if !c.HasKey() || !c.UsesModal() {
		t.Fatal("pair-only client must be live via Modal")
	}
	if c.BaseURL() != ai.DefaultModalBaseURL {
		t.Fatalf("wrong endpoint: %q", c.BaseURL())
	}
	// The served Modal model id wins over the stale config value, so live
	// calls carry a model the endpoint actually serves.
	if c.SparkModel() != ai.ModelModal {
		t.Fatalf("Modal spark model must be the served id, got %q", c.SparkModel())
	}

	svc := newAIService(ac)
	if svc.cli == nil || svc.transcriber == nil || svc.cropper == nil {
		t.Fatal("AI service must build with Modal-only credentials")
	}
	if _, ok := svc.transcriber.(ai.LocalTranscriber); !ok {
		t.Fatalf("Modal-only setup must use the local transcriber fallback, got %T", svc.transcriber)
	}
}
