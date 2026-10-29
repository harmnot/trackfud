package ai

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

// Transcriber turns courier audio into text. The courier PWA streams 24 kHz
// Int16 mono PCM (see VOICE_WS_PATH); the server wraps it as WAV for the
// transcription endpoint.
type Transcriber interface {
	// Transcribe converts raw PCM frames to text. langHint is "en"/"id".
	Transcribe(ctx context.Context, pcm []byte, langHint string) (text string, rec CallRecord, err error)
}

// ErrNoTranscript means no transcript is available (no key / empty audio):
// the caller falls back to the typed-transcript frame or the local parser.
var ErrNoTranscript = errors.New("ai: no transcript available")

// MetaTranscriber calls muse-voice-transcribe through the OpenAI-compatible
// audio endpoint.
type MetaTranscriber struct {
	cfg Config
	cli openai.Client
}

// NewMetaTranscriber builds the live transcriber. Modal proxy headers ride
// along when the pair is set; the Modal endpoint serves chat only, so audio
// there fails into UpstreamError and the caller falls back to the typed
// transcript. Live transcription needs the Meta-direct APIKey.
func NewMetaTranscriber(cfg Config) *MetaTranscriber {
	cfg = cfg.withDefaults()
	opts := []option.RequestOption{
		option.WithBaseURL(cfg.BaseURL),
		option.WithAPIKey(cfg.APIKey),
	}
	if cfg.UsesModal() {
		opts = append(opts,
			option.WithHeader("Modal-Key", cfg.ModalKey),
			option.WithHeader("Modal-Secret", cfg.ModalSecret),
		)
	}
	return &MetaTranscriber{cfg: cfg, cli: openai.NewClient(opts...)}
}

// Transcribe implements Transcriber.
func (t *MetaTranscriber) Transcribe(ctx context.Context, pcm []byte, langHint string) (string, CallRecord, error) {
	start := time.Now()
	rec := CallRecord{Feature: "voice_transcribe", Model: t.cfg.TranscribeModel, PromptVersion: PromptVoiceV1}
	if t.cfg.APIKey == "" || len(pcm) < 3200 { // <100 ms of audio is noise
		rec.LatencyMs = time.Since(start).Milliseconds()
		return "", rec, ErrNoTranscript
	}
	wav := PCMToWAV(pcm, 24000)
	f, err := os.CreateTemp("", "tf-voice-*.wav")
	if err != nil {
		return "", rec, err
	}
	name := f.Name()
	_, werr := f.Write(wav)
	cerr := f.Close()
	if werr != nil || cerr != nil {
		_ = os.Remove(name)
		return "", rec, errors.New("ai: voice buffer write failed")
	}
	defer os.Remove(name)
	params := openai.AudioTranscriptionNewParams{
		File:  f,
		Model: openai.AudioModel(t.cfg.TranscribeModel),
	}
	if langHint == "id" || langHint == "en" {
		params.Language = openai.String(langHint)
	}
	resp, err := t.cli.Audio.Transcriptions.New(ctx, params)
	rec.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		return "", rec, &UpstreamError{Op: "voice_transcribe", Err: err, Retryable: true}
	}
	text := resp.AsTranscription().Text
	if text == "" {
		if v := resp.AsTranscriptionVerbose(); v.Text != "" {
			text = v.Text
		}
	}
	return text, rec, nil
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

var _ = io.Discard
