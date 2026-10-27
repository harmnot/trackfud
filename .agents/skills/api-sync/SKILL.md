---
name: api-sync
description: Regenerate Trackfud API clients from the OpenAPI contract and prove backend and frontends agree.
---

# API Sync

Use when `backend/api/openapi.yaml` changed, or when a frontend hits a shape
the backend does not serve (contract drift). The `.yaml` is the source of
truth — never hand-edit generated output. Context:
`docs/backend-architecture.md` (contract-first), `docs/frontend-architecture.md` §2.

1. Edit only `backend/api/openapi.yaml`: money as `{amount_minor, currency}`,
   distances meters, durations seconds, times ISO-8601 UTC, cursor pagination,
   RFC 9457 `application/problem+json` errors, `Idempotency-Key` on
   orders/top-ups/withdrawals.
2. Regenerate both sides: Go server interfaces (`oapi-codegen`) and TS types +
   fetch client (`openapi-typescript` + `openapi-fetch` in
   `packages/api-client` or each app's `features/*/api.ts`).
3. Fix compile breaks on both sides (backend `httpapi` handlers, frontend
   `api.ts` call sites). One contract change may touch all four tracks —
   say so in the report.
4. Verify: `go-verify` skill for the backend; TypeScript check + affected
   route smoke test per touched frontend.
5. Report the contract diff, regenerated files, and per-side results.
