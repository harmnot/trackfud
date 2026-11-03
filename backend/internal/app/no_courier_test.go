package app

import (
	"strings"
	"testing"

	"Trackfud/internal/order"
)

var allOrderStatuses = []string{
	order.StatusAwaitingPayment, order.StatusPlaced, order.StatusAccepted, order.StatusReady,
	order.StatusPickedUp, order.StatusDelivered, order.StatusCompleted,
	order.StatusRejected, order.StatusCancelled,
}

var allDeliveryStatuses = []string{
	DeliverySearching, DeliveryOffered, DeliveryAssigned, DeliveryAtPickup, DeliveryPickedUp,
	DeliveryAtDropoff, DeliveryDelivered, DeliveryStaffSearch, DeliveryNoCourier, DeliveryCancelled,
}

// The choices open exactly when dispatch gave up on an order the kitchen
// accepted and nobody collected: accepted or ready, delivery no_courier,
// nobody on it. The old "placed" window never has a delivery at all.
func TestNoCourierChoiceAllowed(t *testing.T) {
	for _, st := range allOrderStatuses {
		for _, ds := range allDeliveryStatuses {
			want := ds == DeliveryNoCourier && (st == order.StatusAccepted || st == order.StatusReady)
			if got := noCourierChoiceAllowed(st, ds, false); got != want {
				t.Fatalf("order %q + delivery %q: allowed=%v, want %v", st, ds, got, want)
			}
			if noCourierChoiceAllowed(st, ds, true) {
				t.Fatalf("order %q + delivery %q with a courier must never allow a choice", st, ds)
			}
		}
	}
}

// Every status the guard admits must be cancellable by the order machine,
// so the cancel choice never dead-ends in a forbidden transition (the old
// handler hardcoded accepted and 409'd every ready order).
func TestNoCourierCancelTransitionLegal(t *testing.T) {
	admitted := 0
	for _, st := range allOrderStatuses {
		if !noCourierChoiceAllowed(st, DeliveryNoCourier, false) {
			continue
		}
		admitted++
		if err := order.Check(st, order.StatusCancelled); err != nil {
			t.Fatalf("no-courier cancel from %q must be a legal transition: %v", st, err)
		}
	}
	if admitted != 2 {
		t.Fatalf("guard admits %d order statuses, want accepted + ready", admitted)
	}
}

func TestIsNoCourierChoice(t *testing.T) {
	for _, ok := range []string{"wait_more", "pickup", "cancel"} {
		if !isNoCourierChoice(ok) {
			t.Fatalf("%q must be a valid choice", ok)
		}
	}
	for _, bad := range []string{"", "wait", "WAIT_MORE", "refund", "pickup "} {
		if isNoCourierChoice(bad) {
			t.Fatalf("%q must be rejected", bad)
		}
	}
}

// The pickup switch persists as cancelled + customer_pickup note, so only
// that pair reads as self-pickup and it can never re-enter a courier wave.
func TestIsCustomerPickup(t *testing.T) {
	if !isCustomerPickup(DeliveryCancelled, DeliveryCustomerPick) {
		t.Fatal("cancelled + customer_pickup note must read as self-pickup")
	}
	for _, note := range []string{"", noteNoCourierCancel, "merchant_cancel", "admin_refund"} {
		if isCustomerPickup(DeliveryCancelled, note) {
			t.Fatalf("cancel note %q must not read as self-pickup", note)
		}
	}
	if isCustomerPickup(DeliveryNoCourier, DeliveryCustomerPick) {
		t.Fatal("a live no_courier row is not a pickup yet")
	}
	if canRestartCourierSearch(DeliveryCancelled, false) {
		t.Fatal("a self-pickup (cancelled) delivery must never restart the courier search")
	}
}

// The release SQL is the race guard shared by pickup and cancel: only an
// unclaimed row still in no_courier may close.
func TestReleaseNoCourierSQL(t *testing.T) {
	for _, want := range []string{"status='cancelled'", "cancel_note=$2", "status='no_courier'", "courier_id IS NULL"} {
		if !strings.Contains(releaseNoCourierSQL, want) {
			t.Fatalf("release SQL must contain %q", want)
		}
	}
}
