# Trackfud — Merchant PWA

Kitchen operations for restaurant partners. Served at `/merchant/`. Built for noisy kitchens: big targets, high contrast, loud unmissable order alerts (sound unlocks on the "Start receiving orders" tap).

## Features

- **Setup (M1):** business profile (name, phone E.164, country/currency/timezone), map with draggable pin + "use my location" + address search + editable lat/lng + pickup note, opening hours + prep time, versioned Partner Agreement e-sign (typed name + tick) → pending-approval status, staff invite by email with roles + `can_deliver`/`on_shift` toggles.
- **Menu (M2):** Snap-a-Menu — photo upload (shrunk ≤1600 px) → import-job polling → editable review table (low-confidence cells highlighted, "I checked all prices" tick required before publish); menu CRUD (categories, items, options, allergens/dietary, R2 photos), sold-out toggle, `size_class`/`travels_well` labels, pickup-only badge, busy mode / pause store. AI never sets a price alone.
- **Live orders (M3):** incoming-order screen (loud sound + push), accept + prep time / reject, queue with courier-ETA view, "Ready" button, pickup-code confirm, handover-done state, push + staff-fallback notices, earnings + weekly statements.
- **Honesty details:** the queue names the assigned courier (`{name} ({mode}) is on the way`) the moment someone accepts; the merchant pickup code is for the courier only — the customer's door PIN is separate and never shown here.

## Flow

```text
sign up → store setup (pin + hours + prep) → sign agreement → pending review
  → build menu (photo import → review → publish)
  → new order alarm → accept (+prep min) / reject → cook → Ready
  → show pickup code to courier → handed over → earnings
```

Reject or the 3-minute accept timeout refunds the customer. A fresh courier wave starts at "Ready" tap when nobody has claimed the delivery yet.

## Run locally

```sh
corepack pnpm install
cp .env.example .env   # defaults work with the gateway; fill VITE_* keys as needed
corepack pnpm dev
```

- With the full stack (`bash scripts/podman-up.sh` from the repo root): open http://localhost:8000/merchant/ — `VITE_API_BASE=/api/v1` (default) routes through the gateway.
- Without the gateway: run the backend on `:8081` and set `VITE_API_BASE=http://localhost:8081/v1`.
- Seeded accounts: `chickenresto@example.com` / `noodleresto@example.com`, password `trackfud123` (approved stores + signed agreements + menus).

## Build

```sh
corepack pnpm typecheck  # tsc -b --noEmit
corepack pnpm build      # tsc -b && vite build → dist/
corepack pnpm preview    # preview the production build
corepack pnpm smoke      # route checks (node scripts/route-smoke.mjs)
```

Only `VITE_*` keys are exposed to the browser — never put secrets in `.env` (see `.env.example`). Verify on a real phone (install, push, loud alert audible) before reporting done.

## Related docs

- Contract: `../backend/api/openapi.yaml` · Plan: `AGENTS.md` (§4.3) · Seed logins: `../README.md`
