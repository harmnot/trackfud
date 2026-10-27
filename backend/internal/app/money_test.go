package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"fmt"
	"strings"
	"testing"
	"time"

	"Trackfud/internal/config"
	"Trackfud/internal/ledger"
	"Trackfud/internal/order"

	"github.com/jackc/pgx/v5"
)

// signPaddle builds a Paddle-Signature header the way Paddle does:
// HMAC-SHA256(secret, "ts:body").
func signPaddle(secret string, ts int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprint(ts)))
	mac.Write([]byte(":"))
	mac.Write(body)
	return fmt.Sprintf("ts=%d;h1=%x", ts, mac.Sum(nil))
}

func TestVerifyPaddleSignature(t *testing.T) {
	secret := "whsec_test_secret"
	body := []byte(`{"event_id":"evt-1","event_type":"transaction.completed"}`)
	now := time.Now().Unix()
	if err := verifyPaddleSignature(body, signPaddle(secret, now, body), secret); err != nil {
		t.Fatalf("valid signature must pass: %v", err)
	}
	if err := verifyPaddleSignature(append(body, ' '), signPaddle(secret, now, body), secret); err != ErrPaddleSigInvalid {
		t.Fatalf("tampered body must fail, got %v", err)
	}
	if err := verifyPaddleSignature(body, signPaddle("wrong", now, body), secret); err != ErrPaddleSigInvalid {
		t.Fatalf("wrong secret must fail, got %v", err)
	}
	if err := verifyPaddleSignature(body, signPaddle(secret, now-600, body), secret); err != ErrPaddleSigStale {
		t.Fatalf("10-min-old signature must be stale, got %v", err)
	}
	if err := verifyPaddleSignature(body, signPaddle(secret, now+300, body), secret); err != ErrPaddleSigStale {
		t.Fatalf("future signature must be stale, got %v", err)
	}
	for _, bad := range []string{"", "ts=abc;h1=00", "ts=123", "h1=zz", "ts=123;h1=nothex!!"} {
		if err := verifyPaddleSignature(body, bad, secret); err == nil {
			t.Fatalf("malformed header %q must fail", bad)
		}
	}
	if err := verifyPaddleSignature(body, signPaddle(secret, now, body), ""); err != ErrPaddleSigMissing {
		t.Fatal("empty server secret must refuse everything")
	}
}

// The webhook dedupe maps "event already seen" to claimed=false, and the
// claim SQL pins the event_id conflict target.
func TestClaimWebhookEvent(t *testing.T) {
	ctx := context.Background()
	first := &fakeClaimer{row: fakeRow{orderID: "evt-row-1"}}
	claimed, err := claimWebhookEvent(ctx, first, "paddle", "evt-1", "transaction.completed", "{}")
	if err != nil || !claimed {
		t.Fatalf("first delivery must claim, got claimed=%v err=%v", claimed, err)
	}
	for _, want := range []string{"webhook_events", "ON CONFLICT (event_id) DO NOTHING", "RETURNING id"} {
		if !strings.Contains(first.gotSQL, want) {
			t.Fatalf("claim SQL must contain %q", want)
		}
	}
	// The double delivery finds no row: duplicate, apply nothing.
	second := &fakeClaimer{row: fakeRow{err: pgx.ErrNoRows}}
	claimed, err = claimWebhookEvent(ctx, second, "paddle", "evt-1", "transaction.completed", "{}")
	if err != nil || claimed {
		t.Fatalf("second delivery must be a duplicate, got claimed=%v err=%v", claimed, err)
	}
}

func TestParsePaddleEvent(t *testing.T) {
	raw := []byte(`{"event_id":"evt-9","event_type":"transaction.completed",
		"data":{"id":"txn_abc","status":"completed","custom_data":{"payment_id":"pay-1"}}}`)
	ev, err := parsePaddleEvent(raw)
	if err != nil {
		t.Fatalf("valid event must parse: %v", err)
	}
	if ev.EventID != "evt-9" || ev.EventType != "transaction.completed" ||
		ev.Data.TxnID != "txn_abc" || ev.Data.PaymentID != "pay-1" {
		t.Fatalf("unexpected parse: %+v", ev)
	}
	// transaction_id alias is tolerated.
	raw2 := []byte(`{"event_id":"e","event_type":"transaction.failed",
		"data":{"transaction_id":"txn_x","custom_data":{"payment_id":"p"}}}`)
	ev2, err := parsePaddleEvent(raw2)
	if err != nil || ev2.Data.TxnID != "txn_x" {
		t.Fatalf("transaction_id alias must parse: %+v %v", ev2, err)
	}
	for _, bad := range []string{`not json`, `{}`, `{"event_id":"e"}`, `{"event_type":"t"}`} {
		if _, err := parsePaddleEvent([]byte(bad)); err == nil {
			t.Fatalf("bad payload %q must fail", bad)
		}
	}
}

// The full B5 money chain at the ledger level: top-up, then a wallet order
// (charge + settle), then a mock withdrawal. Every account nets exactly.
func TestMoneyChainTopupOrderWithdraw(t *testing.T) {
	q := order.QuoteFor(order.QuoteInput{SubtotalMinor: 2000, DistanceKm: 2, Currency: "USD"})
	legs := []ledger.Posting{}
	legs = append(legs, ledger.TopupPostings(q.TotalMinor, "USD", "cust-1")...)
	legs = append(legs, ledger.ChargePostings(q, "cust-1", "ord-1")...)
	legs = append(legs, ledger.SettlementPostings(q, "ord-1", "merch-1", "cour-1")...)
	legs = append(legs, ledger.WithdrawalDebitPostings(100, "USD", "cour-1")...)
	if err := ledger.CheckBalanced(legs); err != nil {
		t.Fatalf("full chain must balance: %v", err)
	}
	net := map[string]int64{}
	for _, leg := range legs {
		net[leg.Account] += leg.AmountMinor
	}
	// Fee math unchanged (AGENTS.md §12): $20 food → platform $2.69.
	if q.TotalMinor != 2230 || q.MerchantPayout != 1800 || q.CourierPayout != 161 || q.PlatformTake != 269 {
		t.Fatalf("fee math moved: %+v", q)
	}
	want := map[string]int64{
		ledger.CustomerWallet("cust-1"):   0,
		ledger.Escrow("ord-1"):            0,
		ledger.MerchantPayable("merch-1"): 1800,
		ledger.CourierEarnings("cour-1"):  61, // 161 earned, 100 withdrawn
		ledger.PlatformRevenue:            269,
		ledger.PayoutClearing:             100,
		ledger.PaddleClearing:             -2230,
	}
	for acct, w := range want {
		if net[acct] != w {
			t.Fatalf("account %s nets %d, want %d (all: %v)", acct, net[acct], w, net)
		}
	}
}

// A failed payout reverses back into earnings: debit + reverse nets zero.
func TestWithdrawFailReverseNetsZero(t *testing.T) {
	debit := ledger.WithdrawalDebitPostings(7600, "IDR", "cour-1")
	reverse := ledger.WithdrawalReversePostings(7600, "IDR", "cour-1")
	net := map[string]int64{}
	for _, leg := range append(debit, reverse...) {
		net[leg.Account] += leg.AmountMinor
	}
	if net[ledger.CourierEarnings("cour-1")] != 0 || net[ledger.PayoutClearing] != 0 {
		t.Fatalf("fail-reverse must restore earnings: %v", net)
	}
}

// Refund routing: wallet orders pay the customer back, card orders return to
// Paddle clearing — both net the escrow to zero.
func TestRefundLegsByMethod(t *testing.T) {
	q := order.QuoteFor(order.QuoteInput{SubtotalMinor: 2000, DistanceKm: 2, Currency: "USD"})
	wallet := orderRow{ID: "o1", CustomerID: "c1", Currency: "USD",
		Subtotal: q.SubtotalMinor, Delivery: q.DeliveryMinor, Service: q.ServiceMinor,
		Tip: q.TipMinor, Total: q.TotalMinor, Commission: q.CommissionMinor, CourierFee: q.CourierFeeMinor,
		PayMethod: "wallet"}
	card := wallet
	card.ID, card.PayMethod = "o2", "card"
	wLegs, wKey := refundLegsFor(wallet)
	if wKey != ledger.RefundKey("o1") {
		t.Fatalf("wallet refund key = %s", wKey)
	}
	foundWallet := false
	for _, leg := range wLegs {
		if leg.Account == ledger.CustomerWallet("c1") && leg.AmountMinor == q.TotalMinor {
			foundWallet = true
		}
	}
	if !foundWallet {
		t.Fatalf("wallet refund must credit the customer: %v", wLegs)
	}
	cLegs, cKey := refundLegsFor(card)
	if cKey != ledger.CardRefundKey("o2") {
		t.Fatalf("card refund key = %s", cKey)
	}
	foundClearing := false
	for _, leg := range cLegs {
		if leg.Account == ledger.PaddleClearing && leg.AmountMinor == q.TotalMinor {
			foundClearing = true
		}
	}
	if !foundClearing {
		t.Fatalf("card refund must return to Paddle clearing: %v", cLegs)
	}
	if err := ledger.CheckBalanced(append(ledger.CardChargePostings(q, "o2"), cLegs...)); err != nil {
		t.Fatalf("card charge+refund must net to zero: %v", err)
	}
}

// Sandbox-only guard: only the Paddle sandbox provider moves card money.
func TestCardPaymentsGuard(t *testing.T) {
	for provider, want := range map[string]bool{"paddle_sandbox": true, "paddle": false, "": false, "stripe": false} {
		cfg := &config.Config{}
		cfg.Payments.Provider = provider
		s := &Server{cfg: cfg}
		if got := s.cardPaymentsEnabled(); got != want {
			t.Fatalf("provider %q enabled=%v, want %v", provider, got, want)
		}
	}
}

func TestMockPayout(t *testing.T) {
	ref, err := mockPayout(context.Background(), withdrawalRow{ID: "w-1", AmountMinor: 100, Currency: "USD"})
	if err != nil || ref == "" {
		t.Fatalf("mock payout must approve with a ref, got %q %v", ref, err)
	}
}

// All B5 routes must register without mux conflicts (notably the static
// /deliveries/history beside /deliveries/{id}).
func TestRoutesRegister(t *testing.T) {
	cfg := &config.Config{}
	s := &Server{cfg: cfg}
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("Routes() panicked: %v", r)
		}
	}()
	if s.Routes() == nil {
		t.Fatal("Routes() must return a handler")
	}
}

func TestValidCurrency(t *testing.T) {
	for _, ok := range []string{"USD", "IDR", "GBP"} {
		if !validCurrency(ok) {
			t.Fatalf("%s must be valid", ok)
		}
	}
	for _, bad := range []string{"", "US", "USDD", "usd", "12X", "U D"} {
		if validCurrency(bad) {
			t.Fatalf("%q must be invalid", bad)
		}
	}
}
