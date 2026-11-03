package app

import (
	"testing"
	"time"
)

// The accept promise is shared by acceptOrder and the GBK seed: prep drives
// ready_at_est, the 30–60 min window drives window_start/window_end, and a
// merchant without prep falls back to the 15 min default.
func TestAcceptTimingPromise(t *testing.T) {
	accepted := time.Date(2026, 11, 3, 11, 4, 0, 0, time.UTC)
	ready, ws, we := acceptTiming{PrepMin: 12, WindowMinMin: 30, WindowMaxMin: 60}.at(accepted)
	if want := accepted.Add(12 * time.Minute); !ready.Equal(want) {
		t.Fatalf("ready_at_est = %v, want %v", ready, want)
	}
	if !ws.Equal(accepted.Add(30*time.Minute)) || !we.Equal(accepted.Add(60*time.Minute)) {
		t.Fatalf("window = %v..%v", ws, we)
	}
	ready, _, _ = acceptTiming{PrepMin: 0, WindowMinMin: 30, WindowMaxMin: 60}.at(accepted)
	if want := accepted.Add(defaultPrepMinutes * time.Minute); !ready.Equal(want) {
		t.Fatalf("missing prep must default to %d min, got %v", defaultPrepMinutes, ready)
	}
	// A seeded delivered order (accepted +3 min, delivered +28 min after
	// placement) lands inside its window, so in-window rates read real data.
	placed := accepted.Add(-3 * time.Minute)
	_, _, we = acceptTiming{PrepMin: 15, WindowMinMin: 30, WindowMaxMin: 60}.at(placed.Add(3 * time.Minute))
	if delivered := placed.Add(28 * time.Minute); delivered.After(we) {
		t.Fatalf("seeded delivery %v must be inside window_end %v", delivered, we)
	}
}

// Seeded placed orders get no delivery row (the live lifecycle creates it
// at merchant accept); every later status keeps its delivery state.
func TestGBKSeedDeliveryStatus(t *testing.T) {
	if st, ok := gbkSeedDeliveryStatus("placed"); ok || st != "" {
		t.Fatalf("placed must have no delivery, got %q %v", st, ok)
	}
	for order, want := range map[string]string{
		"accepted":  DeliveryAssigned,
		"ready":     DeliveryAssigned,
		"picked_up": DeliveryPickedUp,
		"delivered": DeliveryDelivered,
		"completed": DeliveryDelivered,
		"cancelled": DeliveryCancelled,
	} {
		if st, ok := gbkSeedDeliveryStatus(order); !ok || st != want {
			t.Fatalf("order %q → delivery %q,%v, want %q", order, st, ok, want)
		}
	}
}
