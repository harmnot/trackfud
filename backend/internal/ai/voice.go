package ai

import (
	"regexp"
	"strings"
)

// Local EN+ID voice parser. This mirrors the courier PWA fallback
// (frontend-runner-biker/src/features/voice/voiceCommands.ts) so the server
// behaves identically with no Meta key; with a key, Spark tool calling owns
// the intent and this parser stays as the deterministic fallback.

// VoiceIntent is a hands-free copilot intent.
type VoiceIntent string

const (
	IntentAccept  VoiceIntent = "accept"
	IntentDecline VoiceIntent = "decline"
	IntentHowFar  VoiceIntent = "howFar"
	IntentEtaSoon VoiceIntent = "etaSoon"
	IntentRepeat  VoiceIntent = "repeat"
	IntentUnknown VoiceIntent = "unknown"
)

var voicePatterns = []struct {
	re     *regexp.Regexp
	intent VoiceIntent
}{
	{regexp.MustCompile(`\b(accept|accepts|accepted|take it|take order|yes|yeah|ok(ay)? go|gas|terima|ya|iya|ambil|oke gas)\b`), IntentAccept},
	{regexp.MustCompile(`\b(decline|reject|no thanks?|skip|no\b.*offer|tolak|tidak|nggak|enggak|nanti (aja|dulu))\b`), IntentDecline},
	{regexp.MustCompile(`\b(how far|how long|distance|jarak|berapa (jauh|jarak|lama)|tinggal berapa|where.*(pickup|resto|merchant)|di mana.*resto)\b`), IntentHowFar},
	{regexp.MustCompile(`\b(2\s?min|two min|almost (there|here)|arriving|on my way|otw|sampai|dua menit|sebentar lagi|hampir sampai|mau sampai)\b`), IntentEtaSoon},
	{regexp.MustCompile(`\b(repeat|again|say again|sekali lagi|ulangi|ulang)\b`), IntentRepeat},
}

// NormalizeTranscript lowercases and depunctuates one transcript line.
func NormalizeTranscript(text string) string {
	lower := strings.ToLower(text)
	var b strings.Builder
	for _, r := range lower {
		switch r {
		case '?', '!', '.', ',', ';', ':':
			b.WriteByte(' ')
		default:
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// ParseVoiceCommand maps one transcript line to an intent (EN + ID,
// code-switching friendly).
func ParseVoiceCommand(text string) VoiceIntent {
	line := NormalizeTranscript(text)
	if line == "" {
		return IntentUnknown
	}
	for _, p := range voicePatterns {
		if p.re.MatchString(line) {
			return p.intent
		}
	}
	return IntentUnknown
}

var idMarkers = []string{"terima", "tolak", "berapa", "jarak", "jauh", "sampai", "menit", "sebentar", "hampir", "ulangi", "ulang", "sekali lagi", "iya", "nggak", "enggak", "oke", "gas", "ambil", "otw", "di mana", "resto"}

// DetectLang returns "id" when the line carries Indonesian markers,
// otherwise "en". The reply language follows the courier's words.
func DetectLang(text string) string {
	line := " " + NormalizeTranscript(text) + " "
	for _, m := range idMarkers {
		if strings.Contains(line, m) {
			return "id"
		}
	}
	return "en"
}

// ReplyCtx feeds the spoken reply template.
type ReplyCtx struct {
	MerchantName  string
	EtaText       string
	LastOfferText string
}

// VoiceReply builds the spoken reply for an intent (same wording contract
// as the PWA fallback).
func VoiceReply(intent VoiceIntent, lang string, ctx ReplyCtx) string {
	id := lang == "id" || lang == "ms"
	switch intent {
	case IntentAccept:
		if ctx.MerchantName != "" {
			if id {
				return "Siap. Order " + ctx.MerchantName + " diterima."
			}
			return "Done. " + ctx.MerchantName + " accepted."
		}
		if id {
			return "Siap. Order diterima."
		}
		return "Done. Offer accepted."
	case IntentDecline:
		if id {
			return "Oke, tawaran dilewati. Tanpa penalti."
		}
		return "Okay, offer skipped. No penalty."
	case IntentHowFar:
		if ctx.EtaText != "" {
			return ctx.EtaText
		}
		if id {
			return "Belum ada info jarak."
		}
		return "No distance info yet."
	case IntentEtaSoon:
		if id {
			return "Siap, pelanggan dikabari kamu 2 menit lagi sampai."
		}
		return "Got it, the customer hears you are 2 minutes away."
	case IntentRepeat:
		if ctx.LastOfferText != "" {
			return ctx.LastOfferText
		}
		if id {
			return "Tidak ada tawaran aktif."
		}
		return "No active offer."
	default:
		if id {
			return "Maaf, coba: terima, berapa jauh, atau dua menit sampai."
		}
		return "Sorry, try: accept, how far, or 2 minutes away."
	}
}
