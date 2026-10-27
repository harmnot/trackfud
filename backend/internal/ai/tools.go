package ai

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/shared"
)

// Tool registry for the Voice Copilot. Tools only PROPOSE actions: the model
// returns a tool call, the server re-checks ownership/expiry/state, and only
// then executes. A forged or replayed confirmation never executes.

// Tool names (single registry; the voice endpoint serves these for transparency).
const (
	ToolAccept  = "propose_accept"
	ToolDecline = "propose_decline"
	ToolHowFar  = "propose_how_far"
	ToolEtaSoon = "propose_eta_soon"
	ToolRepeat  = "propose_repeat"
)

// ToolDefs returns the Spark function definitions (JSON Schema params).
func ToolDefs() []openai.ChatCompletionToolUnionParam {
	def := func(name, desc string) openai.ChatCompletionToolUnionParam {
		return openai.ChatCompletionFunctionTool(shared.FunctionDefinitionParam{
			Name:        name,
			Description: openai.String(desc),
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"offer_id": map[string]any{"type": "string", "description": "Offer UUID when the courier refers to a specific offer; empty means the latest pending offer."},
				},
				"additionalProperties": false,
			},
		})
	}
	return []openai.ChatCompletionToolUnionParam{
		def(ToolAccept, "Propose accepting the courier's pending delivery offer."),
		def(ToolDecline, "Propose declining the pending offer (no penalty)."),
		def(ToolHowFar, "Propose answering how far the restaurant or customer is."),
		def(ToolEtaSoon, "Propose telling the customer the courier is 2 minutes away."),
		def(ToolRepeat, "Propose repeating the last offer details."),
	}
}

// ToolCall is one model-requested tool invocation.
type ToolCall struct {
	Name     string
	ArgsJSON string
}

// ToolArgs are the decoded arguments of a tool call.
type ToolArgs struct {
	OfferID string `json:"offer_id"`
}

// ParseToolCall validates that a model tool call names a registered tool and
// carries well-formed args. Unknown tools are rejected, never executed.
func ParseToolCall(tc ToolCall) (ToolArgs, error) {
	switch tc.Name {
	case ToolAccept, ToolDecline, ToolHowFar, ToolEtaSoon, ToolRepeat:
	default:
		return ToolArgs{}, fmt.Errorf("unknown tool %q", tc.Name)
	}
	var a ToolArgs
	if strings.TrimSpace(tc.ArgsJSON) != "" {
		if err := json.Unmarshal([]byte(tc.ArgsJSON), &a); err != nil {
			return ToolArgs{}, fmt.Errorf("bad tool args: %w", err)
		}
	}
	return a, nil
}

// IntentForTool maps a validated tool call to a voice intent.
func IntentForTool(name string) VoiceIntent {
	switch name {
	case ToolAccept:
		return IntentAccept
	case ToolDecline:
		return IntentDecline
	case ToolHowFar:
		return IntentHowFar
	case ToolEtaSoon:
		return IntentEtaSoon
	case ToolRepeat:
		return IntentRepeat
	default:
		return IntentUnknown
	}
}

// ---------- Server-checked confirmations ----------

// ConfirmationTTL bounds how long an accept proposal stays executable.
const ConfirmationTTL = 60 * time.Second

// SignConfirmation mints an HMAC token binding courier+offer+intent+expiry.
// The voice endpoint returns it with an accept proposal; the confirm endpoint
// verifies it before touching acceptCore.
func SignConfirmation(secret []byte, courierID, offerID, intent string, expUnix int64) string {
	msg := courierID + "|" + offerID + "|" + intent + "|" + strconv.FormatInt(expUnix, 10)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(msg))
	return hex.EncodeToString(mac.Sum(nil)) + "." + strconv.FormatInt(expUnix, 10)
}

// Confirmed is a verified confirmation.
type Confirmed struct {
	CourierID string
	OfferID   string
	Intent    string
}

// VerifyConfirmation checks MAC, intent, courier binding, and expiry. Any
// mismatch — forged token, wrong courier, wrong offer, expired, or a
// non-accept intent smuggled into the accept path — is rejected.
func VerifyConfirmation(secret []byte, token, wantCourierID, wantOfferID string, now time.Time) (Confirmed, error) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return Confirmed{}, errors.New("bad confirmation shape")
	}
	macHex, expStr := parts[0], parts[1]
	expUnix, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || now.Unix() > expUnix {
		return Confirmed{}, errors.New("confirmation expired")
	}
	// Accept proposals are the only executable intent; anything else that
	// reaches the confirm endpoint is a forgery attempt.
	msg := wantCourierID + "|" + wantOfferID + "|" + string(IntentAccept) + "|" + expStr
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(msg))
	want := mac.Sum(nil)
	got, err := hex.DecodeString(macHex)
	if err != nil || subtle.ConstantTimeCompare(got, want) != 1 {
		return Confirmed{}, errors.New("confirmation rejected")
	}
	return Confirmed{CourierID: wantCourierID, OfferID: wantOfferID, Intent: string(IntentAccept)}, nil
}
