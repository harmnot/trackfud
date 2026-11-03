package ledger

import (
	"testing"

	"Trackfud/internal/order"
)

func sampleQuote() order.Quote {
	return order.QuoteFor(order.QuoteInput{SubtotalMinor: 2000, DistanceKm: 2, Currency: "USD", TipMinor: 300})
}

func TestChargeBalances(t *testing.T) {
	q := sampleQuote()
	p := ChargePostings(q, "cust-1", "ord-1")
	if err := CheckBalanced(p); err != nil {
		t.Fatalf("charge must balance: %v", err)
	}
	if len(p) != 2 {
		t.Fatalf("expected 2 charge legs, got %d", len(p))
	}
}

func TestRefundReversesCharge(t *testing.T) {
	q := sampleQuote()
	charge := ChargePostings(q, "cust-1", "ord-1")
	refund := RefundPostings(q, "cust-1", "ord-1")
	if err := CheckBalanced(refund); err != nil {
		t.Fatalf("refund must balance: %v", err)
	}
	// Charge + refund nets every account to zero.
	if err := CheckBalanced(append(charge, refund...)); err != nil {
		t.Fatalf("charge+refund must net to zero: %v", err)
	}
}

func TestSettlementBalancesAndDistributes(t *testing.T) {
	q := sampleQuote()
	p := SettlementPostings(q, "ord-1", "merch-1", "cour-1")
	if err := CheckBalanced(p); err != nil {
		t.Fatalf("settlement must balance: %v", err)
	}
	// Settlement + original charge nets escrow to zero and pays out the total.
	all := append(ChargePostings(q, "cust-1", "ord-1"), p...)
	if err := CheckBalanced(all); err != nil {
		t.Fatalf("charge+settlement must balance: %v", err)
	}
	paid := int64(0)
	for _, leg := range p {
		if leg.Account != Escrow("ord-1") {
			paid += leg.AmountMinor
		}
	}
	if paid != q.TotalMinor {
		t.Fatalf("payouts %d != charged total %d", paid, q.TotalMinor)
	}
}

func TestUnbalancedRejected(t *testing.T) {
	p := []Posting{
		{Account: "a", AmountMinor: -100, Currency: "USD"},
		{Account: "b", AmountMinor: 90, Currency: "USD"},
	}
	if err := CheckBalanced(p); err != ErrUnbalanced {
		t.Fatalf("expected unbalanced, got %v", err)
	}
}

func TestMixedCurrencyEachMustBalance(t *testing.T) {
	ok := []Posting{
		{Account: "a", AmountMinor: -100, Currency: "USD"},
		{Account: "b", AmountMinor: 100, Currency: "USD"},
		{Account: "a", AmountMinor: -5000, Currency: "IDR"},
		{Account: "b", AmountMinor: 5000, Currency: "IDR"},
	}
	if err := CheckBalanced(ok); err != nil {
		t.Fatalf("per-currency balanced sets must pass: %v", err)
	}
	bad := []Posting{
		{Account: "a", AmountMinor: -100, Currency: "USD"},
		{Account: "b", AmountMinor: 100, Currency: "USD"},
		{Account: "a", AmountMinor: -5000, Currency: "IDR"},
		{Account: "b", AmountMinor: 4000, Currency: "IDR"},
	}
	if err := CheckBalanced(bad); err != ErrUnbalanced {
		t.Fatalf("expected unbalanced IDR leg, got %v", err)
	}
}

func TestEmptyAndCurrencyErrors(t *testing.T) {
	if err := CheckBalanced(nil); err != ErrEmpty {
		t.Fatalf("expected empty, got %v", err)
	}
	if err := CheckBalanced([]Posting{{Account: "a", AmountMinor: 0}}); err != ErrCurrency {
		t.Fatalf("expected currency error, got %v", err)
	}
}

func TestTopupBalances(t *testing.T) {
	p := TopupPostings(59500, "IDR", "cust-1")
	if err := CheckBalanced(p); err != nil {
		t.Fatalf("topup must balance: %v", err)
	}
	// Top-up then wallet order: the wallet nets to zero when the top-up
	// covers the order exactly.
	q := order.QuoteFor(order.QuoteInput{SubtotalMinor: 50000, DistanceKm: 2, Currency: "IDR"})
	top := TopupPostings(q.TotalMinor, "IDR", "cust-1")
	all := append(top, ChargePostings(q, "cust-1", "ord-1")...)
	if err := CheckBalanced(all); err != nil {
		t.Fatalf("topup+charge must balance: %v", err)
	}
	net := map[string]int64{}
	for _, leg := range all {
		net[leg.Account] += leg.AmountMinor
	}
	if net[CustomerWallet("cust-1")] != 0 || net[Escrow("ord-1")] != q.TotalMinor {
		t.Fatalf("unexpected topup+charge nets: %v", net)
	}
}

func TestCardChargeRefund(t *testing.T) {
	q := sampleQuote()
	charge := CardChargePostings(q, "ord-1")
	if err := CheckBalanced(charge); err != nil {
		t.Fatalf("card charge must balance: %v", err)
	}
	refund := CardRefundPostings(q, "ord-1")
	if err := CheckBalanced(refund); err != nil {
		t.Fatalf("card refund must balance: %v", err)
	}
	if err := CheckBalanced(append(charge, refund...)); err != nil {
		t.Fatalf("card charge+refund must net to zero: %v", err)
	}
	// Card charge settles exactly like a wallet charge: same split.
	settled := append(append([]Posting{}, charge...), SettlementPostings(q, "ord-1", "merch-1", "cour-1")...)
	if err := CheckBalanced(settled); err != nil {
		t.Fatalf("card charge+settlement must balance: %v", err)
	}
	net := map[string]int64{}
	for _, leg := range settled {
		net[leg.Account] += leg.AmountMinor
	}
	if net[Escrow("ord-1")] != 0 {
		t.Fatalf("escrow must net to zero after settlement: %v", net)
	}
	if net[CourierEarnings("cour-1")] != q.CourierPayout || net[MerchantPayable("merch-1")] != q.MerchantPayout {
		t.Fatalf("card settlement split wrong: %v", net)
	}
}

func TestWithdrawalDebitReverse(t *testing.T) {
	debit := WithdrawalDebitPostings(7600, "IDR", "cour-1")
	if err := CheckBalanced(debit); err != nil {
		t.Fatalf("withdrawal debit must balance: %v", err)
	}
	reverse := WithdrawalReversePostings(7600, "IDR", "cour-1")
	if err := CheckBalanced(append(debit, reverse...)); err != nil {
		t.Fatalf("debit+reverse must net to zero: %v", err)
	}
}

func TestIdempotencyKeysDeterministic(t *testing.T) {
	// Same order always maps to the same keys (safe retries), and the three
	// lifecycle keys differ so charge/refund/settle can never collide.
	if ChargeKey("o1") != ChargeKey("o1") || RefundKey("o1") != RefundKey("o1") || SettleKey("o1") != SettleKey("o1") {
		t.Fatal("keys must be deterministic")
	}
	seen := map[string]bool{ChargeKey("o1"): true, RefundKey("o1"): true, SettleKey("o1"): true}
	if len(seen) != 3 {
		t.Fatal("charge/refund/settle keys must differ")
	}
	if ChargeKey("o1") == ChargeKey("o2") {
		t.Fatal("keys must differ per order")
	}
}

func TestB5KeysDeterministic(t *testing.T) {
	// Every B5 money move has a deterministic journal key so retried
	// webhooks and workers post once; all keys in the family differ.
	keys := []string{
		TopupKey("u1", "p1"), CardChargeKey("o1"), CardRefundKey("o1"),
		WithdrawKey("w1"), WithdrawReverseKey("w1"),
	}
	seen := map[string]bool{}
	for _, k := range keys {
		if k == "" || seen[k] {
			t.Fatalf("B5 keys must be non-empty and distinct: %v", keys)
		}
		seen[k] = true
	}
	if TopupKey("u1", "p1") != TopupKey("u1", "p1") || WithdrawKey("w1") != WithdrawKey("w1") {
		t.Fatal("B5 keys must be deterministic")
	}
	if TopupKey("u1", "p1") == TopupKey("u1", "p2") || WithdrawKey("w1") == WithdrawKey("w2") {
		t.Fatal("B5 keys must differ per payment/withdrawal")
	}
	if CardChargeKey("o1") == ChargeKey("o1") || CardRefundKey("o1") == RefundKey("o1") {
		t.Fatal("card keys must not collide with wallet keys")
	}
}

// FxTopupPostings: USD charged, IDR credited in full, zero per currency.
func TestFxTopupPostings(t *testing.T) {
	legs := FxTopupPostings(62, "USD", 10000, "IDR", "u1")
	if err := CheckBalanced(legs); err != nil {
		t.Fatalf("FX top-up legs must balance per currency: %v", err)
	}
	if got := Currencies(legs); len(got) != 2 || got[0] != "IDR" || got[1] != "USD" {
		t.Fatalf("FX top-up must touch exactly IDR+USD: %v", got)
	}
	var wallet, clearing int64
	for _, l := range legs {
		switch l.Account {
		case CustomerWallet("u1"):
			if l.Currency != "IDR" {
				t.Fatalf("wallet leg must be IDR: %+v", l)
			}
			wallet = l.AmountMinor
		case PaddleClearing:
			if l.Currency != "USD" {
				t.Fatalf("clearing leg must be USD: %+v", l)
			}
			clearing = l.AmountMinor
		}
	}
	if wallet != 10000 {
		t.Fatalf("customer must receive the full IDR amount, got %d", wallet)
	}
	if clearing != -62 {
		t.Fatalf("clearing must be debited the USD charge, got %d", clearing)
	}
}

// ConvertMinor: major-unit rate across minor-unit scales, half up.
func TestConvertMinor(t *testing.T) {
	// Seed row: 1 IDR = 6.1728e-05 USD → Rp10.000 ≈ $0.62 (61.7c → 62c).
	if got := ConvertMinor(10000, "IDR", "USD", 6.1728e-05); got != 62 {
		t.Fatalf("IDR->USD conversion = %d, want 62", got)
	}
	if got := ConvertMinor(100, "USD", "USD", 1); got != 100 {
		t.Fatalf("identity conversion must pass through, got %d", got)
	}
	if got := ConvertMinor(10000, "IDR", "USD", 0); got != 0 {
		t.Fatalf("non-positive rate must convert to 0, got %d", got)
	}
	// Zero-decimal target: $1.00 → ¥151 at 151 JPY/USD.
	if got := ConvertMinor(100, "USD", "JPY", 151); got != 151 {
		t.Fatalf("USD->JPY conversion = %d, want 151", got)
	}
}
