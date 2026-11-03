package app

import (
	"testing"

	"Trackfud/internal/ai"
)

// TestLiveTranscription pins the voice.hello "transcribe" flag: only a
// Meta-direct key turns on server transcription; a chat-only (Modal) setup
// stays on the typed/local fallback.
func TestLiveTranscription(t *testing.T) {
	if newAIService(ai.Config{}).liveTranscription() {
		t.Fatal("no key must not report live transcription")
	}
	if newAIService(ai.Config{ModalKey: "id", ModalSecret: "secret"}).liveTranscription() {
		t.Fatal("Modal chat pair alone must not report live transcription")
	}
	if !newAIService(ai.Config{APIKey: "k"}).liveTranscription() {
		t.Fatal("Meta key must report live transcription")
	}
}
