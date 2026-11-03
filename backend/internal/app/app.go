// Package app wires the Trackfud HTTP API (Milestone B0+B1).
package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"Trackfud/internal/authjwt"
	"Trackfud/internal/config"
	"Trackfud/internal/storage"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
)

// Server holds dependencies (constructor injection).
type Server struct {
	cfg  *config.Config
	db   *pgxpool.Pool
	log  *slog.Logger
	hub  *Hub
	ai   *AIService
	st   storage.Store
	rq   *river.Client[pgx.Tx]
	rlMu sync.Mutex
	rl   map[string][]time.Time
}

// New builds a Server. The River client is built here (no I/O); call
// StartWorker to run it. A nil db (unit tests) leaves rq unset and enqueue
// helpers refuse loudly instead of panicking.
func New(cfg *config.Config, db *pgxpool.Pool, log *slog.Logger) *Server {
	s := &Server{cfg: cfg, db: db, log: log, hub: NewHub(), ai: newAIService(aiConfigOf(cfg)), st: storage.New(cfg), rl: map[string][]time.Time{}}
	if db != nil {
		if err := s.initRiver(); err != nil {
			log.Warn("river init failed (jobs disabled)", "err", err)
		}
	}
	return s
}

// Hub returns the websocket hub.
func (s *Server) Hub() *Hub { return s.hub }

// Migrate applies embedded goose-style migrations (Up sections only).
func Migrate(ctx context.Context, db *pgxpool.Pool, dir string) error {
	if _, err := db.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	entries, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil {
		return err
	}
	for i, f := range entries {
		ver := i + 1
		var n int
		_ = db.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version=$1`, ver).Scan(&n)
		if n > 0 {
			continue
		}
		b, err := os.ReadFile(f)
		if err != nil {
			return err
		}
		up := string(b)
		if idx := strings.Index(up, "-- +goose Down"); idx >= 0 {
			up = up[:idx]
		}
		up = strings.ReplaceAll(up, "-- +goose Up", "")
		// split on goose StatementBegin/End not used; execute whole block
		if _, err := db.Exec(ctx, up); err != nil {
			return fmt.Errorf("migration %s: %w", f, err)
		}
		if _, err := db.Exec(ctx, `INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING`, ver); err != nil {
			return err
		}
	}
	// River's own tables (river_job et al.) for the background workers.
	if err := migrateRiver(ctx, db); err != nil {
		return err
	}
	return nil
}

// Routes builds the HTTP handler.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /v1/config/public", s.publicConfig)
	mux.HandleFunc("POST /v1/auth/signup", s.rate(s.signup))
	mux.HandleFunc("POST /v1/auth/login", s.rate(s.login))
	mux.HandleFunc("POST /v1/auth/refresh", s.rate(s.refresh))
	mux.HandleFunc("POST /v1/auth/logout", s.auth(s.logout))
	mux.HandleFunc("POST /v1/auth/demo-login", s.rate(s.demoLogin))
	mux.HandleFunc("POST /v1/auth/verify-email", s.rate(s.verifyEmail))
	mux.HandleFunc("GET /v1/auth/me", s.auth(s.me))
	mux.HandleFunc("POST /v1/files/presign", s.auth(s.presign))
	mux.HandleFunc("PUT /v1/files/local/{id}", s.localUpload)
	mux.HandleFunc("POST /v1/files/{id}/complete", s.auth(s.completeUpload))
	mux.HandleFunc("GET /v1/files/{id}/content", s.fileContent)
	mux.HandleFunc("GET /v1/push/vapid-public-key", s.vapidKey)
	mux.HandleFunc("POST /v1/push/subscribe", s.auth(s.pushSubscribe))
	mux.HandleFunc("DELETE /v1/push/subscribe", s.auth(s.pushUnsubscribe))
	mux.HandleFunc("POST /v1/push/test", s.auth(s.pushTest))
	mux.HandleFunc("POST /v1/ws/ticket", s.auth(s.wsTicket))
	mux.HandleFunc("GET /v1/ws", s.wsConnect)
	mux.HandleFunc("GET /v1/customer/restaurants", s.listRestaurants)
	mux.HandleFunc("GET /v1/customer/categories", s.listCustomerCategories)
	mux.HandleFunc("GET /v1/customer/restaurants/{id}", s.getRestaurant)
	mux.HandleFunc("GET /v1/customer/restaurants/{id}/menu", s.getMenu)
	mux.HandleFunc("GET /v1/customer/addresses", s.auth(s.listAddresses))
	mux.HandleFunc("POST /v1/customer/addresses", s.auth(s.createAddress))
	mux.HandleFunc("PATCH /v1/customer/addresses/{id}", s.auth(s.updateAddress))
	mux.HandleFunc("DELETE /v1/customer/addresses/{id}", s.auth(s.deleteAddress))
	mux.HandleFunc("POST /v1/customer/addresses/{id}/default", s.auth(s.setDefaultAddress))
	mux.HandleFunc("GET /v1/courier/application", s.auth(s.getApplication))
	mux.HandleFunc("PUT /v1/courier/application", s.auth(s.saveApplication))
	mux.HandleFunc("POST /v1/courier/application/submit", s.auth(s.submitApplication))
	mux.HandleFunc("POST /v1/courier/fitness-test", s.auth(s.submitFitness))
	mux.HandleFunc("GET /v1/courier/profile", s.auth(s.getProfile))
	mux.HandleFunc("PUT /v1/courier/profile", s.auth(s.saveProfile))
	mux.HandleFunc("POST /v1/courier/sessions", s.auth(s.startSession))
	mux.HandleFunc("GET /v1/courier/sessions", s.auth(s.listSessions))
	mux.HandleFunc("GET /v1/courier/sessions/{id}", s.auth(s.getSession))
	mux.HandleFunc("POST /v1/courier/sessions/{id}/end", s.auth(s.endSession))
	mux.HandleFunc("POST /v1/courier/sessions/{id}/checkpoints", s.auth(s.postCheckpoint))
	mux.HandleFunc("POST /v1/courier/locations", s.auth(s.ingestLocations))
	mux.HandleFunc("GET /v1/courier/stats", s.auth(s.courierStats))
	mux.HandleFunc("GET /v1/courier/offers", s.auth(s.listOffers))
	mux.HandleFunc("POST /v1/courier/offers/{id}/accept", s.auth(s.acceptOffer))
	mux.HandleFunc("POST /v1/courier/offers/{id}/decline", s.auth(s.declineOffer))
	mux.HandleFunc("GET /v1/courier/deliveries/active", s.auth(s.activeDelivery))
	mux.HandleFunc("GET /v1/courier/deliveries/{id}", s.auth(s.getDelivery))
	mux.HandleFunc("POST /v1/courier/deliveries/{id}/arrived", s.auth(s.arrivedDelivery))
	mux.HandleFunc("POST /v1/courier/deliveries/{id}/pickup", s.auth(s.pickupDelivery))
	mux.HandleFunc("POST /v1/courier/deliveries/{id}/delivered", s.auth(s.deliveredDelivery))
	mux.HandleFunc("GET /v1/courier/deliveries/{id}/messages", s.auth(s.listCourierMessages))
	mux.HandleFunc("POST /v1/courier/deliveries/{id}/messages", s.auth(s.postCourierMessage))
	mux.HandleFunc("POST /v1/courier/staff/shift", s.auth(s.staffShift))
	mux.HandleFunc("GET /v1/courier/staff/memberships", s.auth(s.listMemberships))
	mux.HandleFunc("GET /v1/courier/staff/offers", s.auth(s.listStaffOffers))
	mux.HandleFunc("POST /v1/courier/staff/offers/{id}/accept", s.auth(s.acceptStaffOffer))
	mux.HandleFunc("POST /v1/customer/orders/{id}/delivery-choice", s.auth(s.deliveryChoice))
	mux.HandleFunc("POST /v1/customer/orders/{id}/ratings", s.auth(s.rateOrder))
	mux.HandleFunc("POST /v1/customer/orders/{id}/cheers", s.auth(s.cheerOrder))
	mux.HandleFunc("GET /v1/customer/orders/{id}/messages", s.auth(s.listCustomerMessages))
	mux.HandleFunc("POST /v1/customer/orders/{id}/messages", s.auth(s.postCustomerMessage))
	mux.HandleFunc("GET /v1/customer/impact", s.auth(s.customerImpact))
	mux.HandleFunc("GET /v1/admin/courier-applications", s.auth(s.listApplications))
	mux.HandleFunc("POST /v1/admin/courier-applications/{user_id}/approve", s.auth(func(w http.ResponseWriter, r *http.Request) { s.decideApplication(w, r, true) }))
	mux.HandleFunc("POST /v1/admin/courier-applications/{user_id}/reject", s.auth(func(w http.ResponseWriter, r *http.Request) { s.decideApplication(w, r, false) }))
	mux.HandleFunc("GET /v1/admin/courier-applications/{user_id}", s.auth(s.getApplicationDetail))
	mux.HandleFunc("GET /v1/admin/merchants", s.auth(s.listMerchants))
	mux.HandleFunc("GET /v1/admin/merchants/{id}", s.auth(s.getMerchantDetail))
	mux.HandleFunc("POST /v1/admin/merchants/{id}/approve", s.auth(func(w http.ResponseWriter, r *http.Request) { s.decideMerchant(w, r, true) }))
	mux.HandleFunc("POST /v1/admin/merchants/{id}/reject", s.auth(func(w http.ResponseWriter, r *http.Request) { s.decideMerchant(w, r, false) }))
	mux.HandleFunc("GET /v1/admin/merchants/{id}/sanctions", s.auth(s.listMerchantSanctions))
	mux.HandleFunc("POST /v1/admin/merchants/{id}/sanctions", s.auth(s.sanctionMerchant))
	mux.HandleFunc("GET /v1/admin/couriers/{user_id}/sanctions", s.auth(s.listSanctions))
	mux.HandleFunc("POST /v1/admin/couriers/{user_id}/sanctions", s.auth(s.sanctionCourier))
	mux.HandleFunc("GET /v1/admin/orders", s.auth(s.listAdminOrders))
	mux.HandleFunc("GET /v1/admin/orders/{id}", s.auth(s.getAdminOrder))
	mux.HandleFunc("POST /v1/admin/orders/{id}/refund", s.auth(s.refundAdminOrder))
	mux.HandleFunc("POST /v1/merchant/merchants", s.auth(s.createMerchant))
	mux.HandleFunc("GET /v1/merchant/merchants/me", s.auth(s.myMerchant))
	mux.HandleFunc("PATCH /v1/merchant/merchants/me", s.auth(s.updateMerchant))
	mux.HandleFunc("GET /v1/merchant/agreement/current", s.currentAgreement)
	mux.HandleFunc("GET /v1/merchant/merchants/me/agreement", s.auth(s.getMyAgreement))
	mux.HandleFunc("POST /v1/merchant/merchants/me/agreement", s.auth(s.signAgreement))
	mux.HandleFunc("GET /v1/merchant/earnings", s.auth(s.getMerchantEarnings))
	mux.HandleFunc("GET /v1/merchant/staff", s.auth(s.listStaff))
	mux.HandleFunc("POST /v1/merchant/staff/invite", s.auth(s.inviteStaff))
	mux.HandleFunc("PATCH /v1/merchant/staff/{id}", s.auth(s.updateStaff))
	mux.HandleFunc("GET /v1/merchant/menu/categories", s.auth(s.listCategories))
	mux.HandleFunc("POST /v1/merchant/menu/categories", s.auth(s.createCategory))
	mux.HandleFunc("PATCH /v1/merchant/menu/categories/{id}", s.auth(s.updateCategory))
	mux.HandleFunc("DELETE /v1/merchant/menu/categories/{id}", s.auth(s.deleteCategory))
	mux.HandleFunc("GET /v1/merchant/menu/items", s.auth(s.listMenuItems))
	mux.HandleFunc("POST /v1/merchant/menu/items", s.auth(s.createMenuItem))
	mux.HandleFunc("PATCH /v1/merchant/menu/items/{id}", s.auth(s.updateMenuItem))
	mux.HandleFunc("DELETE /v1/merchant/menu/items/{id}", s.auth(s.deleteMenuItem))
	mux.HandleFunc("POST /v1/customer/orders", s.auth(s.createOrder))
	mux.HandleFunc("GET /v1/customer/orders", s.auth(s.listCustomerOrders))
	mux.HandleFunc("GET /v1/customer/orders/{id}", s.auth(s.getOrder))
	mux.HandleFunc("POST /v1/customer/orders/{id}/cancel", s.auth(s.cancelOrder))
	mux.HandleFunc("GET /v1/customer/wallet", s.auth(s.getWallet))
	mux.HandleFunc("POST /v1/customer/wallet/topups", s.auth(s.createTopup))
	mux.HandleFunc("GET /v1/customer/wallet/topups", s.auth(s.listTopups))
	mux.HandleFunc("POST /v1/customer/payments/{id}/checkout", s.auth(s.createPaymentCheckout))
	mux.HandleFunc("GET /v1/customer/payments/{id}", s.auth(s.getPayment))
	mux.HandleFunc("POST /v1/webhooks/paddle", s.rate(s.paddleWebhook))
	mux.HandleFunc("GET /v1/courier/earnings", s.auth(s.getEarnings))
	mux.HandleFunc("POST /v1/courier/withdrawals", s.auth(s.createWithdrawal))
	mux.HandleFunc("GET /v1/courier/withdrawals", s.auth(s.listWithdrawals))
	mux.HandleFunc("GET /v1/courier/deliveries/history", s.auth(s.listDeliveryHistory))
	mux.HandleFunc("GET /v1/admin/withdrawals", s.auth(s.listAdminWithdrawals))
	mux.HandleFunc("POST /v1/admin/withdrawals/{id}/hold", s.auth(s.holdWithdrawal))
	mux.HandleFunc("POST /v1/admin/withdrawals/{id}/release", s.auth(s.releaseWithdrawal))
	mux.HandleFunc("POST /v1/dev/payments/{id}/simulate-paid", s.auth(s.simulatePaddlePaid))
	mux.HandleFunc("GET /v1/merchant/orders", s.auth(s.listMerchantOrders))
	mux.HandleFunc("GET /v1/merchant/orders/{id}", s.auth(s.getMerchantOrder))
	mux.HandleFunc("POST /v1/merchant/orders/{id}/accept", s.auth(s.acceptOrder))
	mux.HandleFunc("POST /v1/merchant/orders/{id}/reject", s.auth(s.rejectOrder))
	mux.HandleFunc("POST /v1/merchant/orders/{id}/ready", s.auth(s.readyOrder))
	mux.HandleFunc("POST /v1/merchant/orders/{id}/cancel", s.auth(s.cancelMerchantOrder))
	mux.HandleFunc("GET /v1/fx/currencies", s.auth(s.listCurrencies))
	mux.HandleFunc("GET /v1/fx/rate", s.auth(s.getFxRate))
	mux.HandleFunc("GET /v1/fx/payout-info", s.auth(s.payoutInfo))
	mux.HandleFunc("GET /v1/dev/outbox", s.auth(s.devOutbox))
	// B6: AI + voice + demo controls.
	mux.HandleFunc("POST /v1/merchant/menu/import-jobs", s.auth(s.createImportJob))
	mux.HandleFunc("GET /v1/merchant/menu/import-jobs/{id}", s.auth(s.getImportJob))
	mux.HandleFunc("GET /v1/admin/courier-applications/{user_id}/trust-brief", s.auth(s.getTrustBrief))
	mux.HandleFunc("POST /v1/courier/deliveries/{id}/proof-checks", s.auth(s.postProofCheck))
	mux.HandleFunc("GET /v1/courier/deliveries/{id}/proof-checks", s.auth(s.listProofChecks))
	mux.HandleFunc("POST /v1/customer/orders/{id}/messages/translate", s.auth(s.translateCustomerMessage))
	mux.HandleFunc("POST /v1/courier/deliveries/{id}/messages/translate", s.auth(s.translateCourierMessage))
	mux.HandleFunc("GET /v1/courier/coach/weekly", s.auth(s.coachWeekly))
	mux.HandleFunc("GET /v1/courier/run-plans/hotspots", s.auth(s.listHotspots))
	mux.HandleFunc("POST /v1/courier/run-plans", s.auth(s.createRunPlans))
	mux.HandleFunc("GET /v1/courier/voice", s.voiceConnect)
	mux.HandleFunc("POST /v1/courier/voice/confirm", s.auth(s.voiceConfirm))
	mux.HandleFunc("GET /v1/admin/demo/state", s.auth(s.demoState))
	mux.HandleFunc("POST /v1/admin/demo/bots/start", s.auth(s.demoBotsStart))
	mux.HandleFunc("POST /v1/admin/demo/bots/stop", s.auth(s.demoBotsStop))
	mux.HandleFunc("POST /v1/admin/demo/force-no-courier", s.auth(s.demoForceNoCourier))
	mux.HandleFunc("POST /v1/admin/demo/reset", s.auth(s.demoReset))
	mux.HandleFunc("GET /v1/dev/deliveries/{id}/codes", s.auth(s.devDeliveryCodes))
	mux.HandleFunc("GET /v1/dev/push-log", s.auth(s.devPushLog))
	// A9: platform controls (settings per country, audit log, AI usage, copilot).
	mux.HandleFunc("GET /v1/admin/settings", s.auth(s.getAdminSettings))
	mux.HandleFunc("PUT /v1/admin/settings", s.auth(s.putAdminSetting))
	mux.HandleFunc("GET /v1/admin/audit", s.auth(s.listAdminAudit))
	mux.HandleFunc("GET /v1/admin/ai/calls", s.auth(s.listAdminAICalls))
	mux.HandleFunc("GET /v1/admin/ai/summary", s.auth(s.adminAISummary))
	mux.HandleFunc("POST /v1/admin/copilot/ask", s.auth(s.copilotAsk))
	// A8: dashboard live map + numbers, courier performance (PLAN §4.4 P0).
	mux.HandleFunc("GET /v1/admin/dashboard", s.auth(s.getAdminDashboard))
	mux.HandleFunc("GET /v1/admin/couriers/{user_id}/performance", s.auth(s.getCourierPerformance))
	return s.withLog(mux)
}

func (s *Server) withLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Same-origin deployment: no CORS. Only reflect for local vite dev ports.
		w.Header().Set("Vary", "Origin")
		if o := r.Header.Get("Origin"); strings.HasPrefix(o, "http://localhost:") || strings.HasPrefix(o, "http://127.0.0.1:") {
			w.Header().Set("Access-Control-Allow-Origin", o)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-TF-App, Idempotency-Key")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"status": "ok", "demo_mode": s.cfg.Server.DemoMode})
}

func (s *Server) publicConfig(w http.ResponseWriter, r *http.Request) {
	// A9: ?country= merges that country's admin overrides (global always
	// applies), so the courier fitness screen, merchant fee display and the
	// customer promise always match what the CMS settings editor saved.
	country := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("country")))
	if len(country) != 2 || !isAlpha2(country) {
		country = ""
	}
	runnerD := s.effectiveQualTarget(r.Context(), "runner", country)
	runnerL := s.effectiveQualLimit(r.Context(), "runner", country)
	bikerD := s.effectiveQualTarget(r.Context(), "biker", country)
	bikerL := s.effectiveQualLimit(r.Context(), "biker", country)
	_, winMin, winMax := s.effectiveOrderWindows(r.Context(), country)
	goal := s.effectiveHealthGoal(r.Context(), country)
	writeJSON(w, 200, map[string]any{
		"demo_mode": s.cfg.Server.DemoMode,
		"country":   country,
		// Paddle publishables for the PWAs: the provider gate, the env the
		// dashboard app lives in, and the client token when configured (a public
		// key by design — never the webhook secret or API key). The PWA prefers
		// its build-time VITE_PADDLE_* vars and falls back to these so sandbox
		// vs production mismatches surface as a clear message, not a silent overlay fail.
		"payments": map[string]any{
			"provider":            s.cfg.Payments.Provider,
			"paddle_env":          s.cfg.PaddleEnv,
			"paddle_client_token": s.cfg.PaddleClientToken,
			"card_enabled":        s.cardPaymentsEnabled(),
		},
		"fitness": map[string]any{
			"runner_distance_m": runnerD, "runner_moving_limit_s": runnerL,
			"biker_distance_m": bikerD, "biker_moving_limit_s": bikerL,
			"elapsed_cap_multiplier": s.cfg.Fitness.ElapsedCapMultiplier,
		},
		"promise": map[string]any{"delivery_window_min_min": winMin, "delivery_window_max_min": winMax},
		"health":  map[string]any{"who_weekly_active_min": goal},
	})
}

// --- helpers ---
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func problem(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"type": "about:blank", "title": title, "status": status, "detail": detail})
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Body == nil {
		return true
	}
	defer r.Body.Close()
	// Cap JSON bodies: every contract body is small (largest is a menu
	// publish), so a 1 MiB reader stops giant-body resource abuse early.
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		problem(w, 400, "Bad request", "invalid JSON body")
		return false
	}
	return true
}

type ctxKey string

const userKey ctxKey = "user"

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			problem(w, 401, "Unauthorized", "missing bearer token")
			return
		}
		c, err := authjwt.Verify(s.cfg.JWTSecret, strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			problem(w, 401, "Unauthorized", "invalid or expired token")
			return
		}
		// Platform isolation (defense in depth): a token issued for one
		// platform cannot be replayed on another. Admins bypass so the CMS
		// (App=cms) can still call merchant/customer endpoints that
		// explicitly allow the admin role.
		if reqApp := normalizeApp(r.Header.Get("X-TF-App")); reqApp != "" {
			if tokApp := normalizeApp(c.App); tokApp != "" && reqApp != tokApp && !hasAdminRole(c.Roles) {
				problem(w, 403, "Forbidden", "token issued for the "+platformName(c.App)+" platform cannot be used on the "+platformName(reqApp)+" platform")
				return
			}
		}
		ctx := context.WithValue(r.Context(), userKey, c)
		next(w, r.WithContext(ctx))
	}
}

func claims(r *http.Request) *authjwt.Claims {
	c, _ := r.Context().Value(userKey).(*authjwt.Claims)
	return c
}

func requireRole(w http.ResponseWriter, r *http.Request, roles ...string) bool {
	c := claims(r)
	for _, have := range c.Roles {
		for _, want := range roles {
			if have == want {
				return true
			}
		}
	}
	problem(w, 403, "Forbidden", "role not allowed for this resource")
	return false
}

func (s *Server) rate(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip, _, _ := net.SplitHostPort(r.RemoteAddr)
		key := ip + ":" + r.URL.Path
		now := time.Now()
		s.rlMu.Lock()
		var kept []time.Time
		for _, t := range s.rl[key] {
			if now.Sub(t) < time.Minute {
				kept = append(kept, t)
			}
		}
		if len(kept) >= 30 {
			s.rlMu.Unlock()
			w.Header().Set("Retry-After", "60")
			problem(w, 429, "Too many requests", "rate limit exceeded, retry shortly")
			return
		}
		s.rl[key] = append(kept, now)
		// Bound the table: distinct IP+path keys accumulate over process
		// lifetime, so a very large table resets (limits briefly loosen).
		if len(s.rl) > 5000 {
			s.rl = map[string][]time.Time{}
		}
		s.rlMu.Unlock()
		next(w, r)
	}
}

func shaHex(s string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(s))) }

func appOf(r *http.Request, bodyApp string) string {
	if v := r.Header.Get("X-TF-App"); v != "" {
		return v
	}
	if bodyApp != "" {
		return bodyApp
	}
	return "customer"
}
