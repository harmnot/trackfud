// Package app — B3 fitness evaluation (pure functions, no DB).
//
// Pass/fail for qualification tests is decided by code from config
// (plan sections 7.2-7.3, 8.2-8.3): distance, moving time, elapsed cap,
// GPS-gap rule. Anti-cheat signals (speed spike, teleport, too-smooth
// accuracy) only flag the run for human review — never auto-fail it.
package app

import (
	"math"
	"sort"
	"time"
)

// TrackPoint is one GPS fix with phone time.
type TrackPoint struct {
	Ts        time.Time
	Lat       float64
	Lng       float64
	AccuracyM float64
	Steps     int
}

// FitnessRules carries the configured thresholds for one evaluation.
type FitnessRules struct {
	TargetM        float64
	MovingLimitS   int
	ElapsedCapMult int
	MaxGapS        int
	MaxSpeedMps    float64
	MinMovingMps   float64
	SegmentMaxGapS int
}

// FitnessResult is the outcome of evaluating one recorded track.
type FitnessResult struct {
	Passed      bool
	DistanceM   float64
	MovingS     int
	ElapsedS    int
	MaxGapS     int
	Flags       []string
	FailReasons []string
}

// Anti-cheat flag codes (review only, never auto-fail).
const (
	FlagSpeedSpike = "speed_spike"
	FlagTeleport   = "teleport"
	FlagTooSmooth  = "too_smooth"
)

// Fail reason codes (decided by code).
const (
	FailShortDistance = "short_distance"
	FailMovingOver    = "moving_over_limit"
	FailElapsedCap    = "elapsed_cap"
	FailGPSGap        = "gps_gap"
)

// Teleport rule: a jump this far this fast is fake GPS or a bad fix;
// the segment is excluded from the distance so it cannot help pass.
const teleportDistM = 200.0
const teleportDtS = 5.0

// Speed spikes must persist this long before flagging (plan section 7.3).
const speedSpikeSustainS = 20.0

// haversineM returns the geodesic distance in meters between two WGS84 points.
func haversineM(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371000.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * r * math.Asin(math.Min(1, math.Sqrt(a)))
}

// EvaluateTrack computes distance/moving/elapsed/gap/flags from a recorded
// track and decides pass/fail. Points need not be sorted.
func EvaluateTrack(pts []TrackPoint, rules FitnessRules) FitnessResult {
	res := FitnessResult{Flags: []string{}, FailReasons: []string{}}
	if len(pts) < 2 {
		res.FailReasons = append(res.FailReasons, FailShortDistance)
		return res
	}
	cp := append([]TrackPoint(nil), pts...)
	sort.Slice(cp, func(i, j int) bool { return cp[i].Ts.Before(cp[j].Ts) })
	res.ElapsedS = int(cp[len(cp)-1].Ts.Sub(cp[0].Ts).Seconds())
	if res.ElapsedS < 0 {
		res.ElapsedS = 0
	}
	var moving float64
	var spikeSustain float64
	spiked := false
	teleported := false
	for i := 1; i < len(cp); i++ {
		dt := cp[i].Ts.Sub(cp[i-1].Ts).Seconds()
		if dt <= 0 {
			continue
		}
		if int(dt) > res.MaxGapS {
			res.MaxGapS = int(dt)
		}
		dist := haversineM(cp[i-1].Lat, cp[i-1].Lng, cp[i].Lat, cp[i].Lng)
		speed := dist / dt
		// Teleport: exclude the segment, flag for review.
		if dist > teleportDistM && dt < teleportDtS {
			if !teleported {
				res.Flags = append(res.Flags, FlagTeleport)
				teleported = true
			}
			spikeSustain = 0
			continue
		}
		// Speed spike: exclude the segment, flag only when sustained.
		if speed > rules.MaxSpeedMps {
			spikeSustain += dt
			if spikeSustain >= speedSpikeSustainS && !spiked {
				res.Flags = append(res.Flags, FlagSpeedSpike)
				spiked = true
			}
			continue
		}
		spikeSustain = 0
		res.DistanceM += dist
		// Moving time: real motion on a fresh fix (plan section 7.2).
		if speed >= rules.MinMovingMps && dt <= float64(rules.SegmentMaxGapS) {
			moving += dt
		}
	}
	res.MovingS = int(math.Round(moving))
	// Too smooth: real GPS jitter always varies accuracy; a constant value
	// across a whole run smells like a spoofing app.
	if len(cp) >= 6 {
		same := true
		for _, p := range cp[1:] {
			if p.AccuracyM != cp[0].AccuracyM {
				same = false
				break
			}
		}
		if same {
			res.Flags = append(res.Flags, FlagTooSmooth)
		}
	}
	if res.DistanceM < rules.TargetM {
		res.FailReasons = append(res.FailReasons, FailShortDistance)
	}
	if res.MovingS > rules.MovingLimitS {
		res.FailReasons = append(res.FailReasons, FailMovingOver)
	}
	if res.ElapsedS >= rules.ElapsedCapMult*rules.MovingLimitS {
		res.FailReasons = append(res.FailReasons, FailElapsedCap)
	}
	if res.MaxGapS > rules.MaxGapS {
		res.FailReasons = append(res.FailReasons, FailGPSGap)
	}
	res.Passed = len(res.FailReasons) == 0
	return res
}
