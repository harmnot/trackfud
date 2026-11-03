// Package app — Paddle sandbox checkout (B5 money path).
//
// The customer PWA used to open Paddle.Checkout with an ad-hoc `amount` and
// no price, which Paddle Billing rejects with `required price_id`. Paddle
// Billing checkouts need either a pre-created price or — for arbitrary
// wallet top-up / order totals — a server-created transaction opened by id:
//
//	create pending payment (POST /customer/wallet/topups or POST /customer/orders card)
//	→ POST /customer/payments/{id}/checkout (this file, needs TF_PADDLE_API_KEY)
//	→ Paddle.Checkout.open({ transactionId }) in the PWA
//	→ POST /webhooks/paddle (transaction.completed, HMAC-verified) credits/applies
//
// Card data never touches our code: the PWA renders the Paddle overlay, we
// only create the transaction server-side (embedding custom_data.payment_id
// so the webhook can map back to our payments row) and confirm via webhook.
// Demo mode keeps working through POST /dev/payments/{id}/simulate-paid with
// no Paddle credentials.
package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"Trackfud/internal/ledger"
)

// paddleAPIBase returns the Paddle API base for the configured env.
// Sandbox and production are separate hosts with separate keys/tokens; the
// env must match the dashboard app the webhook secret and client token come
// from (see backend/.env.example).
func paddleAPIBase(env string) string {
	if strings.ToLower(strings.TrimSpace(env)) == "production" {
		return "https://api.paddle.com"
	}
	return "https://sandbox-api.paddle.com"
}

// paddleCheckoutCurrencies is the exact currency allowlist the Paddle
// Transactions API enforces (verified live against sandbox 2026-11-03 —
// notably WITHOUT IDR, AED, PHP, MYR, which the looser payout set in fx.go
// still lists). Charging anything else fails at Paddle with `must be one of
// ...`, so the checkout endpoint rejects it up front with a 422 that tells
// the customer what to do instead.
var paddleCheckoutCurrencies = map[string]bool{
	"ARS": true, "AUD": true, "BRL": true, "CAD": true, "CHF": true,
	"CLP": true, "CNY": true, "COP": true, "CZK": true, "DKK": true,
	"EUR": true, "GBP": true, "HKD": true, "HUF": true, "ILS": true,
	"INR": true, "JPY": true, "KRW": true, "MXN": true, "NOK": true,
	"NZD": true, "PEN": true, "PLN": true, "RUB": true, "SEK": true,
	"SGD": true, "THB": true, "TRY": true, "TWD": true, "UAH": true,
	"USD": true, "VND": true, "ZAR": true,
}

// ErrPaddleCurrencyUnsupported marks a checkout currency Paddle cannot
// charge; the handler maps it to 422 (not 502 — our side is fine, the
// request simply cannot go through Paddle).
var ErrPaddleCurrencyUnsupported = errors.New("money: Paddle cannot charge this currency")

// paddleCheckoutRequest is the minimal Paddle Transactions create payload we
// send: one inline price for the exact pending amount (arbitrary totals have
// no pre-created price_id), plus our payment id in custom_data so the
// webhook maps back without trusting any client-supplied field.
type paddleCheckoutRequest struct {
	Items []paddleCheckoutItem `json:"items"`
	// CustomData carries our payments.id through Paddle into the webhook.
	CustomData map[string]string `json:"custom_data"`
	// CollectionMode automatic collects payment immediately at checkout.
	CollectionMode string `json:"collection_mode,omitempty"`
}

type paddleCheckoutItem struct {
	Price    paddleInlinePrice `json:"price"`
	Quantity int               `json:"quantity"`
}

type paddleInlinePrice struct {
	Description string `json:"description"`
	Name        string `json:"name,omitempty"`
	// BillingCycle nil marshals to explicit JSON null: a one-time
	// (non-recurring) price. A transaction item is oneOf catalog price_id /
	// non-catalog price, and the non-catalog branch needs a full price
	// object — without the inline product Paddle answers `price_id is
	// required` (seen live 2026-11-03).
	BillingCycle *paddleBillingCycle `json:"billing_cycle"`
	TrialPeriod  *paddleTrialPeriod  `json:"trial_period"`
	UnitPrice    paddleUnitPrice     `json:"unit_price"`
	Product      paddleInlineProduct `json:"product"`
}

type paddleBillingCycle struct {
	Interval  string `json:"interval"`
	Frequency int    `json:"frequency"`
}

type paddleTrialPeriod struct {
	Interval  string `json:"interval"`
	Frequency int    `json:"frequency"`
}

// paddleInlineProduct is the inline non-catalog product: name + tax_category
// are required (standard covers food top-ups and order totals).
type paddleInlineProduct struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	TaxCategory string `json:"tax_category"`
}

type paddleUnitPrice struct {
	// Amount is minor units as a decimal string (e.g. "50000" IDR, "2230" USD cents).
	Amount       string `json:"amount"`
	CurrencyCode string `json:"currency_code"`
}

// paddleTxnResponse is the subset of the Paddle transaction we need.
type paddleTxnResponse struct {
	Data struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	} `json:"data"`
}

// createPaddleTransaction creates a Paddle transaction for a pending payment.
// It is a pure HTTP call (no DB) so tests can cover validation without keys.
func createPaddleTransaction(ctx context.Context, client *http.Client, apiBase, apiKey string, paymentID string, amountMinor int64, currency, description string) (string, error) {
	if strings.TrimSpace(apiKey) == "" {
		return "", fmt.Errorf("paddle API key not configured")
	}
	if amountMinor <= 0 {
		return "", fmt.Errorf("amount_minor must be positive")
	}
	cur := strings.ToUpper(strings.TrimSpace(currency))
	if !validCurrency(cur) {
		return "", fmt.Errorf("currency must be a 3-letter ISO code")
	}
	if !paddleCheckoutCurrencies[cur] {
		return "", fmt.Errorf("%w: %s is not chargeable through Paddle (try USD, or demo mode)", ErrPaddleCurrencyUnsupported, cur)
	}
	if strings.TrimSpace(paymentID) == "" {
		return "", fmt.Errorf("payment id is required")
	}
	if strings.TrimSpace(description) == "" {
		description = "Trackfud wallet top-up"
	}
	reqBody, _ := json.Marshal(paddleCheckoutRequest{
		Items: []paddleCheckoutItem{{
			Price: paddleInlinePrice{
				Description:  description,
				Name:         description,
				BillingCycle: nil, // explicit null: one-time price
				TrialPeriod:  nil,
				UnitPrice: paddleUnitPrice{
					Amount:       strconv.FormatInt(amountMinor, 10),
					CurrencyCode: cur,
				},
				Product: paddleInlineProduct{
					Name:        description,
					TaxCategory: "standard",
				},
			},
			Quantity: 1,
		}},
		CustomData:     map[string]string{"payment_id": paymentID},
		CollectionMode: "automatic",
	})
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(apiBase, "/")+"/transactions", bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("paddle transaction create failed: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxWebhookBody))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Never log the key; the body may carry Paddle's error detail which is
		// safe to surface (it contains no secret).
		return "", fmt.Errorf("paddle transaction create failed: status %d: %s", resp.StatusCode, truncatePaddleErr(raw))
	}
	var parsed paddleTxnResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", fmt.Errorf("paddle transaction response invalid: %w", err)
	}
	if strings.TrimSpace(parsed.Data.ID) == "" {
		return "", fmt.Errorf("paddle transaction response missing id")
	}
	return parsed.Data.ID, nil
}

func truncatePaddleErr(raw []byte) string {
	s := strings.TrimSpace(string(raw))
	if len(s) > 300 {
		return s[:300] + "…"
	}
	if s == "" {
		return "empty response"
	}
	return s
}

// paddleHTTPClient is shared (timeouts bound the checkout call).
var paddleHTTPClient = &http.Client{Timeout: 10 * time.Second}

// createPaymentCheckout mints a Paddle transaction for one pending payment
// owned by the caller: POST /v1/customer/payments/{id}/checkout.
// Returns { transaction_id, paddle_env, payment } for the PWA overlay.
func (s *Server) createPaymentCheckout(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	if !s.cardPaymentsEnabled() {
		problem(w, 503, "Unavailable", "card payments are disabled: Paddle sandbox only")
		return
	}
	paymentID := strings.TrimSpace(r.PathValue("id"))
	if paymentID == "" {
		problem(w, 400, "Validation failed", "payment id is required")
		return
	}
	p, err := scanPayment(s.db.QueryRow(r.Context(), `SELECT `+paymentCols+` FROM payments WHERE id=$1`, paymentID))
	if err != nil {
		problem(w, 404, "Not found", "payment not found")
		return
	}
	isAdmin := false
	for _, rl := range c.Roles {
		if rl == "admin" {
			isAdmin = true
		}
	}
	if p.UserID != c.Sub && !isAdmin {
		problem(w, 403, "Forbidden", "not your payment")
		return
	}
	if p.Status != "pending" {
		problem(w, 409, "Conflict", "payment is already "+p.Status)
		return
	}
	if s.cfg.PaddleAPIKey == "" {
		problem(w, 503, "Unavailable", "Paddle API key not configured: finish in demo mode (POST /dev/payments/{id}/simulate-paid) or set TF_PADDLE_API_KEY")
		return
	}
	// Reuse an already-minted transaction for this payment (idempotent retry:
	// creating a second Paddle transaction for the same payment would double
	// the customer's checkout options, never the charge — the webhook still
	// pays once — but one transaction per payment keeps support sane).
	if p.PaddleTxnID != nil && strings.TrimSpace(*p.PaddleTxnID) != "" {
		writeJSON(w, 200, map[string]any{
			"transaction_id": *p.PaddleTxnID,
			"paddle_env":     s.cfg.PaddleEnv,
			"payment":        paymentView(p),
		})
		return
	}
	desc := "Trackfud wallet top-up"
	if p.Kind == "order" {
		desc = "Trackfud food order"
	}
	// Quote the charge: same currency when Paddle supports it, else convert
	// to USD at the fx_rates rate and lock the quote on the payment row, so a
	// retried checkout reuses identical numbers and the webhook credits the
	// full original-currency amount (the PWA shows the conversion up front).
	chargeMinor, chargeCur := p.AmountMinor, p.Currency
	if qMinor, qCur, ok := p.fxQuote(); ok {
		chargeMinor, chargeCur = qMinor, qCur
	} else if !paddleCheckoutCurrencies[p.Currency] {
		rate, _, _, ok := s.resolveRate(r.Context(), p.Currency, "USD")
		if !ok {
			problem(w, 422, "Unprocessable", "no conversion rate for "+p.Currency+" to USD: pay in USD or finish in demo mode")
			return
		}
		chargeMinor = ledger.ConvertMinor(p.AmountMinor, p.Currency, "USD", rate)
		if chargeMinor <= 0 {
			problem(w, 422, "Unprocessable", "amount too small to convert to a USD charge")
			return
		}
		if _, err := s.db.Exec(r.Context(), `UPDATE payments SET charge_currency='USD',
			charge_amount_minor=$2, fx_rate=$3, updated_at=now() WHERE id=$1 AND status='pending'`,
			p.ID, chargeMinor, rate); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
		chargeCur = "USD"
	}
	txnID, err := createPaddleTransaction(r.Context(), paddleHTTPClient, paddleAPIBase(s.cfg.PaddleEnv), s.cfg.PaddleAPIKey, p.ID, chargeMinor, chargeCur, desc)
	if err != nil {
		if errors.Is(err, ErrPaddleCurrencyUnsupported) {
			problem(w, 422, "Unprocessable", err.Error())
			return
		}
		problem(w, 502, "Upstream error", err.Error())
		return
	}
	if _, err := s.db.Exec(r.Context(), `UPDATE payments SET paddle_txn_id=$2, updated_at=now() WHERE id=$1 AND status='pending'`, p.ID, txnID); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	updated, _ := scanPayment(s.db.QueryRow(r.Context(), `SELECT `+paymentCols+` FROM payments WHERE id=$1`, p.ID))
	writeJSON(w, 201, map[string]any{
		"transaction_id": txnID,
		"paddle_env":     s.cfg.PaddleEnv,
		"payment":        paymentView(updated),
	})
}

// getPayment returns one payment owned by the caller (or any payment for
// admins): GET /v1/customer/payments/{id}. The PWA polls this after the
// Paddle overlay closes — the webhook confirms asynchronously.
func (s *Server) getPayment(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	paymentID := strings.TrimSpace(r.PathValue("id"))
	if paymentID == "" {
		problem(w, 400, "Validation failed", "payment id is required")
		return
	}
	p, err := scanPayment(s.db.QueryRow(r.Context(), `SELECT `+paymentCols+` FROM payments WHERE id=$1`, paymentID))
	if err != nil {
		problem(w, 404, "Not found", "payment not found")
		return
	}
	isAdmin := false
	for _, rl := range c.Roles {
		if rl == "admin" {
			isAdmin = true
		}
	}
	if p.UserID != c.Sub && !isAdmin {
		problem(w, 403, "Forbidden", "not your payment")
		return
	}
	writeJSON(w, 200, map[string]any{"payment": paymentView(p)})
}
