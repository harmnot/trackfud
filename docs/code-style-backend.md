# Code Style Guidelines — Backend (Go)

> Applies to `backend/`. Design: `docs/backend-architecture.md`.
> Product context: `docs/app-context.md`.

## Modules and DI

- One domain per package (`order`, `dispatch`, `ledger`, `courier`, …).
  No cross-domain SQL; call the owning package's `Service` instead.
- Constructor injection with narrow interfaces + `New(...)`. No globals, no
  `init()` wiring, no package-level DB pools. Wire once in `cmd/api/main.go`.
- Handlers (`httpapi`) are thin: auth → RBAC → validate → one service call →
  typed response. No SQL, no fee/distance math in handlers.

## Types and errors

- Safe types everywhere. Validate at the boundary (OpenAPI + service input
  structs); use concrete domain types inside. No `interface{}`/`any` payloads
  past validation.
- Typed sentinel/domain errors (`ErrConflict`, `ErrInsufficientBalance`, …)
  mapped to RFC 9457 responses in one place. Wrap with `%w`; every error is
  either handled, retried (River job), or returned — never silently dropped.
- Early returns and guard clauses. Flat control flow; no deep `if/else` nests.
- Max ~3 params; beyond that use an options struct
  (e.g. `DispatchSearch{...}`, `QuoteInput{...}`).
- `context.Context` is always the first parameter; respect cancellation in
  queries, R2/AI/Routes calls, and job workers.

## Data and money

- Money = integer minor units + currency; `bojanz/currency` for math. No floats.
- Distances meters, durations seconds, times UTC `timestamptz` (`ISO-8601` on wire).
- Coordinates as `geography(Point/LineString, 4326)`; geo math in PostGIS via
  `sqlc` queries, `twpayne/go-geom` only for polyline shaping.
- Migrations via `pressly/goose`, queries via `sqlc` + `pgx` — no inline SQL
  outside `db/queries/`.

## Concurrency and jobs

- No goroutine timers for business timeouts — River scheduled jobs only.
- The in-memory WS hub never owns authoritative state; the DB does. Broadcast
  after commit.
- Idempotency keys on orders, top-ups, withdrawals, journal entries, webhook
  events. Webhook handlers: verify signature → store `event_id` → process once.

## Security and logging

- Same-origin, no CORS. Short JWT in memory; per-app httpOnly refresh cookies
  (`X-TF-App`). RBAC on every route. Rate-limit auth/AI/presign.
- Secrets from env only, never committed. PII encrypted (AES-GCM); KYC views audited.
- Structured `log/slog` with request/job IDs. No `fmt.Println` debugging leftovers.
  No passwords, tokens, or ID numbers in logs.

## Docs and constants

- Doc comments on every exported symbol (what + params/returns/errors where
  non-obvious). Package comment explains the domain's responsibility.
- No magic numbers/strings: dispatch radii, fee bps, test distances, window
  minutes live in `config.yaml`/DB settings with named Go constants as fallback.
- `gofmt` + `go vet` clean; low-cardinality errors as package vars, dynamic
  detail via wrapping.
