# Trackfud — Courier PWA (Stride & Earn)

Workout-first delivery app for **runners**, **bikers (pedal only)** and **merchant staff mode** — three actors, one app. Served at `/courier/`. Big Run Mode stats, voice-first controls, screen stays on (Wake Lock), GPS always streaming, offline buffer with real timestamps.

## Features

- **Onboarding (R1):** runner/biker choice, pre-run checklist (GPS ✓, Wake Lock ✓, mic ✓, notifications ✓, iOS motion), "Add to Home Screen" guide, fitness-test recorder (GPS watch, moving-time rule, 1 checkpoint photo, IndexedDB draft autosave) + ID/selfie/bike-photo uploads → submit → pending/approved/rejected status.
- **Run + deliver (R2):** run setup (mode, goal distance-or-time, free/saved/AI track) → server work session, huge Run Mode stats (distance, time, pace, active min, earnings), `loc.batch` streaming + HTTP fallback + IndexedDB backlog, 30 s offer card (sound + vibration + voice + push, track-fit info) with big ACCEPT/DECLINE, "head to restaurant now" nudge, pickup code/QR confirm, customer-PIN/photo completion, earnings wallet + anytime withdraw, "Earned & moved" summary + WHO 150-min ring + cap/rest/hydration nudges.
- **Voice + staff + extras (R3):** hold-to-talk Voice Copilot (EN + ID: "accept", "how far?", "I'm 2 min away"), spoken offers/cheers/pace cues, translated chat + voice notes, staff mode (invited-login, no fitness test, fallback offers only), saved tracks (draw/anchor/reuse), ratings received, weekly AI Coach report, lifetime totals, GPX export, AI Run Planner (two workout-first loops toward merchant hotspots).
- **Orders tab:** partner-gated list + detail of delivered/cancelled legs (payout, distance, timeline, pickup note) with scroll pagination.
- **Honesty details:** GPS gaps are marked honestly — never interpolated; declining an offer is never penalised; frozen/banned couriers can't go online (wallet stays open — earned money stays withdrawable).

## Flow

```text
sign up → fitness test (2 km) → approved → Go online (audio unlocks)
  → run (stats + GPS streaming) → offer card → ACCEPT
  → head to restaurant → merchant pickup code → deliver
  → customer PIN / photo → payout settled → summary
```

One courier per order (atomic claim); a losing card clears at once on `offer.taken`. Mid-delivery freezes finish the leg.

## Run locally

```sh
corepack pnpm install
cp .env.example .env   # defaults work with the gateway; fill VITE_* keys as needed
corepack pnpm dev
```

- With the full stack (`bash scripts/podman-up.sh` from the repo root): open http://localhost:8000/courier/ — `VITE_API_BASE=/api/v1` (default) routes through the gateway.
- Without the gateway: run the backend on `:8081` and set `VITE_API_BASE=http://localhost:8081/v1`.
- Seeded accounts: `runner@example.com` / `biker@example.com` / `runner2@example.com`, password `trackfud123` (approved + fitness passed). Verify outdoors on a real phone (install, push, Wake Lock, GPS, mic).

## Build

```sh
corepack pnpm typecheck  # tsc -b --noEmit
corepack pnpm build      # tsc -b && vite build → dist/
corepack pnpm preview    # preview the production build
corepack pnpm smoke      # route checks (node scripts/route-smoke.mjs)
```

Only `VITE_*` keys are exposed to the browser — never put secrets in `.env` (see `.env.example`). Never cache private API responses in the service worker.

## Related docs

- Contract: `../backend/api/openapi.yaml` · Plan: `AGENTS.md` (§4.2) · Seed logins: `../README.md`
