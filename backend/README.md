# Trackfud — Backend (Go API)

One Go binary: REST `/v1` + WebSocket hub + voice relay + dispatch engine + River background workers. PostgreSQL 18 + PostGIS for geo, River for jobs, R2 for files, VAPID push, Brevo SMTP email, Paddle sandbox webhooks, Modal-hosted AI endpoint, Google Routes API for ETAs.

## Features

- **Contract + skeleton (B0):** `api/openapi.yaml` (94 `/v1` paths), koanf `config.yaml` defaults, JWT 15 min + per-app refresh cookies via `X-TF-App` + RBAC, `/healthz`, goose migrations, `Containerfile`.
- **Auth/users/files/notify (B1):** signup/login/refresh/logout/demo-login/verify-email, `files/presign` → R2 PUT (5-min, per-user prefix; public vs private buckets) → `files` row, push subscriptions + VAPID (env pair wins), Brevo/Mailpit email outbox, WS ticket + hub, fictional seed.
- **Merchant/catalog/orders/ledger (B2):** merchant profiles (geo `location`, hours, prep), versioned agreement e-sign + staff invites/roles, menu CRUD with `size_class`/`travels_well`, guarded `Transition()` state machine + `order_events` + timeout jobs + WS broadcast, double-entry ledger (integer minor units, `SUM=0`, idempotency, instant wallet refunds).
- **Courier onboarding/sessions/GPS (B3):** applications + autosave, config-driven fitness-test eval, WS `loc.batch` + HTTP fallback, session stats, approve/reject + email + push, sanctions tables, freeze/ban enforcement (no sessions, no dispatch).
- **Dispatch/delivery (B4):** PostGIS `DispatchCandidates` (corridor, to-pickup, trip, size filter), scoring + cascade, atomic accept (exactly one courier), offer/search/staff timeout jobs, food-ready courier wave, "leave now" nudge, pickup code + PIN/photo handover, settlement, 72 h auto-complete, Routes API ETA (WALK/BICYCLE + beta warning) with planning-speed fallback.
- **Money/social (B5):** Paddle sandbox top-up + direct pay (server-minted transactions, HMAC webhook + dedupe + idempotent ledger), IDR→USD charge conversion with full-IDR wallet credit (`fx_rates`), mock withdrawals + hold/release, staff fallback, no-courier choices, separate ratings, WHO minutes + impact aggregates. Sandbox only, never real rails.
- **AI/simulator/demo (B6):** `internal/ai` (menu import, translate, trust brief, proof check, feedback labels) via the Modal endpoint with offline fallbacks, voice relay + server-checked confirmations, `cmd/simulator` (GPX bots, scaling, demo controls, judge logins).
- **Security posture:** Argon2id passwords (bcrypt fallback + on-login upgrade), refresh rotation with reuse detection, Secure/HttpOnly/SameSite=Lax cookies, AES-GCM-sealed ID numbers (never returned), locked same-origin CORS, auth + webhook rate limits, HMAC webhooks + `webhook_events` dedupe, 1 MiB JSON body cap.
- **Platform controls (A9):** `GET/PUT /v1/admin/settings` (28-key allowlist, global + `country:XX` scopes), `GET /v1/admin/audit`, `GET /v1/admin/ai/calls` + `/summary`, `POST /v1/admin/copilot/ask` (fixed read-only tools, deterministic answers).

## Flow (order lifecycle)

```text
quote → pay (wallet idempotent / Paddle card) → placed
  → merchant accept (+prep) / reject · 3 min timeout → ready
  → courier cascade (searching → offered → assigned, atomic claim)
  → food-ready wave if unclaimed → pickup code → picked_up
  → customer PIN / photo → delivered → settled → completed (72 h auto)
```

No courier in 4 min → staff fallback → nobody in 3 min → customer chooses wait / pickup / full refund. Every transition appends `order_events` and broadcasts `order.status` over WS + push + email.

## Run locally

Easiest is the full stack from the repo root (`bash scripts/podman-up.sh` → API at http://localhost:8000/api/healthz). Backend-only:

```sh
# Postgres (PostGIS) via Podman
podman run -d --name tf-db -e POSTGRES_USER=Trackfud -e POSTGRES_PASSWORD=Trackfud \
  -e POSTGRES_DB=Trackfud -p 5432:5432 docker.io/postgis/postgis:18-3.6

cd backend
cp .env.example .env   # fill secrets; TF_DEMO_MODE=true keeps demo shortcuts on
go run ./cmd/api       # or: make run (listens :8080 by default)
```

Key env (full list in `.env.example`): `DATABASE_URL`, `TF_JWT_SECRET` (≥32 chars), `TF_DEMO_MODE`, `TF_VAPID_PUBLIC/PRIVATE_KEY` (generate with `npx -y web-push generate-vapid-keys`), `TF_PADDLE_*`, `TF_R2_*` (empty = local disk), `TF_MODAL_KEY`/`TF_MODAL_SECRET`, `TF_GOOGLE_MAPS_KEY`. Generate VAPID keys, don't hand-type them — random text fails boot with a clear error.

## Build

```sh
make build  # go build ./...
make vet    # go vet ./...
make test   # go test ./... (run touched domains at minimum before reporting done)
```

Production image via `Containerfile`. Config lives in `config.yaml` next to the binary (override path with `TF_CONFIG`); per-country tuning overrides without restart via `PUT /v1/admin/settings`. Never commit a filled `.env`.

## Related docs

- Contract: `api/openapi.yaml` · Plan: `AGENTS.md` · Architecture: `../docs/backend-architecture.md` · Seed logins: `../README.md`
