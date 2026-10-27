# Backend Architecture — Trackfud (Go)

> Backend system design for AI assistants. Product context: `docs/app-context.md`.
> Frontend: `docs/frontend-architecture.md`. Contract-first rule: the OpenAPI
> file `backend/api/openapi.yaml` is the source of truth — Go server interfaces
> (`oapi-codegen`) and TS clients (`openapi-typescript`) are generated from it.

## 1. Overview

Standalone Go API (one binary): REST under `/v1` + WebSocket hub + voice relay

- dispatch + River workers, on PostgreSQL 18 + PostGIS 3.6. Same transaction
  queues domain writes, ledger postings, and River jobs (`River InsertTx`), so
  nothing is lost on crash. One hostname with Caddy (`/api/` → Go); no CORS.

```
Caddy (TLS, 4 app paths + /api/ → Go)
  → Go API (one binary): REST · WS hub · voice relay · dispatch · River workers
      → PostgreSQL + PostGIS (data, ledger, GPS, River queue)
      → Cloudflare R2 (public bucket + private bucket)
      → Web Push (VAPID) · Brevo SMTP · Paddle sandbox (webhooks) · Meta Model API · Google Routes API
```

## 2. Module layout (mirrors `AGENTS.md` §14)

```
backend/
  cmd/api/            # main server (also runs River workers)
  cmd/simulator/      # demo bots: couriers on GPX tracks, auto-merchants
  internal/
    config/           # koanf YAML+env, per-country overrides via platform_settings
    auth/             # signup/login/refresh, JWT (15 min, in-memory), per-app cookies, RBAC
    platform/         # settings + feature flags
    courier/          # applications, fitness-test evaluation, sanctions
    tracking/         # sessions, GPS ingest, stats, anti-cheat signals
    dispatch/         # PostGIS candidates, scoring, cascade, atomic accept, timeouts
    order/            # Transition() state machine + order_events
    merchant/ menu/   # merchants, agreements, staff, menu CRUD, Snap-a-Menu import job
    ledger/           # double-entry journal + balances (SUM=0 per entry+currency)
    payment/          # PaymentProvider (paddle + mock), top-ups, webhook verify
    payout/           # PayoutProvider (mock), withdrawals
    ai/               # client, prompts, schemas, tools: copilot, menu, brief, moderation
    realtime/         # WebSocket hub, voice relay, topic subscribe + authz
    notify/           # web push (VAPID), email templates per language (Brevo/Mailpit)
    storage/          # R2 presign (public/private buckets)
    maps/             # Google Routes API (WALK/BICYCLE + beta warning)
    admin/            # RBAC, audit log, dashboard, demo controls
    httpapi/          # router, middleware, handlers generated from OpenAPI
  db/migrations/      # goose migrations (PostGIS, GiST/BRIN indexes per AGENTS.md §15.3)
  db/queries/         # sqlc queries (pgx v5)
  db/seed/            # Jakarta + London demo data
  api/openapi.yaml    # THE contract → Go server + TS client
  config.yaml         # defaults: tests, fees, dispatch, health, tracking, AI models
  Containerfile       # multi-stage → distroless static
```

## 3. Dependency Injection pattern (mandatory)

- Constructor injection only. Each domain package exposes a `Service` (or
  `Store`) struct whose dependencies are interfaces, plus a `New(...)`
  constructor. No globals, no package-level DB handles, no `init()` wiring.
- Wire graph is built once in `cmd/api/main.go` (or a small `internal/wire/`
  builder): `config → pgx pool → stores → services → workers → httpapi router`.
  Handlers receive services, never construct them.
- Define narrow interfaces at the consumer (`ledger.Poster`, `notify.Sender`,
  `payment.Provider`), implement in the provider package. Keeps Paddle/mock,
  Brevo/Mailpit, R2/local swappable for tests.
- Request-scoped values (user, roles, `X-TB-App`) travel in `context.Context`
  via middleware, never as extra function params through domain layers.

```go
// Service depends on interfaces, not concretes.
type Service struct { orders Store; ledger LedgerPoster; jobs JobEnqueuer }

func New(s Store, l LedgerPoster, j JobEnqueuer) *Service {
    return &Service{orders: s, ledger: l, jobs: j}
}
```

## 4. Request flow rules

- `httpapi` layer: auth → RBAC → validation → exactly one `Service` call → RFC
  9457 `application/problem+json` on error. Handlers contain no SQL and no
  business math.
- State changes: single `Transition(ctx, tx, ...)` with
  `UPDATE ... WHERE status=from`; on 0 rows return a typed conflict error.
  Same tx: domain write + `order_events` row + ledger postings + `River InsertTx`
  jobs. Broadcast on the WS hub only after commit.
- Money: integer minor units + currency code, never floats. Balances cached per
  account, updated in-tx, `CHECK (balance_minor >= 0)` for wallets.
  `idempotency_key UNIQUE` on journal entries, payments, and order/top-up/
  withdrawal endpoints (`Idempotency-Key` header).
- Timeouts/scheduled work are River jobs, never goroutine timers:
  `offer_expire`, `search_timeout`, `staff_timeout`, `merchant_accept_timeout`,
  `leave_now_nudge`, `auto_complete`, AI jobs, `push_send`, `email_send`,
  `payout_process`, `session_finalize`, retention/backup.
- WS hub is in-memory in the single process (Postgres `LISTEN/NOTIFY` only if a
  second instance is ever added). Courier GPS: `loc.batch` → validate
  (accuracy ≤ 30 m, speed caps) → store raw points → update session stats.
- Uploads: `POST /v1/files/presign` (fixed content-type, size cap, 5-min
  expiry, per-user key prefix) → direct PUT to R2 → record in `files`.
  Private bucket only via 5-min presigned GET; ID numbers AES-GCM encrypted;
  every admin KYC view → `audit_logs`.
- AI calls go through `internal/ai` with prompt versions, JSON-schema
  validation, and an `ai_calls` row (feature, model, latency, tokens, cost);
  humans review AI output (prices, bans) — AI never publishes or bans alone.

## 5. Testing contract

Unit (`go test`): all allowed/forbidden transitions, ledger balance +
idempotency (same webhook twice → paid once), fee math/rounding per currency,
dispatch filters/scoring, anti-cheat on recorded tracks, Paddle signature
check, AI schema validation incl. bad output. Integration: real PostGIS in
Podman (`make test-db`). E2E: Playwright 3-context golden path.

## 6. Api Conventions

always seperate between Clients and Admins API with versioning. clients here means the users merchants , couriers (runner/biker), customers and the admin is the backend admin who can manage the system.
