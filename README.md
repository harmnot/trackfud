# Trackfud — Milestone 1 (B0+B1 · C1 · R1 · M1)

Health-first food delivery: customers order, runners/pedal-bikers deliver along their workout, merchants cook. Spec: `docs/app-context.md`, plan: `backend/AGENTS.md`, `frontend-*/AGENTS.md`.

## Run locally (Podman + Postgres, one command)

Requires Podman only (no compose provider needed):

```bash
bash scripts/podman-up.sh
```

Then open in your browser:

- Customer: http://localhost:8000/customer/
- Courier: http://localhost:8000/courier/
- Merchant: http://localhost:8000/merchant/
- API health: http://localhost:8000/api/healthz (direct backend: http://localhost:8081/healthz)
- Demo email inbox (Mailpit): http://localhost:8025

Stop: `bash scripts/podman-up.sh --down`

Every app has a **One-click demo login** (no password needed). Seeded fictional restaurants appear in Customer near Jakarta (-6.2088, 106.8456) and London.

If you prefer compose (after installing `podman-compose`): `podman compose up --build` using `compose.yaml`.

## Dev without containers (optional)

Backend: `podman run -d --name tb-db -e POSTGRES_USER=Trackfud -e POSTGRES_PASSWORD=Trackfud -e POSTGRES_DB=Trackfud -p 5432:5432 docker.io/postgis/postgis:18-3.6`, then `cd backend && DATABASE_URL=postgres://Trackfud:Trackfud@localhost:5432/Trackfud?sslmode=disable go run ./cmd/api`.
Frontends: `corepack pnpm install && corepack pnpm dev` in each `frontend-*` folder (Vite proxies `/api` to `localhost:8081`; run backend on 8081 or set `VITE_API_BASE`).

## What Milestone 1 includes

- **Backend B0+B1:** OpenAPI contract (`backend/api/openapi.yaml`), config, JWT (15 min) + per-app refresh cookies + RBAC, signup/login/refresh/logout/demo-login/verify-email, file presign + local upload (R2-shaped contract), Postgres push subscriptions + VAPID worker + demo email outbox/Mailpit, WS ticket + hub, Postgres+PostGIS schema + fictional seed.
- **Customer C1:** installable PWA shell, auth + demo login, delivery location (GPS/lat-lng/note, saved to server), restaurant list by distance with availability badge, menu (travels-well/pickup-only, 3 languages), cart, push subscribe + iPhone guide, offline banner.
- **Courier R1:** auth, runner/biker onboarding with private photo uploads, draft auto-save (device + account), pre-run checklist (GPS/Wake Lock/mic/notifications/motion), GPS fitness-test recorder + desktop test values, submit → status.
- **Merchant M1:** auth, store setup (pin via click-map + lat/lng + address search, hours, prep), versioned Partner Agreement e-sign → pending, staff invite + can-deliver/on-shift toggles.

Known Milestone-1 simplifications (not hidden): file storage is local disk behind the R2-shaped presign contract; the job worker is a Postgres queue with same-transaction enqueue (River-swappable); real Google Maps/Paddle/dispatch/orders arrive in later milestones. Real-phone PWA checks (install, push delivery, outdoor GPS) still need your phone — see `docs/` verify skills.
