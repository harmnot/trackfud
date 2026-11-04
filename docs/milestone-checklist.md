# Trackfud Milestone Checklist — done vs plan

Date: 2026-10-30 · Source of truth: `AGENTS.md` (+ per-app `AGENTS.md`).
Method: code inspection of this repo on 2026-10-30 (routes, files, deps, configs).
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
| B1 auth/users/files/notify                     | DONE                           | signup/login/refresh/logout/demo-login/verify-email; `files/presign` + upload (R2 live presign + `POST .../complete` when `TF_R2_*` set, local disk otherwise); push subscriptions + VAPID (env pair wins) + Brevo/Mailpit outbox (SMTP auth + header guard); WS ticket + hub; seed (`internal/app/seed.go`, `cmd/simulator`)                                                                                                                                                                                                                                                                                                                 |
| B2 merchant + catalog + order machine + ledger | DONE                           | Merchants (geo `location`, hours, prep), versioned agreement e-sign + staff invite/roles, menu CRUD with `size_class`/`travels_well`; guarded `Transition()` + `order_events` + merchant-timeout jobs + WS broadcast; integer-minor-unit double-entry ledger + idempotency + refunds; `order_test.go`, `ledger_test.go`, `money_test.go`                                                                                                                                                                                                   |
| B3 courier onboarding + sessions + GPS         | DONE                           | Application autosave, config-driven fitness-test eval (moving time, 2× elapsed cap, gap rules), WS `loc.batch` + HTTP fallback, session stats (distance/moving/active/pace), approve/reject + email + push, sanctions tables; `fitness_test.go`, `ingest_test.go`                                                                                                                                                                                                                                                                                       |
| B4 dispatch + delivery completion              | DONE                           | PostGIS `DispatchCandidates`, Go scoring + cascade, atomic accept, offer/search/staff timeout jobs, "leave now" nudge, pickup code + PIN/photo handover, settlement, 72 h auto-complete, live broadcasts, Routes API ETA (WALK/BICYCLE + beta warning) with planning-speed estimate fallback; `dispatch_test.go`                                                                                                                                                                                                                                        |
| B5 money real paths + staff fallback + social  | PARTIAL                        | Paddle sandbox top-up + direct pay, HMAC webhook + dedupe, mock `payout_process` withdrawals + hold/release (CMS monitor UI DONE under A5 this session — smoke re-run pending), staff fallback, no-courier choices, separate ratings, WHO minutes + impact aggregates — all present; "PARTIAL" only because money moves via sandbox + `dev/payments/simulate-paid`, never real rails (per plan)                                                                                                                                                                                                                            |
| B6 AI + simulator + demo controls              | DONE (Modal-routed 2026-10-28) | `internal/ai` (client, prompts, schemas, tools, transcribe, voice, SAM) + jobs (menu import, translate, trust brief, proof check, feedback labels) + `ai_calls` logging + offline fallbacks; voice relay + confirm; `cmd/simulator` + demo controls + judge logins. Chat/text routes to the Modal endpoint via the `Modal-Key`/`Modal-Secret` pair (`TF_MODAL_KEY`/`TF_MODAL_SECRET`, `config.yaml ai:` block); Meta direct remains an env override. OPEN: confirm the served model id + one live smoke call with the token pair (see "AI plan change") |

## Customer (`frontend-customer/`, `/customer/`)

| Milestone                     | Status  | Evidence / notes                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 shell + location + browse  | DONE    | PWA shell + manifest (`/customer/`), `sw.ts`, auth + one-click demo login, `X-TF-App: customer`, GPS/Places/pin/note location, distance-sorted restaurant list + availability badge, trilingual menu (en/id/ms) + "show original", cart, push subscribe + iPhone guide, offline banner                                                                                                                                           |
| C2 cart + pay + live tracking | DONE (code; device UNVERIFIED) | Quote + 30–60 min promise pre-pay, idempotent wallet pay, Paddle checkout via CDN lazy-load (`features/orders/pay.ts`), `awaiting_payment` → `placed`, status timeline, courier profile + history, customer-only PIN, push `order.status` + 10 s live poll — DONE. Live map is now real Google Maps JS (`features/tracking/LiveMap.tsx`): same `VITE_GOOGLE_MAPS_KEY` CDN loader path as the address picker (shared `lib/maps.ts`), Advanced-Marker courier dot (photo/initial) animated between GPS fixes, server `route_polyline` decoded locally (straight-line fallback when empty), Google-required WALK/BICYCLE beta disclaimer rendered from `route_warning`, schematic SVG fallback without a key. `DeliveryInfo` parses the full contract shape (`eta_s`, `route_polyline`, `route_warning`, `courier_last`) the backend already serves — no contract change. No `@vis.gl` dependency needed. Still OPEN: live end-to-end vs seeded backend + real-phone PWA checks |
| C3 post-delivery + edge cases | DONE    | PIN handover UI, separate courier/restaurant ratings, impact card + page, no-courier wait/pickup/refund, translated chat + quick replies, send-a-cheer, history + receipt view, empty/error/loading states, reconnect + backlog resend                                                                                                                                                                                           |

## Courier (`frontend-runner-biker/`, `/courier/`)

| Milestone                                     | Status  | Evidence / notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1 onboarding + pre-run + fitness test        | DONE    | Signup, runner/biker choice, pre-run checklist (GPS/Wake Lock/mic/notifications/motion), fitness recorder + 1 checkpoint photo, IndexedDB draft autosave, R2-presigned doc uploads (shrunk ≤1600 px), status screen                                                                                                                                                                                                                                                                                                                                                            |
| R2 Run Mode + offers + delivery               | DONE (code; live + device UNVERIFIED) | Session start (goal, free/saved-track, AI-track placeholder), big Run Mode stats, WS `loc.batch` + HTTP fallback + IndexedDB buffer (real `ts`, UUID/point), offer card (sound/vibration/voice/push, 30 s timer, track-fit info), "head to restaurant" nudge, route + "Open in Google Maps", pickup-code confirm, PIN/photo completion, wallet + mock withdraw, "Earned & moved" summary + WHO ring + cap/rest/hydration nudges — DONE. Server session opens first (`POST /courier/sessions`, goal reaches workout-fit scoring, 403 frozen stays put, offline device-local fallback honestly labelled), closes on end (`POST .../end`, lifetime totals fold in); socket `offer.created` pings refetch the full pending offer; server `delivery.leave_now`/`delivery.eta` drive head-now + live ETA; every courier leg answers the `DeliveryEnvelope` contract (payout included); frozen/banned couriers can't slip back via GPS auto-create; empty active leg is 404. Simplifications per plan: external Maps link instead of in-app turn-by-turn (§9), no Maps SDK polyline on the courier side, QR-confirm variant P1 |
| R3 Voice Copilot + staff mode + health extras | DONE (code; live + device UNVERIFIED) | Hold-to-talk → `AudioWorklet` 24 kHz PCM → `GET /courier/voice` relay (`voiceConfirm` now answers the `DeliveryEnvelope` contract like every other courier leg) with the local EN+ID parser as the labelled offline fallback; `VITE_API_BASE`-aware relay URL; socket cheer/chat frames carry both shapes (`text` + legacy `message`/`body`, `lang`) so spoken cheers + translated thread updates land on old and new clients; voice intents accept/how-far/2-min (accept server-confirms, decline penalty-free, etaSoon posts to the customer thread); offers/cheers/pace-cues spoken aloud, per-km/mi split cues in-run; translated chat + on-device voice notes; staff mode (email memberships + server shift clock, fallback offers only, no fitness test, tracked delivery, staff earnings in the same wallet); saved tracks (draw/save/reuse at session start, rough-length honest); ratings received with live tag labels (`courier_tags` aggregated per tag from `GET /courier/deliveries/history` — names hidden by contract); step-cadence display; weekly AI Coach + WHO ring + lifetime + personal best + streak + daily-cap/rest-day/hydration nudges; GPX export of the last run (P2, shipped early as a bonus); AI Run Planner DONE 2026-10-31 (dated section below); Go-online open to everyone (ordinary runners track free, dispatch offers only approved partners/on-shift staff); locales en/id/ms identical. Runner route-smoke +11, CMS route-smoke +4 / guards +2 (nav) |

### Courier flow fixes (2026-10-31, code DONE; live UNVERIFIED)

| Fix | Change | Evidence |
| --- | ------ | -------- |
| Fitness hidden after approval | Fitness nav tab + `/fitness` route hide once `partner === 'approved'` (or staff mode); approved renders an approved stamp + status link; server `POST /courier/fitness-test` rejects `approved` with 409 | `frontend-runner-biker/src/App.tsx` (`RequireFitnessVisible`, `hideFitness`), `features/fitness/FitnessPage.tsx` (`gateClosed` + `fitness.approved` en/id/ms), `backend/internal/app/catalog.go` |
| Staff button invite-only | Run-setup Staff shortcut renders only when `GET /courier/staff/memberships` is non-empty (or staff active); `/staff` page itself unchanged (still explains how to get invited) | `frontend-runner-biker/src/pages/RunSetupPage.tsx` (`PartnerShortcuts`) |
| Single live session | Run tab / logo / `/run-setup` route all land on `/run` while `phase === 'active'`; repeated Go-online resumes server-side (`200` + `resumed: true`) | `frontend-runner-biker/src/App.tsx` (`RequireNoActiveRun`, `runTo`), `pages/RunSetupPage.tsx`, `backend/internal/app/sessions.go` |
| Tracks sketch-to-map (Strava-art) | Draw pad followed the finger mirrored (SVG `100 - y` flip + `e.target` box): fixed — shared-box `currentTarget` measure, no Y flip, coalesced points, pointer capture + cancel handling. Sketch now anchors on Google Maps at the runner's GPS fix (0.5/1/2 km loop size, walking/cycling), previews live on an embedded map, snaps to real roads via Directions (white followable line; amber sketch stays when routing fails), opens the route in Google Maps, and saves the placement device-locally with per-track map previews. Follow-up (2026-10-31): pad aspect measured at draw time so meters-per-pixel match on both axes (a drawn circle stays a circle on any screen); `/run` renders the saved track live — planned route + moving GPS trail and position dot with follow mode (`LiveTrackMap`, map created once, trail/dot update in place); run setup passes the track by id (`trackId`, name fallback) — dispatch contract unchanged (`planned_track` stays null, only the goal travels) | `frontend-runner-biker/src/pages/{TracksPage,RunModePage,RunSetupPage}.tsx`, `features/tracks/{sketchToGeo,snapRoute,TrackMap,LiveTrackMap,useMapView,trackStore}.ts(x)`, `features/run/{types,sessionStore}.ts`, `lib/db.ts` (`TrackRow.geo.aspect`), `locales/{en,id,ms}.json` (tracks + live-route keys, parity-checked), `index.css` (`.tb-map`), `scripts/route-smoke.mjs` +17 |
| Late-online offers (GPS-locked but nothing arrives) | Two-sided: (1) Run Mode no longer gates offer display/poll on the local GPS/stale signal — `takeOffer`/`refetchOffer`/`pollOnce` fire whenever a session is recording with no active delivery, because eligibility is server-truth (fresh batch < 60 s, approved, corridor) and the local signal can lag the server (backgrounded timers, slow first fix) while a real pending offer waits; GPS/stale banners stay informational only. (2) Backend re-runs open searches when a courier becomes visible late: the first positioned ingest after invisibility (`!HasLast` or back from stale) enqueues deduped `dispatch_run` jobs for `searching`/`offered` deliveries near the courier (`nudgeNearbySearches`, trigger bound = largest configured to-pickup radius); `runCascade` stays the state-guarded decider. No contract change, no new endpoints | `frontend-runner-biker/src/pages/RunModePage.tsx` (offer guards + comments), `backend/internal/app/dispatch.go` (`nudgeNearbySearches`), `backend/internal/app/sessions.go` (ingest hook) |
| Courier Orders list + detail (2026-11-01) | Cancelled legs were invisible and delivered legs had no list/detail. New partner-gated `/orders` (bottom-nav tab, approved partners + on-shift staff only) with scroll pagination (10/page sentinel), `?status=` all/delivered/cancelled pills + debounced `?q=` search (order code / restaurant), skeleton cards + inline loader, error/retry + empty states, live-leg banner linking back to the untouched `/delivery` page; `/orders/:id` detail (payout hero, distance/active/ETA, timeline, pickup note/address, route beta warning) via existing `GET /courier/deliveries/{id}`. Backend `listDeliveryHistory` now serves delivered + cancelled (payout 0 + `cancel_note` on cancelled, `status`/`created_at` per row, newest-first by `COALESCE(delivered_at, created_at)`), same scroll envelope; contract + `DeliveryHistory` schema updated. Ratings aggregation unchanged (unrated cancelled rows contribute no stars). Hi-fi `.tb-order`/`.tb-timeline`/`.tb-loader` styles, 1-col → 2-col grid ≥720 px; locales en/id/ms identical (43 `orders` keys + `nav.orders`) | `frontend-runner-biker/src/pages/{OrdersPage,OrderDetailPage}.tsx`, `features/orders/useCourierOrders.ts`, `features/delivery/courierApi.ts` (`DeliveryHistoryStatus`, `fetchDeliveryDetail`), `App.tsx` (nav + `RequirePartner` routes), `app/routes.ts`, `locales/{en,id,ms}.json`, `index.css`, `scripts/route-smoke.mjs` +14; `backend/internal/app/money.go` (`listDeliveryHistory`), `api/openapi.yaml` (`status`/`q` params + row fields) |

Remaining: runner-biker `pnpm typecheck` + `route-smoke.mjs` (+14 orders checks) green 2026-11-01; backend `go vet` + targeted `go test ./internal/app/ -run 'TestRoutesRegister|TestMockPayout'` green this session; full `go test ./...` re-run pending; live round-trip vs seeded backend + real-phone checks UNVERIFIED.

## Merchant (`frontend-merchant/`, `/merchant/`)

| Milestone                             | Status | Evidence / notes                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 signup + setup + agreement + staff | DONE   | Business profile, click-map draggable lat/lng pin + geolocation + search + editable fields + pickup note, hours/prep in merchant timezone, versioned Partner Agreement e-sign (staff-fallback clause) → pending screen, staff invite + `can_deliver`/`on_shift` toggles                                 |
| M2 Snap-a-Menu + menu management      | DONE   | Photo shrink ≤1600 px → server import-job polling → editable review table (low-confidence highlight, "prices checked" tick gates publish), multilingual items, sold-out toggle, size/travels-well labels + pickup-only badge, full menu CRUD, busy mode / pause store (`features/menu/extras.ts`) |
| M3 live order operations              | DONE   | Loud alert (sound unlocked on "Start receiving orders" tap) + push, accept + prep time / reject, order queue + courier ETA, Ready button, pickup-code confirm, handover done state, staff-fallback notices, earnings + weekly statements (mock payout note). Printer/promos (P2) cut per plan           |

## Admin CMS (`frontend-cms-admin/`, `/back-office/`) — plan vs PLAN.md §4.4

Seed with the canonical CMS admin (`admin@example.com` / `trackfud123`, `X-TF-App: cms`)
from the seed-test-data skill; backend serves every DONE row below.

| Milestone | Status | Evidence / notes |
| --------- | ------ | ---------------- |
| A1 admin login + gate | DONE | Login-only page (no signup): email `@` + password min-8 validation mirroring `auth.go`, non-admin role refused with notice, `RequireAdmin` redirects unauthenticated to `/login`, logout calls `/auth/logout` + clears session (`src/features/auth.tsx`, `src/App.tsx`); login reuses `POST /v1/auth/login` |
| A2 courier review queue + detail + Trust Brief + approve/reject (PLAN P0) | DONE | Tabs + pending/approved/rejected/all filter + counts + skeleton/retry, all rows from `GET /v1/admin/courier-applications`; detail uses new `GET /v1/admin/courier-applications/{user_id}` (personal + documents + fitness + saved profile, encrypted ID never returned) + advisory `.../trust-brief`; approve / two-step reject with required reason. 2026-10-30: DecideBox renders only while decidable (pending/pending_review/passed_test) — approved hides it with an approval stamp, rejected shows reason + updated_at; address/contact/bike/consents are interactive blocks (mailto/tel/copy/chips) instead of JSON dumps; detail split into `src/features/detail/` modules behind the `src/features/detail.tsx` barrel |
| A3 merchant review queue + detail + approve/reject (PLAN P0) | DONE | Same queue pattern on new `GET /v1/admin/merchants` (status allowlist, limit 1–100); detail on new `GET /v1/admin/merchants/{id}` (business + operations + hours + agreement + staff); transactional `POST .../approve\|reject` (reject-reason required, 409 on non-pending, idempotent re-approve, merchant role grant, email + push queued); `requireRole(admin)` on all five new routes, contract in `backend/api/openapi.yaml`. 2026-10-30: new migration `00010_merchant_review.sql` adds `reject_reason` + `updated_at` (parity with `courier_applications`); decide/sanction persist both, detail returns both; DecideBox renders only for pending + signed agreement (hidden once approved; rejected shows reason + updated_at); hours/staff/agreement/location are interactive (HoursList, StaffList, collapsible agreement, Maps link) |
| A4 test accounts incl. CMS admin | DONE | `SeedTestAccounts` seeds `admin@example.com` (role `admin`, password `trackfud123`, idempotent with the courier/merchant/customer accounts); skill doc updated (all-four wording + cms login check) |
| A5 withdrawals monitor UI (PLAN P1) | DONE | New modular `frontend-cms-admin/src/features/withdrawals/` (`types.ts` validated rows + minor-unit formatter, `api.ts` list/hold/release helpers, `WithdrawalsPage.tsx` status filter + hold-with-required-reason + release + loading/error/retry/empty states); admin-gated `/withdrawals` route + "Payouts" nav; `StatusBadge` tones for paid/held/processing/failed/cancelled; `route-smoke` +9 checks, `guards` +7 checks (UNVERIFIED run — shell unavailable in this session, re-run `node scripts/route-smoke.mjs` + `guard-smoke.mjs`) |
| A6 sanctions UI — freeze/unfreeze/ban (PLAN P0) | DONE (code; live UNVERIFIED) | Backend gates (work sessions 403, dispatch/accept approved-only, banned merchants unlisted) + `standing` on queue/detail/self endpoints + CMS freeze/unfreeze/ban panel with frozen/banned queue filters + courier PWA freeze/ban notices (wallet stays open) + merchant badge fix — see "Sanctions end-to-end" (2026-10-30). Remaining: live ban round-trip vs seeded backend + real-phone checks |
| A7 orders list + detail (PLAN P0) | DONE (code; live UNVERIFIED) | New backend `GET /v1/admin/orders` (status allowlist + limit, parties + dispatch state per row) + `GET /v1/admin/orders/{id}` (items, audit timeline with actor/reason, delivery, chat + translated/moderated, cheers, ratings, proof + checks, journal money trail) reusing the customer/merchant builders (`orderView`, `orderItems`, `deliveryPublicView`) so all tracks serve the same keys; new `POST .../refund` (reason required) — guarded `Transition()` to cancelled, escrow via `refundLegsFor`, delivery cancelled, push + email; contract in `openapi.yaml` (`RefundInput`); `TestParseOrderStatusFilter` + `TestAdminRefundPlan`. New modular `frontend-cms-admin/src/features/orders/` (`types.ts` validated rows/detail + `formatMinor` hoisted to `lib/format.ts`, shared by withdrawals; `api.ts`; `OrdersPage.tsx` queue; `OrderDetailPage.tsx` summary/timeline/delivery/chat/social/proof/money/refund); admin-gated `/orders` + `/orders/:id` routes + "Orders" nav; `StatusBadge` tones for order/delivery states; `route-smoke` +10, `guards` +12 incl. direct validator tests. Pre-pickup refunds only (picked_up → reassign/finance, delivered → finance) — see README A7. 2026-10-30 fix: `fetchAdminOrder` passed `d.order` into `parseAdminOrderDetail(d.order)` so every detail double-unwrapped the `{"order": {...}}` envelope and parsed to null ("not found" on real orders) — now passes the full envelope and the parser also accepts an already-unwrapped detail; `OrderDetailPage` replaces the raw "not found on this backend" note with professional 404/403/load/unavailable cards (order reference + Back to orders + Try again), trims + encodes the id, and the refund failure log carries the order id. Remaining: `go build/vet/test` + `tsc` + smoke re-run PENDING (shell unavailable in-session), live refund round-trip vs seeded backend + real-phone checks UNVERIFIED |
| A8 dashboard live map + numbers, courier performance (PLAN P0) | DONE (code; live UNVERIFIED) | New backend `GET /v1/admin/dashboard` (today's counts + live courier dots + active orders in one call) + `GET /v1/admin/couriers/{user_id}/performance` (§8.6: 30-day acceptance/completion/in-window rates as fractions-or-null, pickup/delivery timing, Bayesian rating + complaints/100 + tags/topics, distance/active + WHO-week trend, overexertion guards, ledger earnings + per-active-hour, flag count + latest, peer rank, session/delivery history) — all numbers from the same tables the three PWAs write, no PWA change; `requireRole(admin)` on both, contract in `openapi.yaml` (`Dashboard`, `CourierPerformance`), pure rate policy tested (`admin_a8_test.go`: `TestPerfRate`, `TestPerfWindowDays`). New modular `frontend-cms-admin/src/features/overview/` (validated `types.ts`/`performance.ts` + `api.ts` + `OverviewPage.tsx` stat cards + `LiveMap.tsx` + `PerformancePage.tsx`) + `src/lib/maps.ts` (single-flight Maps loader, `importLibrary` readiness + `gm_authFailure` distinction, schematic SVG fallback without a key); `/` is the overview (30 s poll), review queue moved to `/review`, new admin-gated `/couriers/:userId/performance` linked from the courier detail; responsive nav (desktop top bar ≥900px, 4 primaries + More sheet on phones, one `NAV` list); `route-smoke` +10 (routes/contract/parsers/map/nav), `guards` +30 (direct parser tests incl. null-rates + garbage-dropping + wiring). Remaining: `go build ./...` green in-session; `gofmt`/`go vet`/`go test` + CMS `tsc`/smoke/`guards`/`vite build` re-run PENDING (shell flaky in-session — run `go test ./internal/app/` in `backend/`, `npm run typecheck/smoke/guards` in `frontend-cms-admin/`), live round-trip vs seeded backend + real-phone checks UNVERIFIED |
| A9 settings editor, audit log, AI page, Ops Copilot (PLAN P0/P1/P2) | DONE (code; live UNVERIFIED) | New backend `admin_a9.go` + migration `00011_a9_settings_audit.sql` (`platform_settings` key/scope/value + `audit_logs`): `GET/PUT /v1/admin/settings` (28-key allowlist across fitness/qualification/dispatch/order/fees/health, `global` + `country:XX` scopes, range-checked, null clears to `config.yaml`, audit-logged, order window min≤max enforced), `GET /v1/admin/audit` (action/target allowlists, limit/offset, total), `GET /v1/admin/ai/calls` + `/summary` (metadata only — model/latency/tokens/micro-cost/fallback), `POST /v1/admin/copilot/ask` (2–500 char question → keyword-routed fixed read-only tools, deterministic offline answer + optional Muse Spark wording, `live` flag, call logged to `ai_calls`); contract in `openapi.yaml` (`SettingList/Input`, `AuditList`, `AICallList/Summary`, `CopilotAsk/Response`). New CMS `src/features/{settings,audit,ai,copilot}/` (validated types + api + pages) + admin-gated `/settings` `/audit` `/ai` `/copilot` routes + nav + `tb-table` style; `route-smoke` +15 (routes/contract/wiring), `guards` +30 (direct validator tests for all four parsers + wiring). Cross-app alignment is server-side, no PWA UI change: `GET /v1/config/public?country=` merges global + country overrides (fitness targets, promise windows, health goal — the numbers the courier fitness screen already renders), quoting uses per-merchant-country fee bps via `order.QuoteForRates`, fitness eval/retry/gap/checkpoint/stats use effective values, dispatch corridors/windows/speeds resolve per order merchant country, merchant accept timeout + card path use effective windows; `courier_sanctions`/`merchant_sanctions`/`order_events` stay the per-case trail while `audit_logs` is the unified viewer (all admin mutations now write it: decisions, sanctions, refunds, hold/release, settings, demo controls). Remaining: `go build/vet/test` + CMS `tsc`/smoke/`guards` re-run PENDING (shell unavailable in-session — run `go test ./...` in `backend/`, `npm run typecheck/smoke/guards` in `frontend-cms-admin/`), live round-trip vs seeded backend + real-phone checks UNVERIFIED |
| A10 verify | PARTIAL | Backend `go build/vet/test` green, `admin_test.go` 4/4, CMS `route-smoke.mjs` 40/40 + `tsc -b --noEmit` clean (2026-10-30; both smoke scripts now scan `src/features/detail/` modules). 2026-10-30 B5/A5 withdrawals monitor added (+9 route checks incl. `/withdrawals` route + hold/release contract, +7 guard checks) and A7 orders review added (backend `admin_orders.go` + `admin_orders_test.go`, CMS `src/features/orders/` 4 files, +10 route / +12 guard checks incl. direct validator tests, `StatusBadge` order/delivery tones) — `gofmt`/`go build/vet/test` + CMS `tsc`/smoke/`guards`/`vite build` re-run PENDING (shell unavailable in-session; run `go test ./internal/app/` in `backend/`, `npm run typecheck/smoke/guards` in `frontend-cms-admin/`). Live end-to-end vs seeded backend, trilingual CMS copy (`locales/` + `react-i18next` — CMS is English-only), and real-phone PWA checks UNVERIFIED |

## Requested local seed accounts (2026-10-31)

Per request: 3 approved couriers (`runner@`, `biker@`, `runner2@example.com`),
2 approved + signed merchants (`chickenresto@`, `noodleresto@example.com`), and
1 funded customer (`customer2@example.com`), all password `trackfud123`.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend seed | New `SeedRequestedAccounts` (called from `SeedTestAccounts`, so it runs on every boot in demo and non-demo mode): full `courier_applications` (approved, passed fitness stats) + `couriers` rows (profile, AES-GCM-sealed placeholder ID, bike/consents/lifetime stats), approved `merchants` + versioned signed `merchant_agreements` (sha256 over the live `agreementText`), categories + items + on-shift staff, funded `customer_wallet` + 2 addresses. Idempotent (`ON CONFLICT` upserts, reseed repairs passwords/roles/rows) | `backend/internal/app/seed.go` |
| Docs | README gains the six-account table; skill accounts unchanged | `README.md`, `.agents/skills/seed-test-data/SKILL.md` (untouched) |
| Verify | `go build/vet/test` + live login round-trip PENDING (shell unavailable in-session — run `go test ./internal/app/` in `backend/`, then log in with each account per the skill) | — |

Assumptions: seed ID numbers are fictional placeholders (`317400000000000N`),
never real KTP data; staff emails are seed-only (no inbox); agreement text/snapshot
reuses the live `agreementVersion`/`agreementText` constants so a version bump
forces re-acceptance.

## GBK live district seed (2026-11-03) — VERIFIED live

Per request: realistic seed data around Gelora Bung Karno (-6.2186006,
106.8029661) for couriers, merchants, customers and the CMS admin — couriers
with many orders aligned to the same customers + merchants, feeding the AI
surfaces on all three tracks (merchant menu import, courier coach/run planner,
CMS Trust Briefs/copilot) through real rows, never hardcoded frontend data.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend seed | New `SeedGBKDistrict` (called from `SeedTestAccounts`, every boot, demo + non-demo): 6 approved GBK merchants (sate/bakmi/padang/kopi/gado/ayam, signed agreements, menus, staff) via the existing `seedRequestedMerchant` helper; 8 approved GBK couriers (4 runner + 4 biker) via `seedRequestedCourier`; 6 hotel-guest customers (Sultan, Mulia, Fairmont, Somerset, Harris fX, Century Park) with funded wallets + hotel pins; 27 linked orders (12 delivered, 4 completed, 9 live actives, 2 cancelled) each with real `order.QuoteFor` totals, ledger postings (charge/refund/settle), deliveries + accepted dispatch offers, ratings/cheers/translated messages; AI extras (menu-import `needs_review`, 2 advisory Trust Briefs, 2 proof checks, fallback-marked `ai_calls`); 2 mock withdrawals. One-time history behind an `ai_jobs` seed guard; live work sessions refresh every boot so the map never goes stale | `backend/internal/app/seed_gbk.go`, `seed.go` wiring |
| No contract change | No new endpoints, no migration, no frontend change — every row is served by existing routes | `api/openapi.yaml` untouched |
| Verify | `go build/vet` clean; `go test ./internal/app/ ./internal/order/ ./internal/ledger/` green; image rebuilt, container restarted, boot seed ran: 6/8/6 users, 27 orders with the exact status spread (12/4/2/2/2/3/2), 27 deliveries, 22 accepted offers, 15 ratings, 4 messages, 4 cheers, 8 live sessions, 45 journal legs (27 charge + 2 refund + 16 settle); container restart re-runs clean (counts unchanged); CMS `GET /v1/admin/dashboard` as `admin@example.com` returns 8 couriers online + 9 active orders | live DB counts + API check this session |

Assumptions: seed ID numbers continue the fictional `317400000000001N` range
(same AES-GCM sealing, never returned); hotel/customer names are fictional
guests at real nearby hotels (delivery-pin story only); `ai_calls` seed rows
are honestly marked `fallback: true`; dashboard "today" follows UTC day
boundaries while Jakarta (UTC+7) rows near midnight UTC may read as
yesterday — data is correct, no seed change needed.

## Gateway bare-path 404 fix (2026-11-01, code DONE; live UNVERIFIED)

`http://localhost:8000/courier` (no trailing slash) returned nginx 404 while
`/courier/` worked — same on all four frontends. Cause: the gateway proxied
the bare path through unchanged, but each app's `nginx.conf` only had a
`location /<base>/` prefix block, so `/<base>` matched nothing. No backend
change (pure static routing); no new endpoints; no secrets touched.

| Layer | Change | Evidence |
| --- | --- | --- |
| Gateway edge | Bare paths 301 to the canonical subpath (`/courier` → `/courier/`, query preserved) before proxying | `gateway/Caddyfile` (`redir ... permanent` ×4) |
| App nginx ×4 | Exact-match `location = /<base>` 301s to `/<base>/` (query preserved) so direct-container access works too | `frontend-{customer,runner-biker,merchant,cms-admin}/nginx.conf` |

README already documented "with or without the trailing slash" (now actually
true) — no README change needed. Remaining: rebuild the five gateway/frontend
images (`podman compose up --build` or `bash scripts/podman-up.sh`) and confirm
`curl -sI localhost:8000/courier` 301s and both forms return 200; SPA deep
links (e.g. `/courier/orders/123`) still fall back to `index.html` via the
untouched `try_files`.

## Cross-cutting — OPEN (not built, per plan or gap)

- **Admin CMS app (`AGENTS.md` §4.4): PARTIAL** — tracked in the Admin CMS section above
  (A1–A4 DONE: login gate, courier + merchant review, admin seed; A5/A6/A7/A8/A9 DONE
  (code; live UNVERIFIED);
  A10 verify PARTIAL: unit/smoke/tsc/build green on last full run, live end-to-end + real-phone UNVERIFIED).
- **Real Google Maps on any frontend: DONE (code; live UNVERIFIED).**
  All four frontends load real Google Maps JS off an active
  `VITE_GOOGLE_MAPS_KEY` (HTTP-referrer restricted browser key, present in
  every local `.env`) with `VITE_GOOGLE_MAPS_MAP_ID` optional (empty =
  classic markers, no console setup). Without a key each map renders its
  labelled schematic fallback. Backend `internal/maps` takes the server key
  from `TF_GOOGLE_MAPS_KEY` (IP-restricted) with a planning-speed offline
  fallback. No Maps npm dependency (CDN loader only). Live 2026-11-01: the
  configured server key answers Routes `computeRoutes` with 403
  PERMISSION_DENIED (API not enabled or restriction on the key) — the app
  correctly falls back to planning-speed estimates; enable Routes on that key
  in the Cloud console to get live polylines. Remaining: live
  tile render + real-phone checks UNVERIFIED.
- **Real R2 / River / Brevo / Paddle: DONE (code 2026-11-01; live
  UNVERIFIED).** R2 presign (`internal/storage`, public bucket menus/avatars,
  private bucket IDs/selfie/proof/agreements, 5-min expiry, local-disk
  fallback), River workers for all 17 job kinds (same-tx `InsertTx`,
  ByArgs dedup on retry kinds, 3 attempts), Brevo SMTP auth
  (`TF_SMTP_USER/PASSWORD/FROM`, VAPID env pair wins), Paddle sandbox envs +
  webhook-URL derivation — see "Live keys + River worker swap (2026-11-01)"
  below. Local disk, Mailpit and simulate-paid remain the no-key fallbacks.
  Live VERIFIED 2026-11-01 (see dated round-trip sections below, incl. the
  real-key second pass): River
  `InsertTx`/`Insert` + worker completion (`email_send`, `push_send`,
  `ai_trust_brief`, max_attempts=3), signup verification + applicant emails
  delivered via Mailpit, local presign→PUT→GET byte-identical through the
  gateway, Modal `/models` 200 with the served model + a fresh non-fallback
  `trust_brief` inference logged to `ai_calls`. Remaining: R2 buckets, Brevo
  sender and Paddle secret still have no keys (fallbacks active by design);
  order/dispatch life-cycle + real-phone checks still UNVERIFIED.
- **Real-phone verification: OPEN.** Install, push delivery, outdoor GPS, Wake
  Lock, mic on Android + iPhone still required before any "verified" claim
  (guardrail in all three frontend `AGENTS.md`).
- **Contract-codegen loop (`api-sync` skill): OPEN.** Backend contract and
  frontend wrappers are maintained by hand; drift is possible — regenerate or
  diff when `openapi.yaml` changes.


## Live round-trip vs seeded backend (2026-11-01) — VERIFIED (platform paths)

Rebuilt `tf-backend` from current source (River/R2 code), restarted only that
container with the new `TF_*` keys forwarded (`scripts/podman-up.sh` env
allowlist extended — it predated `TF_R2_*`/`TF_SMTP_USER`/`PASSWORD`/`FROM`,
`TF_VAPID_*`, `TF_PADDLE_API_KEY`/`ENV`/`CLIENT_TOKEN`,
`TF_PUBLIC_BASE_URL`, `TF_IDENC_KEY`; without the extension the container
silently drops them). Migrated in place incl. `river_*` tables. All traffic
through the Caddy gateway (`:8000/api/...`), matching production; direct
`:8081/v1/...` bypasses the `/api` prefix the presigned upload URLs carry.

- Auth: customer signup → 201 + JWT, login → 200, `GET /auth/me` returns the
  account (Argon2id path). Courier signup same. CMS has no signup (403 gate intact).
- Files (local fallback, no R2 keys): public presign → PUT → GET through the
  gateway, bytes identical. Private docs (ID front/back, selfie) same path.
- Email: signup verification + courier-applicant mails completed as River
  `email_send` jobs (attempt 1, max_attempts 3) and arrived in Mailpit
  addressed to the right inboxes.
- Push: `GET /push/vapid-public-key` returns the env VAPID key; `POST
  /push/test` enqueues `push_send`, completed attempt 1 (no subscriptions).
- River same-tx proof: courier profile + draft + fitness pass (2100 m/800 s)
  then `POST /courier/application/submit` → `pending_review`; status write +
  `email_send` + `push_send` + `ai_trust_brief` committed atomically (single
  tx, `InsertTx`) and all completed first attempt.
- Modal: `GET /models` 200 lists `meta-models/Muse-Spark-Open-816B-A42B`;
  `ai_calls` shows 35 successful non-fallback calls (latest today), incl. the
  fresh `trust_brief` from this round-trip (fallback=false, no error).
- Paddle guards (no secret configured): webhook without secret → 500 "not
  configured" (refused, no apply); `dev/.../simulate-paid` → 404 with
  `TF_DEMO_MODE=false`. Correct for live mode.
- Finding: Google Routes server key → 403 PERMISSION_DENIED (see Maps bullet);
  key-console fix, app fallback verified by design.

Still OPEN: R2/Brevo-sender/Paddle-secret need real keys before their live
paths can be exercised; order/dispatch life-cycle (merchant accept → offer →
handover) and real-phone PWA checks need devices.

### Real-key verification (2026-11-01, second pass — R2/Brevo/VAPID/Paddle)

User supplied real sandbox/dev keys in `backend/.env`; backend rebuilt +
restarted to pick them up. Results with real data:

- R2 private: presign → PUT 200 to real `*.r2.cloudflarestorage.com` URL →
  `complete` → 200 ready → content 302 → followed to R2 → 200, bytes
  identical. VERIFIED.
- R2 public: PUT + complete + 302 work, but following the redirect gives R2
  `400 InvalidArgument` — `TF_R2_PUBLIC_URL` pointed at the raw R2 API
  endpoint, which carries no implicit bucket. SUPERSEDED same day per user
  request (single endpoint, no domain): `PublicURL` now returns "" when the
  public base is the raw endpoint, and the content handler falls back to a
  5-min presigned GET for public files. Re-tested unmodified `.env` → 302 to
  a signed bucket-pathed URL → 200, bytes identical. VERIFIED. (A real CDN /
  custom domain still wins later for cacheable image URLs.)
- Brevo: signup `email_send` completed attempt 1 via `smtp-relay.brevo.com`
  — relay accepted auth + `TF_SMTP_FROM` sender. VERIFIED (receipts to real
  inboxes still need a real recipient address).
- VAPID: env pair mathematically valid (private derives exactly the
  configured public key, P-256 uncompressed). A fake-endpoint push proved the
  old code swallowed all failures as "completed" — fixed `doPush` to return
  an error when subscriptions were attempted but all failed (zero-sub case
  still completes; 404/410 cleanup unchanged), so River now retries 3x and
  records the error instead of false-success. Real delivery still needs a
  real browser subscription (device OPEN).
- Paddle sandbox: `GET /prices` → 200 (key valid, account has prices);
  correctly-signed webhook → `{"received":true}`; replay → `{"duplicate":true}`
  (event stored once, no crash on unknown txn); tampered signature → 401.
  VERIFIED.
- Fixes shipped in this pass: `POST /files/{id}/complete` with an empty body
  used to write 400 (from an ignored `decode`) yet still mark the file ready
  — now returns the real 200 outcome; `doPush` all-failed error above.
  Backend `go build/vet/test` green, image rebuilt, container restarted.

Remaining after this pass: order/dispatch life-cycle + real-phone PWA
checks (devices).

## AI plan change (2026-10-28): chat/text AI via Modal — IMPLEMENTED, auth fixed 2026-10-30

Previously: `internal/ai` pointed at `https://api.meta.ai/v1` directly.
Now: text/chat/tool-calling features route to the Modal-hosted endpoint,
implemented in code (not just planned):

- `internal/ai/client.go`: `Config` gains the Modal proxy-token pair
  (`ModalKey`/`ModalSecret`); `New` sends it as ONE Bearer token
  `"<token-id>.<token-secret>"` (Modal endpoints guide — the earlier
  `Modal-Key`/`Modal-Secret` header-pair assumption was wrong and caused the
  `apierror.Error` unmarshal failures in `ai_calls`: the edge 401 body is a
  plain string the SDK cannot parse). `HasKey()` accepts Meta key OR full
  pair; half pair stays in fallback. Pair present + no explicit base →
  Modal endpoint; otherwise Meta direct. `withDefaults` normalizes the base
  to always include `/v1` (SDK appends `/chat/completions`) and maps legacy
  Spark ids to the served Modal model id, so stale config values 404 less.
- `internal/ai/transcribe.go`: audio stays Meta-direct only (the Modal
  endpoint serves chat completions); with the pair set the transcriber uses
  the Meta base + key, so a both-credentials setup transcribes live instead
  of failing into the typed-transcript fallback. Live transcription still
  needs the Meta-direct `TF_META_API_KEY`.
- `internal/config/config.go`: new `ai:` YAML block (`base_url`,
  `spark_model`, …; env wins), `TF_MODAL_KEY`/`TF_MODAL_SECRET` env-only.
- `backend/config.yaml`: `ai.base_url` = Modal endpoint WITH `/v1`,
  `ai.spark_model` = `meta-models/Muse-Spark-Open-816B-A42B` (served id from
  the Modal dashboard inference curl).
- `internal/app/ai_jobs.go`: `aiConfigOf` passes the pair through.
- Tests: `ai/modal_test.go` (pair gating, base default + `/v1`
  normalization, legacy→served model mapping, Bearer header round-trip via
  httptest), `config/config_ai_test.go` (yaml/env precedence),
  `app/ai_modal_test.go` (mapping + Modal-only transcriber fallback).
- Verified 2026-10-28: `go build ./...`, `go vet ./...`,
  `go test ./...` (all packages ok), `gofmt` clean. PostGIS integration
  (`make test-db` target does not exist; podman broken in this sandbox)
  NOT run — no migration/query changed, so unit cover suffices here.
- Re-verify after the 2026-10-30 auth fix: `go build ./...`, `go vet ./...`,
  `go test ./backend/internal/ai/... ./backend/internal/app/... ./backend/internal/config/...`.

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

1. Confirm the served model id (should already match `config.yaml`):
   `curl -s "$TF_META_BASE_URL/models" -H "Authorization: Bearer $TF_MODAL_KEY.$TF_MODAL_SECRET"`
   then set `TF_META_SPARK_MODEL` (or `config.yaml ai.spark_model`) to match.
2. One live smoke call (e.g. ask the Ops Copilot a question, or translate a
   chat line) and check the `ai_calls` row: `error` must be empty and
   `model` must read `meta-models/Muse-Spark-Open-816B-A42B`.
3. Env checklist when rows still log errors: `TF_MODAL_KEY` (token ID) AND
   `TF_MODAL_SECRET` must both be set **in the backend process env**
   (compose/podman env, not just your shell) — a half pair stays in silent
   fallback mode, and an unset pair explains `fallback: true` rows.

## `.env.example` files (added 2026-10-28)

Every key below maps to a real `os.Getenv` read in
`backend/internal/config/config.go` or `import.meta.env` in the frontends —
no invented keys:

- `backend/.env.example` — `DATABASE_URL`, `TF_CONFIG`, `TF_ADDR`,
  `TF_DEMO_MODE`, `TF_JWT_SECRET`, `TF_PUBLIC_BASE_URL` (builds the Paddle
  webhook URL), `TF_PADDLE_WEBHOOK_SECRET/API_KEY/ENV/CLIENT_TOKEN`,
  `TF_R2_ENDPOINT/ACCESS_KEY/SECRET_KEY/PUBLIC_BUCKET/PRIVATE_BUCKET/
  PUBLIC_URL` (empty endpoint = local `TF_UPLOAD_DIR` fallback),
  `TF_SMTP_HOST/PORT/USER/PASSWORD/FROM` (Brevo vs Mailpit),
  `TF_VAPID_PUBLIC/PRIVATE_KEY/SUBJECT` (env wins over DB pair),
  `TF_GOOGLE_MAPS_KEY`, `TF_MODAL_KEY/SECRET` (Modal proxy pair, env-only),
  `TF_META_BASE_URL/SPARK_MODEL` (empty = config.yaml Modal defaults),
  `TF_META_API_KEY` (Meta direct, for live transcription/vision only),
  contributor/transcribe/SAM model ids.
- `frontend-customer/.env.example` — `VITE_API_BASE`, `VITE_PADDLE_CLIENT_TOKEN`,
  `VITE_PADDLE_ENV`, active `VITE_GOOGLE_MAPS_KEY` + `VITE_GOOGLE_MAPS_MAP_ID`.
- `frontend-merchant/.env.example` — `VITE_API_BASE`, active
  `VITE_GOOGLE_MAPS_KEY` + `VITE_GOOGLE_MAPS_MAP_ID`.
- `frontend-runner-biker/.env.example` — `VITE_API_BASE`, active
  `VITE_GOOGLE_MAPS_KEY` + `VITE_GOOGLE_MAPS_MAP_ID`.
- `frontend-cms-admin/.env.example` — `VITE_API_BASE`, active
  `VITE_GOOGLE_MAPS_KEY` + `VITE_GOOGLE_MAPS_MAP_ID`.

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

## Cross-app equalization: auth, merchant orders on their own path (2026-10-29)

Per root `AGENTS.md`: PLAN.md §3 flows compared across customer / courier /
merchant against `backend/internal/app/app.go` plus each app's `lib/api.ts`.
Four bugs found (confirmed by user before fixing), all fixed with no PLAN.md
changes:

| # | Bug | Fix | Evidence |
| --- | --- | --- | --- |
| 1 | Logout in all 3 PWAs cleared only local state — `POST /v1/auth/logout` never called, HttpOnly `tf_<app>_refresh` cookie stayed valid | New exported `logout()` in each `lib/api.ts` (refreshes via `/auth/me` first so an expired token can't leave the cookie behind, then posts logout best-effort); all three logout buttons await it before clearing + redirect | `frontend-{customer,runner-biker,merchant}/src/lib/api.ts`, `App.tsx` ×2, `StatusPage.tsx` |
| 2 | All 3 `lib/api.ts` skipped token refresh for every `/auth/*` path, so courier boot via `GET /auth/me` bounced to login on an expired token (same bug class as the CMS loop) | Same `NO_REFRESH` allowlist as the CMS app (login/refresh/logout/signup/demo-login only); everything else refreshes + retries | `lib/api.ts` ×3, `frontend-cms-admin/src/lib/api.ts` (reference, untouched) |
| 3 | Merchant order list carried no `delivery`/ETA — the kitchen ETA line fell back to status guesses (PLAN §9 + M3 promise real ETA) | `listMerchantOrders` attaches the light `{status, eta_s}` line per row in one extra query; shared `merchantDeliveryLine` builder | `backend/internal/app/orders.go`, `orders_merchant_test.go` (3 tests) |
| 4 | Merchant had no own order-detail path (only `/customer/orders/{id}` served merchants) | New `GET /v1/merchant/orders/{id}` in `app.go` (`getMerchantOrder`, owner-or-admin gate) reusing the shared `buildOrderDetail` envelope — same keys as the customer detail route, `pickup_code` instead of the customer PIN; contract updated | `backend/internal/app/app.go`, `orders.go`, `api/openapi.yaml` (`getMerchantOrder`), merchant `route-smoke.mjs` +2 checks |
| Verify | DONE | Backend `go build/vet` + `go test ./...` green (incl. 3 new tests); `tsc` + `vite build` green on all three PWAs; merchant smoke 47/47, courier smoke green. PostGIS integration UNRUN (podman broken in sandbox); live end-to-end (real merchant accept→ETA→detail round-trip) + real-phone checks UNVERIFIED |

Deviations: `go-verify` PostGIS leg skipped (no migration changed; new queries are plain joins on existing tables). `orders.go` keeps its pre-existing `gofmt` nit untouched. No `@vis.gl` or new dependencies added anywhere.

## CMS merchant-detail crash + refresh-login loop (2026-10-29)

Per `AGENTS.md`: `/back-office/merchants/{id}` crashed with React error #31
(object with keys `{close, open}`), and any CMS deep link bounced to `/login`
after refresh despite a valid session. Courier list/detail hardened the same way.

| Track | Change | Evidence |
| --- | --- | --- |
| Crash root cause | `MerchantCard` rendered `opening_hours` day values (`{ open, close }` objects per `validateMerchantBody`) straight into `<dd>{hours}</dd>` — the exact `{close, open}` shape in the report | `backend/internal/app/catalog.go` (`OpeningHours map[string]any`), old `frontend-cms-admin/src/features/detail.tsx` line 404–409 (`git show HEAD:...`) |
| Safe rendering | New pure helpers `formatValue`/`formatHours`/`formatList` (never render objects as React children); `opening_hours` type corrected to `Record<string, OpeningHoursValue>`; all `.map` rows use keyed `<Fragment>`; fitness/flags/checkpoints null-guarded | `frontend-cms-admin/src/lib/format.ts`, `src/lib/types.ts`, `src/features/detail.tsx` |
| Trust brief | Backend serves `{ pending: true }` or `{ risk, summary, reasons[], photo_note }`, not the old `{ recommendation, signals }` shape — normalizer `toBriefView` maps both, pending shows an honest "still generating" card | `frontend-cms-admin/src/lib/trust.ts`, `backend/internal/app/ai_http.go` `getTrustBrief` |
| Session restore | Access token is memory-only, but `raw()` skipped refresh for ALL `/auth/*` paths, so boot-time `/auth/me` after refresh always 401'd → logout → `/login`. Refresh is now allowed for everything except login/refresh/logout/signup/demo-login; boot does `refreshSession()` → `/auth/me`; cross-tab sign-out sync via `storage` event | `frontend-cms-admin/src/lib/api.ts` (`NO_REFRESH`, `refreshSession`), `src/App.tsx` |
| Backend | `logout` and refresh-cookie fallback now include `tf_cms_refresh` (previously sign-out left the CMS refresh token valid) | `backend/internal/app/auth.go` |
| Couriers | Same hardening on `/back-office/couriers/` + `/couriers/{id}`: `courierSub` tolerates missing fitness, brief pending state, no object children | `frontend-cms-admin/src/features/dashboard.tsx`, `src/features/detail.tsx` |
| Responsive | Detail grids already collapse 2→1 col at 720px; key-value pairs now stack at ≤430px with wrapping list subtitles | `frontend-cms-admin/src/index.css` |
| Regression test | New `npm run guards` (`scripts/guard-smoke.mjs`, 19 checks): real-helper behavior on the crash shape + pending brief + wiring guards; `route-smoke.mjs` signup check narrowed to actual `api('/auth/signup'` calls (allowlist mention was a false positive) | `frontend-cms-admin/scripts/guard-smoke.mjs` |
| Verify | DONE | CMS `tsc -b --noEmit` 0, `route-smoke` all pass, `guards` 19/19, `vite build` 0; backend `go build/vet` + `go test ./internal/app/` green, `gofmt` clean. PostGIS integration UNRUN (`make test-db` target does not exist, podman broken in sandbox — same as 2026-10-28). Live end-to-end vs seeded backend + real-phone checks UNVERIFIED |

Note: `AGENTS.md` points at `docs/README.md` for structure/guidelines, but that
file does not exist in `docs/` — followed `docs/code-style-frontend.md` +
`docs/frontend-architecture.md` instead. CMS has no `locales/` (English-only),
so no i18n updates applied.

## CMS review UX: queue/login responsive, decide gating, merchant ban (2026-10-29)

Per updated `AGENTS.md`: dashboard list spacing + mobile status filter, centered
login, hide Approve/Reject once decided (ban stays possible), full model fields
from the API, backend-backed merchant ban. No `PLAN.md` changes (file untouched
in git). `docs/README.md` still missing — same guideline fallback as above.

| Track | Change | Evidence |
| --- | --- | --- |
| Merchant ban (backend) | New `merchant_sanctions` audit table + `merchants.status` widened with `'banned'`; `POST /v1/admin/merchants/{id}/sanctions` (ban from pending/approved/rejected, unban restores pre-ban status, reason required for ban, 409 conflicts otherwise) + `GET` history; transactional status write + email/push + WS broadcast, mirroring `sanctionCourier` | `backend/db/migrations/00008_merchant_sanctions.sql`, `backend/internal/app/admin.go` (`merchantSanctionDecision`, `sanctionMerchant`, `listMerchantSanctions`), `backend/internal/app/app.go` routes, `backend/api/openapi.yaml` (`/sanctions` paths + `MerchantSanctionInput`) |
| Merchant detail data | `getMerchantDetail` now also selects `created_at`; CMS renders id, owner_id, created, agreement agreed-flag, full staff/hours/location set — every field comes from `GET /v1/admin/merchants/{id}` | `backend/internal/app/admin.go`, `frontend-cms-admin/src/features/detail.tsx` (`MerchantCard`), `src/lib/types.ts` (`created_at`, `Sanction`) |
| Courier detail data | Renders the full backend model: user_id, mode, operational status, address, emergency contact, bike, consents, approved_at, fitness elapsed/max-gap, plus trust-brief and sanction history — no hardcoded values | `frontend-cms-admin/src/features/detail.tsx` (`CourierCard`), `src/lib/types.ts` (`CourierProfile`) |
| Decide gating | Approve/Reject shows only while decidable (merchant: `pending`; courier: pending/pending_review/passed_test/testing). Decided records get the standing panel instead: couriers freeze/unfreeze/ban (+ ends_at, history), merchants ban/unban with reason + history; `useSanction` posts and invalidates `['admin']` so statuses refresh from the server | `frontend-cms-admin/src/features/detail.tsx` (`DECIDABLE_APPLICATION`, `useSanction`, `SanctionBox`), `src/components/ui.tsx` (`banned`/`frozen` badge tones), `src/features/dashboard.tsx` (dynamic status counts incl. banned) |
| Queue + login responsive | Queue list gets even flex spacing; status filter goes full-width with edge-to-edge menu ≤560px; login form centered in a `max-width: 26rem` card with clamped top padding — existing `tb-*` tokens only, no new look | `frontend-cms-admin/src/index.css`, `src/features/auth.tsx` (`tb-auth`) |
| Regression tests | `route-smoke` 38 checks incl. sanctions contract + decide-gating; `guards` 28 checks incl. sanction wiring, ban→unban flip, responsive/login markers; new `TestMerchantSanctionDecision` (ban/unban/restore/conflicts incl. injection-flavoured kind) | `frontend-cms-admin/scripts/route-smoke.mjs`, `scripts/guard-smoke.mjs`, `backend/internal/app/admin_test.go` |
| Verify | DONE | CMS `tsc -b --noEmit` 0, `route-smoke` 38/38, `guards` 28/28, `vite build` 0; backend `go build/vet` + `go test ./internal/app/` green (incl. new test), `gofmt` clean on touched files (`orders.go` has a pre-existing format nit, untouched). PostGIS integration UNRUN (`make test-db` absent, podman broken in sandbox). Live end-to-end (incl. real ban/unban round-trip) + real-phone checks UNVERIFIED |

Deviations from skills, all in line with repo reality: `api-sync` full codegen
not run (no `oapi-codegen`/`packages/api-client` in repo; contract + wrappers
are hand-maintained per prior checklist entries — contract edited by hand in the
existing style); `db-migrate` sqlc regen not applicable (admin handlers use
inline pgx, no sqlc config in repo — migration follows the goose file
conventions). New `banned` merchant status is user-approved via `AGENTS.md`
(which overrides the frozen-domain rule).

## Maps first-load race + courier status card + wallet-hold refresh (2026-10-29)

Per root `AGENTS.md`: live map failed on FIRST init (`Maps library did not
initialise`) while Retry always worked; the `customer/order/{id}` courier card
stuck on "Finding your runner" even for cancelled orders; wallet balance
looked unchanged right after ordering.

| # | Finding | Fix | Evidence |
| --- | --- | --- | --- |
| 1 | First-load race, not the key. `loadMaps()` resolved on script `onload`, but with `loading=async` that only means the bootstrap arrived — `google.maps.Map` stays undefined until `importLibrary('maps')` resolves. Retry skipped the script wait and went straight to the (by-then-ready) bootstrap, so it always worked. A hardcoded `mapId` (never registered in Cloud Console) on both maps added a second key-dependent failure mode | Loader rewritten: single-flight promise resolves only after `importLibrary('maps')` (bootstrap polled to a 20 s deadline); existing script tag reused, failed tag removed on retry; `gm_authFailure` captured so real key/billing/restriction rejections surface as `auth`, distinct from races; `mapId` only from new optional `VITE_GOOGLE_MAPS_MAP_ID` (empty = classic markers, works on any key); typed `GoogleMapsNs` handle replaces `any`/`window.google` at both call sites | `frontend-customer/src/lib/maps.ts` (rewritten), `features/tracking/LiveMap.tsx`, `features/addresses/GoogleMapPicker.tsx`, `.env.example` (+ map-id notes) |
| 2 | `frontend-runner-biker` has no Maps JS init at all (verified by grep: delivery navigation is an external Google Maps URL, tracks are finger-drawn SVG) — nothing there could throw the reported error | Same fixed loader mirrored as `frontend-runner-biker/src/lib/maps.ts` (env-based, identical contract) + `.env.example` note, so both apps build maps on the fixed path | `frontend-runner-biker/src/lib/maps.ts`, `.env.example` |
| 3 | `CourierCard` rendered the searching state whenever `delivery.courier` was null, ignoring order status — hence "Finding your runner" on cancelled orders; no loading/error states, no retry | Card now takes `status` + `loading` + `error` + `onRetry`: skeleton while refetching, error + Retry on failure, honest terminal notes for cancelled/rejected (`track.courierNoneCancelled/Rejected`), hidden for delivered/completed without a courier, searching + "check again" retry only while dispatch can still assign. `OrderPage` feeds all four and refreshes wallet + orders on cancel (refund shows at once) | `features/tracking/CourierCard.tsx`, `features/tracking/OrderPage.tsx` |
| 4 | "Finding your runner" also wrong per PLAN §2/§4: the courier can be a runner, biker, or staff | Inclusive wording in en/id/ms: `track.searching` → "Finding your courier…", `nocourier.title`, `track.d_picked_up`, `cheer.sub`. Mode labels (`runner`/`biker`/`staff`) kept — they describe the actual person. Also restored 5 map keys (`liveMap`, `mapLoading`, `mapRetry`, `schematicMap`, `updatedAt`) missing from id/ms (English fallback had masked it) | `frontend-customer/src/locales/{en,id,ms}.json` (full key + placeholder parity) |
| 5 | Wallet looked unchanged after ordering. Backend already deducts + holds correctly: wallet orders post `ChargePostings` (wallet → escrow, `payment_status='held'`) in the create tx; card orders hold on webhook/demo confirm (`CardChargePostings`); cancel/reject/timeout refund in full (`RefundPostings`) — covered by existing ledger tests. The gap was frontend: `['wallet']` was never invalidated after pay | `CheckoutPage` invalidates `['wallet']` + `['orders']` after wallet pay and after card-placed confirm; cancel path (above) does the same. No backend change needed | `features/orders/CheckoutPage.tsx`, ledger tests `TestChargeBalances` / `TestRefundReversesCharge` / `TestCardChargeRefund` |
| Verify | DONE | Customer `tsc -b --noEmit` 0, new `pnpm smoke` (`scripts/smoke.mjs`) 26/26 (loader invariants, card branches, locale parity + placeholders, inclusive wording, wallet refresh), `vite build` 0 (PWA precache 8 entries); runner `tsc` 0 + `route-smoke` green; backend `go build/vet` + `go test ./internal/ledger/ ./internal/order/ ./internal/app/` green (incl. money/charge/refund cover). PostGIS integration UNRUN (`make test-db` absent, podman broken in sandbox — no migration/query changed). Live first-load vs real key + real-phone checks UNVERIFIED (no key/device in this session) | — |

Assumptions: no Maps JS key or device in this session, so the race fix is
proven by construction (readiness = `importLibrary` resolved) + smoke guards,
not a live load; runner-biker "map error" reports refer to the shared loader
path (that app renders no embedded map today).

## Placeholders + merchant agreement/earnings + CMS detail + fitness recorder (2026-10-30)

Per root `AGENTS.md`: every form input needs a placeholder; merchant Agreement
must disable after submit and show signed time; Earnings must come from the API;
CMS courier detail at `/back-office/couriers/:id` must show real data;
`/courier/fitness` must count moving time correctly and lock submit while recording.

| Track | Change | Evidence |
| --- | --- | --- |
| Placeholders | Every text/numeric input now carries a placeholder (or `aria-label` for date/time/file/radio). Merchant setup/auth/agreement/menu/import, runner onboarding/auth/wallet/chat/tracks/delivery, customer addresses/topup/auth, CMS login/reason/note all covered; trilingual `*Ph` keys in en/id/ms with `defaultValue` fallbacks | `frontend-*/src/App.tsx`, `features/**/MenuPage.tsx`, `ImportPage.tsx`, `AddressesPage.tsx`, `AgreementPage.tsx`, `FitnessPage.tsx`, all `locales/{en,id,ms}.json` |
| Merchant agreement (backend) | New `GET /v1/merchant/merchants/me/agreement` (latest signature + merchant status); `POST .../agreement` idempotent — same version returns the original row (`duplicate: true`) instead of a second insert, so double-taps can never duplicate | `backend/internal/app/merchant_agreement.go`, `catalog.go` (idempotency guard), `app.go` routes, `api/openapi.yaml` (`MerchantAgreementStatus`) |
| Merchant agreement (frontend) | New modular `features/setup/agreementApi.ts` + `AgreementPage.tsx` (replaces inline `Agreement()` in `App.tsx`): fetches text + status, banner "Already submitted by X on <date>" with `Intl` date/time, button disabled when `already \|\| busy \|\| !tick \|\| !signer`, `Idempotency-Key` on POST, loading/error/retry, single-column responsive layout | `frontend-merchant/src/features/setup/AgreementPage.tsx`, `agreementApi.ts`, `App.tsx` |
| Merchant earnings (backend) | New `GET /v1/merchant/earnings?weeks=8` (clamped 1..12): settled totals per currency (gross/commission/net + ledger payable/lifetime), weekly buckets with exact commission, payouts note. Settled = accepted and beyond, excluding refunded/dead/awaiting/placed | `backend/internal/app/merchant_earnings.go`, `app.go`, `api/openapi.yaml` (`MerchantEarnings`), `merchant_portal_test.go` (`TestParseWeeks`, `TestMondayOf`, `TestAgreementStatusView`) |
| Merchant earnings (frontend) | New `features/orders/earnings.ts` + rewritten `EarningsPage.tsx`: `useQuery(['merchant-earnings'])` from the new endpoint, totals/weeks/payable, skeleton/error+retry/empty, responsive stack → grid; no local order math, no mocked payouts | `frontend-merchant/src/features/orders/EarningsPage.tsx`, `earnings.ts`, `locales` (`earn.payable`, `common.retry`) |
| CMS courier detail | Backend `getApplicationDetail` now returns `submitted_at`, `updated_at`, and real `fitness.checkpoints` (counted from `checkpoint_photos`); frontend `CourierApplicationDetail` type widened and `fetchCourierReview` uses the real values instead of `checkpoints: 0, submitted_at: null`; fitness comment corrected; grid already collapses 2→1 col + kv stacks at ≤430px | `backend/internal/app/admin.go`, `frontend-cms-admin/src/features/detail.tsx`, `src/lib/types.ts`, `src/index.css` |
| Fitness recorder | Purpose documented in UI + code: prove runner 2 km / biker 5 km within moving limits before CMS review. New `features/fitness/fitnessApi.ts` (config/application/submit from API) + `useFitnessRecorder.ts` (1 s elapsed ticker, 0.5 m/s + ≤30 s moving rule, >30 m accuracy skip, teleport/spike exclusion — matches `fitness.go`) + `FitnessPage.tsx` (replaces inline `Fitness()` + hardcoded manual desktop block): submit disabled while `recording \|\| busy \|\| !hasRecording`, last submitted test from `/courier/application`, responsive stacked actions | `frontend-runner-biker/src/features/fitness/*`, `App.tsx`, `locales` (`fitness.purpose/targetLine/recordingLock/last/passed/appStatus`) |
| Verify | Backend `go build/vet/test ./...` green (incl. 3 new portal tests); frontend `tsc` + smoke/build pending real-phone + live end-to-end (PostGIS integration UNRUN — no migration/query change beyond additive selects). CMS `guards`/`route-smoke` to be re-run with new contract | — |

Assumptions: CMS `detail.tsx` task text was truncated — treated as "show full real model, no mocks, responsive" per constraints and fixed the `checkpoints: 0` + null timestamp stubs; time/date inputs keep `aria-label` (browsers ignore `placeholder` on date/time); `Idempotency-Key` on agreement POST is best-effort (server dedupes by version regardless).

## Partner review decisions end-to-end (2026-10-30)

Per root `AGENTS.md`: merchant agreement approve/reject in CMS with live
status on the merchant side; courier fitness-test lock + status UX while under
review; CMS courier detail showing every submitted field incl. images. No
`PLAN.md` changes (file untouched in git).

| Track | Change | Evidence |
| --- | --- | --- |
| Backend courier review | New `courierDecision` pure helper (mirrors `merchantDecision`): only `pending/pending_review/passed_test` decidable, idempotent approve; `decideApplication` reuses shared `parseDecisionBody` (reject-reason required, malformed JSON 400) instead of inline parsing; `listApplications` validates `?status=` via `parseReviewStatus` (400 on unknown) + `?limit=` clamp (1–100, default 100); `getApplication` now returns `submitted_at`/`updated_at` | `internal/app/courier.go`, `admin_test.go` (`TestCourierDecision`), `api/openapi.yaml` (status enum + limit on `listApplications`) |
| Backend review locks | Qualification `startSession` and legacy `submitFitness` return 409 while the application is `pending/pending_review`, so a courier cannot knock a submitted application out of review or submit another test until the admin decides | `internal/app/sessions.go`, `catalog.go` |
| Backend review payloads | `getApplicationDetail` fitness gains `checkpoint_file_ids` (latest 12, admin-readable via `GET /v1/files/{id}/content`); `getMerchantDetail` agreement gains signed `text` + `sha256` snapshot | `internal/app/admin.go` |
| Merchant agreement page | Button tracks review state (`Signed ✓ — pending approval/approved/rejected`); matching submitted banners; WS `merchant.status` + 30 s poll refetch with an on-screen update notice (mirror of the decision email/push queued in the same decide transaction); `parseMerchantMsg` learns the new frame | `frontend-merchant/src/features/setup/AgreementPage.tsx`, `features/orders/socket.ts`, `locales/{en,id,ms}.json` (5 new agree keys) |
| Courier status page | Pending state shows "Already submitted by {{name}} on {{date}} — waiting for approval." with `Take Fitness test` + `Continue partner application` disabled (server 409 backs it) + lock explanation; WS `application.status` (new `IncomingMsg` variant) refetches queries with an update notice; 30 s poll fallback | `frontend-runner-biker/src/pages/StatusPage.tsx`, `lib/ws.ts`, `lib/format.ts` (`formatSubmittedAt`), `features/profile/profileApi.ts` (`submitted_at`), `locales/{en,id,ms}.json` (3 new account keys) |
| Courier fitness page | Locked card while `pending/pending_review` (record + submit disabled, link back to status); submit also disabled then as defense-in-depth | `frontend-runner-biker/src/features/fitness/FitnessPage.tsx`, `fitnessApi.ts` (`submitted_at`), `locales/{en,id,ms}.json` (`fitness.locked`, `fitness.backToStatus`) |
| CMS courier detail | Every submitted field incl. evidence photos: new `EvidenceCard` (ID front/back, selfie, bike, checkpoints) via authed `fetchFileBlob` blob URLs (private files need the bearer token, so no plain `<img src>`); decidable list narrowed to backend states (no mid-test decide) | `frontend-cms-admin/src/features/detail.tsx`, `lib/api.ts` (`fetchFileBlob`), `lib/types.ts` (`checkpoint_file_ids`), `index.css` (`.tb-shots`/`.tb-shot` responsive grid) |
| CMS merchant detail | `DecideBox` gains `disabled` + `disabledReason`: always rendered, enabled only for `pending` + signed agreement (backend 409 backs it); agreement card shows full signed text + sha256 + not-signed guidance | `frontend-cms-admin/src/features/detail.tsx`, `lib/types.ts` (agreement `text`/`sha256`) |
| Regression tests | CMS `route-smoke` +4 (agreement gating, evidence photos), `guards` +4 (decidable states, checkpoint ids, agreement text, file fetch); courier smoke +8 (submitted banner, WS update, pending lock, fitness lock, locale parity); merchant smoke +5 (review states, socket, locale strings) | `frontend-cms-admin/scripts/{route-smoke,guard-smoke}.mjs`, `frontend-runner-biker/scripts/route-smoke.mjs`, `frontend-merchant/scripts/route-smoke.mjs` |
| Verify | Backend `go build/vet` + `go test ./internal/app/` green (incl. `TestCourierDecision`); `tsc -b --noEmit` 0 on all three frontends. PostGIS integration UNRUN (no migration/query change beyond additive selects; podman broken in sandbox). Smoke suites updated — full re-run + `vite build` + live end-to-end vs seeded backend + real-phone checks UNVERIFIED (shell flakiness blocked re-runs in this session; re-run `node scripts/route-smoke.mjs` + `guard-smoke.mjs` per app before calling this done) | — |

Assumptions: rejecting while `testing` is now a 409 (previously approve-only) — the fitness page locks at the same states, so no courier can be mid-test when an admin decides; `submitApplication` re-submit while pending stays allowed (harmless refresh to `pending_review`, keeps retry UX).

## Sanctions end-to-end: freeze/unfreeze/ban (2026-10-30)

Per PLAN §4.4 (Freeze/unfreeze/ban P0: reason, end date, message, audit log,
email + push) + §8.4 (frozen can't go online, money stays withdrawable, human
decides). The `SanctionBox` panel already existed on both CMS detail pages —
this session closed the enforcement + visibility gaps around it so the flow is
the same across backend, courier, customer and merchant.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend sanctions | Unfreeze no longer requires a reason (was a 400, but the CMS deliberately sends none for restorative actions — now mirrors the merchant unban); new pure helpers `sanctionReasonOK` + `workSessionBlocked` | `internal/app/courier.go`, `admin_test.go` (`TestSanctionReasonOK`, `TestWorkSessionBlocked`) |
| Backend session gate | `startSession` (work kind) returns 403 when the `couriers` row is frozen/banned. No row (free tracking, pre-approval) never blocks; qualification path untouched. Dispatch candidates + offer accept already required `approved`; banned merchants already excluded from the customer list | `internal/app/sessions.go` |
| Backend standing | `standing` (operational `couriers.status`) on queue rows, application detail, `GET /courier/profile` and `GET /courier/application`; `?status=` allowlist gains frozen/banned (also unblocks merchant `?status=banned`, previously a 400 despite `banned` being a real merchant status) | `internal/app/courier.go`, `catalog.go`, `admin.go`, `api/openapi.yaml` (status enums, `SanctionInput` reason note, `CourierProfile.standing`) |
| CMS queue | `STATUS_FILTERS` gains frozen/banned; badge shows standing over the review state via `queueStatus` (a frozen courier's application still reads approved) | `src/lib/types.ts`, `src/features/dashboard.tsx` |
| CMS detail | Detail carries `standing`; sanction panel keys off standing (the old frozen/banned `status` branches were dead — application status never takes those values) | `src/features/detail/CourierDetail.tsx` |
| Courier PWA | `standingOf` on application + profile; frozen/banned notice on account, run-setup (Go-online disabled, backend 403 backs it) and delivery screens; `courier.status` socket frame refetches standing; wallet untouched (stays withdrawable); trilingual `account.frozen/banned/sanctionWallet` | `features/profile/profileApi.ts`, `usePartner.ts` (`sanctioned`), `pages/StatusPage.tsx`, `RunSetupPage.tsx`, `DeliveryPage.tsx`, `lib/ws.ts`, `locales/{en,id,ms}.json` |
| Merchant PWA | Status badge green only when approved (banned no longer lit green) | `src/App.tsx` |
| Regression tests | Backend `TestSanctionReasonOK` + `TestWorkSessionBlocked`, `TestParseReviewStatus` extended; CMS `route-smoke` +8 (standing, filters, unfreeze-optional contract), `guards` +4 (standing wiring); courier smoke +9 (standing, socket, locale parity); merchant smoke +1 (badge) | `scripts/route-smoke.mjs`, `scripts/guard-smoke.mjs` (each app) |
| Verify | Backend `go build/vet/test` + CMS/courier/merchant `tsc` + smoke suites — PENDING re-run in-session (shell flakiness blocked execution; run `go test ./internal/app/` in `backend/`, `npm run typecheck/smoke/guards` per frontend). PostGIS integration UNRUN (no migration/query change beyond additive selects). Live ban round-trip vs seeded backend + real-phone checks UNVERIFIED | — |

Assumptions: `courier_sanctions` / `merchant_sanctions` (kind, reason, note,
prev-status, admin, timestamp) are the audit trail — no separate `audit_logs`
table (PLAN §8.4's "audit log" is satisfied by the history the CMS renders, not
a second store). [A9 update: a unified `audit_logs` viewer now sits on top of
these per-case tables — every admin mutation writes both its case table and one
`audit_logs` row; see the A9 entry.] Mid-delivery freezes finish the leg (PLAN: only safety cases
are reassigned, by a human). Staff-shift deliveries are unaffected by courier
sanctions. `REASON_OPTIONAL` unfreeze sends an empty reason the backend now
accepts; freeze/ban still 400 without one.

## R2 Run Mode + offers + delivery alignment + CMS responsive nav (2026-10-30)

Per root `AGENTS.md`: implement R2 on `frontend-runner-biker/`, keep the flow
aligned across frontend courier/customer/merchant via `PLAN.md` §3/§5/§6, create
missing backend endpoints, and fix the CMS nav crowding on mobile/tablet.
`PLAN.md` untouched (no plan changes, only alignment).

| Track | Change | Evidence |
| --- | --- | --- |
| Backend envelopes (B4 contract honesty) | New `deliveryEnvelopeForCourier` (delivery + staff-aware payout + impact once delivered): `acceptOffer`, `acceptStaffOffer`, `getDelivery`, `arrivedDelivery`, `pickupDelivery` now answer the `DeliveryEnvelope` their openapi responses already promised (previously bare `{delivery}`); empty `activeDelivery` is 404 "no active delivery" instead of 200 `{delivery: null}` (openapi gains the 404); frozen/banned couriers can't auto-create work sessions via GPS ingest anymore (explicit `startSession` 403 backs it, free-tracking users without a row unaffected) | `internal/app/dispatch.go`, `sessions.go`, `api/openapi.yaml` (`DeliveryEnvelope` on all courier legs, 404 on `activeDelivery`) |
| Runner session lifecycle | New `features/run/sessionApi.ts` (`startWorkSession` kind=work + mode + goal → `goal_distance_m/_s`, `endWorkSession` best-effort); run store gains `serverLinked` + caller-supplied `sessionId`; Run Setup opens the server session first (403 frozen/banned stays put with the notice, other failures start device-local with an honest offline badge); Run Mode closes the server session on end (lifetime totals/splits/track fold in, IDB summary stays the mirror) | `sessionApi.ts`, `sessionStore.ts`, `pages/RunSetupPage.tsx`, `RunModePage.tsx` |
| Runner socket ↔ dispatch | `offer.created` minimal ping (ids + expiry, the shape dispatch broadcasts) refetches `GET /courier/offers` (or staff offers) for the full merchant/fee/fit card — legacy full `{offer}` frames still parse; `delivery.leave_now` arms head-now from kitchen-ready timing (local 12 s timer stays the offline fallback); `delivery.eta` updates the leg; `courier.status` mid-run refetches standing + speaks the pause notice | `lib/ws.ts`, `pages/RunModePage.tsx`, `DeliveryPage.tsx` |
| Runner delivery screen | Live ETA note (`delivery.eta`, minutes), server route warning preferred over the static beta text, head-now/ETA socket sync scoped to the active leg (demo legs ignore server frames) | `features/delivery/deliveryStore.ts` (`etaS`, `setEta`, `toActiveDelivery`), `courierApi.ts` (route warning typed, null-delivery recovery), `DeliveryPage.tsx`, locales `eta` en/id/ms |
| Runner locales + regression | `run.sessionOffline`, `delivery.eta`, `account.sanctionedRun` in en/id/ms with identical key sets; route-smoke +10 (server session, socket refetch, nudges, envelope contract, frozen ingest, locale parity) | `src/locales/{en,id,ms}.json`, `scripts/route-smoke.mjs` |
| CMS responsive nav | One `NAV` list gains `group` (Operate/Money/System) + `icon`; top bar groups with dividers + fade-masked horizontal scroll from 720px (was 900px, ungrouped, overflowed on tablets); avatar becomes the account menu (email + sign out, Esc/backdrop close) so no slot is spent on a sign-out link; phones keep the icon bottom bar (4 primaries + More) with a grouped More sheet; focus-visible rings, 52px touch targets, safe-area kept | `frontend-cms-admin/src/App.tsx` (`NavIcon`, grouped topnav, `tb-user-menu`, grouped sheet), `src/index.css`, route-smoke +3, guards +2 |
| Verify | Backend `go build/vet` + `go test ./internal/app/` green except pre-existing `TestAdminRefundPlan` (documented A9 failure, untouched `adminRefundPlan` — out of scope). Frontend `tsc` + smoke + `vite build` re-run PENDING (shell flakiness blocked re-runs in this session; run `npm run typecheck/smoke/guards` per app). Live end-to-end vs seeded backend + real-phone checks UNVERIFIED | — |

Assumptions: drawn saved tracks are pad sketches (device-independent 0–100
points) with an optional device-local map placement (anchor + projected loop
+ snapped road route, 2026-10-31) — `planned_track` stays null and only the
workout goal travels to dispatch; GPS keeps streaming on frozen mid-delivery legs
(only fresh auto-create is blocked, per §8.4 "finish the leg"); legacy full
`offer.created` frames are still accepted but the backend only sends minimal
pings; CMS stays English-only (no `locales/`), so no i18n deltas there.

## A9 platform controls: settings, audit, AI, Ops Copilot (2026-10-30)

Per PLAN §4.4 (Settings P0, audit log P1, AI page P1, Ops Copilot P2) + §10.F.
No `PLAN.md` changes (file untouched in git).

| Track | Change | Evidence |
| --- | --- | --- |
| Backend schema | New `platform_settings(key, scope, value, updated_by, updated_at)` (PK key+scope, scope `global` or `country:XX`) + `audit_logs(actor, action, target, reason, before, after, ip, time)` with created/target indexes | `backend/db/migrations/00011_a9_settings_audit.sql` |
| Backend settings | 28-key allowlist (fitness/qualification/dispatch/order/fees/health) with range + int validation (`parseSettingScope`, `validateSettingValue`, `TestParseSettingScope`, `TestValidateSettingValue`); `GET/PUT /v1/admin/settings` (null clears to `config.yaml`, window min≤max enforced, audit-logged); overrides apply without restart via `loadOverrides`/`effective*` | `backend/internal/app/admin_a9.go`, `admin_a9_test.go`, `api/openapi.yaml` (`SettingList/Input`) |
| Backend audit | `writeAudit` (best-effort, allowlisted actions, IP + 500-char reason caps) hooked into courier/merchant decisions, sanctions, order refunds, withdrawal hold/release, settings, demo controls; `GET /v1/admin/audit` (action/target allowlists, limit/offset, total) | `admin_a9.go`, `courier.go`, `admin.go`, `admin_orders.go`, `money.go`, `ai_http.go` |
| Backend AI usage | `GET /v1/admin/ai/calls` (feature allowlist, metadata only — never prompts) + `GET /v1/admin/ai/summary` (calls, avg latency, tokens, micro-cost, fallbacks, errors, last_at) over the existing `ai_calls` table | `admin_a9.go`, `openapi.yaml` (`AICallList/Summary`) |
| Backend copilot | `POST /v1/admin/copilot/ask` (2–500 chars): keyword router (`pickCopilotTools`, tested incl. the PLAN §10.F biker example) picks ≤3 fixed read-only tools (weekly volume, in-window rate by mode, courier leaderboard, merchant volume, AI usage), deterministic offline answer + optional Muse Spark wording (`live` flag), call logged to `ai_calls`; question text never becomes SQL | `admin_a9.go` (`TestPickCopilotTools`), `openapi.yaml` (`CopilotAsk/Response`) |
| Cross-app alignment | `GET /v1/config/public?country=` merges global + country overrides (fitness targets, promise windows, health goal — the numbers the courier fitness screen already renders, no PWA change); quoting uses per-merchant-country fee bps (`order.QuoteForRates`, constants untouched so `QuoteFor` math is identical); fitness eval/retry/gap/checkpoint/weekly goal, dispatch corridors/windows/speeds, merchant accept timeout (wallet + card paths) all read effective values; `config.Dispatch` promoted to a named type so handlers pass effective copies | `app.go`, `orders.go`, `sessions.go`, `dispatch.go`, `money.go`, `ai_http.go`, `internal/config/config.go`, `internal/order/order.go` |
| CMS pages | New `src/features/{settings,audit,ai,copilot}/` (validated types + api + pages): scope-grouped editor with save/clear + effective-vs-default, audit viewer with filters + paging, AI summary cards + calls table (micro-USD display), copilot Q&A with suggestions + evidence tables + live/fallback badges + session history; admin-gated `/settings` `/audit` `/ai` `/copilot` routes + nav + `tb-table` style | `frontend-cms-admin/src/` (16 new files), `App.tsx`, `index.css` |
| Regression tests | Backend `admin_a9_test.go` (scope/value validation incl. injection-flavoured keys, registry coverage, router, offset); CMS `route-smoke` +15 (routes/contract/wiring), `guards` +30 (direct parser tests for all four features) | `scripts/route-smoke.mjs`, `scripts/guard-smoke.mjs` |
| Verify | Backend `go build ./...` green in-session; `gofmt`/`go vet`/`go test` + CMS `tsc`/smoke/`guards`/`vite build` re-run PENDING (shell unavailable in-session; run `go test ./...` in `backend/`, `npm run typecheck/smoke/guards` in `frontend-cms-admin/`). PostGIS integration UNRUN (one additive migration, no query change beyond PK selects + fixed aggregations). Live round-trip vs seeded backend + real-phone checks UNVERIFIED | — |

Assumptions: fitness-test rules + WHO goal are platform-wide (global scope only) —
per-country scoping applies to merchant-facing settings (fees, windows, dispatch
corridors); timing/size tuning knobs not in the 28-key registry (`sizes`,
tracking constants, detour refresh) stay on `config.yaml` as deploy-level
tuning; the copilot offline summary is the honest fallback path (humans still decide
everything); dispatch candidate queries add one indexed `platform_settings` PK lookup
per cascade step. Pre-existing `TestAdminRefundPlan` terminal-state expectation
("rejected"+"refunded") fails on the untouched `adminRefundPlan` — out of scope for
A9, left for the orders track.

## R3 Voice Copilot + staff mode + health extras + CMS responsive nav (2026-10-30)

Per root `AGENTS.md`: finish R3 on `frontend-runner-biker/`, keep the flow
aligned across courier/customer/merchant via `PLAN.md` §3/§5/§6 (creating
missing backend endpoints where the contract or the socket shapes drifted),
and fix the CMS nav crowding on mobile/tablet. No `PLAN.md` changes (file
untouched in git — alignment only).

| Track | Change | Evidence |
| --- | --- | --- |
| Backend voice envelope | `voiceConfirm` returned a bare `{delivery}` while openapi promises `DeliveryEnvelope` — now returns `deliveryEnvelopeForCourier` (delivery + staff-aware payout + impact), so the Run Mode accept path parses without a special case | `internal/app/ai_http.go` |
| Backend socket shapes | `cheerOrder` broadcast only `{message}` but the courier socket types `{text}` (cheers never spoke aloud); `postMessage` broadcast only `{body}` with no `lang` but the socket types `{text, lang}` (customer chat never rendered live) — both frames now carry `text` + `lang`/`from` alongside the legacy keys, so old and new clients hear and render them | `internal/app/social.go` (new `ai` import for `DetectLang` fallback) |
| Backend ratings tags | `listDeliveryHistory` now selects `courier_tags` and serves them per delivery (`DeliveryHistory.courier_tags`, contract updated) — the Ratings page aggregates live tag labels instead of an empty stub; names stay hidden by contract | `internal/app/money.go`, `api/openapi.yaml` |
| Runner socket compat | `IncomingMsg` accepts both shapes (`text` + `message`/`body`, optional `lang`); Run Mode normalises before speaking/receiving (`msg.text ?? msg.message ?? ''`, `msg.text ?? msg.body ?? ''`) | `lib/ws.ts`, `pages/RunModePage.tsx` |
| Runner voice relay | Relay URL hardcoded `/api/v1/...` — now derives from `VITE_API_BASE` (absolute deploy bases included); `VOICE_WS_PATH` comment corrected to the served path | `features/voice/voiceRelay.ts`, `useVoiceCopilot.ts` |
| Runner free tracking | Go-online rendered only for approved partners/staff — ordinary runners saw no start button, contradicting PLAN §2 open tracking. The session button now renders for everyone (sanctioned still blocked, 403 backed); payout currency + shortcuts stay partner-gated, dispatch still offers only to approved/on-shift | `pages/RunSetupPage.tsx`, locales untouched for this (existing strings reused) |
| Runner health extras | Wallet gains personal best (longest session) + day-streak line next to the WHO ring (`wallet.best`/`wallet.streak` in en/id/ms, key sets identical); voice transport labels rewritten to honest local-vs-server copy in all three locales | `pages/WalletPage.tsx`, `locales/{en,id,ms}.json` |
| CMS responsive nav | Avatar hidden on phones (`.tb-user {display:none}`) left sign-out reachable only via More; tablet top bar overflowed. Now: avatar visible at every width (brand truncates at 360px); top bar dual fade masks + `overscroll-x` + snap, group names hide ≤1023px (dividers keep the grouping); bottom bar `flex:1 1 0` + ellipsis fits 320px; More sheet repeats the signed-in email (`tb-sheet-mail`) above the grouped links; focus-visible + 44–52px targets kept | `frontend-cms-admin/src/App.tsx`, `src/index.css`, route-smoke +4, guards +2 |
| Smoke test bug | CMS `route-smoke.mjs` referenced an undefined `cssSrc` (ReferenceError before finishing — every prior "all green" claim for that file post-dates the breakage); now reads `src/index.css` like the guard script always did | `frontend-cms-admin/scripts/route-smoke.mjs` |
| Verify | Backend `go build ./...` green in-session; `go vet ./internal/app/` clean; `go test ./internal/ai|config|order|ledger/` green; `go test ./internal/app/` red ONLY on pre-existing `TestAdminRefundPlan` (untouched `adminRefundPlan`, documented since A7/A9 — still out of scope). Runner `route-smoke` all green in-session (+11 R3 checks); CMS `route-smoke` all green in-session (+4 nav checks + cssSrc fix). `tsc -b --noEmit` (both frontends), `vite build`, CMS `guard-smoke`, and `gofmt` re-run PENDING (shell classifier flaked in-session — run `npm run typecheck/smoke/guards` per app). PostGIS integration UNRUN (no migration; history query adds one `jsonb` column to an existing select). Live voice-accept round-trip vs seeded backend + real-phone checks UNVERIFIED | — |

Assumptions: legacy `{message}`/`{body}` socket keys stay on the wire for old
PWA builds (the new `text`/`lang` keys ride alongside, never replace); the
delivery-history `courier_tags` default to `[]` when the column is null and the
frontend guards non-array payloads, so mixed-version backends render stars
without tags rather than failing; saved tracks stay pad sketches with an
optional device-local map placement (2026-10-31 — `planned_track` stays null,
only the workout goal travels to dispatch, per the R2 entry); GPX export (PLAN P2) shipped early as a bonus and
is therefore DONE rather than OPEN-by-design.

## AI Run Planner lands in R3 (2026-10-31)

Per PLAN §10.E (P2, first stretch goal) + user request: the courier asks
"plan a 5K easy loop from here for lunch", gets two workout-first loops
past busy restaurants, picks one, and runs it — the pick drives dispatch.
`PLAN.md` untouched (no plan changes, only implementation + alignment).

| Track | Change | Evidence |
| --- | --- | --- |
| Backend hotspots (`get_hotspots`) | New `GET /v1/courier/run-plans/hotspots` (lat/lng required, radius 200..10000, limit 1..20, all validated): approved merchants with a location inside the radius, ranked by 7-day order volume then distance — the same `status='approved'` filter the customer restaurant list uses, so the planner and the customer see the same kitchens; seeded/demo orders count, so judges see lunch hotspots without waiting a week | `backend/internal/app/run_planner.go` (`fetchHotspots`, `listHotspots`), `api/openapi.yaml` (`RunPlanHotspot/List`) |
| Backend plans (`make_loop` + `estimate_earnings`) | New `POST /v1/courier/run-plans` (start + mode + goal_distance_m/goal_duration_s + window now/lunch/dinner + lang, all range-checked): two closed loops (≤10 waypoints) built as a goal-circumference circle pulled toward nearby hotspots — plan A leans in (pull 0.35), plan B holds the steady line (pull 0.15, rotated 30°) — durations via `maps.Estimate` (planning speed × circuity, the offline pre-assign planner), earnings via `order.DeliveryFee`/`CourierFee` (1–3 likely orders from hotspot lunch share, labelled `estimate`, never a promise); corridor from the effective dispatch settings (A9 overrides apply, no restart); optional Muse Spark wording (`planner-v1`, `run_plan` logged to `ai_calls`, `live` flag) with the deterministic heuristic as the honest offline fallback | `run_planner.go` (`circleLoop`, `estimatePlanEarnings`, `createRunPlans`, `plannerSystemV1`), `api/openapi.yaml` (`RunPlanRequest/RunPlan/List`), `run_planner_test.go` (lat/lng validation, loop closure + waypoint cap, earnings bounds, words schema, plan-id stability) |
| Backend dispatch alignment | The chosen plan travels as GeoJSON `LineString` in `POST /courier/sessions` `planned_track` (already accepted by `startSession`, already scored by the `ST_DWithin(... planned_track ...)` corridor in `dispatchCandidatesSQL`) — no dispatch change, no migration; customer/merchant tracks untouched (same merchants, same orders, same envelope keys) | `sessions.go`, `dispatch.go` (unchanged, reused) |
| Runner planner UI | New `features/planner/` (`types.ts` validated parsers that drop garbage, `api.ts` thin wrappers, `PlanMap.tsx` two loops amber/white + hotspot pins with schematic fallback, `PlannerPanel.tsx` GPS start + window + honest estimates, `planStore.ts` on-device pick): full `/planner` page (mode + goal + panel → "Start with …") plus inline panel in Run Setup for `trackKind === 'ai'` (link to `/planner`, clear, live pick); Run Setup sends the pick as `planned_track` and keeps it in the session setup; Run Mode renders the AI loop live (`LiveTrackMap` amber + GPS trail) exactly like a saved track; `trackAi`/`trackAiSoon` copy rewritten (no more "soon" placeholder); trilingual `planner` namespace (28 keys, parity-checked) | `frontend-runner-biker/src/{features/planner, pages/PlannerPage.tsx, pages/{RunSetupPage,RunModePage}.tsx, features/run/{types,sessionApi,sessionStore}.ts, locales/{en,id,ms}.json, index.css, app/routes.ts, scripts/route-smoke.mjs}` (+13 checks) |
| Regression tests | Backend `run_planner_test.go` (6 tests); runner `route-smoke.mjs` +13 planner checks (endpoints, contract, map, panel, store, routes, `planned_track` wiring, live render, backend heuristics, locale parity, placeholder removal) | `route-smoke.mjs`, `run_planner_test.go` |
| Verify | Backend `go build ./...` + `go vet ./internal/app/` clean; `go test ./internal/app/ -run Planner/CircleLoop/EstimatePlan/PlanID` 6/6 green; `go test ./internal/{ai,order,ledger}/` green; full `go test ./internal/app/` red ONLY on pre-existing `TestAdminRefundPlan` (untouched `adminRefundPlan`, documented since A7/A9 — still out of scope); `gofmt` clean on the two new files (repo-wide nits pre-existing, untouched). Runner `tsc -b --noEmit` 0, `route-smoke` all green, `vite build` 0 (PWA precache 8 entries). PostGIS integration UNRUN (no migration; one indexed `platform_settings` PK lookup per cascade at most). Live plan→session→offer round-trip vs seeded backend + real-phone checks UNVERIFIED | — |

Assumptions: circle loops approximate the goal within the loop-distance sanity band (the UI shows the real computed distance, never the goal number); hotspot pull only bends toward kitchens within 1.5× loop radius (workout shape wins); earnings are fee-math estimates with no tip, no promise; legacy `planned_track: null` free/saved sessions score exactly as before (corridor filter is null-tolerant); AI wording never sets prices or dispatch rules (numbers are server-quoted back).

## CMS slim nav: five slots + System menu (2026-10-31)

Per user request: eight top-bar pills crowded tablet/desktop and the
phone sheet repeated the same long list. No `PLAN.md` changes.

| Track | Change | Evidence |
| --- | --- | --- |
| CMS nav | Top bar now shows four primaries (Overview, Review, Orders, Payouts) + one System menu (Settings, Audit, AI, Copilot) from the same single `NAV` list — five slots fit 768px with room, so no scroll-hack, no hidden labels; the dropdown (gear pill, chevron, active state, Esc/backdrop close, 44px targets, focus-visible) closes on navigation; bottom bar (4 primaries + More) and the grouped More sheet (Operate/Money/System + signed-in email + sign out) unchanged; avatar account menu still at every width | `frontend-cms-admin/src/App.tsx` (`sysItems`/`sysActive`/`sysOpen`, `tb-sys` menu), `src/index.css` (`.tb-sys-btn/.tb-sys-menu`, wrap instead of fade-scroll, tablet tightening) |
| Regression tests | `route-smoke` + `guard-smoke` nav expectations rewritten (slim-bar + sheet-grouping checks replace the fade-mask/group-name checks) | `frontend-cms-admin/scripts/{route-smoke,guard-smoke}.mjs` |
| Verify | CMS `tsc -b --noEmit` 0, `route-smoke` all green, `guard-smoke` all green, `vite build` 0 (precache 5 entries). Live + real-phone checks UNVERIFIED | — |

## Dispatch realtime + handover PIN alignment (2026-10-31)

Per root `AGENTS.md` + user report: courier online at `/courier/run` got no
live offer after the merchant confirmed; one order must reach exactly one
courier and stay pending until the customer receives it; the merchant must be
notified the moment its order finds a courier (no lingering "finding"
button); the customer↔merchant delivery PIN was confusing. No `PLAN.md`
changes (file untouched in git) — alignment only.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend accept fan-out | `acceptCore` notifies all three sides on accept: push + `delivery.assigned` frame (winner first name + mode) to the merchant owner, `order.status` with `delivery_status` to customer + merchant + winner (existing), explicit `offer.taken` frame to every other offered courier so losing cards clear at once. Atomic guarded claim unchanged: one order, one courier, leg pending through pickup until handover | `backend/internal/app/dispatch.go`, `backend/api/openapi.yaml` (`Order.delivery` description) |
| Backend merchant list | List rows carry `courier_name`/`courier_mode` (null until assignment) from the same one-query dispatch join, so the kitchen line flips from "finding" to the courier's name with no second fetch; ETA 0 before assignment renders null (searching vs coming stay distinguishable) | `backend/internal/app/orders.go` (`merchantDeliveryLine`, `listMerchantOrders`), `orders_merchant_test.go` (`TestMerchantDeliveryLineShape` + identity) |
| Runner offer stream | Run Mode connects the socket itself (engine bind no longer the single owner) + handles `offer.taken` (clears same-delivery card, speaks `run.taken`); stationary heartbeat re-buffers the last fix each batch with a fresh timestamp (zero distance) so waiting couriers keep the 60 s dispatch window; stale sessions still get no offers by design | `frontend-runner-biker/src/lib/ws.ts` (`offer.taken`), `pages/RunModePage.tsx`, `features/run/useRunEngine.ts` (now `features/run/runTracker.ts`), locales untouched for this |
| Runner handover copy | Delivery screen labels the two codes by pair: step 1 merchant code (staff screen, never the customer) → step 2 customer PIN (face to face, never the merchant) | `frontend-runner-biker/src/pages/DeliveryPage.tsx`, `locales/{en,id,ms}.json` (`delivery.stepPickup/pickupWho/stepDropoff/pinWho`) |
| Merchant courier-found | Socket parses `delivery_status` + new `delivery.assigned`; either triggers a spoken + written "courier found" notice naming the courier and an instant queue refetch; `courierLine`/`CourierEta` prefer `{name} ({mode}) is on the way`; pickup card states the merchant code is courier-only and the customer PIN is separate/never visible | `frontend-merchant/src/features/orders/{socket,types}.ts`, `OrdersPage.tsx`, `locales/{en,id,ms}.json` (`orders.courierAssigned/courierFoundKitchen/pickupCodeNote/showCode`) |
| Customer PIN clarity | `PinHandover` rewritten around the three-pairs rule with staged states (waiting explainer → reveal/copy + never-in-chat warning → handed-over stamp → hidden on cancelled/rejected); `NoCourierPanel` already hides on merchant accept and the courier card already swaps searching → profile, so no dispatch change there | `frontend-customer/src/features/postdelivery/PinHandover.tsx`, `locales/{en,id,ms}.json` (`pin.howItWorks/neverChat/done`) |
| Verify | Backend `go build` + `go vet ./internal/app/` clean; `TestMerchantDeliveryLineShape` + `TestBuildMerchantOrderDetailShape` + `TestBuildOrderDetailWithoutDelivery` + dispatch score/claim suites green; full `go test ./internal/app/` red ONLY on pre-existing `TestAdminRefundPlan` (untouched `adminRefundPlan`, documented since A7/A9 — out of scope). Runner/merchant/customer `tsc -b --noEmit` 0; runner `route-smoke` + customer `smoke` all green; merchant `route-smoke` green after restoring 5 cancel-order keys missing from `ms.json` since before this session (pre-existing gap, `git show HEAD` confirms). PostGIS integration UNRUN (one additive join on an existing query; no migration). Live accept→offer→single-accept→merchant-notified→PIN-handover round-trip vs seeded backend + real-phone checks UNVERIFIED | — |

Assumptions: dispatch corridors/windows/sizes unchanged — test with the
courier session live near the merchant (PLAN §6.1 corridor: 400 m runner /
800 m biker, 60 s freshness); the heartbeat covers stationary-with-fix only,
a truly stale session (no GPS) still gets no offers and the banner says so;
legacy socket frames stay on the wire (old builds ignore `offer.taken` /
`delivery.assigned` and converge on the next poll).

## Food-ready courier wave (2026-10-31)

Per root `AGENTS.md` + user follow-up on the dispatch section above: the
accept-time courier search (4 min + 3 min staff) expired during normal
~15 min prep, so the merchant's "Ready" tap reached nobody — couriers near
the kitchen never got the real-time offer. One order must stay with exactly
one courier until delivered; notifications must reach customer, merchant,
and couriers at every step.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend ready wave | `readyOrder` starts a fresh courier-first wave when the delivery is unclaimed: guarded `restartCourierSearch` flips `searching`/`offered`/`staff_searching`/`no_courier` + `courier_id IS NULL` back to `searching` with a fresh clock, expires + deletes stale offer rows (re-offer eligibility; UNIQUE + candidate exclusion otherwise barred every earlier courier forever), queues `search_timeout` + `dispatch_run` in the same tx, broadcasts `order.status`, pushes customer "Food is ready" + merchant "Finding a courier", then runs the cascade (WS `offer.created` + push to nearby online couriers). Already-claimed deliveries only get the leave-now nudge — never re-enter a wave | `backend/internal/app/dispatch.go` (`restartCourierSearch`, `canRestartCourierSearch`, `restartCourierSearchSQL`), `orders.go` (`readyOrder`) |
| Backend wave reuse | Customer `wait_more` choice reuses `restartCourierSearch`; accept wave + wait-more + ready wave all time out on the CMS-effective (A9) window via `searchWindow` (was raw `config.yaml` in accept/wait-more) | `backend/internal/app/social.go`, `orders.go` (`acceptOrder`) |
| Backend tests | `TestCanRestartCourierSearch` pins restartable vs locked statuses, the with-courier veto, and the guard SQL (`courier_id IS NULL`, `status = ANY`, fresh `search_started_at`). Also fixed pre-existing `TestAdminRefundPlan`: terminal state is named before the already-refunded check | `backend/internal/app/dispatch_test.go`, `admin_orders.go` |
| Runner stale fix | GPS stale flag follows server liveness: heartbeat re-buffer counts as fresh, so a stationary courier waiting near a kitchen keeps receiving offers; dead GPS still pauses with the banner | `frontend-runner-biker/src/features/run/useRunEngine.ts` (now `features/run/runTracker.ts`) |
| Merchant ready line | `ready` + unclaimed honestly reads "Finding a runner or biker…" (was "notified"); pickup card gains the two-step handover explainer (step 1 merchant code at the counter, step 2 customer door PIN — never the merchant's) | `frontend-merchant/src/features/orders/OrdersPage.tsx`, `locales/{en,id,ms}.json` (`orders.pickupStep`) |
| Customer PIN pre-pay | Checkout explains the delivery PIN before payment: private, courier-only, face to face at the door; restaurant never sees it; courier uses a different kitchen code | `frontend-customer/src/features/orders/CheckoutPage.tsx`, `locales/{en,id,ms}.json` (`checkout.pinNote`) |
| Verify | Backend `go build ./...` + `go vet ./...` + `go test ./...` ALL green; customer/merchant/runner-biker `npm run build` (tsc + vite) + route smokes all green. No contract change, no migration. Live ready→offer→single-accept→merchant-notified→PIN-handover round-trip vs seeded backend + real-phone checks UNVERIFIED | — |

Assumptions: ready-wave offers are the primary path (prep normally outlives
the accept wave, which still covers quick kitchens); couriers who declined
an earlier wave may be re-offered at ready — food is packed and positions
changed, declining never affects scoring; `customer_pickup` never re-enters
dispatch; notification fan-out stays on the existing typed frames
(`order.status`, `offer.created`, `delivery.assigned`, `offer.taken`) +
VAPID push, parsed by the typed guards in each PWA.

## Spill-rule removal (2026-10-31)

Per user decision: spill risk no longer gates dispatch — any order whose
size class fits (S/M runner, S/M/L biker) is offerable to any approved
online courier. This unblocks orders like the medium-spill test cart that
previously produced zero candidates for runners.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend matching | `dispatchCandidatesSQL` drops the `spill_risk` CTE column + both mode filters (params $1–$10); `fetchCandidates` passes sizes only; offer payload + courier delivery view drop `spill_risk` | `backend/internal/app/dispatch.go`, `db/queries/dispatch.sql` |
| Backend orders/menu | `orderRow`/`orderCols`/`adminOrderCols`/`orderView` lose `Spill`; order insert drops the column (placeholders renumbered); menu CRUD drops `spill_risk` validation/columns; AI menu import drops the label (`MenuDraft.SpillRisk`, schema, `ParseMenuOutput`, prompt bumped to `menu-v2`, offline fallback) | `orders.go`, `admin_orders.go`, `menu.go`, `catalog.go`, `internal/ai/{schemas,prompts,fallback}.go`, `db/queries/{orders,menu,auth}.sql` |
| Backend schema | New migration drops `menu_items.spill_risk` + `orders.spill_risk` (with down-restore); `config.yaml` + `config.Dispatch` lose `runner_spill`/`biker_spill` | `db/migrations/00012_remove_spill_risk.sql`, `config.yaml`, `internal/config/config.go` |
| Contract | `spill_risk` removed from Order/MenuItem/MenuItemInput shapes | `backend/api/openapi.yaml` |
| Frontends | Courier `Offer`/`ServerOffer`/`ServerDelivery` + card copy; customer menu tag + order type; merchant editor/import-review/publish/order card + `SPILL_OPTIONS`/`SpillRisk` types + `menu.spill*` locale keys (en/id/ms) | `frontend-runner-biker`, `frontend-customer`, `frontend-merchant` |
| Docs | Runner/biker size-only wording, Snap-a-Menu labels, README local-test guide (no more low-spill restriction) | `docs/app-context.md`, `docs/milestone-checklist.md`, `README.md` |
| Verify | Backend `go build`+`go vet`+`go test` green; all three frontends `tsc -b --noEmit` green. Live re-test needs a backend restart + DB migrate (existing `TF-PMNWKE`-style orders keep their rows; the column just reads gone). Recipes with drinks are now runner-offerable | — |

## i18n placeholders + merchant live frames (2026-10-31)

Two user-reported display bugs, one shared root cause plus one parser gap.

| Track | Change | Evidence |
| --- | --- | --- |
| Courier run page | All `{var}` placeholders across `en/id/ms` converted to i18next `{{var}}` — `run.live` rendered literally as `LIVE · {mode}` and `run.gaps` as `{count} GPS gap(s)…`; same latent bug fixed in `expires`, `fit`, `toDelivery`, `headNow`, `eta`, `streak`, `onDuty`, `delivering`, `est`, `corridor`, `pickedInline`, `startWith`, ratings `count`, etc. `run.live` copy rewritten to self-explanatory `● Live tracking — {{mode}}` (was cryptic `LIVE · …`); id/ms normalized the same way | `frontend-runner-biker/src/locales/{en,id,ms}.json` (`run.live`, `run.gaps`, …) |
| Merchant locales | Same `{var}`→`{{var}}` fix: `orders.courierEta` (`· {min} min away`) and `orders.courierAssigned` (`{name} ({mode})…`) rendered literally on the card even when real ETA/name data arrived; also `orders.prep`/`sort`/`count`. New `orders.courierLive` key (`· live {{s}}s ago`, +id/ms) | `frontend-merchant/src/locales/{en,id,ms}.json` |
| Merchant socket | `parseMerchantMsg` now parses the real `delivery.eta` (`eta_s`) and `courier.location` (`lat/lng/ts`) frames instead of dumping their *type names* as kitchen notices — the reported `delivery.eta` / `courier.location` rows came from the catch-all, which now logs + drops unknown frames so internal names never leak into the UI | `frontend-merchant/src/features/orders/socket.ts` |
| Merchant orders page | `delivery.eta` frame invalidates `merchant-orders` so the card line shows the real minutes at once; `courier.location` frames feed a per-order live-dot stamp (`liveDotS`, hidden when older than 120 s) rendered under the courier line — no refetch storm (dots never invalidate; the 8 s poll + eta frames own data freshness) | `frontend-merchant/src/features/orders/OrdersPage.tsx` (`CourierEta liveS`) |
| Verify | Merchant + courier `tsc -b --noEmit` green; all six locale files JSON-valid. No backend/contract change (frames already carried real payloads). Live check UNVERIFIED: needs an assigned delivery + socket traffic on a real run to see ETA minutes and the live-dot age update | — |

## Scroll pagination on every order/history queue (2026-10-31)

User report: order lists on courier/merchant/customer/CMS loaded everything at once; then extended to the CMS courier + merchant queues. All list fetches now scroll-paginate (page 1 + ~10 rows) with filters/search intact, backend↔frontend equalized.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend contract | Shared `pagination.go`: `?page=` default 1 (garbage→1), `?per_page=` default 10 clamp 1–100 (legacy `?limit=` alias only when per_page absent), `?status=` allowlist (400 otherwise), `?q=` LIKE-escaped ≤64 chars (400 otherwise); envelope `{key, page, per_page, total, has_more}`, `has_more = page*per_page < total`; COUNT mirrors list WHERE; LIMIT/OFFSET bound params | `backend/internal/app/pagination.go`, 9 handlers (`orders.go`, `admin_orders.go`, `money.go`, `admin.go`, `courier.go`), `backend/api/openapi.yaml`, `pagination_test.go` green |
| CMS | Orders queue (code/email/merchant search + status + total), withdrawals queue (status filter, hold/release preserved), review dashboard (both queues + per-tab debounced search + server totals, merchant 404-degradation kept); `LoadMore` sentinel + `useDebouncedValue` primitives | `frontend-cms-admin/src/features/{orders,withdrawals}/`, `features/dashboard.tsx`, `components/ui.tsx` |
| Merchant | Kitchen queue scroll-pages newest-10-first; alarm/voice/push/WS/8 s poll untouched (page 1 = live edge); `orders.loadMore/showingOf` en/id/ms | `features/orders/{api,OrdersPage}.tsx`, `components/ui.tsx`, `locales/*.json` |
| Courier | History + withdrawals paginate; wallet sync keeps newest page (IDB mirror unchanged); ratings page-loop aggregate (50/page, 20-page cap) | `features/delivery/courierApi.ts`, `features/ratings/ratingsApi.ts`, `features/wallet/walletStore.ts` |
| Customer | Order history scroll-pages + debounced code search + server total; top-ups endpoint paginates | `features/orders/{api,hooks,types}.ts`, `features/tracking/OrderPage.tsx`, `components/ui.tsx`, `locales/{en,id,ms}.json` (searchOrders/searchOrdersPh/loadMore/showingOf) |
| Verify | `go build`+`go vet`+`go test ./...` green; `tsc -b --noEmit` + `vite build` green ×4 frontends; CMS `smoke` + `guards` green. Live seeded-backend + real-phone checks UNVERIFIED | — |

Assumptions: audit log + AI-calls lists keep existing limit/offset (out of scope); merchant live visibility = page 1 + refetch; ratings have no dedicated aggregate endpoint so the client page-loops.

## Customer order count + API-driven categories (2026-10-31)

User report: order history showed the literal `{shown} of {total} shown` (numbers never filled in), and the Home category chips (`All/Rice/Wraps/Drinks/Fresh`) were hardcoded, fetched nothing, and filtered nothing.

| Track | Change | Evidence |
| --- | --- | --- |
| Customer i18n | Root cause of the literal placeholders: locales use single-brace `{var}` but `src/i18n.ts` kept i18next's default `{{var}}` interpolation, so every `t(key, vars)` call returned the raw template. `i18n.ts` now sets `interpolation: { prefix: '{', suffix: '}' }`, which fixes `track.showingOf` and every other `t(key, vars)` site at once (`location.activeSet/useAsDelivery`, `checkout.decrease/increase`, …). Existing manual `.replace('{var}', v)` sites are unaffected (they run on already-interpolated strings or on untouched templates). This keeps the customer single-brace convention; courier/merchant earlier converted their locales to `{{var}}` instead — same symptom, per-track fix | `frontend-customer/src/i18n.ts`, `locales/{en,id,ms}.json` (unchanged) |
| Customer order count | `OrdersPage` total now reads the last (freshest) page's server `total` instead of only `pages[0]` (identical values per page; last wins after search resets) | `frontend-customer/src/features/tracking/OrderPage.tsx` |
| Backend catalog | `GET /v1/customer/restaurants/{id}/menu` now returns `categories` (`id/name/sort`) plus `category_id` per item and accepts `?category_id=` to narrow server-side; `GET /v1/customer/restaurants` accepts `?category=` (matches the category name across en/id/ms locales) to list only restaurants serving it; new `GET /v1/customer/categories` returns distinct category names across approved merchants (`label` + `restaurant_count`) for the chip row | `backend/internal/app/catalog.go`, `app.go`, `api/openapi.yaml` |
| Customer catalog module | New modular `features/catalog/` (`types.ts` validated parsers, `api.ts` typed calls, `hooks.ts` react-query hooks) replaces the inline `Restaurant`/`MenuItem` types and raw `useQuery`+`api()` calls in `App.tsx`. Home chips come from `GET /v1/customer/categories` (loading shimmer + error note, toggling a chip re-queries the restaurant list server-side, empty state via new `home.noMatch`); `RestaurantPage` gets a per-merchant chip row (`menu.categories`/`menu.all`) that filters items server-side via `?category_id=`. New locale keys `home.{all,categories,noMatch}`, `menu.{categories,all}` in en/id/ms | `frontend-customer/src/features/catalog/{types,api,hooks}.ts`, `src/App.tsx`, `src/locales/{en,id,ms}.json` |
| Verify | Backend `go build` + `go vet ./internal/app/` + `go test ./internal/app/` green; customer `tsc -b --noEmit` (npm `typecheck`) clean, `npm run smoke` all-pass, `vite build` PWA 8 entries green. No migration (new queries read existing tables). Live round-trip vs seeded backend + real-phone checks UNVERIFIED | — |

Assumptions: kept the customer's single-brace locale convention (config fix) rather than converting locales to `{{var}}` like courier/merchant, to avoid touching dozens of manual `.replace()` call sites; global `?category=` matches by name (per-merchant category ids can't be shared); no geo-radius on `/customer/categories` (distinct across all approved merchants).

## Customer delivery point follows chosen/default address (2026-10-31)

User report: with a default address already saved, Home still showed the
generic "Set delivery location" link and sorted restaurants from the Jakarta
fallback — the button never reflected the chosen or default address.

| Track | Change | Evidence |
| --- | --- | --- |
| Customer delivery hook | New shared `features/addresses/useDeliveryLocation.ts`: chosen saved address wins, then server default, then first saved address; guests/device-only fall back to the stored point, central Jakarta only when nothing is stored. Hydrates the stored point from the server default on first signed-in run; re-syncs on the `tb:delivery-location` event + `storage` events. All coords come from `GET /v1/customer/addresses` or the stored point — no hardcoded business data | `frontend-customer/src/features/addresses/useDeliveryLocation.ts`, `active.ts` (`notifyDeliveryLocation`) |
| Customer Home + topbar | Home reads the hook: the header link reads Change when a point exists (Set delivery location only when none), with a "Delivering to {label}" status line (coords for device points, honest Jakarta-fallback copy otherwise); the topbar shows the active label/address (or device coords) instead of the static tagline. `RestaurantPage` distances use the same hook, so menu distances match the Home sort | `frontend-customer/src/App.tsx`, `locales/{en,id,ms}.json` (`home.deliveringTo/change/noLocationSet`) |
| Customer address book | `AddressesPage` persists through the shared setters (`setActiveDelivery` for book addresses, `setDeviceDelivery` for guest/device points) so every screen stays in sync; legacy one-shot `customerLoc()` reader removed | `frontend-customer/src/features/addresses/AddressesPage.tsx` |
| Backend | No change needed: `GET /v1/customer/addresses` already serves `is_default` per owner-scoped auth, which is what the hook prefers | `backend/api/openapi.yaml` (unchanged), `GET /v1/customer/addresses` |
| Verify | Customer `tsc -b --noEmit` clean, `node scripts/smoke.mjs` all-pass (+8 new delivery-point checks), `vite build` PWA 8 entries green. Live round-trip vs seeded backend + real-phone checks UNVERIFIED | — |

Assumptions: Jakarta center stays the last-resort fallback (same coords as before, now in one exported `DEFAULT_CENTER`); login/logout remounts re-read the book, so no cross-account leakage via the stored id (a stale id resolves against the fresh list and falls back to default).

## Live availability badge: real presence + runner/biker wording (2026-10-31)

User report: the restaurant badge said "runners nearby" even when the only
courier near that restaurant was offline — a hardcoded global flag. It also
called partners "couriers" and named only runners while bikers and staff
fallback exist.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend catalog | Removed the global `deliveryBadge()` (`count(*) courier_applications approved` — online or not). `listRestaurants` and `getRestaurant` now serve per-merchant live presence via `livePresenceByMerchant`: one batched PostGIS pair query (no N+1) over approved merchants — a courier counts only with an active `work` session positioned within the last 60 s, `couriers.status='approved'` (frozen/banned excluded), and no active delivery leg — filtered in Go per merchant-country effective dispatch radii (CMS overrides win, `runner_max_to_pickup`/`biker_max_to_pickup`, capped 200–10000 m). Badge values `runners_bikers_nearby` vs `staff_only`, plus `live_couriers_count`/`live_modes`/`live_nearest_m`; pure rule covered by `TestResolveLiveAvailability` (offline→staff_only, near runner lights it, far runner outside its own radius does not, biker uses the wider radius) | `backend/internal/app/catalog.go`, `catalog_availability_test.go`, `api/openapi.yaml` (live-field descriptions on both endpoints) |
| Customer badge module | New shared `features/catalog/AvailabilityBadge.tsx` (`float` for the Home card photo, `tag` for the detail row) replaces both inline `runners_nearby ? … : …` conditionals in `App.tsx`. Wording is generic — "Runners & bikers nearby" (`home.runnersBikersNearby` in en/id/ms: "Pelari & pesepeda di dekatmu" / "Pelari & penunggang berdekatan"), never "courier" for a partner; the accessible title carries the live proof (count · nearest distance · modes). `isLiveNearby()` renders the live treatment for the current value and the legacy `runners_nearby` (old backends/cached rows); `parseLiveExtras` validates the new fields | `frontend-customer/src/features/catalog/{AvailabilityBadge.tsx,types.ts,api.ts}`, `src/App.tsx`, `locales/{en,id,ms}.json` |
| Customer freshness | `useRestaurants`/`useRestaurant` refetch every 30 s (15 s stale) while mounted, so the badge tracks couriers going on/offline; `smoke.mjs` +7 checks (shared component, wording, parsers, refetch, trilingual key) | `features/catalog/hooks.ts`, `scripts/smoke.mjs` |
| Verify | Backend `go test ./...` green (incl. new test), `gofmt` clean on touched files; customer `tsc -b --noEmit` clean, `smoke` all-pass, `vite build` PWA 8 entries green. No migration (new queries read existing tables). Live round-trip vs seeded backend + real-phone checks UNVERIFIED | — |

Assumptions: staff fallback stays an honest static label (`staff_only` renders whenever nobody is live — the server does not currently check on-shift roster, same as before); busy couriers (carrying a delivery) do not light the badge, mirroring dispatch eligibility; legacy `home.runnersNearby` keys kept for back-compat.

## B5 audit + real restaurant ratings (2026-10-31)

B5 scope re-audited against PLAN §§3/5/8.5/11/15.4–15.7 and every
money/staff/social call the three frontends make: Paddle sandbox top-up +
card direct-pay (shared payment row, HMAC webhook + `webhook_events` dedupe,
deterministic idempotent ledger), mock `payout_process` withdrawals +
admin hold/release, wallet/escrow/refund legs, staff invite/on-shift/offers
with staff-aware settlement, wait-more/pickup/cancel-refund no-courier
choices, separate courier+restaurant stars, cheers, translated chat,
WHO-minutes impact, courier public profile (first-name only) on tracking,
CMS performance/freeze/ban/settings — all present and aligned, so no new
endpoints were needed. One genuine gap found and closed: restaurant stars
were collected but never aggregated, while the customer app rendered a
deterministic pseudo-rating (`ratingFor`, a hash of the id → 4.4–4.9) —
fake data on real cards.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend catalog | `listRestaurants` + `getRestaurant` now serve `rating_avg` (1-decimal SQL average over non-null `restaurant_stars`) + `rating_count` via one batched `merchantRatingsByMerchant` aggregate (no N+1, no migration — reads `order_ratings`⋈`orders`). Unrated renders `rating_avg: null` + count 0, shaped by pure `ratingView` (covered by `TestRatingView`) | `backend/internal/app/catalog.go`, `catalog_availability_test.go`, `api/openapi.yaml` (rating fields on both restaurant responses) |
| Customer rating module | New shared `features/catalog/RestaurantRating.tsx` renders both placements (`★ 4.6 (12)` when rated, `★ New` via `home.unrated` in en/id/ms otherwise) and replaces both `ratingFor` call sites; the fake helper is deleted from `ui.tsx`. `parseRatingExtras` validates avg 1–5 + positive count; both catalog parsers spread it | `frontend-customer/src/features/catalog/{RestaurantRating.tsx,types.ts,api.ts}`, `src/App.tsx`, `src/components/ui.tsx`, `locales/{en,id,ms}.json` |
| Verify | Backend `go build/vet/test ./...` green (incl. `TestRatingView`); customer `tsc -b --noEmit` clean, `smoke` all-pass (+7 rating checks, §7), `vite build` PWA green. Recovered the C1 `home.runnersBikersNearby` keys a locale revert had dropped (same wording, same three locales). Live round-trip vs seeded backend + real-phone checks UNVERIFIED | — |

Assumptions: restaurant aggregate is a plain average + count (the PLAN Bayesian rule governs the CMS courier-performance page only); staff payouts settle into the deliverer's withdrawable `courier_earnings` account (covers §8.5 "Trackfud wallet" — same withdraw endpoints, no role gate); post-delivery tip-out stays out of scope (tips are order-time, 100% to the courier per §11.2). B5 stays PARTIAL per plan (sandbox + `dev/payments/simulate-paid`, never real rails).

## Customer locale + PIN-done copy fix (2026-11-01)

User report: on a delivered order the PIN card showed the literal `pin.done`,
and `customers/orders` showed the literals `track.showingOf` /
`track.searchOrdersPh` instead of the count, items, and search placeholder.

| Track | Change | Evidence |
| --- | --- | --- |
| Customer locales | Restored 13 per-locale keys the code already called but no locale file defined (docs/ \({previous sections}\) already assumed them): `home.{all,categories,change,deliveringTo,noLocationSet,noMatch}`, `menu.{all,categories}`, `checkout.pinNote`, `track.{couriers,searchOrders,searchOrdersPh,showingOf,loadMore}`, `pin.{done,doneSub,howItWorks,neverChat}` — identical key sets + single-brace placeholders across en/id/ms | `frontend-customer/src/locales/{en,id,ms}.json` |
| Customer PIN card | Delivered/completed state keeps the ✓ mark but now renders `pin.done` as a bold headline ("Handover complete — PIN accepted, enjoy your meal!") plus new `pin.doneSub` ("code is now inactive … please rate your order below") so it is unmistakable the PIN's job is finished; waiting/live states already explained via `pin.waiting` / `pin.handoverNow` + `pin.howItWorks` / `pin.neverChat` | `frontend-customer/src/features/postdelivery/PinHandover.tsx` |
| Customer orders list | No code change needed: `OrdersPage` already passes `{shown, total}` through the single-brace interpolator and debounces code search server-side — it renders "Showing {shown} of {total} orders" with the `Search by order code…` placeholder now the keys exist | `frontend-customer/src/features/tracking/OrderPage.tsx` |
| Verify | Customer `node scripts/smoke.mjs` all-pass (parity + placeholders), `npm run typecheck` (`tsc -b --noEmit`) clean. No backend/contract change (display copy only). Live seeded-backend + real-phone checks UNVERIFIED | — |

Assumptions: keeps the customer single-brace `{var}` convention; `pin.done` stays the headline key (copy clarified, key unchanged) so old cached builds degrade to the previous short line rather than a raw key.

## Security hardening: Argon2id, JWT rotation, sealed IDs, locked CORS, auth rate limits, HMAC webhook (2026-11-01)

Per request: passwords Argon2id, JWT 15 min + refresh rotation, AES-GCM ID
numbers never returned, CORS locked, auth rate-limited, HMAC webhook +
`webhook_events` dedupe — aligned across backend + all four frontends. Most
was already implemented; the gaps found and closed are the password hash, the
refresh-reuse case, cookie flags, and rate-limit coverage.

| Control | Status before | Change |
| --- | --- | --- |
| Argon2id | GAP — bcrypt cost 10 (`auth.go`, `seed.go`) | New `password.go`: Argon2id (`m=64MiB,t=1,p=4`, random 16 B salt, `$argon2id$` encoding) for signup/seed; `verifyPW` keeps a bcrypt fallback so pre-hardening rows still log in, and login re-hashes them to Argon2id in place — no flag day. `password_test.go`: round-trip, salt randomness, legacy fallback, short/oversize/malformed rejection |
| JWT 15 min + refresh rotate | DONE, hardened | Access TTL stays 900 s; rotation (revoke-old + issue-new) stays. Added reuse detection: a revoked token presented again revokes every session for that user and forces sign-in (theft/replay response); expired tokens 401 without side effects. `TF_JWT_SECRET` < 32 chars now fails startup instead of booting weak |
| Refresh cookie flags | GAP — no Secure flag | `setRefreshCookie`: HttpOnly + SameSite=Lax + `Secure` on TLS / `X-Forwarded-Proto: https` (local http dev keeps working); logout clears through the same helper so flags match. Per-app `tf_<app>_refresh` names + `X-TF-App` platform gate unchanged |
| AES-GCM ID sealed, never returned | DONE, hardened | `encryptID` (random nonce) + `hashIDNumber` (domain-separated, dup detection) unchanged; `loadProfile`/`getApplicationDetail` select only the hash and serve `id_number_saved`. New optional `TF_IDENC_KEY` replaces the JWT-derived key for new seals — rotation-safe (seals are write-only, nothing decrypts). Documented in `backend/.env.example` |
| CORS locked | DONE | Same-origin (Caddy proxies `/api`): `Access-Control-Allow-Origin` reflected only for `http://localhost:` / `http://127.0.0.1:` (Vite dev); added `Vary: Origin`. No `*`, no credentials for untrusted origins. All four frontends already default to same-origin `/api/v1` + `credentials: include` + `X-TF-App`, so no PWA change |
| Rate-limit auth | PARTIAL — signup/login/refresh/demo-login only | `s.rate` (30 req/min per IP+path, in-memory) now also covers `verify-email` + `webhooks/paddle`; 429s carry `Retry-After: 60`; the key table is capped (resets past 5000 keys) so it cannot grow unbounded. Frontends surface the 429 detail through the shared `ApiError` path — no PWA change |
| HMAC webhook + dedupe | DONE | `verifyPaddleSignature` (HMAC-SHA256 over `ts:rawBody`, 5-min window, subtle compare) + secret-empty refuses everything + `ON CONFLICT (event_id) DO NOTHING` atomic claim in `handlePaddleEventTx` — unchanged, now also rate-limited. Covered by `money_test.go` |
| Request hardening (bonus) | GAP — unbounded JSON bodies | Shared `decode()` caps every JSON body at 1 MiB (`MaxBytesReader` → 400). Largest contract body (menu publish) is well under; file uploads never go through `decode` |
| XSS / SQLi / CSRF posture | DONE (unchanged) | XSS: React auto-escape + JSON-only API, no HTML templating; SQLi: pgx parameters everywhere + `likeEscape` on `?q=`; CSRF: SameSite=Lax cookies + custom `X-TF-App` header + locked CORS (the cookie-only refresh endpoint is not reachable cross-site) |
| Frontend alignment | DONE (verified, no change) | All four `lib/api.ts` share the contract: access token memory-only (only `{id,email,roles}` in per-app `tb:<app>:user` storage), same `NO_REFRESH` allowlist, single 401→refresh→retry, `logout()` via `/auth/me` then `POST /auth/logout`, `credentials: include`, `X-TF-App` header. Runner adds a request timeout, CMS adds authed file-blob fetch — both additive, no drift |

Verify: `gofmt` clean on touched files (remaining `gofmt -l` hits are pre-existing nits in untouched files), `go build ./...` + `go vet` clean, `go test ./...` all-green (incl. 3 new `password_test.go` tests), 2026-11-01 in-session. CMS/courier/merchant/customer `tsc`/smoke re-run not needed (no frontend/contract change — display and auth flows untouched). Live round-trip vs seeded backend + real-phone checks UNVERIFIED.

Assumptions: JWT secrets in existing deployments are already ≥ 32 chars (the shipped default is 36) so the startup check blocks weak setups, not working ones; strict rotation reuse revokes all sessions — concurrent refreshes from two tabs in the same second can force a re-login (safer than a grace window for the demo); bcrypt fallback is removed only after every row has logged in once (seeded accounts migrate on next reseed/login).

## Live keys + River worker swap (2026-11-01, code DONE; live UNVERIFIED)

Per task: no mocks live — real `TF_GOOGLE_MAPS_KEY` (browser + server),
R2 presign (public/private buckets, 5-min expiry), Brevo SMTP + VAPID keys,
Paddle sandbox envs + webhook public URL, Modal pair + `/v1` + served model,
and River workers replacing the Postgres `jobs`-table poll loop. No hardcoded
data (all env/config), modular (`internal/storage`, `internal/app/river.go`),
same responsive/mobile UI (maps already key-gated with schematic fallbacks).

| Change | What |
| --- | --- |
| Config (`internal/config/config.go`) | New env-only slots: `TF_R2_ENDPOINT/ACCESS_KEY/SECRET_KEY/PUBLIC_BUCKET/PRIVATE_BUCKET/PUBLIC_URL`, `TF_SMTP_USER/PASSWORD/FROM`, `TF_VAPID_PUBLIC/PRIVATE_KEY/SUBJECT`, `TF_PADDLE_API_KEY/ENV/CLIENT_TOKEN`, `TF_PUBLIC_BASE_URL`; helpers `R2Configured()` / `R2BucketFor()` / `PaddleWebhookURL()` (`$base/api/v1/webhooks/paddle`). `config_live_test.go`: full env load + requires-all-buckets + default URL |
| R2 (`internal/storage/storage.go`) | `Store` interface over S3 presign: `PresignPUT/GET` (5-min `PresignTTL`), private files never get a public URL; empty endpoint = local-disk fallback in `TF_UPLOAD_DIR`. `storage_test.go`: fallback shape, presign URL bucket/expiry (local signing, no network), key namespacing |
| Files (`files_push_ws.go`, `openapi.yaml`) | `POST /v1/files/presign` returns R2 upload URL + `storage:"r2"` when configured (key saved for completion), else the local slot + `storage:"local"`; new authed `POST /v1/files/{id}/complete` marks R2 uploads ready; `GET .../content` 302-redirects to presigned GET (private, owner/admin-gated) or the public base. Merchant `menu/api.ts` + runner `lib/api.ts` PUT with `Content-Type`, omit cookies for R2, then `POST complete` (local flow unchanged) |
| Email + push | Brevo auth via `smtp.PlainAuth` when `TF_SMTP_USER` set (Mailpit no-auth path unchanged); `sanitizeHeader` strips CR/LF from job-payload recipients/subjects; `From` from `TF_SMTP_FROM`. VAPID env pair wins in `vapidKeys`/`vapidKeysReq`; `VAPIDSubject` (else demo `mailto:`) used for push |
| Paddle | Sandbox-only guard + demo-only `simulate-paid` unchanged (per plan); webhook HMAC + `webhook_events` claim unchanged. New: `TF_PADDLE_API_KEY/ENV/CLIENT_TOKEN` documented, webhook URL derived from `TF_PUBLIC_BASE_URL` (register it in the sandbox dashboard). Frontend `VITE_PADDLE_CLIENT_TOKEN/ENV` already wired in customer `.env.example` |
| Maps | All four `.env.example` ship active `VITE_GOOGLE_MAPS_KEY=` + `VITE_GOOGLE_MAPS_MAP_ID=` (classic markers when empty); CMS local `.env` filled with the same browser key (gitignored). Server key `TF_GOOGLE_MAPS_KEY` documented (IP-restricted); no npm dep (CDN loader) |
| Modal AI | Unchanged this session (already `Bearer id.secret` + `/v1` + served `meta-models/Muse-Spark-Open-816B-A42B` in `config.yaml`); one live smoke call still the way to confirm — UNVERIFIED |
| River (`internal/app/river.go`) | 17 typed args structs (JSON tags = legacy payload keys) + 17 workers calling the existing handlers (`doEmail/doPush` errors → retry, domain handlers void + status-guarded). `enqueueTx` becomes a same-tx `InsertTx` method; `enqueueNow`/`enqueueUnlessPending` (ByArgs uniqueness) / `queuePush` / `queueApplicantJobs` route through it — all ~50 call sites converted (`auth/orders/catalog/admin_orders/admin/courier/ai_http/files_push_ws`). `Migrate` runs `rivermigrate` (fail-fast); `StartWorker` starts the client (20 workers, 3 attempts). `workOnce` poll + `runAIJob` dispatcher removed; `demoReset` clears `river_job`. `river_test.go`: all 17 kinds decode + Kind-distinct + JSON round-trip, unique-opts split, bad-payload rejection, retry dedup-key equality |
| Env/docs | `backend/.env.example` documents every new key; `compose.yaml` needs no change (backend `env_file` passes `TF_*` through). `openapi.yaml`: `POST /v1/files/{id}/complete` + 302 note on content |

| Verify | Backend `go build/vet` + `go test ./...` green (incl. new `river`/`storage`/`config_live` tests) 2026-11-01 in-session; merchant + runner + customer + CMS `tsc -b --noEmit` 0; merchant/runner/customer/cms smoke suites all green; `gofmt` clean on touched files (other `gofmt -l` hits are pre-existing nits in untouched files). PostGIS integration UNRUN (river migration runs inside `Migrate` — needs a live round-trip). Live round-trip vs seeded backend with real keys + real-phone checks UNVERIFIED |

Assumptions: R2 bucket names/prefixes are created out-of-band (server never creates buckets); `TF_R2_PUBLIC_URL` must be the public custom domain/dev URL or public files 404 after redirect; River's `river_job` table is created by `migrateRiver` at boot — pre-existing `jobs` rows (if any) are left in place, unwatched; Brevo sends from `TF_SMTP_FROM` which must be a verified sender; Paddle stays sandbox (`TF_PAYMENTS_PROVIDER=paddle_sandbox` is the only supported value).

## VAPID .env guide + fail-fast validation (2026-11-01)

User report: VAPID keys were hand-typed at random, so push could never
deliver (the earlier `doPush` all-failed fix now surfaces this as a retried
job error instead of false success). Asked for `.env.example` generation
steps; generates the pair, then we verify live on their signal.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend validation | New `checkVAPIDPair` in config: empty pair still allowed (DB dev fallback in `app_secrets`); a set pair must be base64url P-256 (43-char private → 32 B, 87-char public → 65-B `0x04` point) AND the private key must derive the public key (`ScalarBaseMult` compare). Half pairs, random text, and mixed-generation pairs fail boot with a regeneration hint instead of silently breaking push | `backend/internal/config/config.go`, `vapid_test.go` (empty/half/random/mismatched/valid + `Load` accept/reject), `config_live_test.go` (dummy `"pub"`/`"priv"` replaced with a deterministic test-vector pair — placeholders would now correctly refuse to boot) |
| Backend docs | `backend/.env.example` VAPID block rewritten: exact `npx -y web-push generate-vapid-keys` command, paste-exactly rules, same-output pairing rule, re-subscribe-after-rotate note, frontends-need-nothing note (public key is fetched live from `GET /push/vapid-public-key`), dev-empty vs shared-env guidance, restart + `curl .../vapid-public-key` verify step | `backend/.env.example` |
| Verify | `gofmt` clean, `go build ./...` + `go vet` + `go test ./...` all green 2026-11-01 in-session. Live key install VERIFIED 2026-11-01 same day: user-generated pair checks out (65-B/32-B, private derives public — MATCH), backend rebuilt with the validation code + container recreated from `backend/.env`, boot log clean (no config error, River started), `GET /api/v1/push/vapid-public-key` returns the new 87-char env key (match YES), `POST /push/test` as `customer2@example.com` → `{"queued":true}` → River `push_send` completed attempt 1 with no error (zero subscriptions — honest completion). The pre-existing `discarded` row (3 attempts, "1 subscription(s) attempted, all failed") is the earlier fake-endpoint proof the retry fix works. Real-browser delivery still OPEN (needs a real subscription from your phone) | — |

Assumptions: frontends fetch the public key live at subscribe time, so no
frontend `.env` change is needed (PLAN.md's "public key in frontend env" line
is outdated); changing keys invalidates prior subscriptions (browsers
re-subscribe on next visit; 404/410 rows are auto-deleted); VAPID stays
non-critical to boot only when unset — an explicitly-set bad pair fails fast
by design, like the `< 32-char JWT` check.

## Gateway trailing-slash fix (2026-11-01)

User report: opening `/back-office` (no trailing `/`) returned the gateway
fallback text instead of the app — `handle /<prefix>/*` only matches paths
with the slash. Fixed with named matchers covering both shapes, so every
prefix works with and without the slash (including bare `/api`).

| Track | Change | Evidence |
| --- | --- | --- |
| Gateway | `@api`/`@backoffice`/`@customer`/`@courier`/`@merchant` matchers each cover `path /prefix` + `path /prefix/*`; proxy targets unchanged (frontend `basename`/`base` still receive the full prefix, backend still gets `/api` stripped) | `gateway/Caddyfile` |
| Docs | README notes slash-optional gateway paths | `README.md` |

Verify: `caddy fmt` clean; live check pending container restart
(`curl -s -o /dev/null -w '%{http_code}' localhost:8000/back-office`
should stop returning the fallback text).

## Golden-path live round-trip (2026-11-01) — VERIFIED (API path)

Executed against the running Podman stack via the Caddy gateway
(`:8000/api/v1`), current source, no code change — live data only.

- Auth: courier `runner@example.com`, customer `customer2@example.com`,
  merchant `chickenresto@example.com`, admin `admin@example.com` — all 200.
- Courier: `POST /courier/sessions` (work/runner/5000 m) 201 +
  `POST /courier/locations` batches accepted near (-6.2880, 106.7950),
  ~250 m from Ayam Geprek Sambal Korek (-6.2895, 106.7967); session stays
  fresh (`stale: false`), CMS dashboard live dot appears.
- First order (control): dropoff at the saved Home default (-6.2601,
  106.8093, ~3.5 km trip) → `ready` but zero offers — CORRECT per PLAN §6
  (runner `max_trip_m` 3000). Customer cancel 409 after accept (correct per
  cancel rules); the leg sits `searching` for the staff/no-courier timeout.
  README by-pass now warns off the Home address for runner tests.
- Golden order `TF-9MKEZF` (`88e3b116-…`): dropoff (-6.2835, 106.7990,
  ~711 m trip), size M, wallet-held → merchant accept → heartbeat → merchant
  ready → directed offer in ~seconds (`to_pickup_m` 251, payout 5763 IDR,
  30 s expiry) → `POST .../accept` 200 (`assigned` + `DeliveryEnvelope`
  payout) → merchant detail carries `pickup_code` 2181 + courier card →
  customer detail carries `delivery_pin` 1461 → `arrived pickup` →
  `pickup {pickup_code}` → `arrived dropoff` → `delivered {pin}` →
  `order_status: delivered`, payout kept.
- Post-checks: customer wallet debited, courier `/deliveries/history`
  lists the delivered leg with payout, merchant `/earnings` aggregates it,
  `GET /admin/orders/{id}` shows parties + delivery + timeline,
  `/admin/dashboard` shows the live dot + GMV, courier
  `/admin/couriers/{id}/performance` lists the delivery `in_window`,
  customer rating 201, `POST /courier/sessions/{id}/end` 200.
- Gateway: `/back-office/`, `/customer/`, `/courier/`, `/merchant/` 200;
  bare `/back-office`, `/customer`, `/courier`, `/merchant` still 404 on
  the RUNNING containers — the committed Caddyfile fix is not yet deployed
  (needs `bash scripts/podman-up.sh` rebuild/restart).

Still OPEN: real-phone PWA checks (install, push delivery to a real
subscription, outdoor GPS, Wake Lock, mic), Google Routes 403 on the server
key (fallback ETA works — enable Routes on the key), bare-path 404 until the
gateway image is rebuilt.

## Admin refund of the far control order (2026-11-01) — DONE + 1 fix

`TF-KRRQR6` (`51d75df3-…`, ready/held, delivery already timed out to
`no_courier`) refunded via `POST /v1/admin/orders/{id}/refund` with reason
"no runner in range for this distance — support refund (live verification)":
200, status `cancelled`, `payment_status` `refunded`, delivery `cancelled`,
timeline `ready → cancelled (admin)`, customer wallet credited in full
(96730 → 149266 = +52536 total), customer + merchant detail both read
`cancelled`, `order.refund` audit row with before/after, re-refund 409
"already cancelled". Customer push + refund email queued (zero-sub completion
without a real subscription, as designed).

- Bug found + fixed: the refund pushed the customer and (when assigned) the
  courier, but NOT the merchant owner — the kitchen that may have cooked gets
  only the WS frame. Every other cancel path notifies affected parties by
  push, so the admin path now does too: `refundAdminOrder` looks up the
  merchant `owner_id` (best-effort) and queues "Order refunded by support"
  with code + reason. No endpoint/contract/migration change. CMS toast
  corrected ("customer and courier" → "customer, merchant, and courier (if
  assigned)"). Verify: backend `go build/vet` + `TestAdminRefundPlan` /
  `TestParseOrderStatusFilter` green; CMS `typecheck` + `smoke` + `guards`
  green. Live deploy pending container rebuild (running `tf-backend` still
  serves the pre-fix image).

## SMTP/Brevo fix verified live (2026-11-01) — DONE

Root cause of the `535 5.7.8 Authentication failed` was a 9-char placeholder
in `TF_SMTP_PASSWORD`, not a real Brevo SMTP key. User installed the real
`xkeysib-…` key (`TF_SMTP_USER` = the `@smtp-brevo.com` login, which IS the
username) and allowlisted the host egress IP after we hit `525 Unauthorized
IP address`. Verified without an image rebuild: direct relay probe → `AUTH OK
(235)` + `SEND accepted`; restarted only the `tf-backend` container with the
new env; app `POST /auth/signup` → `email_send` River job `completed` in ~2s
with zero `smtp send failed` warnings. Pre-fix outbox rows stay as audit
rows (the worker sends once per job — no auto-resend of old rows). Still
open: `TF_SMTP_FROM` is the `no-reply@Trackfud.local` dev default — set a
Brevo-validated sender before judging or real recipients may bounce.

## Real-time honesty: live courier dot, API impact line, courier push opt-in (2026-11-03, code DONE; live UNVERIFIED)

Demo-video prep: three gaps where the UI told a weaker or invented story than
the backend already supports.

| Track | Change | Evidence |
| --- | --- | --- |
| Customer live dot (C2) | The backend already sent the customer `courier.location` (`delivery_id/order_id/lat/lng/heading/ts`) once per accepted courier GPS batch, but the app only parsed `order.status`, so the map moved on the 10 s poll. New validated `parseWsCourierLocation` (in-range coords, parseable `ts`); the one live socket (`useLiveOrder`, renamed from `useLiveOrderStatus`; `order.status` still invalidates) drops frames for other orders and writes `delivery.courierLast` into the cached order via `setQueryData` (`applyCourierFix`: older frames and uncached deliveries ignored), so `LiveMap` eases the marker at once. The 10 s poll stays the fallback on its own clock: WS writes keep `dataUpdatedAt` and the interval counts down from the last server answer (success or error), because a plain `setQueryData` resets react-query's interval and would starve the poll (checked against `query-core` 5.105: 4 polls vs 1 in a scaled run). `keepNewerCourierFix` stops a slow poll from dragging the dot back, unless the courier changed (reassignment) or the server shares no dot | `frontend-customer/src/features/orders/{types,live,hooks}.ts`, `features/tracking/OrderPage.tsx` |
| Customer Home impact (C3) | Removed the hardcoded "You powered 2.4 km of Rina's run." + English caption. `ImpactQuote` reuses `useImpact` (`GET /v1/customer/impact`): latest measured carry (`latestMeasuredImpact`: distance > 0, newest `delivered_at`) as `impact.quoteLine` "You powered {distance} of {name}'s workout." (km/mi formatter; `quoteLineAnon` when no first name), `impact.quoteInvite` before the first delivery, nothing on error / no measured carry; skeleton while loading; same `tb-quote` layout. Keys added in en/id/ms with identical placeholders | `frontend-customer/src/features/postdelivery/{ImpactCard.tsx,types.ts}`, `src/App.tsx`, `src/locales/{en,id,ms}.json` (`impact.quoteLine/quoteLineAnon/quoteInvite/quoteCaption`) |
| Courier push (R1/R2) | `sw.ts` rendered pushes but nothing ever subscribed, so couriers never got offer notifications. New `src/lib/push.ts` `subscribeOfferPush()`: `Notification.requestPermission()` as the first await (inside the tap) → `serviceWorker.getRegistration()` guard (dev has no SW) → `ready` → `GET /push/vapid-public-key` → `pushManager.subscribe({userVisibleOnly, applicationServerKey})` (same-key subscription reused, rotated key renewed) → `POST /push/subscribe {app:"courier", subscription}`. Never throws: resolves `subscribed/denied/unsupported/failed`, logs skips + failures. Called without await from Run Setup "Go online" (after `unlockAudio()`) and from the /checklist notifications row, which now ticks only on `subscribed` | `frontend-runner-biker/src/lib/push.ts`, `src/pages/RunSetupPage.tsx`, `src/App.tsx` (`Checklist`) |
| Verify | `corepack pnpm typecheck` + `smoke` + `build` green in `frontend-customer/` and `frontend-runner-biker/` (builds keep the pre-existing `inlineDynamicImports` deprecation + courier chunk-size warnings). Scratch runtime checks (not committed): frame parser + cache merge, impact picker, en/id/ms interpolation through the app's i18next config, and the push helper against a stubbed browser (sync permission prompt, POST body shape, key reuse/rotation, failures resolve). No backend/contract/migration change. Live round-trip (dot moving during a real run, push arriving on a phone) UNVERIFIED | — |

Assumptions: the Home line skips deliveries with no measured carry (`distance_m` 0) rather than printing "0 m", and the courier's mode is not in the impact payload, so the copy says "workout" (inclusive of runners and bikers) instead of "run"; the checklist notifications row means "this device will get offer pushes", so it stays unchecked in browsers without a push service or SW (Vite dev server, some headless browsers); `delivery.eta` frames are still not parsed by the customer (route/ETA changes arrive with the poll or the next status refetch).


## Paddle top-up `required price_id` fix (2026-11-03, LIVE VERIFIED for USD)
User report: wallet top-up (and card pay) with the Paddle sandbox failed with
`required price_id`, in the frontend overlay as well as the backend path. Root
cause: the customer PWA opened `Paddle.Checkout` with an ad-hoc `amount` and
no price. Paddle Billing rejects amount-only items — a checkout needs either a
pre-created price or a server-created transaction opened by id. There was no
server endpoint to mint it, so top-up could never open the overlay.

| Track | Change | Evidence |
| --- | --- | --- |
| Backend checkout (B5) | New `POST /v1/customer/payments/{id}/checkout` (auth, owner/admin, pending-only): creates a Paddle transaction via `TF_PADDLE_API_KEY` with one inline price for the exact pending amount (minor-units string, uppercased ISO currency) + `custom_data.payment_id`, `collection_mode: automatic`; stores `paddle_txn_id`, reuses it on retry (200 vs 201). New `GET /v1/customer/payments/{id}` (same ownership) for post-overlay polling — the webhook confirms asynchronously. 503 when provider off or API key unset (demo `simulate-paid` path unchanged). **422 `ErrPaddleCurrencyUnsupported` for currencies Paddle cannot charge (e.g. IDR — its Transactions API allowlist has no IDR)** | `backend/internal/app/paddle_checkout.go`, `app.go` routes, `api/openapi.yaml` (`createPaymentCheckout` 422, `getPayment`, `PaymentCheckout`) |
| Backend webhook (B5) | `parsePaddleEvent` now tolerates the real dashboard shapes: `notification_id` event-id alias, `transaction_id` alias, `customData` camelCase + `custom_data`, status pass-through. `applyPaddleEvent` now handles `transaction.paid` and `transaction.updated` (completed/paid pay once through the same idempotent ledger path; ready ignored; failed/canceled/past_due fail) plus `transaction.payment_failed`. `GET /v1/config/public` now also serves `payments: {provider, paddle_env, paddle_client_token, card_enabled}` (publishables only — never the webhook secret or API key). Webhook apply errors are now logged server-side with event id/type (opaque 500 to Paddle, real cause in logs), and the status-update failure no longer masks the original apply error | `backend/internal/app/money.go`, `app.go` `publicConfig`, `money_test.go` (live-shape parse, `$4::jsonb` claim assertion), `paddle_checkout_test.go` (base/payload/validation incl. IDR-unsupported/upstream) |
| Clearing account (B5) | **Migration `00013`: `ledger_accounts_balance_minor_check` now exempts `paddle_clearing`.** The blanket `>= 0` floor made EVERY live top-up/card apply fail (webhook claimed fine, then the tx rolled back on the check) because the clearing leg posts negative before any settlement batch runs. `paddle_clearing` is a receivable ("Paddle owes us"), documented on the account const; all customer/courier/merchant kinds keep the floor | `backend/db/migrations/00013_paddle_clearing_negative.sql`, `internal/ledger/ledger.go` |
| Customer PWA (C2) | New modular `features/orders/paddle.ts` (loader + `openPaddleCheckout`, transaction-id first, amount-only refused with a typed error instead of reaching Paddle; build-time VITE vars with `/config/public` fallback; single-flight load). `api.ts` gains `createPaymentCheckout` + `fetchPayment`. `pay.ts` rewritten around the server transaction: checkout → overlay → 60 s payment poll → placed/topup_credited; price-id fallback kept when supplied; demo confirm only when no token / server 503 path. `CheckoutPage` keeps the `card_authorized` (webhook-slow) order id with a new "Check payment status" button (en/id/ms `checkout.checkStatus`); profile top-up uses the wallet currency (was hardcoded IDR), form submit + disabled input, pending message preserved | `frontend-customer/src/features/orders/{paddle.ts,pay.ts,api.ts,CheckoutPage.tsx}`, `src/App.tsx` (ProfilePage), `src/locales/{en,id,ms}.json`, `.env.example` (server-key note) |
| Verify (LIVE 2026-11-03, sandbox) | `go vet` + `go test ./internal/{app,ledger,config}` green. Live against the running stack (production mode, `APP_DEVELOPMENT=production`, demo off): USD 100 top-up → `checkout` **201** with real `txn_01…` (Paddle accepted the inline price+product — `required price_id` gone) → self-delivered signed `transaction.completed` webhook → **200 received** → payment `paid`, wallet USD 0→100. Exact replay of the same `event_id` → **200 duplicate:true**, wallet unchanged (double-delivery pays once). IDR top-up → checkout **422** with an actionable message (Paddle cannot charge IDR at all — see assumptions). Card-order overlay path still unverified (shares the now-proven claim→apply machinery) | backend logs (`paddle webhook apply failed` now carries the cause), `webhook_events` + `payments` + wallet reads |

Assumptions: one Paddle transaction per payment (retry reuses it; the webhook still pays once either way); Paddle transaction statuses `completed`/`paid` move money, `ready` does not (authorized-but-capturing); demo mode (`TF_DEMO_MODE=true`, no Paddle keys) keeps working through `POST /dev/payments/{id}/simulate-paid` with no overlay. ~~Indonesian top-ups need a follow-up decision~~ — decided 2026-11-03, implemented below: Paddle charges USD, wallet gets full IDR. B5 stays PARTIAL per plan (sandbox only, never real rails).

## FX-converted IDR top-ups: Paddle charges USD, wallet gets full IDR (2026-11-03, LIVE VERIFIED)

Follow-up decision (user): don't block IDR — convert at checkout, tell the customer up front, credit the full IDR after the USD charge lands.

| Track | Change | Evidence |
| --- | --- | --- |
| Ledger | New `fx_position` bridge account + `FxTopupPostings` / `FxCardChargePostings` 4-leg constructors (each currency nets to zero; position account carries the cross). `ConvertMinor` converts minor units across minor-unit scales at a major-unit rate (half up); IDR counts as whole rupiah (seed prices are whole-rupiah, e.g. 25000 = Rp25.000), zero-decimal set `{IDR,JPY,KRW,CLP,VND}` | `internal/ledger/ledger.go`, `ledger_test.go` (`TestFxTopupPostings`, `TestConvertMinor`), migration `00014` (also extends the kind check + floor exemption to `fx_position`) |
| Backend (B5) | `payments` gains `charge_currency/charge_amount_minor/fx_rate` (NULL = same-currency charge). Checkout quotes unsupported currencies to USD via `resolveRate` and locks the quote (retry-safe); no-rate → 422 with an actionable message. Webhook completion posts the FX legs for quoted payments (top-up and card-escrow alike); `paymentView` surfaces `fx_quote` (charge amount + note) when set. `GET /v1/fx/rate` accepts `?amount=` and returns server-computed `converted` preview. Same-currency flow byte-identical | `internal/app/money.go` (`fxQuote`, apply branch), `paddle_checkout.go` (quoting), `fx.go` (`fxConverted`), `openapi.yaml`, `money_test.go` (`TestFxQuote`) |
| Customer PWA (C2) | Top-up form fetches `getFxPreview` (server math, no hardcoded scales) and shows `topup.fxNotice` — "Paddle charges in $X, … wallet gets the full RpY" (en/id/ms) — before the customer pays | `features/orders/api.ts`, `App.tsx` (ProfilePage), `locales/{en,id,ms}.json` (also restored `checkout.checkStatus`) |
| Verify (LIVE 2026-11-03, sandbox) | Rp100.000 top-up → checkout **201** (`txn_01…`, charge **617¢ = $6.17** @ seed rate, `fx_quote` in response) → signed `transaction.completed` → **200** → payment `paid`, IDR wallet **149266→249266 (+100000 in full)**, USD wallet untouched. Replay → **200 duplicate:true**. Ledger: `fx_position` USD +617 / IDR −100000, `paddle_clearing` USD −717 (receivable from Paddle grows). USD regression top-up ($1→$2, no `fx_quote`) still 200/paid | backend logs, `payments` + `ledger_accounts` reads |

Assumptions: quote locks at checkout (rate refreshes daily via `fxRefresh`; intra-day drift absorbed by the platform position — no spread or fee modeled yet; the `fx_position` balance is the visible P&L to reconcile later). Paddle minimum charge amounts are not enforced client-side — an undersized conversion surfaces Paddle's own error. Card orders in IDR now convert the same way (shared checkout/apply path) but the overlay copy for orders still says the USD total only — order-side notice copy is a follow-up.

## Landing page (`frontend-landing-page/`) — 2026-11-04

New public marketing site for Trackfud. English only, fully static Astro build, no backend/API dependency.

| Item | Status | Evidence / notes |
| --- | --- | --- |
| Landing page | DONE (build verified) | Astro static site: hero (`Run. Ride. Earn.`), how-it-works, customers / couriers / merchants sections, features, people stories, PWA "no download" section, FAQ, final CTA, footer. All copy centralised in `src/data/content.ts`; components in `src/components/` (`Header`, `Hero`, `PhoneMock`, `Sections`, `Closing`, `Footer`); SEO head + JSON-LD in `src/layouts/Layout.astro` |
| Design system parity | DONE | Exact PWA hex tokens: bg `#060709`, ink `#f4f4f5`, muted `#a1a1aa`, faint `#63636b`, line `rgba(255,255,255,0.1)`, good `#34d399`, warn `#fbbf24`, danger `#fb7185`; Newsreader + Inter self-hosted (copied from `frontend-customer/public/fonts/`) |
| Phone simulator + people images | DONE | CSS phone mockups (`PhoneMock.astro`: customer / courier / merchant variants, animated route + count-up earnings); 4 AI-generated realistic people photos in `public/images/` (runner, biker, merchant kitchen, customer). `merchant.png` used only as `public/favicon.png`, never in banners |
| Motion | DONE | Staggered hero lines, floating phones/chips, marquee slogan, scroll reveals, hover lifts + image zoom, FAQ accordion; `prefers-reduced-motion` respected |
| SEO | DONE | Title/description/keywords, Open Graph + Twitter cards, `Organization` + `WebSite` + `FAQPage` JSON-LD, semantic landmarks, single `<h1>`, alt text, `robots.txt` |
| Verify | DONE | `npm run build` green (1 static page in `dist/`); dev server smoke-checked. CTAs intentionally scroll to on-page sections only (no app links wired yet, per confirmation) |

Assumptions: marketing copy is static content (no API fetch) because the landing page has no backend contract; the only illustrative numbers are inside the phone simulator UI. Gateway does not route the landing page yet — it runs standalone (`npm run dev` → http://localhost:4321).

### Landing fixes (2026-11-04, user-reported from screenshot)

| Fix | Change | Evidence |
| --- | --- | --- |
| Double navbar on desktop | Root cause: `.mobile-nav { display:flex }` overrode the UA `[hidden]` rule, so the collapsed mobile menu always rendered under the desktop header. Added `.mobile-nav[hidden] { display:none }` | `frontend-landing-page/src/components/Header.astro`; built CSS contains `.mobile-nav[…][hidden]{display:none}` |
| Phone mock fidelity + responsiveness | `PhoneMock.astro` rewritten to mirror the real PWAs (`tb-topbar` loc badge + avatar, `tb-display`, `tb-search`, `tb-promo`, `tb-stats`, `tb-chips`, `tb-shop` with live/rating/distance floats, courier goal ring + `tb-offer` fee/timer/accept, merchant `tb-kitchen-bar` + order cards, `tb-nav` bottom bar with active dot) and to scale fluidly: `container-type: inline-size` + `cqw` units instead of a fixed 280px width, so hero (300px), back (158–218px) and audience (148–190px) sizes all scale proportionally | `frontend-landing-page/src/components/PhoneMock.astro`, `Hero.astro`, `Sections.astro` |
| Regression check | New `scripts/verify.mjs` (11 checks: hidden nav rule, single site header, cqw scaling, PWA class fidelity) wired as `npm run verify`; failed 8/11 before the fix, passes 11/11 after | `frontend-landing-page/scripts/verify.mjs`, `package.json` |

### Landing fixes, round 2 (2026-11-04, user-reported from screenshot)

| Fix | Change | Evidence |
| --- | --- | --- |
| Oval phone frames | Frame rebuilt as a real device: metallic bezel, `9cqw` radius (was `14cqw` pill), camera island, volume/power side keys, home indicator; removed fixed `min-width: 26px`-style minimums inside the mock that overflowed at 148–190px sizes, so all inner layout is purely proportional (`cqw`) | `frontend-landing-page/src/components/PhoneMock.astro` |
| "PWA" jargon | All visitor-facing copy now says "No download" / "Works in your browser" / "one browser page each"; the acronym and "Progressive Web App" no longer appear anywhere in the built page; `#pwa` anchor renamed to `#browser` | `Layout.astro`, `data/content.ts`, `Hero.astro`, `Sections.astro`, `Closing.astro`, `Footer.astro`; verify check on `dist/index.html` |
| Marquee + mobile responsiveness | Marquee type is now `clamp(1.05rem, 2.4vw, 1.6rem)` with non-shrinking chunks; hero phones shrink fluidly on small screens (main 72vw, backs 36vw, no `scale()` hack), hero/final CTAs go full-width under 480px, audience photo/phone and header compact under 600/480px, global wrap/button/section tightening under 480px | `Sections.astro`, `Hero.astro`, `Closing.astro`, `Header.astro`, `styles/global.css` |
| Regression check | `scripts/verify.mjs` extended to 20 checks (jargon-free built page, device frame parts, no fixed inner minimums, marquee clamp, full-width mobile CTAs); failed 8 before, passes 20/20 after, `npm run build` green, dev server 200 | `frontend-landing-page/scripts/verify.mjs` |

### Landing fixes, round 3 (2026-11-04, user-reported)

| Fix | Change | Evidence |
| --- | --- | --- |
| Oval phone frames removed | Frame is now a squared slab (`5cqw` radius, flat dark bezel, `3.6cqw` screen radius); the oval camera island is replaced by a single camera dot; side keys + home indicator kept | `frontend-landing-page/src/components/PhoneMock.astro` |
| Zoomed feature mocks | Each mock now zooms into its key feature at readable scale instead of squeezing a full page in: customer promo + shop card, courier offer fee + accept, merchant incoming order. The rest of the page crops at the screen edge like a real phone screenshot, with the bottom nav always visible | `PhoneMock.astro` (`.pm-focus`, larger display/promo/offer/shop sizes, smaller goal ring) |
| Regression check | `verify.mjs` now also asserts no oval island, squared frame, and focus-crop mocks; 21/21 pass, build green | `frontend-landing-page/scripts/verify.mjs` |

### Landing fixes, round 4 (2026-11-04, user-reported)

| Fix | Change | Evidence |
| --- | --- | --- |
| Phone bezel padding removed | `PhoneMock` frame now has `padding: 0` with only a thin `1.4cqw` border as the bezel; the app screen fills the frame edge to edge | `frontend-landing-page/src/components/PhoneMock.astro` |
| Install card mobile overflow | Root cause: the `floaty` keyframes (`translateY/rotate`) overrode the card's `translateX(-50%)` centring, shifting it half its width off-screen. Card is now margin-centred (`left/right: 0; margin-inline: auto; width: min(340px, 100% - 2rem)`) with no transform animation | `frontend-landing-page/src/components/Closing.astro` |
| Marquee right-side gap on desktop | Track held only 2 chunks (~1,800px), narrower than wide viewports, so the loop ran out of content. Now 8 identical chunks (4 duplicated halves, ~9,000px+); `translateX(-50%)` loops seamlessly at any width | `frontend-landing-page/src/components/Sections.astro`; built HTML contains 8 `marquee-chunk` spans |
| Regression check | `verify.mjs` at 24 checks, all passing; build green; dev server 200 | `frontend-landing-page/scripts/verify.mjs` |

### Landing fixes, round 5 (2026-11-04, user-reported)

| Fix | Change | Evidence |
| --- | --- | --- |
| Thick oval phone border removed | Phone frame is now a simple thin bezel only: no `border`, no `outline`, `1cqw` black bezel, `3cqw` outer radius and `2.2cqw` screen radius (nearly squared, professional slab) | `frontend-landing-page/src/components/PhoneMock.astro`; verify asserts thin bezel + no thick border |

### Landing fixes, round 6 (2026-11-04, user-reported)

| Fix | Change | Evidence |
| --- | --- | --- |
| Audience photo hidden by phone on mobile | Under 600px the mock no longer overlaps the photo: it renders statically, centred below it (`position: static`, no rotation), with the copy following underneath | `frontend-landing-page/src/components/Sections.astro` |
| Readable zoomed mocks | Mocks show one feature each at readable scale: customer (headline + search + promo + chips + live shop card, no stats wall), courier (live pill + stats + big offer, no goal ring), merchant (incoming order only). A `@container (max-width: 250px)` query enlarges relative type on small phones so nothing shrinks to unreadable | `frontend-landing-page/src/components/PhoneMock.astro`; verify at 28 checks, all passing |

### Landing fixes, round 7 (2026-11-04, user-reported)

| Fix | Change | Evidence |
| --- | --- | --- |
| Separate phone card on mobile | Replaced the stacked separate-card layout with a modern half-bleed: under 600px the mock is half-cut by the screen edge (`right: -16%`, `47vw` width) over the photo, which stays fully visible; sections use `overflow: clip` so the bleed never scrolls the page | `frontend-landing-page/src/components/Sections.astro`; verify asserts the mobile bleed |

### Landing fixes, round 8 (2026-11-04, user-reported)

| Fix | Change | Evidence |
| --- | --- | --- |
| Cropped zoom mocks on mobile | Audience phones now sit below the photo (no overlap) as a cropped zoom: `300/440` portrait crop at `min(320px, 86vw)`, bottom nav hidden, bottom fade — only the key card shows, enlarged and readable | `frontend-landing-page/src/components/Sections.astro`; verify asserts the mobile crop |
