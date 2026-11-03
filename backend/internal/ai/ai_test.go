package ai

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

// ---------- schema validation ----------

func TestParseMenuOutputValid(t *testing.T) {
	raw := `{"items":[
		{"name":{"en":"Soup","id":"Sop"},"size_class":"M","travels_well":true,"confident":true},
		{"name":{"en":"Tea"},"size_class":"S","travels_well":false,"price_unreadable":true}
	]}`
	out, err := ParseMenuOutput(raw)
	if err != nil {
		t.Fatalf("valid menu rejected: %v", err)
	}
	if len(out.Items) != 2 || out.Items[0].SizeClass != "M" || out.Items[1].TravelsWell {
		t.Fatalf("menu parsed wrong: %+v", out)
	}
	for _, it := range out.Items {
		if it.PriceMinor != nil {
			t.Fatalf("AI must never set prices: %+v", it)
		}
	}
}

func TestParseMenuOutputStripsSneakedPrice(t *testing.T) {
	raw := `{"items":[{"name":{"en":"X"},"size_class":"S","travels_well":true,"price_minor":9999}]}`
	out, err := ParseMenuOutput(raw)
	if err != nil {
		t.Fatalf("menu with sneaked price should parse (then strip): %v", err)
	}
	if out.Items[0].PriceMinor != nil {
		t.Fatalf("sneaked price survived validation")
	}
	if !out.Items[0].PriceUnreadable {
		t.Fatalf("sneaked price must raise the unreadable flag")
	}
}

func TestParseMenuOutputRejectsBadEnums(t *testing.T) {
	for _, raw := range []string{
		`{"items":[{"name":{"en":"X"},"size_class":"XL","travels_well":true}]}`,
		`{"items":[{"name":{"en":"X"},"travels_well":true}]}`,
		`{"items":[]}`,
		`{"items":[{"size_class":"S","travels_well":true}]}`,
		`not json`,
	} {
		if _, err := ParseMenuOutput(raw); err == nil {
			t.Fatalf("bad menu accepted: %s", raw)
		}
	}
}

func TestParseTranslateTrustProofLabels(t *testing.T) {
	tr, err := ParseTranslateOutput(`{"text":"Halo","flag_abusive":false}`)
	if err != nil || tr.Text != "Halo" {
		t.Fatalf("translate: %v %+v", err, tr)
	}
	if _, err := ParseTranslateOutput(`{"text":"","flag_abusive":false}`); err == nil {
		t.Fatalf("empty translation accepted")
	}
	tb, err := ParseTrustBrief(`{"risk":"medium","reasons":["a"],"summary":"s","photo_note":"p"}`)
	if err != nil || !tb.Advisory || tb.Risk != "medium" {
		t.Fatalf("trust: %v %+v", err, tb)
	}
	if _, err := ParseTrustBrief(`{"risk":"extreme","reasons":[],"summary":"s","photo_note":"p"}`); err == nil {
		t.Fatalf("bad risk accepted")
	}
	pc, err := ParseProofCheck(`{"verdict":"ok","note":"bag visible"}`)
	if err != nil || pc.Verdict != "ok" {
		t.Fatalf("proof: %v %+v", err, pc)
	}
	if _, err := ParseProofCheck(`{"verdict":"banned","note":"x"}`); err == nil {
		t.Fatalf("bad verdict accepted")
	}
	fl, err := ParseFeedbackLabels(`{"topics":["late","praise"],"abusive":false}`)
	if err != nil || len(fl.Topics) != 2 {
		t.Fatalf("labels: %v %+v", err, fl)
	}
	if _, err := ParseFeedbackLabels(`{"topics":["bogus"],"abusive":false}`); err == nil {
		t.Fatalf("bad topic accepted")
	}
	cr, err := ParseCoachReport(`{"headline":"h","body":"b","next_plan":"p"}`)
	if err != nil || cr.Headline != "h" {
		t.Fatalf("coach: %v %+v", err, cr)
	}
}

// ---------- fallback determinism ----------

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestFallbackDeterminism(t *testing.T) {
	// Same input twice → identical output; distinct photos → stable rotation.
	a1, a2 := FallbackMenu("abc123"), FallbackMenu("abc123")
	if mustJSON(t, a1) != mustJSON(t, a2) {
		t.Fatalf("menu fallback not deterministic")
	}
	b := FallbackMenu("different-photo")
	if mustJSON(t, a1) == mustJSON(t, b) {
		t.Fatalf("expected distinct-photo rotation to differ")
	}
	if mustJSON(t, FallbackTrustBrief(0, true, false)) != mustJSON(t, FallbackTrustBrief(0, true, false)) {
		t.Fatalf("trust fallback not deterministic")
	}
	if mustJSON(t, FallbackFeedbackLabels(5, "thanks!")) != mustJSON(t, FallbackFeedbackLabels(5, "thanks!")) {
		t.Fatalf("labels fallback not deterministic")
	}
	if mustJSON(t, FallbackCoach(5200, 96, 150, 45000, "IDR")) != mustJSON(t, FallbackCoach(5200, 96, 150, 45000, "IDR")) {
		t.Fatalf("coach fallback not deterministic")
	}
	// No-key guardrails: never a price, never an approval, always advisory.
	for _, it := range FallbackMenu("x").Items {
		if it.PriceMinor != nil || !it.PriceUnreadable {
			t.Fatalf("fallback menu must null prices + flag: %+v", it)
		}
	}
	if FallbackProofCheck().Verdict != "unclear" {
		t.Fatalf("offline proof check must stay unclear for humans")
	}
	if !FallbackTrustBrief(9, false, true).Advisory {
		t.Fatalf("trust brief must always be advisory")
	}
}

func TestFallbackTranslatePhrasebook(t *testing.T) {
	got, ok := FallbackTranslate("I'm at the gate", "en", "id")
	if !ok || got != "Saya di gerbang." {
		t.Fatalf("phrasebook miss: %q %v", got, ok)
	}
	if _, ok := FallbackTranslate("some unlisted sentence here", "en", "id"); ok {
		t.Fatalf("unknown phrase must be an unconfident passthrough")
	}
	if !FallbackModerate("kamu bodoh sekali") || FallbackModerate("terima kasih banyak") {
		t.Fatalf("moderation keywords wrong")
	}
}

// ---------- tools + confirmations ----------

func TestToolRegistryRejectsUnknown(t *testing.T) {
	if len(ToolDefs()) != 5 {
		t.Fatalf("expected 5 voice tools, got %d", len(ToolDefs()))
	}
	if _, err := ParseToolCall(ToolCall{Name: "propose_ban_courier"}); err == nil {
		t.Fatalf("unknown tool accepted")
	}
	if _, err := ParseToolCall(ToolCall{Name: ToolAccept, ArgsJSON: "{bad"}); err == nil {
		t.Fatalf("malformed tool args accepted")
	}
	a, err := ParseToolCall(ToolCall{Name: ToolAccept, ArgsJSON: `{"offer_id":"o1"}`})
	if err != nil || a.OfferID != "o1" {
		t.Fatalf("valid tool call rejected: %v", err)
	}
	if IntentForTool(ToolHowFar) != IntentHowFar || IntentForTool("nope") != IntentUnknown {
		t.Fatalf("tool→intent mapping wrong")
	}
}

func TestConfirmationRoundTripAndForgery(t *testing.T) {
	secret := []byte("test-secret-32-chars-minimum!!!!")
	now := time.Now()
	tok := SignConfirmation(secret, "courier-1", "offer-1", string(IntentAccept), now.Add(ConfirmationTTL).Unix())

	if _, err := VerifyConfirmation(secret, tok, "courier-1", "offer-1", now); err != nil {
		t.Fatalf("honest confirmation rejected: %v", err)
	}
	// Forged: wrong secret.
	if _, err := VerifyConfirmation([]byte("attacker-secret-32-chars-minimum!"), tok, "courier-1", "offer-1", now); err == nil {
		t.Fatalf("forged confirmation accepted")
	}
	// Swapped courier or offer.
	if _, err := VerifyConfirmation(secret, tok, "courier-2", "offer-1", now); err == nil {
		t.Fatalf("courier-swapped confirmation accepted")
	}
	if _, err := VerifyConfirmation(secret, tok, "courier-1", "offer-2", now); err == nil {
		t.Fatalf("offer-swapped confirmation accepted")
	}
	// Tampered MAC bytes.
	bad := "00" + tok[2:]
	if _, err := VerifyConfirmation(secret, bad, "courier-1", "offer-1", now); err == nil {
		t.Fatalf("tampered confirmation accepted")
	}
	// Expired.
	if _, err := VerifyConfirmation(secret, tok, "courier-1", "offer-1", now.Add(2*ConfirmationTTL)); err == nil {
		t.Fatalf("expired confirmation accepted")
	}
	// Malformed.
	if _, err := VerifyConfirmation(secret, "garbage", "courier-1", "offer-1", now); err == nil {
		t.Fatalf("malformed confirmation accepted")
	}
	// Non-accept intent smuggled toward the accept path.
	declineTok := SignConfirmation(secret, "courier-1", "offer-1", string(IntentDecline), now.Add(ConfirmationTTL).Unix())
	if _, err := VerifyConfirmation(secret, declineTok, "courier-1", "offer-1", now); err == nil {
		t.Fatalf("decline token usable as accept")
	}
}

// ---------- voice parser ----------

func TestVoiceParserENID(t *testing.T) {
	cases := map[string]VoiceIntent{
		"Accept":                IntentAccept,
		"Ya, terima!":           IntentAccept,
		"Oke gas":               IntentAccept,
		"tolak, nanti dulu":     IntentDecline,
		"No thanks":             IntentDecline,
		"How far to pickup?":    IntentHowFar,
		"Berapa jauh restonya?": IntentHowFar,
		"I'm 2 min away":        IntentEtaSoon,
		"Dua menit sampai":      IntentEtaSoon,
		"OTW sampi... hmm":      IntentEtaSoon,
		"say again please":      IntentRepeat,
		"ulangi dong":           IntentRepeat,
		"what is the weather":   IntentUnknown,
		"":                      IntentUnknown,
	}
	for in, want := range cases {
		if got := ParseVoiceCommand(in); got != want {
			t.Fatalf("ParseVoiceCommand(%q)=%q want %q", in, got, want)
		}
	}
	if DetectLang("berapa jauh?") != "id" || DetectLang("how far?") != "en" {
		t.Fatalf("lang detect wrong")
	}
	if !strings.Contains(VoiceReply(IntentAccept, "id", ReplyCtx{}), "diterima") {
		t.Fatalf("ID reply wrong")
	}
}

// ---------- client without key ----------

func TestClientNoKeyAndCostMath(t *testing.T) {
	c := New(Config{})
	if c.HasKey() {
		t.Fatalf("empty key must report no key")
	}
	if _, err := c.ChatJSON(context.Background(), "t", "v", ModelSpark, "s", "u", "n", map[string]any{}, nil); err != ErrNoKey {
		t.Fatalf("expected ErrNoKey, got %v", err)
	}
	if _, _, err := c.ChatTools(context.Background(), "t", "v", ModelSpark, "s", "u", ToolDefs(), nil); err != ErrNoKey {
		t.Fatalf("expected ErrNoKey for tools, got %v", err)
	}
	// Integer cost math: 1M in + 1M out on Spark = $1.25 + $4.25 = 5.5M micros.
	if got := CostMicros(ModelSpark, 1000000, 1000000); got != 5500000 {
		t.Fatalf("cost math wrong: %d", got)
	}
	if CostMicros("unknown-model", 5, 5) != 0 {
		t.Fatalf("unknown model must cost 0 (unpriced)")
	}
}

func TestPCMToWAVAndStubCrop(t *testing.T) {
	w := PCMToWAV(make([]byte, 4800), 24000)
	if len(w) != 4800+44 || string(w[:4]) != "RIFF" {
		t.Fatalf("bad wav header: %d bytes", len(w))
	}
	b1, _, _ := StubCropper().Crop(context.Background(), CropRequest{FileSHA256: "a", Subject: "dish"})
	b2, _, _ := StubCropper().Crop(context.Background(), CropRequest{FileSHA256: "a", Subject: "dish"})
	if !reflect.DeepEqual(b1, b2) {
		t.Fatalf("stub crop not deterministic")
	}
	if b1.X < 0 || b1.X+b1.Width > 1 || b1.Y < 0 || b1.Y+b1.Height > 1 {
		t.Fatalf("crop box out of bounds: %+v", b1)
	}
	if got := len(DrainPCM(make([]byte, 24000*2*30), []byte{1, 2})); got != 24000*2*30 {
		t.Fatalf("pcm cap failed: %d", got)
	}
}
