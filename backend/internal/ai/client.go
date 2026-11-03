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
	"net/http"
	"strings"
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

// ModelModal is the exact model id served on the Modal endpoint (from the
// Modal dashboard inference curl: "model":
// "meta-models/Muse-Spark-Open-816B-A42B"). The endpoint serves ONLY this
// id — legacy Spark ids 404 there.
const ModelModal = "meta-models/Muse-Spark-Open-816B-A42B"

// DefaultModalBaseURL is the Modal-hosted OpenAI-compatible base URL, FULL
// base including /v1: the SDK appends /chat/completions, matching the Modal
// endpoints-guide curl of .../v1/chat/completions. Proxy auth is one Bearer
// token, "<token-id>.<token-secret>", per that guide — not a header pair and
// not a plain API key, both of which get a non-JSON 401 at the edge that the
// SDK cannot parse (surfacing as the cryptic apierror.Error unmarshal error).
const DefaultModalBaseURL = "https://muhammad099x-work--ep-muse-spark-open-816b-a42b-server.us-west.modal.direct/v1"

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
// fallback-only mode. ModalKey/ModalSecret are the Modal proxy-token ID and
// secret; the client sends them as one Bearer token "<id>.<secret>" (Modal
// endpoints guide). APIKey stays the Meta-direct key for transcription and
// vision, which the Modal endpoint does not serve.
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
	// The SDK appends /chat/completions to BaseURL, so the base must include
	// /v1 (the Modal curl hits .../v1/chat/completions). Accept a bare root
	// too — TF_META_BASE_URL may be set either way — and normalize it.
	c.BaseURL = ensureV1Base(c.BaseURL)
	if c.SparkModel == "" {
		c.SparkModel = ModelSpark
		if c.UsesModal() {
			c.SparkModel = ModelModal
		}
	} else if c.UsesModal() && isLegacySparkID(c.SparkModel) {
		// The Modal endpoint serves exactly one model id (ModelModal);
		// legacy Spark ids 404 there, so map them instead of failing.
		c.SparkModel = ModelModal
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

// ensureV1Base normalizes an OpenAI-compatible base URL: surrounding space
// and trailing slashes go, and a missing /v1 suffix is appended (the SDK
// appends /chat/completions to whatever base it gets).
func ensureV1Base(base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if !strings.HasSuffix(base, "/v1") {
		base += "/v1"
	}
	return base
}

// isLegacySparkID reports model ids the Modal endpoint does not serve: the
// Meta-direct Spark family plus the earlier muse-spark-open default.
func isLegacySparkID(m string) bool {
	return m == ModelSpark || m == "muse-spark-open"
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
	// backup carries hedged duplicates over its own connection pool, so a
	// duplicate never queues behind the connection the first call is stuck on.
	backup openai.Client
}

// newModelHTTPClient is the transport for model calls. HTTP/2 multiplexes
// every request to a host over one connection; when the remote drops it
// silently (Modal recycling a container), every call would hang until its
// deadline. Health pings close such a connection within ~15 s instead.
func newModelHTTPClient() *http.Client {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.HTTP2 = &http.HTTP2Config{SendPingTimeout: 10 * time.Second, PingTimeout: 5 * time.Second}
	return &http.Client{Transport: t}
}

// clientFor picks the backup pool for a hedged duplicate (see Hedge).
func (c *Client) clientFor(ctx context.Context) *openai.Client {
	if IsHedge(ctx) {
		return &c.backup
	}
	return &c.cli
}

// New builds a Client. With no credential the client still builds but every
// live call returns ErrNoKey so workers fall back deterministically. Via
// Modal, auth is one Bearer token "<token-id>.<token-secret>" (Modal
// endpoints guide); a half pair never goes live (see HasKey/UsesModal).
func New(cfg Config) *Client {
	cfg = cfg.withDefaults()
	apiKey := cfg.APIKey
	if cfg.UsesModal() {
		apiKey = cfg.ModalKey + "." + cfg.ModalSecret
	}
	opts := []option.RequestOption{
		option.WithBaseURL(cfg.BaseURL),
		option.WithAPIKey(apiKey),
	}
	with := func(hc *http.Client) []option.RequestOption {
		return append(append([]option.RequestOption{}, opts...), option.WithHTTPClient(hc))
	}
	return &Client{
		cfg:    cfg,
		cli:    openai.NewClient(with(newModelHTTPClient())...),
		backup: openai.NewClient(with(newModelHTTPClient())...),
	}
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

// resolveModel maps legacy Spark ids to the served Modal model when routing
// via Modal (callers may still pass the ModelSpark constant or a stale
// config value). Meta-direct calls pass the model through untouched.
func (c *Client) resolveModel(m string) string {
	if c.cfg.UsesModal() && isLegacySparkID(m) {
		return ModelModal
	}
	return m
}

// errText caps an upstream SDK error for the ai_calls row: the raw text can
// carry response dumps, while the row only needs the signal.
func errText(err error) string {
	s := err.Error()
	if len(s) > 500 {
		s = s[:500] + "…"
	}
	return s
}

// ChatJSON runs one structured-output chat completion and returns the raw
// JSON text. schemaDoc is a JSON-Schema document; name identifies the format.
// The call is always logged via log (nil skips logging, tests only).
func (c *Client) ChatJSON(ctx context.Context, feature, promptVersion, model, system, user string, name string, schemaDoc map[string]any, log CallLogger) (string, error) {
	start := time.Now()
	model = c.resolveModel(model)
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
	resp, err := c.clientFor(ctx).Chat.Completions.New(ctx, params)
	if err != nil {
		done(errText(err))
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
	model = c.resolveModel(model)
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
	resp, err := c.clientFor(ctx).Chat.Completions.New(ctx, params)
	if err != nil {
		done(errText(err))
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
	model = c.resolveModel(model)
	rec := CallRecord{Feature: feature, Model: model, PromptVersion: promptVersion}
	defer func() {
		rec.LatencyMs = time.Since(start).Milliseconds()
		if retErr != nil {
			rec.ErrText = errText(retErr)
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
	resp, err := c.clientFor(ctx).Chat.Completions.New(ctx, params)
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
