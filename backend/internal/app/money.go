package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"Trackfud/internal/ledger"
	"Trackfud/internal/order"

	"github.com/jackc/pgx/v5"
)

// ---------- Money B5: Paddle sandbox top-ups + card pay, mock payouts ----------
//
// Wallet top-ups and direct card orders share one Paddle path: a payments row
// is created up front (pending), and POST /v1/webhooks/paddle confirms it.
// The webhook verifies the Paddle signature, claims the event_id exactly once,
// and posts the ledger legs with deterministic idempotency keys — a
// double-delivered event pays once. Card data never touches our code: the
// PWA uses the Paddle overlay, we only see the webhook.
//
// Paddle's rules ban physical goods, marketplaces, and wallet balances, so
// the sandbox provider is the only supported one; anything else disables
// top-ups and card pay (sandbox-only guard, plan §11).

const (
	paddleProvider  = "paddle"
	maxWebhookBody  = 1 << 20 // 1 MiB cap on webhook payloads
	paddleSigMaxAge = 5 * time.Minute
)

// Paddle signature failures (never log the secret or the raw signature).
var (
	ErrPaddleSigMissing = errors.New("money: missing Paddle-Signature header")
	ErrPaddleSigInvalid = errors.New("money: invalid Paddle signature")
	ErrPaddleSigStale   = errors.New("money: stale Paddle signature timestamp")
)

// cardPaymentsEnabled is the sandbox-only guard: only the Paddle sandbox
// provider may move card money.
func (s *Server) cardPaymentsEnabled() bool {
	return s.cfg.Payments.Provider == "paddle_sandbox"
}

// verifyPaddleSignature checks the Paddle-Signature header ("ts=...;h1=...")
// against HMAC-SHA256(secret, "ts:rawBody"), rejecting stale timestamps so
// captured webhooks cannot be replayed.
func verifyPaddleSignature(raw []byte, header, secret string) error {
	if secret == "" || header == "" {
		return ErrPaddleSigMissing
	}
	var ts, h1 string
	for _, part := range strings.Split(header, ";") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "ts":
			ts = kv[1]
		case "h1":
			h1 = kv[1]
		}
	}
	sec, err := strconv.ParseInt(ts, 10, 64)
	if err != nil || h1 == "" {
		return ErrPaddleSigInvalid
	}
	if d := time.Since(time.Unix(sec, 0)); d > paddleSigMaxAge || d < -time.Minute {
		return ErrPaddleSigStale
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts))
	mac.Write([]byte(":"))
	mac.Write(raw)
	if subtleHexEqual(mac.Sum(nil), h1) {
		return nil
	}
	return ErrPaddleSigInvalid
}

// subtleHexEqual compares raw HMAC bytes against a hex signature without
// leaking timing.
func subtleHexEqual(sum []byte, hexSig string) bool {
	sig, err := hex.DecodeString(hexSig)
	if err != nil {
		return false
	}
	return hmac.Equal(sum, sig)
}

// ---------- Paddle event shape ----------

// paddleData is the normalized subset of a Paddle transaction event we act
// on: which Paddle transaction, its status, and our payment row.
type paddleData struct {
	TxnID     string
	Status    string
	PaymentID string
}

// paddleEvent is one parsed webhook delivery.
type paddleEvent struct {
	EventID   string
	EventType string
	Data      paddleData
}

// parsePaddleEvent reads the Paddle Billing shape
// {event_id, event_type, data:{id, status, custom_data:{payment_id}}},
// tolerating the field aliases Paddle documents in the real dashboard:
//   - event id may arrive as notification_id (older docs / retries)
//   - transaction id may arrive as data.id or data.transaction_id
//   - custom_data may be snake_case or camelCase customData
//   - status may sit at data.status (transactions API) — unknown statuses
//     are passed through; applyPaddleEvent decides paid vs failed.
//
// Rejects empty event ids/types and non-JSON so bad deliveries never claim.
func parsePaddleEvent(raw []byte) (paddleEvent, error) {
	var wire struct {
		EventID        string `json:"event_id"`
		NotificationID string `json:"notification_id"`
		EventType      string `json:"event_type"`
		Data           struct {
			ID            string `json:"id"`
			TransactionID string `json:"transaction_id"`
			Status        string `json:"status"`
			CustomData    struct {
				PaymentID string `json:"payment_id"`
			} `json:"custom_data"`
			CustomDataCamel struct {
				PaymentID string `json:"payment_id"`
			} `json:"customData"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		return paddleEvent{}, fmt.Errorf("invalid webhook JSON: %w", err)
	}
	eventID := wire.EventID
	if eventID == "" {
		eventID = wire.NotificationID
	}
	if eventID == "" || wire.EventType == "" {
		return paddleEvent{}, fmt.Errorf("webhook needs event_id and event_type")
	}
	txn := wire.Data.ID
	if txn == "" {
		txn = wire.Data.TransactionID
	}
	paymentID := wire.Data.CustomData.PaymentID
	if paymentID == "" {
		paymentID = wire.Data.CustomDataCamel.PaymentID
	}
	return paddleEvent{
		EventID:   eventID,
		EventType: wire.EventType,
		Data:      paddleData{TxnID: txn, Status: wire.Data.Status, PaymentID: paymentID},
	}, nil
}

// claimWebhookEventSQL inserts the delivery row, or claims nothing when the
// event_id was already seen (the dedupe that makes retries safe). The
// payload casts to jsonb explicitly: pgx sends the raw body as typed text
// and Postgres has no text→jsonb assignment cast, so without $4::jsonb every
// live webhook fails at claim (caught live 2026-11-03; unit fakes never saw it).
const claimWebhookEventSQL = `
INSERT INTO webhook_events(provider,event_id,event_type,payload)
VALUES($1,$2,$3,$4::jsonb)
ON CONFLICT (event_id) DO NOTHING
RETURNING id`

// claimWebhookEvent records one delivery; claimed=false means this exact
// event was already seen, so the caller must not apply it again. It takes
// the narrow claimer interface (pool or tx) so tests can prove the
// double-delivery path without a database.
func claimWebhookEvent(ctx context.Context, q claimer, provider, eventID, eventType, payload string) (claimed bool, err error) {
	var id string
	err = q.QueryRow(ctx, claimWebhookEventSQL, provider, eventID, eventType, payload).Scan(&id)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// ---------- payments ----------

type paymentRow struct {
	ID          string
	UserID      string
	Kind        string
	OrderID     *string
	AmountMinor int64
	Currency    string
	Status      string
	PaddleTxnID *string
	CreatedAt   time.Time
	// Charge* locks the FX quote at checkout (NULL = same-currency charge):
	// Paddle charged ChargeAmountMinor ChargeCurrency (e.g. USD) while the
	// wallet/order is credited AmountMinor Currency (e.g. IDR) in full.
	ChargeCurrency    *string
	ChargeAmountMinor *int64
	FxRate            *float64
}

const paymentCols = `id, user_id, kind, order_id, amount_minor, currency, status, paddle_txn_id, created_at, charge_currency, charge_amount_minor, fx_rate`

func scanPayment(r pgx.Row) (paymentRow, error) {
	var p paymentRow
	err := r.Scan(&p.ID, &p.UserID, &p.Kind, &p.OrderID, &p.AmountMinor, &p.Currency, &p.Status, &p.PaddleTxnID, &p.CreatedAt,
		&p.ChargeCurrency, &p.ChargeAmountMinor, &p.FxRate)
	return p, err
}

// fxQuote reports whether this payment converts currency at apply time.
func (p paymentRow) fxQuote() (chargeMinor int64, chargeCur string, ok bool) {
	if p.ChargeCurrency == nil || p.ChargeAmountMinor == nil {
		return 0, "", false
	}
	chargeCur = strings.ToUpper(strings.TrimSpace(*p.ChargeCurrency))
	if chargeCur == "" || chargeCur == p.Currency || *p.ChargeAmountMinor <= 0 {
		return 0, "", false
	}
	return *p.ChargeAmountMinor, chargeCur, true
}

// paymentView shapes a payment; the sandbox note tells the demo PWA how to
// finish paying without real Paddle credentials.
func paymentView(p paymentRow) map[string]any {
	v := map[string]any{
		"id": p.ID, "kind": p.Kind, "status": p.Status,
		"amount":     money(p.AmountMinor, p.Currency),
		"created_at": p.CreatedAt.UTC().Format(time.RFC3339),
	}
	if p.OrderID != nil {
		v["order_id"] = *p.OrderID
	}
	if chargeMinor, chargeCur, ok := p.fxQuote(); ok {
		q := map[string]any{
			"charge_amount": money(chargeMinor, chargeCur),
			"note":          "Paddle charges in " + chargeCur + "; your " + p.Currency + " balance is credited in full.",
		}
		if p.FxRate != nil {
			q["fx_rate"] = *p.FxRate
		}
		v["fx_quote"] = q
	}
	if p.Status == "pending" {
		v["sandbox_note"] = "Paddle sandbox: pay with the card overlay, or confirm instantly in demo mode."
	}
	return v
}

// validCurrency accepts ISO-4217 alpha codes (three uppercase letters).
func validCurrency(cur string) bool {
	if len(cur) != 3 {
		return false
	}
	for _, ch := range cur {
		if ch < 'A' || ch > 'Z' {
			return false
		}
	}
	return true
}

// idemReplay returns the stored response for a retried Idempotency-Key, so
// top-ups, withdrawals, and orders never charge twice on retry.
func (s *Server) idemReplay(w http.ResponseWriter, r *http.Request, endpoint, userID string) (string, bool) {
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		return "", false
	}
	var st int
	var resp []byte
	if err := s.db.QueryRow(r.Context(), `SELECT status, response FROM idempotency_keys
		WHERE key=$1 AND user_id=$2 AND endpoint=$3`, key, userID, endpoint).Scan(&st, &resp); err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(st)
		_, _ = w.Write(resp)
		return key, true
	}
	return key, false
}

func (s *Server) idemStore(ctx context.Context, endpoint, userID, key string, status int, body []byte) {
	if key == "" {
		return
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO idempotency_keys(key,user_id,endpoint,status,response) VALUES($1,$2,$3,$4,$5)
		ON CONFLICT DO NOTHING`, key, userID, endpoint, status, body)
}

// insertPayment creates the pending Paddle payment both top-ups and card
// orders share; it runs on a pool or an enclosing transaction.
func insertPayment(ctx context.Context, q claimer, userID, kind string, orderID any, amount int64, currency, idemKey string) (paymentRow, error) {
	var p paymentRow
	err := q.QueryRow(ctx, `INSERT INTO payments(user_id,kind,order_id,amount_minor,currency,idempotency_key)
		VALUES($1,$2,$3,$4,$5,$6) RETURNING `+paymentCols,
		userID, kind, orderID, amount, currency, sqlNullIfEmpty(idemKey)).Scan(
		&p.ID, &p.UserID, &p.Kind, &p.OrderID, &p.AmountMinor, &p.Currency, &p.Status, &p.PaddleTxnID, &p.CreatedAt,
		&p.ChargeCurrency, &p.ChargeAmountMinor, &p.FxRate)
	return p, err
}

// createTopup starts a wallet top-up: a pending payment row the Paddle
// sandbox webhook (or the demo simulate endpoint) confirms.
func (s *Server) createTopup(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	if !s.cardPaymentsEnabled() {
		problem(w, 503, "Unavailable", "card payments are disabled: Paddle sandbox only")
		return
	}
	var b struct {
		AmountMinor int64  `json:"amount_minor"`
		Currency    string `json:"currency"`
	}
	if !decode(w, r, &b) {
		return
	}
	if b.AmountMinor <= 0 {
		problem(w, 400, "Validation failed", "amount_minor must be positive")
		return
	}
	b.Currency = strings.ToUpper(strings.TrimSpace(b.Currency))
	if !validCurrency(b.Currency) {
		problem(w, 400, "Validation failed", "currency must be a 3-letter ISO code")
		return
	}
	idemKey, replayed := s.idemReplay(w, r, "create_topup", c.Sub)
	if replayed {
		return
	}
	p, err := insertPayment(r.Context(), s.db, c.Sub, "topup", nil, b.AmountMinor, b.Currency, idemKey)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			problem(w, 409, "Conflict", "duplicate top-up; retry with a new idempotency key")
			return
		}
		problem(w, 500, "Server error", err.Error())
		return
	}
	body, _ := json.Marshal(map[string]any{"payment": paymentView(p)})
	s.idemStore(r.Context(), "create_topup", c.Sub, idemKey, 201, body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(201)
	_, _ = w.Write(body)
}

// listTopups returns the caller's top-up history (newest first) with scroll
// pagination (?page=, ?per_page= default 10).
func (s *Server) listTopups(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	pg := parsePagination(r.URL.Query())
	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM payments
		WHERE user_id=$1 AND kind='topup'`, c.Sub).Scan(&total); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+paymentCols+` FROM payments
		WHERE user_id=$1 AND kind='topup' ORDER BY created_at DESC LIMIT $2 OFFSET $3`, c.Sub, pg.limit, pg.offset)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		p, err := scanPayment(rows)
		if err != nil {
			continue
		}
		out = append(out, paymentView(p))
	}
	writePaginatedList(w, "topups", out, pg.page, pg.perPage, total)
}

// getWallet returns the caller's per-currency wallet balances (one wallet
// per currency; minor units, never floats).
func (s *Server) getWallet(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	rows, err := s.db.Query(r.Context(), `SELECT currency, balance_minor FROM ledger_accounts
		WHERE owner_type='customer' AND owner_id=$1 AND kind='customer_wallet' ORDER BY currency`, c.Sub)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var cur string
		var bal int64
		if err := rows.Scan(&cur, &bal); err == nil {
			out = append(out, map[string]any{"balance": money(bal, cur)})
		}
	}
	writeJSON(w, 200, map[string]any{"wallets": out})
}

// ---------- Paddle webhook ----------

// paddleWebhook confirms top-ups and card orders. The signature is the only
// auth (no JWT): it verifies HMAC, then claims the event_id and applies the
// money move in ONE transaction, so a crash between claim and apply can
// never lose money and a retried delivery is a harmless duplicate.
func (s *Server) paddleWebhook(w http.ResponseWriter, r *http.Request) {
	if !s.cardPaymentsEnabled() {
		problem(w, 403, "Forbidden", "card webhooks disabled: Paddle sandbox only")
		return
	}
	if s.cfg.PaddleWebhookSecret == "" {
		problem(w, 500, "Server error", "paddle webhook is not configured")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxWebhookBody+1))
	if err != nil || int64(len(raw)) > maxWebhookBody {
		problem(w, 413, "Too large", "webhook payload too large")
		return
	}
	if err := verifyPaddleSignature(raw, r.Header.Get("Paddle-Signature"), s.cfg.PaddleWebhookSecret); err != nil {
		problem(w, 401, "Unauthorized", "bad webhook signature")
		return
	}
	ev, err := parsePaddleEvent(raw)
	if err != nil {
		problem(w, 400, "Validation failed", err.Error())
		return
	}
	dup, err := s.handlePaddleEventTx(r.Context(), ev, string(raw))
	if err != nil {
		// Log the real cause: the 500 body stays generic so Paddle's
		// retries (which we log server-side) never leak internals.
		s.log.Error("paddle webhook apply failed", "event_id", ev.EventID, "event_type", ev.EventType, "err", err)
		problem(w, 500, "Server error", "webhook apply failed; Paddle will retry")
		return
	}
	writeJSON(w, 200, map[string]any{"received": true, "duplicate": dup})
}

// handlePaddleEventTx claims one Paddle event and applies it atomically.
// Duplicate deliveries return (true, nil) without touching money.
func (s *Server) handlePaddleEventTx(ctx context.Context, ev paddleEvent, raw string) (bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	claimed, err := claimWebhookEvent(ctx, tx, paddleProvider, ev.EventID, ev.EventType, raw)
	if err != nil {
		return false, err
	}
	if !claimed {
		_ = tx.Commit(ctx)
		return true, nil
	}
	status, applyErr := s.applyPaddleEvent(ctx, tx, ev)
	if _, err := tx.Exec(ctx, `UPDATE webhook_events SET status=$2, error=$3,
		processed_at=CASE WHEN $2 IN ('processed','ignored') THEN now() ELSE NULL END
		WHERE provider=$1 AND event_id=$4`, paddleProvider, status, errStr(applyErr), ev.EventID); err != nil {
		// A failed apply aborts the tx, so this UPDATE fails too with a
		// generic "transaction is aborted" — return the original cause.
		if applyErr != nil {
			return false, applyErr
		}
		return false, err
	}
	if applyErr != nil {
		_ = tx.Commit(ctx)
		return false, applyErr
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	s.notifyPaddleEvent(ctx, ev, status)
	return false, nil
}

func errStr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// applyPaddleEvent routes one claimed event to the shared top-up/card apply.
// Unknown types and payments are recorded as ignored, never retried blindly.
// The real dashboard also sends transaction.updated (with data.status
// completed/paid/failed/canceled) and transaction.paid: completed/paid pay
// once through the same idempotent path, terminal failures fail.
func (s *Server) applyPaddleEvent(ctx context.Context, tx pgx.Tx, ev paddleEvent) (string, error) {
	switch ev.EventType {
	case "transaction.completed", "transaction.paid":
		if ev.Data.PaymentID == "" {
			return "ignored", nil
		}
		return "processed", s.completePaddlePayment(ctx, tx, ev.Data.PaymentID, ev.Data.TxnID)
	case "transaction.updated":
		if ev.Data.PaymentID == "" {
			return "ignored", nil
		}
		switch strings.ToLower(strings.TrimSpace(ev.Data.Status)) {
		case "completed", "paid", "billed", "ready":
			// ready/billed mean authorized-but-capturing on some flows; only
			// completed/paid move money. ready is intentionally ignored below.
			if strings.ToLower(strings.TrimSpace(ev.Data.Status)) == "ready" {
				return "ignored", nil
			}
			return "processed", s.completePaddlePayment(ctx, tx, ev.Data.PaymentID, ev.Data.TxnID)
		case "failed", "canceled", "cancelled", "past_due":
			return "processed", s.failPaddlePayment(ctx, tx, ev.Data.PaymentID, ev.Data.TxnID)
		default:
			return "ignored", nil
		}
	case "transaction.failed", "transaction.canceled", "transaction.cancelled", "transaction.payment_failed":
		if ev.Data.PaymentID == "" {
			return "ignored", nil
		}
		return "processed", s.failPaddlePayment(ctx, tx, ev.Data.PaymentID, ev.Data.TxnID)
	default:
		return "ignored", nil
	}
}

// completePaddlePayment confirms one payment exactly once: a top-up credits
// the wallet, a card order moves awaiting_payment to placed with the card
// charge held in escrow. Re-applying a paid payment is a no-op, and every
// ledger post carries a deterministic key, so retries pay once.
func (s *Server) completePaddlePayment(ctx context.Context, tx pgx.Tx, paymentID, txnID string) error {
	var p paymentRow
	dst := []any{&p.ID, &p.UserID, &p.Kind, &p.OrderID, &p.AmountMinor, &p.Currency, &p.Status, &p.PaddleTxnID, &p.CreatedAt,
		&p.ChargeCurrency, &p.ChargeAmountMinor, &p.FxRate}
	if err := tx.QueryRow(ctx, `SELECT `+paymentCols+` FROM payments WHERE id=$1 FOR UPDATE`, paymentID).Scan(dst...); err != nil {
		return fmt.Errorf("payment not found: %s", paymentID)
	}
	if p.Status == "paid" {
		return nil
	}
	if p.Status != "pending" {
		return fmt.Errorf("payment %s is %s, cannot complete", paymentID, p.Status)
	}
	if _, err := tx.Exec(ctx, `UPDATE payments SET status='paid', paddle_txn_id=$2, updated_at=now() WHERE id=$1`, paymentID, sqlNullIfEmpty(txnID)); err != nil {
		return err
	}
	if p.Kind == "topup" {
		// FX-converted charge (e.g. IDR wallet, USD charged): the customer
		// receives the full credited amount; fx_position bridges the two
		// currencies so each side still nets to zero.
		if chargeMinor, chargeCur, ok := p.fxQuote(); ok {
			return postEntry(ctx, tx, "wallet_topup_fx", ledger.TopupKey(p.UserID, p.ID), "payment", p.ID,
				ledger.FxTopupPostings(chargeMinor, chargeCur, p.AmountMinor, p.Currency, p.UserID))
		}
		return postEntry(ctx, tx, "wallet_topup", ledger.TopupKey(p.UserID, p.ID), "payment", p.ID,
			ledger.TopupPostings(p.AmountMinor, p.Currency, p.UserID))
	}
	if p.OrderID == nil {
		return fmt.Errorf("card payment %s has no order", paymentID)
	}
	chargeMinor, chargeCur, _ := p.fxQuote()
	return s.placeCardOrderTx(ctx, tx, *p.OrderID, chargeMinor, chargeCur)
}

// placeCardOrderTx moves a card order from awaiting_payment to placed: the
// guarded update is the single decider, then the order event, the card
// charge into escrow (FX-converted when chargeCur is set), and the
// merchant-accept timeout are queued in-tx.
func (s *Server) placeCardOrderTx(ctx context.Context, tx pgx.Tx, orderID string, chargeMinor int64, chargeCur string) error {
	var customerID, merchantID string
	err := tx.QueryRow(ctx, `UPDATE orders SET status='placed', payment_status='held',
		placed_at=now(), updated_at=now() WHERE id=$1 AND status='awaiting_payment'
		RETURNING customer_id, merchant_id`, orderID).Scan(&customerID, &merchantID)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id,reason)
		VALUES($1,'awaiting_payment','placed','customer',$2,'card payment confirmed (Paddle sandbox)')`, orderID, customerID); err != nil {
		return err
	}
	o, err := scanOrderRow(tx.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE id=$1`, orderID))
	if err != nil {
		return err
	}
	legs := ledger.CardChargePostings(o.quote(), orderID)
	if chargeMinor > 0 && chargeCur != "" && chargeCur != o.quote().Currency {
		legs = ledger.FxCardChargePostings(chargeMinor, chargeCur, o.quote(), orderID)
	}
	if err := postEntry(ctx, tx, "order_card_charge", ledger.CardChargeKey(orderID), "order", orderID, legs); err != nil {
		return err
	}
	return s.enqueueTx(ctx, tx, "merchant_accept_timeout", fmt.Sprintf(`{"order_id":%q}`, orderID),
		time.Now().Add(time.Duration(s.effectiveAcceptWindow(ctx, s.merchantCountryForOrder(ctx, orderID)))*time.Second))
}

// failPaddlePayment records a failed/cancelled Paddle transaction: the
// payment row fails, and a card order waiting on it is cancelled (no money
// ever moved, so no ledger post).
func (s *Server) failPaddlePayment(ctx context.Context, tx pgx.Tx, paymentID, txnID string) error {
	var p paymentRow
	dst := []any{&p.ID, &p.UserID, &p.Kind, &p.OrderID, &p.AmountMinor, &p.Currency, &p.Status, &p.PaddleTxnID, &p.CreatedAt,
		&p.ChargeCurrency, &p.ChargeAmountMinor, &p.FxRate}
	if err := tx.QueryRow(ctx, `SELECT `+paymentCols+` FROM payments WHERE id=$1 FOR UPDATE`, paymentID).Scan(dst...); err != nil {
		return fmt.Errorf("payment not found: %s", paymentID)
	}
	if p.Status != "pending" {
		return nil
	}
	if _, err := tx.Exec(ctx, `UPDATE payments SET status='failed', paddle_txn_id=$2, updated_at=now() WHERE id=$1`, paymentID, sqlNullIfEmpty(txnID)); err != nil {
		return err
	}
	if p.Kind == "order" && p.OrderID != nil {
		var customerID string
		err := tx.QueryRow(ctx, `UPDATE orders SET status='cancelled', payment_status='unpaid',
			cancelled_at=now(), cancel_reason='card payment failed', updated_at=now()
			WHERE id=$1 AND status='awaiting_payment' RETURNING customer_id`, *p.OrderID).Scan(&customerID)
		if err == nil {
			_, _ = tx.Exec(ctx, `INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id,reason)
				VALUES($1,'awaiting_payment','cancelled','system','','card payment failed')`, *p.OrderID)
		} else if err != pgx.ErrNoRows {
			return err
		}
	}
	return nil
}

// notifyPaddleEvent pushes and broadcasts after the webhook transaction
// commits (never inside it).
func (s *Server) notifyPaddleEvent(ctx context.Context, ev paddleEvent, status string) {
	if status != "processed" || ev.Data.PaymentID == "" {
		return
	}
	p, err := scanPayment(s.db.QueryRow(ctx, `SELECT `+paymentCols+` FROM payments WHERE id=$1`, ev.Data.PaymentID))
	if err != nil {
		return
	}
	switch {
	case p.Kind == "topup" && p.Status == "paid":
		s.queuePush(p.UserID, "Top-up received",
			fmt.Sprintf("%s wallet topped up.", formatMinor(p.AmountMinor, p.Currency)))
	case p.Kind == "order" && p.OrderID != nil:
		o, err := s.loadOrder(ctx, *p.OrderID)
		if err != nil {
			return
		}
		s.broadcastOrder(ctx, o.CustomerID, o.MerchantID, o.ID, o.Status)
		if o.Status == order.StatusPlaced {
			s.queuePush(o.CustomerID, "Payment confirmed", "Your card payment went through; the kitchen has your order.")
		} else {
			s.queuePush(o.CustomerID, "Payment failed", "Your card payment did not go through; no money moved.")
		}
	}
}

// formatMinor renders minor units for push text without floats.
func formatMinor(amount int64, currency string) string {
	return fmt.Sprintf("%d %s", amount, currency)
}

// simulatePaddlePaid is the demo-mode stand-in for the Paddle overlay: it
// runs the exact same claim-and-apply transaction as the webhook with a
// deterministic synthetic event_id, so judges can top up and card-pay with
// no Paddle credentials. Never enabled outside demo mode.
func (s *Server) simulatePaddlePaid(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.Server.DemoMode {
		problem(w, 404, "Not found", "unknown endpoint")
		return
	}
	c := claims(r)
	paymentID := r.PathValue("id")
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
	ev := paddleEvent{
		EventID:   "sim-" + p.ID,
		EventType: "transaction.completed",
		Data:      paddleData{TxnID: "sim_txn_" + p.ID[:8], Status: "completed", PaymentID: p.ID},
	}
	dup, err := s.handlePaddleEventTx(r.Context(), ev, `{"simulated":true,"payment_id":"`+p.ID+`"}`)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	updated, _ := scanPayment(s.db.QueryRow(r.Context(), `SELECT `+paymentCols+` FROM payments WHERE id=$1`, p.ID))
	resp := map[string]any{"payment": paymentView(updated), "duplicate": dup, "simulated": true}
	if updated.Kind == "order" && updated.OrderID != nil {
		if o, err := s.loadOrder(r.Context(), *updated.OrderID); err == nil {
			resp["order"] = s.orderView(r.Context(), o, "customer")
		}
	}
	writeJSON(w, 200, resp)
}

// ---------- withdrawals (mock payouts) ----------

// withdrawalRow is one payout request against courier_earnings. debited
// tracks whether the earnings→clearing legs were posted, so holds and
// retries reverse exactly once.
type withdrawalRow struct {
	ID            string
	CourierID     string
	AmountMinor   int64
	Currency      string
	Status        string
	Debited       bool
	HoldReason    string
	FailureReason string
	PayoutRef     string
	CreatedAt     time.Time
}

const withdrawalCols = `id, courier_id, amount_minor, currency, status, debited,
	hold_reason, failure_reason, payout_ref, created_at`

func scanWithdrawal(r pgx.Row) (withdrawalRow, error) {
	var w withdrawalRow
	err := r.Scan(&w.ID, &w.CourierID, &w.AmountMinor, &w.Currency, &w.Status,
		&w.Debited, &w.HoldReason, &w.FailureReason, &w.PayoutRef, &w.CreatedAt)
	return w, err
}

func withdrawalView(w withdrawalRow) map[string]any {
	v := map[string]any{
		"id": w.ID, "status": w.Status,
		"amount":     money(w.AmountMinor, w.Currency),
		"created_at": w.CreatedAt.UTC().Format(time.RFC3339),
	}
	if w.HoldReason != "" {
		v["hold_reason"] = w.HoldReason
	}
	if w.FailureReason != "" {
		v["failure_reason"] = w.FailureReason
	}
	if w.PayoutRef != "" {
		v["payout_ref"] = w.PayoutRef
	}
	return v
}

// earningsBalanceForUpdate locks the courier's earnings account and returns
// its balance in minor units.
func earningsBalanceForUpdate(ctx context.Context, tx pgx.Tx, userID, currency string) (int64, error) {
	if _, err := ensureAccount(ctx, tx, "courier", userID, "courier_earnings", currency); err != nil {
		return 0, err
	}
	var bal int64
	err := tx.QueryRow(ctx, `SELECT balance_minor FROM ledger_accounts
		WHERE owner_type='courier' AND owner_id=$1 AND kind='courier_earnings' AND currency=$2 FOR UPDATE`, userID, currency).Scan(&bal)
	return bal, err
}

// reservedEarnings sums withdrawals already in flight (pending, processing,
// or held) so a courier cannot promise the same earnings twice.
func reservedEarnings(ctx context.Context, tx pgx.Tx, userID, currency string) int64 {
	var reserved int64
	_ = tx.QueryRow(ctx, `SELECT COALESCE(sum(amount_minor),0) FROM withdrawals
		WHERE courier_id=$1 AND currency=$2 AND status IN ('pending','processing','held')`,
		userID, currency).Scan(&reserved)
	return reserved
}

// createWithdrawal requests a payout of earned money, anytime. Money already
// earned stays withdrawable while frozen or banned (plan §8.4) and for
// staff couriers alike, so there is no role or status gate — only the
// balance check. The payout_process worker settles it.
func (s *Server) createWithdrawal(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b struct {
		AmountMinor int64  `json:"amount_minor"`
		Currency    string `json:"currency"`
	}
	if !decode(w, r, &b) {
		return
	}
	if b.AmountMinor <= 0 {
		problem(w, 400, "Validation failed", "amount_minor must be positive")
		return
	}
	b.Currency = strings.ToUpper(strings.TrimSpace(b.Currency))
	if !validCurrency(b.Currency) {
		problem(w, 400, "Validation failed", "currency must be a 3-letter ISO code")
		return
	}
	idemKey, replayed := s.idemReplay(w, r, "create_withdrawal", c.Sub)
	if replayed {
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	bal, err := earningsBalanceForUpdate(r.Context(), tx, c.Sub, b.Currency)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if bal-reservedEarnings(r.Context(), tx, c.Sub, b.Currency) < b.AmountMinor {
		_ = tx.Rollback(r.Context())
		problem(w, 402, "Insufficient balance", "not enough earned balance to withdraw")
		return
	}
	var wd withdrawalRow
	err = tx.QueryRow(r.Context(), `INSERT INTO withdrawals(courier_id,amount_minor,currency,idempotency_key)
		VALUES($1,$2,$3,$4) RETURNING `+withdrawalCols, c.Sub, b.AmountMinor, b.Currency, sqlNullIfEmpty(idemKey)).Scan(
		&wd.ID, &wd.CourierID, &wd.AmountMinor, &wd.Currency, &wd.Status,
		&wd.Debited, &wd.HoldReason, &wd.FailureReason, &wd.PayoutRef, &wd.CreatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			problem(w, 409, "Conflict", "duplicate withdrawal; retry with a new idempotency key")
			return
		}
		problem(w, 500, "Server error", err.Error())
		return
	}
	if err := s.enqueueTx(r.Context(), tx, "payout_process", fmt.Sprintf(`{"withdrawal_id":%q}`, wd.ID), time.Now()); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	body, _ := json.Marshal(map[string]any{"withdrawal": withdrawalView(wd)})
	s.idemStore(r.Context(), "create_withdrawal", c.Sub, idemKey, 201, body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(201)
	_, _ = w.Write(body)
}

// listWithdrawals returns the caller's payout history (newest first) with
// scroll pagination (?page=, ?per_page= default 10).
func (s *Server) listWithdrawals(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	pg := parsePagination(r.URL.Query())
	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM withdrawals
		WHERE courier_id=$1`, c.Sub).Scan(&total); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+withdrawalCols+` FROM withdrawals
		WHERE courier_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, c.Sub, pg.limit, pg.offset)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		wd, err := scanWithdrawal(rows)
		if err != nil {
			continue
		}
		out = append(out, withdrawalView(wd))
	}
	writePaginatedList(w, "withdrawals", out, pg.page, pg.perPage, total)
}

// getEarnings returns the courier's per-currency earnings: the ledger
// balance, lifetime earned (all settlement credits), and what is still
// withdrawable after in-flight withdrawals.
func (s *Server) getEarnings(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	rows, err := s.db.Query(r.Context(), `SELECT currency, balance_minor FROM ledger_accounts
		WHERE owner_type='courier' AND owner_id=$1 AND kind='courier_earnings' ORDER BY currency`, c.Sub)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var cur string
		var bal int64
		if err := rows.Scan(&cur, &bal); err != nil {
			continue
		}
		var lifetime int64
		_ = s.db.QueryRow(r.Context(), `SELECT COALESCE(sum(p.amount_minor),0) FROM postings p
			JOIN ledger_accounts a ON a.id=p.account_id
			WHERE a.owner_type='courier' AND a.owner_id=$1 AND a.kind='courier_earnings'
			AND a.currency=$2 AND p.amount_minor>0`, c.Sub, cur).Scan(&lifetime)
		var reserved int64
		_ = s.db.QueryRow(r.Context(), `SELECT COALESCE(sum(amount_minor),0) FROM withdrawals
			WHERE courier_id=$1 AND currency=$2 AND status IN ('pending','processing','held')`,
			c.Sub, cur).Scan(&reserved)
		out = append(out, map[string]any{
			"currency":        cur,
			"balance":         money(bal, cur),
			"lifetime_earned": money(lifetime, cur),
			"reserved":        money(reserved, cur),
			"withdrawable":    money(bal-reserved, cur),
		})
	}
	writeJSON(w, 200, map[string]any{"earnings": out})
}

// listDeliveryHistory feeds the courier Orders page: past delivered AND
// cancelled legs with payout, measured workout, and the stars received.
// Scroll-paginated (?page=, ?per_page= default 10) so the list and the
// Ratings page aggregate page by page instead of loading the whole career
// at once. Optional ?status=delivered|cancelled filters the terminal state
// (empty/all = both), and ?q= matches the order code or merchant name.
func (s *Server) listDeliveryHistory(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	pg := parsePagination(r.URL.Query())
	status := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
	if status == "" {
		status = "all"
	}
	if status != "all" && status != "delivered" && status != "cancelled" {
		problem(w, 400, "Validation failed", "status must be delivered, cancelled or all")
		return
	}
	pattern, filtered, errMsg := parseSearch(r.URL.Query().Get("q"))
	if errMsg != "" {
		problem(w, 400, "Validation failed", errMsg)
		return
	}
	where := `WHERE d.courier_id=$1 AND d.status IN ('delivered','cancelled')`
	args := []any{c.Sub}
	if status != "all" {
		args = append(args, status)
		where += ` AND d.status=$` + strconv.Itoa(len(args))
	}
	if filtered {
		args = append(args, pattern)
		where += ` AND (o.code ILIKE $` + strconv.Itoa(len(args)) + ` ESCAPE '\' OR m.name ILIKE $` + strconv.Itoa(len(args)) + ` ESCAPE '\')`
	}
	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM deliveries d
		JOIN orders o ON o.id=d.order_id JOIN merchants m ON m.id=o.merchant_id `+where, args...).Scan(&total); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	qargs := append(append([]any{}, args...), pg.limit, pg.offset)
	rows, err := s.db.Query(r.Context(), `SELECT d.id, d.type, d.status, o.code, o.currency,
		o.delivery_fee_minor, o.courier_fee_minor, o.tip_minor, m.name,
		d.carried_distance_m, d.carried_active_s, d.delivered_at, d.created_at, d.cancel_note,
		r.courier_stars,
		COALESCE(r.courier_tags, '[]'::jsonb)
		FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN merchants m ON m.id=o.merchant_id
		LEFT JOIN order_ratings r ON r.order_id=o.id
		`+where+`
		ORDER BY COALESCE(d.delivered_at, d.created_at) DESC LIMIT $`+strconv.Itoa(len(qargs)-1)+` OFFSET $`+strconv.Itoa(len(qargs)), qargs...)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, typ, st, code, cur, name string
		var deliveryFee, courierFee, tip int64
		var dist float64
		var active int64
		var at *time.Time
		var created time.Time
		var cancelNote string
		var stars *int
		var tagsB []byte
		if err := rows.Scan(&id, &typ, &st, &code, &cur, &deliveryFee, &courierFee, &tip,
			&name, &dist, &active, &at, &created, &cancelNote, &stars, &tagsB); err != nil {
			continue
		}
		// Cancelled legs never settle: the payout stays zero, never a
		// negative leftover from the stored quote.
		var payout int64
		if st == "delivered" {
			payout = deliveryFee - courierFee + tip
		}
		item := map[string]any{
			"delivery_id": id, "type": typ, "status": st, "order_code": code,
			"payout":        money(payout, cur),
			"merchant_name": name, "distance_m": dist, "active_s": active,
			"created_at": created.UTC().Format(time.RFC3339),
		}
		if at != nil {
			item["delivered_at"] = at.UTC().Format(time.RFC3339)
		}
		if st == "cancelled" && strings.TrimSpace(cancelNote) != "" {
			item["cancel_note"] = cancelNote
		}
		if stars != nil {
			item["courier_stars"] = *stars
		}
		// Customer tag labels (courier-blaming topics stay in the AI support
		// queue, never here): the Ratings page aggregates these per tag.
		var tags []string
		if len(tagsB) > 0 {
			_ = json.Unmarshal(tagsB, &tags)
		}
		if tags == nil {
			tags = []string{}
		}
		item["courier_tags"] = tags
		out = append(out, item)
	}
	writePaginatedList(w, "deliveries", out, pg.page, pg.perPage, total)
}

// ---------- mock payout provider + worker ----------

// PayoutProvider settles money outside Trackfud; the mock marks demo
// payouts paid at once (a real provider plugs in here for production).
type PayoutProvider func(ctx context.Context, w withdrawalRow) (ref string, err error)

// mockPayout approves every payout instantly (demo provider).
func mockPayout(_ context.Context, w withdrawalRow) (string, error) {
	return "mock_" + w.ID, nil
}

// handlePayoutProcess settles one withdrawal through the mock provider.
func (s *Server) handlePayoutProcess(ctx context.Context, withdrawalID string) {
	s.processWithdrawal(ctx, withdrawalID, mockPayout)
}

// processWithdrawal runs the debit → provider → paid/fail-reverse cycle. It
// is retry-safe: the guarded claim takes each withdrawal once (stale
// processing rows reclaimed after 5 min), the debit carries a deterministic
// key, and a held withdrawal is reversed, never paid.
func (s *Server) processWithdrawal(ctx context.Context, withdrawalID string, provider PayoutProvider) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	var wd withdrawalRow
	err = tx.QueryRow(ctx, `UPDATE withdrawals SET status='processing', updated_at=now() WHERE id=$1
		AND (status='pending' OR (status='processing' AND updated_at < now() - interval '5 minutes'))
		RETURNING `+withdrawalCols, withdrawalID).Scan(
		&wd.ID, &wd.CourierID, &wd.AmountMinor, &wd.Currency, &wd.Status,
		&wd.Debited, &wd.HoldReason, &wd.FailureReason, &wd.PayoutRef, &wd.CreatedAt)
	if err != nil {
		return
	}
	bal, err := earningsBalanceForUpdate(ctx, tx, wd.CourierID, wd.Currency)
	if err != nil {
		return
	}
	if bal < wd.AmountMinor {
		_, _ = tx.Exec(ctx, `UPDATE withdrawals SET status='failed',
			failure_reason='insufficient earnings at payout time', updated_at=now() WHERE id=$1`, wd.ID)
		_ = tx.Commit(ctx)
		s.queuePush(wd.CourierID, "Withdrawal failed", "Your earnings balance moved before the payout ran.")
		return
	}
	if err := postEntry(ctx, tx, "withdrawal_debit", ledger.WithdrawKey(wd.ID), "withdrawal", wd.ID,
		ledger.WithdrawalDebitPostings(wd.AmountMinor, wd.Currency, wd.CourierID)); err != nil {
		return
	}
	_, _ = tx.Exec(ctx, `UPDATE withdrawals SET debited=true, updated_at=now() WHERE id=$1`, wd.ID)
	if err := tx.Commit(ctx); err != nil {
		return
	}
	// The provider call runs outside the transaction; the fail-reverse below
	// keeps a failed payout from ever losing money.
	ref, providerErr := provider(ctx, wd)
	tx2, err := s.db.Begin(ctx)
	if err != nil {
		return
	}
	defer tx2.Rollback(ctx)
	var status string
	var debited bool
	if err := tx2.QueryRow(ctx, `SELECT status, debited FROM withdrawals WHERE id=$1 FOR UPDATE`, wd.ID).Scan(&status, &debited); err != nil {
		return
	}
	switch {
	case status == "held":
		// An admin held the withdrawal mid-flight: reverse the debit.
		if debited {
			_ = postEntry(ctx, tx2, "withdrawal_reverse", ledger.WithdrawReverseKey(wd.ID), "withdrawal", wd.ID,
				ledger.WithdrawalReversePostings(wd.AmountMinor, wd.Currency, wd.CourierID))
			_, _ = tx2.Exec(ctx, `UPDATE withdrawals SET debited=false, updated_at=now() WHERE id=$1`, wd.ID)
		}
	case providerErr != nil:
		if debited {
			_ = postEntry(ctx, tx2, "withdrawal_reverse", ledger.WithdrawReverseKey(wd.ID), "withdrawal", wd.ID,
				ledger.WithdrawalReversePostings(wd.AmountMinor, wd.Currency, wd.CourierID))
		}
		_, _ = tx2.Exec(ctx, `UPDATE withdrawals SET status='failed', debited=false,
			failure_reason=$2, updated_at=now() WHERE id=$1`, wd.ID, providerErr.Error())
	default:
		_, _ = tx2.Exec(ctx, `UPDATE withdrawals SET status='paid', payout_ref=$2, updated_at=now() WHERE id=$1`, wd.ID, ref)
	}
	if err := tx2.Commit(ctx); err != nil {
		return
	}
	switch {
	case status == "held":
		s.queuePush(wd.CourierID, "Withdrawal on hold", "Support is reviewing your withdrawal; the money is back in your earnings.")
	case providerErr != nil:
		s.queuePush(wd.CourierID, "Withdrawal failed", "The payout failed; the money is back in your earnings.")
	default:
		s.queuePush(wd.CourierID, "Withdrawal paid", fmt.Sprintf("%s is on its way.", formatMinor(wd.AmountMinor, wd.Currency)))
	}
}

// ---------- admin: withdrawals monitor + hold/release ----------

// listAdminWithdrawals serves the finance review queue, optionally filtered
// by status, with scroll pagination (?page=, ?per_page= default 10, legacy
// ?limit= alias).
func (s *Server) listAdminWithdrawals(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	pg := parsePagination(r.URL.Query())
	status := r.URL.Query().Get("status")
	q := `SELECT ` + withdrawalCols + ` FROM withdrawals`
	countQ := `SELECT COUNT(*) FROM withdrawals`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		countQ += ` WHERE status=$1`
		args = append(args, status)
	}
	var total int
	if err := s.db.QueryRow(r.Context(), countQ, args...).Scan(&total); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	pargs := append(append([]any{}, args...), pg.limit, pg.offset)
	ph := len(pargs)
	q += ` ORDER BY created_at DESC LIMIT $` + strconv.Itoa(ph-1) + ` OFFSET $` + strconv.Itoa(ph)
	rows, err := s.db.Query(r.Context(), q, pargs...)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		wd, err := scanWithdrawal(rows)
		if err != nil {
			continue
		}
		v := withdrawalView(wd)
		v["courier_id"] = wd.CourierID
		out = append(out, v)
	}
	writePaginatedList(w, "withdrawals", out, pg.page, pg.perPage, total)
}

// holdWithdrawal freezes a payout for review: a pending one simply waits,
// while a debited (processing) one is reversed back into earnings first.
func (s *Server) holdWithdrawal(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	var b struct {
		Reason string `json:"reason"`
	}
	if !decode(w, r, &b) {
		return
	}
	if strings.TrimSpace(b.Reason) == "" {
		problem(w, 400, "Validation failed", "a hold reason is required")
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var wd withdrawalRow
	err = tx.QueryRow(r.Context(), `SELECT `+withdrawalCols+` FROM withdrawals WHERE id=$1 FOR UPDATE`,
		r.PathValue("id")).Scan(&wd.ID, &wd.CourierID, &wd.AmountMinor, &wd.Currency, &wd.Status,
		&wd.Debited, &wd.HoldReason, &wd.FailureReason, &wd.PayoutRef, &wd.CreatedAt)
	if err != nil {
		problem(w, 404, "Not found", "withdrawal not found")
		return
	}
	if wd.Status != "pending" && wd.Status != "processing" {
		problem(w, 409, "Conflict", "only a pending or processing withdrawal can be held (now "+wd.Status+")")
		return
	}
	if wd.Debited {
		if err := postEntry(r.Context(), tx, "withdrawal_reverse", ledger.WithdrawReverseKey(wd.ID), "withdrawal", wd.ID,
			ledger.WithdrawalReversePostings(wd.AmountMinor, wd.Currency, wd.CourierID)); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `UPDATE withdrawals SET status='held', debited=false,
		hold_reason=$2, updated_at=now() WHERE id=$1`, wd.ID, strings.TrimSpace(b.Reason)); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	s.queuePush(wd.CourierID, "Withdrawal on hold", "Support is reviewing your withdrawal.")
	s.writeAudit(r.Context(), r, "withdrawal.hold", "withdrawal", wd.ID, strings.TrimSpace(b.Reason),
		map[string]any{"status": wd.Status}, map[string]any{"status": "held"})
	writeJSON(w, 200, map[string]any{"withdrawal": withdrawalView(withdrawalRow{
		ID: wd.ID, CourierID: wd.CourierID, AmountMinor: wd.AmountMinor, Currency: wd.Currency,
		Status: "held", HoldReason: strings.TrimSpace(b.Reason), CreatedAt: wd.CreatedAt,
	})})
}

// releaseWithdrawal returns a held payout to the queue.
func (s *Server) releaseWithdrawal(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var courierID string
	err = tx.QueryRow(r.Context(), `UPDATE withdrawals SET status='pending', hold_reason='', updated_at=now()
		WHERE id=$1 AND status='held' RETURNING courier_id`, r.PathValue("id")).Scan(&courierID)
	if err != nil {
		problem(w, 409, "Conflict", "only a held withdrawal can be released")
		return
	}
	if err := s.enqueueTx(r.Context(), tx, "payout_process", fmt.Sprintf(`{"withdrawal_id":%q}`, r.PathValue("id")), time.Now()); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	s.queuePush(courierID, "Withdrawal released", "Your withdrawal is back in the payout queue.")
	s.writeAudit(r.Context(), r, "withdrawal.release", "withdrawal", r.PathValue("id"), "",
		map[string]any{"status": "held"}, map[string]any{"status": "pending"})
	writeJSON(w, 200, map[string]any{"released": true})
}
