---
name: cross-track-sync
description: Equalize any feature, fix, or new build across backend + all four frontends and reconcile docs/milestone-checklist.md.
---

# Cross-Track Sync

Use when touching any feature, flow, or bug that spans more than one track:
`backend/`, `frontend-customer/`, `frontend-runner-biker/`, `frontend-merchant/`,
`frontend-cms-admin/`. This is the enforcement arm of root `AGENTS.md`
("update all parts so they stay in sync") and keeps the goal —
finish everything in `docs/milestone-checklist.md` — honest.

Context to read first, every run (in this order):
`PLAN.md` (relevant § only) → `docs/milestone-checklist.md` →
`docs/app-context.md` → root `AGENTS.md` → `docs/subagents.md`.

## 1. Scope the change (before editing)

1. Name the flow in PLAN.md terms (§3 user flows, §5 state machines,
   §6 dispatch, §11 money, §4 per-app table). Quote the § number.
2. List every affected track in a 5-row table
   (backend / customer / courier / merchant / cms-admin), even rows
   whose answer is "no change — reason". Never silently skip a track.
3. If PLAN.md is ambiguous, stop and ask per root `AGENTS.md`;
   document the assumption in the final report.

## 2. Contract first

- `backend/api/openapi.yaml` is the source of truth. Edit it before code
  when shapes, statuses, or routes change (money `{amount_minor, currency}`,
  meters/seconds, ISO-8601 UTC, cursor pagination, RFC 9457 errors,
  `Idempotency-Key` on orders/top-ups/withdrawals).
- Then run the `api-sync` skill pattern: fix backend `httpapi` handlers
  and each touched frontend `lib/api.ts` / `features/*/api.ts` call site.
- Hand-written wrappers are the current reality (see checklist
  "B0 generated TS client: PARTIAL") — keep them typed and mirror the
  contract exactly; never hardcode data the API should serve.

## 3. Backend track

- State machines go through the single guarded `Transition()` with
  `WHERE status=$from` + `order_events` row + ledger posting + River job
  in the same transaction; broadcast on the WS hub after commit.
- Money: integer minor units, balanced entries, `idempotency_key UNIQUE`,
  no update/delete of postings (reversals only).
- RBAC on every route; validate + authorize per `AGENTS.md`
  (no sensitive data in responses, SQLi/XSS/CSRF-safe).
- Touching schema/queries → follow `db-migrate` conventions (goose files);
  async work → `river-job` pattern.

## 4. Frontend tracks (each touched app)

For `frontend-customer/`, `frontend-runner-biker/`, `frontend-merchant/`:

- Data from the API only; mock data stays inside unit tests and must look
  realistic per `AGENTS.md`.
- Mobile-friendly + responsive (phone → desktop); modular components,
  clean imports, per-app `X-TF-App` header and `tf_*_refresh` cookie stay
  intact; per-app storage prefixes untouched.
- Copy changes → `i18n-string` skill: `en.json` first, then identical keys
  + `{placeholders}` in `id.json` / `ms.json`; money/distance/time via
  formatters, never raw interpolation.
- PWA behavior changes → `pwa-verify` skill for that app's path
  (`/customer/`, `/courier/`, `/merchant/`).

For `frontend-cms-admin/` (`/back-office/`, English-only, desktop-first):

- Login-gated via `RequireAdmin`; never render API objects as React
  children (see checklist "merchant-detail crash" entry — use
  `formatValue`/`formatHours`-style guards).
- Approve/reject/freeze/ban flows show only while decidable; decided
  records show the standing/sanction panel + history from the server.

## 5. Equalization check (the core of this skill)

Before verifying, prove the five tracks agree:

- [ ] Same status/event names backend ↔ each UI (no renamed or missing states).
- [ ] Same money math (fees, rounding, wallet refresh/invalidate after pay/cancel).
- [ ] Same auth/session behavior (logout calls `POST /v1/auth/logout`;
      refresh allowlist = login/refresh/logout/signup/demo-login only).
- [ ] Courier-vs-runner/biker/staff wording matches PLAN §2/§4 (inclusive
      "courier" unless the mode is known).
- [ ] No track renders a shape the contract does not serve
      (run the `api-sync` drift check when in doubt).

## 6. Verify (per touched track, report exact commands)

- Backend → `go-verify` skill (`go build ./...`, `go vet ./...`,
  touched-package `go test`, `gofmt` clean; PostGIS `make test-db`
  when migrations/queries changed — else state it was skipped and why).
- Each frontend → `tsc -b --noEmit`, its route smoke
  (`route-smoke.mjs`, plus `guard-smoke.mjs` / `smoke.mjs` where present),
  `vite build`. Mark anything not exercised on a real device or against
  a live seeded backend as UNVERIFIED — never as passing.

## 7. Reconcile `docs/milestone-checklist.md` (required, same run)

- Flip only the milestone row(s) this change affects:
  DONE / PARTIAL (with documented simplification) / OPEN per the legend.
- Each touched row gets fresh Evidence/notes: files + routes + test
  output (e.g. "tsc 0, smoke 38/38", "go test ./internal/app/ green").
- Never mark device-dependent work DONE without a real-phone pass —
  use "DONE (code; device UNVERIFIED)" like prior entries.
- Append a dated subsection for the change (like "Cross-app
  equalization: … (YYYY-MM-DD)"): bug → fix → evidence table + Verify
  line + Deviations/Assumptions. Keep rows compact; link related
  memories with `[[name]]` style only where a memory exists — no
  invented keys, emails, or accounts (canonical test accounts live in
  the `seed-test-data` skill).

## 8. Report

Scope table (§ step 1) · contract diff · per-track files changed ·
equalization checklist result · exact verify commands with pass/fail
(and what stayed UNVERIFIED) · checklist rows flipped · assumptions
made. One milestone unit per run; fan out across builders via
`docs/subagents.md` recipes (one child per track, parent keeps the
contract edit) when the change is large enough to parallelize.
