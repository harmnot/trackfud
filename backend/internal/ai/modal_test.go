package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Modal proxy auth is one Bearer token, "<token-id>.<token-secret>" (Modal
// endpoints guide), not a header pair. A half pair must NOT enable live calls.
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

// The base must always carry /v1: the SDK appends /chat/completions, and the
// Modal curl hits .../v1/chat/completions. A bare root (env set either way)
// is normalized; an explicit /v1 base is left alone.
func TestModalBaseURLNormalization(t *testing.T) {
	root := "https://muhammad099x-work--ep-muse-spark-open-816b-a42b-server.us-west.modal.direct"
	for _, base := range []string{root, root + "/", root + "/v1", root + "/v1/"} {
		got := Config{ModalKey: "wk-x", ModalSecret: "ws-y", BaseURL: base}.withDefaults()
		if got.BaseURL != root+"/v1" {
			t.Fatalf("base %q normalized to %q, want %q/v1", base, got.BaseURL, root)
		}
	}
	meta := Config{APIKey: "meta-key"}.withDefaults()
	if meta.BaseURL != DefaultBaseURL {
		t.Fatalf("Meta direct base must keep /v1, got %q", meta.BaseURL)
	}
}

// The Modal endpoint serves exactly one model id: legacy Spark ids must map
// to it, both in config defaults and per-call, or every call 404s.
func TestModalModelMapping(t *testing.T) {
	for _, legacy := range []string{"", ModelSpark, "muse-spark-open"} {
		got := Config{ModalKey: "wk-x", ModalSecret: "ws-y", SparkModel: legacy}.withDefaults()
		if got.SparkModel != ModelModal {
			t.Fatalf("legacy spark %q must map to %q, got %q", legacy, ModelModal, got.SparkModel)
		}
	}
	served := Config{ModalKey: "wk-x", ModalSecret: "ws-y", SparkModel: ModelModal}.withDefaults()
	if served.SparkModel != ModelModal {
		t.Fatalf("served model id must pass through, got %q", served.SparkModel)
	}
	meta := Config{APIKey: "meta-key"}.withDefaults()
	if meta.SparkModel != ModelSpark {
		t.Fatalf("Meta direct must keep the Spark default, got %q", meta.SparkModel)
	}
	if got := New(Config{ModalKey: "wk-x", ModalSecret: "ws-y"}).resolveModel(ModelSpark); got != ModelModal {
		t.Fatalf("per-call legacy model must map via Modal, got %q", got)
	}
}

// The client must send the Modal proxy token as one Bearer token
// "<token-id>.<token-secret>" on chat calls (httptest, no network), with no
// custom header pair. Unknown Modal model ids cost 0 instead of failing the log.
func TestModalHeadersSent(t *testing.T) {
	var sawKey, sawSecret, sawAuth string
	var sawPath string
	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawKey = r.Header.Get("Modal-Key")
		sawSecret = r.Header.Get("Modal-Secret")
		sawAuth = r.Header.Get("Authorization")
		sawPath = r.URL.Path
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
	if sawAuth != "Bearer wk-test.ws-test" {
		t.Fatalf("Modal proxy auth must be one Bearer token, got Authorization=%q", sawAuth)
	}
	if sawKey != "" || sawSecret != "" {
		t.Fatalf("no custom Modal header pair: key=%q secret=%q", sawKey, sawSecret)
	}
	if sawPath != "/v1/chat/completions" {
		t.Fatalf("SDK path must include /v1, got %q", sawPath)
	}
	if rec.Model != ModelModal || rec.ErrText != "" {
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
