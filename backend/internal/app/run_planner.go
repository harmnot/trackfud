package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"Trackfud/internal/ai"
	"Trackfud/internal/maps"
	"Trackfud/internal/order"
)

// ---------- AI Run Planner (PLAN §10.E, R3) ----------
//
// The courier asks "plan a 5K easy loop from here for lunch". The workout
// comes first (distance, easy pace), then the route passes busy restaurants
// so dispatch has something to offer inside its corridor. Two loop options
// are returned on the map; the chosen one becomes `planned_track` on the
// next work session, so the AI plan drives the dispatch corridor (§6.1).
//
// Tools per plan: get_hotspots (busy merchants from past orders),
// make_loop (circle pulled toward hotspots, ≤10 waypoints so a future
// Routes-API call stays on Essentials), estimate_earnings (fee math, honest
// estimate label). With a model key the server asks Muse Spark to word the
// two options; without one the deterministic heuristic wording ships and the
// call is logged as fallback (same B6 pattern as coach/voice).

const (
	plannerFeature   = "run_plan"
	plannerPromptVer = "planner-v2"
	maxPlanWaypoints = 10
	// plannerAIBudget caps the optional model wording (~1.9k output tokens:
	// typically 6–9 s on Modal, spikes past 15 s). The courier PWA gives this
	// one request PLANNER_TIMEOUT_MS = 35 s (src/features/planner/api.ts), so
	// budget + routing must stay below that or the rider sees an error instead
	// of the deterministic plans.
	plannerAIBudget = 25 * time.Second
	// plannerHedgeAfter: healthy planner calls answer in 4–9 s; a call still
	// silent after this is most likely parked on a cold container.
	plannerHedgeAfter = 9 * time.Second
)

// hotspot is one busy restaurant near the start.
type hotspot struct {
	MerchantID string  `json:"merchant_id"`
	Name       string  `json:"merchant_name"`
	Lat        float64 `json:"lat"`
	Lng        float64 `json:"lng"`
	DistanceM  float64 `json:"distance_m"`
	Orders7d   int     `json:"orders_7d"`
	Currency   string  `json:"currency"`
}

// runPlan is one loop option.
type runPlan struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Mode        string         `json:"mode"`
	DistanceM   float64        `json:"distance_m"`
	DurationS   int            `json:"duration_s"`
	CorridorM   float64        `json:"corridor_m"`
	Waypoints   []waypoint     `json:"waypoints"`
	GeoJSON     map[string]any `json:"planned_track"`
	HotspotIDs  []string       `json:"hotspot_merchant_ids"`
	EstOrders   int            `json:"est_orders"`
	EstEarnings map[string]any `json:"est_earnings"`
	Reasoning   string         `json:"reasoning"`
	Source      string         `json:"source"`
}

type waypoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// PlannerSystemV1 words the two loop options. It never sets prices or
// dispatch rules; numbers come from the server and are quoted back.
const plannerSystemV1 = `You word two workout-first running/cycling loop options for a Trackfud courier from the stats given.
Rules:
- Output only JSON matching the provided schema.
- "name" is the option's short headline, written in the courier's language (under 60 chars), e.g. "Easy 5K loop past 3 busy kitchens". Never output field names, keys or placeholders.
- "reasoning" is under 25 words, in the courier's language.
- Celebrate the workout first (distance, easy pace), then mention busy restaurants second.
- Never promise orders, earnings, or pace; earnings are estimates. Never give medical advice.`

func plannerSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"options": map[string]any{
				"type": "array", "minItems": 2, "maxItems": 2,
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"name":      map[string]any{"type": "string"},
						"reasoning": map[string]any{"type": "string"},
					},
					"required":             []string{"name", "reasoning"},
					"additionalProperties": false,
				},
			},
		},
		"required":             []string{"options"},
		"additionalProperties": false,
	}
}

type plannerWords struct {
	Name      string
	Reasoning string
}

func parsePlannerWords(raw string) ([2]plannerWords, error) {
	var loose struct {
		Options []plannerWords `json:"options"`
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	if err := dec.Decode(&loose); err != nil {
		return [2]plannerWords{}, fmt.Errorf("planner output is not valid JSON: %w", err)
	}
	if len(loose.Options) != 2 {
		return [2]plannerWords{}, fmt.Errorf("planner output must list 2 options")
	}
	out := [2]plannerWords{loose.Options[0], loose.Options[1]}
	for i, o := range out {
		if strings.TrimSpace(o.Name) == "" || strings.TrimSpace(o.Reasoning) == "" {
			return [2]plannerWords{}, fmt.Errorf("planner option %d needs name + reasoning", i)
		}
		if len(o.Name) > 80 || len(o.Reasoning) > 300 {
			return [2]plannerWords{}, fmt.Errorf("planner option %d too long", i)
		}
	}
	return out, nil
}

// placeholderName reports a model "name" that is a template token rather
// than a headline (e.g. "options_1_headline"): one word with underscores,
// braces, or a bare field name.
func placeholderName(name string) bool {
	n := strings.TrimSpace(name)
	if strings.ContainsAny(n, "{}<>") {
		return true
	}
	if !strings.Contains(n, " ") && strings.Contains(n, "_") {
		return true
	}
	switch strings.ToLower(n) {
	case "name", "headline", "title", "option", "string":
		return true
	}
	return false
}

// withSafeNames keeps the model's wording but swaps any placeholder name for
// the deterministic one of the same option, so a raw token never reaches the
// courier's screen.
func withSafeNames(words, fallback [2]plannerWords) [2]plannerWords {
	for i := range words {
		if placeholderName(words[i].Name) {
			words[i].Name = fallback[i].Name
		}
	}
	return words
}

func fallbackPlannerWords(mode string, goalM float64, window string, hotCount int) [2]plannerWords {
	unit := "run"
	if mode == "biker" {
		unit = "ride"
	}
	km := fmt.Sprintf("%.1fK", goalM/1000)
	return [2]plannerWords{
		{Name: fmt.Sprintf("Busy lunch %s · %s", unit, km), Reasoning: fmt.Sprintf("Easy %s loop near %d busy spot(s) at %s — workout first, offers second.", unit, hotCount, window)},
		{Name: fmt.Sprintf("Steady %s · %s", unit, km), Reasoning: fmt.Sprintf("Even-pace %s holding your goal, passing 1–2 busy kitchens.", unit)},
	}
}

// parsePlannerLatLng validates one coordinate pair.
func parsePlannerLatLng(lat, lng float64) (float64, float64, string) {
	if math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) {
		return 0, 0, "lat/lng must be numbers"
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return 0, 0, "lat must be -90..90 and lng -180..180"
	}
	return lat, lng, ""
}

// fetchHotspots ranks approved merchants near (lat,lng): 7-day order volume
// first (busy kitchens), distance second. Seeded/demo orders count the same
// as live ones — judges see lunch hotspots without waiting a week.
func (s *Server) fetchHotspots(ctx context.Context, lat, lng, radiusM float64, limit int) ([]hotspot, error) {
	rows, err := s.db.Query(ctx, `SELECT m.id, m.name, m.currency,
		ST_Y(m.location::geometry), ST_X(m.location::geometry),
		ST_Distance(m.location, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography)::int,
		COALESCE((SELECT count(*) FROM orders o WHERE o.merchant_id=m.id
			AND o.created_at > now() - interval '7 days'
			AND o.status NOT IN ('cancelled','rejected')),0)
		FROM merchants m
		WHERE m.status='approved' AND m.location IS NOT NULL
		AND ST_DWithin(m.location, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, $3)
		ORDER BY 7 DESC, 6 ASC LIMIT $4`, lat, lng, radiusM, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []hotspot{}
	for rows.Next() {
		var h hotspot
		var dist int
		var orders int
		if err := rows.Scan(&h.MerchantID, &h.Name, &h.Currency, &h.Lat, &h.Lng, &dist, &orders); err != nil {
			continue
		}
		h.DistanceM = float64(dist)
		h.Orders7d = orders
		out = append(out, h)
	}
	return out, rows.Err()
}

// listHotspots serves GET /v1/courier/run-plans/hotspots.
func (s *Server) listHotspots(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lat, err1 := strconv.ParseFloat(strings.TrimSpace(q.Get("lat")), 64)
	lng, err2 := strconv.ParseFloat(strings.TrimSpace(q.Get("lng")), 64)
	if err1 != nil || err2 != nil {
		problem(w, 400, "Validation failed", "lat and lng query params are required")
		return
	}
	if _, _, msg := parsePlannerLatLng(lat, lng); msg != "" {
		problem(w, 400, "Validation failed", msg)
		return
	}
	radius := 3000.0
	if raw := strings.TrimSpace(q.Get("radius_m")); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil {
			radius = v
		} else {
			problem(w, 400, "Validation failed", "radius_m must be a number")
			return
		}
	}
	if radius < 200 || radius > 10000 {
		problem(w, 400, "Validation failed", "radius_m must be 200..10000")
		return
	}
	limit := 8
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil {
			limit = v
		} else {
			problem(w, 400, "Validation failed", "limit must be an integer")
			return
		}
	}
	if limit < 1 || limit > 20 {
		problem(w, 400, "Validation failed", "limit must be 1..20")
		return
	}
	hot, err := s.fetchHotspots(r.Context(), lat, lng, radius, limit)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"hotspots": hot})
}

// circleLoop builds a closed loop: N points on a circle of the goal
// circumference, each pulled toward its nearest hotspot so the workout
// passes busy kitchens. Rotation + pull give the two distinct options.
func circleLoop(startLat, startLng, goalM float64, spots []hotspot, rotationDeg, pull float64, n int) [][2]float64 {
	if n < 3 {
		n = 6
	}
	if n > maxPlanWaypoints-1 {
		n = maxPlanWaypoints - 1
	}
	radiusM := goalM / (2 * math.Pi)
	if radiusM < 150 {
		radiusM = 150
	}
	// Meters per degree at this latitude (equirectangular, fine for ≤50 km).
	latRad := startLat * math.Pi / 180
	mPerDegLat := 111320.0
	mPerDegLng := 111320.0 * math.Cos(latRad)
	if mPerDegLng < 20000 {
		mPerDegLng = 20000
	}
	pts := make([][2]float64, 0, n+1)
	for i := 0; i < n; i++ {
		ang := (rotationDeg + float64(i)*360/float64(n)) * math.Pi / 180
		dx := radiusM * math.Cos(ang)
		dy := radiusM * math.Sin(ang)
		lat := startLat + dy/mPerDegLat
		lng := startLng + dx/mPerDegLng
		if len(spots) > 0 && pull > 0 {
			best := -1
			bestD := math.MaxFloat64
			for j, h := range spots {
				d := haversineM(lat, lng, h.Lat, h.Lng)
				if d < bestD {
					bestD, best = d, j
				}
			}
			// Only bend toward kitchens within 1.5× the loop radius: the
			// workout shape wins, hotspots nudge it.
			if best >= 0 && bestD <= radiusM*1.5 {
				lat += (spots[best].Lat - lat) * pull
				lng += (spots[best].Lng - lng) * pull
			}
		}
		pts = append(pts, [2]float64{lat, lng})
	}
	pts = append(pts, pts[0])
	return pts
}

func loopDistanceM(pts [][2]float64) float64 {
	dist := 0.0
	for i := 1; i < len(pts); i++ {
		dist += haversineM(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1])
	}
	return dist
}

// estimatePlanEarnings prices the plan honestly: N likely orders (from
// hotspot lunch volume) × one average courier payout (2 km trip, 5% platform
// fee, no tip — tips stay 100% extra on top).
func estimatePlanEarnings(hot []hotspot, window, currency string) (orders int, payoutMinor int64) {
	avg7d := 0.0
	for _, h := range hot {
		avg7d += float64(h.Orders7d)
	}
	if len(hot) > 0 {
		avg7d /= float64(len(hot))
	}
	share := 0.15
	switch window {
	case "lunch":
		share = 0.25
	case "dinner":
		share = 0.30
	}
	likely := avg7d * share
	// Demo/seeded rooms have thin history: always show 1–3 likely orders so
	// the estimate reads as a plan, never a promise.
	orders = int(math.Round(likely)) + 1
	if orders < 1 {
		orders = 1
	}
	if orders > 3 {
		orders = 3
	}
	sched := order.ScheduleFor(currency)
	fee := order.DeliveryFee(2.0, sched)
	payout := fee - order.CourierFee(fee)
	return orders, payout
}

func planID(seed string) string {
	sum := sha256.Sum256([]byte(seed))
	return hex.EncodeToString(sum[:16])
}

// createRunPlans serves POST /v1/courier/run-plans.
func (s *Server) createRunPlans(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Start struct {
			Lat float64 `json:"lat"`
			Lng float64 `json:"lng"`
		} `json:"start"`
		Mode          string   `json:"mode"`
		GoalDistanceM *float64 `json:"goal_distance_m"`
		GoalDurationS *int     `json:"goal_duration_s"`
		Window        string   `json:"window"`
		Lang          string   `json:"lang"`
	}
	if !decode(w, r, &b) {
		return
	}
	lat, lng, msg := parsePlannerLatLng(b.Start.Lat, b.Start.Lng)
	if msg != "" {
		problem(w, 400, "Validation failed", "start."+msg)
		return
	}
	mode := strings.TrimSpace(b.Mode)
	if mode == "" {
		mode = "runner"
	}
	if mode != "runner" && mode != "biker" {
		problem(w, 400, "Validation failed", "mode must be runner or biker")
		return
	}
	window := strings.TrimSpace(b.Window)
	if window == "" {
		window = "now"
	}
	if window != "now" && window != "lunch" && window != "dinner" {
		problem(w, 400, "Validation failed", "window must be now, lunch or dinner")
		return
	}
	lang := strings.ToLower(strings.TrimSpace(b.Lang))
	if lang != "id" && lang != "ms" {
		lang = "en"
	}
	ed := s.effectiveDispatch(r.Context(), "")
	planKmh := ed.RunnerPlanKmh
	corridor := ed.RunnerCorridorM
	minGoal, maxGoal := 500.0, 42195.0
	if mode == "biker" {
		planKmh, corridor = ed.BikerPlanKmh, ed.BikerCorridorM
		minGoal, maxGoal = 1000.0, 100000.0
	}
	var goalM float64
	switch {
	case b.GoalDistanceM != nil:
		goalM = *b.GoalDistanceM
	case b.GoalDurationS != nil:
		if *b.GoalDurationS < 300 || *b.GoalDurationS > 14400 {
			problem(w, 400, "Validation failed", "goal_duration_s must be 300..14400")
			return
		}
		goalM = float64(*b.GoalDurationS) * planKmh / 3.6
	default:
		problem(w, 400, "Validation failed", "goal_distance_m or goal_duration_s is required")
		return
	}
	if math.IsNaN(goalM) || math.IsInf(goalM, 0) || goalM < minGoal || goalM > maxGoal {
		problem(w, 400, "Validation failed", fmt.Sprintf("goal_distance_m must be %.0f..%.0f", minGoal, maxGoal))
		return
	}
	radius := goalM * 0.75
	if radius < 1500 {
		radius = 1500
	}
	if radius > 8000 {
		radius = 8000
	}
	hot, err := s.fetchHotspots(r.Context(), lat, lng, radius, 10)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	currency := "IDR"
	if len(hot) > 0 {
		counts := map[string]int{}
		for _, h := range hot {
			counts[h.Currency]++
		}
		best, bestN := currency, -1
		for c, n := range counts {
			if n > bestN {
				best, bestN = c, n
			}
		}
		currency = best
	}
	// Two loops: A leans into hotspots (pull 0.35), B holds the steady line
	// (pull 0.15, rotated). Both stay ≤10 waypoints.
	loops := [][][2]float64{
		circleLoop(lat, lng, goalM, hot, 0, 0.35, 6),
		circleLoop(lat, lng, goalM, hot, 30, 0.15, 6),
	}
	words := fallbackPlannerWords(mode, goalM, window, len(hot))
	live := false
	if s.ai.cli.HasKey() {
		// Stay inside the planner's 35 s client timeout, so a slow or cold
		// model degrades to the heuristic wording instead of a client error.
		// A request parked on a cold container hangs; one hedged duplicate
		// after plannerHedgeAfter usually answers in seconds.
		ctx, cancel := context.WithTimeout(r.Context(), plannerAIBudget)
		user := fmt.Sprintf("mode: %s; goal_m: %.0f; window: %s; lang: %s; hotspots: %d; avg_orders_7d: %.1f",
			mode, goalM, window, lang, len(hot), avgOrders(hot))
		if raw, err := ai.Hedge(ctx, plannerHedgeAfter, func(ctx context.Context) (string, error) {
			return s.ai.cli.ChatJSON(ctx, plannerFeature, plannerPromptVer, s.ai.cli.SparkModel(),
				plannerSystemV1, user, "planner", plannerSchema(), s.aiLog)
		}); err == nil {
			if parsed, verr := parsePlannerWords(raw); verr == nil {
				words, live = withSafeNames(parsed, words), true
			}
		} else if _, ok := err.(*ai.UpstreamError); ok {
			// Keep the heuristic wording; the failed call is already logged
			// with its error text by ChatJSON.
			_ = ok
		}
		cancel()
	} else {
		s.logAICall(r.Context(), ai.CallRecord{Feature: plannerFeature, Model: s.ai.cli.SparkModel(), PromptVersion: plannerPromptVer, Fallback: true})
	}
	estOrders, estPayout := estimatePlanEarnings(hot, window, currency)
	hotIDs := []string{}
	for _, h := range hot {
		if len(hotIDs) >= 5 {
			break
		}
		hotIDs = append(hotIDs, h.MerchantID)
	}
	plans := []runPlan{}
	for i, loop := range loops {
		dist := loopDistanceM(loop)
		res := maps.Estimate(dist, planKmh, ed.Circuity)
		wp := make([]waypoint, 0, len(loop))
		coords := make([][]float64, 0, len(loop))
		for _, p := range loop {
			wp = append(wp, waypoint{Lat: p[0], Lng: p[1]})
			coords = append(coords, []float64{p[1], p[0]})
		}
		plans = append(plans, runPlan{
			ID:         planID(fmt.Sprintf("%s|%s|%.0f|%d|%f|%f", mode, window, goalM, i, lat, lng)),
			Name:       words[i].Name,
			Mode:       mode,
			DistanceM:  math.Round(dist),
			DurationS:  res.DurationS,
			CorridorM:  corridor,
			Waypoints:  wp,
			GeoJSON:    map[string]any{"type": "LineString", "coordinates": coords},
			HotspotIDs: hotIDs,
			EstOrders:  estOrders,
			EstEarnings: map[string]any{"amount_minor": estPayout * int64(estOrders), "currency": currency,
				"per_order_minor": estPayout, "label": "estimate"},
			Reasoning: words[i].Reasoning,
			Source:    map[bool]string{true: "ai", false: "heuristic"}[live],
		})
	}
	writeJSON(w, 200, map[string]any{
		"plans": plans, "hotspots": hot, "live": live,
		"goal_distance_m": math.Round(goalM), "mode": mode, "window": window,
		"corridor_m": corridor, "currency": currency,
		"note": "estimate: passing busy kitchens raises the chance of an offer, never a promise",
	})
}

func avgOrders(hot []hotspot) float64 {
	if len(hot) == 0 {
		return 0
	}
	sum := 0
	for _, h := range hot {
		sum += h.Orders7d
	}
	return float64(sum) / float64(len(hot))
}
