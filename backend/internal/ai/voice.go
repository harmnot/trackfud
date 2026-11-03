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

// voicePatterns is the one vocabulary source for both the local parser and
// ASR keyword biasing. Each row pairs the intent regex (mirrors the PWA
// parser) with the literal command words it accepts; VoiceKeywords hands
// those words to the transcriber so short EN/ID commands ("terima",
// "tolak") transcribe cleanly. TestVoiceKeywordsParse keeps every keyword
// parsing back to its own intent, so the two cannot drift apart.
var voicePatterns = []struct {
	re       *regexp.Regexp
	intent   VoiceIntent
	keywords []string
}{
	{regexp.MustCompile(`\b(accept|accepts|accepted|take it|take order|yes|yeah|ok(ay)? go|gas|terima|ya|iya|ambil|oke gas)\b`), IntentAccept,
		[]string{"accept", "take order", "terima", "ambil", "oke gas"}},
	{regexp.MustCompile(`\b(decline|reject|no thanks?|skip|no\b.*offer|tolak|tidak|nggak|enggak|nanti (aja|dulu))\b`), IntentDecline,
		[]string{"decline", "reject", "skip", "tolak", "nggak", "nanti dulu"}},
	{regexp.MustCompile(`\b(how far|how long|distance|jarak|berapa (jauh|jarak|lama)|tinggal berapa|where.*(pickup|resto|merchant)|di mana.*resto)\b`), IntentHowFar,
		[]string{"how far", "distance", "jarak", "berapa jauh", "tinggal berapa"}},
	{regexp.MustCompile(`\b(2\s?min|two min|almost (there|here)|arriving|on my way|otw|sampai|dua menit|sebentar lagi|hampir sampai|mau sampai)\b`), IntentEtaSoon,
		[]string{"on my way", "almost there", "otw", "dua menit", "sebentar lagi", "hampir sampai"}},
	{regexp.MustCompile(`\b(repeat|again|say again|sekali lagi|ulangi|ulang)\b`), IntentRepeat,
		[]string{"repeat", "say again", "ulangi", "sekali lagi"}},
}

// VoiceKeywords returns the voice-command vocabulary (EN + ID) for ASR
// keyword biasing, in parser order without duplicates. It is derived from
// voicePatterns, so biasing only ever favors words the parser understands.
// The slice is a fresh copy; callers may keep or modify it.
func VoiceKeywords() []string {
	seen := map[string]bool{}
	out := []string{}
	for _, p := range voicePatterns {
		for _, k := range p.keywords {
			if !seen[k] {
				seen[k] = true
				out = append(out, k)
			}
		}
	}
	return out
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
