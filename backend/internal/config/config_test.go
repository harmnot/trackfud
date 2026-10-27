package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadQualificationTrackingHealth(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yaml")
	body := "qualification:\n  retry_after_s: 3600\n  max_attempts_per_week: 3\n  max_gap_s: 60\n  checkpoint_photos: 1\n" +
		"tracking:\n  max_accuracy_m: 30\n  runner_max_speed_kmh: 25\n  biker_max_speed_kmh: 50\n" +
		"  min_moving_speed_mps: 0.5\n  segment_max_gap_s: 30\n" +
		"  runner_active_min_speed_kmh: 5\n  biker_active_min_speed_kmh: 10\n" +
		"  stale_after_s: 60\n  auto_end_after_s: 600\n  future_tolerance_s: 30\n  clock_skew_flag_s: 30\n" +
		"health:\n  who_weekly_active_min: 150\n  daily_active_cap_min: 180\n"
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TB_CONFIG", p)
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.Qualification.RetryAfterS != 3600 || c.Qualification.MaxAttemptsPerWeek != 3 ||
		c.Qualification.MaxGapS != 60 || c.Qualification.CheckpointPhotos != 1 {
		t.Fatalf("qualification not parsed: %+v", c.Qualification)
	}
	if c.Tracking.MaxAccuracyM != 30 || c.Tracking.RunnerMaxSpeedKmh != 25 ||
		c.Tracking.BikerMaxSpeedKmh != 50 || c.Tracking.MinMovingSpeedMps != 0.5 ||
		c.Tracking.SegmentMaxGapS != 30 || c.Tracking.RunnerActiveMinSpeedKmh != 5 ||
		c.Tracking.BikerActiveMinSpeedKmh != 10 || c.Tracking.StaleAfterS != 60 ||
		c.Tracking.AutoEndAfterS != 600 || c.Tracking.FutureToleranceS != 30 ||
		c.Tracking.ClockSkewFlagS != 30 {
		t.Fatalf("tracking not parsed: %+v", c.Tracking)
	}
	if c.Health.WhoWeeklyActiveMin != 150 || c.Health.DailyActiveCapMin != 180 {
		t.Fatalf("health not parsed: %+v", c.Health)
	}
	// Defaults survive a missing file.
	t.Setenv("TB_CONFIG", filepath.Join(dir, "missing.yaml"))
	d, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if d.Qualification.MaxGapS != 60 || d.Tracking.MaxAccuracyM != 30 || d.Health.WhoWeeklyActiveMin != 150 {
		t.Fatalf("defaults wrong: %+v %+v %+v", d.Qualification, d.Tracking, d.Health)
	}
}
