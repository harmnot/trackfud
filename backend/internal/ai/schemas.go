package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Validated AI outputs. Every Validate method enforces the dispatch and
// honesty contracts: bounded enums, bounded sizes, and NEVER a model-set
// price or a model-made ban.

var (
	validSizes = map[string]bool{"S": true, "M": true, "L": true}
)

// ---------- Snap-a-Menu ----------

// MenuDraft is one AI-proposed dish. PriceMinor is always nil: the merchant
// types every price. PriceUnreadable flags photos where no price was legible.
type MenuDraft struct {
	ID              string            `json:"id"`
	Name            map[string]string `json:"name"`
	Description     map[string]string `json:"description"`
	PriceMinor      *int64            `json:"price_minor"`
	PriceUnreadable bool              `json:"price_unreadable"`
	SizeClass       string            `json:"size_class"`
	TravelsWell     bool              `json:"travels_well"`
	CategoryHint    string            `json:"category_hint"`
	Confident       bool              `json:"confident"`
	CropBox         *CropBox          `json:"crop_box,omitempty"`
}

// MenuOutput is the validated menu-import result.
type MenuOutput struct {
	Items []MenuDraft `json:"items"`
}

// MenuSchema is the strict JSON-Schema sent with the request.
func MenuSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"items": map[string]any{
				"type": "array", "minItems": 1, "maxItems": 40,
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"name":             map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}},
						"description":      map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}},
						"size_class":       map[string]any{"type": "string", "enum": []string{"S", "M", "L"}},
						"travels_well":     map[string]any{"type": "boolean"},
						"category_hint":    map[string]any{"type": "string"},
						"confident":        map[string]any{"type": "boolean"},
						"price_unreadable": map[string]any{"type": "boolean"},
					},
					"required":             []string{"name", "size_class", "travels_well"},
					"additionalProperties": false,
				},
			},
		},
		"required":             []string{"items"},
		"additionalProperties": false,
	}
}

// ParseMenuOutput validates raw model JSON. Any price the model tried to
// sneak in (the schema has no price field, but be strict) is dropped and
// flagged: AI output can never become a price.
func ParseMenuOutput(raw string) (MenuOutput, error) {
	var loose struct {
		Items []struct {
			MenuDraft
			PriceMinor any `json:"price_minor"`
		} `json:"items"`
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	if err := dec.Decode(&loose); err != nil {
		return MenuOutput{}, fmt.Errorf("menu output is not valid JSON: %w", err)
	}
	if len(loose.Items) == 0 || len(loose.Items) > 40 {
		return MenuOutput{}, errors.New("menu output must list 1-40 items")
	}
	out := MenuOutput{}
	for i, it := range loose.Items {
		d := it.MenuDraft
		if !validSizes[d.SizeClass] {
			return MenuOutput{}, fmt.Errorf("item %d: bad size_class %q", i, d.SizeClass)
		}
		if len(d.Name) == 0 {
			return MenuOutput{}, fmt.Errorf("item %d: name missing", i)
		}
		for lang, s := range d.Name {
			if len(s) > 120 {
				return MenuOutput{}, fmt.Errorf("item %d: name[%s] too long", i, lang)
			}
		}
		// Hard honesty rule: drop any price, always flag unreadable when the
		// model emitted one (it was told not to).
		if it.PriceMinor != nil {
			d.PriceUnreadable = true
		}
		d.PriceMinor = nil
		if d.Description == nil {
			d.Description = map[string]string{}
		}
		out.Items = append(out.Items, d)
	}
	return out, nil
}

// ---------- Translate + moderate ----------

// TranslateOutput is one validated translation.
type TranslateOutput struct {
	Text        string `json:"text"`
	FlagAbusive bool   `json:"flag_abusive"`
}

func TranslateSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"text":         map[string]any{"type": "string"},
			"flag_abusive": map[string]any{"type": "boolean"},
		},
		"required": []string{"text", "flag_abusive"},
	}
}

// ParseTranslateOutput validates raw model JSON (max 1000 chars out).
func ParseTranslateOutput(raw string) (TranslateOutput, error) {
	var o TranslateOutput
	if err := json.Unmarshal([]byte(raw), &o); err != nil {
		return TranslateOutput{}, fmt.Errorf("translate output is not valid JSON: %w", err)
	}
	if len(o.Text) == 0 || len(o.Text) > 1000 {
		return TranslateOutput{}, errors.New("translate output must be 1-1000 chars")
	}
	return o, nil
}

// ---------- Trust Brief (advisory only) ----------

// TrustBrief is the validated advisory summary. Advisory is always true:
// the admin decides, the model never bans.
type TrustBrief struct {
	Advisory  bool     `json:"advisory"`
	Risk      string   `json:"risk"`
	Reasons   []string `json:"reasons"`
	Summary   string   `json:"summary"`
	PhotoNote string   `json:"photo_note"`
}

func TrustSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"risk":       map[string]any{"type": "string", "enum": []string{"low", "medium", "high"}},
			"reasons":    map[string]any{"type": "array", "maxItems": 5, "items": map[string]any{"type": "string"}},
			"summary":    map[string]any{"type": "string"},
			"photo_note": map[string]any{"type": "string"},
		},
		"required": []string{"risk", "reasons", "summary", "photo_note"},
	}
}

// ParseTrustBrief validates raw model JSON and forces advisory=true.
func ParseTrustBrief(raw string) (TrustBrief, error) {
	var o TrustBrief
	if err := json.Unmarshal([]byte(raw), &o); err != nil {
		return TrustBrief{}, fmt.Errorf("trust brief is not valid JSON: %w", err)
	}
	switch o.Risk {
	case "low", "medium", "high":
	default:
		return TrustBrief{}, fmt.Errorf("bad risk %q", o.Risk)
	}
	if len(o.Reasons) > 5 || len(o.Summary) == 0 || len(o.Summary) > 2000 {
		return TrustBrief{}, errors.New("trust brief reasons/summary out of bounds")
	}
	o.Advisory = true
	return o, nil
}

// ---------- Proof check ----------

// ProofCheck is the validated delivery-photo verdict.
type ProofCheck struct {
	Verdict string `json:"verdict"`
	Note    string `json:"note"`
}

func ProofSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"verdict": map[string]any{"type": "string", "enum": []string{"ok", "unclear", "missing_item"}},
			"note":    map[string]any{"type": "string"},
		},
		"required": []string{"verdict", "note"},
	}
}

// ParseProofCheck validates raw model JSON.
func ParseProofCheck(raw string) (ProofCheck, error) {
	var o ProofCheck
	if err := json.Unmarshal([]byte(raw), &o); err != nil {
		return ProofCheck{}, fmt.Errorf("proof check is not valid JSON: %w", err)
	}
	switch o.Verdict {
	case "ok", "unclear", "missing_item":
	default:
		return ProofCheck{}, fmt.Errorf("bad verdict %q", o.Verdict)
	}
	if len(o.Note) > 500 {
		return ProofCheck{}, errors.New("proof note too long")
	}
	return o, nil
}

// ---------- Feedback labels ----------

var validTopics = map[string]bool{
	"late": true, "cold_food": true, "spilled": true, "rude": true,
	"wrong_item": true, "praise": true, "other": true,
}

// FeedbackLabels is the validated rating-topic result.
type FeedbackLabels struct {
	Topics  []string `json:"topics"`
	Abusive bool     `json:"abusive"`
}

func LabelsSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"topics":  map[string]any{"type": "array", "maxItems": 4, "items": map[string]any{"type": "string"}},
			"abusive": map[string]any{"type": "boolean"},
		},
		"required": []string{"topics", "abusive"},
	}
}

// ParseFeedbackLabels validates raw model JSON.
func ParseFeedbackLabels(raw string) (FeedbackLabels, error) {
	var o FeedbackLabels
	if err := json.Unmarshal([]byte(raw), &o); err != nil {
		return FeedbackLabels{}, fmt.Errorf("feedback labels are not valid JSON: %w", err)
	}
	if len(o.Topics) > 4 {
		return FeedbackLabels{}, errors.New("too many topics")
	}
	for _, t := range o.Topics {
		if !validTopics[t] {
			return FeedbackLabels{}, fmt.Errorf("bad topic %q", t)
		}
	}
	return o, nil
}

// ---------- Coach report ----------

// CoachReport is the validated weekly coach text (labeled not-medical-advice
// by the API, never a diagnosis).
type CoachReport struct {
	Headline string `json:"headline"`
	Body     string `json:"body"`
	NextPlan string `json:"next_plan"`
}

func CoachSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"headline":  map[string]any{"type": "string"},
			"body":      map[string]any{"type": "string"},
			"next_plan": map[string]any{"type": "string"},
		},
		"required": []string{"headline", "body", "next_plan"},
	}
}

// ParseCoachReport validates raw model JSON.
func ParseCoachReport(raw string) (CoachReport, error) {
	var o CoachReport
	if err := json.Unmarshal([]byte(raw), &o); err != nil {
		return CoachReport{}, fmt.Errorf("coach report is not valid JSON: %w", err)
	}
	if len(o.Headline) == 0 || len(o.Headline) > 140 || len(o.Body) == 0 || len(o.Body) > 2000 || len(o.NextPlan) > 500 {
		return CoachReport{}, errors.New("coach report fields out of bounds")
	}
	return o, nil
}
