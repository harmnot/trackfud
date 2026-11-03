package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ---------- Dev push log (demo mode only) ----------
//
// GET /v1/dev/push-log?since=<RFC3339> lists recently queued web pushes
// (River push_send jobs) so the demo video can render phone notification
// banners in sync with the real backend events. Demo mode + admin only; it
// returns the push text and recipient id and no other user data.

// pushLogDefaultWindow is how far back the log looks when since is omitted.
const pushLogDefaultWindow = 10 * time.Minute

// pushLogLimit caps one page (oldest first); callers page with the last
// queued_at as the next since.
const pushLogLimit = 200

// errBadSince rejects an unparsable since parameter (400).
var errBadSince = errors.New("since must be an RFC3339 timestamp")

// pushLogEntry is one queued push in wire shape.
type pushLogEntry struct {
	ID       int64  `json:"id"`
	UserID   string `json:"user_id"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	QueuedAt string `json:"queued_at"`
	State    string `json:"state"`
}

// parsePushLogSince resolves the since query value: empty means now minus
// the default window. A '+' offset that arrived form-decoded as a space
// ("…T10:00:00 07:00") is restored before parsing.
func parsePushLogSince(raw string, now time.Time) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return now.Add(-pushLogDefaultWindow), nil
	}
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return t, nil
	}
	if strings.Contains(raw, " ") {
		if t, err := time.Parse(time.RFC3339Nano, strings.Replace(raw, " ", "+", 1)); err == nil {
			return t, nil
		}
	}
	return time.Time{}, errBadSince
}

// devPushLog serves the push log (demo mode + admin role).
func (s *Server) devPushLog(w http.ResponseWriter, r *http.Request) {
	if !s.requireDemo(w, r) {
		return
	}
	since, err := parsePushLogSince(r.URL.Query().Get("since"), time.Now())
	if err != nil {
		problem(w, 400, "Validation failed", err.Error())
		return
	}
	pushes, err := s.listQueuedPushes(r.Context(), since)
	if err != nil {
		s.log.Warn("dev push log query failed", "err", err)
		problem(w, 500, "Server error", "push log unavailable")
		return
	}
	writeJSON(w, 200, map[string]any{"pushes": pushes})
}

// listQueuedPushes reads push_send jobs created after since, oldest first,
// capped at pushLogLimit. Only the job's own args are read.
func (s *Server) listQueuedPushes(ctx context.Context, since time.Time) ([]pushLogEntry, error) {
	rows, err := s.db.Query(ctx, `SELECT id, COALESCE(args->>'user_id',''), COALESCE(args->>'title',''),
		COALESCE(args->>'body',''), created_at, state::text
		FROM river_job WHERE kind=$1 AND created_at > $2
		ORDER BY created_at, id LIMIT $3`, JobPushSend, since, pushLogLimit)
	if err != nil {
		return nil, fmt.Errorf("push log: %w", err)
	}
	defer rows.Close()
	out := []pushLogEntry{}
	for rows.Next() {
		var e pushLogEntry
		var queued time.Time
		if err := rows.Scan(&e.ID, &e.UserID, &e.Title, &e.Body, &queued, &e.State); err != nil {
			return nil, fmt.Errorf("push log scan: %w", err)
		}
		e.QueuedAt = queued.UTC().Format(time.RFC3339Nano)
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("push log rows: %w", err)
	}
	return out, nil
}
