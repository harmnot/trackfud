package app

import (
	"math"
	"testing"
	"time"
)

// degPerM converts meters to degrees of latitude exactly on the
// haversine sphere (R = 6371000 m), so staged tracks measure true.
const degPerM = 180.0 / (math.Pi * 6371000.0)

// runRules mirrors config.yaml: runner 2 km in 15 min, 2x elapsed cap,
// 60 s max gap, 25 km/h speed cap.
func runRules() FitnessRules {
	return FitnessRules{
		TargetM: 2000, MovingLimitS: 900, ElapsedCapMult: 2, MaxGapS: 60,
		MaxSpeedMps: 25.0 / 3.6, MinMovingMps: 0.5, SegmentMaxGapS: 30,
	}
}

// steadyRun builds a northbound track at speedMps with 1 s fixes and
// varying accuracy (real GPS jitter). skipIvan drops fixes in [from,to)
// seconds to simulate a tracking pause.
func steadyRun(t *testing.T, speedMps float64, seconds int, skipFrom, skipTo int) []TrackPoint {
	t.Helper()
	start := time.Date(2026, 10, 27, 6, 0, 0, 0, time.UTC)
	lat, lng := -6.2088, 106.8456
	pts := []TrackPoint{}
	for s := 0; s < seconds; s++ {
		if s >= skipFrom && s < skipTo {
			continue
		}
		lat += speedMps * degPerM
		pts = append(pts, TrackPoint{
			Ts:  start.Add(time.Duration(s) * time.Second),
			Lat: lat, Lng: lng, AccuracyM: 5 + float64(s%4),
		})
	}
	return pts
}

func hasStr(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}

func TestEvaluateTrackPass(t *testing.T) {
	// 2.5 m/s for 800 s = 2000 m, moving 800 s <= 900, elapsed 800 < 1800.
	res := EvaluateTrack(steadyRun(t, 2.5, 802, -1, -1), runRules())
	if !res.Passed {
		t.Fatalf("expected pass, got %+v", res)
	}
	if res.DistanceM < 1990 || res.DistanceM > 2010 {
		t.Fatalf("distance ~2000 m, got %f", res.DistanceM)
	}
	if res.MovingS != 801 {
		t.Fatalf("moving 801 s, got %d", res.MovingS)
	}
}

func TestEvaluateTrackMovingOverLimit(t *testing.T) {
	// 2 m/s for 1000 s: distance ok but moving 999 s > 900 s limit.
	res := EvaluateTrack(steadyRun(t, 2.0, 1001, -1, -1), runRules())
	if res.Passed || !hasStr(res.FailReasons, FailMovingOver) {
		t.Fatalf("expected moving_over_limit, got %+v", res)
	}
}

func TestEvaluateTrackElapsedCap(t *testing.T) {
	// Same distance with long rests: elapsed 1900 s >= 2x900.
	pts := steadyRun(t, 2.5, 802, -1, -1)
	// Stretch wall time by shifting the second half +1100 s (a cafe stop).
	for i := range pts {
		if i >= 400 {
			pts[i].Ts = pts[i].Ts.Add(1100 * time.Second)
		}
	}
	res := EvaluateTrack(pts, runRules())
	if res.Passed || !hasStr(res.FailReasons, FailElapsedCap) {
		t.Fatalf("expected elapsed_cap, got %+v", res)
	}
}

func TestEvaluateTrackShortDistance(t *testing.T) {
	res := EvaluateTrack(steadyRun(t, 2.5, 600, -1, -1), runRules())
	if res.Passed || !hasStr(res.FailReasons, FailShortDistance) {
		t.Fatalf("expected short_distance, got %+v", res)
	}
}

func TestEvaluateTrackGapFails(t *testing.T) {
	// 90 s tracking pause mid-run: distance/moving still fine, gap fails.
	res := EvaluateTrack(steadyRun(t, 2.5, 900, 400, 490), runRules())
	if res.Passed || !hasStr(res.FailReasons, FailGPSGap) {
		t.Fatalf("expected gps_gap, got %+v", res)
	}
	if len(res.FailReasons) != 1 {
		t.Fatalf("gap must be the only failure, got %+v", res)
	}
	if res.MaxGapS != 91 {
		t.Fatalf("max gap 91 s, got %d", res.MaxGapS)
	}
}

func TestEvaluateTrackTooSmoothFlagsOnly(t *testing.T) {
	// Spoofing-style constant accuracy: flagged for review, still passes.
	pts := steadyRun(t, 2.5, 802, -1, -1)
	for i := range pts {
		pts[i].AccuracyM = 5
	}
	res := EvaluateTrack(pts, runRules())
	if !res.Passed {
		t.Fatalf("jitter must not fail the test, got %+v", res)
	}
	if !hasStr(res.Flags, FlagTooSmooth) {
		t.Fatalf("expected too_smooth flag, got %+v", res)
	}
}

// stagedRun builds a continuous track from (meters, speed) stages with
// varying accuracy, e.g. {{1000, 2.5}, {300, 150.0}} for a teleport leg.
func stagedRun(stages [][2]float64) []TrackPoint {
	start := time.Date(2026, 10, 27, 6, 0, 0, 0, time.UTC)
	lat, lng := -6.2088, 106.8456
	ts := start
	pts := []TrackPoint{}
	n := 0
	add := func(meters, speed float64) {
		steps := int(meters / speed)
		for i := 0; i < steps; i++ {
			lat += speed * degPerM
			ts = ts.Add(time.Second)
			pts = append(pts, TrackPoint{Ts: ts, Lat: lat, Lng: lng,
				AccuracyM: 5 + float64(n%4)})
			n++
		}
	}
	for _, st := range stages {
		add(st[0], st[1])
	}
	return pts
}

func TestEvaluateTrackTeleportExcluded(t *testing.T) {
	// One 300 m fix in 1 s mid-run: excluded from distance, flagged, pass.
	pts := stagedRun([][2]float64{{1005, 2.5}, {300, 300.0}, {1005, 2.5}})
	res := EvaluateTrack(pts, runRules())
	if !res.Passed {
		t.Fatalf("teleport must not fail the test, got %+v", res)
	}
	if !hasStr(res.Flags, FlagTeleport) {
		t.Fatalf("expected teleport flag, got %+v", res)
	}
	if res.DistanceM < 2000 || res.DistanceM > 2020 {
		t.Fatalf("teleport segment must be excluded, distance %f", res.DistanceM)
	}
}

func TestEvaluateTrackSpeedSpikeSustained(t *testing.T) {
	// 25 s at 8 m/s (over the 25 km/h runner cap): flagged, still passes.
	pts := stagedRun([][2]float64{{760, 2.5}, {200, 8.0}, {1260, 2.5}})
	res := EvaluateTrack(pts, runRules())
	if !res.Passed {
		t.Fatalf("spike must not fail the test, got %+v", res)
	}
	if !hasStr(res.Flags, FlagSpeedSpike) {
		t.Fatalf("expected speed_spike flag, got %+v", res)
	}
}

func TestEvaluateFitness(t *testing.T) {
	if !EvaluateFitness("runner", 2000, 800, 1000, 2000, 900, 2) {
		t.Fatal("expected pass")
	}
	if EvaluateFitness("runner", 2000, 950, 1000, 2000, 900, 2) {
		t.Fatal("moving over limit must fail")
	}
	if EvaluateFitness("runner", 2000, 800, 1900, 2000, 900, 2) {
		t.Fatal("elapsed >= 2x must fail")
	}
	if EvaluateFitness("runner", 1500, 800, 1000, 2000, 900, 2) {
		t.Fatal("short distance must fail")
	}
}
