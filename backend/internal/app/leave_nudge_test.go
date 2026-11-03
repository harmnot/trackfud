package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// stringsRow scans its values into *string destinations in order.
type stringsRow struct {
	vals []string
	err  error
}

func (r stringsRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for i, d := range dest {
		if p, ok := d.(*string); ok && i < len(r.vals) {
			*p = r.vals[i]
		}
	}
	return nil
}

// Regression: the guarded UPDATE used $1 without passing the delivery id,
// so it always errored and the "Head to <merchant> now" push + the
// delivery.leave_now frame never fired. The seam must bind exactly the
// delivery id and keep the once-only / still-before-pickup guards.
func TestClaimLeaveNudgeBindsDelivery(t *testing.T) {
	ctx := context.Background()
	f := &fakeClaimer{row: stringsRow{vals: []string{"courier-gbk-runner-1", "order-gbk-17"}}}
	courier, orderID, ok, err := claimLeaveNudge(ctx, f, "delivery-gbk-17")
	if err != nil || !ok {
		t.Fatalf("claim must succeed, got ok=%v err=%v", ok, err)
	}
	if courier != "courier-gbk-runner-1" || orderID != "order-gbk-17" {
		t.Fatalf("claim returned courier=%q order=%q", courier, orderID)
	}
	if len(f.gotArgs) != 1 || f.gotArgs[0] != "delivery-gbk-17" {
		t.Fatalf("claim must bind exactly the delivery id, got %v", f.gotArgs)
	}
	if strings.Contains(f.gotSQL, "$2") {
		t.Fatal("leave nudge SQL must take a single placeholder")
	}
	for _, want := range []string{"id=$1", "nudged_at IS NULL", "status IN ('assigned','at_pickup')", "RETURNING courier_id, order_id"} {
		if !strings.Contains(f.gotSQL, want) {
			t.Fatalf("leave nudge SQL must contain %q", want)
		}
	}
}

// Already nudged (or past pickup) is a quiet no-op; real DB errors surface.
func TestClaimLeaveNudgeOutcomes(t *testing.T) {
	ctx := context.Background()
	if _, _, ok, err := claimLeaveNudge(ctx, &fakeClaimer{row: stringsRow{err: pgx.ErrNoRows}}, "d"); ok || err != nil {
		t.Fatalf("0 rows must be ok=false without error, got ok=%v err=%v", ok, err)
	}
	boom := errors.New("connection reset")
	if _, _, ok, err := claimLeaveNudge(ctx, &fakeClaimer{row: stringsRow{err: boom}}, "d"); ok || !errors.Is(err, boom) {
		t.Fatalf("db error must surface, got ok=%v err=%v", ok, err)
	}
}
