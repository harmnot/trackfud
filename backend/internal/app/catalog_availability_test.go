package app

import "testing"

// Pure rule tests for the customer availability badge: no database, realistic
// sightings only (a runner 400 m out, a biker 2.5 km out, a stale far one).
// The badge must go quiet when nobody is actually online nearby — the bug
// this fixes counted every approved application globally, online or not.
func TestResolveLiveAvailability(t *testing.T) {
	runner, biker := 1500.0, 3000.0

	offline := resolveLiveAvailability(nil, runner, biker)
	if offline.availability != "staff_only" || offline.count != 0 {
		t.Fatalf("no sightings must read staff_only, got %+v", offline)
	}

	oneRunner := resolveLiveAvailability(
		[]liveCourierSight{{mode: "runner", distM: 400}}, runner, biker)
	if oneRunner.availability != "runners_bikers_nearby" || oneRunner.count != 1 {
		t.Fatalf("nearby runner must light the badge, got %+v", oneRunner)
	}
	if len(oneRunner.modes) != 1 || oneRunner.modes[0] != "runner" {
		t.Fatalf("modes must name the runner, got %v", oneRunner.modes)
	}
	if oneRunner.nearestM == nil || *oneRunner.nearestM != 400 {
		t.Fatalf("nearest must be 400 m, got %v", oneRunner.nearestM)
	}

	mixed := resolveLiveAvailability([]liveCourierSight{
		{mode: "runner", distM: 400},
		{mode: "biker", distM: 2500},
		{mode: "runner", distM: 9000}, // outside even the biker radius
	}, runner, biker)
	if mixed.availability != "runners_bikers_nearby" || mixed.count != 2 {
		t.Fatalf("only in-radius sightings count, got %+v", mixed)
	}
	if len(mixed.modes) != 2 {
		t.Fatalf("both modes must be listed, got %v", mixed.modes)
	}

	farRunner := resolveLiveAvailability(
		[]liveCourierSight{{mode: "runner", distM: 2000}}, runner, biker)
	if farRunner.availability != "staff_only" || farRunner.count != 0 {
		t.Fatalf("runner past its own radius must not light the badge, got %+v", farRunner)
	}
	farRunnerAsBiker := resolveLiveAvailability(
		[]liveCourierSight{{mode: "biker", distM: 2000}}, runner, biker)
	if farRunnerAsBiker.availability != "runners_bikers_nearby" {
		t.Fatalf("biker inside the wider radius must light the badge, got %+v", farRunnerAsBiker)
	}
}

func TestRatingView(t *testing.T) {
	avg, count := ratingView(0, 0)
	if avg != nil || count != 0 {
		t.Fatalf("unrated restaurant must shape as null/0, got %v/%d", avg, count)
	}
	avg, count = ratingView(12, 4.6)
	if avg != 4.6 || count != 12 {
		t.Fatalf("rated restaurant must keep its aggregate, got %v/%d", avg, count)
	}
}
