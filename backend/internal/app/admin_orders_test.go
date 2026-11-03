package app

import (
	"strings"
	"testing"
)

// A7 admin orders: filter allowlist + refund policy. Both are pure, so they
// are unit-tested without a database (same style as TestParseReviewStatus).

func TestParseOrderStatusFilter(t *testing.T) {
	for _, st := range []string{
		"awaiting_payment", "placed", "accepted", "ready", "picked_up",
		"delivered", "completed", "rejected", "cancelled",
	} {
		got, ok := parseOrderStatusFilter(st)
		if !ok || got != st {
			t.Fatalf("parseOrderStatusFilter(%q) = %q,%v, want %q,true", st, got, ok, st)
		}
	}
	if got, ok := parseOrderStatusFilter(""); !ok || got != "" {
		t.Fatalf("empty filter must mean all, got %q,%v", got, ok)
	}
	if got, ok := parseOrderStatusFilter(" Placed "); !ok || got != "placed" {
		t.Fatalf("filter must trim+lowercase, got %q,%v", got, ok)
	}
	// Injection-flavoured and unknown values must never reach SQL.
	for _, bad := range []string{
		"placed' OR '1'='1", "accepted; DROP TABLE orders", "pending",
		"frozen", "banned", "refunded", "all",
	} {
		if _, ok := parseOrderStatusFilter(bad); ok {
			t.Fatalf("parseOrderStatusFilter(%q) must be rejected", bad)
		}
	}
}

func TestAdminRefundPlan(t *testing.T) {
	// Pre-pickup support cases are refundable.
	for _, st := range []string{"placed", "accepted", "ready"} {
		action, msg := adminRefundPlan(st, "held")
		if action != adminRefundMoneyBack || msg != "" {
			t.Fatalf("adminRefundPlan(%q, held) = %q/%q, want refund/empty", st, action, msg)
		}
	}
	// Awaiting payment cancels without ledger legs.
	if action, msg := adminRefundPlan("awaiting_payment", "unpaid"); action != adminRefundCancel || msg != "" {
		t.Fatalf("awaiting_payment must cancel_unpaid, got %q/%q", action, msg)
	}
	// Already refunded is a conflict whatever the status.
	if action, msg := adminRefundPlan("placed", "refunded"); action != adminRefundNone || msg == "" {
		t.Fatalf("refunded money must conflict, got %q/%q", action, msg)
	}
	// Terminal states conflict and name the state (completed orders keep
	// payment_status held — settlement splits the escrow but never rewrites
	// the order row — so completed is reachable here with "held").
	for _, st := range []string{"rejected", "cancelled", "completed"} {
		pay := "refunded"
		if st == "completed" {
			pay = "held"
		}
		action, msg := adminRefundPlan(st, pay)
		if action != adminRefundNone || !strings.Contains(msg, st) {
			t.Fatalf("terminal %q must conflict naming the state, got %q/%q", st, action, msg)
		}
	}
	// Picked up needs reassign/finance; delivered is settled.
	if _, msg := adminRefundPlan("picked_up", "held"); !strings.Contains(msg, "picked up") {
		t.Fatalf("picked_up must point at reassign/finance, got %q", msg)
	}
	if _, msg := adminRefundPlan("delivered", "held"); !strings.Contains(msg, "settled") {
		t.Fatalf("delivered must point at finance, got %q", msg)
	}
	// Unknown statuses never refund.
	if action, _ := adminRefundPlan("flying", "held"); action != adminRefundNone {
		t.Fatalf("unknown status must not refund, got %q", action)
	}
}
