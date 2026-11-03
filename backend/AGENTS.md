# Backend Agent — Trackfud Go API

> You own `backend/` only. Do not edit frontends, deploy files, or `AGENTS.md`.
> Read first: `docs/app-context.md`, `docs/backend-architecture.md`,
> `docs/code-style-backend.md`. Contract: `backend/api/openapi.yaml`
> (create it in B0; generate with `oapi-codegen`). Plan: `AGENTS.md` §§5–7, 11, 15, 22.

## Scope

One Go binary: REST `/v1` + WS hub + voice relay + dispatch + River workers.
PostgreSQL 18 + PostGIS, River queue, R2, VAPID push, Brevo SMTP, Paddle
sandbox webhooks, Meta Model API, Google Routes API.

## Milestones (in order — each is a focus unit; finish one before the next)

### B0 — Contract + skeleton (unblocks all frontends)

- Write `api/openapi.yaml` (§15.4: auth/me, customer, courier, merchant,
  admin-lite, webhooks; §15.5 WS ticket flow). Generate server interfaces.
- Skeleton: `config/` (koanf + `config.yaml` defaults per §15.2), `slog`,
  `/healthz`, goose migrations baseline, auth (JWT 15 min + per-app refresh
  cookies via `X-TF-App`, RBAC), `httpapi` router + middleware.
- `db/migrations`, `db/queries` (sqlc + pgx), `db/seed` stubs; `Containerfile`.
- Done when: `go build ./... && go vet ./...` pass; health endpoint answers;
  generated TS client is consumable by frontends.

### B1 — Auth, users, files, notify plumbing

- `users`, `user_roles`, `refresh_tokens`; signup/login/refresh/logout,
  verify-email, `demo-login` (demo mode only). Rate-limit auth.
- `POST files/presign` (fixed content-type, size cap, 5-min expiry, per-user
  prefix) → R2 PUT → `files` row. Public vs private buckets (§18).
- `push_subscriptions`; VAPID send (TTL, high urgency for offers, topic
  dedupe, delete on 404/410). River `push_send`/`email_send`; Brevo SMTP via
  Mailpit locally; demo outbox (§17).
- Done when: signup → login → presign upload → test push + email (Mailpit) all pass.

### B2 — Merchant + catalog + order machine + ledger

- Merchants (profile, `location geography(Point)`, hours, prep), agreements
  e-sign (versioned, sha256, snapshot), staff invite/roles, menu CRUD with
  `size_class`/`travels_well` labels.
- `Transition()` state machine (§5): guarded `UPDATE ... WHERE status=from`,
  `order_events` append, River timeouts (`merchant_accept_timeout`),
  post-commit WS broadcast. Unit-test every allowed/forbidden transition.
- Double-entry ledger: integer minor units, `SUM=0` per entry+currency,
  `idempotency_key UNIQUE`, balance cache + `CHECK >= 0`, settlement +
  instant wallet refunds, fee math/rounding per currency (§11–§12).
- Done when: wallet order placed → accepted; reject/timeout refunds; ledger +
  fee tests pass (§22).

### B3 — Courier onboarding + sessions + GPS

- `couriers`, `courier_applications`, `activity_sessions`, `location_points`,
  `checkpoint_photos`. Application autosave, R2 private docs.
- Fitness-test evaluation from config (moving time, 2× elapsed cap, gap/jitter
  rules); WS `loc.batch` ingest + HTTP fallback; session stats
  (distance/moving/active/pace); Wake Lock–friendly reconnect + backlog.
- Approve/reject + Brevo email + push; sanctions tables ready for B5/CMS use.
- Done when: recorded 2 km test submits → evaluated → approved via API; email
  in outbox + push received.

### B4 — Dispatch + delivery completion

- PostGIS `DispatchCandidates` (corridor 400/800 m, to-pickup, trip, size
  filter, `goal_left_m`, anti-double-assign), scoring + cascade (size 3),
  atomic accept, `offer_expire`/`search_timeout`/`staff_timeout` River jobs,
  "leave now" nudge timed to `ready_at_est`.
- Pickup code, PIN/photo handover, settlement on delivered, `auto_complete`
  72 h; live `courier.location` + `order.status` broadcast; Routes API ETA
  (WALK/BICYCLE + beta warning).
- Done when: golden path passes end to end (§21 day 4: order → accept → offer
  accepted → pickup → PIN delivered → settlement).

### B5 — Money real paths + staff fallback + social data

- Paddle sandbox: top-up + direct pay (shared code), `POST webhooks/paddle`
  (HMAC verify, `webhook_events` dedupe → idempotent ledger post).
- Mock `payout_process` withdrawals (debit `courier_earnings` → clearing →
  paid/fail-reverse); hold/release hooks for admin.
- Staff fallback (`staff_searching`, on-shift staff offers, staff earnings),
  no-courier customer choices, ratings (courier + restaurant separate), WHO
  active-minutes + customer impact aggregates.
- Done when: top-up → order → withdraw mock; staff delivery; double-delivered
  webhook pays once (test).

### B6 — AI + simulator + demo controls

- `internal/ai`: client (openai-go → configurable OpenAI-compatible base URL),
  versioned prompts, JSON schemas, tool calling; jobs `ai_menu_import`,
  `ai_translate`, `ai_trust_brief`, `ai_proof_check`, `ai_feedback_labels`;
  every call → `ai_calls` row; cached fallbacks for demo inputs.
- Provider (2026-10-28, implemented): chat/text/tool-calling features route
  to the Modal-hosted endpoint. Auth is the Modal proxy-token PAIR
  (`TF_MODAL_KEY`/`TF_MODAL_SECRET` → `Modal-Key`/`Modal-Secret` headers,
  not Bearer); `ai.Config.UsesModal()` gates it, `config.yaml ai:` block
  sets base + `spark_model` (env `TF_META_BASE_URL`/`TF_META_SPARK_MODEL`
  win). Realtime PCM transcription and SAM vision are NOT served by that
  endpoint: with no Meta-direct `TF_META_API_KEY`, voice falls back to the
  typed transcript and SAM stays a stub (humans decide). Keys never leave
  the server. Unconfirmed: exact served model id (default `muse-spark-open`;
  verify via `GET /v1/models` with the pair).
- Voice relay (PCM → Transcribe → Spark tools → TTS) with server-checked
  confirmations; SAM 3.1 crops (menu/ID/proof); translated chat + moderation;
  AI Coach report input data.
- `cmd/simulator`: GPX-track bots with speed noise, accept probability,
  ×1/×3/×10 scaling; bot merchants; admin demo controls (start/stop, force
  no-courier, reset); judge demo logins seed.
- Done when: voice accept (EN + ID) works; photo→menu import works; simulator
  runs an unattended loop.

## Guardrails

- DI + thin handlers + same-tx writes + River jobs (see architecture doc).
- Never: floats for money, CORS enabled, card data touching our code, AI
  publishing prices or banning couriers alone, private API caching anywhere.
- Run `go test` for touched domains + `make test-db` before reporting done.

## Skills & subagents

- Skills (in `.agents/skills/`): `go-verify` after any change; `db-migrate`
  for schema/query work; `river-job` for async work; `api-sync` when the
  contract changes (parent-supervised — one contract edit can touch all tracks).
- Spawning parallel backend children: see `docs/subagents.md` (one milestone
  unit per child; isolate when two children write at once).
