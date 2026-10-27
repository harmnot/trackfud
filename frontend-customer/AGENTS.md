# Frontend-Customer Agent — Trackfud Customer PWA

> You own `frontend-customer/` only. Do not edit other apps, backend, or `AGENTS.md`.
> Read first: `docs/app-context.md`, `docs/frontend-architecture.md`,
> `docs/frontend-tech-stack.md`, `docs/code-style-frontend.md`.
> API types come from `backend/api/openapi.yaml` (generated client).
> Feature source: `AGENTS.md` §4.1. Serve path: `/customer/`.

## Scope

Customer PWA: discover → quote → pay → live-track → cheer/chat → PIN handover →
rate → impact. Health-first framing everywhere ("Workout delivery · 30–60 min",
supporter tone). No card data in app (Paddle overlay only).

## Milestones (in order)

### C1 — Shell + location + browse

- App bootstrap (`main.tsx`, router, layouts, auth context, i18n provider),
  installable manifest (`scope`/`start_url` = `/customer/`), `sw.js`
  (precache shell, network-first API, cache-first images, never private API).
- Auth screens + one-click demo login (demo mode); `X-TB-App: customer`,
  token-in-memory, per-app storage keys (`tb:customer:*`); WS ticket connect.
- Delivery location (GPS + Places search + pin adjust + note); restaurant list
  sorted by distance with availability badge (runners nearby / staff only);
  menu in user language + "show original"; cart; `en.json`/`id.json` (+1);
  km/mi + `Intl.NumberFormat` minor-unit prices; push subscribe + iPhone guide.
- Done when: installs from `/customer/` over HTTPS; list → menu → cart renders
  on a real phone; offline shows pending-sync state.

### C2 — Cart + pay + live tracking

- Quote (food + delivery + service fee + tip) with 30–60 min promise shown
  **before** pay; wallet pay (idempotent, `Idempotency-Key`); Paddle checkout +
  wallet top-up via `@paddle/paddle-js` (shared pay module); `awaiting_payment`
  → `placed` handling.
- Status timeline; live map (`LiveMap`, courier marker, route, ETA); courier
  profile + history (photo, mode, rating, deliveries, lifetime km/mi, 8-week
  chart); delivery PIN display (customer-only); push `order.status` handling.
- Done when: wallet order + sandbox-card order both place and track live;
  courier dot animates smoothly; no silent SW reload mid-order.

### C3 — Post-delivery + edge cases

- PIN handover UI; separate courier vs restaurant ratings (stars + tags);
  impact card ("You powered X km · Y active min") + my-impact page; no-courier
  choices (wait 5 more / pickup / full refund); translated chat + quick replies
  ("I'm at the gate"); send-a-cheer; order history + email receipt view.
- Empty/error/loading states for every screen; reconnect + backlog resend.
- Done when: delivered → rated → impact card correct; no-courier path refunds
  to wallet; chat translates both directions.

## Guardrails

- Style doc is binding: no `any`, object params at 3+ args, guard clauses,
  typed errors, logger (no `console.log`), tokens.css only, semantic HTML+ARIA.
- Server data in react-query cache; local state for UI/session only.
- Follow `docs/frontend-architecture.md` §§3–4 (PWA, auth, payments, perf, a11y).
- Verify on a real phone (Android + iPhone Add-to-Home) before reporting done.

## Skills & subagents

- Skills (in `.agents/skills/`): `pwa-verify` for `/customer/` when a milestone
  is done; `i18n-string` for copy changes; `api-sync` when the contract changes.
- Parallel work with other tracks: see `docs/subagents.md`.
