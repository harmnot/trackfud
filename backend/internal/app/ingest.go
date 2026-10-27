// Package app — B3 GPS ingest guards (pure functions, no DB).
//
// The phone buffers points in IndexedDB and flushes a batch every 5 s over
// the WebSocket (`loc.batch`), with HTTP POST as fallback; after a reconnect
// it resends the backlog with the original phone timestamps (plan 7.1).
// The server therefore enforces, per batch:
//   - future timestamps are rejected (whole batch, 400);
//   - timestamps must move forward (stale/duplicate points are skipped);
//   - fixes worse than max_accuracy_m are skipped (plan 7.1-7.2).
//
// Backlog points newer than the stored maximum are accepted, so a
// Wake-Lock-friendly reconnect never loses data; older redeliveries are
// skipped as duplicates and the uncovered interval stays a recorded gap.
package app

import (
	"math"
	"time"
)

// IngestPoint is one validated GPS fix moving through ingest.
type IngestPoint struct {
	Ts        time.Time
	Lat       float64
	Lng       float64
	AccuracyM float64
	Steps     int
	Heading   *float64
	AltitudeM *float64
}

// FilterStats counts why points were not stored.
type FilterStats struct {
	SkippedAccuracy int
	SkippedStale    int
}

// FilterBatch sorts a batch by phone time, rejects it when any fix is from
// the future (beyond tolerance), and skips inaccurate or non-forward fixes.
// lastTs is the session's stored maximum point time (hasLast=false when the
// session has no points yet).
func FilterBatch(pts []IngestPoint, lastTs time.Time, hasLast bool, now time.Time, maxAccuracyM float64, futureToleranceS int) ([]IngestPoint, FilterStats, bool) {
	var st FilterStats
	kept := make([]IngestPoint, 0, len(pts))
	futureCutoff := now.Add(time.Duration(futureToleranceS) * time.Second)
	for _, p := range pts {
		if p.Ts.After(futureCutoff) {
			return nil, st, false
		}
	}
	// Simple insertion sort by Ts (batches are small and nearly ordered).
	for i := 1; i < len(pts); i++ {
		for j := i; j > 0 && pts[j].Ts.Before(pts[j-1].Ts); j-- {
			pts[j], pts[j-1] = pts[j-1], pts[j]
		}
	}
	high := lastTs
	for _, p := range pts {
		if p.AccuracyM > maxAccuracyM {
			st.SkippedAccuracy++
			continue
		}
		if hasLast && !p.Ts.After(high) {
			st.SkippedStale++
			continue
		}
		kept = append(kept, p)
		high = p.Ts
	}
	return kept, st, true
}

// StatsDelta is the incremental session-stat contribution of one batch.
type StatsDelta struct {
	DistM      float64
	MovingS    int64
	ActiveS    int64
	MaxSpeed   float64
	Steps      int64
	Spiked     bool
	Teleported bool
	LastLat    float64
	LastLng    float64
	LastTs     time.Time
	HasLast    bool
}

// AccumulateStats folds accepted points onto the previous fix using the same
// segment rules as EvaluateTrack: teleport/speed-cap segments are excluded
// (and flagged), moving needs real motion on a fresh fix, active needs real
// exercise effort (plan 7.2).
func AccumulateStats(prevLat, prevLng float64, prevTs time.Time, hasPrev bool, pts []IngestPoint, maxSpeedMps, minMovingMps, activeMinMps float64, segMaxGapS int) StatsDelta {
	d := StatsDelta{LastLat: prevLat, LastLng: prevLng, LastTs: prevTs, HasLast: hasPrev}
	lat, lng, ts := prevLat, prevLng, prevTs
	for _, p := range pts {
		if !d.HasLast {
			lat, lng, ts = p.Lat, p.Lng, p.Ts
			d.LastLat, d.LastLng, d.LastTs = lat, lng, ts
			d.HasLast = true
			d.Steps += int64(p.Steps)
			continue
		}
		dt := p.Ts.Sub(ts).Seconds()
		if dt <= 0 {
			continue
		}
		dist := haversineM(lat, lng, p.Lat, p.Lng)
		speed := dist / dt
		if dist > teleportDistM && dt < teleportDtS {
			d.Teleported = true
		} else if speed > maxSpeedMps {
			d.Spiked = true
		} else {
			d.DistM += dist
			if speed >= minMovingMps && dt <= float64(segMaxGapS) {
				d.MovingS += int64(math.Round(dt))
			}
			if speed >= activeMinMps && dt <= float64(segMaxGapS) {
				d.ActiveS += int64(math.Round(dt))
			}
		}
		if speed > d.MaxSpeed {
			d.MaxSpeed = speed
		}
		d.Steps += int64(p.Steps)
		lat, lng, ts = p.Lat, p.Lng, p.Ts
		d.LastLat, d.LastLng, d.LastTs = lat, lng, ts
		d.HasLast = true
	}
	return d
}

// BearingDeg returns the initial bearing in degrees between two WGS84 points.
func BearingDeg(lat1, lng1, lat2, lng2 float64) float64 {
	dLng := (lng2 - lng1) * math.Pi / 180
	y := math.Sin(dLng) * math.Cos(lat2*math.Pi/180)
	x := math.Cos(lat1*math.Pi/180)*math.Sin(lat2*math.Pi/180) -
		math.Sin(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*math.Cos(dLng)
	b := math.Atan2(y, x) * 180 / math.Pi
	if b < 0 {
		b += 360
	}
	return b
}
