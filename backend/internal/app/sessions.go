package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---------- Courier sessions + GPS ingest (B3) ----------

// locPointIn is one fix from the phone (WS loc.batch or HTTP fallback).
// The courier PWA sends {id, ts, lat, lng, acc}; aliases are accepted.
type locPointIn struct {
	Ts        string   `json:"ts"`
	Lat       float64  `json:"lat"`
	Lng       float64  `json:"lng"`
	Acc       *float64 `json:"acc"`
	AccuracyM *float64 `json:"accuracy_m"`
	Heading   *float64 `json:"heading"`
	AltitudeM *float64 `json:"altitude_m"`
	Steps     *int     `json:"steps_delta"`
}

func (p locPointIn) accuracy() float64 {
	if p.Acc != nil {
		return *p.Acc
	}
	if p.AccuracyM != nil {
		return *p.AccuracyM
	}
	return 0
}

func (p locPointIn) steps() int {
	if p.Steps != nil {
		return *p.Steps
	}
	return 0
}

// parseLocPoints validates wire points into IngestPoints.
func parseLocPoints(raw []locPointIn) ([]IngestPoint, string) {
	out := make([]IngestPoint, 0, len(raw))
	for i, p := range raw {
		ts, err := time.Parse(time.RFC3339, p.Ts)
		if err != nil {
			return nil, fmt.Sprintf("points[%d].ts must be ISO-8601 UTC", i)
		}
		if p.Lat < -90 || p.Lat > 90 || p.Lng < -180 || p.Lng > 180 {
			return nil, fmt.Sprintf("points[%d] has invalid lat/lng", i)
		}
		out = append(out, IngestPoint{Ts: ts.UTC(), Lat: p.Lat, Lng: p.Lng,
			AccuracyM: p.accuracy(), Steps: p.steps(), Heading: p.Heading, AltitudeM: p.AltitudeM})
	}
	return out, ""
}

type sessionRow struct {
	ID               string
	CourierID        string
	Kind             string
	Mode             string
	Status           string
	StartedAt        time.Time
	EndedAt          *time.Time
	GoalDistM        float64
	GoalDurS         int
	DistM            float64
	MovingS          int64
	ActiveS          int64
	MaxSpeed         float64
	Steps            int64
	LastLat, LastLng float64
	HasLast          bool
	LastHeading      *float64
	LastSeenAt       *time.Time
	LastPointTs      *time.Time
	Flags            []string
	CheckpointPrompt *time.Time
	Accepted         int64
	Skipped          int64
}

const sessionCols = `id, courier_id, kind, mode, status, started_at, ended_at,
  goal_distance_m, goal_duration_s, distance_m, moving_s, active_s, max_speed_mps, steps,
  COALESCE(ST_Y(last_pos::geometry),0), COALESCE(ST_X(last_pos::geometry),0),
  CASE WHEN last_pos IS NULL THEN 0 ELSE 1 END,
  last_heading, last_seen_at, last_point_ts, flags, checkpoint_prompt_at,
  points_accepted, points_skipped`

func scanSession(r pgx.Row) (sessionRow, error) {
	var s sessionRow
	var flags []byte
	var hasLast int
	err := r.Scan(&s.ID, &s.CourierID, &s.Kind, &s.Mode, &s.Status, &s.StartedAt, &s.EndedAt,
		&s.GoalDistM, &s.GoalDurS, &s.DistM, &s.MovingS, &s.ActiveS, &s.MaxSpeed, &s.Steps,
		&s.LastLat, &s.LastLng, &hasLast, &s.LastHeading, &s.LastSeenAt, &s.LastPointTs,
		&flags, &s.CheckpointPrompt, &s.Accepted, &s.Skipped)
	if err != nil {
		return s, err
	}
	s.HasLast = hasLast == 1
	_ = json.Unmarshal(flags, &s.Flags)
	if s.Flags == nil {
		s.Flags = []string{}
	}
	return s, nil
}

func (s *Server) modeSpeeds(mode string) (maxSpeed, activeMin float64) {
	if mode == "biker" {
		return s.cfg.Tracking.BikerMaxSpeedKmh / 3.6, s.cfg.Tracking.BikerActiveMinSpeedKmh / 3.6
	}
	return s.cfg.Tracking.RunnerMaxSpeedKmh / 3.6, s.cfg.Tracking.RunnerActiveMinSpeedKmh / 3.6
}

// sessionView renders a session in wire shape (meters/seconds, ISO-8601 UTC).
func (s *Server) sessionView(r sessionRow, now time.Time) map[string]any {
	stale := false
	if r.LastSeenAt != nil && r.Status == "active" {
		stale = now.Sub(*r.LastSeenAt).Seconds() > float64(s.cfg.Tracking.StaleAfterS)
	}
	v := map[string]any{
		"id": r.ID, "kind": r.Kind, "mode": r.Mode, "status": r.Status,
		"started_at":      r.StartedAt.UTC().Format(time.RFC3339),
		"goal_distance_m": r.GoalDistM, "goal_duration_s": r.GoalDurS,
		"distance_m": r.DistM, "moving_s": r.MovingS, "active_s": r.ActiveS,
		"steps": r.Steps, "stale": stale,
		"points_accepted": r.Accepted, "points_skipped": r.Skipped,
		"flags": r.Flags,
	}
	if r.EndedAt != nil {
		v["ended_at"] = r.EndedAt.UTC().Format(time.RFC3339)
		v["elapsed_s"] = int(r.EndedAt.Sub(r.StartedAt).Seconds())
	} else {
		v["elapsed_s"] = int(now.Sub(r.StartedAt).Seconds())
	}
	if r.HasLast {
		v["last_lat"] = r.LastLat
		v["last_lng"] = r.LastLng
	}
	if r.Mode == "biker" {
		if r.MovingS > 0 {
			v["speed_kmh"] = r.DistM / float64(r.MovingS) * 3.6
		} else {
			v["speed_kmh"] = 0.0
		}
	} else {
		if r.DistM > 0 {
			v["pace_s_per_km"] = float64(r.MovingS) / (r.DistM / 1000)
		} else {
			v["pace_s_per_km"] = 0.0
		}
	}
	return v
}

// startSession opens a workout or qualification session.
func (s *Server) startSession(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b struct {
		Kind         string         `json:"kind"`
		Mode         string         `json:"mode"`
		GoalDistM    float64        `json:"goal_distance_m"`
		GoalDurS     int            `json:"goal_duration_s"`
		PlannedTrack map[string]any `json:"planned_track"`
	}
	if !decode(w, r, &b) {
		return
	}
	if b.Kind != "qualification" {
		b.Kind = "work"
	}
	mode := b.Mode
	if mode != "runner" && mode != "biker" {
		_ = s.db.QueryRow(r.Context(), `SELECT mode FROM courier_applications WHERE user_id=$1`, c.Sub).Scan(&mode)
		if mode != "biker" {
			mode = "runner"
		}
	}
	if b.Kind == "qualification" {
		// Under review the test locks: a new run must not knock a
		// pending_review application back to testing, and the courier
		// cannot submit again until the admin approves or rejects.
		var appStatus string
		_ = s.db.QueryRow(r.Context(), `SELECT status FROM courier_applications WHERE user_id=$1`, c.Sub).Scan(&appStatus)
		if appStatus == "pending" || appStatus == "pending_review" {
			problem(w, 409, "Conflict", "application under review; the fitness test unlocks after the review team approves or rejects it")
			return
		}
		if msg, retry := s.qualGate(r.Context(), c.Sub); msg != "" {
			if retry > 0 {
				w.Header().Set("Retry-After", fmt.Sprint(retry))
			}
			problem(w, 429, "Too many attempts", msg)
			return
		}
	}
	if b.Kind == "work" {
		// Frozen couriers cannot go online and banned couriers are off the
		// platform (plan 8.4). Accounts without a couriers row — ordinary
		// free tracking or pre-approval runners — are never blocked here.
		var standing string
		if err := s.db.QueryRow(r.Context(), `SELECT status FROM couriers WHERE user_id=$1`, c.Sub).Scan(&standing); err == nil && workSessionBlocked(standing) {
			problem(w, 403, "Forbidden", "this courier account is "+standing+" and cannot go online; money already earned stays withdrawable")
			return
		}
		// One active work session per courier (PLAN §3): going online twice
		// resumes the live session instead of opening a second one, so the
		// courier must End session in /run before /run-setup can start anew.
		if row, serr := scanSession(s.db.QueryRow(r.Context(), `SELECT `+sessionCols+` FROM activity_sessions WHERE courier_id=$1 AND kind='work' AND status='active' ORDER BY started_at DESC LIMIT 1`, c.Sub)); serr == nil && row.ID != "" {
			writeJSON(w, 200, map[string]any{"session": s.sessionView(row, time.Now()), "resumed": true})
			return
		}
	}
	var trackParam any
	if b.PlannedTrack != nil {
		gj, _ := json.Marshal(b.PlannedTrack)
		var tg struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(gj, &tg) == nil && tg.Type == "LineString" {
			trackParam = string(gj)
		}
	}
	var row sessionRow
	var err error
	if trackParam != nil {
		dst, fin := scanDest(&row)
		err = s.db.QueryRow(r.Context(), `INSERT INTO activity_sessions(courier_id,kind,mode,goal_distance_m,goal_duration_s,planned_track,last_seen_at)
			VALUES($1,$2,$3,$4,$5,ST_SetSRID(ST_GeomFromGeoJSON($6),4326)::geography,now()) RETURNING `+sessionCols, c.Sub, b.Kind, mode, b.GoalDistM, b.GoalDurS, trackParam).Scan(dst...)
		fin()
	} else {
		dst, fin := scanDest(&row)
		err = s.db.QueryRow(r.Context(), `INSERT INTO activity_sessions(courier_id,kind,mode,goal_distance_m,goal_duration_s,last_seen_at)
			VALUES($1,$2,$3,$4,$5,now()) RETURNING `+sessionCols, c.Sub, b.Kind, mode, b.GoalDistM, b.GoalDurS).Scan(dst...)
		fin()
	}
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if b.Kind == "qualification" {
		// The test may be the courier's very first action: ensure the row.
		_, _ = s.db.Exec(r.Context(), `INSERT INTO courier_applications(user_id,mode) VALUES($1,$2)
			ON CONFLICT (user_id) DO NOTHING`, c.Sub, mode)
		_, _ = s.db.Exec(r.Context(), `UPDATE courier_applications SET status='testing', mode=$2, updated_at=now()
			WHERE user_id=$1 AND status IN ('draft','testing','rejected')`, c.Sub, mode)
		_, _ = s.db.Exec(r.Context(), `INSERT INTO couriers(user_id,mode,status) VALUES($1,$2,'testing')
			ON CONFLICT (user_id) DO UPDATE SET mode=EXCLUDED.mode, status='testing', updated_at=now()
			WHERE couriers.status IN ('draft','testing','rejected')`, c.Sub, mode)
	}
	out := s.sessionView(row, time.Now())
	if b.Kind == "qualification" {
		out["rules"] = map[string]any{
			"target_distance_m": s.qualTarget(r.Context(), mode), "moving_limit_s": s.qualLimit(r.Context(), mode),
			"max_gap_s":         s.effQualInt(r.Context(), "qualification.max_gap_s", s.cfg.Qualification.MaxGapS),
			"checkpoint_photos": s.effQualInt(r.Context(), "qualification.checkpoint_photos", s.cfg.Qualification.CheckpointPhotos),
			"keep_screen_on":    true,
		}
	}
	writeJSON(w, 201, map[string]any{"session": out})
}

// scanDest returns scan targets for sessionCols plus a finalizer that
// converts the has-last marker and flags JSON into the row.
func scanDest(r *sessionRow) ([]any, func()) {
	var hasLast int
	var flags []byte
	dst := []any{&r.ID, &r.CourierID, &r.Kind, &r.Mode, &r.Status, &r.StartedAt, &r.EndedAt,
		&r.GoalDistM, &r.GoalDurS, &r.DistM, &r.MovingS, &r.ActiveS, &r.MaxSpeed, &r.Steps,
		&r.LastLat, &r.LastLng, &hasLast, &r.LastHeading, &r.LastSeenAt, &r.LastPointTs,
		&flags, &r.CheckpointPrompt, &r.Accepted, &r.Skipped}
	fin := func() {
		r.HasLast = hasLast == 1
		r.Flags = []string{}
		_ = json.Unmarshal(flags, &r.Flags)
	}
	return dst, fin
}

func (s *Server) qualTarget(ctx context.Context, mode string) float64 {
	if mode == "biker" {
		return s.effectiveQualTarget(ctx, "biker", "")
	}
	return s.effectiveQualTarget(ctx, "runner", "")
}

func (s *Server) qualLimit(ctx context.Context, mode string) int {
	if mode == "biker" {
		return s.effectiveQualLimit(ctx, "biker", "")
	}
	return s.effectiveQualLimit(ctx, "runner", "")
}

// qualGate enforces the retry rule: 1 h between attempts, max 3 per 7 days
// (A9: both follow the CMS settings editor).
func (s *Server) qualGate(ctx context.Context, userID string) (string, int) {
	over := s.loadOverrides(ctx, []string{"global"})
	maxPerWeek := effInt(over, "qualification.max_attempts_per_week", s.cfg.Qualification.MaxAttemptsPerWeek)
	retryAfter := effInt(over, "qualification.retry_after_s", s.cfg.Qualification.RetryAfterS)
	var last time.Time
	var week int
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(max(created_at), now() - interval '2 hours'), count(*) FILTER (WHERE created_at > now() - interval '7 days')
		FROM fitness_attempts WHERE user_id=$1`, userID).Scan(&last, &week)
	if week >= maxPerWeek {
		return fmt.Sprintf("max %d attempts per 7 days; contact support for help", maxPerWeek), 0
	}
	if wait := time.Until(last.Add(time.Duration(retryAfter) * time.Second)); wait > 0 {
		return fmt.Sprintf("rest a little: try again in %d minutes", int(wait.Minutes())+1), int(wait.Seconds())
	}
	return "", 0
}

// listSessions returns the courier's recent sessions (newest first).
func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	rows, err := s.db.Query(r.Context(), `SELECT `+sessionCols+` FROM activity_sessions
		WHERE courier_id=$1 ORDER BY started_at DESC LIMIT 20`, c.Sub)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	now := time.Now()
	out := []map[string]any{}
	for rows.Next() {
		row, err := scanSession(rows)
		if err != nil {
			continue
		}
		out = append(out, s.sessionView(row, now))
	}
	writeJSON(w, 200, map[string]any{"sessions": out})
}

// getSession returns live progress, the pace still needed for a qual test,
// and whether a checkpoint photo is due.
func (s *Server) getSession(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	id := r.PathValue("id")
	row, err := scanSession(s.db.QueryRow(r.Context(), `SELECT `+sessionCols+` FROM activity_sessions WHERE id=$1`, id))
	if err != nil {
		problem(w, 404, "Not found", "session not found")
		return
	}
	if row.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your session")
		return
	}
	now := time.Now()
	if ended, _ := s.autoEndIfIdle(r.Context(), row, now); ended {
		row, _ = scanSession(s.db.QueryRow(r.Context(), `SELECT `+sessionCols+` FROM activity_sessions WHERE id=$1`, id))
	}
	due := s.maybePromptCheckpoint(r.Context(), &row, now)
	v := s.sessionView(row, now)
	v["checkpoint_due"] = due
	if row.Kind == "qualification" && row.Status != "ended" {
		target, limit := s.qualTarget(r.Context(), row.Mode), s.qualLimit(r.Context(), row.Mode)
		left := target - row.DistM
		if left < 0 {
			left = 0
		}
		budget := float64(limit - int(row.MovingS))
		if budget < 1 {
			budget = 1
		}
		v["target_distance_m"] = target
		v["moving_limit_s"] = limit
		v["distance_left_m"] = left
		v["required_pace_s_per_km"] = budget / (left/1000 + 1e-9)
	}
	writeJSON(w, 200, map[string]any{"session": v})
}

// ---------- GPS ingest (WS loc.batch + HTTP fallback) ----------

// ingestBody is shared by POST /v1/courier/locations and WS loc.batch.
type ingestBody struct {
	SessionID string       `json:"session_id"`
	Points    []locPointIn `json:"points"`
}

// ingestLocations is the HTTP fallback for loc.batch (same shape, 2xx keeps
// the phone buffer moving; skipped counts tell it why fixes were dropped).
func (s *Server) ingestLocations(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b ingestBody
	if !decode(w, r, &b) {
		return
	}
	ack, code, detail := s.ingestCore(r.Context(), c.Sub, b.SessionID, b.Points)
	if code != 200 {
		problem(w, code, "Ingest rejected", detail)
		return
	}
	writeJSON(w, 200, ack)
}

// ingestCore validates, stores, and folds one batch into its session.
// It auto-creates a work session when the phone streams to an unknown id
// (the PWA mints session UUIDs locally), so reconnect backlog is accepted.
func (s *Server) ingestCore(ctx context.Context, userID, sessionID string, raw []locPointIn) (map[string]any, int, string) {
	now := time.Now().UTC()
	if strings.TrimSpace(sessionID) == "" {
		return nil, 400, "session_id required"
	}
	if len(raw) == 0 {
		return nil, 400, "points must not be empty"
	}
	if len(raw) > 500 {
		return nil, 400, "at most 500 points per batch"
	}
	pts, msg := parseLocPoints(raw)
	if msg != "" {
		return nil, 400, msg
	}
	row, err := scanSession(s.db.QueryRow(ctx, `SELECT `+sessionCols+` FROM activity_sessions WHERE id=$1`, sessionID))
	if err != nil {
		// The phone mints session ids locally, so unknown ids are normally
		// auto-created below. Frozen/banned couriers must not slip back
		// online that way: the explicit startSession 403 backs this check.
		var standing string
		if qerr := s.db.QueryRow(ctx, `SELECT status FROM couriers WHERE user_id=$1`, userID).Scan(&standing); qerr == nil && workSessionBlocked(standing) {
			return nil, 403, "this courier account is " + standing + " and cannot go online"
		}
		row, err = s.autoCreateSession(ctx, userID, sessionID)
		if err != nil {
			return nil, 400, "unknown session_id"
		}
	}
	if row.CourierID != userID {
		return nil, 403, "not your session"
	}
	if row.Status == "ended" {
		return nil, 409, "session already ended"
	}
	if ended, _ := s.autoEndIfIdle(ctx, row, now); ended {
		return nil, 409, "session auto-ended after 10 min without GPS"
	}
	// `wasStale` (together with `!HasLast`) marks the invisibility→visible
	// edge the late-online dispatch nudge below fires on.
	wasStale := row.Status == "stale"
	var lastTs time.Time
	hasLast := false
	if row.LastPointTs != nil {
		lastTs, hasLast = *row.LastPointTs, true
	}
	kept, fst, ok := FilterBatch(pts, lastTs, hasLast, now, s.cfg.Tracking.MaxAccuracyM, s.cfg.Tracking.FutureToleranceS)
	if !ok {
		return nil, 400, "batch contains future timestamps; check the phone clock"
	}
	maxSpeed, activeMin := s.modeSpeeds(row.Mode)
	delta := AccumulateStats(row.LastLat, row.LastLng, lastTs, row.HasLast, kept,
		maxSpeed, s.cfg.Tracking.MinMovingSpeedMps, activeMin, s.cfg.Tracking.SegmentMaxGapS)
	// Only accepted fixes position the courier (BatchPosition): a batch whose
	// fixes were all rejected bumps the skip counters and nothing else.
	pos := BatchPosition(len(kept), delta, now)
	if len(kept) > 0 {
		if err := s.insertPoints(ctx, row.ID, kept, now); err != nil {
			return nil, 500, err.Error()
		}
	}
	// Flip stale back to active on fresh (accepted) data only.
	if wasStale && pos.Moved() {
		_, _ = s.db.Exec(ctx, `UPDATE activity_sessions SET status='active' WHERE id=$1`, row.ID)
		row.Status = "active"
	}
	flags := append([]string{}, row.Flags...)
	addFlag := func(f string) {
		for _, have := range flags {
			if have == f {
				return
			}
		}
		flags = append(flags, f)
	}
	if delta.Spiked {
		addFlag(FlagSpeedSpike)
	}
	if delta.Teleported {
		addFlag(FlagTeleport)
	}
	for _, p := range kept {
		d := now.Sub(p.Ts)
		if d < 0 {
			d = -d
		}
		if d.Seconds() > float64(s.cfg.Tracking.ClockSkewFlagS) {
			addFlag("clock_skew")
			break
		}
	}
	flagB, _ := json.Marshal(flags)
	var heading any
	if delta.HasLast && row.HasLast && (delta.LastLat != row.LastLat || delta.LastLng != row.LastLng) {
		heading = BearingDeg(row.LastLat, row.LastLng, delta.LastLat, delta.LastLng)
	}
	_, _ = s.db.Exec(ctx, `UPDATE activity_sessions SET distance_m=distance_m+$2, moving_s=moving_s+$3,
		active_s=active_s+$4, steps=steps+$5, max_speed_mps=GREATEST(max_speed_mps,$6),
		last_pos=COALESCE(ST_SetSRID(ST_MakePoint($7,$8),4326)::geography, last_pos),
		last_heading=COALESCE($9,last_heading), last_seen_at=COALESCE($10,last_seen_at),
		last_point_ts=COALESCE($11,last_point_ts),
		flags=$12, points_accepted=points_accepted+$13, points_skipped=points_skipped+$14
		WHERE id=$1`, row.ID, delta.DistM, delta.MovingS, delta.ActiveS, delta.Steps,
		delta.MaxSpeed, pos.Lng, pos.Lat, heading, pos.SeenAt, pos.PointTs, string(flagB),
		len(kept), fst.SkippedAccuracy+fst.SkippedStale)
	// Late-online trigger: a courier who taps "Go online" after the
	// accept-time (or food-ready) wave already ran would otherwise sit
	// visible with a GPS lock but get no offers — the cascade only advances
	// on offer expiry, retry, or a fresh ready tap, none of which fires for a
	// courier who arrives late. The first positioned batch after invisibility
	// (never positioned, or back from stale) re-runs nearby open searches;
	// the nudge only enqueues deduped `dispatch_run` jobs, and runCascade
	// stays the state-guarded decider.
	if pos.Moved() && (!row.HasLast || wasStale) {
		s.nudgeNearbySearches(ctx, delta.LastLat, delta.LastLng)
	}
	// Live delivery: share the dot (customer + merchant only) and replan on
	// 150 m+ detours, for a fresh accepted fix only (never re-announce an
	// old position as current). No-ops when the courier carries nothing.
	if pos.Moved() {
		var hp *float64
		if h, ok := heading.(float64); ok {
			hp = &h
		} else if row.LastHeading != nil {
			hp = row.LastHeading
		}
		s.broadcastCourierLocation(ctx, userID, delta.LastLat, delta.LastLng, hp, now)
		s.maybeRefreshRoute(ctx, userID, delta.LastLat, delta.LastLng)
	}
	due := s.maybePromptCheckpoint(ctx, &row, now)
	row, _ = scanSession(s.db.QueryRow(ctx, `SELECT `+sessionCols+` FROM activity_sessions WHERE id=$1`, row.ID))
	v := s.sessionView(row, now)
	return map[string]any{
		"accepted": len(kept),
		"skipped": map[string]any{
			"accuracy": fst.SkippedAccuracy, "stale_duplicate": fst.SkippedStale,
		},
		"server_time":    now.Format(time.RFC3339),
		"checkpoint_due": due,
		"session":        v,
	}, 200, ""
}

// autoCreateSession registers a work session under a phone-minted id.
func (s *Server) autoCreateSession(ctx context.Context, userID, sessionID string) (sessionRow, error) {
	var row sessionRow
	mode := "runner"
	_ = s.db.QueryRow(ctx, `SELECT mode FROM courier_applications WHERE user_id=$1`, userID).Scan(&mode)
	if mode != "biker" {
		mode = "runner"
	}
	dst, fin := scanDest(&row)
	err := s.db.QueryRow(ctx, `INSERT INTO activity_sessions(id,courier_id,kind,mode,last_seen_at)
		VALUES($1,$2,'work',$3,now()) RETURNING `+sessionCols, sessionID, userID, mode).Scan(dst...)
	if err != nil {
		return row, err
	}
	fin()
	return row, nil
}

// insertPoints stores raw fixes (evidence for the Trust Brief); per-point
// speed is the segment speed ending at that fix.
func (s *Server) insertPoints(ctx context.Context, sessionID string, pts []IngestPoint, now time.Time) error {
	if len(pts) == 0 {
		return nil
	}
	var flat, flng float64
	var lp time.Time
	var hasPos int
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(ST_Y(last_pos::geometry),0), COALESCE(ST_X(last_pos::geometry),0),
		last_point_ts, CASE WHEN last_pos IS NULL THEN 0 ELSE 1 END FROM activity_sessions WHERE id=$1`,
		sessionID).Scan(&flat, &flng, &lp, &hasPos)
	q := `INSERT INTO location_points(session_id,ts,phone_ts,pos,accuracy_m,speed_mps,heading,altitude_m,steps_delta,received_at) VALUES `
	args := []any{}
	for i, p := range pts {
		speed := 0.0
		if i == 0 {
			if hasPos == 1 && !lp.IsZero() {
				if dt := p.Ts.Sub(lp).Seconds(); dt > 0 {
					speed = haversineM(flat, flng, p.Lat, p.Lng) / dt
				}
			}
		} else if dt := p.Ts.Sub(pts[i-1].Ts).Seconds(); dt > 0 {
			speed = haversineM(pts[i-1].Lat, pts[i-1].Lng, p.Lat, p.Lng) / dt
		}
		base := i * 11
		q += fmt.Sprintf(`($%d,$%d,$%d,ST_SetSRID(ST_MakePoint($%d,$%d),4326)::geography,$%d,$%d,$%d,$%d,$%d,$%d),`,
			base+1, base+2, base+3, base+4, base+5, base+6, base+7, base+8, base+9, base+10, base+11)
		args = append(args, sessionID, p.Ts, p.Ts, p.Lng, p.Lat, p.AccuracyM, speed, p.Heading, p.AltitudeM, p.Steps, now)
	}
	q = strings.TrimSuffix(q, ",") + ` ON CONFLICT (session_id, ts) DO NOTHING`
	_, err := s.db.Exec(ctx, q, args...)
	return err
}

// maybePromptCheckpoint arms the single checkpoint prompt once the
// qualification run is underway (plan 8.2: 1 random prompt).
func (s *Server) maybePromptCheckpoint(ctx context.Context, row *sessionRow, now time.Time) bool {
	if row.Kind != "qualification" || row.Status == "ended" || row.CheckpointPrompt != nil {
		return row.CheckpointPrompt != nil
	}
	if now.Sub(row.StartedAt).Seconds() < 60 {
		return false
	}
	var n int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM checkpoint_photos WHERE session_id=$1`, row.ID).Scan(&n)
	if n >= s.effQualInt(ctx, "qualification.checkpoint_photos", s.cfg.Qualification.CheckpointPhotos) && s.effQualInt(ctx, "qualification.checkpoint_photos", s.cfg.Qualification.CheckpointPhotos) > 0 {
		return false
	}
	_, _ = s.db.Exec(ctx, `UPDATE activity_sessions SET checkpoint_prompt_at=$2 WHERE id=$1 AND checkpoint_prompt_at IS NULL`, row.ID, now)
	t := now
	row.CheckpointPrompt = &t
	return true
}

// autoEndIfIdle ends sessions silent for 10 min (plan 7.2); the ended
// session is finalized exactly once by finalizeSession.
func (s *Server) autoEndIfIdle(ctx context.Context, row sessionRow, now time.Time) (bool, error) {
	if row.Status == "ended" || row.LastSeenAt == nil {
		return false, nil
	}
	idle := now.Sub(*row.LastSeenAt).Seconds()
	if row.Status == "active" && idle > float64(s.cfg.Tracking.StaleAfterS) {
		_, _ = s.db.Exec(ctx, `UPDATE activity_sessions SET status='stale' WHERE id=$1 AND status='active'`, row.ID)
		row.Status = "stale"
	}
	if idle > float64(s.cfg.Tracking.AutoEndAfterS) {
		_, err := s.finalizeSession(ctx, row.ID, row.CourierID, now)
		return true, err
	}
	return false, nil
}

// endSession finishes a session: stats, track, splits, lifetime totals and,
// for qualification tests, the pass/fail evaluation + application update.
func (s *Server) endSession(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	id := r.PathValue("id")
	row, err := scanSession(s.db.QueryRow(r.Context(), `SELECT `+sessionCols+` FROM activity_sessions WHERE id=$1`, id))
	if err != nil {
		problem(w, 404, "Not found", "session not found")
		return
	}
	if row.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your session")
		return
	}
	out, err := s.finalizeSession(r.Context(), id, c.Sub, time.Now().UTC())
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, out)
}

// finalizeSession is idempotent: ending an ended session returns its view.
func (s *Server) finalizeSession(ctx context.Context, sessionID, userID string, now time.Time) (map[string]any, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var row sessionRow
	dst, fin := scanDest(&row)
	if err := tx.QueryRow(ctx, `SELECT `+sessionCols+` FROM activity_sessions WHERE id=$1 FOR UPDATE`, sessionID).Scan(dst...); err != nil {
		return nil, err
	}
	fin()
	if row.CourierID != userID {
		return nil, fmt.Errorf("not your session")
	}
	if row.Status == "ended" {
		v := s.sessionView(row, now)
		return map[string]any{"session": v, "already_ended": true}, nil
	}
	// Load the full recorded track for evaluation.
	prows, err := tx.Query(ctx, `SELECT ts, ST_Y(pos::geometry), ST_X(pos::geometry), accuracy_m, steps_delta
		FROM location_points WHERE session_id=$1 ORDER BY ts`, sessionID)
	if err != nil {
		return nil, err
	}
	var tpts []TrackPoint
	for prows.Next() {
		var p TrackPoint
		if err := prows.Scan(&p.Ts, &p.Lat, &p.Lng, &p.AccuracyM, &p.Steps); err == nil {
			tpts = append(tpts, p)
		}
	}
	prows.Close()
	maxSpeed, _ := s.modeSpeeds(row.Mode)
	res := EvaluateTrack(tpts, FitnessRules{
		TargetM: s.qualTarget(ctx, row.Mode), MovingLimitS: s.qualLimit(ctx, row.Mode),
		ElapsedCapMult: s.effQualInt(ctx, "fitness.elapsed_cap_multiplier", s.cfg.Fitness.ElapsedCapMultiplier),
		MaxGapS:        s.effQualInt(ctx, "qualification.max_gap_s", s.cfg.Qualification.MaxGapS),
		MaxSpeedMps:    maxSpeed, MinMovingMps: s.cfg.Tracking.MinMovingSpeedMps,
		SegmentMaxGapS: s.cfg.Tracking.SegmentMaxGapS,
	})
	// Per-km splits (elapsed seconds at each km crossing).
	splits := []map[string]any{}
	if len(tpts) >= 2 {
		acc, nextKm := 0.0, 1
		for i := 1; i < len(tpts); i++ {
			acc += haversineM(tpts[i-1].Lat, tpts[i-1].Lng, tpts[i].Lat, tpts[i].Lng)
			for acc >= float64(nextKm*1000) {
				splits = append(splits, map[string]any{"km": nextKm,
					"elapsed_s": int(tpts[i].Ts.Sub(tpts[0].Ts).Seconds())})
				nextKm++
			}
		}
	}
	splitB, _ := json.Marshal(splits)
	flags := append([]string{}, row.Flags...)
	for _, f := range res.Flags {
		dup := false
		for _, have := range flags {
			if have == f {
				dup = true
				break
			}
		}
		if !dup {
			flags = append(flags, f)
		}
	}
	flagB, _ := json.Marshal(flags)
	elapsed := int(now.Sub(row.StartedAt).Seconds())
	if elapsed < 0 {
		elapsed = 0
	}
	if _, err := tx.Exec(ctx, `UPDATE activity_sessions SET status='ended', ended_at=$2, elapsed_s=$3,
		flags=$4, splits=$5 WHERE id=$1`, sessionID, now, elapsed, string(flagB), string(splitB)); err != nil {
		return nil, err
	}
	if len(tpts) >= 2 {
		_, _ = tx.Exec(ctx, `UPDATE activity_sessions SET track=(
			SELECT ST_MakeLine(pos::geometry ORDER BY ts)::geography FROM location_points WHERE session_id=$1
		) WHERE id=$2`, sessionID, sessionID)
	}
	// Lifetime totals (counted once: this path is the only ender).
	_, _ = tx.Exec(ctx, `INSERT INTO couriers(user_id,mode,lifetime_distance_m,lifetime_moving_s,lifetime_active_s)
		VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO UPDATE SET
		lifetime_distance_m=couriers.lifetime_distance_m+EXCLUDED.lifetime_distance_m,
		lifetime_moving_s=couriers.lifetime_moving_s+EXCLUDED.lifetime_moving_s,
		lifetime_active_s=couriers.lifetime_active_s+EXCLUDED.lifetime_active_s,
		updated_at=now()`, userID, row.Mode, row.DistM, row.MovingS, row.ActiveS)
	out := map[string]any{}
	if row.Kind == "qualification" {
		q := s.recordQualificationTx(ctx, tx, userID, row, res, now)
		out["qualification"] = q
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	fin2, _ := scanSession(s.db.QueryRow(ctx, `SELECT `+sessionCols+` FROM activity_sessions WHERE id=$1`, sessionID))
	v := s.sessionView(fin2, now)
	v["splits"] = splits
	out["session"] = v
	return out, nil
}

// recordQualificationTx stores the attempt, the evaluation, and moves the
// application to passed_test (pass) or leaves it in testing (fail, with the
// machine reason the app shows, e.g. the pace that was needed).
func (s *Server) recordQualificationTx(ctx context.Context, tx pgx.Tx, userID string, row sessionRow, res FitnessResult, now time.Time) map[string]any {
	_, _ = tx.Exec(ctx, `INSERT INTO fitness_attempts(user_id,session_id,mode,passed) VALUES($1,$2,$3,$4)`,
		userID, row.ID, row.Mode, res.Passed)
	flagB, _ := json.Marshal(res.Flags)
	target, limit := s.qualTarget(ctx, row.Mode), s.qualLimit(ctx, row.Mode)
	if res.Passed {
		_, _ = tx.Exec(ctx, `UPDATE courier_applications SET fitness_distance_m=$2, fitness_moving_s=$3,
			fitness_elapsed_s=$4, fitness_passed=true, fitness_flags=$5, fitness_gap_max_s=$6,
			fitness_evaluated_at=$7, qualification_session_id=$8, status='passed_test', updated_at=$7
			WHERE user_id=$1`, userID, res.DistanceM, res.MovingS, res.ElapsedS,
			string(flagB), res.MaxGapS, now, row.ID)
		_, _ = tx.Exec(ctx, `UPDATE couriers SET status='passed_test', updated_at=now() WHERE user_id=$1
			AND status IN ('draft','testing','rejected')`, userID)
	} else {
		_, _ = tx.Exec(ctx, `UPDATE courier_applications SET fitness_distance_m=$2, fitness_moving_s=$3,
			fitness_elapsed_s=$4, fitness_passed=false, fitness_flags=$5, fitness_gap_max_s=$6,
			fitness_evaluated_at=$7, qualification_session_id=$8, updated_at=$7
			WHERE user_id=$1`, userID, res.DistanceM, res.MovingS, res.ElapsedS,
			string(flagB), res.MaxGapS, now, row.ID)
	}
	msg := ""
	if !res.Passed {
		msg = failMessage(row.Mode, res, target, limit, s.effQualInt(ctx, "qualification.max_gap_s", s.cfg.Qualification.MaxGapS))
	}
	return map[string]any{
		"passed": res.Passed, "distance_m": res.DistanceM,
		"moving_s": res.MovingS, "elapsed_s": res.ElapsedS, "max_gap_s": res.MaxGapS,
		"flags": res.Flags, "fail_reasons": res.FailReasons, "message": msg,
		"target_distance_m": target, "moving_limit_s": limit,
		"retry_after_s": s.effQualInt(ctx, "qualification.retry_after_s", s.cfg.Qualification.RetryAfterS),
	}
}

// failMessage explains the failure the way the app shows it.
func failMessage(mode string, res FitnessResult, target float64, limit, maxGap int) string {
	for _, fr := range res.FailReasons {
		switch fr {
		case FailGPSGap:
			return fmt.Sprintf("tracking paused for %d s (keep the screen on; gaps over %d s invalidate the test)", res.MaxGapS, maxGap)
		case FailMovingOver:
			need := float64(limit) / (target / 1000)
			got := float64(res.MovingS) / (res.DistanceM/1000 + 1e-9)
			if mode == "biker" {
				return fmt.Sprintf("not yet: you needed %.1f km/h average, you rode %.1f km/h — try again in 1 hour",
					target/1000/(float64(limit)/3600), res.DistanceM/1000/(float64(res.MovingS)/3600+1e-9))
			}
			return fmt.Sprintf("not yet: you needed %s/km, you ran %s/km — try again in 1 hour",
				formatPace(need), formatPace(got))
		case FailElapsedCap:
			return fmt.Sprintf("total time over %d min (moving time %d min); rest up and try again in 1 hour",
				2*limit/60, res.MovingS/60)
		case FailShortDistance:
			return fmt.Sprintf("track too short: %.0f m of %.0f m recorded", res.DistanceM, target)
		}
	}
	return "not passed; try again in 1 hour"
}

func formatPace(sPerKm float64) string {
	if sPerKm <= 0 || sPerKm > 3600 {
		return "--:--"
	}
	m := int(sPerKm) / 60
	ss := int(sPerKm) % 60
	return fmt.Sprintf("%d:%02d", m, ss)
}

// postCheckpoint attaches a checkpoint photo (private-bucket file) to a
// qualification session; the AI verdict arrives with the Trust Brief (B6).
func (s *Server) postCheckpoint(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	id := r.PathValue("id")
	var b struct {
		FileID string `json:"file_id"`
	}
	if !decode(w, r, &b) {
		return
	}
	row, err := scanSession(s.db.QueryRow(r.Context(), `SELECT `+sessionCols+` FROM activity_sessions WHERE id=$1`, id))
	if err != nil {
		problem(w, 404, "Not found", "session not found")
		return
	}
	if row.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your session")
		return
	}
	if row.Status == "ended" {
		problem(w, 409, "Conflict", "session already ended")
		return
	}
	var bucket, status, owner string
	if err := s.db.QueryRow(r.Context(), `SELECT bucket,status,owner_id FROM files WHERE id=$1`, b.FileID).Scan(&bucket, &status, &owner); err != nil || owner != c.Sub {
		problem(w, 400, "Validation failed", "checkpoint photo file not found")
		return
	}
	if bucket != "private" || status != "ready" {
		problem(w, 400, "Validation failed", "checkpoint photo must be a finished private upload")
		return
	}
	var cid string
	var prompted *time.Time
	err = s.db.QueryRow(r.Context(), `INSERT INTO checkpoint_photos(session_id,file_id,prompted_at)
		VALUES($1,$2,$3) RETURNING id, prompted_at`, id, b.FileID, row.CheckpointPrompt).Scan(&cid, &prompted)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	out := map[string]any{"id": cid, "session_id": id, "file_id": b.FileID,
		"taken_at": time.Now().UTC().Format(time.RFC3339)}
	if prompted != nil {
		out["prompted_at"] = prompted.UTC().Format(time.RFC3339)
	}
	writeJSON(w, 201, out)
}

// courierStats returns lifetime totals, this week's active minutes against
// the WHO 150 min goal, and recent sessions.
func (s *Server) courierStats(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var dist float64
	var mov, act int64
	var deliveries, sessCount int
	_ = s.db.QueryRow(r.Context(), `SELECT lifetime_distance_m, lifetime_moving_s, lifetime_active_s, deliveries_count
		FROM couriers WHERE user_id=$1`, c.Sub).Scan(&dist, &mov, &act, &deliveries)
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM activity_sessions WHERE courier_id=$1 AND status='ended'`, c.Sub).Scan(&sessCount)
	var weekActive int64
	_ = s.db.QueryRow(r.Context(), `SELECT COALESCE(sum(active_s),0) FROM activity_sessions
		WHERE courier_id=$1 AND started_at >= date_trunc('week', now())`, c.Sub).Scan(&weekActive)
	writeJSON(w, 200, map[string]any{
		"lifetime": map[string]any{"distance_m": dist, "moving_s": mov, "active_s": act,
			"deliveries": deliveries, "sessions": sessCount},
		"weekly": map[string]any{"active_s": weekActive,
			"goal_s":   s.effectiveHealthGoal(r.Context(), "") * 60,
			"goal_met": weekActive >= int64(s.effectiveHealthGoal(r.Context(), "")*60)},
	})
}
