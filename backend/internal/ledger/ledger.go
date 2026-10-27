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
const (
	PlatformRevenue = "platform_revenue:global"
	PaddleClearing  = "paddle_clearing:global"
	PayoutClearing  = "payout_clearing:global"
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
