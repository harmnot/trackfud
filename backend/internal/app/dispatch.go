package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"Trackfud/internal/ledger"
	"Trackfud/internal/maps"
	"Trackfud/internal/order"

	"github.com/jackc/pgx/v5"
)

// ---------- Dispatch B4: track-corridor matching + cascade + handover ----------
//
// The workout comes first: dispatch offers orders that fit the distance the
// courier still wants to do (plan §6.2). Speed is never scored; the hard
// rules only protect food quality and the 30–60 min promise. Declining an
// offer has no penalty — decline touches only the offer row.

// Delivery statuses (delivery machine, docs/app-context.md §4).
const (
	DeliverySearching    = "searching"
	DeliveryOffered      = "offered"
	DeliveryAssigned     = "assigned"
	DeliveryAtPickup     = "at_pickup"
	DeliveryPickedUp     = "picked_up"
	DeliveryAtDropoff    = "at_dropoff"
	DeliveryDelivered    = "delivered"
	DeliveryStaffSearch  = "staff_searching"
	DeliveryNoCourier    = "no_courier"
	DeliveryCancelled    = "cancelled"
	DeliveryCustomerPick = "customer_pickup"
)

// ErrDeliveryTaken is returned when the atomic claim finds no row: the
// delivery was already taken, cancelled, or moved on.
var ErrDeliveryTaken = errors.New("dispatch: delivery already taken")

// dispatchCandidatesSQL finds couriers whose live session can take the
// order: near the restaurant (or its planned track), trip in range,
// size/spill allowed, no active delivery, never offered for this delivery.
const dispatchCandidatesSQL = `
WITH o AS (
  SELECT o.id, o.dropoff, o.size_class, o.spill_risk, m.location AS pickup
  FROM orders o JOIN merchants m ON m.id = o.merchant_id
  WHERE o.id = $1
)
SELECT s.courier_id, c.mode,
       ST_Distance(s.last_pos, o.pickup)::int AS to_pickup_m,
       ST_Distance(o.pickup, o.dropoff)::int AS trip_m,
       ST_Y(s.last_pos::geometry), ST_X(s.last_pos::geometry),
       s.last_heading, c.rating_bayes,
       GREATEST(COALESCE(s.goal_distance_m, 0) - s.distance_m, 0) AS goal_left_m,
       EXTRACT(EPOCH FROM now() - COALESCE(c.last_delivery_at, s.started_at))::int AS idle_s,
       CASE WHEN s.planned_track IS NULL THEN 0 ELSE 1 END AS has_track
FROM activity_sessions s
JOIN couriers c ON c.user_id = s.courier_id
CROSS JOIN o
WHERE s.kind = 'work' AND s.status = 'active'
  AND s.last_seen_at > now() - interval '60 seconds'
  AND c.status = 'approved'
  AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.courier_id = s.courier_id
                  AND d.status IN ('assigned','at_pickup','picked_up','at_dropoff'))
  AND NOT EXISTS (SELECT 1 FROM dispatch_offers x
                  WHERE x.courier_id = s.courier_id AND x.delivery_id = $2)
  AND (
    (c.mode = 'runner'
      AND ST_DWithin(s.last_pos, o.pickup, $3)
      AND ST_DWithin(o.pickup, o.dropoff, $4)
      AND o.size_class = ANY(string_to_array($5, ','))
      AND o.spill_risk = ANY(string_to_array($6, ','))
      AND (s.planned_track IS NULL OR ST_DWithin(s.planned_track, o.pickup, $7)))
    OR
    (c.mode = 'biker'
      AND ST_DWithin(s.last_pos, o.pickup, $8)
      AND ST_DWithin(o.pickup, o.dropoff, $9)
      AND o.size_class = ANY(string_to_array($10, ','))
      AND o.spill_risk = ANY(string_to_array($11, ','))
      AND (s.planned_track IS NULL OR ST_DWithin(s.planned_track, o.pickup, $12)))
  )
ORDER BY to_pickup_m
LIMIT 20`

// claimDeliverySQL is the atomic accept: exactly one courier can win it.
// 0 rows means "sorry, someone else took it" (or the search moved on).
const claimDeliverySQL = `
UPDATE deliveries SET courier_id = $2, status = 'assigned', type = $5,
  assigned_at = now(), to_pickup_m = $3, trip_m = $4
WHERE id = $1 AND status = ANY($6) AND courier_id IS NULL
RETURNING order_id`

// Candidate is one dispatchable courier from PostGIS (all meters/seconds).
type Candidate struct {
	CourierID       string
	Mode            string
	ToPickupM       float64
	TripM           float64
	LastLat         float64
	LastLng         float64
	Heading         *float64
	RatingBayes     float64
	GoalLeftM       float64
	IdleS           int64
	HasPlannedTrack bool
}

// ScoreWeights carries the §6.2 weights (lower score wins; speed is absent
// on purpose — this is a health-first match, not a race).
type ScoreWeights struct {
	Fit        float64
	FoodWait   float64
	Rating     float64
	Idle       float64
	HeadingPen float64
	Circuity   float64
}

// ScoreCtx is the order side of one scoring decision.
type ScoreCtx struct {
	Now        time.Time
	ReadyAtEst time.Time
	HasReady   bool
	WindowEnd  time.Time
	HasWindow  bool
	PickupLat  float64
	PickupLng  float64
	PlanKmh    float64
	MaxCarryS  int
	W          ScoreWeights
}

// ScoreCandidate ranks one courier for one order (plan §6.2). ok=false is a
// hard reject: the food would not survive the carry, or the 30–60 min
// promise would break. Declining history is deliberately not an input:
// declining an offer never lowers a future score.
func ScoreCandidate(c Candidate, ctx ScoreCtx) (score, etaPickupS, carryS float64, ok bool) {
	speed := ctx.PlanKmh / 3.6
	if speed <= 0 {
		speed = 2.5
	}
	etaPickupS = c.ToPickupM * ctx.W.Circuity / speed
	carryS = c.TripM * ctx.W.Circuity / speed
	if carryS > float64(ctx.MaxCarryS) {
		return 0, 0, 0, false
	}
	untilReadyS := 0.0
	if ctx.HasReady {
		untilReadyS = ctx.ReadyAtEst.Sub(ctx.Now).Seconds()
		if untilReadyS < 0 {
			untilReadyS = 0
		}
	}
	if ctx.HasWindow {
		if ctx.Now.Add(time.Duration(max(etaPickupS, untilReadyS)+carryS) * time.Second).After(ctx.WindowEnd) {
			return 0, 0, 0, false
		}
	}
	jobKm := (c.ToPickupM + c.TripM) * ctx.W.Circuity / 1000
	fitKm := jobKm * 0.3
	if c.GoalLeftM > 0 {
		fitKm = math.Abs(c.GoalLeftM/1000 - jobKm)
	}
	foodWaitMin := math.Max(0, etaPickupS-untilReadyS) / 60
	headingPen := 0.0
	if !c.HasPlannedTrack && c.Heading != nil && c.ToPickupM > 300 {
		want := BearingDeg(c.LastLat, c.LastLng, ctx.PickupLat, ctx.PickupLng)
		if angleDiff(*c.Heading, want) > 90 {
			headingPen = ctx.W.HeadingPen
		}
	}
	idleCapped := math.Min(float64(c.IdleS)/60, 30)
	score = ctx.W.Fit*fitKm + ctx.W.FoodWait*foodWaitMin +
		ctx.W.Rating*(5-c.RatingBayes) + headingPen - ctx.W.Idle*idleCapped/10
	return score, etaPickupS, carryS, true
}

// angleDiff returns the absolute bearing difference in degrees (0–180).
func angleDiff(a, b float64) float64 {
	d := math.Mod(math.Abs(a-b), 360)
	if d > 180 {
		d = 360 - d
	}
	return d
}

// ScoredCandidate pairs a candidate with its winning (lowest) score.
type ScoredCandidate struct {
	Candidate
	Score      float64
	EtaPickupS float64
	CarryS     float64
}

// RankCandidates scores, hard-filters, and sorts (best first).
func RankCandidates(cands []Candidate, ctx ScoreCtx) []ScoredCandidate {
	out := []ScoredCandidate{}
	for _, c := range cands {
		s, eta, carry, ok := ScoreCandidate(c, ctx)
		if !ok {
			continue
		}
		out = append(out, ScoredCandidate{Candidate: c, Score: s, EtaPickupS: eta, CarryS: carry})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Score < out[j].Score })
	return out
}

// SettleQuoteFor adjusts the stored quote for staff delivery (5% restaurant
// commission instead of 10%; the courier still keeps 95% of the delivery
// fee plus the full tip). Workout deliveries settle exactly as quoted.
func SettleQuoteFor(q order.Quote, staffDelivery bool) order.Quote {
	if !staffDelivery {
		return q
	}
	commission := order.Commission(q.SubtotalMinor, true)
	out := q
	out.CommissionMinor = commission
	out.MerchantPayout = q.SubtotalMinor - commission
	out.PlatformTake = q.PlatformTake - (q.CommissionMinor - commission)
	return out
}

// carriedPoint is one stored fix used for the delivered impact math.
type carriedPoint struct {
	Ts       time.Time
	Lat, Lng float64
}

// ComputeCarried measures the workout the customer powered: geodesic
// distance plus active seconds between pickup and handover. It reuses the
// ingest segment rules (teleport/speed-cap segments excluded, gaps over
// segMaxGapS excluded) so the impact card matches session stats.
func ComputeCarried(pts []carriedPoint, maxSpeedMps, activeMinMps float64, segMaxGapS int) (distM float64, activeS int64) {
	var active float64
	for i := 1; i < len(pts); i++ {
		dt := pts[i].Ts.Sub(pts[i-1].Ts).Seconds()
		if dt <= 0 {
			continue
		}
		dist := haversineM(pts[i-1].Lat, pts[i-1].Lng, pts[i].Lat, pts[i].Lng)
		speed := dist / dt
		if dist > teleportDistM && dt < teleportDtS {
			continue
		}
		if speed > maxSpeedMps {
			continue
		}
		distM += dist
		if speed >= activeMinMps && dt <= float64(segMaxGapS) {
			active += dt
		}
	}
	return distM, int64(math.Round(active))
}

// claimer is the narrow DB surface the atomic claim needs; pgx.Tx and the
// pool both satisfy it, and tests use a fake.
type claimer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// claimDeliveryTx runs the guarded claim and maps 0 rows to ErrDeliveryTaken.
func claimDeliveryTx(ctx context.Context, q claimer, deliveryID, courierID, deliveryType string, toPickupM, tripM float64, statuses []string) (string, error) {
	var orderID string
	err := q.QueryRow(ctx, claimDeliverySQL, deliveryID, courierID, toPickupM, tripM, deliveryType, statuses).Scan(&orderID)
	if err == pgx.ErrNoRows {
		return "", ErrDeliveryTaken
	}
	return orderID, err
}

// ---------- delivery + offer rows ----------

type deliveryRow struct {
	ID, OrderID, Type, Status  string
	CourierID                  *string
	PickupCode, DropoffPin     string
	AssignedAt                 *time.Time
	PickedUpAt                 *time.Time
	DeliveredAt                *time.Time
	SearchStartedAt            *time.Time
	TripM, ToPickupM           float64
	CarriedDistM               float64
	CarriedActiveS             int64
	EtaS                       int
	Polyline                   string
	LastRouteLat, LastRouteLng *float64
	LastRouteAt                *time.Time
	NudgedAt                   *time.Time
	ArrivedPickupAt            *time.Time
	ArrivedDropoffAt           *time.Time
	ProofFileID                *string
	CancelNote                 string
	CreatedAt                  time.Time
}

const deliveryCols = `id, order_id, type, status, courier_id, pickup_code, dropoff_pin,
	assigned_at, picked_up_at, delivered_at, search_started_at, trip_m, to_pickup_m,
	carried_distance_m, carried_active_s, eta_s, route_polyline,
	last_route_lat, last_route_lng, last_route_at, nudged_at,
	arrived_pickup_at, arrived_dropoff_at, proof_file_id, cancel_note, created_at`

func scanDelivery(r pgx.Row) (deliveryRow, error) {
	var d deliveryRow
	err := r.Scan(&d.ID, &d.OrderID, &d.Type, &d.Status, &d.CourierID, &d.PickupCode, &d.DropoffPin,
		&d.AssignedAt, &d.PickedUpAt, &d.DeliveredAt, &d.SearchStartedAt, &d.TripM, &d.ToPickupM,
		&d.CarriedDistM, &d.CarriedActiveS, &d.EtaS, &d.Polyline,
		&d.LastRouteLat, &d.LastRouteLng, &d.LastRouteAt, &d.NudgedAt,
		&d.ArrivedPickupAt, &d.ArrivedDropoffAt, &d.ProofFileID, &d.CancelNote, &d.CreatedAt)
	return d, err
}

func (s *Server) loadDelivery(ctx context.Context, deliveryID string) (deliveryRow, error) {
	return scanDelivery(s.db.QueryRow(ctx, `SELECT `+deliveryCols+` FROM deliveries WHERE id=$1`, deliveryID))
}

func (s *Server) loadDeliveryByOrder(ctx context.Context, orderID string) (deliveryRow, error) {
	return scanDelivery(s.db.QueryRow(ctx, `SELECT `+deliveryCols+` FROM deliveries WHERE order_id=$1`, orderID))
}

type offerRow struct {
	ID, DeliveryID, CourierID string
	Rank                      int
	Kind, Status              string
	Score                     float64
	Payload                   []byte
	ExpiresAt                 time.Time
	RespondedAt               *time.Time
	CreatedAt                 time.Time
}

const offerCols = `id, delivery_id, courier_id, rank, kind, status, score, payload, expires_at, responded_at, created_at`

func scanOffer(r pgx.Row) (offerRow, error) {
	var o offerRow
	err := r.Scan(&o.ID, &o.DeliveryID, &o.CourierID, &o.Rank, &o.Kind, &o.Status, &o.Score, &o.Payload, &o.ExpiresAt, &o.RespondedAt, &o.CreatedAt)
	return o, err
}

// ---------- job enqueue helpers (same-tx or post-commit) ----------

func enqueueTx(ctx context.Context, tx pgx.Tx, kind, payload string, runAt time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO jobs(kind,payload,run_at) VALUES($1,$2,$3)`, kind, payload, runAt)
	return err
}

func (s *Server) enqueueNow(kind, payload string, runAt time.Time) {
	_, _ = s.db.Exec(context.Background(), `INSERT INTO jobs(kind,payload,run_at) VALUES($1,$2,$3)`, kind, payload, runAt)
}

// enqueueUnlessPending inserts a retry-style job only when no pending one
// for the same delivery exists, so GPS-speed callers cannot spam the queue.
func (s *Server) enqueueUnlessPending(kind, deliveryID string, runAt time.Time) {
	var n int
	_ = s.db.QueryRow(context.Background(), `SELECT count(*) FROM jobs
		WHERE kind=$1 AND status='pending' AND payload->>'delivery_id'=$2`, kind, deliveryID).Scan(&n)
	if n == 0 {
		s.enqueueNow(kind, fmt.Sprintf(`{"delivery_id":%q}`, deliveryID), runAt)
	}
}

func pushPayload(userID, title, body string) string {
	return fmt.Sprintf(`{"user_id":%q,"title":%q,"body":%q}`, userID, title, body)
}

func (s *Server) queuePush(userID, title, body string) {
	s.enqueueNow("push_send", pushPayload(userID, title, body), time.Now())
}

// ---------- candidates + cascade ----------

// fetchCandidates runs the PostGIS corridor query with config limits.
func (s *Server) fetchCandidates(ctx context.Context, orderID, deliveryID string) ([]Candidate, error) {
	d := s.cfg.Dispatch
	rows, err := s.db.Query(ctx, dispatchCandidatesSQL, orderID, deliveryID,
		d.RunnerMaxToPickupM, d.RunnerMaxTripM,
		strings.Join(d.RunnerSizes, ","), strings.Join(d.RunnerSpill, ","), d.RunnerCorridorM,
		d.BikerMaxToPickupM, d.BikerMaxTripM,
		strings.Join(d.BikerSizes, ","), strings.Join(d.BikerSpill, ","), d.BikerCorridorM)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Candidate{}
	for rows.Next() {
		var c Candidate
		var toPick, trip int
		var hasTrack int
		if err := rows.Scan(&c.CourierID, &c.Mode, &toPick, &trip,
			&c.LastLat, &c.LastLng, &c.Heading, &c.RatingBayes,
			&c.GoalLeftM, &c.IdleS, &hasTrack); err != nil {
			continue
		}
		c.ToPickupM, c.TripM = float64(toPick), float64(trip)
		c.HasPlannedTrack = hasTrack == 1
		out = append(out, c)
	}
	return out, rows.Err()
}

// scoreCtxFor builds the scoring context for one order + courier mode.
func (s *Server) scoreCtxFor(o orderRow, mode string, pickupLat, pickupLng float64) ScoreCtx {
	d := s.cfg.Dispatch
	ctx := ScoreCtx{
		Now: time.Now(), PickupLat: pickupLat, PickupLng: pickupLng,
		W: ScoreWeights{Fit: d.WFit, FoodWait: d.WFoodWait, Rating: d.WRating, Idle: d.WIdle,
			HeadingPen: d.HeadingPenalty, Circuity: d.Circuity},
	}
	if mode == "biker" {
		ctx.PlanKmh, ctx.MaxCarryS = d.BikerPlanKmh, d.BikerMaxCarryS
	} else {
		ctx.PlanKmh, ctx.MaxCarryS = d.RunnerPlanKmh, d.RunnerMaxCarryS
	}
	if o.ReadyAtEst != nil {
		ctx.ReadyAtEst, ctx.HasReady = *o.ReadyAtEst, true
	}
	if o.WindowEnd != nil {
		ctx.WindowEnd, ctx.HasWindow = *o.WindowEnd, true
	}
	return ctx
}

// runCascade advances one delivery search: directed offers to rank 1..N at
// 30 s each, then a 60 s broadcast, then fresh-courier retries until the
// 4 min window ends and staff fallback begins. It is state-guarded, so any
// number of expiries, retries, and direct calls converge safely.
func (s *Server) runCascade(ctx context.Context, deliveryID string) {
	d, err := s.loadDelivery(ctx, deliveryID)
	if err != nil {
		return
	}
	if d.Status != DeliverySearching && d.Status != DeliveryOffered {
		return
	}
	// B6 demo switch: skip the courier cascade for staff-fallback rehearsal.
	if s.forceNoCourier(ctx) {
		s.moveToStaffSearch(ctx, deliveryID)
		return
	}
	now := time.Now()
	if d.SearchStartedAt != nil && now.After(d.SearchStartedAt.Add(time.Duration(s.cfg.Dispatch.SearchS)*time.Second)) {
		s.moveToStaffSearch(ctx, deliveryID)
		return
	}
	var pending int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM dispatch_offers
		WHERE delivery_id=$1 AND status='pending' AND expires_at>now()`, deliveryID).Scan(&pending)
	if pending > 0 {
		return
	}
	o, err := s.loadOrder(ctx, d.OrderID)
	if err != nil {
		return
	}
	var plat, plng float64
	_ = s.db.QueryRow(ctx, `SELECT ST_Y(location::geometry), ST_X(location::geometry)
		FROM merchants WHERE id=$1`, o.MerchantID).Scan(&plat, &plng)
	cands, err := s.fetchCandidates(ctx, o.ID, deliveryID)
	if err != nil {
		s.log.Warn("dispatch candidates failed", "delivery", deliveryID, "err", err)
		return
	}
	// Score per mode (planning speed + carry cap differ).
	ranked := []ScoredCandidate{}
	for _, c := range cands {
		ranked = append(ranked, RankCandidates([]Candidate{c}, s.scoreCtxFor(o, c.Mode, plat, plng))...)
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].Score < ranked[j].Score })
	if len(ranked) == 0 {
		s.enqueueUnlessPending("dispatch_retry", deliveryID, now.Add(30*time.Second))
		return
	}
	var directed int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM dispatch_offers
		WHERE delivery_id=$1 AND kind='directed'`, deliveryID).Scan(&directed)
	if directed < s.cfg.Dispatch.CascadeSize {
		s.offerDirected(ctx, d, o, ranked[0], directed+1)
		return
	}
	s.offerBroadcast(ctx, d, o, ranked)
}

// offerPayload is what the courier decides on: who, how far, how much.
func (s *Server) offerPayload(o orderRow, toPickupM, tripM float64) string {
	var name string
	_ = s.db.QueryRow(context.Background(), `SELECT name FROM merchants WHERE id=$1`, o.MerchantID).Scan(&name)
	q := o.quote()
	p, _ := json.Marshal(map[string]any{
		"merchant_name": name, "to_pickup_m": toPickupM, "trip_m": tripM,
		"payout_minor": q.CourierPayout, "currency": o.Currency,
		"size_class": o.Size, "spill_risk": o.Spill,
		"ready_at_est": iso(o.ReadyAtEst), "window_end": iso(o.WindowEnd),
	})
	return string(p)
}

func (s *Server) offerDirected(ctx context.Context, d deliveryRow, o orderRow, c ScoredCandidate, rank int) {
	exp := time.Now().Add(time.Duration(s.cfg.Dispatch.OfferWindowS) * time.Second)
	var offerID string
	err := s.db.QueryRow(ctx, `INSERT INTO dispatch_offers(delivery_id,courier_id,rank,kind,score,payload,expires_at)
		VALUES($1,$2,$3,'directed',$4,$5,$6) RETURNING id`,
		d.ID, c.CourierID, rank, c.Score, s.offerPayload(o, c.ToPickupM, c.TripM), exp).Scan(&offerID)
	if err != nil {
		return
	}
	_, _ = s.db.Exec(ctx, `UPDATE deliveries SET status='offered' WHERE id=$1 AND status='searching'`, d.ID)
	s.enqueueNow("offer_expire", fmt.Sprintf(`{"offer_id":%q}`, offerID), exp)
	s.queuePush(c.CourierID, "New delivery offer",
		fmt.Sprintf("%s · %.1f km to go · expires in %d s", merchantShort(o.MerchantID, s), (c.ToPickupM+c.TripM)/1000, s.cfg.Dispatch.OfferWindowS))
	s.hub.Broadcast(c.CourierID, fmt.Sprintf(`{"type":"offer.created","offer_id":%q,"delivery_id":%q,"expires_at":%q}`,
		offerID, d.ID, exp.UTC().Format(time.RFC3339)))
}

func merchantShort(merchantID string, s *Server) string {
	var name string
	_ = s.db.QueryRow(context.Background(), `SELECT name FROM merchants WHERE id=$1`, merchantID).Scan(&name)
	if name == "" {
		name = "Restaurant"
	}
	return name
}

func (s *Server) offerBroadcast(ctx context.Context, d deliveryRow, o orderRow, ranked []ScoredCandidate) {
	exp := time.Now().Add(time.Duration(s.cfg.Dispatch.BroadcastWindowS) * time.Second)
	for _, c := range ranked {
		var offerID string
		err := s.db.QueryRow(ctx, `INSERT INTO dispatch_offers(delivery_id,courier_id,rank,kind,score,payload,expires_at)
			VALUES($1,$2,0,'broadcast',$3,$4,$5) ON CONFLICT (delivery_id,courier_id) DO NOTHING RETURNING id`,
			d.ID, c.CourierID, c.Score, s.offerPayload(o, c.ToPickupM, c.TripM), exp).Scan(&offerID)
		if err != nil || offerID == "" {
			continue
		}
		s.enqueueNow("offer_expire", fmt.Sprintf(`{"offer_id":%q}`, offerID), exp)
		s.queuePush(c.CourierID, "Delivery available nearby",
			fmt.Sprintf("%s · %.1f km · first to accept wins", merchantShort(o.MerchantID, s), (c.ToPickupM+c.TripM)/1000))
		s.hub.Broadcast(c.CourierID, fmt.Sprintf(`{"type":"offer.created","offer_id":%q,"delivery_id":%q,"expires_at":%q}`,
			offerID, d.ID, exp.UTC().Format(time.RFC3339)))
	}
	_, _ = s.db.Exec(ctx, `UPDATE deliveries SET status='offered' WHERE id=$1 AND status='searching'`, d.ID)
}

// moveToStaffSearch enters staff fallback: on-shift staff who can deliver
// are offered at once (first accept wins) inside the 3 min staff window.
// With no staff signed up the customer gets their choices immediately.
func (s *Server) moveToStaffSearch(ctx context.Context, deliveryID string) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	var orderID, merchantID, status string
	err = tx.QueryRow(ctx, `UPDATE deliveries SET status='staff_searching' WHERE id=$1
		AND status IN ('searching','offered') RETURNING order_id, status`, deliveryID).Scan(&orderID, &status)
	if err != nil {
		return
	}
	_ = tx.QueryRow(ctx, `SELECT merchant_id FROM orders WHERE id=$1`, orderID).Scan(&merchantID)
	_, _ = tx.Exec(ctx, `UPDATE dispatch_offers SET status='expired' WHERE delivery_id=$1 AND status='pending'`, deliveryID)
	rows, err := tx.Query(ctx, `SELECT u.id FROM merchant_staff ms JOIN users u ON lower(u.email)=lower(ms.email)
		WHERE ms.merchant_id=$1 AND ms.can_deliver AND ms.on_shift`, merchantID)
	if err != nil {
		return
	}
	staff := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			staff = append(staff, id)
		}
	}
	rows.Close()
	if len(staff) == 0 {
		_, _ = tx.Exec(ctx, `UPDATE deliveries SET status='no_courier' WHERE id=$1`, deliveryID)
		if err := tx.Commit(ctx); err != nil {
			return
		}
		s.notifyNoCourier(ctx, deliveryID, orderID)
		return
	}
	o, err := s.loadOrder(ctx, orderID)
	if err != nil {
		return
	}
	exp := time.Now().Add(time.Duration(s.cfg.Dispatch.StaffS) * time.Second)
	var tripM float64
	_ = tx.QueryRow(ctx, `SELECT ST_Distance(m.location, o.dropoff) FROM orders o
		JOIN merchants m ON m.id=o.merchant_id WHERE o.id=$1`, orderID).Scan(&tripM)
	for _, uid := range staff {
		_, _ = tx.Exec(ctx, `INSERT INTO dispatch_offers(delivery_id,courier_id,kind,payload,expires_at)
			VALUES($1,$2,'staff',$3,$4) ON CONFLICT (delivery_id,courier_id) DO NOTHING`,
			deliveryID, uid, s.offerPayload(o, 0, tripM), exp)
	}
	_ = enqueueTx(ctx, tx, "staff_timeout", fmt.Sprintf(`{"delivery_id":%q}`, deliveryID), exp)
	if err := tx.Commit(ctx); err != nil {
		return
	}
	for _, uid := range staff {
		s.queuePush(uid, "Staff delivery needed", "No runner is nearby — your restaurant needs this order delivered.")
		s.hub.Broadcast(uid, fmt.Sprintf(`{"type":"offer.created","delivery_id":%q,"kind":"staff","expires_at":%q}`,
			deliveryID, exp.UTC().Format(time.RFC3339)))
	}
	s.broadcastOrder(ctx, o.CustomerID, o.MerchantID, orderID, o.Status)
}

// notifyNoCourier tells the customer the search failed and lists choices.
func (s *Server) notifyNoCourier(ctx context.Context, deliveryID, orderID string) {
	o, err := s.loadOrder(ctx, orderID)
	if err != nil {
		return
	}
	s.queuePush(o.CustomerID, "No courier found",
		"No runner, biker, or staff is available. Choose: wait 5 more minutes, switch to pickup, or cancel with a full refund.")
	s.broadcastOrder(ctx, o.CustomerID, o.MerchantID, orderID, o.Status)
}

// ---------- courier: offers ----------

func (s *Server) offerView(o offerRow, now time.Time) map[string]any {
	var p map[string]any
	_ = json.Unmarshal(o.Payload, &p)
	left := int(o.ExpiresAt.Sub(now).Seconds())
	if left < 0 {
		left = 0
	}
	return map[string]any{"id": o.ID, "delivery_id": o.DeliveryID, "kind": o.Kind,
		"status": o.Status, "expires_at": o.ExpiresAt.UTC().Format(time.RFC3339),
		"seconds_left": left, "order": p}
}

func (s *Server) listOffers(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	rows, err := s.db.Query(r.Context(), `SELECT `+offerCols+` FROM dispatch_offers
		WHERE courier_id=$1 AND status='pending' AND expires_at>now() AND kind IN ('directed','broadcast')
		ORDER BY expires_at`, c.Sub)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	now := time.Now()
	out := []map[string]any{}
	for rows.Next() {
		o, err := scanOffer(rows)
		if err != nil {
			continue
		}
		out = append(out, s.offerView(o, now))
	}
	writeJSON(w, 200, map[string]any{"offers": out})
}

// acceptOffer claims the delivery atomically: the guarded UPDATE is the
// single decider, so two couriers can never win the same order.
func (s *Server) acceptOffer(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	offer, err := scanOffer(s.db.QueryRow(r.Context(), `SELECT `+offerCols+` FROM dispatch_offers WHERE id=$1`, r.PathValue("id")))
	if err != nil {
		problem(w, 404, "Not found", "offer not found")
		return
	}
	if offer.CourierID != c.Sub || (offer.Kind != "directed" && offer.Kind != "broadcast") {
		problem(w, 403, "Forbidden", "not your offer")
		return
	}
	if offer.Status != "pending" || time.Now().After(offer.ExpiresAt) {
		problem(w, 410, "Gone", "this offer already expired; keep running, the next one is coming")
		return
	}
	var courierStatus string
	if err := s.db.QueryRow(r.Context(), `SELECT status FROM couriers WHERE user_id=$1`, c.Sub).Scan(&courierStatus); err != nil || courierStatus != "approved" {
		problem(w, 403, "Forbidden", "only approved couriers can accept workout deliveries")
		return
	}
	d, code, msg := s.acceptCore(r.Context(), offer, c.Sub, "workout",
		[]string{DeliverySearching, DeliveryOffered})
	if code != 200 {
		problem(w, code, "Accept failed", msg)
		return
	}
	writeJSON(w, 200, map[string]any{"delivery": s.deliveryViewForCourier(r.Context(), d)})
}

// acceptCore is the shared atomic accept for workout and staff offers.
func (s *Server) acceptCore(ctx context.Context, offer offerRow, courierID, deliveryType string, statuses []string) (deliveryRow, int, string) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return deliveryRow{}, 500, err.Error()
	}
	defer tx.Rollback(ctx)
	var active int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM deliveries WHERE courier_id=$1
		AND status IN ('assigned','at_pickup','picked_up','at_dropoff')`, courierID).Scan(&active)
	if active > 0 {
		return deliveryRow{}, 409, "finish your active delivery first (1 order at a time)"
	}
	var toPickup, trip float64
	var payload struct {
		ToPickupM float64 `json:"to_pickup_m"`
		TripM     float64 `json:"trip_m"`
	}
	_ = json.Unmarshal(offer.Payload, &payload)
	toPickup, trip = payload.ToPickupM, payload.TripM
	orderID, err := claimDeliveryTx(ctx, tx, offer.DeliveryID, courierID, deliveryType, toPickup, trip, statuses)
	if err == ErrDeliveryTaken {
		return deliveryRow{}, 409, "sorry, someone else took it just now"
	}
	if err != nil {
		return deliveryRow{}, 500, err.Error()
	}
	if _, err := tx.Exec(ctx, `UPDATE dispatch_offers SET status='accepted', responded_at=now()
		WHERE id=$1 AND status='pending'`, offer.ID); err != nil {
		return deliveryRow{}, 500, err.Error()
	}
	_, _ = tx.Exec(ctx, `UPDATE dispatch_offers SET status='expired' WHERE delivery_id=$1 AND status='pending' AND id<>$2`,
		offer.DeliveryID, offer.ID)
	o, err := s.loadOrder(ctx, orderID)
	if err != nil {
		return deliveryRow{}, 500, err.Error()
	}
	// Leave-now nudge: ready_at_est − eta_pickup − 60 s (plan §6.4).
	runAt := time.Now().Add(5 * time.Second)
	if o.ReadyAtEst != nil {
		speed := s.cfg.Dispatch.RunnerPlanKmh / 3.6
		if deliveryType == "workout" {
			var mode string
			_ = tx.QueryRow(ctx, `SELECT mode FROM couriers WHERE user_id=$1`, courierID).Scan(&mode)
			if mode == "biker" {
				speed = s.cfg.Dispatch.BikerPlanKmh / 3.6
			}
		}
		eta := toPickup * s.cfg.Dispatch.Circuity / speed
		if t := o.ReadyAtEst.Add(-time.Duration(eta+60) * time.Second); t.After(runAt) {
			runAt = t
		}
	}
	_ = enqueueTx(ctx, tx, "leave_now_nudge", fmt.Sprintf(`{"delivery_id":%q}`, offer.DeliveryID), runAt)
	_ = enqueueTx(ctx, tx, "route_refresh", fmt.Sprintf(`{"delivery_id":%q}`, offer.DeliveryID), time.Now())
	if err := tx.Commit(ctx); err != nil {
		return deliveryRow{}, 500, err.Error()
	}
	d, _ := s.loadDelivery(ctx, offer.DeliveryID)
	s.queuePush(o.CustomerID, "Runner assigned", "Your order has a courier — follow them live on the map.")
	s.broadcastOrder(ctx, o.CustomerID, o.MerchantID, orderID, o.Status)
	return d, 200, ""
}

// declineOffer records the decline and immediately offers the next courier.
// Nothing else is written: declining never penalizes the courier.
func (s *Server) declineOffer(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	offer, err := scanOffer(s.db.QueryRow(r.Context(), `SELECT `+offerCols+` FROM dispatch_offers WHERE id=$1`, r.PathValue("id")))
	if err != nil {
		problem(w, 404, "Not found", "offer not found")
		return
	}
	if offer.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your offer")
		return
	}
	if offer.Status != "pending" {
		writeJSON(w, 200, map[string]any{"declined": true, "already": offer.Status})
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE dispatch_offers SET status='declined', responded_at=now()
		WHERE id=$1 AND status='pending'`, offer.ID)
	s.runCascade(r.Context(), offer.DeliveryID)
	writeJSON(w, 200, map[string]any{"declined": true})
}

// ---------- courier: delivery views + handover ----------

// deliveryViewForCourier shapes the assignment. The pickup code stays
// hidden: the courier reads it off the merchant's screen at the counter.
func (s *Server) deliveryViewForCourier(ctx context.Context, d deliveryRow) map[string]any {
	o, _ := s.loadOrder(ctx, d.OrderID)
	var mName, mNote, mAddr string
	var mlat, mlng float64
	_ = s.db.QueryRow(ctx, `SELECT name, pickup_note, address, ST_Y(location::geometry), ST_X(location::geometry)
		FROM merchants WHERE id=$1`, o.MerchantID).Scan(&mName, &mNote, &mAddr, &mlat, &mlng)
	v := map[string]any{
		"id": d.ID, "order_id": d.OrderID, "type": d.Type, "status": d.Status,
		"order_status": o.Status, "currency": o.Currency,
		"pickup": map[string]any{"merchant_name": mName, "lat": mlat, "lng": mlng, "note": mNote, "address": mAddr},
		"eta_s":  d.EtaS, "route_polyline": d.Polyline, "route_warning": maps.BetaWarning,
		"size_class": o.Size, "spill_risk": o.Spill,
		"ready_at_est": iso(o.ReadyAtEst), "window_end": iso(o.WindowEnd),
		"nudged": d.NudgedAt != nil,
	}
	if o.HasDropoff {
		v["dropoff"] = map[string]any{"lat": o.Lat, "lng": o.Lng, "note": o.DropoffNote}
	}
	if d.AssignedAt != nil {
		v["assigned_at"] = d.AssignedAt.UTC().Format(time.RFC3339)
	}
	return v
}

func (s *Server) activeDelivery(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	d, err := scanDelivery(s.db.QueryRow(r.Context(), `SELECT `+deliveryCols+` FROM deliveries
		WHERE courier_id=$1 AND status IN ('assigned','at_pickup','picked_up','at_dropoff')
		ORDER BY assigned_at DESC LIMIT 1`, c.Sub))
	if err != nil {
		writeJSON(w, 200, map[string]any{"delivery": nil})
		return
	}
	writeJSON(w, 200, map[string]any{"delivery": s.deliveryViewForCourier(r.Context(), d)})
}

func (s *Server) getDelivery(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	d, err := s.loadDelivery(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "delivery not found")
		return
	}
	if d.CourierID == nil || *d.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your delivery")
		return
	}
	writeJSON(w, 200, map[string]any{"delivery": s.deliveryViewForCourier(r.Context(), d)})
}

// arrivedDelivery marks counter/door arrival for live UX (no timers, no
// penalties — the courier keeps their own pace inside the window).
func (s *Server) arrivedDelivery(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	d, err := s.loadDelivery(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "delivery not found")
		return
	}
	if d.CourierID == nil || *d.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your delivery")
		return
	}
	var b struct {
		At string `json:"at"`
	}
	if !decode(w, r, &b) {
		return
	}
	var q string
	switch {
	case b.At == "pickup" && d.Status == DeliveryAssigned:
		q = `UPDATE deliveries SET status='at_pickup', arrived_pickup_at=now() WHERE id=$1`
	case b.At == "dropoff" && d.Status == DeliveryPickedUp:
		q = `UPDATE deliveries SET status='at_dropoff', arrived_dropoff_at=now() WHERE id=$1`
	default:
		problem(w, 409, "Conflict", "arrival does not fit the current delivery status")
		return
	}
	if _, err := s.db.Exec(r.Context(), q, d.ID); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	o, _ := s.loadOrder(r.Context(), d.OrderID)
	s.broadcastOrder(r.Context(), o.CustomerID, o.MerchantID, o.ID, o.Status)
	updated, _ := s.loadDelivery(r.Context(), d.ID)
	writeJSON(w, 200, map[string]any{"delivery": s.deliveryViewForCourier(r.Context(), updated)})
}

// pickupDelivery confirms the handover at the counter: the courier types the
// code shown on the merchant's screen. Food must already be ready.
func (s *Server) pickupDelivery(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	d, err := s.loadDelivery(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "delivery not found")
		return
	}
	if d.CourierID == nil || *d.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your delivery")
		return
	}
	if d.Status != DeliveryAssigned && d.Status != DeliveryAtPickup {
		problem(w, 409, "Conflict", "delivery is "+d.Status+"; nothing to pick up")
		return
	}
	var b struct {
		PickupCode string `json:"pickup_code"`
	}
	if !decode(w, r, &b) {
		return
	}
	o, err := s.loadOrder(r.Context(), d.OrderID)
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	if o.Status != order.StatusReady {
		problem(w, 409, "Conflict", "the kitchen is still cooking; keep training until it is ready")
		return
	}
	if strings.TrimSpace(b.PickupCode) == "" || b.PickupCode != o.PickupCode {
		problem(w, 400, "Validation failed", "wrong pickup code; check the merchant's screen")
		return
	}
	_, _, _, err = s.transitionOrder(r.Context(), o.ID, order.StatusReady, order.StatusPickedUp,
		"courier", c.Sub, "picked up with code", func(ctx context.Context, tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `UPDATE deliveries SET status='picked_up', picked_up_at=now() WHERE id=$1`, d.ID); err != nil {
				return err
			}
			return enqueueTx(ctx, tx, "route_refresh", fmt.Sprintf(`{"delivery_id":%q}`, d.ID), time.Now())
		})
	if err != nil {
		problem(w, 409, "Conflict", "order changed; refresh and try again")
		return
	}
	s.queuePush(o.CustomerID, "Order picked up", "Your food is on the move — follow it live.")
	updated, _ := s.loadDelivery(r.Context(), d.ID)
	writeJSON(w, 200, map[string]any{"delivery": s.deliveryViewForCourier(r.Context(), updated)})
}

// deliveredDelivery completes the handover with the customer's 4-digit PIN
// (photo proof also accepted), then settles the money in the same
// transaction: escrow splits to merchant, courier, and platform.
func (s *Server) deliveredDelivery(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	d, err := s.loadDelivery(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "delivery not found")
		return
	}
	if d.CourierID == nil || *d.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your delivery")
		return
	}
	if d.Status != DeliveryPickedUp && d.Status != DeliveryAtDropoff {
		problem(w, 409, "Conflict", "delivery is "+d.Status+"; nothing to complete")
		return
	}
	var b struct {
		Pin         string `json:"pin"`
		ProofFileID string `json:"proof_file_id"`
	}
	if !decode(w, r, &b) {
		return
	}
	o, err := s.loadOrder(r.Context(), d.OrderID)
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	if o.Status != order.StatusPickedUp {
		problem(w, 409, "Conflict", "order is "+o.Status+"; pick it up first")
		return
	}
	proofOK := false
	proofID := strings.TrimSpace(b.ProofFileID)
	if proofID != "" {
		var owner, status string
		if err := s.db.QueryRow(r.Context(), `SELECT owner_id, status FROM files WHERE id=$1`, proofID).Scan(&owner, &status); err == nil && owner == c.Sub && status == "ready" {
			proofOK = true
		}
	}
	if b.Pin != o.DropoffPin && !proofOK {
		problem(w, 400, "Validation failed", "ask the customer for the 4-digit PIN or attach a handover photo")
		return
	}
	// The workout the customer powered, measured from stored fixes.
	start := time.Now().Add(-3 * time.Hour)
	if d.PickedUpAt != nil {
		start = *d.PickedUpAt
	}
	pts := s.carriedPoints(r.Context(), c.Sub, start, time.Now())
	maxSpeed, activeMin := s.modeSpeedsCourier(r.Context(), c.Sub)
	carriedM, carriedActive := ComputeCarried(pts, maxSpeed, activeMin, s.cfg.Tracking.SegmentMaxGapS)
	q := SettleQuoteFor(o.quote(), d.Type == "staff")
	_, _, _, err = s.transitionOrder(r.Context(), o.ID, order.StatusPickedUp, order.StatusDelivered,
		"courier", c.Sub, "delivered with PIN/photo", func(ctx context.Context, tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `UPDATE deliveries SET status='delivered', delivered_at=now(),
				proof_file_id=NULLIF($2,'')::uuid, carried_distance_m=$3, carried_active_s=$4 WHERE id=$1`,
				d.ID, proofID, carriedM, carriedActive); err != nil {
				return err
			}
			if err := postEntry(ctx, tx, "order_settle", ledger.SettleKey(o.ID), "order", o.ID,
				ledger.SettlementPostings(q, o.ID, o.MerchantID, c.Sub)); err != nil {
				return err
			}
			_, _ = tx.Exec(ctx, `UPDATE couriers SET deliveries_count=deliveries_count+1,
				last_delivery_at=now(), updated_at=now() WHERE user_id=$1`, c.Sub)
			// B6: photo proof gets an AI check in the same transaction.
			if proofID != "" {
				_ = enqueueTx(ctx, tx, AIJobProofCheck, fmt.Sprintf(`{"delivery_id":%q,"file_id":%q}`, d.ID, proofID), time.Now())
			}
			return enqueueTx(ctx, tx, "auto_complete", fmt.Sprintf(`{"order_id":%q}`, o.ID),
				time.Now().Add(72*time.Hour))
		})
	if err != nil {
		problem(w, 409, "Conflict", "order changed; refresh and try again")
		return
	}
	s.queuePush(o.CustomerID, "Delivered — thank you!",
		fmt.Sprintf("You powered %.1f km of your courier's workout.", carriedM/1000))
	var email string
	_ = s.db.QueryRow(r.Context(), `SELECT email FROM users WHERE id=$1`, o.CustomerID).Scan(&email)
	if email != "" {
		s.enqueueNow("email_send", fmt.Sprintf(`{"to":%q,"subject":"Your Trackfud receipt","body":%q}`,
			email, fmt.Sprintf("Order %s delivered. You powered %.1f km and %d active minutes.", o.Code, carriedM/1000, carriedActive/60)), time.Now())
	}
	updated, _ := s.loadDelivery(r.Context(), d.ID)
	writeJSON(w, 200, map[string]any{
		"delivery": s.deliveryViewForCourier(r.Context(), updated),
		"impact":   map[string]any{"distance_m": carriedM, "active_s": carriedActive},
		"payout":   money(q.CourierPayout, o.Currency),
	})
}

// carriedPoints loads the courier's stored fixes inside the carry window.
func (s *Server) carriedPoints(ctx context.Context, courierID string, from, to time.Time) []carriedPoint {
	rows, err := s.db.Query(ctx, `SELECT lp.ts, ST_Y(lp.pos::geometry), ST_X(lp.pos::geometry)
		FROM location_points lp JOIN activity_sessions s ON s.id=lp.session_id
		WHERE s.courier_id=$1 AND lp.ts BETWEEN $2 AND $3 ORDER BY lp.ts`, courierID, from, to)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []carriedPoint{}
	for rows.Next() {
		var p carriedPoint
		if err := rows.Scan(&p.Ts, &p.Lat, &p.Lng); err == nil {
			out = append(out, p)
		}
	}
	return out
}

// modeSpeedsCourier returns the ingest speed caps for one courier's mode.
func (s *Server) modeSpeedsCourier(ctx context.Context, courierID string) (maxSpeed, activeMin float64) {
	mode := "runner"
	_ = s.db.QueryRow(ctx, `SELECT mode FROM couriers WHERE user_id=$1`, courierID).Scan(&mode)
	return s.modeSpeeds(mode)
}

// ---------- staff mode (fallback delivery, no fitness test) ----------

// staffRow links the caller to one restaurant's staff roster.
func (s *Server) staffRow(ctx context.Context, userID, merchantID string) (canDeliver, onShift bool, ok bool) {
	err := s.db.QueryRow(ctx, `SELECT ms.can_deliver, ms.on_shift FROM merchant_staff ms
		JOIN users u ON lower(u.email)=lower(ms.email)
		WHERE u.id=$1 AND ms.merchant_id=$2`, userID, merchantID).Scan(&canDeliver, &onShift)
	if err != nil {
		return false, false, false
	}
	_, _ = s.db.Exec(ctx, `UPDATE merchant_staff SET user_id=$1, status='active'
		WHERE merchant_id=$2 AND lower(email)=(SELECT lower(email) FROM users WHERE id=$1)`, userID, merchantID)
	return canDeliver, onShift, true
}

// staffShift lets staff toggle their own on-shift flag (the merchant owner
// toggles can_deliver in the Merchant PWA).
func (s *Server) staffShift(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b struct {
		MerchantID string `json:"merchant_id"`
		OnShift    bool   `json:"on_shift"`
	}
	if !decode(w, r, &b) {
		return
	}
	if _, _, ok := s.staffRow(r.Context(), c.Sub, b.MerchantID); !ok {
		problem(w, 403, "Forbidden", "you are not staff at this restaurant")
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE merchant_staff SET on_shift=$3, user_id=$1, status='active'
		WHERE merchant_id=$2 AND lower(email)=(SELECT lower(email) FROM users WHERE id=$1)`,
		c.Sub, b.MerchantID, b.OnShift)
	writeJSON(w, 200, map[string]any{"merchant_id": b.MerchantID, "on_shift": b.OnShift})
}

// listMemberships shows the restaurants where the caller is on the staff
// roster (matched by account email, the same link the merchant invite and
// signup use). The Stride & Earn app uses this to enter staff mode with a
// real merchant instead of an invite code.
func (s *Server) listMemberships(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	rows, err := s.db.Query(r.Context(), `SELECT ms.merchant_id, m.name, ms.can_deliver, ms.on_shift, ms.status
		FROM merchant_staff ms JOIN users u ON lower(u.email)=lower(ms.email)
		JOIN merchants m ON m.id=ms.merchant_id WHERE u.id=$1 ORDER BY m.name`, c.Sub)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, status string
		var can, on bool
		if err := rows.Scan(&id, &name, &can, &on, &status); err != nil {
			continue
		}
		out = append(out, staffMembershipView(id, name, can, on, status))
	}
	writeJSON(w, 200, map[string]any{"memberships": out})
}

// staffMembershipView shapes one roster row exactly like the openapi
// StaffMembership schema (merchant_id, merchant_name, can_deliver,
// on_shift, status).
func staffMembershipView(id, name string, can, on bool, status string) map[string]any {
	return map[string]any{"merchant_id": id, "merchant_name": name,
		"can_deliver": can, "on_shift": on, "status": status}
}

func (s *Server) listStaffOffers(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	rows, err := s.db.Query(r.Context(), `SELECT `+offerCols+` FROM dispatch_offers
		WHERE courier_id=$1 AND status='pending' AND expires_at>now() AND kind='staff'
		ORDER BY expires_at`, c.Sub)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	now := time.Now()
	out := []map[string]any{}
	for rows.Next() {
		o, err := scanOffer(rows)
		if err != nil {
			continue
		}
		out = append(out, s.offerView(o, now))
	}
	writeJSON(w, 200, map[string]any{"offers": out})
}

// acceptStaffOffer claims a staff-fallback delivery (same atomic guard;
// first accept wins inside the 3 min staff window).
func (s *Server) acceptStaffOffer(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	offer, err := scanOffer(s.db.QueryRow(r.Context(), `SELECT `+offerCols+` FROM dispatch_offers WHERE id=$1`, r.PathValue("id")))
	if err != nil {
		problem(w, 404, "Not found", "offer not found")
		return
	}
	if offer.CourierID != c.Sub || offer.Kind != "staff" {
		problem(w, 403, "Forbidden", "not your offer")
		return
	}
	if offer.Status != "pending" || time.Now().After(offer.ExpiresAt) {
		problem(w, 410, "Gone", "this staff offer already expired")
		return
	}
	d, err := s.loadDelivery(r.Context(), offer.DeliveryID)
	if err != nil {
		problem(w, 404, "Not found", "delivery not found")
		return
	}
	o, err := s.loadOrder(r.Context(), d.OrderID)
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	can, on, ok := s.staffRow(r.Context(), c.Sub, o.MerchantID)
	if !ok || !can || !on {
		problem(w, 403, "Forbidden", "staff delivery needs can-deliver and on-shift at this restaurant")
		return
	}
	d2, code, msg := s.acceptCore(r.Context(), offer, c.Sub, "staff", []string{DeliveryStaffSearch})
	if code != 200 {
		problem(w, code, "Accept failed", msg)
		return
	}
	writeJSON(w, 200, map[string]any{"delivery": s.deliveryViewForCourier(r.Context(), d2)})
}

// ---------- River-style job handlers (all idempotent) ----------

// handleDispatchRun starts or advances one cascade (enqueued in-tx at
// merchant accept so a crash can never lose the search).
func (s *Server) handleDispatchRun(ctx context.Context, deliveryID string) {
	s.runCascade(ctx, deliveryID)
}

// handleOfferExpire closes one offer and advances the cascade. Retry-safe:
// an already-answered offer just re-runs the state-guarded cascade.
func (s *Server) handleOfferExpire(ctx context.Context, offerID string) {
	var deliveryID string
	_ = s.db.QueryRow(ctx, `UPDATE dispatch_offers SET status='expired' WHERE id=$1 AND status='pending'
		RETURNING delivery_id`, offerID).Scan(&deliveryID)
	if deliveryID == "" {
		_ = s.db.QueryRow(ctx, `SELECT delivery_id FROM dispatch_offers WHERE id=$1`, offerID).Scan(&deliveryID)
	}
	if deliveryID != "" {
		s.runCascade(ctx, deliveryID)
	}
}

// handleDispatchRetry re-runs a starved cascade (no couriers were online).
func (s *Server) handleDispatchRetry(ctx context.Context, deliveryID string) {
	s.runCascade(ctx, deliveryID)
}

// handleSearchTimeout moves a still-searching delivery to staff fallback.
func (s *Server) handleSearchTimeout(ctx context.Context, deliveryID string) {
	d, err := s.loadDelivery(ctx, deliveryID)
	if err != nil {
		return
	}
	if d.Status != DeliverySearching && d.Status != DeliveryOffered {
		return
	}
	s.moveToStaffSearch(ctx, deliveryID)
}

// handleStaffTimeout moves a still-unclaimed staff search to no_courier and
// hands the customer their three choices.
func (s *Server) handleStaffTimeout(ctx context.Context, deliveryID string) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	var orderID string
	err = tx.QueryRow(ctx, `UPDATE deliveries SET status='no_courier' WHERE id=$1
		AND status='staff_searching' RETURNING order_id`, deliveryID).Scan(&orderID)
	if err != nil {
		return
	}
	_, _ = tx.Exec(ctx, `UPDATE dispatch_offers SET status='expired' WHERE delivery_id=$1 AND status='pending'`, deliveryID)
	if err := tx.Commit(ctx); err != nil {
		return
	}
	s.notifyNoCourier(ctx, deliveryID, orderID)
}

// handleLeaveNudge tells the courier to head to the restaurant now. The
// nudged_at guard makes retries and ready-early races a no-op.
func (s *Server) handleLeaveNudge(ctx context.Context, deliveryID string) {
	var courierID, orderID string
	err := s.db.QueryRow(ctx, `UPDATE deliveries SET nudged_at=now() WHERE id=$1
		AND nudged_at IS NULL AND status IN ('assigned','at_pickup')
		RETURNING courier_id, order_id`).Scan(&courierID, &orderID)
	if err != nil {
		return
	}
	o, err := s.loadOrder(ctx, orderID)
	if err != nil {
		return
	}
	if o.Status == order.StatusPickedUp || o.Status == order.StatusDelivered || o.Status == order.StatusCompleted {
		return
	}
	name := merchantShort(o.MerchantID, s)
	s.queuePush(courierID, "Head to "+name+" now", "The kitchen is nearly ready — time to turn toward pickup.")
	s.hub.Broadcast(courierID, fmt.Sprintf(`{"type":"delivery.leave_now","delivery_id":%q,"order_id":%q}`, deliveryID, orderID))
}

// handleAutoComplete closes a delivered order 72 h later. Retry-safe: the
// guarded transition only fires from delivered.
func (s *Server) handleAutoComplete(ctx context.Context, orderID string) {
	o, err := s.loadOrder(ctx, orderID)
	if err != nil || o.Status != order.StatusDelivered {
		return
	}
	_, _, _, _ = s.transitionOrder(ctx, o.ID, order.StatusDelivered, order.StatusCompleted,
		"system", "", "auto_complete 72h after delivered", nil)
}

// ---------- Routes API ETA ----------

// handleRouteRefresh replans one active delivery: courier position to
// pickup before handover, pickup to door after. Called only on assign, on
// pickup, and on 150 m+ detours — never per GPS point.
func (s *Server) handleRouteRefresh(ctx context.Context, deliveryID string) {
	d, err := s.loadDelivery(ctx, deliveryID)
	if err != nil || d.CourierID == nil {
		return
	}
	switch d.Status {
	case DeliveryAssigned, DeliveryAtPickup, DeliveryPickedUp, DeliveryAtDropoff:
	default:
		return
	}
	o, err := s.loadOrder(ctx, d.OrderID)
	if err != nil {
		return
	}
	var plat, plng float64
	_ = s.db.QueryRow(ctx, `SELECT ST_Y(location::geometry), ST_X(location::geometry)
		FROM merchants WHERE id=$1`, o.MerchantID).Scan(&plat, &plng)
	var clat, clng float64
	var mode string
	_ = s.db.QueryRow(ctx, `SELECT ST_Y(last_pos::geometry), ST_X(last_pos::geometry)
		FROM activity_sessions WHERE courier_id=$1 AND status='active' AND last_pos IS NOT NULL
		ORDER BY last_seen_at DESC LIMIT 1`, *d.CourierID).Scan(&clat, &clng)
	_ = s.db.QueryRow(ctx, `SELECT mode FROM couriers WHERE user_id=$1`, *d.CourierID).Scan(&mode)
	if mode == "" {
		mode = "runner"
	}
	var dlat, dlng float64
	if d.Status == DeliveryAssigned || d.Status == DeliveryAtPickup {
		dlat, dlng = plat, plng
	} else {
		if !o.HasDropoff {
			return
		}
		dlat, dlng = o.Lat, o.Lng
	}
	if clat == 0 && clng == 0 {
		clat, clng = plat, plng
	}
	planKmh := s.cfg.Dispatch.RunnerPlanKmh
	if mode == "biker" {
		planKmh = s.cfg.Dispatch.BikerPlanKmh
	}
	res := maps.Estimate(haversineM(clat, clng, dlat, dlng), planKmh, s.cfg.Dispatch.Circuity)
	if s.cfg.Maps.APIKey != "" {
		if live, err := maps.ComputeRoute(ctx, s.cfg.Maps.APIKey, clat, clng, dlat, dlng, mode); err == nil {
			res = live
		} else {
			s.log.Warn("routes api failed, estimate kept", "delivery", deliveryID, "err", err)
		}
	}
	_, _ = s.db.Exec(ctx, `UPDATE deliveries SET eta_s=$2, route_polyline=$3,
		last_route_lat=$4, last_route_lng=$5, last_route_at=now() WHERE id=$1`,
		deliveryID, res.DurationS, res.Polyline, clat, clng)
	msg, _ := json.Marshal(map[string]any{"type": "delivery.eta", "delivery_id": deliveryID,
		"order_id": o.ID, "eta_s": res.DurationS, "route_warning": maps.BetaWarning})
	var ownerID string
	_ = s.db.QueryRow(ctx, `SELECT owner_id FROM merchants WHERE id=$1`, o.MerchantID).Scan(&ownerID)
	for _, uid := range []string{o.CustomerID, ownerID, *d.CourierID} {
		if uid != "" {
			s.hub.Broadcast(uid, string(msg))
		}
	}
}

// maybeRefreshRoute enqueues a replan when the courier strayed 150 m+ from
// the last routed position (called from GPS ingest, deduped).
func (s *Server) maybeRefreshRoute(ctx context.Context, courierID string, lat, lng float64) {
	var deliveryID string
	var rlat, rlng *float64
	err := s.db.QueryRow(ctx, `SELECT id, last_route_lat, last_route_lng FROM deliveries
		WHERE courier_id=$1 AND status IN ('assigned','at_pickup','picked_up','at_dropoff') LIMIT 1`,
		courierID).Scan(&deliveryID, &rlat, &rlng)
	if err != nil {
		return
	}
	if rlat == nil || rlng == nil ||
		haversineM(lat, lng, *rlat, *rlng) > s.cfg.Dispatch.DetourRefreshM {
		s.enqueueUnlessPending("route_refresh", deliveryID, time.Now())
	}
}

// broadcastCourierLocation shares the live dot with the customer and the
// merchant owner while a delivery is active (privacy: never otherwise).
func (s *Server) broadcastCourierLocation(ctx context.Context, courierID string, lat, lng float64, heading *float64, ts time.Time) {
	var deliveryID, orderID, customerID string
	err := s.db.QueryRow(ctx, `SELECT d.id, d.order_id, o.customer_id FROM deliveries d
		JOIN orders o ON o.id=d.order_id WHERE d.courier_id=$1
		AND d.status IN ('assigned','at_pickup','picked_up','at_dropoff') LIMIT 1`,
		courierID).Scan(&deliveryID, &orderID, &customerID)
	if err != nil {
		return
	}
	var ownerID string
	_ = s.db.QueryRow(ctx, `SELECT m.owner_id FROM merchants m JOIN orders o ON o.merchant_id=m.id
		WHERE o.id=$1`, orderID).Scan(&ownerID)
	msg, _ := json.Marshal(map[string]any{"type": "courier.location", "delivery_id": deliveryID,
		"order_id": orderID, "lat": lat, "lng": lng, "heading": heading,
		"ts": ts.UTC().Format(time.RFC3339)})
	for _, uid := range []string{customerID, ownerID} {
		if uid != "" {
			s.hub.Broadcast(uid, string(msg))
		}
	}
}

// ---------- public delivery view (attached to order detail) ----------

// deliveryPublicView shows the customer/merchant the live delivery: status,
// ETA, route, the courier's public profile, and their last known dot.
func (s *Server) deliveryPublicView(ctx context.Context, orderID string) map[string]any {
	d, err := s.loadDeliveryByOrder(ctx, orderID)
	if err != nil {
		return nil
	}
	v := map[string]any{"status": d.Status, "type": d.Type, "eta_s": d.EtaS,
		"route_polyline": d.Polyline, "route_warning": maps.BetaWarning}
	if d.CourierID == nil {
		return v
	}
	var name, mode string
	var rating float64
	var count int
	var distM float64
	// Staff couriers have no couriers row (no fitness test, no lifetime
	// stats), so the profile falls back to their account name and staff mode.
	_ = s.db.QueryRow(ctx, `SELECT u.name, COALESCE(c.mode,'staff'),
		COALESCE(c.rating_bayes,0), COALESCE(c.deliveries_count,0),
		COALESCE(c.lifetime_distance_m,0) FROM users u
		LEFT JOIN couriers c ON c.user_id=u.id WHERE u.id=$1`,
		*d.CourierID).Scan(&name, &mode, &rating, &count, &distM)
	first := strings.Fields(name)
	public := map[string]any{"mode": mode, "rating": rating, "deliveries": count,
		"lifetime_distance_m": distM}
	if len(first) > 0 {
		public["first_name"] = first[0]
	}
	// Last 8 weeks of distance for the profile sparkline.
	rows, err := s.db.Query(ctx, `SELECT date_trunc('week', started_at)::date, COALESCE(sum(distance_m),0)
		FROM activity_sessions WHERE courier_id=$1 AND started_at > now() - interval '8 weeks'
		GROUP BY 1 ORDER BY 1`, *d.CourierID)
	weeks := []map[string]any{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var wk time.Time
			var m float64
			if err := rows.Scan(&wk, &m); err == nil {
				weeks = append(weeks, map[string]any{"week": wk.Format("2006-01-02"), "distance_m": m})
			}
		}
	}
	public["weeks_8"] = weeks
	v["courier"] = public
	var clat, clng float64
	var seen *time.Time
	if err := s.db.QueryRow(ctx, `SELECT ST_Y(last_pos::geometry), ST_X(last_pos::geometry), last_seen_at
		FROM activity_sessions WHERE courier_id=$1 AND last_pos IS NOT NULL
		ORDER BY last_seen_at DESC LIMIT 1`, *d.CourierID).Scan(&clat, &clng, &seen); err == nil && seen != nil {
		v["courier_last"] = map[string]any{"lat": clat, "lng": clng, "at": seen.UTC().Format(time.RFC3339)}
	}
	return v
}
