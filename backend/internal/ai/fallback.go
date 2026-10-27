package ai

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"strings"
)

// Deterministic cached fallbacks. Every function is pure: same input bytes
// always produce the same output, with no key, no network, and no randomness.
// The AI workers call these when the Meta API is unreachable so the demo
// (and its tests) behave identically offline. Nothing here sets prices or
// bans couriers.

// demoMenu is the canned Snap-a-Menu result for demo photos: it mirrors the
// seeded Jakarta menu so import output looks native to judges.
func demoMenu() []MenuDraft {
	mk := func(en, id, ms, size, spill string, tw bool) MenuDraft {
		return MenuDraft{
			Name:            map[string]string{"en": en, "id": id, "ms": ms},
			Description:     map[string]string{},
			PriceMinor:      nil,
			PriceUnreadable: true,
			SizeClass:       size,
			SpillRisk:       spill,
			TravelsWell:     tw,
			Confident:       false,
		}
	}
	return []MenuDraft{
		mk("Grilled Chicken Rice Box", "Nasi Ayam Panggang", "Nasi Ayam Bakar", "M", "low", true),
		mk("Tofu Veggie Wrap", "Wrap Tahu Sayur", "Balut Tauhu Sayur", "S", "low", true),
		mk("Fruit Salad Cup", "Salad Buah", "Salad Buah", "S", "medium", true),
		mk("Iced Tea", "Es Teh Manis", "Teh Ais", "S", "high", false),
	}
}

// FallbackMenu returns the deterministic demo menu for any photo hash. The
// hash picks a stable rotation so distinct photos give distinct (but stable)
// orders, which keeps the simulator's bot merchants varied.
func FallbackMenu(photoSHA string) MenuOutput {
	items := demoMenu()
	if photoSHA != "" {
		sum := sha256.Sum256([]byte(photoSHA))
		rot := int(binary.BigEndian.Uint16(sum[:2])) % len(items)
		items = append(append([]MenuDraft{}, items[rot:]...), items[:rot]...)
	}
	return MenuOutput{Items: items}
}

// phrasebook covers the demo's quick replies and chat lines (EN<->ID/MS).
var phrasebook = map[string]string{
	"i'm at the gate":              "Saya di gerbang.",
	"saya di gerbang":              "I'm at the gate.",
	"i'm 2 minutes away":           "Saya 2 menit lagi sampai.",
	"dua menit sampai":             "I'm 2 minutes away.",
	"on my way":                    "OTW.",
	"otw":                          "On my way.",
	"thank you":                    "Terima kasih.",
	"terima kasih":                 "Thank you.",
	"semangat!":                    "Keep going!",
	"keep going!":                  "Semangat!",
	"where is the pickup?":         "Penjemputan di mana?",
	"penjemputan di mana?":         "Where is the pickup?",
	"grilled chicken rice box":     "Nasi Ayam Panggang",
	"nasi ayam panggang":           "Grilled Chicken Rice Box",
	"tofu veggie wrap":             "Wrap Tahu Sayur",
	"wrap tahu sayur":              "Tofu Veggie Wrap",
	"fruit salad cup":              "Salad Buah",
	"salad buah":                   "Fruit Salad Cup",
	"workout delivery · 30-60 min": "Pengiriman workout · 30-60 mnt",
}

// FallbackTranslate returns the phrasebook hit or a marked passthrough.
// Passthrough is honest: the original text is kept and flagged untranslated
// by the caller (translated_body stays empty unless confident).
func FallbackTranslate(text, from, to string) (translated string, confident bool) {
	key := strings.ToLower(strings.TrimSpace(text))
	if hit, ok := phrasebook[key]; ok {
		_ = from
		_ = to
		return hit, true
	}
	return text, false
}

// FallbackModerate flags obvious abuse with a fixed keyword list (EN+ID).
// It only flags for humans; nothing is auto-deleted.
func FallbackModerate(text string) (abusive bool) {
	lower := " " + strings.ToLower(text) + " "
	for _, w := range []string{"bodoh", "bego", "anjing", "bangsat", "tolol", "idiot", "stupid", "hate you", "kill you", "bitch"} {
		if strings.Contains(lower, w) {
			return true
		}
	}
	return false
}

// FallbackTrustBrief summarizes server-measured cheat flags deterministically.
// flagCount==0 → low; 1-2 → medium; 3+ → high. Advisory always true.
func FallbackTrustBrief(flagCount int, photoReadable, bikeMotorSeen bool) TrustBrief {
	risk := "low"
	if flagCount >= 3 || bikeMotorSeen {
		risk = "high"
	} else if flagCount >= 1 || !photoReadable {
		risk = "medium"
	}
	reasons := []string{}
	if flagCount == 0 {
		reasons = append(reasons, "no test-run cheat flags")
	} else {
		reasons = append(reasons, "test-run cheat flags need a look")
	}
	if photoReadable {
		reasons = append(reasons, "ID photo readable")
	} else {
		reasons = append(reasons, "ID photo unclear")
	}
	if bikeMotorSeen {
		reasons = append(reasons, "bike photo may show a motor")
	}
	return TrustBrief{
		Advisory:  true,
		Risk:      risk,
		Reasons:   reasons,
		Summary:   "Offline brief: " + strings.Join(reasons, "; ") + ". Admin decides.",
		PhotoNote: "Offline check only; a human must compare the selfie with the ID.",
	}
}

// FallbackProofCheck never approves: without vision it returns unclear so a
// human reviews the photo. Safe default, deterministic.
func FallbackProofCheck() ProofCheck {
	return ProofCheck{Verdict: "unclear", Note: "Offline: needs human review."}
}

// FallbackFeedbackLabels maps stars+text to topics with fixed rules.
func FallbackFeedbackLabels(stars int, text string) FeedbackLabels {
	lower := strings.ToLower(text)
	topics := []string{}
	add := func(t string) {
		for _, e := range topics {
			if e == t {
				return
			}
		}
		topics = append(topics, t)
	}
	if stars >= 4 && strings.TrimSpace(text) == "" {
		add("praise")
	}
	if strings.Contains(lower, "late") || strings.Contains(lower, "lama") || strings.Contains(lower, "telat") {
		add("late")
	}
	if strings.Contains(lower, "cold") || strings.Contains(lower, "dingin") {
		add("cold_food")
	}
	if strings.Contains(lower, "spill") || strings.Contains(lower, "tumpah") || strings.Contains(lower, "bocor") {
		add("spilled")
	}
	if strings.Contains(lower, "rude") || strings.Contains(lower, "kasar") {
		add("rude")
	}
	if strings.Contains(lower, "wrong") || strings.Contains(lower, "salah") {
		add("wrong_item")
	}
	if strings.Contains(lower, "thank") || strings.Contains(lower, "makasih") || strings.Contains(lower, "great") || strings.Contains(lower, "enak") {
		add("praise")
	}
	if len(topics) == 0 {
		add("other")
	}
	return FeedbackLabels{Topics: topics, Abusive: FallbackModerate(text)}
}

// FallbackCoach builds the weekly coach text from stats with fixed templates.
// Always paired with the "not medical advice" label at the API layer.
func FallbackCoach(distanceM float64, activeMin int, whoGoalMin int, earningsMinor int64, currency string) CoachReport {
	headline := "Steady week — keep moving."
	if activeMin >= whoGoalMin {
		headline = "WHO goal smashed — 150 active minutes done."
	} else if activeMin >= whoGoalMin/2 {
		headline = "Over halfway to the WHO weekly goal."
	}
	km := distanceM / 1000
	body := fmt.Sprintf("You covered %.1f km with %d active minutes this week.", km, activeMin)
	plan := "Next week: one extra easy session, same pace. Rest a full day after long days."
	_ = earningsMinor
	_ = currency
	return CoachReport{Headline: headline, Body: body, NextPlan: plan}
}
