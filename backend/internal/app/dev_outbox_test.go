package app

import (
	"net/http"
	"testing"
)

// GET /v1/dev/outbox shows queued email bodies (verification and reset
// tokens), so it carries the push-log guards: token required (401), demo
// mode only (404), admin role only (403, including a token with no roles).
func TestDevOutboxGuards(t *testing.T) {
	const target = "/v1/dev/outbox"
	if code := devRouteStatus(t, true, nil, target); code != http.StatusUnauthorized {
		t.Fatalf("no token must be 401, got %d", code)
	}
	if code := devRouteStatus(t, false, []string{"admin"}, target); code != http.StatusNotFound {
		t.Fatalf("demo mode off must be 404, got %d", code)
	}
	for _, roles := range [][]string{{"courier"}, {"customer"}, {"merchant"}, {}} {
		if code := devRouteStatus(t, true, roles, target); code != http.StatusForbidden {
			t.Fatalf("roles %v must be 403, got %d", roles, code)
		}
	}
}
