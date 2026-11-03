package main

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// gbkRoutes is a realistic --routes file around Gelora Bung Karno: a
// runner loop, an out-and-back bike lane, a skipped Point, and a closed
// mode-less loop with null properties.
const gbkRoutes = `{"type":"FeatureCollection","features":[
 {"type":"Feature","properties":{"name":"GBK ring road","mode":"runner","loop":true},
  "geometry":{"type":"LineString","coordinates":[[106.7990,-6.2160],[106.8070,-6.2160],[106.8070,-6.2215],[106.7990,-6.2215]]}},
 {"type":"Feature","properties":{"name":"Sudirman bike lane","mode":"Biker"},
  "geometry":{"type":"LineString","coordinates":[[106.8000,-6.2250],[106.8100,-6.2200],[106.8200,-6.2150]]}},
 {"type":"Feature","properties":{"name":"Stadium"},
  "geometry":{"type":"Point","coordinates":[106.8029661,-6.2186006]}},
 {"type":"Feature","properties":null,
  "geometry":{"type":"LineString","coordinates":[[106.8010,-6.2170,12],[106.8040,-6.2170],[106.8040,-6.2195],[106.8010,-6.2195],[106.8010,-6.2170]]}}
]}`

func mustRoutes(t *testing.T) []*route {
	t.Helper()
	rs, err := parseRoutes([]byte(gbkRoutes))
	if err != nil {
		t.Fatalf("parseRoutes: %v", err)
	}
	return rs
}

func approx(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

func TestParseRoutes(t *testing.T) {
	rs := mustRoutes(t)
	if len(rs) != 3 {
		t.Fatalf("want 3 LineString routes (Point skipped), got %d", len(rs))
	}
	ring, lane, anon := rs[0], rs[1], rs[2]
	if ring.name != "GBK ring road" || ring.mode != "runner" || !ring.loop {
		t.Fatalf("ring = %+v", ring)
	}
	if len(ring.pts) != 5 || ring.pts[4] != ring.pts[0] {
		t.Fatal("an open loop must get its closing leg appended")
	}
	if lane.mode != "biker" || lane.loop {
		t.Fatalf("lane must be biker, out-and-back: mode=%q loop=%v", lane.mode, lane.loop)
	}
	if anon.name != "route-4" || anon.mode != "" || !anon.loop {
		t.Fatalf("closed mode-less line must default to a loop: %+v", anon)
	}
	// ~885 m east + ~612 m south, twice: the ring is ~3 km.
	if !approx(ring.length(), 2*(distM(ring.pts[0], ring.pts[1])+distM(ring.pts[1], ring.pts[2])), 1) || ring.length() < 2900 || ring.length() > 3100 {
		t.Fatalf("ring length = %.0f m", ring.length())
	}

	for name, bad := range map[string]string{
		"malformed":      `{"type":"FeatureCollection","features":[`,
		"not collection": `{"type":"Feature","geometry":{"type":"LineString","coordinates":[[0,0],[0,1]]}}`,
		"no lines":       `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]}}]}`,
		"bad mode":       `{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"mode":"scooter"},"geometry":{"type":"LineString","coordinates":[[106.80,-6.21],[106.81,-6.21]]}}]}`,
		"one point":      `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[106.80,-6.21]]}}]}`,
		"lat range":      `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[106.80,-96.21],[106.81,-6.21]]}}]}`,
		"short position": `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[106.80],[106.81,-6.21]]}}]}`,
		"too short":      `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[106.80,-6.21],[106.80001,-6.21]]}}]}`,
	} {
		if _, err := parseRoutes([]byte(bad)); err == nil {
			t.Fatalf("%s: parseRoutes must fail", name)
		}
	}
}

func TestParseGPXAndCityLoop(t *testing.T) {
	gpx := `<gpx><trk><trkseg><trkpt lat="-6.2186" lon="106.8029"/><trkpt lat="-6.2190" lon="106.8040"/></trkseg></trk></gpx>`
	pts, err := parseGPX([]byte(gpx))
	if err != nil || len(pts) != 2 || pts[1] != (pt{-6.2190, 106.8040}) {
		t.Fatalf("parseGPX = %v %v", pts, err)
	}
	if _, err := parseGPX([]byte(`<gpx></gpx>`)); err == nil {
		t.Fatal("empty GPX must fail")
	}
	r, err := newRoute("jakarta-loop", "", true, cityLoop("jakarta"))
	if err != nil || r.length() < 3000 || r.length() > 4500 {
		t.Fatalf("city loop: %v len=%v", err, r)
	}
}

// Round-robin within each mode; mode-less routes serve every mode; no
// match falls back to all routes.
func TestAssignRoutes(t *testing.T) {
	rs := mustRoutes(t) // ring(runner), lane(biker), anon(any)
	accts := []account{{"a@x", "runner"}, {"b@x", "biker"}, {"c@x", "runner"}, {"d@x", "runner"}, {"e@x", "biker"}}
	got := assignRoutes(accts, rs)
	want := []*route{rs[0], rs[1], rs[2], rs[0], rs[2]}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("account %d got route %s, want %s", i, got[i].name, want[i].name)
		}
	}
	bikeOnly := []*route{rs[1]}
	if got := assignRoutes([]account{{"r@x", "runner"}}, bikeOnly); got[0] != rs[1] {
		t.Fatal("no matching route must fall back to any route")
	}
}

func TestRouteAdvance(t *testing.T) {
	rs := mustRoutes(t)
	ring, lane := rs[0], rs[1]
	l := ring.length()
	if c := ring.advance(cursor{d: l - 10, dir: 1}, 25); !approx(c.d, 15, 1e-6) || c.dir != 1 {
		t.Fatalf("loop must wrap: %+v", c)
	}
	if c := ring.advance(cursor{d: 5, dir: 1}, 3*l); !approx(c.d, 5, 1e-6) {
		t.Fatalf("whole laps must land on the same spot: %+v", c)
	}
	ll := lane.length()
	if c := lane.advance(cursor{d: ll - 10, dir: 1}, 25); !approx(c.d, ll-15, 1e-6) || c.dir != -1 {
		t.Fatalf("out-and-back must bounce at the end: %+v", c)
	}
	if c := lane.advance(cursor{d: 10, dir: -1}, 25); !approx(c.d, 15, 1e-6) || c.dir != 1 {
		t.Fatalf("out-and-back must bounce at the start: %+v", c)
	}
	if c := lane.advance(cursor{d: 100, dir: 1}, 2*ll); !approx(c.d, 100, 1e-6) || c.dir != 1 {
		t.Fatalf("a full out-and-back cycle must return: %+v", c)
	}
	// pointAt is continuous across the loop seam and clamps outside.
	if distM(ring.pointAt(0), ring.pointAt(l)) > 0.01 || ring.pointAt(-5) != ring.pts[0] {
		t.Fatal("loop seam must be continuous")
	}
	if got := distM(ring.pts[0], ring.pointAt(100)); !approx(got, 100, 0.5) {
		t.Fatalf("100 m along the first leg is %.2f m from start", got)
	}
}

func TestNearestAndRejoin(t *testing.T) {
	ring := mustRoutes(t)[0]
	// 300 m south of the middle of the first (east-bound) leg.
	mid := ring.pointAt(ring.cum[1] / 2)
	off := pt{mid.lat - 300/metersPerDeg, mid.lng}
	c := ring.nearest(off)
	if !approx(c.d, ring.cum[1]/2, 2) {
		t.Fatalf("nearest d = %.1f, want ≈ %.1f", c.d, ring.cum[1]/2)
	}
	// Rejoin walks straight back first, never hopping more than asked.
	p, c2 := followRoute(ring, c, off, 100)
	if c2 != c || !approx(distM(off, p), 100, 0.5) || !approx(distM(p, mid), 200, 2) {
		t.Fatalf("rejoin hop wrong: moved %.1f, left %.1f", distM(off, p), distM(p, mid))
	}
	// The last 200 m reach the route and spend the rest along it.
	p, c3 := followRoute(ring, c2, p, 250)
	if !approx(c3.d-c2.d, 50, 2) || distM(p, ring.pointAt(c3.d)) > 0.01 {
		t.Fatalf("rejoin remainder must continue along the route: Δd=%.1f", c3.d-c2.d)
	}
}

func TestStampTimes(t *testing.T) {
	last := time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC)
	got := stampTimes(last, last.Add(6*time.Second), 3)
	for i, want := range []time.Duration{2 * time.Second, 4 * time.Second, 6 * time.Second} {
		if !got[i].Equal(last.Add(want)) {
			t.Fatalf("stamp %d = %v, want +%v", i, got[i], want)
		}
	}
	for _, now := range []time.Time{last, last.Add(-time.Second), last.Add(time.Microsecond)} {
		prev := last
		for _, ts := range stampTimes(last, now, 4) {
			if ts.Sub(prev) < minPointGap {
				t.Fatalf("stamps must rise ≥1 ms even when the clock stalls: %v after %v", ts, prev)
			}
			prev = ts
		}
	}
}

func TestFixesAndWire(t *testing.T) {
	rng := rand.New(rand.NewPCG(7, 11))
	center := pt{-6.2186006, 106.8029661}
	hops := make([]pt, 200)
	for i := range hops {
		hops[i] = center
	}
	stamps := stampTimes(time.Now(), time.Now().Add(time.Minute), len(hops))
	fixes := makeFixes(rng, hops, stamps)
	accs := map[float64]bool{}
	for _, f := range fixes {
		if d := distM(center, f.p); d > jitterM+1e-6 {
			t.Fatalf("jitter %.3f m exceeds %.0f m", d, jitterM)
		}
		if f.acc < minAccuracyM || f.acc > maxAccuracyM {
			t.Fatalf("accuracy %.1f outside 4–12 m", f.acc)
		}
		accs[f.acc] = true
	}
	if len(accs) < 10 {
		t.Fatalf("accuracy must vary (too_smooth guard), got %d distinct values", len(accs))
	}
	ts := time.Date(2026, 11, 3, 10, 0, 1, 123456789, time.FixedZone("WIB", 7*3600))
	w := wirePoints([]fix{{ts: ts, p: center, acc: 7.5}})[0]
	if w["ts"] != "2026-11-03T03:00:01.123456789Z" || w["acc"] != 7.5 || w["lat"] != center.lat {
		t.Fatalf("wire point = %v", w)
	}
	// The server parses with time.RFC3339, which accepts the fraction.
	if back, err := time.Parse(time.RFC3339, w["ts"].(string)); err != nil || !back.Equal(ts) {
		t.Fatalf("server-side parse = %v %v", back, err)
	}
}

// testBot is a bot without a network identity, for pure motion tests.
func testBot(mode string, r *route, scale float64, t0 time.Time) *bot {
	rng := rand.New(rand.NewPCG(3, 5))
	return &bot{rng: rng, mode: mode, route: r, scale: scale, cur: cursor{d: 0, dir: 1},
		pos: r.pointAt(0), lastTs: t0, speed: initialSpeed(rng, mode)}
}

// cruise runs n ticks of dt and returns every posted fix plus the true
// meters covered per tick.
func cruise(b *bot, n int, dt time.Duration) (fixes []fix, perTick []float64) {
	now := b.lastTs
	for range n {
		now = now.Add(dt)
		before := b.cur.d
		fixes = append(fixes, b.advance(now, func(m float64) pt {
			b.pos, b.cur = followRoute(b.route, b.cur, b.pos, m)
			return b.pos
		})...)
		perTick = append(perTick, b.cur.d-before)
	}
	return fixes, perTick
}

// At x1 the true pace stays inside each mode's band, timestamps rise, and
// no two consecutive fixes are farther apart than 150 m.
func TestCruisePaceAtX1(t *testing.T) {
	// 11 km north-south meridian line: no corners, no bounce in the test.
	straight, err := newRoute("meridian", "", false, []pt{{-6.30, 106.80}, {-6.20, 106.80}})
	if err != nil {
		t.Fatal(err)
	}
	for mode, band := range modeSpeedMps {
		b := testBot(mode, straight, 1, time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC))
		fixes, perTick := cruise(b, 120, 5*time.Second)
		for i, m := range perTick {
			if v := m / 5; v < band[0]-1e-9 || v > band[1]+1e-9 {
				t.Fatalf("%s tick %d pace %.3f m/s outside %v", mode, i, v, band)
			}
		}
		assertTrack(t, mode, fixes)
	}
}

// At x10 a biker covers ~325 m per 5 s tick: the tick splits into hops so
// the 150 m point-gap rule still holds.
func TestCruiseX10Splits(t *testing.T) {
	ring := mustRoutes(t)[0]
	b := testBot("biker", ring, 10, time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC))
	fixes, _ := cruise(b, 60, 5*time.Second)
	if len(fixes) < 120 {
		t.Fatalf("x10 ticks must split into several fixes, got %d for 60 ticks", len(fixes))
	}
	assertTrack(t, "biker x10", fixes)
}

func assertTrack(t *testing.T, label string, fixes []fix) {
	t.Helper()
	for i := 1; i < len(fixes); i++ {
		if !fixes[i].ts.After(fixes[i-1].ts) {
			t.Fatalf("%s: fix %d timestamp does not increase", label, i)
		}
		if d := distM(fixes[i-1].p, fixes[i].p); d > maxPointGapM {
			t.Fatalf("%s: fixes %d→%d are %.1f m apart (>150 m)", label, i-1, i, d)
		}
	}
}

func TestHopsFor(t *testing.T) {
	for meters, want := range map[float64]int{0: 1, 50: 1, hopM: 1, hopM + 1: 2, 325: 3, 1000: 9} {
		if got := hopsFor(meters); got != want {
			t.Fatalf("hopsFor(%v) = %d, want %d", meters, got, want)
		}
	}
	if hopM+2*jitterM > maxPointGapM {
		t.Fatal("hop + jitter must stay under the 150 m gap rule")
	}
}

func TestParseFlags(t *testing.T) {
	noEnv := func(string) string { return "" }
	c, err := parseFlags(nil, noEnv, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if c.base != "http://localhost:8000/api" || c.password != "DemoPass123!" || !c.drive || c.offers != offerByChance || c.bots != 3 {
		t.Fatalf("defaults = %+v", c)
	}
	env := func(k string) string {
		if k == "TF_SIM_PASSWORD" {
			return "trackfud123"
		}
		return ""
	}
	if c, _ := parseFlags(nil, env, io.Discard); c.password != "trackfud123" {
		t.Fatalf("env must override the default password, got %q", c.password)
	}
	c, err = parseFlags([]string{"--password", "flag-pass", "--offers", "IGNORE", "--deliveries", "ignore",
		"--accounts", "gbk.json", "--routes", "gbk.geojson", "--speed", "10"}, env, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if c.password != "flag-pass" || c.offers != offerIgnore || c.drive || c.accountsFile != "gbk.json" || c.routesFile != "gbk.geojson" || c.speed != 10 {
		t.Fatalf("explicit flags = %+v", c)
	}
	for _, bad := range [][]string{{"--speed", "2"}, {"--offers", "maybe"}, {"--deliveries", "teleport"},
		{"--accept", "1.5"}, {"--bots", "0"}, {"--tick", "0s"}, {"--nope"}} {
		if _, err := parseFlags(bad, noEnv, io.Discard); err == nil {
			t.Fatalf("flags %v must fail", bad)
		}
	}
}

func TestAccountsAndPolicies(t *testing.T) {
	accts, err := parseAccounts([]byte(`[{"email":"gbk-runner-1@example.com","mode":"runner"},{"email":" gbk-biker-1@example.com ","mode":"BIKER"}]`))
	if err != nil || len(accts) != 2 || accts[1].Email != "gbk-biker-1@example.com" || accts[1].Mode != "biker" {
		t.Fatalf("parseAccounts = %+v %v", accts, err)
	}
	for _, bad := range []string{`[]`, `{}`, `[{"email":"nope","mode":"runner"}]`, `[{"email":"a@x","mode":"scooter"}]`,
		`[{"email":"a@x","mode":"runner"},{"email":"A@x","mode":"biker"}]`} {
		if _, err := parseAccounts([]byte(bad)); err == nil {
			t.Fatalf("parseAccounts(%s) must fail", bad)
		}
	}
	def := defaultAccounts(3)
	if def[0] != (account{"bot-runner-1@Trackfud.local", "runner"}) || def[1] != (account{"bot-biker-2@Trackfud.local", "biker"}) || def[2].Email != "bot-runner-3@Trackfud.local" {
		t.Fatalf("default bots = %+v", def)
	}
	rng := rand.New(rand.NewPCG(1, 1))
	for p, want := range map[offerPolicy][2]bool{offerAccept: {true, true}, offerDecline: {true, false}, offerIgnore: {false, false}} {
		if r, a := p.decide(rng, 0.5); r != want[0] || a != want[1] {
			t.Fatalf("%q decide = %v,%v", p, r, a)
		}
	}
	if _, a := offerByChance.decide(rng, 1); !a {
		t.Fatal("probability 1 must accept")
	}
	if _, a := offerByChance.decide(rng, 0); a {
		t.Fatal("probability 0 must decline")
	}
	if d, err := parseDeliveryPolicy(""); err != nil || !d {
		t.Fatal("default deliveries policy is drive")
	}
}

// fakeAPI is a tiny stand-in for the gateway: it records X-TF-App per
// path, issues tokens, and lets tests script session/location replies.
type fakeAPI struct {
	mu        sync.Mutex
	apps      map[string][]string
	logins    int
	sessions  int
	locations []string // session_id of each location batch
	points    []int
	expired   string // token answered with 401 once
	failLogin bool
}

func (f *fakeAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	path := strings.TrimPrefix(r.URL.Path, "/api")
	f.apps[path] = append(f.apps[path], r.Header.Get("X-TF-App"))
	tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if path != "/v1/auth/login" && tok != "" && tok == f.expired {
		f.expired = ""
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	switch path {
	case "/v1/auth/login":
		if f.failLogin {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		f.logins++
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "tok-" + string(rune('0'+f.logins))})
	case "/v1/courier/sessions":
		f.sessions++
		_ = json.NewEncoder(w).Encode(map[string]any{"session": map[string]any{"id": "s-" + string(rune('0'+f.sessions))}})
	case "/v1/courier/locations":
		var b struct {
			SessionID string           `json:"session_id"`
			Points    []map[string]any `json:"points"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		f.locations = append(f.locations, b.SessionID)
		f.points = append(f.points, len(b.Points))
		if b.SessionID == "s-1" {
			w.WriteHeader(http.StatusConflict) // auto-ended after 10 idle min
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"accepted": len(b.Points)})
	case "/v1/merchant/orders":
		_ = json.NewEncoder(w).Encode(map[string]any{"orders": []map[string]any{{"id": "o-placed", "status": "placed"}, {"id": "o-acc", "status": "accepted"}}})
	default:
		_ = json.NewEncoder(w).Encode(map[string]any{})
	}
}

func newFakeAPI(t *testing.T) (*fakeAPI, *client) {
	t.Helper()
	f := &fakeAPI{apps: map[string][]string{}}
	ts := httptest.NewServer(f)
	t.Cleanup(ts.Close)
	return f, &client{base: ts.URL + "/api", http: ts.Client()}
}

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// A 409 on a location batch reopens the session and resends the batch;
// every courier call says X-TF-App: courier.
func TestBotReopensSessionOn409(t *testing.T) {
	f, api := newFakeAPI(t)
	ring := mustRoutes(t)[0]
	b := testBot("runner", ring, 1, time.Now().Add(-5*time.Second))
	b.who = &actor{api: api, app: appCourier, email: "gbk-runner-1@example.com", password: "trackfud123"}
	b.log = quietLog()
	if err := b.start(time.Now().Add(-5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if b.session != "s-1" {
		t.Fatalf("session = %q", b.session)
	}
	b.post(b.advance(time.Now(), func(m float64) pt { return b.pos }))
	if f.sessions != 2 || b.session != "s-2" {
		t.Fatalf("409 must reopen a session: sessions=%d current=%q", f.sessions, b.session)
	}
	if len(f.locations) != 2 || f.locations[0] != "s-1" || f.locations[1] != "s-2" || f.points[0] != f.points[1] {
		t.Fatalf("batch must be resent to the new session: %v %v", f.locations, f.points)
	}
	for path, apps := range f.apps {
		for _, app := range apps {
			if app != "courier" {
				t.Fatalf("%s sent X-TF-App %q, want courier", path, app)
			}
		}
	}
}

// The auto-merchant signs in and acts with X-TF-App: merchant, re-logs in
// on a 401, and backs off after a failed sign-in.
func TestAutoMerchantPlatformAndRelogin(t *testing.T) {
	f, api := newFakeAPI(t)
	m := &autoMerchant{log: quietLog(), who: &actor{api: api, app: appMerchant, email: demoMerchantEmail, password: demoSeedPassword}}
	m.tick()
	if f.logins != 1 || len(f.apps["/v1/merchant/orders/o-placed/accept"]) != 1 || len(f.apps["/v1/merchant/orders/o-acc/ready"]) != 1 {
		t.Fatalf("merchant tick must accept placed + ready accepted: %v", f.apps)
	}
	f.expired = m.who.token
	m.tick()
	if f.logins != 2 {
		t.Fatalf("a 401 must trigger one re-login, logins=%d", f.logins)
	}
	for path, apps := range f.apps {
		for _, app := range apps {
			if app != "merchant" {
				t.Fatalf("%s sent X-TF-App %q, want merchant", path, app)
			}
		}
	}

	f2, api2 := newFakeAPI(t)
	f2.failLogin = true
	m2 := &autoMerchant{log: quietLog(), who: &actor{api: api2, app: appMerchant, email: demoMerchantEmail, password: "wrong"}}
	m2.tick()
	m2.tick()
	if n := len(f2.apps["/v1/auth/login"]); n != 1 {
		t.Fatalf("failed sign-in must back off, got %d login calls", n)
	}
	if err := m2.who.login(); !errors.Is(err, errLoginBackoff) {
		t.Fatalf("login during backoff = %v", err)
	}
}
