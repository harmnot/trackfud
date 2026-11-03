// Command simulator runs demo courier bots on routes (Milestone B6).
//
// Each bot signs in as a seeded courier, opens (or resumes) a work session,
// cruises its route with realistic GPS (varying accuracy, ±3 m jitter, no
// jump over 150 m, runner 2.3–3.2 m/s and biker 4.5–6.5 m/s at x1), answers
// offers per policy and walks the pickup → dropoff handover with the
// demo-only dev codes endpoint. An optional merchant loop auto-accepts and
// readies the demo stores' orders so judges get an unattended golden path.
// Speed x1/x3/x10 compresses time: ticks come faster and each covers that
// many times the real elapsed time.
//
// Routes: --routes (GeoJSON LineStrings, per-mode round-robin), else --gpx,
// else a loop around the --city demo merchants. Accounts: --accounts (JSON
// [{"email","mode"}]) or the --bots seeded demo bots. Password: --password,
// default from TF_SIM_PASSWORD, else the demo seed password.
//
// Usage:
//
//	go run ./cmd/simulator --bots 3 --speed 3
//	TF_SIM_PASSWORD=... go run ./cmd/simulator --accounts gbk.json \
//	  --routes gbk.geojson --offers ignore --deliveries ignore --auto-merchant=false
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// Defaults.
const (
	defaultBase     = "http://localhost:8000/api" // gateway; it strips /api
	passwordEnv     = "TF_SIM_PASSWORD"
	minTickInterval = 200 * time.Millisecond
	httpTimeout     = 20 * time.Second
)

// simConfig is the validated command line.
type simConfig struct {
	base         string
	bots         int
	accountsFile string
	password     string
	speed        float64
	acceptP      float64
	offers       offerPolicy
	drive        bool
	gpx          string
	routesFile   string
	city         string
	autoMerchant bool
	rounds       int
	tick         time.Duration
}

// parseFlags parses and validates args; usage and flag errors go to out.
// Password precedence: an explicit --password, then $TF_SIM_PASSWORD, then
// the demo seed password. It is resolved after parsing so usage output
// never echoes a password taken from the environment.
func parseFlags(args []string, getenv func(string) string, out io.Writer) (simConfig, error) {
	var c simConfig
	fs := flag.NewFlagSet("simulator", flag.ContinueOnError)
	fs.SetOutput(out)
	fs.StringVar(&c.base, "base", defaultBase, "API base URL (gateway /api prefix)")
	fs.IntVar(&c.bots, "bots", 3, "seeded demo bots (bot-runner/biker-N@Trackfud.local); ignored with --accounts")
	fs.StringVar(&c.accountsFile, "accounts", "", `JSON file [{"email","mode":"runner|biker"}] of seeded couriers to drive`)
	fs.StringVar(&c.password, "password", "", "courier password (default: $"+passwordEnv+", else the demo seed password)")
	fs.Float64Var(&c.speed, "speed", 1, "time scale: 1, 3, or 10")
	fs.Float64Var(&c.acceptP, "accept", 0.8, "offer accept probability 0..1 (when --offers is empty)")
	offers := fs.String("offers", "", "offer policy: accept|decline|ignore (empty: --accept probability)")
	deliveries := fs.String("deliveries", "drive", "active deliveries: drive|ignore (ignore keeps cruising the route)")
	fs.StringVar(&c.gpx, "gpx", "", "GPX track file (trkpt lat/lon), used when --routes is empty")
	fs.StringVar(&c.routesFile, "routes", "", "GeoJSON FeatureCollection of LineStrings (properties: mode runner|biker, loop bool)")
	fs.StringVar(&c.city, "city", "jakarta", "jakarta or london default loop (no --routes/--gpx)")
	fs.BoolVar(&c.autoMerchant, "auto-merchant", true, "auto-accept + ready the demo stores' orders ("+demoMerchantEmail+")")
	fs.IntVar(&c.rounds, "rounds", 0, "stop after N ticks (0 = run forever)")
	fs.DurationVar(&c.tick, "tick", 5*time.Second, "tick interval at x1")
	if err := fs.Parse(args); err != nil {
		return c, err
	}
	if c.password == "" {
		c.password = getenv(passwordEnv)
	}
	if c.password == "" {
		c.password = demoSeedPassword
	}
	var err error
	if c.offers, err = parseOfferPolicy(*offers); err != nil {
		return c, err
	}
	if c.drive, err = parseDeliveryPolicy(*deliveries); err != nil {
		return c, err
	}
	switch {
	case c.speed != 1 && c.speed != 3 && c.speed != 10:
		return c, errors.New("--speed must be 1, 3, or 10")
	case c.acceptP < 0 || c.acceptP > 1:
		return c, errors.New("--accept must be within 0..1")
	case c.accountsFile == "" && c.bots < 1:
		return c, errors.New("--bots must be at least 1")
	case c.tick <= 0:
		return c, errors.New("--tick must be positive")
	}
	return c, nil
}

// loadAccounts returns the --accounts file entries or the default bots.
func loadAccounts(c simConfig) ([]account, error) {
	if c.accountsFile == "" {
		return defaultAccounts(c.bots), nil
	}
	data, err := os.ReadFile(c.accountsFile)
	if err != nil {
		return nil, fmt.Errorf("accounts: %w", err)
	}
	return parseAccounts(data)
}

// loadRoutes picks the route source: --routes, else --gpx, else the city
// loop. GPX and city loops serve every mode and wrap end→start.
func loadRoutes(c simConfig) ([]*route, error) {
	switch {
	case c.routesFile != "":
		data, err := os.ReadFile(c.routesFile)
		if err != nil {
			return nil, fmt.Errorf("routes: %w", err)
		}
		return parseRoutes(data)
	case c.gpx != "":
		data, err := os.ReadFile(c.gpx)
		if err != nil {
			return nil, fmt.Errorf("gpx: %w", err)
		}
		pts, err := parseGPX(data)
		if err != nil {
			return nil, err
		}
		r, err := newRoute(filepath.Base(c.gpx), "", true, pts)
		if err != nil {
			return nil, fmt.Errorf("gpx: %w", err)
		}
		return []*route{r}, nil
	default:
		r, err := newRoute(c.city+"-loop", "", true, cityLoop(c.city))
		if err != nil {
			return nil, err
		}
		return []*route{r}, nil
	}
}

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	cfg, err := parseFlags(os.Args[1:], os.Getenv, os.Stderr)
	if errors.Is(err, flag.ErrHelp) {
		os.Exit(0)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "simulator:", err)
		os.Exit(2)
	}
	accts, err := loadAccounts(cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "simulator:", err)
		os.Exit(2)
	}
	routes, err := loadRoutes(cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "simulator:", err)
		os.Exit(2)
	}
	api := &client{base: cfg.base, http: &http.Client{Timeout: httpTimeout}}
	assigned := assignRoutes(accts, routes)
	bots := make([]*bot, 0, len(accts))
	for i, a := range accts {
		b := &bot{
			who: &actor{api: api, app: appCourier, email: a.Email, password: cfg.password},
			log: log, rng: rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), uint64(i)+1)),
			mode: a.Mode, route: assigned[i], scale: cfg.speed,
			offers: cfg.offers, acceptP: cfg.acceptP, drive: cfg.drive,
		}
		if err := b.start(time.Now()); err != nil {
			log.Warn("bot skipped", "email", a.Email, "err", err)
			continue
		}
		bots = append(bots, b)
		log.Info("bot online", "email", a.Email, "mode", a.Mode, "route", b.route.name, "session", b.session)
	}
	if len(bots) == 0 {
		fmt.Fprintln(os.Stderr, "simulator: no bot could sign in and start a session")
		os.Exit(2)
	}
	var merchant *autoMerchant
	if cfg.autoMerchant {
		merchant = &autoMerchant{log: log,
			who: &actor{api: api, app: appMerchant, email: demoMerchantEmail, password: demoSeedPassword}}
	}
	interval := max(time.Duration(float64(cfg.tick)/cfg.speed), minTickInterval)
	for n := 0; cfg.rounds == 0 || n < cfg.rounds; n++ {
		for _, b := range bots {
			b.step(time.Now())
		}
		if merchant != nil {
			merchant.tick()
		}
		time.Sleep(interval)
	}
}
