// Package ledger validates Trackfud double-entry postings and builds the
// balanced posting sets for each money movement (AGENTS.md §11).
//
// A Posting moves integer minor units between named accounts; a set of
// postings is valid only when amounts sum to zero per currency. Funds flow:
// wallet pay (customer_wallet → order_escrow), refund before pickup
// (order_escrow → customer_wallet), settlement on delivered
// (order_escrow → merchant_payable + courier_earnings + platform_revenue).
// Database persistence (journal_entries + postings rows, balance cache,
// idempotency_key UNIQUE) lives in the httpapi store layer; this package
// keeps the pure validation and construction rules unit-testable.
package ledger

import (
	"errors"
	"math"
	"sort"

	"Trackfud/internal/order"
)

// Errors for unbalanced or malformed posting sets.
var (
	ErrEmpty      = errors.New("ledger: no postings")
	ErrUnbalanced = errors.New("ledger: postings do not sum to zero")
	ErrCurrency   = errors.New("ledger: posting missing currency")
)

// Posting is one leg of a journal entry: a positive amount credits the
// account, a negative amount debits it.
type Posting struct {
	Account     string
	AmountMinor int64
	Currency    string
}

// Account names. Wallet-style accounts carry the owner id after a colon.
// PaddleClearing is a receivable, not a fund: webhook legs debit it before
// any settlement batch runs, so it legitimately sits negative ("Paddle owes
// us") and is exempt from the ledger_accounts non-negative floor
// (migration 00013). Every other kind must never go below zero.
const (
	PlatformRevenue = "platform_revenue:global"
	PaddleClearing  = "paddle_clearing:global"
	PayoutClearing  = "payout_clearing:global"
	// FxPosition bridges the two sides of an FX-converted charge: it receives
	// the charged currency and pays out the credited one, so it holds a
	// cross-currency position by design and shares paddle_clearing's
	// exemption from the non-negative balance floor (migration 00014).
	FxPosition = "fx_position:global"
)

// CustomerWallet names a customer's wallet account.
func CustomerWallet(userID string) string { return "customer_wallet:" + userID }

// Escrow names the holding account for one order.
func Escrow(orderID string) string { return "order_escrow:" + orderID }

// MerchantPayable names a merchant's earnings account.
func MerchantPayable(merchantID string) string { return "merchant_payable:" + merchantID }

// CourierEarnings names a courier's earnings account.
func CourierEarnings(courierID string) string { return "courier_earnings:" + courierID }

// CheckBalanced verifies that postings are non-empty and sum to zero within
// every currency present.
func CheckBalanced(p []Posting) error {
	if len(p) == 0 {
		return ErrEmpty
	}
	sums := map[string]int64{}
	for _, leg := range p {
		if leg.Currency == "" {
			return ErrCurrency
		}
		sums[leg.Currency] += leg.AmountMinor
	}
	for _, sum := range sums {
		if sum != 0 {
			return ErrUnbalanced
		}
	}
	return nil
}

// Currencies returns the sorted currency codes touched by a posting set.
func Currencies(p []Posting) []string {
	seen := map[string]bool{}
	for _, leg := range p {
		seen[leg.Currency] = true
	}
	out := make([]string, 0, len(seen))
	for c := range seen {
		out = append(out, c)
	}
	sort.Strings(out)
	return out
}

// ChargePostings debits the customer's wallet and holds the total in the
// order's escrow account (wallet pay, AGENTS.md §11.1 step 3).
func ChargePostings(q order.Quote, customerID, orderID string) []Posting {
	return []Posting{
		{Account: CustomerWallet(customerID), AmountMinor: -q.TotalMinor, Currency: q.Currency},
		{Account: Escrow(orderID), AmountMinor: q.TotalMinor, Currency: q.Currency},
	}
}

// RefundPostings releases the full held total back to the customer's wallet
// (instant wallet refund for reject/timeout/cancel before pickup).
func RefundPostings(q order.Quote, customerID, orderID string) []Posting {
	return []Posting{
		{Account: Escrow(orderID), AmountMinor: -q.TotalMinor, Currency: q.Currency},
		{Account: CustomerWallet(customerID), AmountMinor: q.TotalMinor, Currency: q.Currency},
	}
}

// SettlementPostings splits the held escrow on delivered: the merchant keeps
// food minus commission, the courier keeps the delivery fee minus the 5%
// platform share plus the full tip, and the platform keeps the rest.
func SettlementPostings(q order.Quote, orderID, merchantID, courierID string) []Posting {
	return []Posting{
		{Account: Escrow(orderID), AmountMinor: -q.TotalMinor, Currency: q.Currency},
		{Account: MerchantPayable(merchantID), AmountMinor: q.MerchantPayout, Currency: q.Currency},
		{Account: CourierEarnings(courierID), AmountMinor: q.CourierPayout, Currency: q.Currency},
		{Account: PlatformRevenue, AmountMinor: q.PlatformTake, Currency: q.Currency},
	}
}

// TopupPostings credits a wallet top-up confirmed by Paddle: clearing pays
// the customer's wallet (B5 money real paths).
func TopupPostings(amountMinor int64, currency, userID string) []Posting {
	return []Posting{
		{Account: PaddleClearing, AmountMinor: -amountMinor, Currency: currency},
		{Account: CustomerWallet(userID), AmountMinor: amountMinor, Currency: currency},
	}
}

// CardChargePostings holds a card-paid order total in the order's escrow
// (the card leg of the shared Paddle path; settlement is identical after).
func CardChargePostings(q order.Quote, orderID string) []Posting {
	return []Posting{
		{Account: PaddleClearing, AmountMinor: -q.TotalMinor, Currency: q.Currency},
		{Account: Escrow(orderID), AmountMinor: q.TotalMinor, Currency: q.Currency},
	}
}

// CardRefundPostings returns a card-paid escrow to Paddle clearing (the card
// refund; Paddle settles it back to the card off-ledger).
func CardRefundPostings(q order.Quote, orderID string) []Posting {
	return []Posting{
		{Account: Escrow(orderID), AmountMinor: -q.TotalMinor, Currency: q.Currency},
		{Account: PaddleClearing, AmountMinor: q.TotalMinor, Currency: q.Currency},
	}
}

// FxTopupPostings credits an FX-converted top-up: Paddle charged chargeMinor
// in chargeCur (e.g. USD), the customer receives creditMinor in creditCur
// (e.g. IDR) in full. Each currency nets to zero through the fx_position
// bridge, which carries the cross as the platform's FX position.
func FxTopupPostings(chargeMinor int64, chargeCur string, creditMinor int64, creditCur, userID string) []Posting {
	return []Posting{
		{Account: PaddleClearing, AmountMinor: -chargeMinor, Currency: chargeCur},
		{Account: FxPosition, AmountMinor: chargeMinor, Currency: chargeCur},
		{Account: FxPosition, AmountMinor: -creditMinor, Currency: creditCur},
		{Account: CustomerWallet(userID), AmountMinor: creditMinor, Currency: creditCur},
	}
}

// FxCardChargePostings holds an FX-converted card payment in the order's
// escrow (credited currency), balanced against the charged currency through
// fx_position. Settlement afterwards is identical (same-currency escrow out).
func FxCardChargePostings(chargeMinor int64, chargeCur string, q order.Quote, orderID string) []Posting {
	return []Posting{
		{Account: PaddleClearing, AmountMinor: -chargeMinor, Currency: chargeCur},
		{Account: FxPosition, AmountMinor: chargeMinor, Currency: chargeCur},
		{Account: FxPosition, AmountMinor: -q.TotalMinor, Currency: q.Currency},
		{Account: Escrow(orderID), AmountMinor: q.TotalMinor, Currency: q.Currency},
	}
}

// zeroDecimal lists the currencies this platform counts in whole major units
// (no sen/cents): IDR prices are stored as whole rupiah (seed: a Rp25.000 set
// is 25000 minor), plus the standard zero-decimal set. ConvertMinor moves
// between minor-unit scales through major units using this map.
var zeroDecimal = map[string]bool{
	"IDR": true, "JPY": true, "KRW": true, "CLP": true, "VND": true,
}

// minorExp returns the minor-unit exponent for a currency (0 for zero-decimal
// ones like JPY, 2 for everything else we handle).
func minorExp(cur string) int {
	if zeroDecimal[cur] {
		return 0
	}
	return 2
}

func pow10(n int) int64 {
	p := int64(1)
	for i := 0; i < n; i++ {
		p *= 10
	}
	return p
}

// ConvertMinor converts amountMinor from one currency to another at a
// major-unit rate (units of `to` per one unit of `from`, as stored in
// fx_rates), rounding half up to the target minor unit. Pure display/pricing
// math — money itself stays integer minor units in the ledger.
func ConvertMinor(amountMinor int64, from, to string, rate float64) int64 {
	if rate <= 0 {
		return 0
	}
	major := float64(amountMinor) / float64(pow10(minorExp(from)))
	return int64(math.Round(major * rate * float64(pow10(minorExp(to)))))
}

// WithdrawalDebitPostings moves courier earnings into payout clearing while
// the mock provider settles (B5 mock payouts).
func WithdrawalDebitPostings(amountMinor int64, currency, courierID string) []Posting {
	return []Posting{
		{Account: CourierEarnings(courierID), AmountMinor: -amountMinor, Currency: currency},
		{Account: PayoutClearing, AmountMinor: amountMinor, Currency: currency},
	}
}

// WithdrawalReversePostings returns clearing money to earnings when a payout
// fails or an admin holds a debited withdrawal (fail-reverse).
func WithdrawalReversePostings(amountMinor int64, currency, courierID string) []Posting {
	return []Posting{
		{Account: PayoutClearing, AmountMinor: -amountMinor, Currency: currency},
		{Account: CourierEarnings(courierID), AmountMinor: amountMinor, Currency: currency},
	}
}

// ChargeKey is the deterministic journal idempotency key for the wallet
// charge of an order; RefundKey and SettleKey follow the same scheme so a
// retried webhook or timeout race can never double-post.
func ChargeKey(orderID string) string    { return "order:" + orderID + ":wallet_charge" }
func RefundKey(orderID string) string    { return "order:" + orderID + ":refund" }
func SettleKey(orderID string) string    { return "order:" + orderID + ":settle" }
func TopupKey(userID, ref string) string { return "wallet:" + userID + ":topup:" + ref }

// CardChargeKey and CardRefundKey cover the card-paid order legs; WithdrawKey
// and WithdrawReverseKey cover the mock payout debit and its fail-reverse.
// Deterministic per payment/withdrawal, so retried webhooks and workers pay once.
func CardChargeKey(orderID string) string    { return "order:" + orderID + ":card_charge" }
func CardRefundKey(orderID string) string    { return "order:" + orderID + ":card_refund" }
func WithdrawKey(withdrawalID string) string { return "withdrawal:" + withdrawalID + ":debit" }
func WithdrawReverseKey(withdrawalID string) string {
	return "withdrawal:" + withdrawalID + ":reverse"
}
