# Frontend-Merchant Agent — Trackfud Merchant PWA

> You own `frontend-merchant/` only. Do not edit other apps, backend, or `AGENTS.md`.
> Read first: `docs/app-context.md`, `docs/frontend-architecture.md`,
> `docs/frontend-tech-stack.md`, `docs/code-style-frontend.md`.
> API types come from `backend/api/openapi.yaml` (generated client).
> Feature source: `AGENTS.md` §4.3. Serve path: `/merchant/`.

## Scope

Merchant PWA: sign up → pin location → hours/prep → agreement e-sign →
Snap-a-Menu → live order operations → staff management → earnings. Loud,
unmissable order alerts (sound unlocked on "Start receiving orders" tap).

## Milestones (in order)

### M1 — Signup + setup + agreement + staff

- Business profile (name, phone E.164, country/currency/timezone); map with
  draggable lat/lng pin + "use my location" + address search + editable lat/lng
  fields + pickup note; opening hours + prep time (merchant timezone).
- Partner Agreement e-sign (versioned text, staff-fallback clause, typed name +
  tick) → submit → pending-approval status screen.
- Staff invite by email; roles; `can_deliver` + `on_shift` toggles; staff list.
- Done when: store submits with a real pin and signed agreement; staff invite
  sends; status shows pending.

### M2 — Menu (Snap-a-Menu) + menu management

- Photo upload (shrunk ≤1600 px) → import-job polling → editable review table
  (low-confidence cells highlighted, "I checked all prices" tick required before
  publish); items/prices/photos multilingual; sold-out toggle; `size_class` /
  `spill_risk` / `travels_well` labels visible; pickup-only badge for
  non-travels-well items.
- Menu CRUD (categories, items, options, allergens/dietary, photos via R2
  presigned PUT); available toggle; busy mode (longer prep) / pause store (P1).
- Done when: menu photo → reviewed menu → published and visible to customers in
  3+ languages; AI never sets a price alone (null + flag when unreadable).

### M3 — Live order operations

- Incoming-order screen: loud sound + push, accept + prep time / reject;
  order queue with courier-ETA view; "Ready" button; pickup-code confirm;
  handover done state; push `order.status` + staff-fallback notices.
- Earnings + weekly statements view (mock payout note); printer/promos (P2 —
  cut first).
- Done when: new order → accept → ready → pickup-code handover completes with
  a real courier; reject path refunds; works with screen on in a noisy kitchen
  (big targets, high contrast).

## Guardrails

- Style doc is binding: no `any`, object params at 3+ args, guard clauses,
  typed errors, logger (no `console.log`), tokens.css only, semantic HTML+ARIA.
- Server data in react-query cache; local state for UI/session only.
- Audio requires a user tap first — the "Start receiving orders" button both
  unlocks sound and opens the order stream.
- Verify on a real phone (install, push, loud alert audible) before reporting done.

## Skills & subagents

- Skills (in `.agents/skills/`): `pwa-verify` for `/merchant/` when a milestone
  is done; `i18n-string` for copy changes; `api-sync` when the contract changes.
- Parallel work with other tracks: see `docs/subagents.md`.
