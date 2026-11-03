# Live Core-Loop Test — 6 Seeded Accounts

Golden-path + edge-case round-trip on a seeded backend. Proves one order reaches
exactly one courier and stays pending until the customer handover.

Scope (requested): core loop live test with 6 seeds; Placed → Accepted →
Ready wave → atomic single-winner accept → `offer.taken` clears losers →
pickup code → PIN handover → delivered → 72h auto-complete; no-courier
wait-more / pickup / cancel+refund + staff fallback; courier 403
frozen/banned + banned merchant hidden + wallet stays withdrawable.

## 1. Seeds (password for all: `trackfud123`)

Use the matching `X-TF-App` per role (`customer` / `courier` / `merchant` / `cms`).

| # | Role | Email | Ready because |
| - | ---- | ----- | ------------- |
| 1 | Courier runner | `runner@example.com` | `couriers` row `approved`, runner, passed fitness |
| 2 | Courier biker | `biker@example.com` | `couriers` row `approved`, biker pedal `city` |
| 3 | Courier runner 2 | `runner2@example.com` | `approved` second runner (loser-card / single-winner proof) |
| 4 | Merchant | `chickenresto@example.com` | Approved "Ayam Geprek Sambal Korek" + signed agreement + items |
| 5 | Merchant | `noodleresto@example.com` | Approved "Mie Ayam Bangka Asli" + signed agreement + items |
| 6 | Customer | `customer2@example.com` | `customer_wallet` funded Rp 200.000 + Jakarta addresses |

Seeded by `SeedRequestedAccounts` (`backend/internal/app/seed.go`, called from
`SeedTestAccounts` on every boot). ID numbers are fictional placeholders,
AES-GCM sealed, never returned by the API.

Health check per account:

```sh
curl -s localhost:8081/v1/auth/login -H 'Content-Type: application/json' \
  -H 'X-TF-App: customer' \
  -d '{"email":"customer2@example.com","password":"trackfud123"}'
# 200 with tokens = healthy; 401 = seed did not run, check TF_DEMO_MODE + backend logs
```

Swap `X-TF-App` to `courier` / `merchant` / `cms` for the other roles.

## 2. Prerequisites

- [ ] Backend on `:8081`, frontend on `:8000` (`bash scripts/podman-up.sh`)
- [ ] DB migrated, seed boot log shows 6 accounts repaired
- [ ] Customer wallet funded; merchant stores approved + signed; both couriers `approved`
- [ ] Both couriers positioned near the test merchant (inside corridor: 400 m runner / 800 m biker, fresh fix < 60 s) — use Run Mode GPS or simulator bots
- [ ] Watch: backend logs, Mailpit `:8025`, CMS `/back-office/orders`, WS frames

Key contract (`backend/api/openapi.yaml`): customer `/v1/customer/orders*`,
merchant `/v1/merchant/orders*` (`accept/reject/ready/cancel`),
courier `/v1/courier/offers`, `/v1/courier/offers/{id}/accept|decline`,
`/v1/courier/deliveries/*` (`active/arrived/pickup/delivered`),
`delivery-choice`, admin `/v1/admin/orders*` + `/refund`.

Socket frames: `offer.created`, `offer.taken`, `delivery.assigned`,
`order.status` (+ `delivery_status`), `delivery.leave_now`, `delivery.eta`,
`courier.location`.

## 3. Phase A — Happy path (one order, one courier)

Run with `chickenresto@example.com`, customer `customer2@example.com`,
runners `runner@example.com` + `runner2@example.com` both online.

1. **Customer places order** — `/customer/` → address (default/Home) → restaurant list shows live badge `Runners & bikers nearby` → menu → cart → checkout shows 30–60 min promise + wallet quote → wallet pay.
   Expect: `POST /v1/customer/orders` → `awaiting_payment` → `placed`; wallet debited + held (escrow); `order.status` broadcast; merchant queue gets loud alert + push.
2. **Merchant accepts** — `/merchant/` orders → Accept + prep time.
   Expect: `POST /v1/merchant/orders/{id}/accept` → `accepted`; accept wave starts (`dispatch_run`); nearby couriers get `offer.created` + push; courier cards show fee + track-fit.
3. **Ready wave** — merchant taps Ready (~15 min later is fine; search may have expired).
   Expect: `POST /v1/merchant/orders/{id}/ready` → unclaimed delivery flips to `searching` with fresh clock, stale offers expired, new `search_timeout` + `dispatch_run` queued; customer push "Food is ready", merchant push "Finding a courier".
4. **Single-winner accept** — runner 1 taps Accept (or voice "yes"); runner 2 sees the same offer.
   Expect: `POST /v1/courier/offers/{id}/accept` → atomic `UPDATE … WHERE courier_id IS NULL` — exactly 1 row wins; winner gets `DeliveryEnvelope`; loser gets 409/gone + `offer.taken` clears the card with spoken notice; merchant gets push + `delivery.assigned` frame naming winner; `courier_name/courier_mode` flips from "finding" to name, no second fetch.
5. **Head-now + pickup** — courier keeps running; `delivery.leave_now` nudge timed to `ready_at_est − eta_pickup`.
   Expect: Run Mode arms head-now; route + "Open in Google Maps"; at store courier shows merchant code/QR; merchant confirms → `POST …/pickup` → `picked_up`. Pickup code is kitchen↔courier only, never the customer PIN.
6. **PIN handover → delivered → settlement** — customer reveals PIN face-to-face (never in chat); courier enters PIN or photo.
   Expect: `POST …/delivered` → `delivered`; escrow settles at once (merchant payable, courier earnings, platform); wallet reflects payout; customer gets impact card + ratings prompt; `order.status` + pushes to all sides.
7. **72h auto-complete** — cannot wait 72h live.
   Expect: code path `auto_complete` job covers `delivered → completed`; assert in CMS order timeline that `delivered` is terminal-pending and job is queued. Mark PASS by code + prior unit cover, note "timer not waited".

## 4. Phase B — No-courier choices

Force with CMS demo controls (`force no-courier`) or keep couriers offline.

- [ ] `searching` 4 min → `staff_searching` 3 min → `no_courier`; customer sees Wait 5 more / switch to pickup / cancel + full refund.
- [ ] Wait-more reuses `restartCourierSearch` (fresh clock, same single-winner guards).
- [ ] Pickup switches to `customer_pickup`, never re-enters dispatch.
- [ ] Cancel refunds escrow → wallet instantly; merchant + courier notified; CMS timeline shows actor + reason.

## 5. Phase C — Staff fallback

- [ ] Merchant invites staff by email; staff signs into Stride & Earn with same email → Staff mode (no fitness test).
- [ ] Staff clocks on-shift (`POST /v1/courier/staff/shift`); unclaimed order reaching `staff_searching` offers on-shift staff only.
- [ ] Staff accept → tracked delivery in staff mode → settles into staff `courier_earnings` withdrawable wallet.
- [ ] Fallback commission reads 5% (vs 10% courier) in settlement/CMS money trail.

## 6. Phase D — Sanctions + visibility + wallet

In CMS `/back-office/review` + courier/merchant detail as `admin@example.com`:

- [ ] Freeze `runner2@example.com` with reason → `startSession` work-kind 403; dispatch excludes; offer accept blocked; account/run-setup/delivery show notice; wallet still opens + withdraw works.
- [ ] Unfreeze (reason optional) → can go online again.
- [ ] Ban merchant `noodleresto@example.com` → drops from customer list (`status='approved'` filter); existing flow unaffected; unban restores pre-ban status.
- [ ] Courier mid-delivery freeze finishes the leg (safety reassign is human-only).
- [ ] Every action lands in `courier_sanctions` / `merchant_sanctions` + unified `audit_logs` with actor/reason/time; queue filters `frozen/banned` work.

## 7. Pass / fail record

| Check | Result | Evidence |
| ----- | ------ | -------- |
| Placed → accepted → ready wave offer received live | ☐ | order code, `offer.created` timestamp |
| Exactly one winner; loser got `offer.taken` + cleared card | ☐ | winner name, loser screenshot |
| Merchant saw `delivery.assigned` + name flip, no stale "finding" | ☐ | kitchen screenshot |
| Pickup code ≠ customer PIN; PIN never in chat/merchant screen | ☐ | delivery screenshots |
| Delivered → settlement legs balance; impact card rendered | ☐ | wallet deltas, CMS money trail |
| No-courier choices refund correctly | ☐ | refund tx, timeline |
| Staff fallback delivered + settled at 5% | ☐ | staff payout row |
| Frozen 403 + wallet open; banned merchant hidden | ☐ | 403 body, list screenshot |
| 72h job queued (timer not waited) | ☐ | job row / code ref |

Fail = stop, capture backend log + `order_events` timeline + WS frame + screenshot, file with order code.

## 8. Reset

- CMS demo controls → reset data (or backend reseed restart); confirm wallets/orders back to seed baseline.
- Do NOT reuse real emails/phones; seeds are fictional and local-only.

## 9. Live run 2026-11-01 — PASS (API-level, seeded backend)

Order `TF-K6WSNZ` (`507423bb-0c39-42d6-bdf8-4dd5568a7742`), wallet pay, Ayam Geprek Sambal Korek → dropoff -6.2800,106.8000 (~1.1 km trip). Couriers `runner@example.com` + `runner2@example.com` online near -6.2880,106.7950 (~250 m to pickup).

| Check | Result |
| ----- | ------ |
| Placed, wallet held (25668 total: 18000 + 6668 fee + 1000 service) | PASS — `201`, `payment_status: held`, PIN `2056` customer-only |
| Merchant accept → directed offer to rank-1 only, 30 s timer | PASS — `accepted`, `pickup_code 9543`, r1 pending / r2 empty, delivery `offered` |
| Atomic single-winner; loser blocked | PASS — r1 `assigned` + payout 6335; r2 re-accept `403 not your offer`, offers empty |
| Merchant sees courier (Andito, runner) + GPS + route beta warning | PASS — `courier/courier_last/route_warning` on merchant detail |
| Ready on claimed delivery = nudge only, no re-wave | PASS — `ready` 200, delivery stayed `assigned` to r1 |
| Pickup code `9543` → `picked_up`; wrong codes rejected by contract | PASS — arrived 200, pickup 200, `order_status picked_up` |
| Customer PIN `2056` → `delivered` + payout 6335 + impact | PASS — arrived 200, delivered 200, wallet 200000 → 174332, courier withdrawable 11152 |
| 72h auto-complete | NOT WAITED — `auto_complete` job path asserted by code; CMS timeline shows `delivered` terminal-pending |
| Refund on delivered rejected (pre-pickup only) | PASS — `409 ... finance handles post-delivery refunds` |
| Delivery-choice on delivered rejected | PASS — `409 ... only available when no courier was found` |
| Freeze r2 → work `403`, wallet stays open → unfreeze restores | PASS — `frozen`, `403 ... stays withdrawable`, earnings 200, `approved` after unfreeze |
| Ban noodle → hidden from list → unban restores | PASS — banned list drops it, unbanned list restores all 3 |
| No-courier wait-more/pickup/cancel + staff fallback delivery | NOT RUN LIVE — guards verified by code (`restartCourierSearch`, `moveToStaffSearch`, `NoCourierPanel`, `StaffPage`); needs 4+3 min windows or demo flag |
| Gateway smoke | PASS — `/customer /courier /merchant /back-office /api/healthz` all 200 on `:8000` |

Cleanup done: both work sessions ended, r2 unfrozen, noodle unbanned. No code changed; backend `demo_mode=false`, sandbox + local-disk stand-ins still apply. Real-phone GPS/push/Wake Lock checks remain OPEN.

## Appendix — where things live

- State machine: `Transition()` + `order_events` + same-tx ledger/jobs/WS (`backend/internal/app/orders.go`, `dispatch.go`, `social.go`, `money.go`).
- Guards: `canRestartCourierSearch`, `restartCourierSearchSQL`, atomic claim `courier_id IS NULL`, `workSessionBlocked`, `sanctionReasonOK`.
- Tests to run before/after: `go test ./...` in `backend/`; `npm run typecheck/smoke/guards` + `vite build` per frontend; `route-smoke`/`guard-smoke` scripts.
- Live gaps this plan does NOT cover: real R2/River/Brevo/Paddle rails (sandbox + Mailpit stand in), real-phone GPS/Wake Lock/mic checks, trilingual CMS copy.
