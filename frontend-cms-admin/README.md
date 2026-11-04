# Trackfud — Back-Office CMS (Admin)

Operations console for Trackfud admins. Served at `/back-office/`. **Admin login required** — every route is admin-gated; unauthorized access is rejected by the API (RBAC), not just hidden in the UI.

## Features

- **Ops overview:** today's numbers (placed/delivered/active, couriers online, pending applications/merchants, GMV per currency), live courier map (Google Maps JS with key, schematic SVG fallback without), active-order list, 30 s auto-poll.
- **Partner review:** courier + merchant queues with debounced search, approve/reject with reason, freeze/unfreeze/ban with standing panel and per-case history, courier 30-day performance page (acceptance/completion/in-window rates, WHO-week bars, flags, peer rank).
- **Orders:** status-filtered queue + detail (parties, money trail, audit timeline, delivery, chat, cheers/ratings, proof photo) with two-step support refund (pre-pickup only, reason required, audit-logged).
- **Payouts:** withdrawals monitor with status filter, hold (reason required) / release, per-card amounts in integer minor units.
- **Platform controls:** settings editor (28-key allowlist, global + per-country scopes, range-checked, audit-logged), audit log viewer, AI calls monitor (metadata only, never prompts), Ops Copilot (plain-words questions → fixed read-only tools, deterministic answers).
- **Responsive:** slim icon nav (four primaries + System menu) on tablets/desktops, icon bottom bar + grouped More sheet on phones, avatar account menu at every width.

## Flow

```text
admin login → Overview (live map + today's numbers)
  → Review queue → inspect application → approve / reject (reason)
  → Orders → inspect timeline → support refund (pre-pickup)
  → Payouts → hold (reason) / release
  → Settings / Audit / AI / Copilot for platform tuning
```

Money moves only through the audited API — the screen never touches balances. Paddle stays sandbox-only; "real paths" means the real backend endpoints + webhook/dedupe path, never real rails.

## Run locally

```sh
corepack pnpm install
cp .env.example .env   # defaults work with the gateway; fill VITE_* keys as needed
corepack pnpm dev
```

- With the full stack (`bash scripts/podman-up.sh` from the repo root): open http://localhost:8000/back-office/ — `VITE_API_BASE=/api/v1` (default) routes through the gateway.
- Without the gateway: run the backend on `:8081` and set `VITE_API_BASE=http://localhost:8081/v1`.
- Seeded admin login via the one-click demo login (see `../README.md` test accounts).

## Build

```sh
corepack pnpm typecheck  # tsc -b --noEmit
corepack pnpm build      # tsc -b && vite build → dist/
corepack pnpm preview    # preview the production build
corepack pnpm smoke      # route checks (node scripts/route-smoke.mjs)
corepack pnpm guards     # admin-gate checks (node scripts/guard-smoke.mjs)
```

Only `VITE_*` keys are exposed to the browser — never put secrets in `.env` (see `.env.example`).

## Related docs

- Contract: `../backend/api/openapi.yaml` · Plan: `AGENTS.md` (§4.4) · Seed logins: `../README.md`
