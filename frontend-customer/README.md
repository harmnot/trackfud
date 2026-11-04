# Trackfud — Customer PWA

Health-first food ordering for customers (`Run. Ride. Earn.`). Installable PWA, served at `/customer/`. No card data in the app — card checkout opens the Paddle overlay only.

## Features

- **Browse (C1):** delivery location (GPS + address search + pin adjust + note), restaurant list sorted by distance with a live availability badge (`runners nearby` vs `staff only`), menu in your language + "show original", cart, push subscribe + iPhone install guide, offline banner.
- **Pay + track (C2):** quote (food + delivery + service fee + tip) with the 30–60 min promise shown **before** pay, idempotent wallet pay, Paddle card checkout, status timeline, live map with animated courier dot + route + ETA, courier profile + history, customer-only delivery PIN.
- **Post-delivery (C3):** PIN handover UI, separate courier vs restaurant ratings, impact card ("You powered X km") + my-impact page, no-courier choices (wait / pickup / full refund), translated chat + quick replies, send-a-cheer, order history + receipt view.
- **Honesty details:** availability comes from real courier presence (not a flag), restaurant stars are real aggregates (`★ New` while unrated), category chips from the API — nothing hardcoded.

## Flow

```text
pick location → browse restaurants → menu + cart → quote (30–60 min promise)
  → wallet pay / Paddle card → live tracking (map + courier card)
  → PIN handover (say it face to face, never in chat) → rate → impact card
```

Order states: `awaiting_payment → placed → accepted → ready → picked_up → delivered → completed`. If no courier is found: wait 5 more / self-pickup / full refund.

## Run locally

```sh
corepack pnpm install
cp .env.example .env   # defaults work with the gateway; fill VITE_* keys as needed
corepack pnpm dev
```

- With the full stack (`bash scripts/podman-up.sh` from the repo root): open http://localhost:8000/customer/ — `VITE_API_BASE=/api/v1` (default) routes through the gateway.
- Without the gateway: run the backend on `:8081` and set `VITE_API_BASE=http://localhost:8081/v1`.
- One-click demo login, no password needed. Seeded account: `customer2@example.com` / `trackfud123` (funded wallet + Jakarta addresses).

## Build

```sh
corepack pnpm typecheck  # tsc -b --noEmit
corepack pnpm build      # tsc -b && vite build → dist/
corepack pnpm preview    # preview the production build
corepack pnpm smoke      # route + smoke checks (node scripts/smoke.mjs)
```

Only `VITE_*` keys are exposed to the browser — never put secrets in `.env` (see `.env.example`). Without `VITE_GOOGLE_MAPS_KEY` the maps render a schematic fallback; without `VITE_PADDLE_CLIENT_TOKEN` card UI falls back to wallet-only.

## Related docs

- Contract: `../backend/api/openapi.yaml` · Plan: `AGENTS.md` (§4.1) · Seed logins: `../README.md`
