# Trackfud Milestone Checklist — done vs plan

Date: 2026-10-28 · Source of truth: `AGENTS.md` (+ per-app `AGENTS.md`).
Method: code inspection of this repo on 2026-10-28 (routes, files, deps, configs).
No real-phone verification has been done yet — every "Done" below means
*implemented in code*, not *verified on device*.

Legend: DONE = implemented · PARTIAL = works with a documented simplification ·
OPEN = not built yet.

Folder-name note: the courier app lives at `frontend-runner-biker/`
(served at `/courier/`), not `frontend-biker-runner/`.

## Backend (`backend/`) — milestones B0–B6

| Milestone | Status | Evidence / notes |
| --------- | ------ | ---------------- |
| B0 contract + skeleton | DONE | `api/openapi.yaml` (94 `/v1` paths); `config.yaml`; JWT 15 min + per-app refresh via `X-TB-App` + RBAC; `GET /healthz`; 6 goose migrations; `Containerfile` |
| B0 generated TS client | PARTIAL | Contract exists and is rich, but all three frontends use hand-written typed `fetch` wrappers (`lib/api.ts`), not an `oapi-codegen`/`openapi-typescript` generated client |
| B1 auth/users/files/notify | DONE | signup/login/refresh/logout/demo-login/verify-email; `files/presign` + local upload (R2-shaped contract, local disk); push subscriptions + VAPID + demo outbox/Mailpit; WS ticket + hub; seed (`internal/app/seed.go`, `cmd/simulator`) |
| B2 merchant + catalog + order machine + ledger | DONE | Merchants (geo `location`, hours, prep), versioned agreement e-sign + staff invite/roles, menu CRUD with `size_class`/`spill_risk`/`travels_well`; guarded `Transition()` + `order_events` + merchant-timeout jobs + WS broadcast; integer-minor-unit double-entry ledger + idempotency + refunds; `order_test.go`, `ledger_test.go`, `money_test.go` |
| B3 courier onboarding + sessions + GPS | DONE | Application autosave, config-driven fitness-test eval (moving time, 2× elapsed cap, gap rules), WS `loc.batch` + HTTP fallback, session stats (distance/moving/active/pace), approve/reject + email + push, sanctions tables; `fitness_test.go`, `ingest_test.go` |
| B4 dispatch + delivery completion | DONE | PostGIS `DispatchCandidates`, Go scoring + cascade, atomic accept, offer/search/staff timeout jobs, "leave now" nudge, pickup code + PIN/photo handover, settlement, 72 h auto-complete, live broadcasts, Routes API ETA (WALK/BICYCLE + beta warning) with planning-speed estimate fallback; `dispatch_test.go` |
| B5 money real paths + staff fallback + social | PARTIAL | Paddle sandbox top-up + direct pay, HMAC webhook + dedupe, mock `payout_process` withdrawals + hold/release, staff fallback, no-courier choices, separate ratings, WHO minutes + impact aggregates — all present; "PARTIAL" only because money moves via sandbox + `dev/payments/simulate-paid`, never real rails (per plan) |
| B6 AI + simulator + demo controls | DONE in code, provider switch OPEN | `internal/ai` (client, prompts, schemas, tools, transcribe, voice, SAM) + jobs (menu import, translate, trust brief, proof check, feedback labels) + `ai_calls` logging + offline fallbacks; voice relay + confirm; `cmd/simulator` + demo controls + judge logins — all wired. OPEN: point text/chat calls at the Modal endpoint (see "AI plan change" below); verify the Modal-served model id |

## Customer (`frontend-customer/`, `/customer/`)

| Milestone | Status | Evidence / notes |
| --------- | ------ | ---------------- |
| C1 shell + location + browse | DONE | PWA shell + manifest (`/customer/`), `sw.ts`, auth + one-click demo login, `X-TB-App: customer`, GPS/Places/pin/note location, distance-sorted restaurant list + availability badge, trilingual menu (en/id/ms) + "show original", cart, push subscribe + iPhone guide, offline banner |
| C2 cart + pay + live tracking | PARTIAL | Quote + 30–60 min promise pre-pay, idempotent wallet pay, Paddle checkout via CDN lazy-load (`features/orders/pay.ts`), `awaiting_payment` → `placed`, status timeline, courier profile + history, customer-only PIN, push `order.status` — DONE. PARTIAL because `LiveMap.tsx` is a schematic SVG animator (explicit swap-in point), not real Google Maps: `@vis.gl/react-google-maps` is not installed and no Maps key is read |
| C3 post-delivery + edge cases | DONE | PIN handover UI, separate courier/restaurant ratings, impact card + page, no-courier wait/pickup/refund, translated chat + quick replies, send-a-cheer, history + receipt view, empty/error/loading states, reconnect + backlog resend |

## Courier (`frontend-runner-biker/`, `/courier/`)

| Milestone | Status | Evidence / notes |
| --------- | ------ | ---------------- |
| R1 onboarding + pre-run + fitness test | DONE | Signup, runner/biker choice, pre-run checklist (GPS/Wake Lock/mic/notifications/motion), fitness recorder + 1 checkpoint photo, IndexedDB draft autosave, R2-presigned doc uploads (shrunk ≤1600 px), status screen |
| R2 Run Mode + offers + delivery | PARTIAL | Session start (goal, free/saved-track, AI-track placeholder), big Run Mode stats, WS `loc.batch` + HTTP fallback + IndexedDB buffer (real `ts`, UUID/point), offer card (sound/vibration/voice/push, 30 s timer, track-fit info), "head to restaurant" nudge, route + "Open in Google Maps", pickup-code confirm, PIN/photo completion, wallet + mock withdraw, "Earned & moved" summary + WHO ring + cap/rest/hydration nudges — DONE. PARTIAL because: no in-app turn-by-turn (external Maps link only), no Maps SDK route polyline, QR-confirm variant not verified in code |
| R3 Voice Copilot + staff mode + health extras | PARTIAL | Hold-to-talk → server voice relay with local EN+ID parser fallback (`features/voice/`), spoken offers + cheers aloud, per-km/mi pace cues, translated chat, staff mode + shift/offers, saved tracks, cadence display, ratings received — DONE. GPX export (P2, cut-first per plan) not present — OPEN by design |

## Merchant (`frontend-merchant/`, `/merchant/`)

| Milestone | Status | Evidence / notes |
| --------- | ------ | ---------------- |
| M1 signup + setup + agreement + staff | DONE | Business profile, click-map draggable lat/lng pin + geolocation + search + editable fields + pickup note, hours/prep in merchant timezone, versioned Partner Agreement e-sign (staff-fallback clause) → pending screen, staff invite + `can_deliver`/`on_shift` toggles |
| M2 Snap-a-Menu + menu management | DONE | Photo shrink ≤1600 px → server import-job polling → editable review table (low-confidence highlight, "prices checked" tick gates publish), multilingual items, sold-out toggle, size/spill/travels-well labels + pickup-only badge, full menu CRUD, busy mode / pause store (`features/menu/extras.ts`) |
| M3 live order operations | DONE | Loud alert (sound unlocked on "Start receiving orders" tap) + push, accept + prep time / reject, order queue + courier ETA, Ready button, pickup-code confirm, handover done state, staff-fallback notices, earnings + weekly statements (mock payout note). Printer/promos (P2) cut per plan |

## Cross-cutting — OPEN (not built, per plan or gap)

- **Admin CMS app (`AGENTS.md` §4.4): OPEN.** No `frontend-admin/` exists.
  Admin capability today is API-only (`/v1/admin/*`: applications, sanctions,
  withdrawals) plus demo controls. Dashboard, Trust Brief UI, settings editor,
  audit-log viewer, "AI under the hood" page have no frontend.
- **Real Google Maps on any frontend: OPEN.** No Maps/Places/Paddle npm
  dependencies installed anywhere; browser Maps key not wired. Backend
  `internal/maps` is ready and only needs `TB_GOOGLE_MAPS_KEY`.
- **Real R2 / River / Brevo / Paddle: OPEN by plan.** Local disk, Postgres
  queue shim, Mailpit, sandbox/simulate stand in (see root `README.md`).
- **Real-phone verification: OPEN.** Install, push delivery, outdoor GPS, Wake
  Lock, mic on Android + iPhone still required before any "verified" claim
  (guardrail in all three frontend `AGENTS.md`).
- **Contract-codegen loop (`api-sync` skill): OPEN.** Backend contract and
  frontend wrappers are maintained by hand; drift is possible — regenerate or
  diff when `openapi.yaml` changes.

## AI plan change (2026-10-28): serve chat/text AI via Modal

Previously: `internal/ai` pointed at `https://api.meta.ai/v1` directly.
Now: text/chat/tool-calling features route to the Modal-hosted endpoint —
no code change needed (the client is OpenAI-compatible, so `BaseURL` +
bearer token already cover it):

```bash
TB_META_BASE_URL=https://muhammad099x-work--ep-muse-spark-open-816b-a42b-server.us-west.modal.direct
TB_META_API_KEY=<modal proxy token>   # endpoint returns 401 "proxy auth required" without it (verified 2026-10-28)
TB_META_SPARK_MODEL=<model id actually served on Modal, e.g. muse-spark-open family>
```

Scope and caveats:

- Via Modal: menu-import text pass, translation, Trust Brief text, AI Coach,
  voice-intent tool calls — anything chat-completions shaped.
- NOT via this Modal endpoint: realtime PCM transcription and SAM vision
  (the endpoint serves the chat model only). They stay on the Meta Model API
  direct (`TB_META_BASE_URL` override is global, so a split needs per-feature
  base-URL config — see `backend/AGENTS.md` B6) or on the deterministic
  fallbacks in `internal/ai/fallback.go`, which keep the demo offline-capable.
- Keys stay server-side only (unchanged guardrail); every Modal call is still
  logged to `ai_calls` with model/latency/tokens/cost.
- Remaining work: confirm the exact served model id, smoke-test one
  chat call through Modal, then add per-feature base-URL override if
  transcribe/SAM must run while the global base points at Modal.

## `.env.example` files (added 2026-10-28)

Every key below maps to a real `os.Getenv` read in
`backend/internal/config/config.go` or `import.meta.env` in the frontends —
no invented keys:

- `backend/.env.example` — `DATABASE_URL`, `TB_CONFIG`, `TB_ADDR`,
  `TB_DEMO_MODE`, `TB_JWT_SECRET`, `TB_PADDLE_WEBHOOK_SECRET`, `TB_UPLOAD_DIR`,
  `TB_SMTP_HOST/PORT`, `TB_GOOGLE_MAPS_KEY`, `TB_META_API_KEY/BASE_URL/SPARK/
  CONTRIBUTOR/TRANSCRIBE/SAM_MODEL` (Modal values pre-filled as comments).
- `frontend-customer/.env.example` — `VITE_API_BASE`, `VITE_PADDLE_CLIENT_TOKEN`,
  `VITE_PADDLE_ENV` (+ commented `VITE_GOOGLE_MAPS_KEY` for the Maps swap-in).
- `frontend-merchant/.env.example` — `VITE_API_BASE` (+ Maps key placeholder).
- `frontend-runner-biker/.env.example` — `VITE_API_BASE` (+ Maps key placeholder).
