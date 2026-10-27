package maps

import "testing"

func TestTravelMode(t *testing.T) {
	if TravelMode("biker") != "BICYCLE" || TravelMode("runner") != "WALK" || TravelMode("") != "WALK" {
		t.Fatal("travel modes must be BICYCLE for bikers, WALK otherwise")
	}
}

func TestEstimate(t *testing.T) {
	r := Estimate(2600, 9, 1.3)
	if r.Source != "estimate" {
		t.Fatal("fallback must be labelled estimate")
	}
	// 2600 m × 1.3 at 9 km/h (2.5 m/s) = 1352 s.
	if r.DurationS != 1352 {
		t.Fatalf("estimate = %d s, want 1352", r.DurationS)
	}
}

func TestParseDurationS(t *testing.T) {
	if parseDurationS("123s") != 123 || parseDurationS("bogus") != 0 || parseDurationS("-5s") != 0 {
		t.Fatal("duration parsing must read '123s' and reject junk")
	}
	if BetaWarning == "" || FieldMask == "" {
		t.Fatal("beta warning and field mask must be set")
	}
}
