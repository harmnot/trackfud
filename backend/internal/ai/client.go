// Package ai is the single gateway to model serving (Milestone B6):
// chat/text calls go to the Modal-hosted endpoint by default, with the
// Meta Model API direct as the env-override fallback.
//
// All model calls run on the server; keys never reach the browser.
// Every call is reported to a CallLogger so the app layer can persist an
// ai_calls row (feature, model, latency, tokens, cost). When no credential
// is configured (or quota/upstream fails), callers use the deterministic
// fallbacks in fallback.go so the demo works offline.
package ai

import (
	"context"
	"errors"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/shared"
)

// Model IDs (Meta Model API, OpenAI-compatible wire format).
const (
	ModelSpark       = "muse-spark-1.3"
	ModelContributor = "muse-spark-1.3-contributor"
	ModelTranscribe  = "muse-voice-transcribe-1.0"
	ModelSAM         = "sam-3.1"
)

// DefaultBaseURL is the Meta Model API endpoint (direct fallback).
const DefaultBaseURL = "https://api.meta.ai/v1"

// DefaultModalBaseURL is the Modal-hosted OpenAI-compatible endpoint that
// serves chat/text calls. Modal enforces proxy auth at the edge via the
// Modal-Key / Modal-Secret header pair, so plain Bearer auth alone gets a
// 401 before any route runs.
const DefaultModalBaseURL = "https://muhammad099x-work--ep-muse-spark-open-816b-a42b-server.us-west.modal.direct"

// Price table: micro-USD per 1M tokens (integers only, never floats).
// Spark: $1.25 in / $4.25 out; contributor: $0.10 / $0.20 per 1M.
var pricePerMTokens = map[string][2]int64{
	ModelSpark:       {1250000, 4250000},
	ModelContributor: {100000, 200000},
}

// ErrNoKey means no model credential is configured: use a cached fallback.
var ErrNoKey = errors.New("ai: no model credential configured")

// UpstreamError wraps a Meta API failure; Retryable tells the jobs worker
// whether re-running later could succeed (5xx/429) or not (4xx/schema).
type UpstreamError struct {
	Op        string
	Err       error
	Retryable bool
}

func (e *UpstreamError) Error() string { return "ai " + e.Op + ": " + e.Err.Error() }
func (e *UpstreamError) Unwrap() error { return e.Err }

// Config wires the client. Empty APIKey with an empty Modal pair selects
// fallback-only mode. The Modal proxy-token pair (Modal-Key / Modal-Secret)
// is the credential for the Modal-hosted endpoint; APIKey stays as the
// Meta-direct key and passes through as Bearer for inner services.
type Config struct {
	APIKey           string
	ModalKey         string
	ModalSecret      string
	BaseURL          string
	SparkModel       string
	ContributorModel string
	TranscribeModel  string
	SAMModel         string
}

// UsesModal reports whether chat/text calls route to the Modal endpoint
// (explicit pair present). Transcription and SAM vision are NOT served by
// that endpoint: they stay on Meta direct (APIKey) or deterministic
// fallbacks.
func (c Config) UsesModal() bool { return c.ModalKey != "" && c.ModalSecret != "" }

func (c Config) withDefaults() Config {
	if c.BaseURL == "" {
		if c.UsesModal() {
			c.BaseURL = DefaultModalBaseURL
		}
		if c.BaseURL == "" {
			c.BaseURL = DefaultBaseURL
		}
	}
	if c.SparkModel == "" {
		c.SparkModel = ModelSpark
	}
	if c.ContributorModel == "" {
		c.ContributorModel = ModelContributor
	}
	if c.TranscribeModel == "" {
		c.TranscribeModel = ModelTranscribe
	}
	if c.SAMModel == "" {
		c.SAMModel = ModelSAM
	}
	return c
}

// CallRecord describes one model call for the ai_calls log.
type CallRecord struct {
	Feature       string
	Model         string
	PromptVersion string
	LatencyMs     int64
	InputTokens   int64
	OutputTokens  int64
	// CostMicros is the estimated price in micro-USD (integer math).
	CostMicros int64
	Fallback   bool
	ErrText    string
}

// CostMicros estimates the price of a call from the price table.
func CostMicros(model string, inTokens, outTokens int64) int64 {
	p, ok := pricePerMTokens[model]
	if !ok {
		return 0
	}
	return (inTokens*p[0] + outTokens*p[1]) / 1000000
}

// CallLogger persists one CallRecord; the app layer stores ai_calls rows.
type CallLogger func(ctx context.Context, rec CallRecord)

// Client talks to the Meta Model API through the OpenAI-compatible SDK.
type Client struct {
	cfg Config
	cli openai.Client
}

// New builds a Client. With no credential the client still builds but every
// live call returns ErrNoKey so workers fall back deterministically.
func New(cfg Config) *Client {
	cfg = cfg.withDefaults()
	opts := []option.RequestOption{
		option.WithBaseURL(cfg.BaseURL),
		option.WithAPIKey(cfg.APIKey),
	}
	if cfg.UsesModal() {
		// Modal proxy auth: header pair, not Bearer. Authorization is left
		// free for the inner service behind the proxy.
		opts = append(opts,
			option.WithHeader("Modal-Key", cfg.ModalKey),
			option.WithHeader("Modal-Secret", cfg.ModalSecret),
		)
	}
	return &Client{cfg: cfg, cli: openai.NewClient(opts...)}
}

// HasKey reports whether live model calls are possible: Meta key or the
// full Modal proxy-token pair.
func (c *Client) HasKey() bool { return c.cfg.APIKey != "" || c.cfg.UsesModal() }

// UsesModal reports whether this client routes through the Modal endpoint.
func (c *Client) UsesModal() bool { return c.cfg.UsesModal() }

// SparkModel returns the configured Spark model ID.
func (c *Client) SparkModel() string { return c.cfg.SparkModel }

// ContributorModel returns the cheap model ID (own UI strings only).
func (c *Client) ContributorModel() string { return c.cfg.ContributorModel }

// TranscribeModel returns the voice model ID.
func (c *Client) TranscribeModel() string { return c.cfg.TranscribeModel }

// SAMModel returns the segmentation model ID.
func (c *Client) SAMModel() string { return c.cfg.SAMModel }

// BaseURL returns the configured API base URL (for the SAM helper).
func (c *Client) BaseURL() string { return c.cfg.BaseURL }

// APIKey returns the key for raw HTTP helpers (SAM). It must never be sent
// to a browser; only server-side helpers may call this.
func (c *Client) APIKey() string { return c.cfg.APIKey }

// ChatJSON runs one structured-output chat completion and returns the raw
// JSON text. schemaDoc is a JSON-Schema document; name identifies the format.
// The call is always logged via log (nil skips logging, tests only).
func (c *Client) ChatJSON(ctx context.Context, feature, promptVersion, model, system, user string, name string, schemaDoc map[string]any, log CallLogger) (string, error) {
	start := time.Now()
	rec := CallRecord{Feature: feature, Model: model, PromptVersion: promptVersion}
	done := func(errText string) {
		rec.LatencyMs = time.Since(start).Milliseconds()
		rec.ErrText = errText
		if log != nil {
			log(ctx, rec)
		}
	}
	if !c.HasKey() {
		done(ErrNoKey.Error())
		return "", ErrNoKey
	}
	params := openai.ChatCompletionNewParams{
		Model:    openai.ChatModel(model),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.SystemMessage(system), openai.UserMessage(user)},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &shared.ResponseFormatJSONSchemaParam{
				JSONSchema: shared.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:   name,
					Strict: openai.Bool(true),
					Schema: schemaDoc,
				},
			},
		},
		Temperature: openai.Float(0),
	}
	resp, err := c.cli.Chat.Completions.New(ctx, params)
	if err != nil {
		done(err.Error())
		return "", &UpstreamError{Op: feature, Err: err, Retryable: true}
	}
	rec.InputTokens = resp.Usage.PromptTokens
	rec.OutputTokens = resp.Usage.CompletionTokens
	rec.CostMicros = CostMicros(model, rec.InputTokens, rec.OutputTokens)
	if len(resp.Choices) == 0 {
		done("empty choices")
		return "", &UpstreamError{Op: feature, Err: errors.New("empty choices"), Retryable: true}
	}
	done("")
	return resp.Choices[0].Message.Content, nil
}

// ChatVisionJSON runs one structured-output completion with a single image
// (base64 data URL) plus text. Used by Snap-a-Menu and proof check.
func (c *Client) ChatVisionJSON(ctx context.Context, feature, promptVersion, model, system, text, imageDataURL string, name string, schemaDoc map[string]any, log CallLogger) (string, error) {
	start := time.Now()
	rec := CallRecord{Feature: feature, Model: model, PromptVersion: promptVersion}
	done := func(errText string) {
		rec.LatencyMs = time.Since(start).Milliseconds()
		rec.ErrText = errText
		if log != nil {
			log(ctx, rec)
		}
	}
	if !c.HasKey() {
		done(ErrNoKey.Error())
		return "", ErrNoKey
	}
	params := openai.ChatCompletionNewParams{
		Model: openai.ChatModel(model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(system),
			openai.UserMessage([]openai.ChatCompletionContentPartUnionParam{
				openai.TextContentPart(text),
				openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{URL: imageDataURL}),
			}),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &shared.ResponseFormatJSONSchemaParam{
				JSONSchema: shared.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:   name,
					Strict: openai.Bool(true),
					Schema: schemaDoc,
				},
			},
		},
		Temperature: openai.Float(0),
	}
	resp, err := c.cli.Chat.Completions.New(ctx, params)
	if err != nil {
		done(err.Error())
		return "", &UpstreamError{Op: feature, Err: err, Retryable: true}
	}
	rec.InputTokens = resp.Usage.PromptTokens
	rec.OutputTokens = resp.Usage.CompletionTokens
	rec.CostMicros = CostMicros(model, rec.InputTokens, rec.OutputTokens)
	if len(resp.Choices) == 0 {
		done("empty choices")
		return "", &UpstreamError{Op: feature, Err: errors.New("empty choices"), Retryable: true}
	}
	done("")
	return resp.Choices[0].Message.Content, nil
}

// ChatTools runs one tool-calling completion for the Voice Copilot and
// returns the model's reply plus any requested tool calls.
func (c *Client) ChatTools(ctx context.Context, feature, promptVersion, model, system, user string, tools []openai.ChatCompletionToolUnionParam, log CallLogger) (reply string, calls []ToolCall, retErr error) {
	start := time.Now()
	rec := CallRecord{Feature: feature, Model: model, PromptVersion: promptVersion}
	defer func() {
		rec.LatencyMs = time.Since(start).Milliseconds()
		if retErr != nil {
			rec.ErrText = retErr.Error()
		}
		if log != nil {
			log(ctx, rec)
		}
	}()
	if !c.HasKey() {
		retErr = ErrNoKey
		return "", nil, retErr
	}
	params := openai.ChatCompletionNewParams{
		Model:       openai.ChatModel(model),
		Messages:    []openai.ChatCompletionMessageParamUnion{openai.SystemMessage(system), openai.UserMessage(user)},
		Tools:       tools,
		Temperature: openai.Float(0),
	}
	resp, err := c.cli.Chat.Completions.New(ctx, params)
	if err != nil {
		retErr = &UpstreamError{Op: feature, Err: err, Retryable: true}
		return "", nil, retErr
	}
	rec.InputTokens = resp.Usage.PromptTokens
	rec.OutputTokens = resp.Usage.CompletionTokens
	rec.CostMicros = CostMicros(model, rec.InputTokens, rec.OutputTokens)
	if len(resp.Choices) == 0 {
		retErr = &UpstreamError{Op: feature, Err: errors.New("empty choices"), Retryable: true}
		return "", nil, retErr
	}
	msg := resp.Choices[0].Message
	for _, tc := range msg.ToolCalls {
		calls = append(calls, ToolCall{Name: tc.Function.Name, ArgsJSON: tc.Function.Arguments})
	}
	return msg.Content, calls, nil
}
