package app

import (
	"testing"
	"time"
)

func mkPts(base time.Time, n int, stepLat float64, acc float64) []IngestPoint {
	pts := make([]IngestPoint, 0, n)
	for i := 0; i < n; i++ {
		pts = append(pts, IngestPoint{
			Ts:  base.Add(time.Duration(i) * time.Second),
			Lat: -6.2088 + float64(i+1)*stepLat, Lng: 106.8456,
			AccuracyM: acc,
		})
	}
	return pts
}

func TestFilterBatchFutureRejected(t *testing.T) {
	now := time.Now().UTC()
	pts := mkPts(now.Add(-time.Minute), 3, 2.5/111320.0, 8)
	pts = append(pts, IngestPoint{Ts: now.Add(time.Hour), Lat: -6.2, Lng: 106.8, AccuracyM: 8})
	if _, _, ok := FilterBatch(pts, time.Time{}, false, now, 30, 30); ok {
		t.Fatal("batch with a future timestamp must be rejected")
	}
}

func TestFilterBatchForwardOnly(t *testing.T) {
	now := time.Now().UTC()
	base := now.Add(-time.Minute)
	// lastTs sits mid-batch: older fixes are stale redeliveries, newer are kept.
	lastTs := base.Add(5 * time.Second)
	pts := mkPts(base, 10, 2.5/111320.0, 8)
	kept, st, ok := FilterBatch(pts, lastTs, true, now, 30, 30)
	if !ok {
		t.Fatal("batch must be accepted")
	}
	if len(kept) != 4 || st.SkippedStale != 6 {
		t.Fatalf("want 4 kept / 6 stale, got %d / %+v", len(kept), st)
	}
}

func TestFilterBatchAccuracySkip(t *testing.T) {
	now := time.Now().UTC()
	pts := mkPts(now.Add(-time.Minute), 4, 2.5/111320.0, 8)
	pts[1].AccuracyM = 50 // worse than the 30 m cap: dropped, rest kept
	kept, st, ok := FilterBatch(pts, time.Time{}, false, now, 30, 30)
	if !ok || len(kept) != 3 || st.SkippedAccuracy != 1 {
		t.Fatalf("want 3 kept / 1 accuracy-skip, got %d / %+v", len(kept), st)
	}
}

func TestFilterBatchBacklogAccepted(t *testing.T) {
	// Wake-Lock reconnect: backlog with original timestamps newer than the
	// stored maximum is accepted in order.
	now := time.Now().UTC()
	base := now.Add(-3 * time.Minute)
	lastTs := base.Add(10 * time.Second)
	pts := mkPts(base.Add(11*time.Second), 5, 2.5/111320.0, 8)
	kept, _, ok := FilterBatch(pts, lastTs, true, now, 30, 30)
	if !ok || len(kept) != 5 {
		t.Fatalf("backlog must be accepted, got %d", len(kept))
	}
	for i := 1; i < len(kept); i++ {
		if !kept[i].Ts.After(kept[i-1].Ts) {
			t.Fatal("kept points must be time-ordered")
		}
	}
}

func TestAccumulateStatsMovingActive(t *testing.T) {
	// 60 s at 2.5 m/s: moving and active (runner active floor 5 km/h=1.39).
	now := time.Now().UTC()
	pts := mkPts(now.Add(-time.Minute), 60, 2.5/111320.0, 8)
	d := AccumulateStats(-6.2088, 106.8456, now.Add(-61*time.Second), true, pts,
		25.0/3.6, 0.5, 5.0/3.6, 30)
	if d.MovingS != 60 || d.ActiveS != 60 {
		t.Fatalf("want 60/60 moving/active, got %d/%d", d.MovingS, d.ActiveS)
	}
	if d.DistM < 145 || d.DistM > 155 {
		t.Fatalf("want ~150 m, got %f", d.DistM)
	}
	if d.Spiked || d.Teleported {
		t.Fatal("steady run must not flag")
	}
}

func TestAccumulateStatsSlowIsNotActive(t *testing.T) {
	// Stroll at 1 m/s: moving but below the runner active floor.
	now := time.Now().UTC()
	pts := mkPts(now.Add(-time.Minute), 30, 1.0/111320.0, 8)
	d := AccumulateStats(-6.2088, 106.8456, now.Add(-61*time.Second), true, pts,
		25.0/3.6, 0.5, 5.0/3.6, 30)
	if d.MovingS != 30 {
		t.Fatalf("want 30 moving, got %d", d.MovingS)
	}
	if d.ActiveS != 0 {
		t.Fatalf("stroll must not count active minutes, got %d", d.ActiveS)
	}
}

func TestAccumulateStatsSpeedCapExcluded(t *testing.T) {
	// Car-speed fixes are excluded from distance and flagged.
	now := time.Now().UTC()
	pts := mkPts(now.Add(-time.Minute), 10, 30.0/111320.0, 8)
	d := AccumulateStats(-6.2088, 106.8456, now.Add(-61*time.Second), true, pts,
		25.0/3.6, 0.5, 5.0/3.6, 30)
	if !d.Spiked {
		t.Fatal("car-speed fixes must flag speed_spike")
	}
	if d.DistM > 35 {
		t.Fatalf("over-cap segments must be excluded, got %f", d.DistM)
	}
}

// batchWrite runs one batch through the ingest pipeline (filter → stats →
// position) for a session whose stored state is prev (HasLast=false: new).
func batchWrite(prev StatsDelta, pts []IngestPoint, now time.Time) (PositionWrite, FilterStats) {
	kept, st, ok := FilterBatch(pts, prev.LastTs, prev.HasLast, now, 30, 30)
	if !ok {
		return PositionWrite{}, st
	}
	d := AccumulateStats(prev.LastLat, prev.LastLng, prev.LastTs, prev.HasLast, kept,
		25.0/3.6, 0.5, 5.0/3.6, 30)
	return BatchPosition(len(kept), d, now), st
}

// Only accepted fixes move last_pos/last_point_ts/last_seen_at: a brand-new
// session whose first batch is all indoor-grade fixes must stay unpositioned
// (it used to land on (0,0) at 0001-01-01), and a rejected-only batch never
// refreshes a positioned session's fix or liveness clock.
func TestBatchPositionOnlyFromAcceptedFixes(t *testing.T) {
	now := time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC)
	base := now.Add(-time.Minute)

	pos, st := batchWrite(StatsDelta{}, mkPts(base, 3, 2.5/111320.0, 45), now)
	if pos.Moved() || pos.Lat != nil || pos.Lng != nil || pos.SeenAt != nil || pos.PointTs != nil {
		t.Fatalf("new session + rejected-only batch must write no position, got %+v", pos)
	}
	if st.SkippedAccuracy != 3 {
		t.Fatalf("want 3 accuracy skips, got %+v", st)
	}

	prev := StatsDelta{LastLat: -6.2, LastLng: 106.8, LastTs: base.Add(-30 * time.Second), HasLast: true}
	if pos, _ := batchWrite(prev, mkPts(base, 3, 2.5/111320.0, 45), now); pos.Moved() {
		t.Fatalf("positioned session + rejected-only batch must keep its stored fix, got %+v", pos)
	}
	stale := mkPts(base.Add(-time.Hour), 2, 2.5/111320.0, 8) // redelivered, older than LastTs
	if pos, st := batchWrite(prev, stale, now); pos.Moved() || st.SkippedStale != 2 {
		t.Fatalf("stale-only redelivery must not move the session, got %+v / %+v", pos, st)
	}

	mixed := mkPts(base, 3, 2.5/111320.0, 45)
	mixed[1].AccuracyM = 8 // the one trusted fix
	pos, _ = batchWrite(StatsDelta{}, mixed, now)
	if !pos.Moved() || *pos.Lat != mixed[1].Lat || *pos.Lng != mixed[1].Lng {
		t.Fatalf("the accepted fix must become last_pos, got %+v", pos)
	}
	if !pos.PointTs.Equal(mixed[1].Ts) || !pos.SeenAt.Equal(now) {
		t.Fatalf("point time = accepted fix, seen = receive time; got %v / %v", *pos.PointTs, *pos.SeenAt)
	}
}

func TestBearingDeg(t *testing.T) {
	if b := BearingDeg(0, 0, 0, 1); b < 89.9 || b > 90.1 {
		t.Fatalf("east bearing 90, got %f", b)
	}
	if b := BearingDeg(0, 0, 1, 0); b < 0 || b > 0.1 {
		t.Fatalf("north bearing 0, got %f", b)
	}
}

func TestParseLocPointsGuards(t *testing.T) {
	_, msg := parseLocPoints([]locPointIn{{Ts: "not-a-time", Lat: 0, Lng: 0}})
	if msg == "" {
		t.Fatal("bad timestamp must be rejected")
	}
	_, msg = parseLocPoints([]locPointIn{{Ts: time.Now().UTC().Format(time.RFC3339), Lat: 99, Lng: 0}})
	if msg == "" {
		t.Fatal("bad latitude must be rejected")
	}
}
