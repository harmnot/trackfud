package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"Trackfud/internal/order"
	"Trackfud/internal/order
	"github.com/jackc/pgx/v5"
)

// testWeights mirrors the plan §6.2 defaults (config may tune them).
func testWeights() ScoreWeights {
	return ScoreWeights{Fit: 1.5, FoodWait: 1.0, Rating: 0.6, Idle: 0.2, HeadingPen: 0.5, Circuity: 1.3}
}

func testCtx(now time.Time) ScoreCtx {
	return ScoreCtx{
		Now: now, ReadyAtEst: now.Add(20 * time.Minute), HasReady: true,
		WindowEnd: now.Add(60 * time.Minute), HasWindow: true,
		PickupLat: 0, PickupLng: 0.01, PlanKmh: 9, MaxCarryS: 1500, W: testWeights(),
	}
}

// A courier with 3 km left on a 5 km goal must be matched the ~3.9 km job
// over the 0.6 km job; on a free run the shorter job wins instead.
func TestScoreWorkoutFitOrdering(t *testing.T) {
	now := time.Now()
	ctx := testCtx(now)
	fill := Candidate{CourierID: "a", Mode: "runner", ToPickupM: 500, TripM: 2500,
		LastLat: 0, LastLng: 0, RatingBayes: 4.5, GoalLeftM: 3000, IdleS: 60}
	short := Candidate{CourierID: "b", Mode: "runner", ToPickupM: 200, TripM: 300,
		LastLat: 0, LastLng: 0, RatingBayes: 4.5, GoalLeftM: 3000, IdleS: 60}
	sFill, _, _, okFill := ScoreCandidate(fill, ctx)
	sShort, _, _, okShort := ScoreCandidate(short, ctx)
	if !okFill || !okShort {
		t.Fatalf("both candidates must pass hard rules (fill=%v short=%v)", okFill, okShort)
	}
	if sFill >= sShort {
		t.Fatalf("goal fit: filler %.3f should beat short %.3f", sFill, sShort)
	}
	free := ctx
	fill.GoalLeftM, short.GoalLeftM = 0, 0
	sFill, _, _, _ = ScoreCandidate(fill, free)
	sShort, _, _, _ = ScoreCandidate(short, free)
	if sShort >= sFill {
		t.Fatalf("free run: short %.3f should beat filler %.3f", sShort, sFill)
	}
}

// Hard rules: carry over the cap and window-end breach both reject.
func TestScoreHardRejects(t *testing.T) {
	now := time.Now()
	ctx := testCtx(now)
	tooFar := Candidate{Mode: "runner", ToPickupM: 500, TripM: 3000, RatingBayes: 4.5}
	if _, _, carry, ok := ScoreCandidate(tooFar, ctx); ok {
		t.Fatalf("trip over carry cap must reject (carry %.0fs)", carry)
	}
	tight := ctx
	tight.WindowEnd = now.Add(10 * time.Minute)
	okJob := Candidate{Mode: "runner", ToPickupM: 200, TripM: 300, RatingBayes: 4.5}
	if _, _, _, ok := ScoreCandidate(okJob, tight); ok {
		t.Fatal("arrival after the window end must reject")
	}
}

// Declining is not a scoring input: the same courier scores identically no
// matter how many offers they declined before.
func TestScoreNoDeclinePenalty(t *testing.T) {
	now := time.Now()
	ctx := testCtx(now)
	c := Candidate{Mode: "runner", ToPickupM: 400, TripM: 1200,
		RatingBayes: 4.5, GoalLeftM: 2000, IdleS: 120}
	before, _, _, ok := ScoreCandidate(c, ctx)
	if !ok {
		t.Fatal("candidate must pass hard rules")
	}
	// Simulate "declined three offers": there is nowhere to record it, so
	// the score cannot move. Rank twice to prove determinism.
	ranked := RankCandidates([]Candidate{c, c}, ctx)
	if len(ranked) != 2 || ranked[0].Score != before || ranked[1].Score != before {
		t.Fatalf("scores must be deterministic and decline-free: %v vs %v", ranked, before)
	}
}

// Higher rating and longer idleness both lower the score (fairness); speed
// never appears — only distance, time, and rating terms do.
func TestScoreRatingIdleFairness(t *testing.T) {
	now := time.Now()
	ctx := testCtx(now)
	base := Candidate{Mode: "runner", ToPickupM: 400, TripM: 1200, GoalLeftM: 2000}
	hi, lo := base, base
	hi.RatingBayes, lo.RatingBayes = 4.9, 4.0
	hi.IdleS, lo.IdleS = 100, 100
	sHi, _, _, _ := ScoreCandidate(hi, ctx)
	sLo, _, _, _ := ScoreCandidate(lo, ctx)
	if sHi >= sLo {
		t.Fatalf("higher rating should win: %.3f vs %.3f", sHi, sLo)
	}
	patient, fresh := base, base
	patient.RatingBayes, fresh.RatingBayes = 4.5, 4.5
	patient.IdleS, fresh.IdleS = 1800, 0
	sPatient, _, _, _ := ScoreCandidate(patient, ctx)
	sFresh, _, _, _ := ScoreCandidate(fresh, ctx)
	if sPatient >= sFresh {
		t.Fatalf("longer idle should win: %.3f vs %.3f", sPatient, sFresh)
	}
}

// Free-run courier heading away (>90°) from a 1 km-away restaurant pays the
// heading penalty; heading toward it pays nothing.
func TestScoreHeadingPenalty(t *testing.T) {
	now := time.Now()
	ctx := testCtx(now)
	away, toward := 270.0, 90.0
	a := Candidate{Mode: "runner", ToPickupM: 1000, TripM: 1000,
		LastLat: 0, LastLng: 0, Heading: &away, RatingBayes: 4.5}
	b := a
	b.Heading = &toward
	sA, _, _, okA := ScoreCandidate(a, ctx)
	sB, _, _, okB := ScoreCandidate(b, ctx)
	if !okA || !okB {
		t.Fatal("both must pass hard rules")
	}
	if got, want := sA-sB, testWeights().HeadingPen; got != want {
		t.Fatalf("heading penalty = %.3f, want %.3f", got, want)
	}
}

type fakeRow struct {
	orderID string
	err     error
}

func (f fakeRow) Scan(dest ...any) error {
	if f.err != nil {
		return f.err
	}
	if len(dest) > 0 {
		if s, ok := dest[0].(*string); ok {
			*s = f.orderID
		}
	}
	return nil
}

type fakeClaimer struct {
	row     pgx.Row
	gotSQL  string
	gotArgs []any
}

func (f *fakeClaimer) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	f.gotSQL, f.gotArgs = sql, args
	return f.row
}

// The atomic accept maps "0 rows claimed" to ErrDeliveryTaken, and the
// guard SQL pins the status set plus courier_id IS NULL.
func TestClaimDelivery(t *testing.T) {
	ctx := context.Background()
	f := &fakeClaimer{row: fakeRow{err: pgx.ErrNoRows}}
	if _, err := claimDeliveryTx(ctx, f, "d", "c", "workout", 1, 2, []string{"searching"}); err != ErrDeliveryTaken {
		t.Fatalf("0 rows must map to ErrDeliveryTaken, got %v", err)
	}
	for _, want := range []string{"courier_id IS NULL", "status = ANY", "RETURNING order_id"} {
		if !strings.Contains(f.gotSQL, want) {
			t.Fatalf("claim SQL must contain %q", want)
		}
	}
	f2 := &fakeClaimer{row: fakeRow{orderID: "order-1"}}
	got, err := claimDeliveryTx(ctx, f2, "d", "c", "staff", 1, 2, []string{"staff_searching"})
	if err != nil || got != "order-1" {
		t.Fatalf("claim must return the order id, got %q %v", got, err)
	}
}

// Staff delivery settles at 5% commission; the split must still sum exactly.
func TestSettleQuoteFor(t *testing.T) {
	q := order.QuoteFor(order.QuoteInput{SubtotalMinor: 20000, DistanceKm: 2, Currency: "IDR"})
	w := SettleQuoteFor(q, false)
	if w != q {
		t.Fatal("workout settlement must equal the stored quote")
	}
	s := SettleQuoteFor(q, true)
	if s.CommissionMinor != order.Commission(20000, true) {
		t.Fatalf("staff commission = %d, want 5%%", s.CommissionMinor)
	}
	if s.MerchantPayout+s.CourierPayout+s.PlatformTake != q.TotalMinor {
		t.Fatal("staff split must still sum to the total")
	}
	if s.CourierPayout != q.CourierPayout {
		t.Fatal("courier keeps the same payout on staff delivery")
	}
}

// Carried math: geodesic distance + active seconds; teleport excluded.
func TestComputeCarried(t *testing.T) {
	t0 := time.Now()
	pts := []carriedPoint{
		{Ts: t0, Lat: -6.2, Lng: 106.8},
		{Ts: t0.Add(20 * time.Second), Lat: -6.199, Lng: 106.8}, // ~111 m run
		{Ts: t0.Add(22 * time.Second), Lat: -6.196, Lng: 106.8}, // 333 m in 2 s: teleport
	}
	dist, active := ComputeCarried(pts, 25/3.6, 1.0, 30)
	if dist < 100 || dist > 125 {
		t.Fatalf("carried distance = %.1f m, want ~111", dist)
	}
	if active != 20 {
		t.Fatalf("carried active = %d s, want 20", active)
	}
}

// Regression guard: the candidate query must keep its spec predicates.
func TestDispatchCandidatesSQL(t *testing.T) {
	for _, want := range []string{
		"dispatch_offers",                 // never re-offer
		"deliveries d WHERE d.courier_id", // anti-double-assign
		"ST_DWithin(s.last_pos",           // to-pickup + trip range
		"ST_DWithin(s.planned_track",      // corridor
		"string_to_array",                 // size/spill filters
		"goal_left_m",                     // workout fit
		"60 seconds",                      // fresh GPS only
		"c.status = 'approved'",           // approved couriers only
	} {
		if !strings.Contains(dispatchCandidatesSQL, want) {
			t.Fatalf("candidates SQL must contain %q", want)
		}
	}
}
