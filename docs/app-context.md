# App Context — Trackfud (source of truth for AI assistants)

> Read this file before any Trackfud task. It defines the product domain so
> assistants do not hallucinate features, roles, fees, or flows.
> Full build plan: `AGENTS.md`. Stack/tech choices: `docs/frontend-tech-stack.md`,
> `docs/frontend-architecture.md`, `docs/backend-architecture.md`.

## 1. What Trackfud is

A **health-first food delivery** app. People get paid to run or ride (pedal
bikes only), and customers order to support them. Couriers carry food **on or
near the route they are already running or riding** — each delivery is part of
a workout.

It is **not** a fast courier service. Promise a relaxed window
(**30–60 min** from merchant accept) and say so before the customer pays.
A runner is slower than a motorbike on purpose.

Tagline: "You powered 2.4 km of Rina's run."

## 2. Actors (5 roles, 4 apps + 1 API)

| Actor            | App / surface                                                 | What they do                                                                                               |
| ---------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Customer         | Customer PWA (`/customer/`)                                   | Orders food, pays (wallet or Paddle sandbox card), watches live map, sends cheers, rates, sees impact card |
| Courier (runner) | Courier PWA (`/courier/`)                                     | Runs on foot, takes S/M orders near track                                                                  |
| Courier (biker)  | Courier PWA (`/courier/`)                                     | Rides a **pedal bike only** (no e-bike/motor), takes S/M/L orders                                           |
| Merchant staff   | Courier PWA in **staff mode**                                 | Fallback delivery when no runner/biker accepts; invited by merchant, no fitness test                       |
| Merchant         | Merchant PWA (`/merchant/`)                                   | Sets location pin, builds menu (Snap-a-Menu), accepts orders, confirms pickup, manages staff               |
| Admin            | Admin CMS (`/admin/`, out of scope of the 4 milestone tracks) | Approves merchants/couriers, freezes/bans, refunds, settings, demo controls                                |

One Go backend serves all apps: REST + WebSocket on `/api/v1`, one hostname,
no CORS.

## 3. Core domain rules (never invent alternatives)

- **Workout first:** dispatch offers only orders fitting the courier's remaining
  workout goal. Declining an offer has **no penalty**. No countdown timers while moving.
- **Track corridor:** restaurant must be within 400 m of runner track / 800 m
  biker track. Max courier→restaurant 1.5 km / 3 km. Max restaurant→customer
  3 km / 7 km. Planning speed 9 km/h runner, 16 km/h biker.
- **Travels-well gate:** only items marked `travels_well` can be delivered;
  others show as "pickup only". Max carry 25 min runner / 30 min biker.
  Insulated bag required.
- **1 active order per courier** (MVP). Offer window 30 s. Merchant accept 3 min.
  Courier search 4 min → staff search 3 min → customer chooses
  (wait 5 min / pickup / full refund).
- **Fitness test (config):** runner 2 km in 15 min moving time; biker 5 km in
  20 min moving time. Total time must be < 2× limit. 1 checkpoint photo.
- **Health core:** active minutes vs WHO 150 min/week, streaks, personal bests,
  daily active cap 3 h, rest-day nudges. No medical advice.
- **Delivery proof:** customer 4-digit PIN (P0); photo optional. Pickup via
  4-digit code (P0; QR is P1).
- **Money (minor units, no floats):** restaurant 10% commission (5% if own staff
  delivers); customer 3% service fee (min/max capped); courier keeps 95% of
  delivery fee + 100% of tips. Wallet refunds instant; card refunds P1.
  Paddle **sandbox only** for demo (its rules ban physical goods/marketplaces/
  wallet balances in production). Mock payouts in demo.
- **Global:** ISO-4217 minor units, one wallet per currency, meters/seconds in
  storage, km/mi display, UTC `timestamptz`, restaurant IANA timezone, E.164
  phones, per-country settings, GDPR-style privacy (raw GPS deleted after
  30 days, IDs private with 5-min links).

## 4. Order lifecycle (two linked state machines)

- **Order:** `awaiting_payment → placed → accepted → ready → picked_up →
delivered → completed (72 h)`. Rejected/expired → full refund. Cancel rules
  per `AGENTS.md` §5.
- **Delivery** (created at order accept): `searching → offered → assigned →
at_pickup → picked_up → at_dropoff → delivered`; empty search →
  `staff_searching` → `no_courier` → customer choice.
- Every transition goes through one guarded `Transition()`:
  `UPDATE ... WHERE status=from`, append `order_events`, post ledger, queue
  River jobs in the same transaction, then broadcast on the WS hub.

## 5. AI features (Meta Model API, inside the main flow)

1. **Voice Copilot** — hands-free accept/status while running (Muse Voice
   Transcribe + Muse Spark tool calling, keyword biasing, 25 languages).
2. **Snap-a-Menu** — photo → multilingual menu JSON + `size_class`/
   `travels_well` labels that feed dispatch + SAM 3.1 dish crops.
3. **Trust Brief** — test-run cheat check + ID/bike-photo check; admin decides.
4. **Translated + moderated chat**, **weekly AI Coach report** (not medical
   advice). Stretch: AI Run Planner.

## 6. Non-goals / common hallucinations to avoid

- No motorbikes, e-bikes, cars; no "fastest route wins" logic.
- No card-data handling in frontends (Paddle overlay only).
- No multi-order batching, no courier bidding, no surge pricing.
- No invented fees, roles, statuses, or extra apps beyond the 4 + API.
- Demo data uses **fictional restaurants only**; demo cities Jakarta (IDR, km)
    - London (GBP, miles).
