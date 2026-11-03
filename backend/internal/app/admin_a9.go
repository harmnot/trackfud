// A9 platform controls for the CMS back office (PLAN.md §4.4):
// Settings editor (P0, per-country overrides of config.yaml),
// audit log viewer (P1), AI usage (P1, every model call), and
// Ops Copilot (P2, plain-words questions over read-only analytics tools).
//
// All five routes are admin-only via requireRole. Settings keys and scopes
// are allowlisted (unknown keys can never reach SQL); copilot tools run
// fixed SELECTs only — the question text never becomes SQL.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"Trackfud/internal/ai"
	"Trackfud/internal/config"
	"Trackfud/internal/order"
)

// ---------- Settings registry (pure) ----------

// SettingKind selects numeric validation.
type SettingKind string

const (
	SettingInt   SettingKind = "int"
	SettingFloat SettingKind = "float"
)

// SettingDef is one editable override. Defaults live in config.yaml; the DB
// holds only admin overrides (global or per country).
type SettingDef struct {
	Key   string
	Group string
	Label string
	Kind  SettingKind
	Min   float64
	Max   float64
	Hint  string
}

// settingDefs is the allowlist for PUT /v1/admin/settings. Anything not
// listed here is rejected before it can reach SQL or the live config.
var settingDefs = []SettingDef{
	{"fitness.runner_distance_m", "fitness", "Runner test distance (m)", SettingInt, 500, 10000, "PLAN §8.3 default 2000 m"},
	{"fitness.runner_moving_limit_s", "fitness", "Runner moving-time limit (s)", SettingInt, 300, 3600, "900 s = 7:30/km over 2 km"},
	{"fitness.biker_distance_m", "fitness", "Biker test distance (m)", SettingInt, 1000, 20000, "PLAN §8.3 default 5000 m"},
	{"fitness.biker_moving_limit_s", "fitness", "Biker moving-time limit (s)", SettingInt, 600, 5400, "1200 s = 15 km/h over 5 km"},
	{"fitness.elapsed_cap_multiplier", "fitness", "Elapsed-time cap (× moving limit)", SettingInt, 1, 4, "Total time must stay under moving limit × this"},
	{"qualification.retry_after_s", "qualification", "Retry wait after a failed test (s)", SettingInt, 0, 86400, "Default 3600 s (1 hour)"},
	{"qualification.max_attempts_per_week", "qualification", "Max test attempts per 7 days", SettingInt, 1, 10, "Default 3"},
	{"qualification.max_gap_s", "qualification", "Max GPS gap in a test (s)", SettingInt, 10, 300, "A gap over this invalidates the test"},
	{"qualification.checkpoint_photos", "qualification", "Checkpoint photos per test", SettingInt, 0, 5, "Random live-scene prompts during the test"},
	{"dispatch.runner_corridor_m", "dispatch", "Runner track corridor (m)", SettingFloat, 100, 3000, "Restaurant must be this close to the track"},
	{"dispatch.biker_corridor_m", "dispatch", "Biker track corridor (m)", SettingFloat, 100, 3000, "Default 800 m"},
	{"dispatch.runner_max_to_pickup_m", "dispatch", "Runner max courier→restaurant (m)", SettingFloat, 200, 10000, "Default 1500 m"},
	{"dispatch.biker_max_to_pickup_m", "dispatch", "Biker max courier→restaurant (m)", SettingFloat, 200, 10000, "Default 3000 m"},
	{"dispatch.runner_max_trip_m", "dispatch", "Runner max restaurant→customer (m)", SettingFloat, 500, 20000, "Default 3000 m"},
	{"dispatch.biker_max_trip_m", "dispatch", "Biker max restaurant→customer (m)", SettingFloat, 500, 20000, "Default 7000 m"},
	{"dispatch.offer_window_s", "dispatch", "Offer accept window (s)", SettingInt, 10, 120, "Time to accept one directed offer"},
	{"dispatch.courier_search_s", "dispatch", "Courier search window (s)", SettingInt, 60, 1800, "Then staff fallback begins"},
	{"dispatch.staff_search_s", "dispatch", "Staff search window (s)", SettingInt, 60, 1800, "Then the customer chooses"},
	{"dispatch.runner_max_carry_s", "dispatch", "Runner max carry time (s)", SettingInt, 300, 5400, "Pickup → customer cap, default 1500 s"},
	{"dispatch.biker_max_carry_s", "dispatch", "Biker max carry time (s)", SettingInt, 300, 5400, "Default 1800 s"},
	{"dispatch.runner_plan_kmh", "dispatch", "Runner planning speed (km/h)", SettingFloat, 5, 30, "ETA math while carrying food"},
	{"dispatch.biker_plan_kmh", "dispatch", "Biker planning speed (km/h)", SettingFloat, 8, 40, "Default 16 km/h"},
	{"order.merchant_accept_window_s", "order", "Merchant accept window (s)", SettingInt, 30, 900, "Then auto-cancel + full refund"},
	{"order.window_min_minutes", "order", "Delivery promise min (min)", SettingInt, 10, 120, "Customer-facing 30–60 min promise"},
	{"order.window_max_minutes", "order", "Delivery promise max (min)", SettingInt, 30, 240, "Must stay above the min"},
	{"fees.restaurant_commission_bps", "fees", "Restaurant commission (bps)", SettingInt, 0, 3000, "1000 = 10%"},
	{"fees.restaurant_commission_own_staff_bps", "fees", "Staff-delivery commission (bps)", SettingInt, 0, 3000, "500 = 5%"},
	{"fees.customer_service_fee_bps", "fees", "Customer service fee (bps)", SettingInt, 0, 2000, "300 = 3%"},
	{"health.who_weekly_active_min", "health", "WHO weekly active-minutes goal", SettingInt, 30, 600, "Default 150 min/week"},
	{"health.daily_active_cap_min", "health", "Daily active-time cap (min)", SettingInt, 30, 600, "Anti-overtraining guard"},
}

func settingDefOf(key string) (SettingDef, bool) {
	for _, d := range settingDefs {
		if d.Key == key {
			return d, true
		}
	}
	return SettingDef{}, false
}

// parseSettingScope validates an override scope: global or country:XX.
func parseSettingScope(v string) (string, bool) {
	v = strings.TrimSpace(v)
	if v == "" || v == "global" {
		return "global", true
	}
	upper := strings.ToUpper(v)
	if strings.HasPrefix(upper, "COUNTRY:") {
		cc := strings.TrimPrefix(upper, "COUNTRY:")
		if len(cc) == 2 && isAlpha2(cc) {
			return "country:" + cc, true
		}
		return "", false
	}
	if len(upper) == 2 && isAlpha2(upper) {
		return "country:" + upper, true
	}
	return "", false
}

func isAlpha2(s string) bool {
	for _, c := range s {
		if c < 'A' || c > 'Z' {
			return false
		}
	}
	return true
}

// validateSettingValue range-checks one override value. It accepts JSON
// numbers (or numeric strings from form inputs) and returns the normalized
// float64. Unknown keys and out-of-range values are rejected.
func validateSettingValue(key string, raw json.RawMessage) (float64, string) {
	def, ok := settingDefOf(key)
	if !ok {
		return 0, fmt.Sprintf("unknown setting %q", key)
	}
	var f float64
	if err := json.Unmarshal(raw, &f); err != nil {
		var s string
		if err2 := json.Unmarshal(raw, &s); err2 != nil {
			return 0, "value must be a number"
		}
		v, err3 := strconv.ParseFloat(strings.TrimSpace(s), 64)
		if err3 != nil {
			return 0, "value must be a number"
		}
		f = v
	}
	if f < def.Min || f > def.Max {
		return 0, fmt.Sprintf("%s must be between %v and %v", def.Label, def.Min, def.Max)
	}
	if def.Kind == SettingInt && f != float64(int64(f)) {
		return 0, def.Label + " must be a whole number"
	}
	return f, ""
}

// ---------- Override loading + effective config ----------

// loadOverrides reads admin overrides for the given scopes (global first,
// country second). Missing rows mean "use config.yaml". One indexed PK
// lookup per call; settings change rarely but must apply without restart.
func (s *Server) loadOverrides(ctx context.Context, scopes []string) map[string]float64 {
	out := map[string]float64{}
	if len(scopes) == 0 {
		return out
	}
	rows, err := s.db.Query(ctx, `SELECT key, value FROM platform_settings WHERE scope = ANY($1)`, scopes)
	if err != nil {
		return out
	}
	defer rows.Close()
	// Global first so a country row wins on duplicate keys.
	rank := map[string]int{}
	for i, sc := range scopes {
		rank[sc] = i
	}
	type hold struct {
		v float64
		r int
	}
	tmp := map[string]hold{}
	for rows.Next() {
		var k, scope string
		var raw json.RawMessage
		if err := rows.Scan(&k, &scope, &raw); err != nil {
			continue
		}
		var f float64
		if err := json.Unmarshal(raw, &f); err != nil {
			continue
		}
		if h, ok := tmp[k]; !ok || rank[scope] >= h.r {
			tmp[k] = hold{f, rank[scope]}
		}
	}
	for k, h := range tmp {
		out[k] = h.v
	}
	return out
}

func scopesForCountry(country string) []string {
	if cc := strings.ToUpper(strings.TrimSpace(country)); len(cc) == 2 && isAlpha2(cc) {
		return []string{"global", "country:" + cc}
	}
	return []string{"global"}
}

func effFloat(over map[string]float64, key string, def float64) float64 {
	if v, ok := over[key]; ok {
		return v
	}
	return def
}

func effInt(over map[string]float64, key string, def int) int {
	if v, ok := over[key]; ok {
		return int(v)
	}
	return def
}

// effectiveDispatch overlays admin overrides onto the startup config so the
// CMS settings editor drives dispatch without a restart.
func (s *Server) effectiveDispatch(ctx context.Context, country string) config.Dispatch {
	d := s.cfg.Dispatch
	over := s.loadOverrides(ctx, scopesForCountry(country))
	d.RunnerCorridorM = effFloat(over, "dispatch.runner_corridor_m", d.RunnerCorridorM)
	d.BikerCorridorM = effFloat(over, "dispatch.biker_corridor_m", d.BikerCorridorM)
	d.RunnerMaxToPickupM = effFloat(over, "dispatch.runner_max_to_pickup_m", d.RunnerMaxToPickupM)
	d.BikerMaxToPickupM = effFloat(over, "dispatch.biker_max_to_pickup_m", d.BikerMaxToPickupM)
	d.RunnerMaxTripM = effFloat(over, "dispatch.runner_max_trip_m", d.RunnerMaxTripM)
	d.BikerMaxTripM = effFloat(over, "dispatch.biker_max_trip_m", d.BikerMaxTripM)
	d.OfferWindowS = effInt(over, "dispatch.offer_window_s", d.OfferWindowS)
	d.SearchS = effInt(over, "dispatch.courier_search_s", d.SearchS)
	d.StaffS = effInt(over, "dispatch.staff_search_s", d.StaffS)
	d.RunnerMaxCarryS = effInt(over, "dispatch.runner_max_carry_s", d.RunnerMaxCarryS)
	d.BikerMaxCarryS = effInt(over, "dispatch.biker_max_carry_s", d.BikerMaxCarryS)
	d.RunnerPlanKmh = effFloat(over, "dispatch.runner_plan_kmh", d.RunnerPlanKmh)
	d.BikerPlanKmh = effFloat(over, "dispatch.biker_plan_kmh", d.BikerPlanKmh)
	return d
}

// merchantCountryForOrder resolves the merchant country behind an order for
// per-country settings. Empty means "global only" (never an error).
func (s *Server) merchantCountryForOrder(ctx context.Context, orderID string) string {
	var cc string
	_ = s.db.QueryRow(ctx, `SELECT m.country FROM merchants m JOIN orders o ON o.merchant_id=m.id WHERE o.id=$1`, orderID).Scan(&cc)
	return cc
}

// effectiveQualTarget/Limit drive the fitness test the courier PWA shows
// (same numbers the server enforces, via /config/public + evaluation).
func (s *Server) effectiveQualTarget(ctx context.Context, mode, country string) float64 {
	over := s.loadOverrides(ctx, scopesForCountry(country))
	if mode == "biker" {
		return effFloat(over, "fitness.biker_distance_m", s.cfg.Fitness.BikerDistanceM)
	}
	return effFloat(over, "fitness.runner_distance_m", s.cfg.Fitness.RunnerDistanceM)
}

func (s *Server) effectiveQualLimit(ctx context.Context, mode, country string) int {
	over := s.loadOverrides(ctx, scopesForCountry(country))
	if mode == "biker" {
		return effInt(over, "fitness.biker_moving_limit_s", s.cfg.Fitness.BikerMovingLimitS)
	}
	return effInt(over, "fitness.runner_moving_limit_s", s.cfg.Fitness.RunnerMovingLimitS)
}

// effectiveFees returns commission/staff/service basis points for a country.
// Defaults track the order package constants so quoting math cannot drift.
func (s *Server) effectiveFees(ctx context.Context, country string) (commission, staff, service int) {
	over := s.loadOverrides(ctx, scopesForCountry(country))
	return effInt(over, "fees.restaurant_commission_bps", order.CommissionBps),
		effInt(over, "fees.restaurant_commission_own_staff_bps", order.CommissionStaffBps),
		effInt(over, "fees.customer_service_fee_bps", order.ServiceFeeBps)
}

// effectiveOrderWindows returns (accept window s, promise min, promise max).
func (s *Server) effectiveOrderWindows(ctx context.Context, country string) (int, int, int) {
	over := s.loadOverrides(ctx, scopesForCountry(country))
	return effInt(over, "order.merchant_accept_window_s", s.cfg.Order.MerchantAcceptWindowS),
		effInt(over, "order.window_min_minutes", s.cfg.Order.WindowMinMinutes),
		effInt(over, "order.window_max_minutes", s.cfg.Order.WindowMaxMinutes)
}

// effectiveAcceptWindow returns just the merchant accept timeout (s).
func (s *Server) effectiveAcceptWindow(ctx context.Context, country string) int {
	win, _, _ := s.effectiveOrderWindows(ctx, country)
	return win
}

// effectiveHealthGoal returns the WHO weekly active-minutes goal.
func (s *Server) effectiveHealthGoal(ctx context.Context, country string) int {
	over := s.loadOverrides(ctx, scopesForCountry(country))
	return effInt(over, "health.who_weekly_active_min", s.cfg.Health.WhoWeeklyActiveMin)
}

// effQualInt reads one global qualification override (fitness-test rules are
// platform-wide; per-country scoping applies to merchant-facing settings).
func (s *Server) effQualInt(ctx context.Context, key string, def int) int {
	return effInt(s.loadOverrides(ctx, []string{"global"}), key, def)
}

// ---------- Settings handlers ----------

// getAdminSettings serves the editor model: every editable key with its
// definition, the stored override (if any), the config.yaml default, and the
// effective value for the requested scope.
func (s *Server) getAdminSettings(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	scope, ok := parseSettingScope(r.URL.Query().Get("scope"))
	if !ok {
		problem(w, 400, "Validation failed", "scope must be global or a 2-letter country code")
		return
	}
	scopes := []string{"global"}
	if scope != "global" {
		scopes = append(scopes, scope)
	}
	stored := map[string]json.RawMessage{}
	if rows, err := s.db.Query(r.Context(), `SELECT key, value FROM platform_settings WHERE scope = ANY($1)`, scopes); err == nil {
		defer rows.Close()
		rank := map[string]int{"global": 0}
		rank[scope] = 1
		best := map[string]int{}
		for rows.Next() {
			var k, sc string
			var raw json.RawMessage
			if err := rows.Scan(&k, &sc, &raw); err != nil {
				continue
			}
			if b, seen := best[k]; !seen || rank[sc] >= b {
				best[k] = rank[sc]
				stored[k] = raw
			}
		}
	}
	over := s.loadOverrides(r.Context(), scopes)
	items := []map[string]any{}
	for _, d := range settingDefs {
		items = append(items, map[string]any{
			"key": d.Key, "group": d.Group, "label": d.Label,
			"kind": string(d.Kind), "min": d.Min, "max": d.Max, "hint": d.Hint,
			"override":   json.RawMessage(orNil(stored[d.Key])),
			"effective":  effFloat(over, d.Key, settingDefault(s.cfg, d.Key)),
			"is_default": settingDefault(s.cfg, d.Key),
		})
	}
	writeJSON(w, 200, map[string]any{"scope": scope, "settings": items})
}

func orNil(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("null")
	}
	return raw
}

// settingDefault reads the config.yaml value behind a registry key.
func settingDefault(cfg *config.Config, key string) float64 {
	switch key {
	case "fitness.runner_distance_m":
		return cfg.Fitness.RunnerDistanceM
	case "fitness.runner_moving_limit_s":
		return float64(cfg.Fitness.RunnerMovingLimitS)
	case "fitness.biker_distance_m":
		return cfg.Fitness.BikerDistanceM
	case "fitness.biker_moving_limit_s":
		return float64(cfg.Fitness.BikerMovingLimitS)
	case "fitness.elapsed_cap_multiplier":
		return float64(cfg.Fitness.ElapsedCapMultiplier)
	case "qualification.retry_after_s":
		return float64(cfg.Qualification.RetryAfterS)
	case "qualification.max_attempts_per_week":
		return float64(cfg.Qualification.MaxAttemptsPerWeek)
	case "qualification.max_gap_s":
		return float64(cfg.Qualification.MaxGapS)
	case "qualification.checkpoint_photos":
		return float64(cfg.Qualification.CheckpointPhotos)
	case "dispatch.runner_corridor_m":
		return cfg.Dispatch.RunnerCorridorM
	case "dispatch.biker_corridor_m":
		return cfg.Dispatch.BikerCorridorM
	case "dispatch.runner_max_to_pickup_m":
		return cfg.Dispatch.RunnerMaxToPickupM
	case "dispatch.biker_max_to_pickup_m":
		return cfg.Dispatch.BikerMaxToPickupM
	case "dispatch.runner_max_trip_m":
		return cfg.Dispatch.RunnerMaxTripM
	case "dispatch.biker_max_trip_m":
		return cfg.Dispatch.BikerMaxTripM
	case "dispatch.offer_window_s":
		return float64(cfg.Dispatch.OfferWindowS)
	case "dispatch.courier_search_s":
		return float64(cfg.Dispatch.SearchS)
	case "dispatch.staff_search_s":
		return float64(cfg.Dispatch.StaffS)
	case "dispatch.runner_max_carry_s":
		return float64(cfg.Dispatch.RunnerMaxCarryS)
	case "dispatch.biker_max_carry_s":
		return float64(cfg.Dispatch.BikerMaxCarryS)
	case "dispatch.runner_plan_kmh":
		return cfg.Dispatch.RunnerPlanKmh
	case "dispatch.biker_plan_kmh":
		return cfg.Dispatch.BikerPlanKmh
	case "order.merchant_accept_window_s":
		return float64(cfg.Order.MerchantAcceptWindowS)
	case "order.window_min_minutes":
		return float64(cfg.Order.WindowMinMinutes)
	case "order.window_max_minutes":
		return float64(cfg.Order.WindowMaxMinutes)
	case "fees.restaurant_commission_bps":
		return float64(order.CommissionBps)
	case "fees.restaurant_commission_own_staff_bps":
		return float64(order.CommissionStaffBps)
	case "fees.customer_service_fee_bps":
		return float64(order.ServiceFeeBps)
	case "health.who_weekly_active_min":
		return float64(cfg.Health.WhoWeeklyActiveMin)
	case "health.daily_active_cap_min":
		return float64(cfg.Health.DailyActiveCapMin)
	}
	return 0
}

// putAdminSetting stores one override (upsert) and audit-logs it with the
// previous value. A null value deletes the override (back to config.yaml).
func (s *Server) putAdminSetting(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	var b struct {
		Scope string          `json:"scope"`
		Key   string          `json:"key"`
		Value json.RawMessage `json:"value"`
	}
	if !decode(w, r, &b) {
		return
	}
	scope, ok := parseSettingScope(b.Scope)
	if !ok {
		problem(w, 400, "Validation failed", "scope must be global or a 2-letter country code")
		return
	}
	key := strings.TrimSpace(b.Key)
	if _, ok := settingDefOf(key); !ok {
		problem(w, 400, "Validation failed", fmt.Sprintf("unknown setting %q", key))
		return
	}
	c := claims(r)
	actor := ""
	if c != nil {
		actor = c.Sub
	}
	if len(b.Value) == 0 || string(b.Value) == "null" {
		var before json.RawMessage
		_ = s.db.QueryRow(r.Context(), `DELETE FROM platform_settings WHERE key=$1 AND scope=$2 RETURNING value`, key, scope).Scan(&before)
		s.writeAudit(r.Context(), r, "settings.clear", "setting", scope+"/"+key, "", before, json.RawMessage("null"))
		writeJSON(w, 200, map[string]any{"key": key, "scope": scope, "cleared": true})
		return
	}
	v, msg := validateSettingValue(key, b.Value)
	if msg != "" {
		problem(w, 400, "Validation failed", msg)
		return
	}
	// Order windows must stay ordered: min <= max.
	if key == "order.window_min_minutes" || key == "order.window_max_minutes" {
		over := s.loadOverrides(r.Context(), []string{scope})
		minV, maxV := effFloat(over, "order.window_min_minutes", float64(s.cfg.Order.WindowMinMinutes)),
			effFloat(over, "order.window_max_minutes", float64(s.cfg.Order.WindowMaxMinutes))
		if key == "order.window_min_minutes" {
			minV = v
		} else {
			maxV = v
		}
		if minV > maxV {
			problem(w, 400, "Validation failed", "window min must not exceed window max")
			return
		}
	}
	var before json.RawMessage
	_ = s.db.QueryRow(r.Context(), `SELECT value FROM platform_settings WHERE key=$1 AND scope=$2`, key, scope).Scan(&before)
	norm, _ := json.Marshal(v)
	if _, err := s.db.Exec(r.Context(), `INSERT INTO platform_settings(key,scope,value,updated_by) VALUES($1,$2,$3,$4)
		ON CONFLICT (key,scope) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
		key, scope, norm, actor); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	s.writeAudit(r.Context(), r, "settings.update", "setting", scope+"/"+key, "", before, norm)
	writeJSON(w, 200, map[string]any{"key": key, "scope": scope, "value": v})
}

// ---------- Audit log ----------

var auditActions = map[string]bool{
	"settings.update": true, "settings.clear": true,
	"courier.approve": true, "courier.reject": true,
	"courier.freeze": true, "courier.unfreeze": true, "courier.ban": true,
	"merchant.approve": true, "merchant.reject": true,
	"merchant.ban": true, "merchant.unban": true,
	"order.refund": true, "withdrawal.hold": true, "withdrawal.release": true,
	"demo.bots_start": true, "demo.bots_stop": true,
	"demo.force_no_courier": true, "demo.reset": true,
}

// writeAudit records one admin mutation. Best-effort: it never fails the
// caller. before/after are stored as JSON for the viewer diff.
func (s *Server) writeAudit(ctx context.Context, r *http.Request, action, targetType, targetID, reason string, before, after any) {
	if !auditActions[action] {
		return
	}
	actor := ""
	if c := claims(r); c != nil {
		actor = c.Sub
	}
	ip := ""
	if r != nil {
		ip = r.RemoteAddr
		if h := r.Header.Get("X-Forwarded-For"); h != "" {
			ip = strings.Split(h, ",")[0]
		}
		ip = strings.TrimSpace(ip)
		if len(ip) > 64 {
			ip = ip[:64]
		}
	}
	bb, _ := json.Marshal(before)
	if len(bb) == 0 {
		bb = []byte("{}")
	}
	ab, _ := json.Marshal(after)
	if len(ab) == 0 {
		ab = []byte("{}")
	}
	if len(reason) > 500 {
		reason = reason[:500]
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO audit_logs(actor_id,action,target_type,target_id,reason,before,after,ip)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, actor, action, targetType, targetID, reason, bb, ab, ip)
}

// parseAuditLimit clamps ?limit= to 1..100 (default 50); offset is >= 0.
func parseAuditLimit(v string) int { return parseAdminLimit(v) }

func parseAuditOffset(v string) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 0 {
		return 0
	}
	if n > 10000 {
		return 10000
	}
	return n
}

// listAdminAudit serves the audit viewer: newest first, optional
// ?action=, ?target_type= and ?actor= filters, ?limit= + ?offset= paging.
func (s *Server) listAdminAudit(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	q := r.URL.Query()
	action := strings.TrimSpace(q.Get("action"))
	target := strings.TrimSpace(q.Get("target_type"))
	actor := strings.TrimSpace(q.Get("actor"))
	limit := parseAuditLimit(q.Get("limit"))
	offset := parseAuditOffset(q.Get("offset"))
	where := []string{}
	args := []any{}
	if action != "" {
		if !auditActions[action] {
			problem(w, 400, "Validation failed", "unknown audit action")
			return
		}
		args = append(args, action)
		where = append(where, fmt.Sprintf("action=$%d", len(args)))
	}
	if target != "" {
		if len(target) > 40 {
			problem(w, 400, "Validation failed", "target_type too long")
			return
		}
		args = append(args, target)
		where = append(where, fmt.Sprintf("target_type=$%d", len(args)))
	}
	if actor != "" {
		if len(actor) > 100 {
			problem(w, 400, "Validation failed", "actor filter too long")
			return
		}
		args = append(args, actor)
		where = append(where, fmt.Sprintf("actor_id=$%d", len(args)))
	}
	base := `FROM audit_logs`
	if len(where) > 0 {
		base += ` WHERE ` + strings.Join(where, " AND ")
	}
	var total int
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) `+base, args...).Scan(&total)
	args = append(args, limit, offset)
	rows, err := s.db.Query(r.Context(), `SELECT actor_id, action, target_type, target_id, reason,
		before, after, ip, created_at `+base+fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var actorID, act, tt, tid, reason, ip string
		var before, after json.RawMessage
		var at time.Time
		if err := rows.Scan(&actorID, &act, &tt, &tid, &reason, &before, &after, &ip, &at); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"actor_id": actorID, "action": act, "target_type": tt, "target_id": tid,
			"reason": reason, "before": json.RawMessage(orEmptyObj(before)),
			"after":      json.RawMessage(orEmptyObj(after)),
			"created_at": at.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, 200, map[string]any{"entries": out, "total": total, "limit": limit, "offset": offset})
}

func orEmptyObj(b json.RawMessage) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("{}")
	}
	return b
}

// ---------- AI usage (P1: "AI under the hood") ----------

var aiFeatures = map[string]bool{
	"menu_import": true, "chat_translate": true, "trust_brief": true,
	"proof_check": true, "feedback_labels": true, "coach_report": true,
	"voice_copilot": true, "voice_transcribe": true, "copilot": true,
	"run_plan": true, "sam_crop": true,
}

// listAdminAICalls serves the raw call log, newest first, with an optional
// ?feature= filter and ?limit= (1..100, default 50). Only metadata ships —
// never prompt content or personal data.
func (s *Server) listAdminAICalls(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	feature := strings.TrimSpace(r.URL.Query().Get("feature"))
	limit := parseAdminLimit(r.URL.Query().Get("limit"))
	q := `SELECT feature, model, prompt_version, latency_ms, input_tokens,
		output_tokens, cost_micros, fallback, error, created_at FROM ai_calls`
	args := []any{}
	if feature != "" {
		if !aiFeatures[feature] {
			problem(w, 400, "Validation failed", "unknown AI feature")
			return
		}
		q += ` WHERE feature=$1`
		args = append(args, feature)
	}
	q += fmt.Sprintf(` ORDER BY created_at DESC LIMIT %d`, limit)
	rows, err := s.db.Query(r.Context(), q, args...)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var feat, model, pv, errText string
		var lat, inTok, outTok, cost int64
		var fallback bool
		var at time.Time
		if err := rows.Scan(&feat, &model, &pv, &lat, &inTok, &outTok, &cost, &fallback, &errText, &at); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"feature": feat, "model": model, "prompt_version": pv,
			"latency_ms": lat, "input_tokens": inTok, "output_tokens": outTok,
			"cost_micros": cost, "fallback": fallback, "error": errText,
			"created_at": at.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, 200, map[string]any{"calls": out})
}

// adminAISummary aggregates the log per feature+model for the AI page cards:
// call counts, avg latency, tokens, integer-micro cost, fallbacks + errors.
func (s *Server) adminAISummary(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT feature, model,
		count(*), COALESCE(avg(latency_ms),0), COALESCE(sum(input_tokens),0),
		COALESCE(sum(output_tokens),0), COALESCE(sum(cost_micros),0),
		count(*) FILTER (WHERE fallback), count(*) FILTER (WHERE error<>''),
		max(created_at) FROM ai_calls GROUP BY feature, model ORDER BY feature, model`)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var feat, model string
		var n int64
		var avgLat float64
		var inTok, outTok, cost, fallbacks, errors int64
		var last *time.Time
		if err := rows.Scan(&feat, &model, &n, &avgLat, &inTok, &outTok, &cost, &fallbacks, &errors, &last); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"feature": feat, "model": model, "calls": n,
			"avg_latency_ms": int64(avgLat + 0.5),
			"input_tokens":   inTok, "output_tokens": outTok,
			"cost_micros": cost, "fallbacks": fallbacks, "errors": errors,
			"last_at": iso(last),
		})
	}
	writeJSON(w, 200, map[string]any{"summary": out})
}

// ---------- Ops Copilot (P2, PLAN §10.F) ----------

// copilotTools are the read-only analytics tools the assistant may call. The
// question text never becomes SQL: the router below picks from this fixed
// list by keyword, and each tool runs one parameterized SELECT.
var copilotTools = []string{
	"weekly_volume", "in_window_rate", "courier_leaderboard",
	"merchant_volume", "ai_usage",
}

const copilotPromptVersion = "copilot.v1"

const copilotSystem = `You are the Trackfud Ops Copilot. Answer the admin's question using ONLY the tool-result JSON provided. Be short and specific: lead with the number, then one sentence of context. Never invent rows, names, or numbers not present in the tool results. If the data is empty, say so honestly. No medical, legal, or payout instructions.`

// pickCopilotTools routes a plain-words question to at most 3 fixed tools.
// Pure + tested: no model needed to choose what to measure.
func pickCopilotTools(question string) []string {
	q := strings.ToLower(question)
	has := func(words ...string) bool {
		for _, wd := range words {
			if strings.Contains(q, wd) {
				return true
			}
		}
		return false
	}
	picked := []string{}
	add := func(t string) {
		for _, p := range picked {
			if p == t {
				return
			}
		}
		if len(picked) < 3 {
			picked = append(picked, t)
		}
	}
	if has("biker", "runner", "courier", "late", "in-window", "in window", "under 80", "80%", "on time", "slow") {
		add("in_window_rate")
	}
	if has("courier", "top", "best", "leaderboard", "perform") {
		add("courier_leaderboard")
	}
	if has("merchant", "restaurant", "store") {
		add("merchant_volume")
	}
	if has("ai", "model", "token", "cost", "copilot") {
		add("ai_usage")
	}
	if has("volume", "order", "many", "week", "today", "trend", "overview", "summar") || len(picked) == 0 {
		add("weekly_volume")
	}
	if len(picked) == 1 && picked[0] == "weekly_volume" && has("deliver", "courier", "biker", "runner") {
		add("in_window_rate")
	}
	return picked
}

// copilotTable is one rendered result table.
type copilotTable struct {
	Title   string     `json:"title"`
	Columns []string   `json:"columns"`
	Rows    [][]string `json:"rows"`
}

func str2(v any) string {
	switch t := v.(type) {
	case nil:
		return "—"
	case string:
		if t == "" {
			return "—"
		}
		return t
	case int64:
		return strconv.FormatInt(t, 10)
	case int:
		return strconv.Itoa(t)
	case float64:
		return strconv.FormatFloat(t, 'f', 1, 64)
	default:
		return fmt.Sprintf("%v", t)
	}
}

// runCopilotTool executes one fixed read-only aggregation. Limits are
// hardcoded; the question contributes no SQL.
func (s *Server) runCopilotTool(ctx context.Context, tool string) copilotTable {
	switch tool {
	case "in_window_rate":
		// PLAN §10.F example: bikers with in-window deliveries under 80%.
		rows, err := s.db.Query(ctx, `SELECT COALESCE(c.mode,'?'), count(*),
			count(*) FILTER (WHERE d.delivered_at <= o.window_end),
			round(100.0*count(*) FILTER (WHERE d.delivered_at <= o.window_end)/NULLIF(count(*),0),1)
			FROM deliveries d JOIN orders o ON o.id=d.order_id
			LEFT JOIN couriers c ON c.user_id=d.courier_id
			WHERE d.status='delivered' AND d.delivered_at > now()-interval '7 days'
			GROUP BY c.mode ORDER BY 2 DESC`)
		if err != nil {
			return copilotTable{Title: "In-window delivery rate by mode (7d)", Columns: []string{"mode", "delivered", "in-window", "pct"}, Rows: [][]string{}}
		}
		defer rows.Close()
		out := [][]string{}
		for rows.Next() {
			var mode string
			var n, inWin int64
			var pct *float64
			if err := rows.Scan(&mode, &n, &inWin, &pct); err != nil {
				continue
			}
			p := "—"
			if pct != nil {
				p = fmt.Sprintf("%.1f%%", *pct)
			}
			out = append(out, []string{mode, str2(n), str2(inWin), p})
		}
		return copilotTable{Title: "In-window delivery rate by mode (7d)", Columns: []string{"mode", "delivered", "in-window", "pct"}, Rows: out}
	case "courier_leaderboard":
		rows, err := s.db.Query(ctx, `SELECT COALESCE(u.email,'?'), COALESCE(c.mode,'?'), count(*),
			round(100.0*count(*) FILTER (WHERE d.delivered_at <= o.window_end)/NULLIF(count(*),0),1)
			FROM deliveries d JOIN orders o ON o.id=d.order_id
			LEFT JOIN couriers c ON c.user_id=d.courier_id
			LEFT JOIN users u ON u.id=d.courier_id
			WHERE d.status='delivered' AND d.delivered_at > now()-interval '7 days'
			GROUP BY u.email, c.mode ORDER BY 3 DESC LIMIT 5`)
		if err != nil {
			return copilotTable{Title: "Top couriers (7d)", Columns: []string{"courier", "mode", "delivered", "in-window %"}, Rows: [][]string{}}
		}
		defer rows.Close()
		out := [][]string{}
		for rows.Next() {
			var email, mode string
			var n int64
			var pct *float64
			if err := rows.Scan(&email, &mode, &n, &pct); err != nil {
				continue
			}
			p := "—"
			if pct != nil {
				p = fmt.Sprintf("%.1f%%", *pct)
			}
			out = append(out, []string{email, mode, str2(n), p})
		}
		return copilotTable{Title: "Top couriers (7d)", Columns: []string{"courier", "mode", "delivered", "in-window %"}, Rows: out}
	case "merchant_volume":
		rows, err := s.db.Query(ctx, `SELECT m.name, count(*),
			count(*) FILTER (WHERE o.status='delivered')
			FROM orders o JOIN merchants m ON m.id=o.merchant_id
			WHERE o.created_at > now()-interval '7 days'
			GROUP BY m.name ORDER BY 2 DESC LIMIT 5`)
		if err != nil {
			return copilotTable{Title: "Top merchants (7d)", Columns: []string{"merchant", "orders", "delivered"}, Rows: [][]string{}}
		}
		defer rows.Close()
		out := [][]string{}
		for rows.Next() {
			var name string
			var n, d int64
			if err := rows.Scan(&name, &n, &d); err != nil {
				continue
			}
			out = append(out, []string{name, str2(n), str2(d)})
		}
		return copilotTable{Title: "Top merchants (7d)", Columns: []string{"merchant", "orders", "delivered"}, Rows: out}
	case "ai_usage":
		rows, err := s.db.Query(ctx, `SELECT feature, count(*), COALESCE(sum(cost_micros),0),
			count(*) FILTER (WHERE fallback), count(*) FILTER (WHERE error<>'')
			FROM ai_calls WHERE created_at > now()-interval '7 days'
			GROUP BY feature ORDER BY 2 DESC`)
		if err != nil {
			return copilotTable{Title: "AI usage (7d)", Columns: []string{"feature", "calls", "cost_usd", "fallbacks", "errors"}, Rows: [][]string{}}
		}
		defer rows.Close()
		out := [][]string{}
		for rows.Next() {
			var feat string
			var n, cost, fb, errs int64
			if err := rows.Scan(&feat, &n, &cost, &fb, &errs); err != nil {
				continue
			}
			out = append(out, []string{feat, str2(n), fmt.Sprintf("$%.4f", float64(cost)/1e6), str2(fb), str2(errs)})
		}
		return copilotTable{Title: "AI usage (7d)", Columns: []string{"feature", "calls", "cost_usd", "fallbacks", "errors"}, Rows: out}
	default: // weekly_volume
		rows, err := s.db.Query(ctx, `SELECT to_char(date_trunc('day',created_at),'YYYY-MM-DD'), count(*),
			count(*) FILTER (WHERE status='delivered')
			FROM orders WHERE created_at > now()-interval '7 days'
			GROUP BY 1 ORDER BY 1`)
		if err != nil {
			return copilotTable{Title: "Order volume (7d)", Columns: []string{"day", "orders", "delivered"}, Rows: [][]string{}}
		}
		defer rows.Close()
		out := [][]string{}
		for rows.Next() {
			var day string
			var n, d int64
			if err := rows.Scan(&day, &n, &d); err != nil {
				continue
			}
			out = append(out, []string{day, str2(n), str2(d)})
		}
		return copilotTable{Title: "Order volume (7d)", Columns: []string{"day", "orders", "delivered"}, Rows: out}
	}
}

// copilotFallbackAnswer composes an honest deterministic answer from tool
// tables when no model key is configured. No numbers are invented: every
// sentence cites a table cell that exists.
func copilotFallbackAnswer(question string, tables []copilotTable) string {
	if len(tables) == 0 {
		return "No data yet for that question — seed some orders first."
	}
	var sb strings.Builder
	sb.WriteString("Measured over the last 7 days (offline summary, no model call): ")
	for i, t := range tables {
		if i > 0 {
			sb.WriteString(" ")
		}
		if len(t.Rows) == 0 {
			fmt.Fprintf(&sb, "%s: no rows yet.", t.Title)
			continue
		}
		fmt.Fprintf(&sb, "%s: %d row(s); first row [%s].", t.Title, len(t.Rows), strings.Join(t.Rows[0], " · "))
	}
	return sb.String()
}

// copilotAsk answers a plain-words ops question (PLAN §10.F). It picks fixed
// read-only tools by keyword, runs them, then asks Muse Spark to word the
// answer — or returns the deterministic summary when no model key exists.
func (s *Server) copilotAsk(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	var b struct {
		Question string `json:"question"`
	}
	if !decode(w, r, &b) {
		return
	}
	question := strings.TrimSpace(b.Question)
	if len(question) < 2 || len(question) > 500 {
		problem(w, 400, "Validation failed", "question must be 2-500 characters")
		return
	}
	tools := pickCopilotTools(question)
	tables := []copilotTable{}
	toolPayload := []map[string]any{}
	for _, t := range tools {
		tab := s.runCopilotTool(r.Context(), t)
		tables = append(tables, tab)
		toolPayload = append(toolPayload, map[string]any{
			"tool": t, "title": tab.Title, "columns": tab.Columns, "rows": tab.Rows,
		})
	}
	answer := copilotFallbackAnswer(question, tables)
	live := false
	if s.ai.cli.HasKey() {
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		tb, _ := json.Marshal(toolPayload)
		user := "Question: " + question + "\nTool results: " + string(tb)
		schema := map[string]any{
			"type": "object",
			"properties": map[string]any{
				"answer": map[string]any{"type": "string"},
			},
			"required": []string{"answer"},
		}
		if raw, err := s.ai.cli.ChatJSON(ctx, "copilot", copilotPromptVersion, s.ai.cli.SparkModel(),
			copilotSystem, user, "copilot_answer", schema, s.aiLog); err == nil {
			var parsed struct {
				Answer string `json:"answer"`
			}
			if jerr := json.Unmarshal([]byte(raw), &parsed); jerr == nil && strings.TrimSpace(parsed.Answer) != "" {
				answer = parsed.Answer
				live = true
			}
		}
	} else {
		s.logAICall(r.Context(), ai.CallRecord{Feature: "copilot", Model: s.ai.cli.SparkModel(), PromptVersion: copilotPromptVersion, Fallback: true})
	}
	if len(answer) > 2000 {
		answer = answer[:2000]
	}
	writeJSON(w, 200, map[string]any{
		"answer": answer, "tables": tables, "tools_used": tools, "live": live,
	})
}
