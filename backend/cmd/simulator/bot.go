package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// account is one courier the simulator drives (--accounts file entry).
type account struct {
	Email string `json:"email"`
	Mode  string `json:"mode"`
}

// parseAccounts reads the --accounts file: a JSON array of
// {"email","mode"} with mode runner|biker. Emails must be unique.
func parseAccounts(data []byte) ([]account, error) {
	var in []account
	if err := json.Unmarshal(data, &in); err != nil {
		return nil, fmt.Errorf("accounts: %w", err)
	}
	if len(in) == 0 {
		return nil, errors.New("accounts: empty list")
	}
	seen := map[string]bool{}
	out := make([]account, 0, len(in))
	for i, a := range in {
		a.Email = strings.TrimSpace(a.Email)
		a.Mode = strings.ToLower(strings.TrimSpace(a.Mode))
		if !strings.Contains(a.Email, "@") {
			return nil, fmt.Errorf("accounts[%d]: a valid email is required", i)
		}
		if a.Mode != "runner" && a.Mode != "biker" {
			return nil, fmt.Errorf("accounts[%d] %s: mode must be runner or biker", i, a.Email)
		}
		key := strings.ToLower(a.Email)
		if seen[key] {
			return nil, fmt.Errorf("accounts[%d]: duplicate %s", i, a.Email)
		}
		seen[key] = true
		out = append(out, a)
	}
	return out, nil
}

// defaultAccounts returns the demo-mode seeded bots: bot-runner-1,
// bot-biker-2, bot-runner-3, … (SeedDemo seeds six).
func defaultAccounts(n int) []account {
	out := make([]account, 0, n)
	for i := range n {
		mode := "runner"
		if i%2 == 1 {
			mode = "biker"
		}
		out = append(out, account{Email: fmt.Sprintf("bot-%s-%d@Trackfud.local", mode, i+1), Mode: mode})
	}
	return out
}

// offerPolicy is how bots answer offers (--offers).
type offerPolicy string

// Offer policies; offerByChance keeps the --accept probability behaviour.
const (
	offerByChance offerPolicy = ""
	offerAccept   offerPolicy = "accept"
	offerDecline  offerPolicy = "decline"
	offerIgnore   offerPolicy = "ignore"
)

// parseOfferPolicy validates --offers.
func parseOfferPolicy(s string) (offerPolicy, error) {
	switch p := offerPolicy(strings.ToLower(strings.TrimSpace(s))); p {
	case offerByChance, offerAccept, offerDecline, offerIgnore:
		return p, nil
	default:
		return "", fmt.Errorf("--offers must be accept, decline or ignore (got %q)", s)
	}
}

// decide says whether to answer an offer and, if so, whether to accept.
func (p offerPolicy) decide(rng *rand.Rand, acceptP float64) (respond, accept bool) {
	switch p {
	case offerAccept:
		return true, true
	case offerDecline:
		return true, false
	case offerIgnore:
		return false, false
	default:
		return true, rng.Float64() < acceptP
	}
}

// parseDeliveryPolicy validates --deliveries: drive (walk the handover,
// default) or ignore (keep cruising the route even with an active job).
func parseDeliveryPolicy(s string) (drive bool, err error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "drive":
		return true, nil
	case "ignore":
		return false, nil
	default:
		return false, fmt.Errorf("--deliveries must be drive or ignore (got %q)", s)
	}
}

// arriveRadiusM is how close counts as arrived at pickup/dropoff.
const arriveRadiusM = 60.0

// sessionGoalM is the work-session distance goal per mode.
var sessionGoalM = map[string]float64{"runner": 5000, "biker": 12000}

// bot is one simulated courier on one route.
type bot struct {
	who     *actor
	log     *slog.Logger
	rng     *rand.Rand
	mode    string
	route   *route
	scale   float64 // time compression: x1, x3, x10
	offers  offerPolicy
	acceptP float64
	drive   bool

	session string
	cur     cursor    // position along the route
	pos     pt        // true position (fixes add jitter on top)
	lastTs  time.Time // timestamp of the last posted fix
	speed   float64   // current cruise speed at x1 (m/s)
	driving bool      // on a delivery last tick (rejoin the route after)
}

// start signs in, opens (or resumes) the work session and places the bot:
// at the resumed session's last fix when it has one (then rejoining its
// route at the nearest point), else at a random spot on the route.
func (b *bot) start(now time.Time) error {
	if err := b.who.login(); err != nil {
		return err
	}
	last, err := b.openSession()
	if err != nil {
		return err
	}
	if last != nil {
		b.pos, b.cur = *last, b.route.nearest(*last)
	} else {
		b.cur = cursor{d: b.rng.Float64() * b.route.length(), dir: 1}
		if !b.route.loop && b.rng.IntN(2) == 0 {
			b.cur.dir = -1
		}
		b.pos = b.route.pointAt(b.cur.d)
	}
	b.lastTs = now
	b.speed = initialSpeed(b.rng, b.mode)
	return nil
}

// openSession starts a work session — the API resumes the live one when it
// exists — and returns its last fix, if any.
func (b *bot) openSession() (*pt, error) {
	var out struct {
		Session struct {
			ID      string   `json:"id"`
			LastLat *float64 `json:"last_lat"`
			LastLng *float64 `json:"last_lng"`
		} `json:"session"`
	}
	code, err := b.who.call(http.MethodPost, "/v1/courier/sessions",
		map[string]any{"kind": "work", "mode": b.mode, "goal_distance_m": sessionGoalM[b.mode]}, &out)
	if err != nil {
		return nil, fmt.Errorf("start session: %w", err)
	}
	if code >= 300 || out.Session.ID == "" {
		return nil, fmt.Errorf("start session: HTTP %d", code)
	}
	b.session = out.Session.ID
	if out.Session.LastLat != nil && out.Session.LastLng != nil {
		return &pt{*out.Session.LastLat, *out.Session.LastLng}, nil
	}
	return nil, nil
}

// step runs one tick: drive the active delivery (unless deliveries are
// ignored), else cruise the route and answer offers per policy.
func (b *bot) step(now time.Time) {
	if b.drive {
		if d := b.activeDelivery(); d != nil {
			b.driving = true
			b.driveDelivery(d, now)
			return
		}
	}
	if b.driving {
		b.cur, b.driving = b.route.nearest(b.pos), false
	}
	b.post(b.advance(now, func(m float64) pt {
		b.pos, b.cur = followRoute(b.route, b.cur, b.pos, m)
		return b.pos
	}))
	if b.offers != offerIgnore {
		b.handleOffers()
	}
}

// advance moves the bot for the real time since its last fix (× scale)
// and returns the fixes to post: one per hop of at most hopM, timestamps
// spread over the elapsed time, so at x1 the posted pace is the cruise
// speed.
func (b *bot) advance(now time.Time, move func(m float64) pt) []fix {
	elapsed := min(max(now.Sub(b.lastTs), 0), maxCatchUp)
	b.speed = nextSpeed(b.rng, b.mode, b.speed)
	hops := samplePath(b.speed*elapsed.Seconds()*b.scale, move)
	stamps := stampTimes(b.lastTs, now, len(hops))
	b.lastTs = stamps[len(stamps)-1]
	return makeFixes(b.rng, hops, stamps)
}

// post sends one batch. A 409 means the session ended (auto-ended after 10
// idle minutes): open a session again (the API resumes or creates one) and
// resend the batch there.
func (b *bot) post(fixes []fix) {
	code, err := b.postBatch(fixes)
	if err == nil && code == http.StatusConflict {
		if _, serr := b.openSession(); serr != nil {
			b.log.Warn("session reopen failed", "bot", b.who.email, "err", serr)
			return
		}
		b.log.Info("session reopened after 409", "bot", b.who.email, "session", b.session)
		code, err = b.postBatch(fixes)
	}
	if err != nil {
		b.log.Warn("location post failed", "bot", b.who.email, "err", err)
		return
	}
	if code >= 300 {
		b.log.Warn("location post rejected", "bot", b.who.email, "status", code)
	}
}

func (b *bot) postBatch(fixes []fix) (int, error) {
	return b.who.call(http.MethodPost, "/v1/courier/locations",
		map[string]any{"session_id": b.session, "points": wirePoints(fixes)}, nil)
}

// handleOffers answers the first pending offer per the bot's policy.
func (b *bot) handleOffers() {
	var out struct {
		Offers []struct {
			ID string `json:"id"`
		} `json:"offers"`
	}
	code, err := b.who.call(http.MethodGet, "/v1/courier/offers", nil, &out)
	if err != nil || code >= 300 || len(out.Offers) == 0 {
		return
	}
	respond, accept := b.offers.decide(b.rng, b.acceptP)
	if !respond {
		return
	}
	id := url.PathEscape(out.Offers[0].ID)
	if !accept {
		if code, _ := b.who.call(http.MethodPost, "/v1/courier/offers/"+id+"/decline", nil, nil); code == http.StatusOK {
			b.log.Info("offer declined", "bot", b.who.email)
		}
		return
	}
	if code, _ := b.who.call(http.MethodPost, "/v1/courier/offers/"+id+"/accept", nil, nil); code == http.StatusOK {
		b.log.Info("offer accepted", "bot", b.who.email)
	}
}

// delivery is the slice of the courier delivery view the handover needs.
type delivery struct {
	ID, Status, OrderStatus string
	Pickup, Dropoff         *pt
}

func (b *bot) activeDelivery() *delivery {
	type geo struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	var out struct {
		Delivery struct {
			ID          string `json:"id"`
			Status      string `json:"status"`
			OrderStatus string `json:"order_status"`
			Pickup      *geo   `json:"pickup"`
			Dropoff     *geo   `json:"dropoff"`
		} `json:"delivery"`
	}
	if code, err := b.who.call(http.MethodGet, "/v1/courier/deliveries/active", nil, &out); err != nil || code >= 300 {
		return nil
	}
	if out.Delivery.ID == "" {
		return nil
	}
	d := &delivery{ID: out.Delivery.ID, Status: out.Delivery.Status, OrderStatus: out.Delivery.OrderStatus}
	if p := out.Delivery.Pickup; p != nil {
		d.Pickup = &pt{p.Lat, p.Lng}
	}
	if p := out.Delivery.Dropoff; p != nil {
		d.Dropoff = &pt{p.Lat, p.Lng}
	}
	return d
}

// codes fetches the demo-only handover codes (pickup code, delivery PIN).
func (b *bot) codes(id string) (pickup, pin string) {
	var out struct {
		PickupCode  string `json:"pickup_code"`
		DeliveryPin string `json:"delivery_pin"`
	}
	_, _ = b.who.call(http.MethodGet, "/v1/dev/deliveries/"+url.PathEscape(id)+"/codes", nil, &out)
	return out.PickupCode, out.DeliveryPin
}

// driveDelivery walks to pickup, then dropoff, and runs the handover steps
// with the dev codes once within arriveRadiusM.
func (b *bot) driveDelivery(d *delivery, now time.Time) {
	target := d.Pickup
	if d.Status == "picked_up" || d.Status == "at_dropoff" {
		target = d.Dropoff
	}
	if target == nil {
		// No coordinates to drive to: keep the dot alive in place.
		b.post(b.advance(now, func(float64) pt { return b.pos }))
		return
	}
	left := distM(b.pos, *target)
	b.post(b.advance(now, func(m float64) pt {
		b.pos, left = moveToward(b.pos, *target, m)
		return b.pos
	}))
	if left > arriveRadiusM {
		return
	}
	base := "/v1/courier/deliveries/" + url.PathEscape(d.ID)
	readyForPickup := d.OrderStatus == "ready" || d.OrderStatus == "picked_up"
	switch d.Status {
	case "assigned":
		_, _ = b.who.call(http.MethodPost, base+"/arrived", map[string]any{"at": "pickup"}, nil)
		if readyForPickup {
			b.pickup(d.ID, base)
		}
	case "at_pickup":
		if readyForPickup {
			b.pickup(d.ID, base)
		}
	case "picked_up":
		_, _ = b.who.call(http.MethodPost, base+"/arrived", map[string]any{"at": "dropoff"}, nil)
	case "at_dropoff":
		if _, pin := b.codes(d.ID); pin != "" {
			if code, _ := b.who.call(http.MethodPost, base+"/delivered", map[string]any{"pin": pin}, nil); code == http.StatusOK {
				b.log.Info("delivered", "bot", b.who.email, "delivery", d.ID)
			}
		}
	}
}

func (b *bot) pickup(id, base string) {
	if code, _ := b.codes(id); code != "" {
		_, _ = b.who.call(http.MethodPost, base+"/pickup", map[string]any{"pickup_code": code}, nil)
	}
}
