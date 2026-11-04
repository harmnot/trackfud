# Trackfud — Local Development Runbook

How to run the whole app on your machine, day to day. Pick one of three modes,
then use the workflows and troubleshooting tables below.

> Sources: `scripts/podman-up.sh`, `compose.yaml`, `gateway/Caddyfile`,
> `backend/.env.example`, `frontend-*/.env.example`. If this file ever
> disagrees with those files, the files win — fix this doc, not the code.

## 1. Pick your mode

| Mode | Command | Best when |
| ---- | ------- | --------- |
| **A. Full stack (recommended)** | `bash scripts/podman-up.sh` | You want everything (DB, backend, all 4 frontends, gateway, Mailpit) with one command. Needs Podman only — no compose provider. |
| **B. Compose** | `podman compose up --build` | You prefer compose semantics. Needs `podman-compose` installed. Same containers as mode A. |
| **C. Hybrid (backend local + frontend dev servers)** | DB in Podman + `go run` + `pnpm dev` per app | You are actively editing code and want hot reload. |

All three modes serve the same URLs (via the gateway in A/B, directly in C)
and seed the same demo data on every backend boot.

## 2. Prerequisites

- **Podman** (modes A/B, and the DB in mode C). No Docker daemon, no compose
  provider needed for mode A.
- **Go** (mode C, backend edits, or running backend tests). See `backend/go.mod`
  for the toolchain version.
- **Node + Corepack + pnpm** (mode C, or any frontend work):
  each `frontend-*` pins `pnpm@12.16.1` via `packageManager`, so
  `corepack pnpm install` / `corepack pnpm dev` just work.
- **Ports free:** `8000` (gateway), `8081` (backend direct), `5432` (Postgres),
  `8025`/`1025` (Mailpit UI/SMTP). All overridable — see §7.
- **Phone testing (optional):** real-device install/push/GPS checks still need
  a phone on the same network; nothing in this runbook fakes that.

## 3. First-time setup (all modes)

```bash
# 1. Backend env — every TF_* runtime key lives here
cp backend/.env.example backend/.env
# 2. Frontend envs — VITE_* build-time keys, one per app
cp frontend-cms-admin/.env.example frontend-cms-admin/.env
cp frontend-customer/.env.example frontend-customer/.env
cp frontend-runner-biker/.env.example frontend-runner-biker/.env
cp frontend-merchant/.env.example frontend-merchant/.env
# (frontend-landing-page is standalone; see its README)
```

Defaults work out of the box: `TF_DEMO_MODE=true` (one-click demo logins +
instant `simulate-paid`), local-disk uploads, Mailpit mail, stable DB dev VAPID
pair, planning-speed ETA fallback. Add real keys later only for the paths you
want to exercise live:

| You want live… | Set (in `backend/.env`, restart backend after) | Verify |
| -------------- | ---------------------------------------------- | ------ |
| Push delivery | Matched `TF_VAPID_PUBLIC_KEY` + `TF_VAPID_PRIVATE_KEY` from one `npx -y web-push generate-vapid-keys` run (never hand-type) | `curl localhost:8000/api/v1/push/vapid-public-key` prints your public key |
| R2 uploads | `TF_R2_ENDPOINT` + keys + both buckets | presign → PUT → GET round-trips byte-identical |
| Real email | `TF_SMTP_USER`/`PASSWORD`/`FROM` (Brevo relay) | signup mail arrives in a real inbox |
| Paddle sandbox | `TF_PADDLE_API_KEY` + webhook secret + client token (also `VITE_PADDLE_CLIENT_TOKEN` in customer `.env`, then rebuild) | top-up → `txn_01…` → webhook → wallet credited |
| Modal AI text | `TF_MODAL_KEY` + `TF_MODAL_SECRET` pair | `ai_calls` row has empty `error`, `fallback: false` |
| Live transcription/vision | `TF_META_API_KEY` (Meta direct) | voice stops using the typed-transcript fallback |
| Real routes/tiles | `TF_GOOGLE_MAPS_KEY` (server, IP-restricted) + `VITE_GOOGLE_MAPS_KEY` (browser, referrer-restricted, then rebuild) | polylines render; without keys the schematic fallback shows (by design) |

Frontend `.env` values are **baked in at build time** (Vite): after editing any
`frontend-*/.env`, rebuild that app's image (modes A/B) or restart `pnpm dev`
(mode C). Backend `.env` values are read at **process start**: restart the
`tf-backend` container (or `go run`) after editing.

## 4. Mode A — full stack with Podman (recommended)

```bash
bash scripts/podman-up.sh          # build + start everything
bash scripts/podman-up.sh --down   # stop (volumes kept)
```

What it does: loads root `.env` (if present) then `backend/.env`; builds
`tf-backend`, `tf-back-office`, `tf-customer`, `tf-courier`, `tf-merchant`;
starts PostGIS + Mailpit, waits for Postgres, then backend + 4 frontends +
Caddy gateway on the `tf-net` network. `localhost` hosts in `DATABASE_URL` /
`TF_SMTP_HOST` are remapped to container names automatically.

Open (trailing slash optional — the gateway 301s the bare path):

| Surface | URL |
| ------- | --- |
| CMS Admin | http://localhost:8000/back-office/ |
| Customer | http://localhost:8000/customer/ |
| Courier | http://localhost:8000/courier/ |
| Merchant | http://localhost:8000/merchant/ |
| API health (gateway) | http://localhost:8000/api/healthz |
| API health (direct) | http://localhost:8081/healthz |
| Mailpit inbox | http://localhost:8025 |
| Landing page (standalone) | `cd frontend-landing-page && npm run dev` → http://localhost:4321 |

Log in with the seeded accounts (`README.md` "Local test accounts", full list
in `docs/seed-accounts.md`) — password `trackfud123` for all, plus one-click
demo logins in every app. The GBK district seed (6 merchants, 8 couriers,
6 guests, 27 orders) loads on every backend boot, so the CMS live map and all
queues have data immediately.

Useful container commands:

```bash
podman logs -f tf-backend        # backend logs (migrations + seed run here)
podman logs -f tf-gateway        # routing issues live here
podman ps                        # all tf-* containers
podman restart tf-backend        # pick up a backend/.env change
```

## 5. Mode B — compose

```bash
podman compose up --build        # needs podman-compose installed
```

Same containers, ports and URLs as mode A (see `compose.yaml`). Env mapping
notes: backend runtime comes from `backend/.env` with `DATABASE_URL` /
`TF_SMTP_HOST` remapped to `db`/`mailpit`; frontend `VITE_*` values come from
each app's own `.env` at build time. Stop with `podman compose down` (add
`-v` to also drop `tf_pgdata`/`tf_uploads`).

## 6. Mode C — hybrid: local backend + Vite dev servers

Fastest edit loop — backend hot-restarts with `go run`, frontends hot-reload
with Vite (which proxies `/api` to `localhost:8081`).

```bash
# 1. Postgres + Mailpit only (no app containers)
podman run -d --name tf-db -e POSTGRES_USER=Trackfud \
  -e POSTGRES_PASSWORD=Trackfud -e POSTGRES_DB=Trackfud \
  -p 5432:5432 docker.io/postgis/postgis:18-3.6
podman run -d --name tf-mailpit -p 8025:8025 -p 1025:1025 \
  docker.io/axllent/mailpit:latest

# 2. Backend (from repo root; seeds + migrates on boot)
cd backend
DATABASE_URL=postgres://Trackfud:Trackfud@localhost:5432/Trackfud?sslmode=disable \
  go run ./cmd/api        # serves :8081 (TF_ADDR) — health: localhost:8081/healthz

# 3. Frontends — one terminal each (or just the app you're editing)
cd frontend-customer && corepack pnpm install && corepack pnpm dev
cd frontend-runner-biker && corepack pnpm install && corepack pnpm dev
cd frontend-merchant && corepack pnpm install && corepack pnpm dev
cd frontend-cms-admin && corepack pnpm install && corepack pnpm dev
```

Frontend dev servers default to Vite ports (customer 5173, others auto-bump);
each app talks to the backend through its `/api` proxy, or set
`VITE_API_BASE=http://localhost:8081/v1` to skip the proxy. The gateway is
bypassed in this mode, so use the direct backend URL for `curl` checks.

## 7. Configuration reference

**Ports** (env-overridable in root `.env` or shell): `GATEWAY_PORT` (8000),
`BACKEND_PORT` (8081), `DB_PORT` (5432), `MAILPIT_UI_PORT` (8025),
`MAILPIT_SMTP_PORT` (1025). `podman-up.sh` also honours `POSTGRES_*` and
`TF_DEMO_MODE`/`APP_DEVELOPMENT` (`APP_DEVELOPMENT=production` disables demo
shortcuts: no demo-login, no dev `simulate-paid`).

**Backend env groups** (`backend/.env`, full docs inline in `.env.example`):
auth (`TF_JWT_SECRET` ≥ 32 chars, `TF_IDENC_KEY`), payments
(`TF_PUBLIC_BASE_URL`, `TF_PADDLE_*`), storage (`TF_R2_*` or local
`TF_UPLOAD_DIR`), mail (`TF_SMTP_*`), push (`TF_VAPID_*`), maps
(`TF_GOOGLE_MAPS_KEY`), AI (`TF_MODAL_*`, `TF_META_*`). Unset optional keys =
offline fallback by design, never a crash (except a half VAPID pair, which
fail-fasts at boot — set both or neither).

**Data & volumes:** Postgres data lives in `tf_pgdata`, uploads in
`tf_uploads`. `--down` keeps both. To reseed from scratch:

```bash
bash scripts/podman-up.sh --down
podman volume rm tf_pgdata tf_uploads
bash scripts/podman-up.sh   # migrations + full seed re-run on boot
```

Seeds are idempotent (`ON CONFLICT` upserts), so a plain restart never
duplicates rows — only a volume drop gives you a truly fresh DB.

## 8. Verify your change (per-track checklist)

Run the checks for the tracks you touched before calling anything done
(PostGIS integration + real-phone checks stay explicitly OPEN per track):

```bash
# backend (any Go change)
cd backend && go build ./... && go vet ./... && go test ./...

# any frontend (CSS/copy/component change)
corepack pnpm typecheck && corepack pnpm build

# contract smokes (run in each touched frontend-*/)
corepack pnpm smoke          # route-smoke: routes + contract + wiring
corepack pnpm guards         # cms-admin only: validator + regression guards
```

Live round-trip after backend-affecting changes: restart, log in as each test
role, and walk the golden path (customer places → merchant accepts →
courier offer → pickup code → PIN → settlement → impact card). The GBK seed
gives you live actives on first boot, so you rarely need to hand-craft orders.

## 9. Troubleshooting

| Symptom | Cause → fix |
| ------- | ----------- |
| `address already in use` on `:8000`/`:8081`/`:5432` | Another stack (or a previous run) holds the port → `podman ps`, stop the clash, or set `GATEWAY_PORT`/`BACKEND_PORT`/`DB_PORT` |
| Frontend shows old `VITE_*` value | Baked at build time → rebuild that app's image (`podman build -t tf-customer ./frontend-customer`, restart container) or restart `pnpm dev` |
| Backend ignores `.env` edit | Read at process start → `podman restart tf-backend` (or restart `go run`) |
| `/courier` (no slash) 404s | Should 301 via gateway + app nginx — if you hit a container port directly, add the trailing slash |
| Login bounces to `/login` on refresh | Expected if the refresh cookie expired or `TF_JWT_SECRET` changed between restarts (all sessions invalidate) — log in again |
| Boot fails on VAPID error | Half pair set (only public or only private) → set both from one `generate-vapid-keys` run, or empty both for the DB dev pair |
| Uploads fail with 403 / no CORS headers | R2 bucket CORS must allow the app origin, `GET, PUT, HEAD` and the `Content-Type` request header |
| Paddle overlay never opens / 503 checkout | No `TF_PADDLE_API_KEY` (or IDR charge attempted — Paddle can't charge IDR, checkout 422s by design) → use wallet pay or demo `simulate-paid` |
| `ai_calls` rows all `fallback: true` | No `TF_MODAL_KEY`+`TF_MODAL_SECRET` pair in the backend process env (or half pair) → set both, restart backend |
| Empty dashboard / no couriers online | Backend booted but seed didn't run (check `podman logs tf-backend` for seed errors) or DB volume holds a pre-GBK snapshot → drop volumes and re-up |
| Mailpit empty after signup | `TF_SMTP_HOST`/`PORT` not pointing at Mailpit (mode C: keep `localhost:1025`; containers: `tf-mailpit:1025` — both handled automatically) |
| `go test` needs PostGIS | Unit tests are plain `go test ./...`; DB-backed tests document their own target — no `make test-db` in this repo |
| Landing page missing from gateway | By design — it runs standalone (`npm run dev` → `:4321`), the gateway doesn't route it yet |

## 10. Stop & clean up

```bash
bash scripts/podman-up.sh --down   # mode A: stop, keep data
podman compose down                # mode B: stop (add -v to drop data)
podman volume rm tf_pgdata tf_uploads   # truly fresh DB + uploads next boot
podman rm -f tf-db tf-mailpit     # mode C: stop the two infra containers
```
