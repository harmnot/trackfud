package app

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"Trackfud/internal/authjwt"
	"Trackfud/internal/config"
)

func TestParsePushLogSince(t *testing.T) {
	now := time.Date(2026, 11, 3, 10, 30, 0, 0, time.UTC)
	got, err := parsePushLogSince("", now)
	if err != nil || !got.Equal(now.Add(-10*time.Minute)) {
		t.Fatalf("empty since must default to now-10m, got %v %v", got, err)
	}
	for raw, want := range map[string]time.Time{
		"2026-11-03T10:00:00Z":             time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC),
		"2026-11-03T10:00:00.123456789Z":   time.Date(2026, 11, 3, 10, 0, 0, 123456789, time.UTC),
		"2026-11-03T17:00:00+07:00":        time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC),
		"2026-11-03T17:00:00 07:00":        time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC), // '+' form-decoded to a space
		" 2026-11-03T10:00:00.5Z ":         time.Date(2026, 11, 3, 10, 0, 0, 500000000, time.UTC),
		"2026-11-03T17:00:00.250000+07:00": time.Date(2026, 11, 3, 10, 0, 0, 250000000, time.UTC),
	} {
		got, err := parsePushLogSince(raw, now)
		if err != nil || !got.Equal(want) {
			t.Fatalf("parsePushLogSince(%q) = %v, %v; want %v", raw, got, err, want)
		}
	}
	for _, bad := range []string{"yesterday", "2026-11-03", "1730628000", "2026-11-03T10:00:00", "2026-13-03T10:00:00Z"} {
		if _, err := parsePushLogSince(bad, now); !errors.Is(err, errBadSince) {
			t.Fatalf("parsePushLogSince(%q) must be errBadSince, got %v", bad, err)
		}
	}
}

// pushLogReq calls GET /v1/dev/push-log with an optional query string.
func pushLogReq(t *testing.T, demo bool, roles []string, query string) int {
	t.Helper()
	return devRouteStatus(t, demo, roles, "/v1/dev/push-log"+query)
}

// devRouteStatus GETs target through the real route table as a CMS user
// holding roles (nil = no token) and returns the status code. Every dev
// route guard answers before the database is touched, so a nil pool is
// fine here.
func devRouteStatus(t *testing.T, demo bool, roles []string, target string) int {
	t.Helper()
	cfg := &config.Config{JWTSecret: "dev-route-test-secret"}
	cfg.Server.DemoMode = demo
	s := &Server{cfg: cfg}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if roles != nil {
		tok, err := authjwt.Sign(cfg.JWTSecret, authjwt.Claims{Sub: "11111111-2222-3333-4444-555555555555",
			Email: "admin@example.com", Roles: roles, App: "cms", Iat: time.Now().Unix(), Exp: time.Now().Add(time.Hour).Unix()})
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	rec := httptest.NewRecorder()
	s.Routes().ServeHTTP(rec, req)
	return rec.Code
}

// Demo mode only (404 otherwise), authenticated, admin role, valid since.
func TestDevPushLogGuards(t *testing.T) {
	if code := pushLogReq(t, true, nil, ""); code != http.StatusUnauthorized {
		t.Fatalf("no token must be 401, got %d", code)
	}
	if code := pushLogReq(t, false, []string{"admin"}, ""); code != http.StatusNotFound {
		t.Fatalf("demo mode off must be 404, got %d", code)
	}
	for _, roles := range [][]string{{"courier"}, {"customer"}, {"merchant"}} {
		if code := pushLogReq(t, true, roles, ""); code != http.StatusForbidden {
			t.Fatalf("role %v must be 403, got %d", roles, code)
		}
	}
	if code := pushLogReq(t, true, []string{"admin"}, "?since=not-a-time"); code != http.StatusBadRequest {
		t.Fatalf("bad since must be 400, got %d", code)
	}
}
