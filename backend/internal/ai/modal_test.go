package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Modal proxy auth is a header pair (Modal-Key / Modal-Secret), not Bearer.
// A half pair must NOT enable live calls.
func TestHasKeyModalPair(t *testing.T) {
	if New(Config{}).HasKey() {
		t.Fatal("empty config must report no key")
	}
	if New(Config{APIKey: "meta-key"}).HasKey() != true {
		t.Fatal("Meta key alone must enable live calls")
	}
	if New(Config{ModalKey: "wk-x", ModalSecret: "ws-y"}).HasKey() != true {
		t.Fatal("full Modal pair must enable live calls")
	}
	if New(Config{ModalKey: "wk-x"}).HasKey() {
		t.Fatal("half Modal pair (key only) must stay in fallback mode")
	}
	if New(Config{ModalSecret: "ws-y"}).HasKey() {
		t.Fatal("half Modal pair (secret only) must stay in fallback mode")
	}
}

func TestModalBaseURLDefault(t *testing.T) {
	got := Config{ModalKey: "wk-x", ModalSecret: "ws-y"}.withDefaults()
	if got.BaseURL != DefaultModalBaseURL {
		t.Fatalf("Modal pair must default to Modal endpoint, got %q", got.BaseURL)
	}
	got = Config{}.withDefaults()
	if got.BaseURL != DefaultBaseURL {
		t.Fatalf("no pair must default to Meta direct, got %q", got.BaseURL)
	}
	got = Config{ModalKey: "wk-x", ModalSecret: "ws-y", BaseURL: "https://custom.example/v1"}.withDefaults()
	if got.BaseURL != "https://custom.example/v1" {
		t.Fatalf("explicit BaseURL must win, got %q", got.BaseURL)
	}
}

// The client must send the Modal proxy-token pair on chat calls (httptest,
// no network). Unknown Modal model ids cost 0 instead of failing the log.
func TestModalHeadersSent(t *testing.T) {
	var sawKey, sawSecret, sawAuth string
	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawKey = r.Header.Get("Modal-Key")
		sawSecret = r.Header.Get("Modal-Secret")
		sawAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl-test","created":1,"model":"muse-spark-open",` +
			`"object":"chat.completion","choices":[{"finish_reason":"stop","index":0,` +
			`"message":{"content":"{\"summary\":\"ok\"}","role":"assistant"}}],` +
			`"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`))
	})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	c := New(Config{ModalKey: "wk-test", ModalSecret: "ws-test", BaseURL: ts.URL, SparkModel: "muse-spark-open"})
	var rec CallRecord
	out, err := c.ChatJSON(context.Background(), "modal_probe", "v1", "muse-spark-open",
		"sys", "user", "probe", map[string]any{"type": "object"}, func(_ context.Context, r CallRecord) { rec = r })
	if err != nil {
		t.Fatalf("modal chat call failed: %v", err)
	}
	if out != `{"summary":"ok"}` {
		t.Fatalf("unexpected content: %q", out)
	}
	if sawKey != "wk-test" || sawSecret != "ws-test" {
		t.Fatalf("Modal proxy pair missing: key=%q secret=%q", sawKey, sawSecret)
	}
	if sawAuth != "" {
		t.Fatalf("empty APIKey must not send Authorization, got %q", sawAuth)
	}
	if rec.Model != "muse-spark-open" || rec.ErrText != "" {
		t.Fatalf("call mis-logged: %+v", rec)
	}
	if rec.InputTokens != 10 || rec.OutputTokens != 5 {
		t.Fatalf("usage mis-logged: %+v", rec)
	}
	if rec.CostMicros != 0 {
		t.Fatalf("unknown Modal model must cost 0, got %d", rec.CostMicros)
	}
	if !c.UsesModal() {
		t.Fatal("client must report Modal routing")
	}
}
