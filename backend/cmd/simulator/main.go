// Command simulator runs demo courier bots on GPX tracks (Milestone B6).
//
// Each bot logs in as a seeded bot courier, starts a workout session, jogs
// a loop with speed noise, accepts offers with a probability, and walks the
// pickup → dropoff handover using the demo-only dev codes endpoint. An
// optional merchant loop auto-accepts and readies orders so judges get an
// unattended golden-path loop. Speed scaling x1/x3/x10 compresses tick time.
//
// Usage:
//
//	go run ./cmd/simulator --base http://localhost:8080/api --bots 3 --speed 3
package main

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net/http"
	"os"
	"time"
)

type pt struct{ lat, lng float64 }

func main() {
	base := flag.String("base", "http://localhost:8080/api", "API base URL")
	nbots := flag.Int("bots", 3, "courier bots (seeded bot-runner/biker-N users)")
	speed := flag.Float64("speed", 1, "time scale: 1, 3, or 10")
	accept := flag.Float64("accept", 0.8, "offer accept probability 0..1")
	gpx := flag.String("gpx", "", "optional GPX track file (trkpt lat/lon)")
	city := flag.String("city", "jakarta", "jakarta or london (default loop)")
	merchant := flag.Bool("auto-merchant", true, "auto-accept + ready demo orders")
	rounds := flag.Int("rounds", 0, "stop after N ticks (0 = run forever)")
	tick := flag.Duration("tick", 5*time.Second, "real tick interval")
	flag.Parse()

	if *speed != 1 && *speed != 3 && *speed != 10 {
		fmt.Fprintln(os.Stderr, "speed must be 1, 3, or 10")
		os.Exit(2)
	}
	track, err := loadTrack(*gpx, *city)
	if err != nil {
		fmt.Fprintln(os.Stderr, "track:", err)
		os.Exit(2)
	}
	api := &client{base: *base, http: &http.Client{Timeout: 20 * time.Second}}

	bots := []*bot{}
	for i := 0; i < *nbots; i++ {
		mode := "runner"
		email := fmt.Sprintf("bot-runner-%d@Trackfud.local", i+1)
		if i%2 == 1 {
			mode = "biker"
			email = fmt.Sprintf("bot-biker-%d@Trackfud.local", i+1)
		}
		b := &bot{api: api, email: email, mode: mode, acceptP: *accept,
			speed: *speed, track: track, seg: rand.Intn(len(track)), frac: rand.Float64()}
		if err := b.login(); err != nil {
			fmt.Fprintln(os.Stderr, "login", email, err)
			os.Exit(2)
		}
		if err := b.startSession(); err != nil {
			fmt.Fprintln(os.Stderr, "session", email, err)
			os.Exit(2)
		}
		bots = append(bots, b)
		fmt.Printf("bot %s (%s) online\n", email, mode)
	}

	interval := time.Duration(float64(*tick) / *speed)
	if interval < 200*time.Millisecond {
		interval = 200 * time.Millisecond
	}
	for n := 0; *rounds == 0 || n < *rounds; n++ {
		for _, b := range bots {
			if err := b.step(time.Duration(*speed) * *tick); err != nil {
				fmt.Fprintln(os.Stderr, "bot", b.email, err)
			}
		}
		if *merchant {
			autoMerchant(api)
		}
		time.Sleep(interval)
	}
}

// ---------- HTTP client ----------

type client struct {
	base string
	http *http.Client
}

func (c *client) do(token, method, path string, body any, out any) (int, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, rdr)
	if err != nil {
		return 0, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("X-TF-App", "courier")
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if out != nil && len(b) > 0 {
		_ = json.Unmarshal(b, out)
	}
	return resp.StatusCode, nil
}

func loginAs(api *client, email, app string) (string, error) {
	var out struct {
		AccessToken string `json:"access_token"`
	}
	code, err := api.do("", "POST", "/v1/auth/login",
		map[string]any{"email": email, "password": "DemoPass123!", "app": app}, &out)
	if err != nil || code >= 300 || out.AccessToken == "" {
		return "", fmt.Errorf("login %s: code=%d err=%v", email, code, err)
	}
	return out.AccessToken, nil
}

// ---------- tracks ----------

// loadTrack reads a GPX file or builds a city loop around demo merchants.
func loadTrack(gpxPath, city string) ([]pt, error) {
	if gpxPath != "" {
		return parseGPX(gpxPath)
	}
	var center pt
	switch city {
	case "london":
		center = pt{51.5055, -0.0910}
	default:
		center = pt{-6.2088, 106.8456}
	}
	track := make([]pt, 0, 24)
	for i := 0; i < 24; i++ {
		a := 2 * math.Pi * float64(i) / 24
		// ~600 m loop with a wobble so it looks run, not drawn.
		r := 0.0055 * (1 + 0.15*math.Sin(3*a))
		track = append(track, pt{center.lat + r*math.Cos(a), center.lng + r*math.Sin(a)})
	}
	return track, nil
}

func parseGPX(path string) ([]pt, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc struct {
		Trk []struct {
			Seg []struct {
				Pt []struct {
					Lat float64 `xml:"lat,attr"`
					Lon float64 `xml:"lon,attr"`
				} `xml:"trkpt"`
			} `xml:"trkseg"`
		} `xml:"trk"`
	}
	if err := xml.Unmarshal(b, &doc); err != nil {
		return nil, err
	}
	var track []pt
	for _, t := range doc.Trk {
		for _, s := range t.Seg {
			for _, p := range s.Pt {
				track = append(track, pt{p.Lat, p.Lon})
			}
		}
	}
	if len(track) < 2 {
		return nil, fmt.Errorf("no trkpt points in %s", path)
	}
	return track, nil
}

// ---------- bot ----------

type bot struct {
	api     *client
	email   string
	mode    string
	token   string
	session string
	acceptP float64
	speed   float64
	track   []pt
	seg     int
	frac    float64
	lat     float64
	lng     float64
}

func (b *bot) login() error {
	tok, err := loginAs(b.api, b.email, "courier")
	if err != nil {
		return err
	}
	b.token = tok
	return nil
}

func (b *bot) startSession() error {
	var out struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
	}
	goal := 5000.0
	if b.mode == "biker" {
		goal = 12000.0
	}
	code, err := b.api.do(b.token, "POST", "/v1/courier/sessions",
		map[string]any{"kind": "work", "mode": b.mode, "goal_distance_m": goal}, &out)
	if err != nil || code >= 300 {
		return fmt.Errorf("start session: code=%d err=%v", code, err)
	}
	b.session = out.Session.ID
	p := b.pos()
	b.lat, b.lng = p.lat, p.lng
	return nil
}

// planSpeed is the mode planning speed with ±15% noise (m/s).
func (b *bot) planSpeed() float64 {
	base := 2.5 // runner 9 km/h
	if b.mode == "biker" {
		base = 4.4 // biker 16 km/h
	}
	return base * (0.85 + 0.3*rand.Float64())
}

func (b *bot) pos() pt {
	a := b.track[b.seg%len(b.track)]
	c := b.track[(b.seg+1)%len(b.track)]
	return pt{a.lat + (c.lat-a.lat)*b.frac, a.lng + (c.lng-a.lng)*b.frac}
}

func moveToward(from pt, to pt, meters float64) (pt, float64) {
	dLat := (to.lat - from.lat) * 111320
	dLng := (to.lng - from.lng) * 111320 * math.Cos(from.lat*math.Pi/180)
	dist := math.Hypot(dLat, dLng)
	if dist <= meters || dist == 0 {
		return to, 0
	}
	k := meters / dist
	return pt{from.lat + (to.lat-from.lat)*k, from.lng + (to.lng-from.lng)*k}, dist - meters
}

func (b *bot) step(simDt time.Duration) error {
	// Active delivery first: walk the handover state machine.
	if d := b.activeDelivery(); d != nil {
		return b.driveDelivery(d, simDt)
	}
	// Cruise the loop, then check for offers.
	b.advance(simDt)
	b.postLocation()
	b.checkOffers()
	return nil
}

func (b *bot) advance(simDt time.Duration) {
	a := b.track[b.seg%len(b.track)]
	c := b.track[(b.seg+1)%len(b.track)]
	segLen := math.Hypot((c.lat-a.lat)*111320, (c.lng-a.lng)*111320*math.Cos(a.lat*math.Pi/180))
	step := b.planSpeed() * simDt.Seconds()
	b.frac += step / segLen
	for b.frac >= 1 {
		b.frac -= 1
		b.seg = (b.seg + 1) % len(b.track)
	}
	p := b.pos()
	b.lat, b.lng = p.lat, p.lng
}

func (b *bot) postLocation() {
	acc := 8.0
	_, _ = b.api.do(b.token, "POST", "/v1/courier/locations", map[string]any{
		"session_id": b.session,
		"points": []map[string]any{
			{"ts": time.Now().UTC().Format(time.RFC3339), "lat": b.lat, "lng": b.lng, "acc": acc},
		},
	}, nil)
}

func (b *bot) checkOffers() {
	var out struct {
		Offers []struct {
			ID string `json:"id"`
		} `json:"offers"`
	}
	code, err := b.api.do(b.token, "GET", "/v1/courier/offers", nil, &out)
	if err != nil || code >= 300 || len(out.Offers) == 0 {
		return
	}
	if rand.Float64() > b.acceptP {
		_, _ = b.api.do(b.token, "POST", "/v1/courier/offers/"+out.Offers[0].ID+"/decline", nil, nil)
		return
	}
	var acc struct {
		Delivery map[string]any `json:"delivery"`
	}
	if code, _ := b.api.do(b.token, "POST", "/v1/courier/offers/"+out.Offers[0].ID+"/accept", nil, &acc); code == 200 {
		fmt.Printf("bot %s accepted an offer\n", b.email)
	}
}

type delivery struct {
	ID          string `json:"id"`
	Status      string `json:"status"`
	OrderStatus string `json:"order_status"`
	Pickup      pt
	Dropoff     pt
}

func (b *bot) activeDelivery() *delivery {
	var out struct {
		Delivery struct {
			ID          string `json:"id"`
			Status      string `json:"status"`
			OrderStatus string `json:"order_status"`
			Pickup      *struct {
				Lat float64 `json:"lat"`
				Lng float64 `json:"lng"`
			} `json:"pickup"`
			Dropoff *struct {
				Lat float64 `json:"lat"`
				Lng float64 `json:"lng"`
			} `json:"dropoff"`
		} `json:"delivery"`
	}
	if code, err := b.api.do(b.token, "GET", "/v1/courier/deliveries/active", nil, &out); err != nil || code >= 300 {
		return nil
	}
	if out.Delivery.ID == "" {
		return nil
	}
	d := &delivery{ID: out.Delivery.ID, Status: out.Delivery.Status, OrderStatus: out.Delivery.OrderStatus}
	if out.Delivery.Pickup != nil {
		d.Pickup = pt{out.Delivery.Pickup.Lat, out.Delivery.Pickup.Lng}
	}
	if out.Delivery.Dropoff != nil {
		d.Dropoff = pt{out.Delivery.Dropoff.Lat, out.Delivery.Dropoff.Lng}
	}
	return d
}

func (b *bot) codes(id string) (pickup, pin string) {
	var out struct {
		PickupCode  string `json:"pickup_code"`
		DeliveryPin string `json:"delivery_pin"`
	}
	_, _ = b.api.do(b.token, "GET", "/v1/dev/deliveries/"+id+"/codes", nil, &out)
	return out.PickupCode, out.DeliveryPin
}

func (b *bot) driveDelivery(d *delivery, simDt time.Duration) error {
	target := d.Pickup
	if d.Status == "picked_up" || d.Status == "at_dropoff" {
		target = d.Dropoff
	}
	p, left := moveToward(pt{b.lat, b.lng}, target, b.planSpeed()*simDt.Seconds())
	b.lat, b.lng = p.lat, p.lng
	b.postLocation()
	if left > 60 {
		return nil
	}
	switch d.Status {
	case "assigned":
		_, _ = b.api.do(b.token, "POST", "/v1/courier/deliveries/"+d.ID+"/arrived", map[string]any{"at": "pickup"}, nil)
		if d.OrderStatus == "ready" || d.OrderStatus == "picked_up" {
			code, _ := b.codes(d.ID)
			if code != "" {
				_, _ = b.api.do(b.token, "POST", "/v1/courier/deliveries/"+d.ID+"/pickup", map[string]any{"pickup_code": code}, nil)
			}
		}
	case "at_pickup":
		if d.OrderStatus == "ready" || d.OrderStatus == "picked_up" {
			code, _ := b.codes(d.ID)
			if code != "" {
				_, _ = b.api.do(b.token, "POST", "/v1/courier/deliveries/"+d.ID+"/pickup", map[string]any{"pickup_code": code}, nil)
			}
		}
	case "picked_up":
		_, _ = b.api.do(b.token, "POST", "/v1/courier/deliveries/"+d.ID+"/arrived", map[string]any{"at": "dropoff"}, nil)
	case "at_dropoff":
		_, pin := b.codes(d.ID)
		if pin != "" {
			if code, _ := b.api.do(b.token, "POST", "/v1/courier/deliveries/"+d.ID+"/delivered", map[string]any{"pin": pin}, nil); code == 200 {
				fmt.Printf("bot %s delivered\n", b.email)
			}
		}
	}
	return nil
}

// ---------- bot merchant ----------

var merchantToken string

// autoMerchant accepts placed orders and readies accepted ones so the loop
// runs unattended. One demo merchant owns the seeded stores.
func autoMerchant(api *client) {
	if merchantToken == "" {
		tok, err := loginAs(api, "demo-merchant@Trackfud.local", "merchant")
		if err != nil {
			return
		}
		merchantToken = tok
	}
	var out struct {
		Orders []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"orders"`
	}
	if code, err := api.do(merchantToken, "GET", "/v1/merchant/orders", nil, &out); err != nil || code >= 300 {
		return
	}
	for _, o := range out.Orders {
		switch o.Status {
		case "placed":
			_, _ = api.do(merchantToken, "POST", "/v1/merchant/orders/"+o.ID+"/accept", map[string]any{}, nil)
		case "accepted":
			_, _ = api.do(merchantToken, "POST", "/v1/merchant/orders/"+o.ID+"/ready", map[string]any{}, nil)
		}
	}
}
