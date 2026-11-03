package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

// asrCapture is what the fake Meta ASR endpoint saw for one request.
type asrCapture struct {
	method, path, auth, accept string
	partNames, partTypes       []string
	request                    asrRequest
	audio                      []byte
}

// fakeASR serves the documented push-to-talk contract and records the
// multipart shape. status/body control the reply.
func fakeASR(t *testing.T, status int, body string, got *asrCapture) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method, got.path = r.Method, r.URL.Path
		got.auth, got.accept = r.Header.Get("Authorization"), r.Header.Get("Accept")
		mt, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mt != "multipart/form-data" {
			t.Errorf("content type = %q (%v), want multipart/form-data", r.Header.Get("Content-Type"), err)
		}
		mr := multipart.NewReader(r.Body, params["boundary"])
		for {
			p, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Errorf("multipart: %v", err)
				break
			}
			data, _ := io.ReadAll(p)
			got.partNames = append(got.partNames, p.FormName())
			got.partTypes = append(got.partTypes, p.Header.Get("Content-Type"))
			switch p.FormName() {
			case "request":
				if err := json.Unmarshal(data, &got.request); err != nil {
					t.Errorf("request part is not JSON: %v", err)
				}
			case "audio":
				got.audio = data
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
}

// 1 s of 24 kHz Int16 mono silence-ish PCM (a real push-to-talk clip size).
func oneSecondPCM() []byte { return make([]byte, 24000*2) }

// The transcriber must speak the documented contract: POST /v1/asr/transcribe,
// Bearer key + Accept JSON, exactly two parts ("request" JSON then "audio"
// WAV), command keywords + Indonesian bias, and parse the transcript back.
func TestMetaTranscriberContract(t *testing.T) {
	var got asrCapture
	ts := fakeASR(t, http.StatusOK,
		`{"sessionId":"asr-7f3c","transcript":" terima, order sate ","audioDurationMs":1000,"turns":[]}`, &got)
	defer ts.Close()

	tr := NewMetaTranscriber(Config{APIKey: "meta-test-key", BaseURL: ts.URL})
	pcm := oneSecondPCM()
	text, rec, err := tr.Transcribe(context.Background(), pcm, "id")
	if err != nil {
		t.Fatalf("transcribe: %v", err)
	}
	if text != "terima, order sate" {
		t.Fatalf("transcript = %q", text)
	}
	if got.method != http.MethodPost || got.path != "/v1/asr/transcribe" {
		t.Fatalf("endpoint = %s %s", got.method, got.path)
	}
	if got.auth != "Bearer meta-test-key" || got.accept != "application/json" {
		t.Fatalf("headers auth=%q accept=%q", got.auth, got.accept)
	}
	if !slices.Equal(got.partNames, []string{"request", "audio"}) {
		t.Fatalf("parts = %v, want exactly [request audio]", got.partNames)
	}
	if !slices.Equal(got.partTypes, []string{"application/json", "audio/wav"}) {
		t.Fatalf("part types = %v", got.partTypes)
	}
	req := got.request
	if req.Model != ModelTranscribe || req.AudioEncoding != "WAV" || req.Mode != "PUSH_TO_TALK" {
		t.Fatalf("request options = %+v", req)
	}
	if !slices.Equal(req.LanguageBias, []string{"Indonesian"}) {
		t.Fatalf("languageBias = %v", req.LanguageBias)
	}
	for _, k := range []string{"accept", "decline", "terima", "tolak"} {
		if !slices.Contains(req.Keywords, k) {
			t.Fatalf("keywords %v missing %q", req.Keywords, k)
		}
	}
	if len(got.audio) != 44+len(pcm) || string(got.audio[:4]) != "RIFF" || string(got.audio[8:12]) != "WAVE" {
		t.Fatalf("audio part is not the WAV-wrapped PCM (%d bytes)", len(got.audio))
	}
	if rec.Feature != "voice_transcribe" || rec.Model != ModelTranscribe || rec.ErrText != "" {
		t.Fatalf("call record = %+v", rec)
	}
}

// Optional fields are omitted, not sent empty: no languageBias for hints the
// endpoint has no name for.
func TestMetaTranscriberLanguageBias(t *testing.T) {
	for hint, want := range map[string][]string{"en": {"English"}, "id": {"Indonesian"}, " ID ": {"Indonesian"}, "ms": nil, "": nil} {
		if got := asrLanguageBias(hint); !slices.Equal(got, want) {
			t.Fatalf("asrLanguageBias(%q) = %v, want %v", hint, got, want)
		}
	}
	var got asrCapture
	ts := fakeASR(t, http.StatusOK, `{"sessionId":"s","transcript":"how far","audioDurationMs":900,"turns":[]}`, &got)
	defer ts.Close()
	if _, _, err := NewMetaTranscriber(Config{APIKey: "k", BaseURL: ts.URL}).Transcribe(context.Background(), oneSecondPCM(), "ms"); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(got.request)
	if strings.Contains(string(raw), "languageBias") {
		t.Fatalf("unknown hint must omit languageBias: %s", raw)
	}
}

// The relay's hint follows the courier UI language sent on voice.end:
// en|id|ms pass through (case/space/region tolerant), anything else keeps
// the original Indonesian default, and the resulting bias is unchanged for
// clients that send nothing.
func TestVoiceLangHint(t *testing.T) {
	for in, want := range map[string]string{
		"en": "en", "id": "id", "ms": "ms", " EN ": "en", "id-ID": "id", "ms_MY": "ms", "en-GB": "en",
		"": "id", "fr": "id", "english": "id", "-en": "id", "zh-Hans": "id", "<script>": "id",
	} {
		if got := VoiceLangHint(in); got != want {
			t.Fatalf("VoiceLangHint(%q) = %q, want %q", in, got, want)
		}
	}
	if got := asrLanguageBias(VoiceLangHint("")); !slices.Equal(got, []string{"Indonesian"}) {
		t.Fatalf("missing lang must keep the Indonesian bias, got %v", got)
	}
	if got := asrLanguageBias(VoiceLangHint("en")); !slices.Equal(got, []string{"English"}) {
		t.Fatalf("an English UI must bias English, got %v", got)
	}
}

// Error mapping: 429/5xx are retryable, 400/406/413 are not; an empty
// transcript is ErrNoTranscript; no key or tiny audio never calls upstream.
func TestMetaTranscriberErrors(t *testing.T) {
	for status, retry := range map[int]bool{400: false, 406: false, 413: false, 429: true, 500: true, 503: true} {
		var got asrCapture
		ts := fakeASR(t, status, `{"error":{"message":"rejected by test"}}`, &got)
		_, rec, err := NewMetaTranscriber(Config{APIKey: "k", BaseURL: ts.URL}).Transcribe(context.Background(), oneSecondPCM(), "en")
		ts.Close()
		var up *UpstreamError
		if !errors.As(err, &up) {
			t.Fatalf("status %d: want *UpstreamError, got %v", status, err)
		}
		if up.Retryable != retry {
			t.Fatalf("status %d: Retryable=%v, want %v", status, up.Retryable, retry)
		}
		if rec.ErrText == "" || !strings.Contains(rec.ErrText, "rejected by test") {
			t.Fatalf("status %d: ErrText must carry the upstream reason, got %q", status, rec.ErrText)
		}
	}

	var got asrCapture
	ts := fakeASR(t, http.StatusOK, `{"sessionId":"s","transcript":"   ","audioDurationMs":800,"turns":[]}`, &got)
	defer ts.Close()
	if _, rec, err := NewMetaTranscriber(Config{APIKey: "k", BaseURL: ts.URL}).Transcribe(context.Background(), oneSecondPCM(), "id"); !errors.Is(err, ErrNoTranscript) || rec.ErrText != "" {
		t.Fatalf("silence must be ErrNoTranscript without ErrText, got %v %q", err, rec.ErrText)
	}

	got = asrCapture{}
	if _, _, err := NewMetaTranscriber(Config{BaseURL: ts.URL}).Transcribe(context.Background(), oneSecondPCM(), "id"); !errors.Is(err, ErrNoTranscript) {
		t.Fatalf("no key must be ErrNoTranscript, got %v", err)
	}
	if _, _, err := NewMetaTranscriber(Config{APIKey: "k", BaseURL: ts.URL}).Transcribe(context.Background(), make([]byte, 100), "id"); !errors.Is(err, ErrNoTranscript) {
		t.Fatalf("tiny audio must be ErrNoTranscript, got %v", err)
	}
	if got.method != "" {
		t.Fatal("no key / tiny audio must not call upstream")
	}

	bad := fakeASR(t, http.StatusOK, `not json`, &got)
	defer bad.Close()
	var up *UpstreamError
	if _, _, err := NewMetaTranscriber(Config{APIKey: "k", BaseURL: bad.URL}).Transcribe(context.Background(), oneSecondPCM(), "id"); !errors.As(err, &up) || up.Retryable {
		t.Fatalf("malformed success body must be a non-retryable upstream error, got %v", err)
	}
}

// Audio stays Meta-direct even when chat routes via Modal; a bare-root base
// is normalized to /v1.
func TestMetaTranscriberEndpoint(t *testing.T) {
	if got := NewMetaTranscriber(Config{APIKey: "k", ModalKey: "wk", ModalSecret: "ws"}).endpoint; got != "https://api.meta.ai/v1/asr/transcribe" {
		t.Fatalf("Modal pair must keep Meta-direct audio, got %q", got)
	}
	if got := NewMetaTranscriber(Config{APIKey: "k", BaseURL: "https://meta.example/"}).endpoint; got != "https://meta.example/v1/asr/transcribe" {
		t.Fatalf("bare root must normalize, got %q", got)
	}
	if got := NewMetaTranscriber(Config{APIKey: "k"}).endpoint; got != DefaultBaseURL+"/asr/transcribe" {
		t.Fatalf("default endpoint = %q", got)
	}
}

// Every ASR bias keyword must parse back to its own intent (single source:
// voicePatterns), and the bilingual core commands must be present.
func TestVoiceKeywordsParse(t *testing.T) {
	for _, p := range voicePatterns {
		if len(p.keywords) == 0 {
			t.Fatalf("intent %q has no ASR keywords", p.intent)
		}
		for _, k := range p.keywords {
			if got := ParseVoiceCommand(k); got != p.intent {
				t.Fatalf("keyword %q parses to %q, want %q", k, got, p.intent)
			}
		}
	}
	kw := VoiceKeywords()
	for _, k := range []string{"accept", "decline", "terima", "tolak", "berapa jauh", "dua menit"} {
		if !slices.Contains(kw, k) {
			t.Fatalf("VoiceKeywords() %v missing %q", kw, k)
		}
	}
	kw[0] = "mutated"
	if VoiceKeywords()[0] == "mutated" {
		t.Fatal("VoiceKeywords must return a fresh copy")
	}
}
