package order

import "testing"

func TestAllowedTransitions(t *testing.T) {
	allowedPairs := [][2]string{
		{StatusAwaitingPayment, StatusPlaced},
		{StatusAwaitingPayment, StatusCancelled},
		{StatusPlaced, StatusAccepted},
		{StatusPlaced, StatusRejected},
		{StatusPlaced, StatusCancelled},
		{StatusAccepted, StatusReady},
		{StatusAccepted, StatusCancelled},
		{StatusReady, StatusPickedUp},
		{StatusPickedUp, StatusDelivered},
		{StatusDelivered, StatusCompleted},
	}
	allowSet := map[[2]string]bool{}
	for _, p := range allowedPairs {
		allowSet[p] = true
		if err := Check(p[0], p[1]); err != nil {
			t.Fatalf("expected %s -> %s to be allowed: %v", p[0], p[1], err)
		}
		if !Can(p[0], p[1]) {
			t.Fatalf("expected Can(%s, %s) true", p[0], p[1])
		}
	}
	statuses := []string{
		StatusAwaitingPayment, StatusPlaced, StatusAccepted, StatusReady,
		StatusPickedUp, StatusDelivered, StatusCompleted, StatusRejected, StatusCancelled,
	}
	for _, from := range statuses {
		for _, to := range statuses {
			if from == to || allowSet[[2]string{from, to}] {
				continue
			}
			if err := Check(from, to); err != ErrForbiddenTransition {
				t.Fatalf("expected %s -> %s forbidden, got %v", from, to, err)
			}
		}
	}
}

func TestForbiddenShortcuts(t *testing.T) {
	// Jumps that skip a lifecycle step must never be allowed.
	for _, p := range [][2]string{
		{StatusPlaced, StatusReady},
		{StatusPlaced, StatusPickedUp},
		{StatusPlaced, StatusDelivered},
		{StatusPlaced, StatusCompleted},
		{StatusAccepted, StatusPickedUp},
		{StatusAccepted, StatusDelivered},
		{StatusAccepted, StatusPlaced},
		{StatusReady, StatusDelivered},
		{StatusReady, StatusAccepted},
		{StatusPickedUp, StatusReady},
		{StatusPickedUp, StatusCompleted},
		{StatusDelivered, StatusPickedUp},
		{StatusAwaitingPayment, StatusAccepted},
		{StatusRejected, StatusPlaced},
		{StatusCancelled, StatusPlaced},
		{StatusCompleted, StatusDelivered},
	} {
		if err := Check(p[0], p[1]); err != ErrForbiddenTransition {
			t.Fatalf("expected %s -> %s forbidden, got %v", p[0], p[1], err)
		}
	}
}

func TestUnknownStatus(t *testing.T) {
	if err := Check("flying", StatusPlaced); err != ErrUnknownStatus {
		t.Fatalf("expected unknown status, got %v", err)
	}
	if err := Check(StatusPlaced, "flying"); err != ErrUnknownStatus {
		t.Fatalf("expected unknown status, got %v", err)
	}
}

func TestTerminal(t *testing.T) {
	for _, s := range []string{StatusCompleted, StatusRejected, StatusCancelled} {
		if !Terminal(s) {
			t.Fatalf("expected %s terminal", s)
		}
	}
	for _, s := range []string{StatusPlaced, StatusAccepted, StatusReady} {
		if Terminal(s) {
			t.Fatalf("expected %s non-terminal", s)
		}
	}
}

func TestQuoteUSDExample(t *testing.T) {
	// AGENTS.md §12: $20.00 food, 2 km → delivery $1.70, service $0.60,
	// customer $22.30, restaurant $18.00, courier $1.61, platform $2.69.
	q := QuoteFor(QuoteInput{SubtotalMinor: 2000, DistanceKm: 2, Currency: "USD"})
	if q.DeliveryMinor != 170 || q.ServiceMinor != 60 || q.TotalMinor != 2230 {
		t.Fatalf("unexpected quote: %+v", q)
	}
	if q.CommissionMinor != 200 || q.CourierFeeMinor != 9 {
		t.Fatalf("unexpected fees: %+v", q)
	}
	if q.MerchantPayout != 1800 || q.CourierPayout != 161 || q.PlatformTake != 269 {
		t.Fatalf("unexpected split: %+v", q)
	}
	assertExact(t, q)
}

func TestQuoteIDRExample(t *testing.T) {
	// AGENTS.md §12: Rp 50.000 food, 2 km → delivery Rp 8.000,
	// service Rp 1.500, customer Rp 59.500, restaurant Rp 45.000,
	// courier Rp 7.600, platform Rp 6.900.
	q := QuoteFor(QuoteInput{SubtotalMinor: 50000, DistanceKm: 2, Currency: "IDR"})
	if q.DeliveryMinor != 8000 || q.ServiceMinor != 1500 || q.TotalMinor != 59500 {
		t.Fatalf("unexpected quote: %+v", q)
	}
	if q.CommissionMinor != 5000 {
		t.Fatalf("unexpected commission: %+v", q)
	}
	if q.MerchantPayout != 45000 || q.CourierPayout != 7600 || q.PlatformTake != 6900 {
		t.Fatalf("unexpected split: %+v", q)
	}
	assertExact(t, q)
}

func TestQuoteRoundingHalfUp(t *testing.T) {
	// 5 minor at 10% = 0.5 → rounds up to 1; the merchant absorbs it.
	if got := Commission(5, false); got != 1 {
		t.Fatalf("expected commission 1, got %d", got)
	}
	// 5 minor delivery at 5% = 0.25 → rounds down to 0.
	if got := CourierFee(5); got != 0 {
		t.Fatalf("expected courier fee 0, got %d", got)
	}
	// Tiny subtotal still pays the service-fee floor.
	q := QuoteFor(QuoteInput{SubtotalMinor: 10, DistanceKm: 0, Currency: "USD"})
	if q.ServiceMinor != 10 {
		t.Fatalf("expected service floor 10, got %d", q.ServiceMinor)
	}
	assertExact(t, q)
	// Huge subtotal hits the service-fee cap.
	q = QuoteFor(QuoteInput{SubtotalMinor: 100000, DistanceKm: 100, Currency: "USD"})
	if q.ServiceMinor != 99 || q.DeliveryMinor != 350 {
		t.Fatalf("expected caps 99/350, got %+v", q)
	}
	assertExact(t, q)
}

func TestQuoteStaffCommission(t *testing.T) {
	plain := QuoteFor(QuoteInput{SubtotalMinor: 2000, DistanceKm: 2, Currency: "USD"})
	staff := QuoteFor(QuoteInput{SubtotalMinor: 2000, DistanceKm: 2, Currency: "USD", StaffDelivery: true})
	if staff.CommissionMinor != 100 || plain.CommissionMinor != 200 {
		t.Fatalf("expected staff commission 100 vs 200, got %d vs %d", staff.CommissionMinor, plain.CommissionMinor)
	}
	if staff.MerchantPayout != 1900 {
		t.Fatalf("expected merchant payout 1900, got %d", staff.MerchantPayout)
	}
	assertExact(t, staff)
}

func TestQuoteTipGoesToCourier(t *testing.T) {
	base := QuoteFor(QuoteInput{SubtotalMinor: 2000, DistanceKm: 2, Currency: "USD"})
	tipped := QuoteFor(QuoteInput{SubtotalMinor: 2000, DistanceKm: 2, Currency: "USD", TipMinor: 300})
	if tipped.TotalMinor-base.TotalMinor != 300 {
		t.Fatalf("tip must raise the total in full")
	}
	if tipped.CourierPayout-base.CourierPayout != 300 {
		t.Fatalf("tip must go to the courier in full")
	}
	if tipped.PlatformTake != base.PlatformTake || tipped.MerchantPayout != base.MerchantPayout {
		t.Fatalf("tip must not change platform or merchant shares")
	}
	assertExact(t, tipped)
}

func TestQuoteUnknownCurrencyFallsBack(t *testing.T) {
	q := QuoteFor(QuoteInput{SubtotalMinor: 2000, DistanceKm: 2, Currency: "XXX"})
	if q.DeliveryMinor != 170 || q.ServiceMinor != 60 {
		t.Fatalf("expected USD fallback pricing, got %+v", q)
	}
}

func assertExact(t *testing.T, q Quote) {
	t.Helper()
	if want := q.SubtotalMinor + q.DeliveryMinor + q.ServiceMinor + q.TipMinor; q.TotalMinor != want {
		t.Fatalf("total %d != components %d", q.TotalMinor, want)
	}
	if got := q.MerchantPayout + q.CourierPayout + q.PlatformTake; got != q.TotalMinor {
		t.Fatalf("split %d != total %d (%+v)", got, q.TotalMinor, q)
	}
}
