# Trackfud Milestone Checklist — done vs plan

Date: 2026-10-28 · Source of truth: `AGENTS.md` (+ per-app `AGENTS.md`).
Method: code inspection of this repo on 2026-10-28 (routes, files, deps, configs).
No real-phone verification has been done yet — every "Done" below means
_implemented in code_, not _verified on device_.

Legend: DONE = implemented · PARTIAL = works with a documented simplification ·
OPEN = not built yet.

Folder-name note: the courier app lives at `frontend-runner-biker/`
(served at `/courier/`), not `frontend-biker-runner/`.

## Backend (`backend/`) — milestones B0–B6

| Milestone                                      | Status                         | Evidence / notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0 contract + skeleton                         | DONE                           | `api/openapi.yaml` (94 `/v1` paths); `config.yaml`; JWT 15 min + per-app refresh via `X-TF-App` + RBAC; `GET /healthz`; 6 goose migrations; `Containerfile`                                                                                                                                                                                                                                                                                                                                                                                             |
| B0 generated TS client                         | PARTIAL                        | Contract exists and is rich, but all three frontends use hand-written typed `fetch` wrappers (`lib/api.ts`), not an `oapi-codegen`/`openapi-typescript` generated client                                                                                                                                                                                                                                                                                                                                                                                |
| B1 auth/users/files/notify                     | DONE                           | signup/login/refresh/logout/demo-login/verify-email; `files/presign` + local upload (R2-shaped contract, local disk); push subscriptions + VAPID + demo outbox/Mailpit; WS ticket + hub; seed (`internal/app/seed.go`, `cmd/simulator`)                                                                                                                                                                                                                                                                                                                 |
| B2 merchant + catalog + order machine + ledger | DONE                           | Merchants (geo `location`, hours, prep), versioned agreement e-sign + staff invite/roles, menu CRUD with `size_class`/`spill_risk`/`travels_well`; guarded `Transition()` + `order_events` + merchant-timeout jobs + WS broadcast; integer-minor-unit double-entry ledger + idempotency + refunds; `order_test.go`, `ledger_test.go`, `money_test.go`                                                                                                                                                                                                   |
| B3 courier onboarding + sessions + GPS         | DONE                           | Application autosave, config-driven fitness-test eval (moving time, 2× elapsed cap, gap rules), WS `loc.batch` + HTTP fallback, session stats (distance/moving/active/pace), approve/reject + email + push, sanctions tables; `fitness_test.go`, `ingest_test.go`                                                                                                                                                                                                                                                                                       |
| B4 dispatch + delivery completion              | DONE                           | PostGIS `DispatchCandidates`, Go scoring + cascade, atomic accept, offer/search/staff timeout jobs, "leave now" nudge, pickup code + PIN/photo handover, settlement, 72 h auto-complete, live broadcasts, Routes API ETA (WALK/BICYCLE + beta warning) with planning-speed estimate fallback; `dispatch_test.go`                                                                                                                                                                                                                                        |
| B5 money real paths + staff fallback + social  | PARTIAL                        | Paddle sandbox top-up + direct pay, HMAC webhook + dedupe, mock `payout_process` withdrawals + hold/release, staff fallback, no-courier choices, separate ratings, WHO minutes + impact aggregates — all present; "PARTIAL" only because money moves via sandbox + `dev/payments/simulate-paid`, never real rails (per plan)                                                                                                                                                                                                                            |
| B6 AI + simulator + demo controls              | DONE (Modal-routed 2026-10-28) | `internal/ai` (client, prompts, schemas, tools, transcribe, voice, SAM) + jobs (menu import, translate, trust brief, proof check, feedback labels) + `ai_calls` logging + offline fallbacks; voice relay + confirm; `cmd/simulator` + demo controls + judge logins. Chat/text routes to the Modal endpoint via the `Modal-Key`/`Modal-Secret` pair (`TF_MODAL_KEY`/`TF_MODAL_SECRET`, `config.yaml ai:` block); Meta direct remains an env override. OPEN: confirm the served model id + one live smoke call with the token pair (see "AI plan change") |

## Customer (`frontend-customer/`, `/customer/`)

| Milestone                     | Status  | Evidence / notes                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 shell + location + browse  | DONE    | PWA shell + manifest (`/customer/`), `sw.ts`, auth + one-click demo login, `X-TF-App: customer`, GPS/Places/pin/note location, distance-sorted restaurant list + availability badge, trilingual menu (en/id/ms) + "show original", cart, push subscribe + iPhone guide, offline banner                                                                                                                                           |
| C2 cart + pay + live tracking | PARTIAL | Quote + 30–60 min promise pre-pay, idempotent wallet pay, Paddle checkout via CDN lazy-load (`features/orders/pay.ts`), `awaiting_payment` → `placed`, status timeline, courier profile + history, customer-only PIN, push `order.status` — DONE. PARTIAL because `LiveMap.tsx` is a schematic SVG animator (explicit swap-in point), not real Google Maps: `@vis.gl/react-google-maps` is not installed and no Maps key is read |
| C3 post-delivery + edge cases | DONE    | PIN handover UI, separate courier/restaurant ratings, impact card + page, no-courier wait/pickup/refund, translated chat + quick replies, send-a-cheer, history + receipt view, empty/error/loading states, reconnect + backlog resend                                                                                                                                                                                           |

## Courier (`frontend-runner-biker/`, `/courier/`)

| Milestone                                     | Status  | Evidence / notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1 onboarding + pre-run + fitness test        | DONE    | Signup, runner/biker choice, pre-run checklist (GPS/Wake Lock/mic/notifications/motion), fitness recorder + 1 checkpoint photo, IndexedDB draft autosave, R2-presigned doc uploads (shrunk ≤1600 px), status screen                                                                                                                                                                                                                                                                                                                                                            |
| R2 Run Mode + offers + delivery               | PARTIAL | Session start (goal, free/saved-track, AI-track placeholder), big Run Mode stats, WS `loc.batch` + HTTP fallback + IndexedDB buffer (real `ts`, UUID/point), offer card (sound/vibration/voice/push, 30 s timer, track-fit info), "head to restaurant" nudge, route + "Open in Google Maps", pickup-code confirm, PIN/photo completion, wallet + mock withdraw, "Earned & moved" summary + WHO ring + cap/rest/hydration nudges — DONE. PARTIAL because: no in-app turn-by-turn (external Maps link only), no Maps SDK route polyline, QR-confirm variant not verified in code |
| R3 Voice Copilot + staff mode + health extras | PARTIAL | Hold-to-talk → server voice relay with local EN+ID parser fallback (`features/voice/`), spoken offers + cheers aloud, per-km/mi pace cues, translated chat, staff mode + shift/offers, saved tracks, cadence display, ratings received — DONE. GPX export (P2, cut-first per plan) not present — OPEN by design                                                                                                                                                                                                                                                                |

## Merchant (`frontend-merchant/`, `/merchant/`)

| Milestone                             | Status | Evidence / notes                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 signup + setup + agreement + staff | DONE   | Business profile, click-map draggable lat/lng pin + geolocation + search + editable fields + pickup note, hours/prep in merchant timezone, versioned Partner Agreement e-sign (staff-fallback clause) → pending screen, staff invite + `can_deliver`/`on_shift` toggles                                 |
| M2 Snap-a-Menu + menu management      | DONE   | Photo shrink ≤1600 px → server import-job polling → editable review table (low-confidence highlight, "prices checked" tick gates publish), multilingual items, sold-out toggle, size/spill/travels-well labels + pickup-only badge, full menu CRUD, busy mode / pause store (`features/menu/extras.ts`) |
| M3 live order operations              | DONE   | Loud alert (sound unlocked on "Start receiving orders" tap) + push, accept + prep time / reject, order queue + courier ETA, Ready button, pickup-code confirm, handover done state, staff-fallback notices, earnings + weekly statements (mock payout note). Printer/promos (P2) cut per plan           |

## Cross-cutting — OPEN (not built, per plan or gap)

- **Admin CMS app (`AGENTS.md` §4.4): PARTIAL (2026-10-29).** `frontend-cms-admin/`
  Back Office is scaffolded on the merchant/courier design system (`/back-office/`, port 5176):
  login-only page (email `@` + password min-8 validation, no signup, non-admin refused,
  `RequireAdmin` redirects to `/login`, logout clears session), dashboard with courier +
  merchant queues (pending/approved/rejected/all filter, counts, skeleton + retry, no hardcoded
  rows), detail views (courier personal + documents + fitness + Trust Brief; merchant business +
  operations + hours + agreement + staff) with approve / two-step reject (reason required).
  Backend added `GET /v1/admin/courier-applications/{user_id}`,
  `GET /v1/admin/merchants`, `GET /v1/admin/merchants/{id}`,
  `POST /v1/admin/merchants/{id}/approve|reject` (tx, reject-reason required, 409 on
  non-pending, idempotent re-approve, `requireRole(admin)`), contract synced in
  `backend/api/openapi.yaml`; `backend/internal/app/admin_test.go` 4/4 pass, CMS
  `scripts/route-smoke.mjs` 33/33 pass, `tsc --force` + `vite build` clean.
  Still OPEN per PLAN 4.4: live map + today's numbers, courier performance page,
  freeze/unfreeze/ban UI (API exists), orders list/detail, settings editor, withdrawals
  monitor UI (API exists), ratings moderation, audit-log viewer, "AI under the hood",
  Ops Copilot; live end-to-end against seeded backend + real-phone checks unverified.
  CMS copy is English-only (no `locales/` + `react-i18next` yet — follow-up).
- **Real Google Maps on any frontend: OPEN.** No Maps/Places/Paddle npm
  dependencies installed anywhere; browser Maps key not wired. Backend
  `internal/maps` is ready and only needs `TF_GOOGLE_MAPS_KEY`.
- **Real R2 / River / Brevo / Paddle: OPEN by plan.** Local disk, Postgres
  queue shim, Mailpit, sandbox/simulate stand in (see root `README.md`).
- **Real-phone verification: OPEN.** Install, push delivery, outdoor GPS, Wake
  Lock, mic on Android + iPhone still required before any "verified" claim
  (guardrail in all three frontend `AGENTS.md`).
- **Contract-codegen loop (`api-sync` skill): OPEN.** Backend contract and
  frontend wrappers are maintained by hand; drift is possible — regenerate or
  diff when `openapi.yaml` changes.

## AI plan change (2026-10-28): chat/text AI via Modal — IMPLEMENTED

Previously: `internal/ai` pointed at `https://api.meta.ai/v1` directly.
Now: text/chat/tool-calling features route to the Modal-hosted endpoint,
implemented in code (not just planned):

- `internal/ai/client.go`: `Config` gains the Modal proxy-token pair
  (`ModalKey`/`ModalSecret`); `New` attaches `Modal-Key`/`Modal-Secret`
  headers (Modal proxy auth is a header pair, NOT Bearer — plain Bearer
  gets 401 "proxy auth required" at the edge, verified by probe).
  `HasKey()` accepts Meta key OR full pair; half pair stays in fallback.
  Pair present + no explicit base → Modal endpoint; otherwise Meta direct.
- `internal/ai/transcribe.go`: same headers ride along; Modal serves chat
  only, so audio there fails into the designed typed-transcript fallback.
  Live transcription needs the Meta-direct `TF_META_API_KEY`.
- `internal/config/config.go`: new `ai:` YAML block (`base_url`,
  `spark_model`, …; env wins), `TF_MODAL_KEY`/`TF_MODAL_SECRET` env-only.
- `backend/config.yaml`: `ai.base_url` = Modal endpoint,
  `ai.spark_model` = `muse-spark-open` (UNCONFIRMED default — see below).
- `internal/app/ai_jobs.go`: `aiConfigOf` passes the pair through.
- Tests: `ai/modal_test.go` (pair gating, base default, header round-trip
  via httptest), `config/config_ai_test.go` (yaml/env precedence),
  `app/ai_modal_test.go` (mapping + Modal-only transcriber fallback).
- Verified 2026-10-28: `go build ./...`, `go vet ./...`,
  `go test ./...` (all packages ok), `gofmt` clean. PostGIS integration
  (`make test-db` target does not exist; podman broken in this sandbox)
  NOT run — no migration/query changed, so unit cover suffices here.

Scope:

- Via Modal: menu-import text pass, translation, Trust Brief text, AI Coach,
  voice-intent tool calls — anything chat-completions shaped.
- NOT via Modal: realtime PCM transcription and SAM vision. With no
  Meta-direct key, voice uses the typed-transcript fallback and SAM stays a
  stub — the demo works, humans decide. No per-feature base-URL override was
  needed: the split falls out of the credential gating.
- Keys stay server-side only (unchanged guardrail); every Modal call is still
  logged to `ai_calls` (unknown Modal model ids record cost 0).

Remaining work (needs your Modal token pair — env-only, never committed):

1. Confirm the served model id:
   `curl -s "$TF_META_BASE_URL/v1/models" -H "Modal-Key: $TF_MODAL_KEY" -H "Modal-Secret: $TF_MODAL_SECRET"`
   then set `TF_META_SPARK_MODEL` (or `config.yaml ai.spark_model`) to match.
2. One live smoke call (e.g. translate a chat line) and check the `ai_calls` row.

## `.env.example` files (added 2026-10-28)

Every key below maps to a real `os.Getenv` read in
`backend/internal/config/config.go` or `import.meta.env` in the frontends —
no invented keys:

- `backend/.env.example` — `DATABASE_URL`, `TF_CONFIG`, `TF_ADDR`,
  `TF_DEMO_MODE`, `TF_JWT_SECRET`, `TF_PADDLE_WEBHOOK_SECRET`, `TF_UPLOAD_DIR`,
  `TF_SMTP_HOST/PORT`, `TF_GOOGLE_MAPS_KEY`, `TF_MODAL_KEY/SECRET` (Modal
  proxy pair, env-only), `TF_META_BASE_URL/SPARK_MODEL` (empty = config.yaml
  Modal defaults), `TF_META_API_KEY` (Meta direct, for live transcription/
  vision only), contributor/transcribe/SAM model ids.
- `frontend-customer/.env.example` — `VITE_API_BASE`, `VITE_PADDLE_CLIENT_TOKEN`,
  `VITE_PADDLE_ENV` (+ commented `VITE_GOOGLE_MAPS_KEY` for the Maps swap-in).
- `frontend-merchant/.env.example` — `VITE_API_BASE` (+ Maps key placeholder).
- `frontend-runner-biker/.env.example` — `VITE_API_BASE` (+ Maps key placeholder).

## Stride & Earn rebrand + ordinary runner/biker flow (2026-10-28)

Confirmed by user before implementation: name **Stride & Earn**, access
**open tracking, upgrade later**, onboarding **fitness test + CMS review**.

| Task | Status | Evidence |
| --- | --- | --- |
| Rename Courier → Stride & Earn (header, title, manifest, nav) | DONE | `app.brand` in en/id/ms; `Shell` header; `index.html`; PWA manifest description |
| Personal data on account page (`/courier/status`) | DONE | New modular `pages/StatusPage.tsx` + `features/profile/profileApi.ts` composing `GET /auth/me` + `GET /courier/profile` + `GET /courier/application` (name, email, phone, address) |
| Become a Partner CTA + fitness/CMS flow | DONE | Status states none/draft/pending/approved/rejected; `/courier/onboarding` saves draft + `PUT /courier/profile`; fitness submit → `pending_review`; admin API `GET/POST /v1/admin/courier-applications*` serves CMS approve/reject, reviewed in `frontend-cms-admin/` Back Office (courier queue + detail + Trust Brief) |
| Register/login for ordinary runner/biker | DONE | Signup no longer forces partner role; login/signup/demo land on `/run-setup`; tracking free, delivery/wallet gated until approved or staff mode |
| Unresponsive pages (run-setup, delivery, staff, ratings, chat, wallet, onboarding) | DONE | All imported pages now render inside `Shell` (header + bottom nav); chat shows no-delivery/error/retry states from the real messages API; ratings no longer renders sample data; wallet/delivery show partner-lock cards |
| Mock/hardcoded data | DONE | `DEMO_RATINGS` kept for unit tests only; quick replies are input shortcuts, thread data always from API |
| Verify | DONE | `tsc -b --noEmit` 0; `node scripts/route-smoke.mjs` all green (incl. new Stride & Earn checks); `vite build` 0 (PWA precache 8 entries); backend untouched — `go build/vet/test` sanity green. Real-phone PWA checks (install/GPS/Wake Lock/push) UNVERIFIED — no device in this session |

## Staff email-membership flow across 3 tracks (2026-10-28)

Confirmed by user before implementation: **email memberships** (no invite codes).
Problem fixed: the runner app asked for an invite code the merchant never issued,
and staff mode never touched the server — merchant invites by email, so the two
sides could never meet.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend | New `GET /v1/courier/staff/memberships` (`listMemberships`) + `StaffMembership/List` schemas; handler joins roster by account email (same link as invite/signup); route registered; `staffMembershipView` unit-tested | `api/openapi.yaml`, `internal/app/dispatch.go`, `internal/app/app.go`, `internal/app/staff_test.go` |
| Runner | Staff page lists rostered restaurants, clocks on/off shift via real `staffShift`, honest no-invite state with account email; store persists `merchantId` (old code-shaped cache ignored) | `pages/StaffPage.tsx`, `features/staff/staffStore.ts`, `features/delivery/courierApi.ts`, staff locales en/id/ms |
| Merchant | Staff page shows how teammates join (Stride & Earn + same email + Staff mode); order ops address runner/biker, not "courier" | `App.tsx` StaffPage, locales en/id/ms |
| Verify | DONE | backend `go build/vet/test` green; runner `tsc` + smoke + `vite build` green; merchant `tsc` + smoke + `vite build` green. PostGIS integration + real-phone PWA checks UNVERIFIED in this session |
