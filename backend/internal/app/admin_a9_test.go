package app

import (
	"encoding/json"
	"testing"
)

// A9 platform controls: settings validation, scope parsing, copilot routing.
// DB-backed behavior (effective overlays, audit writes, tool SQL) is covered
// by route + smoke tests against seeded backends; these pin the pure policy.

func TestParseSettingScope(t *testing.T) {
	for in, want := range map[string]string{
		"":           "global",
		"global":     "global",
		"ID":         "country:ID",
		"id":         "country:ID",
		"country:GB": "country:GB",
		"country:my": "country:MY",
	} {
		got, ok := parseSettingScope(in)
		if !ok || got != want {
			t.Fatalf("parseSettingScope(%q) = %q,%v, want %q,true", in, got, ok, want)
		}
	}
	for _, bad := range []string{
		"USA", "country:USA", "country:", "1D", "ID; DROP TABLE",
		"global;--", "country:ID,GB",
	} {
		if _, ok := parseSettingScope(bad); ok {
			t.Fatalf("parseSettingScope(%q) must be rejected", bad)
		}
	}
}

func TestValidateSettingValue(t *testing.T) {
	num := func(f float64) json.RawMessage {
		b, _ := json.Marshal(f)
		return b
	}
	// In-range integers pass.
	if v, msg := validateSettingValue("fitness.runner_distance_m", num(2000)); msg != "" || v != 2000 {
		t.Fatalf("runner distance 2000 must pass, got %v %q", v, msg)
	}
	// Numeric strings (form inputs) are accepted.
	if v, msg := validateSettingValue("dispatch.runner_corridor_m", json.RawMessage(`"400"`)); msg != "" || v != 400 {
		t.Fatalf("string 400 must pass, got %v %q", v, msg)
	}
	// Unknown keys never reach SQL.
	if _, msg := validateSettingValue("auth.jwt_secret", num(1)); msg == "" {
		t.Fatal("unknown key must be rejected")
	}
	if _, msg := validateSettingValue("dispatch.__proto__", num(1)); msg == "" {
		t.Fatal("prototype-flavoured key must be rejected")
	}
	// Out-of-range values are rejected.
	if _, msg := validateSettingValue("fitness.runner_distance_m", num(50)); msg == "" {
		t.Fatal("50 m runner test must be rejected")
	}
	if _, msg := validateSettingValue("fees.restaurant_commission_bps", num(5000)); msg == "" {
		t.Fatal("50% commission must be rejected")
	}
	// Whole-number rule for int settings.
	if _, msg := validateSettingValue("order.window_min_minutes", num(30.5)); msg == "" {
		t.Fatal("fractional minutes must be rejected")
	}
	// Float settings accept fractions.
	if _, msg := validateSettingValue("dispatch.runner_corridor_m", num(400.5)); msg != "" {
		t.Fatalf("fractional corridor must pass, got %q", msg)
	}
	// Non-numeric input is rejected.
	if _, msg := validateSettingValue("fitness.runner_distance_m", json.RawMessage(`"fast"`)); msg == "" {
		t.Fatal("non-numeric value must be rejected")
	}
}

func TestSettingRegistryCoversFlows(t *testing.T) {
	// Every flow the CMS editor claims to drive must have a registry key.
	for _, key := range []string{
		"fitness.runner_distance_m", "fitness.biker_moving_limit_s",
		"dispatch.runner_corridor_m", "dispatch.courier_search_s",
		"order.merchant_accept_window_s", "order.window_max_minutes",
		"fees.restaurant_commission_bps", "health.who_weekly_active_min",
	} {
		if _, ok := settingDefOf(key); !ok {
			t.Fatalf("registry missing %q", key)
		}
	}
	seen := map[string]bool{}
	for _, d := range settingDefs {
		if seen[d.Key] {
			t.Fatalf("duplicate registry key %q", d.Key)
		}
		seen[d.Key] = true
		if d.Min >= d.Max {
			t.Fatalf("registry %q has min >= max", d.Key)
		}
	}
}

func TestPickCopilotTools(t *testing.T) {
	// PLAN §10.F example routes to the in-window tool.
	if tools := pickCopilotTools("Which bikers had in-window deliveries under 80% last week?"); !containsTool(tools, "in_window_rate") {
		t.Fatalf("PLAN example must pick in_window_rate, got %v", tools)
	}
	if tools := pickCopilotTools("order volume trend this week"); !containsTool(tools, "weekly_volume") {
		t.Fatalf("volume question must pick weekly_volume, got %v", tools)
	}
	if tools := pickCopilotTools("top couriers by deliveries"); !containsTool(tools, "courier_leaderboard") {
		t.Fatalf("top question must pick courier_leaderboard, got %v", tools)
	}
	if tools := pickCopilotTools("which restaurants sell most"); !containsTool(tools, "merchant_volume") {
		t.Fatalf("restaurant question must pick merchant_volume, got %v", tools)
	}
	if tools := pickCopilotTools("how much did AI cost us"); !containsTool(tools, "ai_usage") {
		t.Fatalf("cost question must pick ai_usage, got %v", tools)
	}
	// Empty/unknown questions get the safe overview, never raw SQL.
	if tools := pickCopilotTools("hello"); len(tools) == 0 || tools[0] != "weekly_volume" {
		t.Fatalf("unknown question must default to weekly_volume, got %v", tools)
	}
	if tools := pickCopilotTools("x'; DROP TABLE orders;--"); len(tools) > 3 {
		t.Fatalf("injection-flavoured question must stay capped, got %v", tools)
	}
}

func containsTool(tools []string, want string) bool {
	for _, t := range tools {
		if t == want {
			return true
		}
	}
	return false
}

func TestParseAuditOffset(t *testing.T) {
	if got := parseAuditOffset(""); got != 0 {
		t.Fatalf("empty offset must be 0, got %d", got)
	}
	if got := parseAuditOffset("50"); got != 50 {
		t.Fatalf("offset 50 must pass through, got %d", got)
	}
	if got := parseAuditOffset("-5"); got != 0 {
		t.Fatalf("negative offset must clamp to 0, got %d", got)
	}
	if got := parseAuditOffset("999999"); got != 10000 {
		t.Fatalf("huge offset must clamp to 10000, got %d", got)
	}
}
