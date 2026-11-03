package main

import (
	"math"
	"math/rand/v2"
	"time"
)

// GPS realism rules for posted fixes. The server stores fixes by phone
// time, rejects future/stale ones, flags 200 m+ jumps under 5 s as
// teleports and constant accuracy as too_smooth (internal/app/ingest.go,
// fitness.go); these keep simulated fixes on the honest side of each.
const (
	// maxPointGapM: consecutive posted fixes are never farther apart.
	maxPointGapM = 150.0
	// jitterM: each fix lands within this radius of the true position.
	jitterM = 3.0
	// hopM: true travel per fix; leaves room for jitter on both ends.
	hopM = maxPointGapM - 2*jitterM - 24.0
	// Fix accuracy band (meters); varies on every fix.
	minAccuracyM = 4.0
	maxAccuracyM = 12.0
	// minPointGap keeps timestamps strictly increasing after the server
	// rounds them to microseconds.
	minPointGap = time.Millisecond
	// maxCatchUp bounds the travel simulated after a stall (laptop sleep,
	// slow API): the bot pauses instead of sprinting to catch up.
	maxCatchUp = time.Minute
	// speedDriftMps is the largest per-tick pace change.
	speedDriftMps = 0.15
)

// modeSpeedMps is the cruise band at x1 (m/s): runners 2.3–3.2 (≈8–11.5
// km/h), bikers 4.5–6.5 (≈16–23 km/h), inside the server's speed caps.
var modeSpeedMps = map[string][2]float64{
	"runner": {2.3, 3.2},
	"biker":  {4.5, 6.5},
}

// speedBand returns the mode's cruise band (unknown modes run).
func speedBand(mode string) [2]float64 {
	if b, ok := modeSpeedMps[mode]; ok {
		return b
	}
	return modeSpeedMps["runner"]
}

// initialSpeed draws a cruise speed inside the mode's band.
func initialSpeed(rng *rand.Rand, mode string) float64 {
	b := speedBand(mode)
	return b[0] + rng.Float64()*(b[1]-b[0])
}

// nextSpeed drifts the pace by up to ±speedDriftMps and clamps it to the
// band, so pace wanders like a real run instead of jumping.
func nextSpeed(rng *rand.Rand, mode string, cur float64) float64 {
	b := speedBand(mode)
	v := cur + (rng.Float64()*2-1)*speedDriftMps
	return math.Min(b[1], math.Max(b[0], v))
}

// hopsFor is how many fixes cover meters of travel with no hop above hopM.
func hopsFor(meters float64) int {
	if meters <= hopM {
		return 1
	}
	return int(math.Ceil(meters / hopM))
}

// samplePath splits one tick of travel into equal hops, calling move for
// each hop, and returns the true position after every hop.
func samplePath(meters float64, move func(m float64) pt) []pt {
	k := hopsFor(meters)
	out := make([]pt, 0, k)
	for range k {
		out = append(out, move(meters/float64(k)))
	}
	return out
}

// stampTimes spreads n timestamps evenly over (last, now]. They are
// strictly increasing and at least minPointGap apart, bumping past now if
// the clock did not move (the server tolerates 30 s of future skew).
func stampTimes(last, now time.Time, n int) []time.Time {
	out := make([]time.Time, n)
	span := now.Sub(last)
	prev := last
	for i := range n {
		t := last.Add(span * time.Duration(i+1) / time.Duration(n))
		if t.Sub(prev) < minPointGap {
			t = prev.Add(minPointGap)
		}
		out[i], prev = t, t
	}
	return out
}

// jitter moves p by a random offset of at most jitterM meters (uniform
// over the disk), like real GPS noise.
func jitter(rng *rand.Rand, p pt) pt {
	r := jitterM * math.Sqrt(rng.Float64())
	th := rng.Float64() * 2 * math.Pi
	return pt{
		lat: p.lat + r*math.Cos(th)/metersPerDeg,
		lng: p.lng + r*math.Sin(th)/(metersPerDeg*math.Cos(p.lat*math.Pi/180)),
	}
}

// accuracyM draws a fix accuracy in [minAccuracyM, maxAccuracyM] (0.1 m
// steps).
func accuracyM(rng *rand.Rand) float64 {
	return math.Round((minAccuracyM+rng.Float64()*(maxAccuracyM-minAccuracyM))*10) / 10
}

// fix is one GPS point as posted to /v1/courier/locations.
type fix struct {
	ts  time.Time
	p   pt
	acc float64
}

// makeFixes pairs true hop positions with their timestamps, adding jitter
// and a varying accuracy to each.
func makeFixes(rng *rand.Rand, hops []pt, stamps []time.Time) []fix {
	out := make([]fix, len(hops))
	for i, h := range hops {
		out[i] = fix{ts: stamps[i], p: jitter(rng, h), acc: accuracyM(rng)}
	}
	return out
}

// wirePoints renders fixes in the courier ingest shape: {ts, lat, lng,
// acc} with ts as RFC3339Nano UTC.
func wirePoints(fixes []fix) []map[string]any {
	out := make([]map[string]any, len(fixes))
	for i, f := range fixes {
		out[i] = map[string]any{
			"ts":  f.ts.UTC().Format(time.RFC3339Nano),
			"lat": f.p.lat, "lng": f.p.lng, "acc": f.acc,
		}
	}
	return out
}
