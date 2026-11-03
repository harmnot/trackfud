package app

import (
	"math"
	"testing"
)

func TestParsePlannerLatLng(t *testing.T) {
	if _, _, msg := parsePlannerLatLng(-6.2, 106.8); msg != "" {
		t.Fatalf("valid Jakarta fix rejected: %s", msg)
	}
	for _, tc := range [][2]float64{{-91, 0}, {91, 0}, {0, -181}, {0, 181}, {math.NaN(), 0}} {
		if _, _, msg := parsePlannerLatLng(tc[0], tc[1]); msg == "" {
			t.Fatalf("invalid lat/lng %v accepted", tc)
		}
	}
}

func TestCircleLoopClosedWithinWaypoints(t *testing.T) {
	spots := []hotspot{
		{MerchantID: "m1", Name: "Warung A", Lat: -6.201, Lng: 106.801, Orders7d: 12},
		{MerchantID: "m2", Name: "Burger B", Lat: -6.199, Lng: 106.799, Orders7d: 4},
	}
	for _, tc := range []struct {
		rot, pull float64
	}{
		{0, 0.35}, {30, 0.15},
	} {
		loop := circleLoop(-6.2, 106.8, 5000, spots, tc.rot, tc.pull, 6)
		if len(loop) > maxPlanWaypoints {
			t.Fatalf("loop has %d points, want ≤%d", len(loop), maxPlanWaypoints)
		}
		first, last := loop[0], loop[len(loop)-1]
		if first != last {
			t.Fatalf("loop not closed: %v vs %v", first, last)
		}
		d := loopDistanceM(loop)
		if d < 2500 || d > 9000 {
			t.Fatalf("5K loop distance %.0f m outside sane band", d)
		}
	}
}

func TestCircleLoopNoHotspotsStillCloses(t *testing.T) {
	loop := circleLoop(-6.2, 106.8, 3000, nil, 0, 0.35, 6)
	if len(loop) != 7 || loop[0] != loop[len(loop)-1] {
		t.Fatalf("hotspot-free loop must close with 7 points, got %d", len(loop))
	}
	if d := loopDistanceM(loop); d < 1500 || d > 6000 {
		t.Fatalf("3K loop distance %.0f m outside sane band", d)
	}
}

func TestEstimatePlanEarningsBounded(t *testing.T) {
	hot := []hotspot{{Orders7d: 14}, {Orders7d: 7}}
	for _, w := range []string{"now", "lunch", "dinner"} {
		orders, payout := estimatePlanEarnings(hot, w, "IDR")
		if orders < 1 || orders > 3 {
			t.Fatalf("window %s: est orders %d outside 1..3", w, orders)
		}
		if payout <= 0 {
			t.Fatalf("window %s: non-positive payout %d", w, payout)
		}
	}
	// Thin history still plans: never zero orders (an estimate, not a promise).
	if orders, _ := estimatePlanEarnings(nil, "now", "IDR"); orders != 1 {
		t.Fatalf("empty hotspots should estimate 1 order, got %d", orders)
	}
}

func TestParsePlannerWords(t *testing.T) {
	raw := `{"options":[{"name":"Busy lunch run · 5.0K","reasoning":"Easy loop near 3 busy spots."},{"name":"Steady run · 5.0K","reasoning":"Even pace, 1-2 kitchens."}]}`
	words, err := parsePlannerWords(raw)
	if err != nil {
		t.Fatalf("valid words rejected: %v", err)
	}
	if words[0].Name == "" || words[1].Reasoning == "" {
		t.Fatalf("words must carry name + reasoning: %+v", words)
	}
	if _, err := parsePlannerWords(`{"options":[{"name":"only one","reasoning":"x"}]}`); err == nil {
		t.Fatalf("single-option output must be rejected")
	}
}

func TestPlanIDStable(t *testing.T) {
	a, b := planID("same|seed"), planID("same|seed")
	if a != b || a == "" {
		t.Fatalf("plan ids must be stable and non-empty: %q %q", a, b)
	}
	if planID("other|seed") == a {
		t.Fatalf("distinct seeds must give distinct plan ids")
	}
}

func TestPlaceholderPlannerNamesFallBack(t *testing.T) {
	for _, n := range []string{"options_1_headline", "{name}", "headline", " Name ", "plan_a"} {
		if !placeholderName(n) {
			t.Errorf("placeholderName(%q) = false, want true", n)
		}
	}
	for _, n := range []string{"Loop santai 5K lewat 3 dapur ramai", "Easy 5K loop", "GBK sunrise run"} {
		if placeholderName(n) {
			t.Errorf("placeholderName(%q) = true, want false", n)
		}
	}
	ai := [2]plannerWords{
		{Name: "options_1_headline", Reasoning: "Lari santai dulu, dapur ramai kedua."},
		{Name: "Loop stabil 5K", Reasoning: "Tempo rata, lewat 2 dapur."},
	}
	fb := fallbackPlannerWords("runner", 5000, "now", 3)
	got := withSafeNames(ai, fb)
	if got[0].Name != fb[0].Name || got[0].Reasoning != ai[0].Reasoning {
		t.Errorf("option 0 = %+v, want fallback name + AI reasoning", got[0])
	}
	if got[1] != ai[1] {
		t.Errorf("option 1 = %+v, want the AI words unchanged", got[1])
	}
}
