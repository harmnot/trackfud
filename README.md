# Trackfud — Milestone 1 (B0+B1 · C1 · R1 · M1)

Health-first food delivery: customers order, runners/pedal-bikers deliver along their workout, merchants cook. Spec: `docs/app-context.md`, plan: `backend/AGENTS.md`, `frontend-*/AGENTS.md`.

## Run locally (Podman + Postgres, one command)

Requires Podman only (no compose provider needed):

```bash
bash scripts/podman-up.sh
```

Then open in your browser:

- CMS Admin (back-office): http://localhost:8000/back-office/
- Customer: http://localhost:8000/customer/
- Courier: http://localhost:8000/courier/
- Merchant: http://localhost:8000/merchant/
- API health: http://localhost:8000/api/healthz (direct backend: http://localhost:8081/healthz)
- Demo email inbox (Mailpit): http://localhost:8025

Gateway paths work with or without the trailing slash
(e.g. `/back-office` and `/back-office/` both route to the same app).

Stop: `bash scripts/podman-up.sh --down`

Every app has a **One-click demo login** (no password needed). Seeded fictional restaurants appear in Customer near Jakarta (-6.2088, 106.8456) and London.

If you prefer compose (after installing `podman-compose`): `podman compose up --build` using `compose.yaml`.

## Local test accounts (seeded on every backend boot)

Password for all six: `trackfud123`. Use the matching `X-TF-App` (`customer` / `courier` / `merchant` / `cms`).

| Role     | Email                      | Ready to use because                                                        |
| -------- | -------------------------- | --------------------------------------------------------------------------- |
| Courier  | `runner@example.com`       | `couriers` row `approved` (runner), full profile + passed fitness test       |
| Courier  | `biker@example.com`        | `couriers` row `approved` (biker, pedal `city` bike), full profile + passed |
| Courier  | `runner2@example.com`      | `couriers` row `approved` (runner), full profile + passed fitness test       |
| Merchant | `chickenresto@example.com` | Approved store "Ayam Geprek Sambal Korek" + signed agreement + 5 items      |
| Merchant | `noodleresto@example.com`  | Approved store "Mie Ayam Bangka Asli" + signed agreement + 5 items          |
| Customer | `customer2@example.com`    | `customer_wallet` funded Rp 200.000 + Home/Office addresses (Jakarta)       |

The canonical skill accounts (`runnerbiker` / `merchant` / `customer` / `admin@example.com`) are seeded alongside these — see `.agents/skills/seed-test-data/SKILL.md`. ID numbers in seed rows are fictional placeholders (`317400000000000N`), sealed with the same AES-GCM path as onboarding and never returned by the API.

### GBK live district (seeded on every backend boot, 2026-11-03)

Base: Stadion Utama Gelora Bung Karno (-6.2186006, 106.8029661). Everything
below is served through the normal API — no frontend hardcodes any of it.
Password for all GBK accounts: `trackfud123`.

| Role | Accounts | What is seeded |
| ---- | -------- | -------------- |
| Merchant | `sate.gbk@`, `bakmi.gbk@`, `padang.gbk@`, `kopi.gbk@`, `gado.gbk@`, `ayam.gbk@example.com` | 6 approved stores around the stadium (Sate Senayan, Bakmi Ayam, Nasi Padang, Kopi, Gado-Gado, Ayam Goreng) + signed agreements + menus + on-shift staff |
| Courier | `gbk-runner-1..4@`, `gbk-biker-1..4@example.com` | 8 approved couriers (4 runners + 4 bikers) with profiles, fitness passes, lifetime stats — plus a fresh active work session each boot so the CMS live map always shows dots near GBK |
| Customer | `gbk-guest-1..6@example.com` | 6 hotel guests (Sultan, Mulia, Fairmont, Somerset, Harris fX, Century Park) with funded wallets (Rp 1.000.000) + hotel delivery pins — the "ordering from the room" story |
| Orders | 27 linked rows | 12 delivered + 4 completed (ratings, cheers, translated chat, settlements), 9 live actives (placed → picked_up, assigned to GBK couriers), 2 cancelled (refunds) — every row has real quotes, ledger postings, deliveries + dispatch offers |
| AI surfaces | — | 1 menu-import job awaiting review, 2 advisory Trust Briefs, 2 proof checks, fallback-marked `ai_calls` rows (CMS AI page shows the fallback badge honestly), 2 mock withdrawals for the payouts monitor |

History inserts run once (guarded, idempotent across restarts); live sessions
refresh every boot. Verify: `GET /v1/admin/dashboard` as the CMS admin shows
8 couriers online + the active orders.

Full per-account list (all 30 test logins + demo logins): `docs/seed-accounts.md`.

## Dev without containers (optional)

Backend: `podman run -d --name tf-db -e POSTGRES_USER=Trackfud -e POSTGRES_PASSWORD=Trackfud -e POSTGRES_DB=Trackfud -p 5432:5432 docker.io/postgis/postgis:18-3.6`, then `cd backend && DATABASE_URL=postgres://Trackfud:Trackfud@localhost:5432/Trackfud?sslmode=disable go run ./cmd/api`.
Frontends: `corepack pnpm install && corepack pnpm dev` in each `frontend-*` folder (Vite proxies `/api` to `localhost:8081`; run backend on 8081 or set `VITE_API_BASE`).

## What Milestone 1 includes

- **Backend B0+B1:** OpenAPI contract (`backend/api/openapi.yaml`), config, JWT (15 min) + per-app refresh cookies + RBAC, signup/login/refresh/logout/demo-login/verify-email, file presign + upload (live R2 presigned PUT + `POST .../complete` when `TF_R2_*` set, local disk otherwise), push subscriptions + VAPID (env pair wins) + Brevo/Mailpit email outbox (SMTP auth), River background workers (same-tx `InsertTx`, ByArgs dedup, 3 attempts), WS ticket + hub, Postgres+PostGIS schema + fictional seed. Security posture (2026-11-01): Argon2id passwords (bcrypt fallback + on-login upgrade), refresh rotation with reuse detection, Secure/HttpOnly/SameSite=Lax cookies, AES-GCM-sealed ID numbers (never returned, optional `TF_IDENC_KEY`), locked same-origin CORS, auth + webhook rate limits with `Retry-After`, HMAC webhook + `webhook_events` dedupe, 1 MiB JSON body cap — see `docs/milestone-checklist.md`.
- **Customer C1:** installable PWA shell, auth + demo login, delivery location (GPS/lat-lng/note, saved to server), restaurant list by distance with a live availability badge, menu (travels-well/pickup-only, 3 languages), cart, push subscribe + iPhone guide, offline banner. The badge is real presence, not a flag: `runners_bikers_nearby` renders only while an approved, non-busy courier holds an active work session positioned within the last 60 s inside the per-mode pickup radius (CMS-overridable); otherwise `staff_only`. Both endpoints serve `live_couriers_count`/`live_modes`/`live_nearest_m`, the list resolves all badges in one batched PostGIS query (no N+1), and the single shared `AvailabilityBadge` (Home float + detail tag, "Runners & bikers nearby" in en/id/ms, 30 s refetch) replaces the old hardcoded global count. Restaurant stars are real too: both endpoints serve the `rating_avg`/`rating_count` aggregate over collected `restaurant_stars` (one batched query, `rating_avg: null` while unrated), and the shared `RestaurantRating` renders `★ 4.6 (12)` — or `★ New` (`home.unrated`, en/id/ms) — on the Home card and the detail row; the old deterministic pseudo-rating is deleted. Category chips are API-driven (`GET /v1/customer/categories` + `?category=` on the restaurant list, per-merchant chips with `?category_id=` on the menu), and the order-history `showingOf` count interpolates via single-brace i18next config. Home + topbar follow the shared delivery point (chosen address → server default → stored device point, Jakarta only as last resort) via `features/addresses/useDeliveryLocation.ts`, so the header shows "Delivering to {label}" with a Change action instead of a stale generic link.
- **Courier R1:** auth, runner/biker onboarding with private photo uploads, draft auto-save (device + account), pre-run checklist (GPS/Wake Lock/mic/notifications/motion), GPS fitness-test recorder (live elapsed ticker, 0.5 m/s + 30 s moving rule matching the server) + submit → pending review → CMS decision, no manual test values. While under review the status page shows the already-submitted banner with disabled actions and `/courier/fitness` locks (server rejects new tests with 409); both live-update on the admin decision via WS + email/push.
- **Merchant M1:** auth, store setup (pin via click-map + lat/lng + address search, hours, prep), versioned Partner Agreement e-sign → pending (single submit: button disables after signing, banner shows signer + date/time; `GET /merchant/merchants/me/agreement`, idempotent POST). After review the agreement button tracks the decision (`Signed ✓ — approved/rejected`, email + push + WS `merchant.status` mirror it on screen). CMS approve/reject render only for a pending merchant with the signed agreement (hidden once approved; rejected shows the stored reason + updated_at); CMS courier/merchant detail cards use interactive fields (mailto/tel/maps/copy, structured address/contact/bike/consents, collapsible agreement, evidence photos).

Live keys (2026-11-01) with no-key fallbacks: file storage is R2 presigned URLs (5-min, public bucket menus/avatars, private bucket IDs/selfie/proof/agreements) behind the same presign contract — local disk when `TF_R2_ENDPOINT` is empty; jobs run on River workers with same-transaction enqueue — Mailpit/Brevo share the outbox path, Paddle stays sandbox + demo `simulate-paid`, Google Maps renders live tiles with a key and a schematic fallback without; real-phone PWA checks (install, push delivery, outdoor GPS) still need your phone — see `docs/` verify skills.

R2 CORS (browser uploads): the bucket's CORS policy must allow the app origin (e.g. `http://localhost:8000`), `GET, PUT, HEAD` **and the `Content-Type` request header** (AllowedHeaders `*` or `content-type`). Without the header rule the browser's presigned `PUT` fails its preflight (403, no CORS headers) and every upload — Snap-a-Menu, dish photos, ID documents — shows "Something went wrong".

## Paddle top-up / card checkout: server transaction first (2026-11-03)

Paddle Billing rejects amount-only checkout items with `required price_id` —
so the customer PWA never opens the overlay with an ad-hoc amount. The flow is
now: create the pending payment (`POST /v1/customer/wallet/topups` or card
`POST /v1/customer/orders`) → `POST /v1/customer/payments/{id}/checkout`
(server mints a Paddle transaction with `TF_PADDLE_API_KEY`, embedding
`custom_data.payment_id`) → `Paddle.Checkout.open({ transactionId })` →
`POST /v1/webhooks/paddle` credits/applies (HMAC-verified, deduped, idempotent
ledger). The PWA polls `GET /v1/customer/payments/{id}` after the overlay
closes — the webhook confirms asynchronously, so a slow webhook shows "check
payment status" instead of a double charge. Without `TF_PADDLE_API_KEY` the
checkout endpoint is 503 and demo mode (`TF_DEMO_MODE=true`) confirms
instantly via `POST /dev/payments/{id}/simulate-paid`. The webhook also
tolerates the live dashboard shapes (`notification_id`, `customData`,
`transaction.updated/paid`). Live-verified 2026-11-03 on sandbox: USD top-up
→ checkout 201 (`txn_01…`) → signed `transaction.completed` → payment `paid`,
wallet credited, replay deduped. Three live-only bugs fixed along the way:
inline `product` on the price (second `price_id` cause), `$4::jsonb` on the
webhook claim (pgx sends text; no implicit cast), and a `paddle_clearing`
exemption from the ledger non-negative floor (migration `00013` — the
receivable leg posts negative before settlement). **Paddle cannot charge IDR**
(verified against the live API allowlist) — checkout answers 422 with an
actionable message; IDR top-ups need a follow-up FX/rail decision. Card data
never touches our code. B5 stays
PARTIAL per plan (sandbox only, never real rails) — see
`docs/milestone-checklist.md`.

## IDR top-ups: Paddle charges USD, wallet gets full IDR (2026-11-03)

Paddle cannot charge IDR at all, so blocking it would lock out Indonesian
wallets. Instead the checkout converts: an IDR top-up is charged in USD at
the `fx_rates` rate (locked on the payment as
`charge_currency/charge_amount_minor/fx_rate`, surfaced as `fx_quote`), and
the webhook credits the **full IDR amount** — e.g. Rp100.000 → $6.17 Paddle
charge → +Rp100.000 wallet. Each currency nets to zero through the
`fx_position` bridge account (migration `00014`); `paddle_clearing` is the
receivable from Paddle. Live-verified on sandbox incl. replay-dedupe and a
USD regression. The PWA shows the conversion before paying
(`topup.fxNotice`, en/id/ms): "Paddle charges in $X … wallet gets the full
RpY". Rates refresh daily (`fxRefresh`); drift sits in the platform
position, no spread/fee modeled yet. Card orders in IDR convert the same
way; order-side notice copy is still a follow-up.

## Push VAPID keys: generate, don't hand-type (2026-11-01)

Web Push needs one matched P-256 pair in `backend/.env`. Random text can never
deliver — and now fails backend boot with a clear error instead of silently
breaking push (previously every queued push just failed at the push service;
since the `doPush` fix those failures also surface as retried River jobs).

Generate once (Node, no install): `npx -y web-push generate-vapid-keys` — paste
both lines from the SAME output into `TF_VAPID_PUBLIC_KEY` /
`TF_VAPID_PRIVATE_KEY` (see `backend/.env.example` for the full steps, verify
with `curl http://localhost:8000/api/v1/push/vapid-public-key`). Frontends need
nothing — they fetch the public key live. Leave both empty for local dev (the
server keeps a stable DB dev pair). Changing keys later means browsers must
re-subscribe on next visit.

## B5 money real paths: back-office withdrawals monitor

- **CMS `/back-office/withdrawals`** (new "Payouts" nav, admin-gated like every back-office route): lists mock payouts from `GET /v1/admin/withdrawals` with a status filter (all/pending/processing/held/paid/failed), per-card amount (integer minor units, `Intl` display only), courier/withdrawal IDs, hold/failure reasons, payout ref, and created-at.
- **Hold** posts `POST /v1/admin/withdrawals/{id}/hold` with a required, audit-logged reason (renders only for `pending`/`processing` rows — the server 409s anything else); **Release** posts `.../release` for `held` rows and returns them to the mock payout queue. All rows refetch from the server after each action; loading/error/retry/empty states included; layout stacks to one column on phones.
- Assumptions: money moves only through the audited API (the screen never touches balances); Paddle stays sandbox-only per plan §11, so "real paths" means the real backend endpoints + webhook/dedupe path, not real rails. `route-smoke`/`guard-smoke` cover the new route, contract paths, and hold/release gating — re-run them in `frontend-cms-admin/` after pulling (`npm run smoke`, `npm run guards`).

## A6 sanctions: freeze/unfreeze/ban end to end (PLAN P0, §4.4 + §8.4)

- **Backend:** `POST /v1/admin/couriers/{user_id}/sanctions` (freeze/unfreeze/ban, reason required for freeze/ban, unfreeze reason-optional like the merchant unban) and `POST /v1/admin/merchants/{id}/sanctions` (ban/unban with pre-ban restore) queue email + push and broadcast `courier.status` / `merchant.status` in the same transaction. Frozen/banned couriers cannot start work sessions (403 — PLAN "can't go online"), are excluded from dispatch candidates and offer accepts, and banned merchants drop out of the customer list (`status='approved'` filter). Every action lands in `courier_sanctions` / `merchant_sanctions` (kind, reason, note, prev-status, admin, time) — those tables are the per-case audit trail (A9 adds a unified `audit_logs` viewer on top of them). The admin queue/detail expose operational `standing`: `GET /v1/admin/courier-applications?status=frozen|banned` filters it, each row and the detail carry `standing`, and the courier self endpoints (`GET /courier/profile`, `GET /courier/application`) do too.
- **CMS:** the review queue filter adds frozen/banned and the badge shows standing over the review state (a frozen courier's application still reads approved); the detail standing panel (freeze/unfreeze/ban, ends-at, required reason, two-step confirm) keys off standing, with history from the API.
- **Courier PWA:** the account page, run setup (Go-online disabled) and delivery screens show the freeze/ban notice from `standing` (trilingual `account.frozen/banned/sanctionWallet`), live-update on the `courier.status` socket frame, and the wallet stays open — money already earned stays withdrawable per plan §8.4.
- **Merchant PWA:** the store status badge is green only when approved, so banned reads honestly.
- Assumptions: mid-delivery freezes finish the leg (only safety cases get reassigned, by a human); staff-shift deliveries are unaffected by courier sanctions; live ban round-trip + real-phone checks still need a device (re-run `go test ./...`, `tsc`, `smoke`, `guards` per app after pulling).

## A7 orders list + detail (PLAN P0, §4.4)

- **Backend:** `GET /v1/admin/orders` (status allowlist + `?limit=`, newest first; each row carries parties, money, and live dispatch state) and `GET /v1/admin/orders/{id}` (parties, items, full audit timeline with actor + reason, delivery, chat with translations/moderation flags, cheers, ratings, proof photo + AI checks, and the journal money trail). Reads reuse the same builders as the customer/merchant tracks (`orderView`, `orderItems`, `deliveryPublicView`), so all three frontends plus the CMS serve the same keys. `POST /v1/admin/orders/{id}/refund` (reason required, audit-logged in `order_events`) cancels pre-pickup orders with a full support refund: guarded `Transition()` to cancelled, escrow released via `refundLegsFor`, delivery cancelled, push + email to customer and courier. Contract in `backend/api/openapi.yaml` (`RefundInput`); pure policy (`parseOrderStatusFilter`, `adminRefundPlan`) unit-tested in `admin_orders_test.go`.
- **CMS:** new "Orders" nav with `/back-office/orders` (status-filtered queue) and `/back-office/orders/:id` (summary, audit timeline, delivery, chat, cheers/ratings, proof photo via the authed file API, money trail, two-step support refund that renders only for refundable orders). Validated parsers, `StatusBadge` tones for order/delivery states, loading/error/retry/empty states, responsive `tb-grid-2` cards that stack on phones. 2026-10-30 fix: the detail fetch passed the full `{"order": {...}}` envelope to the parser (previously double-unwrapped, so every real order showed "not found"); 404/403/load/unavailable states now show professional copy with the order reference plus Back-to-orders and Try-again actions.
- Assumptions: support sees both handover secrets (pickup code + customer PIN) to talk through stuck handovers; the refund covers pre-pickup cases only — picked-up orders need reassign/finance handling and settled (delivered) orders go through finance, and the UI says so; the event timeline + sanction tables are the per-case trail (A9 adds a unified `audit_logs` viewer on top). Live refund round-trip vs seeded backend + real-phone checks still need a device (re-run `go test ./...` in `backend/`, `npm run typecheck/smoke/guards` in `frontend-cms-admin/` after pulling).

## A8 dashboard live map + courier performance (PLAN P0, §4.4 + §8.6)

- **Backend:** `GET /v1/admin/dashboard` — today's numbers (placed/delivered/active, couriers online, pending applications/merchants, delivered GMV per currency) plus live courier dots (active work sessions with a fix in the last 5 min, each with its current delivery) and active orders (placed → picked_up with parties, dispatch state, dropoff). `GET /v1/admin/couriers/{user_id}/performance` — §8.6 over the last 30 days: acceptance/completion/in-window rates (null, never 0%, on empty windows), pickup-wait/delivery-leg timing, Bayesian rating + complaints per 100 + top tags/topics, distance/active minutes + WHO-week trend, overexertion guards (days over cap, 4 h+ sessions), ledger earnings + per-active-hour, anti-cheat flag count + latest, peer rank, and recent session/delivery history. All numbers come from the same tables the customer/courier/merchant tracks write — no new flow, so no PWA change. Contract in `backend/api/openapi.yaml` (`Dashboard`, `CourierPerformance`); pure rate policy unit-tested in `admin_a8_test.go`.
- **CMS:** `/back-office/` is now the ops overview (stat cards, live map, active-order list, 30 s auto-poll) and the review queue moved to `/back-office/review`; new admin-gated `/back-office/couriers/:userId/performance` (rate cards, WHO bars, flags table, history tables) linked from the courier detail ("View 30-day performance →"). The live map uses Google Maps JS when `VITE_GOOGLE_MAPS_KEY` is set (new `src/lib/maps.ts` loader with the same `importLibrary` readiness contract as the other apps) and a schematic SVG fallback without a key — reviewers always see the dots. The nav is slim with icons: four primaries + one System menu on tablets/desktops (≥720 px, wraps instead of scrolling), 320 px-safe icon bottom bar + grouped More sheet (repeats the signed-in email) on phones, and the avatar account menu visible at every width — all from one `NAV` list. Validated parsers, loading/error/retry/empty states, cards that stack on phones.
- Assumptions: the live window is 5 min (dispatch offers only inside 60 s, so the map is intentionally wider than the offer filter); peer percentile ranks delivered counts only; the courier PWA needs no change (live GPS + dispatch already feed the map). Live round-trip vs seeded backend + real-phone checks still need a device (re-run `go test ./...` in `backend/`, `npm run typecheck/smoke/guards` in `frontend-cms-admin/` after pulling).

## A9 platform controls: settings, audit, AI page, Ops Copilot (PLAN P0/P1/P2, §4.4 + §10.F)

- **Backend:** `GET/PUT /v1/admin/settings` — 28-key allowlist (fitness tests, qualification retry/gap, dispatch corridors/windows/speeds, order windows, fee bps, health goal) with `global` + `country:XX` scopes; range-checked, null clears back to `config.yaml`, every change audit-logged. Overrides apply without a restart: `GET /v1/config/public?country=` merges them (the numbers the courier fitness screen already renders — no PWA change), quoting uses per-merchant-country fee bps (`order.QuoteForRates`), fitness eval/dispatch/accept-timeout/health-goal all read effective values. `GET /v1/admin/audit` (action/target allowlists + paging, actor/reason/before/after) — every admin mutation writes both its case table and one `audit_logs` row. `GET /v1/admin/ai/calls` + `/summary` (model, latency, tokens, micro-cost, fallbacks — metadata only, never prompts). `POST /v1/admin/copilot/ask` (plain-words question → keyword-routed fixed read-only tools, deterministic offline answer + optional model wording with a `live` flag; the question never becomes SQL). Chat/text calls route to the Modal endpoint with `Authorization: Bearer $TF_MODAL_KEY.$TF_MODAL_SECRET` over a `/v1`-suffixed base, using the served model id (details in `backend/.env.example`). Contract in `backend/api/openapi.yaml`.
- **CMS:** new admin-gated `/back-office/settings` (scope picker, grouped editors, save/clear-to-default, effective-vs-default display), `/back-office/audit` (filters + paging), `/back-office/ai` (summary cards + calls table), `/back-office/copilot` (suggestions incl. the §10.F biker example, evidence tables, live/fallback badges). Validated parsers, loading/error/retry/empty states, `tb-grid-2` cards that stack on phones.
- Assumptions: fitness-test rules stay platform-wide (per-country scoping is for merchant-facing settings); list-valued tuning knobs stay on `config.yaml`; copilot answers are advisory like every other AI output — humans decide. `route-smoke`/`guards` cover the new routes, contract paths, and parser behavior — re-run them in `frontend-cms-admin/` after pulling (`npm run smoke`, `npm run guards`).

## R2 Run Mode + offers + delivery alignment (PLAN §3/§5/§6 flows)

- **Runner PWA (`/courier/`):** Run Setup opens the work session server-side first (`POST /courier/sessions` with mode + workout goal — the goal feeds dispatch workout-fit scoring; drawn saved tracks are pad sketches, never geography, so `planned_track` stays null). A 403 (frozen/banned) stays put with the notice; any other failure starts device-local with an honest offline badge whose GPS backlog auto-registers on reconnect. While a session is live the Run tab, the logo and direct `/run-setup` visits all land on `/run` — the courier must End session before starting anew. Run Mode streams `loc.batch` + HTTP fallback, shows the 30 s offer card (sound/vibration/voice/push, track-fit info, no decline penalty), refetches the full offer on each minimal `offer.created` socket ping, polls + renders offers whenever a session is recording (never gated on the local GPS/stale signal — eligibility is server-truth; GPS banners stay informational), and the first positioned batch after going online re-runs nearby open searches so late-online couriers still catch the food-ready wave, arms "head now" from the server `delivery.leave_now` nudge (local timer is the offline fallback), and closes the server session on end (lifetime totals fold in). The delivery screen confirms pickup with the merchant code, completes with the customer PIN or a photo, shows the live ETA + server route warning, and credits the wallet at once.
- **Backend:** every courier leg answers the `DeliveryEnvelope` contract (delivery + staff-aware payout + impact once delivered); empty `activeDelivery` is 404 "nothing assigned"; frozen/banned couriers can't auto-create work sessions through GPS ingest either. Dispatch broadcast frames stay minimal (ids + expiry) — the full offer always comes from `GET /courier/offers`, so frames stay small on a runner's radio. A courier who goes online after the accept/food-ready wave is re-offered: the first positioned ingest after invisibility enqueues deduped `dispatch_run` jobs for nearby open searches (`nudgeNearbySearches`), and `runCascade` stays the state-guarded decider. One active work session per courier: a repeated Go-online resumes the live session (`200` + `resumed: true`) instead of opening a second one.
- **CMS:** the back-office nav is grouped (Operate/Money/System) with icons: dual-fade scrollable top bar from tablet widths (≥720 px, group names compact ≤1023 px), 320 px-safe icon bottom bar + grouped More sheet (repeats the signed-in email) on phones, avatar account menu visible at every width (email + sign out) — all from the one `NAV` list.
- Assumptions: external Maps link instead of in-app turn-by-turn (plan §9), no Maps SDK polyline on the courier side, QR-confirm variant P1; mid-delivery freezes finish the leg (safety reassigns are human). Re-run `go test ./internal/app/` in `backend/`, `npm run typecheck/smoke/guards` + `vite build` in `frontend-runner-biker/` and `frontend-cms-admin/` after pulling; live end-to-end vs seeded backend + real-phone checks still need a device.

## R3 Voice Copilot + staff mode + health extras (PLAN §4.2)

- **Runner PWA (`/courier/`):** hold-to-talk Voice Copilot — mic → `AudioWorklet` 24 kHz Int16 PCM → `GET /v1/courier/voice` relay (URL honours `VITE_API_BASE`), with the local EN+ID command parser as the labelled offline fallback. Intents: accept (server-signed `voiceConfirm`, re-checked offer state), how-far, 2-min-away (posts to the customer thread); declining is never penalised. Offers, cheers, pace cues and per-km/mi splits are spoken aloud; translated chat + quick replies + on-device voice notes per delivery. Staff mode: email memberships + server shift clock, fallback offers only, no fitness test, tracked delivery, staff earnings in the same wallet — the Staff button shows only for invited accounts (`GET /courier/staff/memberships` non-empty) or active staff. The fitness test is a one-time gate: its nav tab and `/fitness` route hide once approved (or in staff mode), and the server rejects retakes with 409. Saved tracks (draw a loop, anchor it on Google Maps Strava-art style, snap to real roads, save/reuse at session start; the anchored track renders live on `/run` next to the GPS trail — sketch lengths stay rough estimates, the map placement lives on-device only, so `planned_track` stays null and only the goal travels to dispatch). Ratings received with live customer tag labels (names hidden). Health extras: weekly AI Coach report, WHO 150-min ring, lifetime totals, personal best + day streak, daily-cap/rest-day/hydration nudges, step-cadence display, and GPX export of the last run (PLAN P2, shipped early). Go-online is open to everyone — ordinary runners track free while dispatch offers only approved partners/on-shift staff.
- **Backend:** `POST /v1/courier/voice/confirm` answers the `DeliveryEnvelope` contract like every other courier leg; cheer (`cheerOrder`) and chat (`postMessage`) socket frames carry `text` + `lang`/`from` alongside the legacy `message`/`body` keys so old and new clients speak cheers and render threads; `GET /v1/courier/deliveries/history` serves per-delivery `courier_tags` (contract `DeliveryHistory.courier_tags`). **AI Run Planner (PLAN §10.E, P2 first stretch):** `GET /v1/courier/run-plans/hotspots` (approved merchants by 7-day volume, then distance — the same kitchens the customer list shows) and `POST /v1/courier/run-plans` (two workout-first closed loops ≤10 waypoints from a goal circle pulled toward hotspots, durations via the planning-speed estimate, earnings via fee math labelled `estimate`, corridor from effective dispatch, optional Muse Spark wording with `live` flag + heuristic fallback). The pick travels as GeoJSON `planned_track` on the next work session, so the plan drives the dispatch corridor with no dispatch change and no migration. Contract in `backend/api/openapi.yaml` (`RunPlanRequest/Hotspot/List`); pure loop/earnings/validation unit-tested in `run_planner_test.go`.
- **Runner planner UI:** full `/planner` page (mode + goal + GPS start + now/lunch/dinner window → two loops amber/white on the map with distance · time · estimate + reasoning, hotspot chips, schematic fallback) plus an inline panel in Run Setup for `trackKind === 'ai'` — the pick persists on-device, travels as `planned_track`, and renders live on `/run` next to the GPS trail. Trilingual `planner` strings (en/id/ms); no hardcode, estimates never promise.
- **CMS:** slim responsive nav — top bar shows four primaries (Overview, Review, Orders, Payouts) + one System menu (Settings, Audit, AI, Copilot) from the same single `NAV` list, so five slots fit tablets with room (no scroll-hack, no hidden labels); icon bottom bar (4 primaries + More) + grouped More sheet + always-visible avatar account menu unchanged; Esc/backdrop close, focus-visible + 44 px targets kept.
- Assumptions: legacy socket keys stay on the wire for old builds; tags default to `[]` when absent; customer names never reach couriers. Re-run `go test ./...` in `backend/`, `npm run typecheck/smoke/guards` + `vite build` in `frontend-runner-biker/` and `frontend-cms-admin/` after pulling; live voice-accept round-trip vs seeded backend + real-phone checks still need a device.

## Dispatch realtime + handover PIN (2026-10-31, PLAN §3/§5/§6 flows)

User report: couriers online at `/courier/run` never got a live offer after the merchant accepted; one order must reach exactly one courier and stay pending until handover; the merchant must hear at once when their order finds its courier; the customer↔merchant delivery PIN was confusing. No `PLAN.md` changes — alignment only.

- **Backend:** `acceptCore` now notifies all three sides in the same accept: push + `delivery.assigned` frame (courier first name + mode) to the merchant owner so the kitchen sees WHO accepted, `order.status` (with `delivery_status`) to customer + merchant + winner as before, and an explicit `offer.taken` frame to every other offered courier so a losing card clears at once instead of lingering to expiry. The atomic `UPDATE ... WHERE courier_id IS NULL` claim is unchanged — one order is still exactly one courier, and the leg stays pending through pickup until the customer handover. `GET /v1/merchant/orders` list rows now carry `courier_name`/`courier_mode` (null until assignment) from the same query, so the kitchen ETA line flips from "finding" to the courier's name without a second fetch. Contract note in `backend/api/openapi.yaml` (`Order.delivery`).
- **Runner PWA (`/courier/`):** Run Mode connects the offer socket itself (no longer relying only on the engine bind) and clears a losing card on `offer.taken` with the spoken "someone else took that order". New stationary heartbeat in `useRunEngine` (now `features/run/runTracker.ts`): the last GPS fix is re-buffered with a fresh timestamp every batch while online, so a courier waiting still keeps the server's 60 s dispatch window alive (zero distance — never invents movement). Delivery screen now labels the two codes by pair: step 1 merchant code (ask staff to show their screen, never the customer) → step 2 customer PIN (ask the customer face to face, never the merchant). Trilingual `delivery.stepPickup/pickupWho/stepDropoff/pinWho`.
- **Merchant PWA (`/merchant/`):** socket parses `delivery_status` on `order.status` plus the new `delivery.assigned` frame; on either, the kitchen gets a spoken + written "courier found" notice naming the courier and the queue refetches at once — the "finding a runner or biker" line is replaced by "{name} ({mode}) is on the way" the moment someone accepts. Pickup card now says the merchant code is for the courier only and the customer's delivery PIN is separate and never visible here. Trilingual `orders.courierAssigned/courierFoundKitchen/pickupCodeNote/showCode`.
- **Customer PWA (`/customer/`):** `PinHandover` rewritten around the three-pairs rule (pickup code = kitchen↔courier, never shown to you; delivery PIN = you↔courier, never shown to the merchant; never type either code in chat — say the PIN face to face). Staged states: waiting explainer before the PIN exists, reveal + copy with the never-in-chat warning while live, "Handed over — thanks" once delivered/completed instead of digits, hidden on cancelled/rejected. No dispatch change: `NoCourierPanel` choices already hide once the merchant accepts, and the courier card already swaps searching → profile on assignment.
- Verify: backend `go build` + `go vet` clean, `TestMerchantDeliveryLineShape` (+ courier identity) green, full `go test ./internal/app/` red ONLY on pre-existing `TestAdminRefundPlan` (untouched, documented since A7/A9); `tsc -b --noEmit` 0 on all three frontends; runner/customer/merchant smokes green (merchant needed 5 cancel-order keys restored to `ms.json`, missing since before this session). PostGIS integration UNRUN (one additive join column on an existing query). Live merchant-accept → courier-offer → single-accept → merchant-notified → PIN-handover round-trip vs seeded backend + real-phone checks UNVERIFIED.
- Assumptions: dispatch windows/corridors unchanged (nearby-courier rule still applies — test with the courier session live near the merchant); stale-GPS sessions still get no offers by design (the heartbeat only covers stationary-with-fix; a stale banner explains the pause).

## Food-ready courier wave (2026-10-31, PLAN §5/§6 flows)

Follow-up gap in the same flow: the courier search started at merchant *accept* only lived for the search window (4 min courier + 3 min staff), while kitchens cook ~15 min — by the "Ready" tap the search was dead and no nearby courier ever received the offer. Fixed end to end:

- **Backend:** `POST /v1/merchant/orders/{id}/ready` now starts a fresh courier-first wave when nobody has claimed the delivery yet (`restartCourierSearch` in `backend/internal/app/dispatch.go`): one guarded update flips an unclaimed delivery (`searching`/`offered`/`staff_searching`/`no_courier`, `courier_id IS NULL`) back to `searching` with a fresh clock, stale offer rows are expired and cleared so previously-offered couriers are eligible again (declining still never affects scoring), and `search_timeout` + `dispatch_run` are queued in the same transaction. Couriers near the kitchen at ready time get the real-time `offer.created` frame + push from the existing cascade; the customer gets a "Food is ready" push and every side gets the `order.status` broadcast. The customer's *wait 5 more minutes* choice reuses the same wave machinery. All waves now time out on the CMS-effective (A9) search window for the merchant's country via `searchWindow`. The one-courier promise is unchanged and pinned by tests: a claimed delivery can never re-enter a wave (`canRestartCourierSearch` + `restartCourierSearchSQL` guards in `dispatch_test.go`).
- **Runner PWA (`/courier/`):** the GPS "stale" flag now follows the server's liveness rule — the stationary heartbeat re-buffer counts as fresh, so a courier waiting near a kitchen (no `watchPosition` callbacks while still) no longer has offers silently blocked; a genuinely dead GPS stream still pauses offers with the banner.
- **Merchant PWA (`/merchant/`):** a `ready` order with no courier yet honestly reads "Finding a runner or biker…" (was "notified") until a real assignment names one; the pickup card adds the two-step handover explainer (`orders.pickupStep`, en/id/ms): step 1 you show the merchant pickup code, step 2 is the customer's own door PIN — never yours.
- **Customer PWA (`/customer/`):** checkout explains the delivery PIN before payment (`checkout.pinNote`, en/id/ms): your private 4-digit code, given only to your courier face to face at your door; the restaurant never sees it and the courier uses a different code with the kitchen.
- Verify: `go build ./...`, `go vet ./...`, `go test ./...` all green in `backend/` (incl. new `TestCanRestartCourierSearch`); `npm run build` + route smokes green on customer/merchant/runner-biker. One pre-existing failure fixed along the way: `adminRefundPlan` now names the terminal state before the already-refunded check (`TestAdminRefundPlan`). No contract change (`ready` response shape unchanged) and no migration. Live ready→offer→accept round-trip against a seeded backend + real-phone checks remain UNVERIFIED.
- Assumptions: prep longer than the search window is the normal case, so ready-wave offers are the primary path and the accept-time wave covers quick kitchens; couriers who declined an earlier wave may be re-offered at ready (circumstances changed — food is packed and they may be closer); a customer who already switched to self-pickup (`customer_pickup`) never re-enters dispatch.

## Scroll pagination on every order/history queue (2026-10-31)

Order/history lists used to load everything at once. Every `GET` list now scroll-pages 10 rows at a time under one shared contract, and all four PWAs infinite-scroll it.

- **Backend:** one equalized helper (`backend/internal/app/pagination.go`) behind 9 handlers — customer orders + wallet top-ups, merchant orders, courier delivery history + withdrawals, admin orders + courier-applications + merchants + withdrawals: `?page=` (default 1, garbage → 1), `?per_page=` (default 10, clamped 1–100; legacy `?limit=` honored only when `per_page` is absent), `?status=` (allowlist, 400 otherwise), `?q=` (LIKE-escaped free text, 64 chars max, 400 otherwise). Envelope `{rows-key, page, per_page, total, has_more}` with `has_more = page*per_page < total`; every `COUNT` mirrors its list `WHERE` clause; `LIMIT`/`OFFSET` stay bound parameters (no injection surface). Contract in `backend/api/openapi.yaml`; `parsePage/PerPage/Pagination/HasMore/Search` unit-tested (`pagination_test.go`).
- **CMS:** orders queue (code/email/merchant search + status filter + server total), withdrawals queue (status filter, hold/release preserved), partner-review dashboard (courier + merchant queues, per-tab debounced search + server totals, merchant 404-degradation kept) — all `useInfiniteQuery` with an IntersectionObserver sentinel + visible Load-more fallback (`LoadMore`, `useDebouncedValue` in `components/ui.tsx`).
- **Merchant kitchen:** queue scroll-pages newest-10-first with live alarm/voice/push/WS/polling untouched (page 1 is always the live edge); i18n `orders.loadMore/showingOf` (en/id/ms).
- **Courier:** delivery history + withdrawals paginate; wallet sync keeps the newest page while the IDB ledger stays the offline mirror; ratings aggregate across pages (50/page, 20-page cap) so a long career still averages every rated delivery.
- **Customer:** order history scroll-pages with debounced code search + server total; top-ups endpoint paginates too.
- Assumptions: audit log + AI-calls lists keep their existing limit/offset behavior (deliberately out of scope); merchant live visibility comes from page 1 + refetch, not from deeper pages. Verify: `go build` + `go vet` + `go test ./...` green in `backend/`; `tsc -b --noEmit` + `vite build` green on all four frontends; CMS `smoke` + `guards` green. Live seeded-backend + real-phone scroll checks UNVERIFIED.

## Courier Orders list + detail (2026-11-01)

User report: delivered legs had no list/detail and cancelled legs were invisible — couriers couldn't see their own history.

- **Backend:** `GET /v1/courier/deliveries/history` now serves delivered + cancelled legs (payout 0 + `cancel_note` on cancelled, `status`/`created_at` per row, newest-first by `COALESCE(delivered_at, created_at)`), same scroll envelope, plus `?status=` (all/delivered/cancelled allowlist, 400 otherwise) and `?q=` (order code / restaurant name) on top of the shared `pagination.go` helper. No new endpoint — detail reuses `GET /v1/courier/deliveries/{id}` (owner-checked, 403 otherwise). Contract in `backend/api/openapi.yaml`. Ratings aggregation unchanged (unrated cancelled rows contribute no stars).
- **Runner PWA (`/courier/`):** new partner-gated Orders tab + `/orders` and `/orders/:id` routes (`RequirePartner` — approved partners and on-shift staff only; the active leg stays on `/delivery`, linked from a live banner). The list scroll-pages 10/page from an IntersectionObserver sentinel with status pills + debounced search, skeleton cards + inline loader, error/retry + empty states; the detail shows the payout hero, distance/active/ETA, timeline, pickup note/address, and route warning. Hi-fi `.tb-order`/`.tb-timeline`/`.tb-loader` styles (1-col → 2-col grid ≥720 px); trilingual `orders` namespace + `nav.orders` (en/id/ms, parity-checked); `route-smoke.mjs` +14.
- Verify: `pnpm typecheck` + route smoke green in `frontend-runner-biker/`; `go vet` + targeted backend tests green. Full `go test ./...` re-run + live seeded-backend + real-phone checks UNVERIFIED.
- Assumptions: history shows terminal legs only (searching/offered/active stay on `/delivery`); cancelled payouts settle nothing.

- **Backend:** `GET/PUT /v1/admin/settings` — 28-key allowlist (fitness tests, qualification retry/gap, dispatch corridors/windows/speeds, order windows, fee bps, health goal) with `global` + `country:XX` scopes; range-checked, null clears back to `config.yaml`, every change audit-logged. Overrides apply without a restart: `GET /v1/config/public?country=` merges them (the numbers the courier fitness screen already renders — no PWA change), quoting uses per-merchant-country fee bps (`order.QuoteForRates`), fitness eval/dispatch/accept-timeout/health-goal all read effective values. `GET /v1/admin/audit` (action/target allowlists + paging, actor/reason/before/after) — every admin mutation writes both its case table and one `audit_logs` row. `GET /v1/admin/ai/calls` + `/summary` (model, latency, tokens, micro-cost, fallbacks — metadata only, never prompts). `POST /v1/admin/copilot/ask` (plain-words question → keyword-routed fixed read-only tools, deterministic offline answer + optional model wording with a `live` flag; the question never becomes SQL). Chat/text calls route to the Modal endpoint with `Authorization: Bearer $TF_MODAL_KEY.$TF_MODAL_SECRET` over a `/v1`-suffixed base, using the served model id (details in `backend/.env.example`). Contract in `backend/api/openapi.yaml`.
- **CMS:** new admin-gated `/back-office/settings` (scope picker, grouped editors, save/clear-to-default, effective-vs-default display), `/back-office/audit` (filters + paging), `/back-office/ai` (summary cards + calls table), `/back-office/copilot` (suggestions incl. the §10.F biker example, evidence tables, live/fallback badges). Validated parsers, loading/error/retry/empty states, `tb-grid-2` cards that stack on phones.
- Assumptions: fitness-test rules stay platform-wide (per-country scoping is for merchant-facing settings); list-valued tuning knobs stay on `config.yaml`; copilot answers are advisory like every other AI output — humans decide. `route-smoke`/`guards` cover the new routes, contract paths, and parser behavior — re-run them in `frontend-cms-admin/` after pulling (`npm run smoke`, `npm run guards`).

## Customer locale + PIN-done copy fix (2026-11-01)

User report: a delivered order showed the literal `pin.done`, and `customers/orders` showed `track.showingOf` / `track.searchOrdersPh` instead of the count and search box copy.

- **Customer PWA (`/customer/`):** restored the 13 per-locale keys the code already called (`home.{all,categories,change,deliveringTo,noLocationSet,noMatch}`, `menu.{all,categories}`, `checkout.pinNote`, `track.{couriers,searchOrders,searchOrdersPh,showingOf,loadMore}`, `pin.{done,doneSub,howItWorks,neverChat}` in en/id/ms). The delivered PIN card keeps the ✓ but now shows `pin.done` as a bold "Handover complete — PIN accepted, enjoy your meal!" headline plus `pin.doneSub` (code now inactive, rate below); the orders list renders "Showing {shown} of {total} orders" with the "Search by order code…" placeholder. Verify: customer `node scripts/smoke.mjs` all-pass, `npm run typecheck` clean; no backend/contract change. Live checks UNVERIFIED.

## Real-time honesty: live courier dot, API impact line, courier push opt-in (2026-11-03)

- **Customer PWA (`/customer/`):** the tracking map now moves on the backend's `courier.location` WS frames (one per accepted courier GPS batch, ~5 s) instead of waiting for the 10 s poll: `parseWsCourierLocation` validates the frame, `useLiveOrder` (was `useLiveOrderStatus`, same socket, same `order.status` invalidation) ignores other orders and writes `delivery.courierLast` into the cached order, and `LiveMap` eases the marker as before. The poll stays the fallback on its own clock (WS writes keep `dataUpdatedAt`, so they never postpone it), and a poll that lands after a fresher fix never drags the dot back (same courier only). The Home quote is no longer the hardcoded "You powered 2.4 km of Rina's run.": `ImpactQuote` reads `GET /v1/customer/impact` and shows the latest measured carry ("You powered 2.4 km of Rina's workout.", km/mi formatter, en/id/ms), a non-numeric invitation before the first delivery, and nothing otherwise.
- **Runner PWA (`/courier/`):** couriers now actually subscribe to Web Push. `src/lib/push.ts` (`subscribeOfferPush`): permission inside the tap → service worker (skips in dev, where none is registered) → `GET /push/vapid-public-key` → `pushManager.subscribe` (reuses a same-key subscription, renews on a rotated key) → `POST /push/subscribe {app: "courier", subscription}`. Fired without awaiting from the Run Setup "Go online" tap (never blocks or fails going online; outcomes logged) and from the /checklist notifications row, which now ticks only once the device is subscribed. Denied/unsupported skip silently.
- No backend/contract change. Verify: `corepack pnpm typecheck` + `smoke` + `build` green in `frontend-customer/` and `frontend-runner-biker/`. Live checks (dot moving on a real run, push arriving on a phone) UNVERIFIED.
