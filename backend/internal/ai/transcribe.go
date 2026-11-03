package ai

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
)

// Transcriber turns courier audio into text. The courier PWA streams 24 kHz
// Int16 mono PCM (see VOICE_WS_PATH); the server wraps it as WAV for the
// transcription endpoint.
type Transcriber interface {
	// Transcribe converts raw PCM frames to text. langHint is "en"/"id"/"ms"
	// (normalize client input with VoiceLangHint).
	Transcribe(ctx context.Context, pcm []byte, langHint string) (text string, rec CallRecord, err error)
}

// ErrNoTranscript means no transcript is available (no key / empty audio /
// silence): the caller falls back to the typed-transcript frame or the
// local parser.
var ErrNoTranscript = errors.New("ai: no transcript available")

// errAudioTooLong means the PCM buffer exceeds the endpoint's 10-minute cap.
var errAudioTooLong = errors.New("ai: voice audio exceeds the 10 min transcription cap")

// Meta push-to-talk ASR contract (dev.meta.ai voice/transcribe + schemas):
// POST {base}/asr/transcribe, multipart/form-data with exactly two parts —
// "request" (application/json options) then "audio" (audio/wav, mono int16
// PCM at 16 or 24 kHz, at most 10 min and 32 MB).
const (
	asrPath          = "/asr/transcribe"
	asrAudioEncoding = "WAV"
	asrModePTT       = "PUSH_TO_TALK"
	// asrSampleRate is the courier PWA capture rate (Int16 mono).
	asrSampleRate = 24000
	// asrMinPCMBytes: under ~67 ms of 24 kHz audio is noise, not a command.
	asrMinPCMBytes = 3200
	// asrMaxPCMBytes is the 10-minute cap (24 kHz × 2 B × 600 s ≈ 28.8 MB,
	// which also keeps the WAV under the 32 MB body cap).
	asrMaxPCMBytes = asrSampleRate * 2 * 600
	// asrMaxResponseBytes bounds the JSON read back from the endpoint.
	asrMaxResponseBytes = 1 << 20
	// asrErrSnippetRunes bounds the upstream error body kept for ai_calls.
	asrErrSnippetRunes = 200
	// asrHTTPTimeout backstops the caller's context deadline.
	asrHTTPTimeout = 60 * time.Second
)

// asrRequest is the JSON "request" part. Keywords/LanguageBias are optional
// and omitted when empty.
type asrRequest struct {
	Model         string   `json:"model"`
	AudioEncoding string   `json:"audioEncoding"`
	Mode          string   `json:"mode"`
	Keywords      []string `json:"keywords,omitempty"`
	LanguageBias  []string `json:"languageBias,omitempty"`
}

// asrResponse is the success body; turns stay empty in PUSH_TO_TALK mode.
type asrResponse struct {
	SessionID       string            `json:"sessionId"`
	Transcript      string            `json:"transcript"`
	AudioDurationMs int64             `json:"audioDurationMs"`
	Turns           []json.RawMessage `json:"turns"`
}

// MetaTranscriber calls Meta's push-to-talk ASR endpoint
// (muse-voice-transcribe) over plain net/http. The key stays server-side.
type MetaTranscriber struct {
	cfg      Config
	endpoint string
	keywords []string
	http     *http.Client
}

// NewMetaTranscriber builds the live transcriber. Audio is Meta-direct only:
// the Modal endpoint serves chat completions, so when the Modal pair is set
// the transcriber still uses the Meta base + key (callers already gate on
// APIKey; without it newAIService picks the local transcriber and voice
// falls back to the typed transcript). Keywords bias recognition toward the
// voice-command vocabulary (VoiceKeywords).
func NewMetaTranscriber(cfg Config) *MetaTranscriber {
	cfg = cfg.withDefaults()
	base := cfg.BaseURL
	if cfg.UsesModal() {
		base = ensureV1Base(DefaultBaseURL)
	}
	return &MetaTranscriber{
		cfg:      cfg,
		endpoint: base + asrPath,
		keywords: VoiceKeywords(),
		http:     &http.Client{Timeout: asrHTTPTimeout},
	}
}

// Transcribe implements Transcriber. Upstream failures come back as
// *UpstreamError (Retryable for 429/5xx and transport errors); an empty
// transcript (silence) is ErrNoTranscript.
func (t *MetaTranscriber) Transcribe(ctx context.Context, pcm []byte, langHint string) (string, CallRecord, error) {
	start := time.Now()
	rec := CallRecord{Feature: "voice_transcribe", Model: t.cfg.TranscribeModel, PromptVersion: PromptVoiceV1}
	fail := func(err error) (string, CallRecord, error) {
		rec.LatencyMs = time.Since(start).Milliseconds()
		if !errors.Is(err, ErrNoTranscript) {
			rec.ErrText = errText(err)
		}
		return "", rec, err
	}
	if t.cfg.APIKey == "" || len(pcm) < asrMinPCMBytes {
		return fail(ErrNoTranscript)
	}
	if len(pcm) > asrMaxPCMBytes {
		return fail(errAudioTooLong)
	}
	body, contentType, err := asrMultipart(asrRequest{
		Model:         t.cfg.TranscribeModel,
		AudioEncoding: asrAudioEncoding,
		Mode:          asrModePTT,
		Keywords:      t.keywords,
		LanguageBias:  asrLanguageBias(langHint),
	}, PCMToWAV(pcm, asrSampleRate))
	if err != nil {
		return fail(err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.endpoint, bytes.NewReader(body))
	if err != nil {
		return fail(fmt.Errorf("ai: build transcribe request: %w", err))
	}
	req.Header.Set("Authorization", "Bearer "+t.cfg.APIKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", contentType)
	resp, err := t.http.Do(req)
	if err != nil {
		return fail(&UpstreamError{Op: rec.Feature, Err: err, Retryable: true})
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, asrMaxResponseBytes))
	if err != nil {
		return fail(&UpstreamError{Op: rec.Feature, Err: fmt.Errorf("read body: %w", err), Retryable: true})
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fail(&UpstreamError{Op: rec.Feature,
			Err:       fmt.Errorf("status %d: %s", resp.StatusCode, asrSnippet(raw)),
			Retryable: asrRetryable(resp.StatusCode)})
	}
	var out asrResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return fail(&UpstreamError{Op: rec.Feature, Err: fmt.Errorf("decode body: %w", err)})
	}
	text := strings.TrimSpace(out.Transcript)
	if text == "" {
		return fail(ErrNoTranscript)
	}
	rec.LatencyMs = time.Since(start).Milliseconds()
	return text, rec, nil
}

// asrMultipart builds the two-part body ("request" JSON, then "audio" WAV)
// and returns it with its multipart Content-Type (boundary included).
func asrMultipart(req asrRequest, wav []byte) ([]byte, string, error) {
	opts, err := json.Marshal(req)
	if err != nil {
		return nil, "", fmt.Errorf("ai: encode transcribe request: %w", err)
	}
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	parts := []struct {
		disposition, contentType string
		data                     []byte
	}{
		{`form-data; name="request"`, "application/json", opts},
		{`form-data; name="audio"; filename="voice.wav"`, "audio/wav", wav},
	}
	for _, p := range parts {
		h := textproto.MIMEHeader{}
		h.Set("Content-Disposition", p.disposition)
		h.Set("Content-Type", p.contentType)
		w, err := mw.CreatePart(h)
		if err != nil {
			return nil, "", fmt.Errorf("ai: transcribe multipart: %w", err)
		}
		if _, err := w.Write(p.data); err != nil {
			return nil, "", fmt.Errorf("ai: transcribe multipart: %w", err)
		}
	}
	if err := mw.Close(); err != nil {
		return nil, "", fmt.Errorf("ai: transcribe multipart: %w", err)
	}
	return buf.Bytes(), mw.FormDataContentType(), nil
}

// DefaultVoiceLang is the relay's transcription hint when the courier's UI
// language is missing or unsupported (the original Indonesian default).
const DefaultVoiceLang = "id"

// VoiceLangHint validates the courier UI language a client sends with a
// PCM utterance (voice.end "lang") against the supported set en|id|ms. A
// region tag counts as its language ("id-ID" → "id"); anything else falls
// back to DefaultVoiceLang.
func VoiceLangHint(lang string) string {
	l := strings.ToLower(strings.TrimSpace(lang))
	if i := strings.IndexAny(l, "-_"); i > 0 {
		l = l[:i]
	}
	switch l {
	case "en", "id", "ms":
		return l
	default:
		return DefaultVoiceLang
	}
}

// asrLanguageBias maps the relay's language hint to the endpoint's
// languageBias names; any other hint sends no bias.
func asrLanguageBias(langHint string) []string {
	switch strings.ToLower(strings.TrimSpace(langHint)) {
	case "en":
		return []string{"English"}
	case "id":
		return []string{"Indonesian"}
	default:
		return nil
	}
}

// asrRetryable reports whether a non-2xx status may succeed on retry:
// 429 (rate/concurrency limit) and 5xx yes; 400/406/413 (bad audio, bad
// Accept, too big) never will.
func asrRetryable(status int) bool {
	return status == http.StatusTooManyRequests || status >= 500
}

// asrSnippet keeps a short single-line excerpt of an upstream error body.
func asrSnippet(raw []byte) string {
	s := strings.Join(strings.Fields(string(raw)), " ")
	if r := []rune(s); len(r) > asrErrSnippetRunes {
		s = string(r[:asrErrSnippetRunes]) + "…"
	}
	if s == "" {
		s = "(empty body)"
	}
	return s
}

// LocalTranscriber is the no-key fallback: it never invents a transcript.
// The voice endpoint then uses the transcript frame the PWA already sends
// (on-device recognizer or typed box) with the local parser.
type LocalTranscriber struct{}

// Transcribe implements Transcriber.
func (LocalTranscriber) Transcribe(_ context.Context, _ []byte, _ string) (string, CallRecord, error) {
	return "", CallRecord{Feature: "voice_transcribe", Model: "local-fallback", Fallback: true}, ErrNoTranscript
}

// PCMToWAV wraps 24 kHz Int16 mono PCM bytes in a WAV header.
func PCMToWAV(pcm []byte, sampleRate int) []byte {
	var buf bytes.Buffer
	dataLen := len(pcm)
	write := func(v any) { _ = binary.Write(&buf, binary.LittleEndian, v) }
	buf.WriteString("RIFF")
	write(uint32(36 + dataLen))
	buf.WriteString("WAVEfmt ")
	write(uint32(16))
	write(uint16(1)) // PCM
	write(uint16(1)) // mono
	write(uint32(sampleRate))
	write(uint32(sampleRate * 2)) // byte rate
	write(uint16(2))              // block align
	write(uint16(16))             // bits
	buf.WriteString("data")
	write(uint32(dataLen))
	buf.Write(pcm)
	return buf.Bytes()
}

// DrainPCM caps buffered voice audio (30 s at 24 kHz Int16 mono) so a stuck
// mic cannot grow memory without bound.
func DrainPCM(cur []byte, frame []byte) []byte {
	const maxPCM = 24000 * 2 * 30
	if len(cur) >= maxPCM {
		return cur
	}
	if len(cur)+len(frame) > maxPCM {
		frame = frame[:maxPCM-len(cur)]
	}
	return append(cur, frame...)
}
