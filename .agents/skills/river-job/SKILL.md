---
name: river-job
description: Add a new River background job to the Trackfud backend — args, worker, enqueue, schedule, idempotency, test.
---

# River Job

Use when backend work needs async/scheduled work (timeouts, nudges, push,
email, AI calls, payouts, retention). Never use goroutine timers for business
timeouts. Context: `docs/backend-architecture.md` §4, `backend/AGENTS.md` B-milestones.

1. Follow the existing job pattern in `backend/internal/`: one args struct per
   job kind, one worker, registration where workers are wired in `cmd/api/`.
   Business timeouts from config (`offer_window_s`, `search_timeout_s`,
   `merchant_accept_window_s`, …), not hardcoded.
2. Enqueue with `InsertTx` inside the same domain transaction as the state
   change + `order_events` row + ledger postings, so nothing is lost on crash.
3. Make the worker idempotent: re-running it must be safe (guard on current
   status, dedupe on idempotency/event keys, verify webhook signatures first
   for webhook-triggered jobs).
4. Add a unit test proving retry-safety (run worker twice → single effect)
   plus the timeout/firing behavior.
5. Verify with the `go-verify` skill loop and report job kind, enqueue sites,
   schedule, and test results.
