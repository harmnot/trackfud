# Plan: Trackfud — Food Delivery by Runners and Bikers (Meta Global AI Developer Hackathon)

**Date:** 2026-10-27 · **Status:** build plan, day 1 of 9
**Working name:** Trackfud ("track" = the route you run or ride, and the GPS track; "bite" = food). Change it freely.
**Stack you chose:** React PWAs (Customer, Courier, Merchant) + React CMS (Admin) · Go backend · PostgreSQL · Podman · Cloudflare R2 · Google Maps · Brevo SMTP · Web Push (VAPID) · Paddle
**Hackathon:** Meta Global AI Developer Hackathon (Meta + Cerebral Valley), online, Oct 26 – Nov 4, 2026 [1][2] · **Track: Indie**
**Hard deadline:** **Wed Nov 4, 9:00 PM ET = Thu Nov 5, 02:00 UTC = Thu Nov 5, 09:00 WIB.** Plan to submit by **Thu Nov 5, 07:00 WIB**.
**Your answers (2026-10-27):** Indie track · VPS now, domain later (§19.3) · pedal bikes only · short, standard fitness test (§8.2) · **health first: slower than vehicle couriers on purpose** (§2.1)

> Facts were checked on 2026-10-27. Numbers marked **(estimate)** are mine, not from a source. The official rules were not public in my search, so I used the judging table you pasted. Check the official rules for video length and repo rules.

---

## Contents

0. [One-page summary](#0-one-page-summary)
1. [The hackathon and how we score](#1-the-hackathon-and-how-we-score)
2. [How it works: track-based delivery](#2-how-it-works-track-based-delivery)
3. [User flows](#3-user-flows)
4. [Features per app](#4-features-per-app)
5. [Order lifecycle](#5-order-lifecycle)
6. [Dispatch engine](#6-dispatch-engine)
7. [GPS tracking, run stats and anti-cheat](#7-gps-tracking-run-stats-and-anti-cheat)
8. [Courier sign-up and fitness test](#8-courier-sign-up-and-fitness-test)
9. [Live maps](#9-live-maps)
10. [Meta AI features](#10-meta-ai-features)
11. [Payments, wallet and payouts](#11-payments-wallet-and-payouts)
12. [Pricing and unit economics](#12-pricing-and-unit-economics)
13. [Going global](#13-going-global)
14. [Architecture and repo layout](#14-architecture-and-repo-layout)
15. [Backend (Go)](#15-backend-go)
16. [Frontend (React PWAs and CMS)](#16-frontend-react-pwas-and-cms)
17. [Notifications](#17-notifications)
18. [File storage (R2)](#18-file-storage-r2)
19. [Podman: dev and deploy](#19-podman-dev-and-deploy)
20. [Demo plan](#20-demo-plan)
21. [9-day schedule](#21-9-day-schedule)
22. [Testing](#22-testing)
23. [Risks and mitigations](#23-risks-and-mitigations)
24. [Decisions for you](#24-decisions-for-you)
25. [Sources](#25-sources)

---

## 0. One-page summary

**The idea in one line:** a **health-first** delivery app. People get paid to run or ride, and customers order to support them. Couriers carry food from restaurants **on or near the route they are already running or riding**, so each delivery is part of their workout.

**What it is and isn't**

- It is **not** a fast courier service. A runner is slower than a motorbike, so we promise a relaxed window (default **30–60 min**) and say so before the customer pays.
- Customers choose it **to help someone get healthier and earn money**. They get a small impact report back: "You powered 2.4 km of Rina's run."
- The courier's workout comes first. The order fits the run, not the other way around.

**Problem**

- Delivery apps are expensive for restaurants: **15–30%** commission on DoorDash and Uber Eats [28][29][30], and about **15–20%+** on GoFood and ShopeeFood in Indonesia [31][32].
- **31% of adults worldwide (about 1.8 billion people) don't get enough physical activity** (WHO, 2022 data) [37]. WHO advises 150–300 minutes of moderate activity a week [38].
- People who do run or ride every day earn nothing from it. Trackfud gives them a reason to go out, and pays them for it.
- Short city trips by car or motorbike add traffic and pollution.

**Product: 4 apps + 1 backend**

- **Customer PWA:**
    - Order food and pay with the wallet or by card (Paddle).
    - Watch the courier live on the map, with their profile and km/mile history.
    - Send a "cheer" that the courier hears in their earphones.
    - Rate the courier, and see your **impact**: km and active minutes you powered.
- **Courier PWA (runner / pedal-bike biker):**
    - Pass a short fitness test (runner 2 km in 15 min, biker 5 km in 20 min), then wait for admin approval.
    - Start a run. Orders only come from restaurants near your track.
    - Keep running while the kitchen cooks, then pick up and deliver.
    - Withdraw money anytime.
    - See your distance, time, pace and **active minutes toward the WHO goal of 150 min/week**, with streaks and a weekly AI coach report.
- **Merchant PWA:**
    - Set the exact restaurant location (lat/lng pin).
    - Make the menu from a photo with AI.
    - Accept orders, mark them ready, invite staff.
- **Staff fallback:** if no runner or biker accepts, the restaurant's own staff can deliver and earn the fee. Merchants agree to this in the contract **before** they join.
- **Admin CMS:**
    - Approve or reject couriers, and see their performance.
    - Freeze or ban couriers.
    - Manage merchants, fees and the test rules.
- **Go backend:** standalone REST + WebSocket API on PostgreSQL/PostGIS.

**Meta AI (25% of the score):** AI is inside the main flow, not a chatbot on the side.

1. **Voice Copilot** (Muse Voice Transcribe realtime + Muse Spark tool calling). Couriers say "accept", "how far?" or "tell the customer I'm 2 minutes away". It works hands-free while running, in 25 languages.
2. **Snap-a-Menu** (Muse Spark vision + structured output + SAM 3.1):
    - A photo becomes a full menu in many languages, with clean dish pictures.
    - Each item gets **workout-delivery** labels (size, **travels well for 30–60 min**), and the dispatch engine and menu use them.
3. **Trust Brief** (Muse Spark + SAM 3.1). AI checks the courier's test run for cheating, reads the ID and checks delivery photos. The **admin decides**.
4. **Translated chat + moderation** between courier and customer.
5. **AI Coach report** (Muse Spark): a weekly summary of distance, active minutes and earnings, with a gentle plan for next week. Not medical advice.
6. Stretch: **AI Run Planner**, e.g. "plan a 5K easy loop past busy restaurants at lunch".

**Price (cheaper, still profitable):**

- Restaurant pays **10%** commission, or **5%** if its own staff delivers.
- Customer pays a **3%** service fee (capped).
- Courier keeps **95%** of the delivery fee and **100%** of tips.
- A $20 order still makes about **$1.70 net** after card fees **(estimate, §12)**.

**Build:** 9 days, solo with AI coding agents.

- The core order loop comes first, then AI, then polish and the video.
- A **demo simulator** runs fake runners on real tracks, so judges can test anytime between Nov 4 and 8.

**Top 4 risks**

1. **Paddle cannot be used for real.**
    - Its rules ban physical goods, marketplaces and wallet balances [17].
    - We use the Paddle **sandbox** for the demo, as you asked, behind a payment interface. Switch provider for production (§11).
2. **A PWA can't track GPS with the screen off,** especially on iPhone [21][23].
    - Keep the screen on during runs (Wake Lock) and detect gaps.
    - Wrap the app as native later (§7).
3. **The scope is big for 9 days.** Use a strict P0 list, a cut list, and a feature freeze on Nov 4 at 12:00 WIB (§21).
4. **Slow delivery vs. food quality and customer patience.**
    - Only items that travel well can be delivered, insulated bags are required, and carry time is capped.
    - Customers see the clear 30–60 min promise before they pay (§2.1).

---

## 1. The hackathon and how we score

| Item         | Detail                                                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event        | Meta Global AI Developer Hackathon, run by Meta and Cerebral Valley. Online. [1][2]                                                                                                                                                     |
| Dates        | Started Oct 26. Workshops + Discord office hours Oct 27 – Nov 4. [1]                                                                                                                                                                    |
| Deadline     | Nov 4, 9:00 PM ET → **Nov 5, 09:00 WIB** [1][3]                                                                                                                                                                                         |
| Judging      | Nov 4–8 → **your demo must stay online all these days** [1]                                                                                                                                                                             |
| Finals       | Nov 9: closing ceremony, live finals, winners [1]                                                                                                                                                                                       |
| Track        | **You are in Indie** ("for individual builders and students", solo or up to 4 people [3]). Indie is judged on "creativity, technical ambition, and whether it works" [1], so a working golden path matters more than production polish. |
| Themes       | "Build for Your World" and "Push the Frontier" [1]                                                                                                                                                                                      |
| Meta tools   | Muse Spark series, Muse Image and SAM 3.1 through the Meta Model API. Also Meta open-weight models (Muse Glimmer, Muse Spark Open) and Muse Code [1][4]                                                                                 |
| Credits      | $150 of Meta Model API credit per selected participant. Some participants also get partner credits (Baseten, Modal, Fireworks) [3]                                                                                                      |
| Indie prizes | $150k / $100k / $75k / $50k / $25k (third-party guide) [3]                                                                                                                                                                              |

**Theme fit: "Build for Your World".** The theme text says: "Solve a problem you know firsthand, free up time and mental space, and make something possible that wasn't before" [2]. Our line: _"We give people a reason and a reward to move. They earn money on their own workout, and customers order to support them. Small restaurants get cheaper delivery too."_

**Rubric → what we show**

| Criterion (weight)        | Judges ask                                             | What we show                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Where                  |
| ------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Impact (30%)**          | Who benefits? Will people use it? Does it fit a theme? | **Health first:** 31% of adults don't move enough [37]. Every order gives someone paid active minutes toward WHO's 150 min/week [38], and the dashboard counts them. Runners and bikers earn while training. Restaurants pay 10% instead of 15–30%. Staff earn extra. Customers pay less and see their impact. No tailpipe emissions. Global settings (currency, language, units, per-country rules).                                                                | §0, §12, §13           |
| **Use of Meta AI (25%)**  | Creative? Beyond basic? Surprising?                    | 4 AI features inside the core loop, using 4 Meta capabilities: (1) realtime speech with **keyword biasing from the live order** and **code-switching** (e.g. Indonesian + English mixed); (2) tool calling with **server-checked confirmations**; (3) vision + structured output that **becomes dispatch rules** (runner-safe size classes); (4) **SAM 3.1** for dish crops, ID crops and bag detection. An "AI under the hood" panel lists every model call. | §10                    |
| **Technical depth (20%)** | Is the engineering sound and refined?                  | Track-corridor dispatch in PostGIS. Two linked state machines. Double-entry ledger with idempotent webhooks. Jobs queued in the same database transaction (River). Offline GPS buffer and anti-cheat. Podman Quadlet deploy. End-to-end tests with several users at once.                                                                                                                                                                                            | §5–7, §11, §14–19, §22 |
| **Demo (25%)**            | Does it work live? Is the video cool to watch?         | Real footage of a runner. Split screen of the 4 apps. Accepting an order by voice while running. Judge mode + simulator, so it works from anywhere.                                                                                                                                                                                                                                                                                                                  | §20                    |

**Submission checklist** (confirm in the official rules):

- [ ] Public HTTPS demo URL + a 1-page judge guide + one-click demo logins
- [ ] Demo video (~3 minutes; check the limit)
- [ ] Code repo with README (public if required)
- [ ] Write-up: problem, solution, **which Meta models and how**, architecture, impact, next steps
- [ ] Architecture diagram + screenshots
- [x] Track: **Indie** (your choice)

> **Muse Code:** if you use Muse Code to build parts of the project, say so in the write-up. Judges will mostly score how the **product** uses Meta AI.

---

## 2. How it works: track-based delivery

### 2.1 Health first, not speed

| Principle                  | What it means in the product                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The workout comes first    | The courier sets a workout, e.g. "easy 5 km run". Dispatch picks orders that **fit the distance they still want to do** (§6.2).                                                                             |
| Slow is OK, and we say so  | We promise a **30–60 min window** from when the restaurant accepts, not "fast". The restaurant list says "Workout delivery · 30–60 min".                                                                    |
| No rush pressure           | No countdown timers while moving. No penalty for arriving later inside the window. **Declining an offer has no penalty.**                                                                                   |
| Food still arrives good    | Only items marked "travels well" (AI label + merchant check) can be delivered; the others show as "pickup only". Insulated bag required. Max carry time: 25 min (runner), 30 min (biker).                   |
| Customers are supporters   | Customers see who they help and how much that person moved: "You powered 2.4 km and 18 active minutes." They can send cheers and tips.                                                                      |
| Health is measured, safely | Active minutes toward WHO's 150 min/week [38], streaks, personal bests. A daily cap (default 3 h active), rest-day nudges and hydration reminders. Calories are shown only as estimates. No medical advice. |

### 2.2 Track-based matching

```text
          RUNNER'S TRACK (a loop in a park / along a road)
     ┌───────────────────────────────────────────┐
     │  ● runner now  →  →  →  →  →  →  →  →  ↓ │         🍜 Warung A: 250 m from the track
     │                                         ↓ │  ◄───── → inside the corridor → GETS THE OFFER
     │  ↑                                      ↓ │
     │  ↑  ←  ←  ←  ←  ←  ←  ←  ←  ←  ←  ←  ←   │
     └───────────────────────────────────────────┘
               ░░░░ corridor: 400 m (runner) / 800 m (biker) ░░░░
                                                             🍔 Burger B: 2 km away → NOT offered
```

**Rules**

1. The courier starts a **session**: run or ride, with an optional **workout goal** (e.g. "easy 5 km" or "ride 45 min").
2. They pick a track type:
    - **Free run:** no plan; we use their current position and direction.
    - **Saved track:** a loop they drew or recorded.
    - **AI-planned track:** stretch goal, §10.
3. An order is offered only when **the restaurant is close to the track**, and the customer is within the range for that mode.
4. The courier **keeps running while the food cooks**. The app tells them when to turn toward the restaurant, timed to "ready".
5. Runners carry small orders over short distances. Bikers can take bigger and longer ones.
6. If nobody accepts, **restaurant staff** can deliver it (§3).

**Default settings** (stored in config, editable per country in the CMS)

| Setting                                              | Runner | Biker       |
| ---------------------------------------------------- | ------ | ----------- |
| Restaurant must be within this distance of the track | 400 m  | 800 m       |
| Max distance from courier to restaurant              | 1.5 km | 3 km        |
| Max distance from restaurant to customer             | 3 km   | 7 km        |
| Allowed order size                                   | S, M   | S, M, L     |
| Planning speed while carrying food                   | 9 km/h | 16 km/h     |
| Time to accept an offer                              | 30 s   | 30 s        |
| Max carry time (pickup → customer)                   | 25 min | 30 min      |

Global defaults:

- Merchant has **3 min** to accept an order.
- Courier search runs **4 min** before staff fallback.
- Staff have **3 min** to accept.
- **1 active order per courier** (MVP).
- Delivery promise to the customer: **30–60 min** after the restaurant accepts (config).
- Daily active-time cap per courier: **3 h** (config), so nobody overtrains for money.

**Fitness test defaults** (your config; stored in meters and seconds). You asked for a short, standard test that doesn't scare new people away:

| Test                    | Distance       | Moving-time limit | Needed pace or speed       | Feels like                           |
| ----------------------- | -------------- | ----------------- | -------------------------- | ------------------------------------ |
| Runner                  | 2 km (1.24 mi) | 15 min            | 7:30 /km (about 12:04 /mi) | An easy jog; walking breaks are fine |
| Biker (pedal bike only) | 5 km (3.1 mi)  | 20 min            | 15 km/h (9.3 mph)          | Normal city riding                   |

- **Moving time** is used, so stops at traffic lights don't count. Total time must stay under 2× the limit.
- The test takes 15–25 minutes, on any outdoor route. No special track is needed.
- It only proves basic fitness. Real performance comes from deliveries (§8.6).

---

## 3. User flows

**Customer**

```text
Open app → set address (GPS or search) → list of restaurants
   ("Workout delivery · 30–60 min" · green "runners nearby" · grey "staff delivery only")
→ menu (in your language; "travels well" items) → cart → quote: food + delivery fee + service fee + "30–60 min"
→ pay: Wallet  or  Card (Paddle checkout)
→ status: Placed → Accepted (ready in ~12 min) → Runner assigned
→ LIVE MAP: courier dot + route + ETA + profile (★4.9 · 318 deliveries · 1,240 km lifetime)
→ "Send a cheer 💪" → the runner hears it in their earphones
→ chat (auto-translated) → "Arriving" → tell the courier your 4-digit PIN → Delivered
→ rate courier (stars + tags) and restaurant (separately)
→ IMPACT CARD: "You powered 2.4 km and 18 active minutes for Rina" → receipt email
```

**Courier: sign-up** (the easy part comes first, so more people finish)

```text
Install PWA → sign up (email) → choose Runner or Biker (pedal bike)
→ pre-run check (GPS ✓ screen-on ✓ mic ✓ notifications ✓)
→ QUICK FITNESS TEST: runner 2 km in 15 min · biker 5 km in 20 min (from config) + 1 checkpoint photo
→ passed? → personal details + ID photos + selfie (+ bike photo) → consents   (autosaves; finish later)
→ submit → AI Trust Brief → admin approves or rejects → email + push
```

**Courier: working**

```text
Start session: Run or Ride · goal (e.g. "easy 5 km") · Free run / Saved track / AI track
→ ONLINE: screen stays on; big "Run Mode" screen: distance · time · pace · active minutes · earnings
→ OFFER (sound + voice): "Warung Demo, 250 m off your track, adds 2.4 km to your 5 km goal, Rp 7.600. Accept?"
   → say "yes" or tap → assigned
→ keep running → app says "Head to Warung Demo now: 600 m, 4 min"
→ arrive → show pickup code / QR → merchant confirms → picked up
→ live route to customer → arrive → enter customer's PIN (or photo) → delivered
→ money added at once → keep running → end session
→ "Earned & moved" summary (km · active min · Rp) → withdraw anytime
```

**Merchant: sign-up**

```text
Sign up → business info → drop a pin on the map (lat/lng + pickup note) → hours, prep time
→ Snap-a-Menu (photos → menu) → check prices → save
→ PARTNER AGREEMENT, including the STAFF DELIVERY FALLBACK clause → sign (typed name + tick)
→ invite staff by email → submit → admin approves → LIVE
```

**Merchant: orders**

```text
New order (loud sound + push) → Accept + prep time   (or Reject → automatic refund)
→ see courier ETA → tap "Ready" → courier arrives → confirm pickup code → done
```

**Staff fallback**

```text
No runner/biker accepts within 4 min (config)
→ push to staff who are "on shift" and allowed to deliver → first one to accept gets it (3 min)
→ staff delivers with the Courier PWA in staff mode (tracked live), on foot, by bike or the restaurant's own way
→ staff earns 95% of the delivery fee
→ no staff either? → customer chooses: wait 5 more min · switch to pickup · cancel with full refund
```

**Admin (CMS)**

```text
Dashboard (live map + numbers) → Applications (Trust Brief) → approve / reject
→ Couriers (performance) → freeze (until a date) / unfreeze / ban — with reason + audit log
→ Merchants (approve, agreement version) → Orders (timeline, chat, proof photos, refund)
→ Withdrawals (hold/release) → Settings (tests, fees, dispatch; per country) → AI usage
```

---

## 4. Features per app

**Priority:**

- **P0** = must work in the demo; build first.
- **P1** = you asked for it or it matters a lot; build right after P0.
- **P2** = only if time is left.

### 4.1 Customer PWA

| Feature                             | Priority | Notes                                                                                                                           |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Sign up / log in                    | P0       | Email + password; one-click demo login in demo mode                                                                             |
| Delivery location                   | P0       | GPS or Google Places search, then adjust the pin, plus a note (floor, gate)                                                     |
| Restaurant list                     | P0       | Sorted by distance, with "Workout delivery · 30–60 min" and an availability badge (runners/bikers active nearby, or staff only) |
| Menu in your language               | P0       | AI translations; "show original" toggle                                                                                         |
| Cart + quote                        | P0       | Food, delivery fee, service fee, tip; the 30–60 min window shown clearly before paying                                          |
| Pay with wallet                     | P0       | Instant                                                                                                                         |
| Pay by card (Paddle checkout)       | P0       | Paddle sandbox overlay                                                                                                          |
| Wallet top-up (Paddle)              | P0       | Same Paddle code as card payment                                                                                                |
| Order status + live map             | P0       | Status timeline, courier marker, route, ETA                                                                                     |
| Courier profile + history           | P0       | Photo, first name, runner/biker, rating, deliveries, lifetime km/mi, last 8 weeks chart                                         |
| Delivery PIN                        | P0       | 4 digits, shown only to the customer                                                                                            |
| Rating + feedback                   | P0       | Rate courier and restaurant separately, so couriers aren't blamed for the food                                                  |
| Impact card + "my impact" page      | P0       | km and active minutes you powered, couriers you supported                                                                       |
| Send a cheer                        | P1       | Short message or emoji; the Voice Copilot reads it aloud to the courier                                                         |
| "No courier found" choices          | P0       | Wait more · switch to pickup · cancel + refund                                                                                  |
| Push notifications                  | P0       | Status changes                                                                                                                  |
| Language + units                    | P0       | English, Bahasa Indonesia + 1 more; km or miles                                                                                 |
| Chat with courier (auto-translated) | P1       | Quick replies ("I'm at the gate")                                                                                               |
| Tips                                | P1       | Optional; can be turned off per country                                                                                         |
| Order history + receipts            | P1       | Email receipt via Brevo                                                                                                         |
| Scheduled orders ("lunch at 12:30") | P1       | Lets runners plan their session around real orders                                                                              |
| Favorites, promo codes              | P2       |                                                                                                                                 |

### 4.2 Courier PWA (runner / biker / merchant staff mode)

| Feature                                                           | Priority                | Notes                                                               |
| ----------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| Quick fitness test (first step)                                   | P0                      | Distance and moving time from config; pass/fail; 1 checkpoint photo |
| Personal details + documents (after the test)                     | P0                      | §8; autosave; files go to the private R2 bucket                     |
| Application status                                                | P0                      | Draft → pending → approved / rejected (with reason)                 |
| Pre-run check                                                     | P0                      | GPS, screen wake lock, mic, notifications, motion permission (iOS)  |
| Start/stop session (run/ride, workout goal, free/saved track)     | P0                      | Goal = distance or time; dispatch uses it                           |
| Live GPS tracking + Run Mode screen                               | P0                      | Distance, moving time, pace/speed, splits                           |
| Offers (sound, vibration, voice, push)                            | P0                      | Accept/decline; 30 s timer                                          |
| **Voice Copilot**                                                 | P0                      | §10.A                                                               |
| "Head to restaurant now" nudge                                    | P0                      | Timed to food ready                                                 |
| Navigation map                                                    | P0                      | Route to restaurant, then to customer; "Open in Google Maps" button |
| Pickup code / QR                                                  | P0 (code) / P1 (QR)     | Merchant confirms                                                   |
| Complete delivery (PIN or photo)                                  | P0                      |                                                                     |
| Earnings wallet + withdraw anytime                                | P0                      | Mock payout in demo (§11)                                           |
| Session summary + lifetime stats + history                        | P0                      | "Earned & moved": km, active minutes, pace, earnings                |
| Weekly active minutes vs WHO 150 min, streaks, personal bests     | P0                      | The health heart of the app                                         |
| Safety: daily active-time cap, rest-day nudge, hydration reminder | P1                      | Configurable                                                        |
| Weekly AI Coach report                                            | P1                      | §10.G                                                               |
| Spoken pace cues every km/mi                                      | P1                      | No screen needed                                                    |
| **Staff mode** for merchant employees                             | P0                      | Invited by merchant, no fitness test, fallback offers only          |
| Offline GPS buffer (IndexedDB)                                    | P1                      | Sends late points with their real time                              |
| Step cadence check (runner)                                       | P1                      | Anti-cheat signal                                                   |
| Saved tracks                                                      | P1                      | Draw on map or save a past session                                  |
| Ratings received (tags + average)                                 | P1                      | Customer names hidden                                               |
| Translated chat + voice notes                                     | P1                      |                                                                     |
| AI Run Planner                                                    | P2 (first stretch goal) | §10.E: a route that fits your workout goal                          |
| GPX export (for Strava etc.)                                      | P2                      |                                                                     |

### 4.3 Merchant PWA

| Feature                              | Priority | Notes                                                                                           |
| ------------------------------------ | -------- | ----------------------------------------------------------------------------------------------- |
| Sign up + business profile           | P0       | Name, phone, country, currency, time zone                                                       |
| **Location pin (lat/lng)**           | P0       | Map with draggable pin, "use my location", address search, editable lat/lng fields, pickup note |
| Opening hours + prep time            | P0       | In the merchant's time zone                                                                     |
| Partner Agreement e-sign             | P0       | Versioned; includes the staff fallback clause (§8.5)                                            |
| **Snap-a-Menu**                      | P0       | §10.B                                                                                           |
| Menu edit                            | P0       | Items, prices, photos, sold-out toggle, size labels                                             |
| Incoming orders                      | P0       | Loud sound, accept + prep time, reject                                                          |
| Mark ready + confirm pickup          | P0       |                                                                                                 |
| Staff: invite, can-deliver, on-shift | P0       |                                                                                                 |
| See courier ETA                      | P1       |                                                                                                 |
| Earnings and statements              | P1       | Weekly payout (mock in demo)                                                                    |
| Busy mode (longer prep), pause store | P1       |                                                                                                 |
| Printer, promotions, analytics       | P2       |                                                                                                 |

### 4.4 Admin CMS

| Feature                                          | Priority | Notes                                                                            |
| ------------------------------------------------ | -------- | -------------------------------------------------------------------------------- |
| Admin login + roles                              | P0       | super, ops, support, finance                                                     |
| Dashboard                                        | P0       | Live map of online couriers and active orders, today's numbers                   |
| Courier applications + **Trust Brief**           | P0       | Map of the test with flagged parts, pace chart, photos, AI brief, approve/reject |
| Courier list + **performance page**              | P0       | §8.6                                                                             |
| **Freeze / unfreeze / ban**                      | P0       | Reason, end date, message, audit log, email + push                               |
| Merchant approval + agreement check              | P0       |                                                                                  |
| Orders list + detail                             | P0       | Event timeline, chat, proof photo, refund                                        |
| **Settings** (tests, fees, dispatch) per country | P0       | Overrides `config.yaml`                                                          |
| Demo controls                                    | P0       | Start bots, speed ×1/×3/×10, force "no courier", reset data                      |
| Withdrawals monitor (hold/release)               | P1       |                                                                                  |
| Ratings moderation queue                         | P1       | AI flags                                                                         |
| Audit log viewer                                 | P1       |                                                                                  |
| "AI under the hood" page                         | P1       | Every AI call: model, time, tokens, cost                                         |
| Ops Copilot (questions in plain words)           | P2       | §10.F                                                                            |

---

## 5. Order lifecycle

There are **two linked state machines**:

- **Order:** kitchen and money.
- **Delivery:** who brings the food.

The delivery search starts when the merchant accepts, so the courier can keep running while the food cooks.

```text
ORDER
awaiting_payment ─paid─► placed ─merchant accepts─► accepted ─"Ready"─► ready ─pickup code─► picked_up ─PIN/photo─► delivered ─72 h─► completed
      │                    │
 payment_failed      rejected / no answer in 3 min → full refund          cancelled (rules below) → refund

DELIVERY  (created when order = accepted)
searching ─offer─► offered ─accept─► assigned ─► at_pickup ─► picked_up ─► at_dropoff ─► delivered
    │ nobody in 4 min
    ▼
staff_searching ─staff accepts─► assigned (type = staff) ─► … same steps …
    │ nobody in 3 min
    ▼
no_courier ─► customer: wait 5 more min (→ searching) · switch to pickup · cancel + full refund
```

**Cancel rules (MVP)**

| When                                       | Who                     | Refund                               |
| ------------------------------------------ | ----------------------- | ------------------------------------ |
| Before the merchant accepts                | Customer                | 100%                                 |
| Merchant rejects or doesn't answer in time | System                  | 100%                                 |
| No courier and no staff                    | Customer chooses cancel | 100%                                 |
| After accept, before pickup                | Customer                | Not in the app; support decides (P1) |
| Courier problem after pickup               | Admin                   | Reassign or refund (case)            |

**How to code it (Go)**

- Allowed transitions live in one Go table, and every change goes through one function: `Transition(ctx, tx, orderID, from, to, actor)`.
- The update is guarded: `UPDATE orders SET status=$to WHERE id=$id AND status=$from`. If 0 rows change, someone else already moved the order.
- **In the same transaction:**
    1. insert into `order_events` (append-only history);
    2. post to the ledger (money);
    3. queue jobs with River (`InsertTx`): timeouts, push, email.

    Nothing is lost if the server crashes.

- After commit, broadcast the event on the WebSocket hub.
- Timeouts are River scheduled jobs: merchant accept (3 min), offer (30 s), search (4 min), staff (3 min), auto-complete (72 h).
- Unit tests cover every allowed and every forbidden transition.

---

## 6. Dispatch engine

### 6.1 Step 1: find candidates in PostGIS

Coordinates are stored as `geography(Point, 4326)`. Tracks are `geography(LineString, 4326)`, with GiST indexes. The query (sqlc):

```sql
-- name: DispatchCandidates :many
WITH o AS (
  SELECT o.id, o.dropoff, o.size_class, m.location AS pickup
  FROM orders o JOIN merchants m ON m.id = o.merchant_id
  WHERE o.id = @order_id
)
SELECT s.courier_id, c.mode,
       ST_Distance(s.last_pos, o.pickup)::int AS to_pickup_m,
       ST_Distance(o.pickup, o.dropoff)::int  AS trip_m,
       s.last_heading, c.rating_bayes,
       GREATEST(COALESCE(s.goal_distance_m, 0) - s.distance_m, 0) AS goal_left_m,
       EXTRACT(EPOCH FROM now() - COALESCE(c.last_delivery_at, s.started_at))::int AS idle_s
FROM activity_sessions s
JOIN couriers c ON c.user_id = s.courier_id
CROSS JOIN o
WHERE s.kind = 'work' AND s.status = 'active'
  AND s.last_seen_at > now() - interval '60 seconds'
  AND c.status = 'approved'
  AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.courier_id = s.courier_id
                  AND d.status IN ('assigned','at_pickup','picked_up','at_dropoff'))
  AND NOT EXISTS (SELECT 1 FROM dispatch_offers x
                  WHERE x.courier_id = s.courier_id AND x.delivery_id = @delivery_id)
  AND (
    (c.mode = 'runner'
      AND ST_DWithin(s.last_pos, o.pickup, @run_max_to_pickup_m)
      AND ST_DWithin(o.pickup, o.dropoff, @run_max_trip_m)
      AND o.size_class = ANY(@run_sizes::text[])
      AND (s.planned_track IS NULL OR ST_DWithin(s.planned_track, o.pickup, @run_corridor_m)))
    OR
    (c.mode = 'biker'
      AND ST_DWithin(s.last_pos, o.pickup, @bike_max_to_pickup_m)
      AND ST_DWithin(o.pickup, o.dropoff, @bike_max_trip_m)
      AND o.size_class = ANY(@bike_sizes::text[])
      AND (s.planned_track IS NULL OR ST_DWithin(s.planned_track, o.pickup, @bike_corridor_m)))
  )
ORDER BY to_pickup_m
LIMIT 20;
```

- An order's `size_class` is the "worst" value among its items. **It comes from Snap-a-Menu (AI)**, so AI output becomes a real dispatch rule.
- P1: match only the **part of the track still ahead**. Use `ST_LineLocatePoint` and `ST_LineSubstring` on `::geometry`.
- Tip for sqlc: keep geography inside SQL. Pass plain `lat`/`lng` numbers in and out: `ST_SetSRID(ST_MakePoint(@lng, @lat), 4326)::geography`.

### 6.2 Step 2: score in Go (lower is better; weights in config)

```go
etaPickupS  := float64(c.ToPickupM) * cfg.Circuity / speedMps(c.Mode)     // circuity default 1.3
carryS      := float64(c.TripM) * cfg.Circuity / speedMps(c.Mode)
untilReadyS := order.ReadyAtEst.Sub(now).Seconds()

// Hard rules: the food stays good and the 30–60 min promise holds. Speed is NOT scored.
if carryS > cfg.MaxCarryS(c.Mode) { continue }                             // runner 25 min, biker 30 min
if now.Add(secs(math.Max(etaPickupS, untilReadyS)+carryS)).After(order.WindowEnd) { continue }

// 1) Workout fit: does this order fill the distance the courier still wants to do?
jobKm := float64(c.ToPickupM+c.TripM) * cfg.Circuity / 1000
fitKm := jobKm * 0.3                                     // free run: shorter jobs slightly preferred
if c.GoalLeftM > 0 {                                     // e.g. goal 5 km, done 2 km → 3 km left
    fitKm = math.Abs(float64(c.GoalLeftM)/1000 - jobKm)
}
// 2) Food sitting on the counter is bad; the courier waiting is fine (they keep training).
foodWaitMin := math.Max(0, etaPickupS-untilReadyS) / 60
// 3) Free run: the restaurant is behind the courier.
headingPen := 0.0
if c.PlannedTrack == nil && angleDiff(c.Heading, bearing(c.Pos, pickup)) > 90 && c.ToPickupM > 300 {
    headingPen = 0.5
}
// 4) Fairness: couriers who haven't had an order for a while go first.
//    Declining is never punished (health first), so there is no acceptance-rate term.
score := 1.5*fitKm + 1.0*foodWaitMin + 0.6*(5-c.RatingBayes) + headingPen -
         0.2*math.Min(float64(c.IdleS)/60, 30)/10
```

The best match is the order that **fits the courier's workout** and keeps the food fresh. Speed is not the goal. The hard rules only make sure the food arrives inside the promised window.

### 6.3 Step 3: offers

1. Offer to rank 1 for 30 s, then rank 2, then rank 3.
2. Then broadcast to all remaining candidates for 60 s. The first to accept wins.
3. When 4 minutes have passed since the search started, go to staff fallback.

Accepting must be atomic, so two couriers can never get the same order:

```sql
UPDATE deliveries SET courier_id = @courier_id, status = 'assigned', assigned_at = now()
WHERE id = @delivery_id AND status IN ('searching','offered') AND courier_id IS NULL
RETURNING id;   -- 0 rows → "Sorry, someone else took it"
```

### 6.4 Step 4: timing and re-dispatch

- **"Leave now" nudge:** a River job at `ready_at_est − eta_pickup − 60 s`. It is moved when the merchant changes the prep time. If the merchant taps "Ready" early, the nudge goes at once.
- **Courier not coming:** if the distance to the restaurant doesn't shrink for 3 min after "leave now", or GPS goes silent for more than 90 s, warn the courier. After 2 more minutes, unassign them (counts as a cancel) and dispatch again.
- **P2:** two orders at once for bikers (same restaurant, same direction).

---

## 7. GPS tracking, run stats and anti-cheat

### 7.1 On the phone (Courier PWA)

- **GPS:** `navigator.geolocation.watchPosition(cb, err, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })`.
- **Screen Wake Lock:** `navigator.wakeLock.request('screen')` while a session is on. Request it again on `visibilitychange`. iPhone Home Screen apps support it from iOS 18.4 [21].
- **Filter before sending:** drop points with accuracy worse than 30 m (config) and duplicates.
- **Buffer:** points go to IndexedDB first, then a batch is sent every 5 s over the WebSocket (HTTP POST as fallback). After a reconnect, send the backlog with the original timestamps.
- **Steps (runners):** count steps with `DeviceMotionEvent` and send steps per batch. iOS needs `DeviceMotionEvent.requestPermission()` from a tap.
- **Run Mode screen:** large numbers (distance, time, pace), dark theme (saves battery on OLED screens), one-thumb buttons, audio cues.

### 7.2 On the server

- **Ingest:** check that the session belongs to the user and timestamps only go forward. Reject future timestamps. Store both phone time and server time.
- **Distance:** add the geodesic distance between points. Skip segments faster than the mode's maximum (runner 25 km/h, biker 50 km/h), but **flag them** for review.
- **Moving time:** sum segments with speed ≥ 0.5 m/s and gaps ≤ 30 s. **Elapsed time** = end − start.
- **Pace** (runner) = moving time ÷ distance, in min/km or min/mi. **Speed** (biker) = distance ÷ moving time, in km/h or mph. **Splits** every km or mile.
- **Active minutes:** minutes moving at a real exercise effort (runner ≥ 5 km/h, biker ≥ 10 km/h; configurable) count toward the **WHO goal of 150–300 min/week** [38]. They show as a weekly ring ("112 / 150 min").
- **Lifetime totals** update when a session ends: distance, moving time, active minutes, deliveries. Distance while carrying food is counted separately.
- **Calories:** only an estimate (MET × body weight × time, if the courier enters their weight), always labeled "estimate".
- **Storage:**
    - Raw points go to `location_points` (BRIN index on time).
    - The finished track is saved as one `LineString` (`ST_MakeLine(... ORDER BY ts)`).
    - **Raw points are deleted after 30 days** (privacy).
- **Stale:** no point for 60 s → session `stale` (no offers). 10 min → session ends automatically.

### 7.3 Anti-cheat signals

Flags feed the Trust Brief. **No automatic bans.** A human decides.

| Signal                    | Default rule                                                            | Why                                            |
| ------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| Speed spike               | Runner > 25 km/h for 20 s; biker > 50 km/h                              | Probably a car or motorbike                    |
| Teleport                  | Jump > 200 m in < 5 s                                                   | Fake GPS or a bad fix                          |
| Too smooth                | Accuracy never changes, no jitter                                       | Typical of GPS-spoofing apps                   |
| Cadence mismatch (runner) | Speed > 8 km/h but cadence < 100 steps/min                              | Phone in a vehicle                             |
| Gaps                      | Any gap > 60 s                                                          | App left the screen; test may be invalid       |
| Clock skew                | Phone time vs server time > 30 s                                        | Replayed data                                  |
| Checkpoint photo          | 1 random prompt during the test                                         | AI checks it's a live outdoor scene            |
| Motor help (biker)        | Average > 35 km/h for 5 min, or the bike photo shows a battery or motor | Pedal bikes only; possible e-bike or motorbike |

> Big buildings can cause speed spikes. That's another reason the flags only go to humans.

### 7.4 PWA limits (be honest in the pitch)

- A PWA **can't get GPS reliably when the screen is off or the app is in the background**, especially on iPhone. Background location needs a native app [21][22][23].
- What we do:
    - Keep the screen on (Wake Lock).
    - Show a big "Tracking paused" warning when the app leaves the screen.
    - Record gaps.
    - A fitness test with gaps over 60 s is invalid.
- Advice in the app: use an armband (runners) or a handlebar mount (bikers), and carry a power bank on long sessions.
- **After the hackathon:** wrap the same React code with Capacitor and a background-location plugin (or go native).

---

## 8. Courier sign-up and fitness test

### 8.1 Personal details

| Field                                                                                          | Required            | Notes                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| Legal full name                                                                                | ✓                   | As on the ID                                                                                              |
| Date of birth                                                                                  | ✓                   | 18+ (configurable per country)                                                                            |
| Email (verified), phone (E.164)                                                                | ✓                   |                                                                                                           |
| Country, city, address                                                                         | ✓                   |                                                                                                           |
| Nationality                                                                                    | ✓                   |                                                                                                           |
| ID type + number                                                                               | ✓                   | Number encrypted (AES-GCM) and hashed to catch duplicate accounts                                         |
| ID photo front/back                                                                            | ✓                   | Private bucket, short-lived links                                                                         |
| Selfie                                                                                         | ✓                   | A human compares it with the ID. **No face recognition** (sensitive data)                                 |
| Emergency contact (name, phone, relation)                                                      | ✓                   |                                                                                                           |
| Mode: runner or biker                                                                          | ✓                   |                                                                                                           |
| Bike type, helmet, lights                                                                      | Bikers ✓            | **Pedal bikes only:** road, city/hybrid, mountain, folding, cargo. E-bikes and motorbikes are not allowed |
| Bike photo + "my bike has no motor" tick                                                       | Bikers ✓            | AI checks the photo for a battery or motor (§10.C); the admin decides                                     |
| Delivery bag (insulated, liters)                                                               | ✓                   | Photo optional                                                                                            |
| Usual areas and times, languages                                                               | Optional            | Helps matching and the chat                                                                               |
| Payout details                                                                                 | At first withdrawal | Encrypted                                                                                                 |
| Consents: terms, privacy, location during sessions, background check (if the country needs it) | ✓                   | Saved with version + time                                                                                 |

### 8.2 The test

1. The app shows the rules **from config**, e.g. "Run 2 km within 15 minutes of moving time. Any outdoor route. Walking breaks are OK. Keep the screen on."
2. Start → a session with `kind = qualification` → live progress (distance left, pace needed) → 1 **checkpoint photo** prompt at a random time.
3. Finish → the server computes distance, time and flags. **Pass or fail is decided by code:**
    - distance ≥ target, AND
    - moving time ≤ limit, AND
    - total time ≤ 2× limit, AND
    - no GPS gap over 60 s.
4. Failed? The app shows why ("you needed 7:30 /km, you ran 8:10 /km") and says **try again in 1 hour**. Max 3 tries per 7 days (config).
5. Passed → fill in details and documents → submit → status `pending_review` → AI Trust Brief job → the admin queue.

### 8.3 Config keys

Defaults live in `config.yaml`. Overrides go in `platform_settings` per country, and admins edit them in the CMS.

```text
qualification.runner.distance_m       = 2000    # 2 km (1.24 mi)
qualification.runner.max_moving_s     = 900     # 15 min → 7:30 /km
qualification.biker.distance_m        = 5000    # 5 km (3.1 mi)
qualification.biker.max_moving_s      = 1200    # 20 min → 15 km/h
qualification.max_elapsed_factor      = 2       # total time ≤ 2 × moving limit
qualification.retry_after_s           = 3600    # try again after 1 hour
qualification.max_attempts_per_week   = 3
qualification.max_gap_s               = 60
qualification.checkpoint_photos       = 1
courier.biker.pedal_only              = true
courier.biker.allowed_bike_types      = [road, city, mountain, folding, cargo]
```

### 8.4 Courier statuses

```text
draft → testing → passed_test → pending_review → approved ⇄ frozen
                                      │              │
                                      └→ rejected     └→ banned
(rejected → can apply again after 7 days, config)
```

- **Approve:** status becomes `approved`, plus an email (Brevo) and a push.
- **Reject:** the admin picks a reason and the AI drafts the message in the applicant's language. The admin edits it, then it goes by email and push.
- **Freeze** (temporary, until a date or until lifted):
    - The courier can't go online.
    - If they're mid-delivery, they finish it, unless the reason is safety (then the admin reassigns).
- **Ban** (permanent): courier features are off, and the ID hash blocks new accounts.
- **Money:** frozen and banned couriers **can still withdraw money they already earned**, unless it's on fraud hold.
- Every action saves the reason, the admin and the time in `audit_logs` and `courier_sanctions`.

### 8.5 Merchant Partner Agreement: staff fallback clause (plain-English summary)

> Have a lawyer review this before a real launch.

1. If no Trackfud courier accepts an order within the search time, the merchant's registered staff may deliver it.
2. Each staff delivery is voluntary for that staff member.
3. Trackfud pays the delivery fee (minus 5%) straight into the staff member's Trackfud wallet.
4. The merchant makes sure staff deliveries follow local labor, insurance and road-safety rules.
5. Commission on staff-delivered orders is 5%, not 10%.
6. If no staff accepts either, the customer gets a full refund and the merchant gets no penalty.

The agreement is stored as: version, SHA-256 of the text, typed name, tick box, IP, user agent and time, plus a snapshot of the text in the private R2 bucket. A new version means merchants must accept again.

### 8.6 Performance (CMS)

| Metric                          | Formula (last 30 days)                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Acceptance rate                 | accepted offers ÷ offers received (shown only; **never** used to punish)                               |
| Completion rate                 | delivered ÷ assigned                                                                                   |
| In-window rate                  | delivered inside the customer's 30–60 min window ÷ delivered (being slow inside the window is fine)    |
| Avg pickup wait / delivery time | from delivery timestamps                                                                               |
| Rating                          | Bayesian average: (10 × 4.5 + sum of stars) ÷ (10 + count). Stops 1–2 ratings from deciding everything |
| Complaints                      | per 100 deliveries, by AI topic (late, rude, spilled)                                                  |
| Distance + active minutes       | total, per delivery, per week; weeks that meet WHO's 150 min                                           |
| Overexertion                    | days over the daily cap, very long sessions (a safety check, not a penalty)                            |
| Earnings                        | total, per active hour                                                                                 |
| Anti-cheat flags                | count + latest                                                                                         |

The page shows trend charts, a comparison with peers (percentile), session history with maps (each admin view is logged), and freeze/ban buttons.

---

## 9. Live maps

- **Library:** `@vis.gl/react-google-maps` (Maps JavaScript API) with **Advanced Markers**. These need a Map ID from the Google Cloud console.
- **Customer:**
    - Courier marker with photo and runner/biker icon. It moves smoothly between updates.
    - Restaurant and home markers, the route, the ETA, and the profile card.
    - **Privacy:** the courier's live position is shared only during an active delivery. Never show home location, past routes or last name.
- **Courier:**
    - Route to the restaurant, then to the customer, with "turn now" cues.
    - An **"Open in Google Maps"** button for turn-by-turn: `https://www.google.com/maps/dir/?api=1&destination=LAT,LNG&travelmode=walking|bicycling`. It's free and robust.
- **Merchant:** courier approaching + ETA.
- **Admin:** all online couriers (clustered), active orders, demand heatmap (P1).
- **Routes API** with travel mode `WALK` (runner) or `BICYCLE` (biker):
    - Call it only on assign, on pickup, and when the courier is more than 150 m off the route.
    - Use the field mask `routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline` to stay on the cheaper Essentials SKU.
    - `WALK` and `BICYCLE` are **beta**, and Google says apps **must show a warning** on walking and cycling routes, e.g. "Walking/cycling routes are in beta and may miss sidewalks or bike paths" [18].
- **Calls from Go:** use plain HTTPS to `routes.googleapis.com/directions/v2:computeRoutes` with the `X-Goog-Api-Key` and `X-Goog-FieldMask` headers. The old Go client library doesn't cover the Routes API.
- **Keys:** the browser key is limited to `https://Trackfud.duckdns.org/*` (HTTP referrer; add your domain later). The server key is limited to the VPS IP. Also set quotas and a budget alert.

| What                            | When we call it             | Free per month [19][20]  |
| ------------------------------- | --------------------------- | ------------------------ |
| Dynamic Maps (Maps JS)          | Each map load               | 10,000 (Essentials)      |
| Compute Routes (Essentials)     | Assign, pickup, big detour  | 10,000                   |
| Places Autocomplete / Geocoding | Address entry, merchant pin | 10,000 each (Essentials) |

---

## 10. Meta AI features

All AI runs **on the Go server**. Keys never go to the browser; Meta's docs say to route calls through your server [14].

- **API:** `https://api.meta.ai/v1`, OpenAI-compatible [4], so use `openai-go` v3 with `option.WithBaseURL(...)`.
- **Code:** one `internal/ai` package holds the client, versioned prompts, JSON schemas, the tool registry, and the `ai_calls` log (model, time, tokens, cost).

**Models and prices** [5][6]

| Model                        | Use                                                       | Price                                                  |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `muse-spark-1.3` (Standard)  | Agent, vision, structured output, translation, briefs     | $1.25 in / $4.25 out per 1M tokens; cached input $0.15 |
| `muse-spark-1.3-contributor` | **Only our own UI strings** (cheap; Meta may train on it) | $0.10 / $0.20 per 1M                                   |
| `muse-voice-transcribe-1.0`  | Realtime speech-to-text, 25 languages                     | $0.18 per audio hour                                   |
| `sam-3.1`                    | Find and outline objects in photos                        | $2.50 per 1,000 images                                 |
| `muse-image-1.0`             | Stretch only (share cards)                                | $0.01 per image                                        |

- **Data rule:** Contributor mode lets Meta train on what you send [6]. So **all personal or merchant data uses Standard mode**: voice, chat, IDs, photos, ratings, menus.
- **Limits:** Muse Spark allows 3,000 requests/min; Voice allows 256 streams at once [6]. That's plenty.
- **Not available in the API:** speech synthesis (text-to-speech). We use the browser's `speechSynthesis` for spoken replies [5].

### A. Voice Copilot "Pace" (P0, hero feature)

**Why:** runners and bikers can't safely tap a screen. They need to talk.

```text
Courier phone                        Go API                                   Meta Model API
mic (echoCancellation on)
 → AudioWorklet: PCM 16-bit, 24 kHz, 80 ms frames
 → WS /v1/voice (binary) ─────────►  voice relay ── handshake: key, PCM_24KHZ, ENDPOINTING,
                                                    keywords = [restaurant, street, items],
                                                    languageBias = courier's language ──► wss://api.meta.ai/v1/asr/realtime
                                     ◄── partial transcripts · speechComplete ─────────────
 ◄── live caption ───────────────
                                     agent: muse-spark-1.3, reasoning_effort "low",
                                     tools + cached system prompt, streaming
                                       → tools run with THIS courier's permissions
                                       → risky action → "pending confirmation"
 ◄── reply text (streamed) ───────
speechSynthesis.speak(reply) in the courier's language
```

**Voice API details** [7][8]:

- The handshake is the first JSON frame, sent within 10 s, with the key in `authorization.accessToken`. That's why the browser can't connect directly, and we relay through Go.
- Send audio at real-time speed. The server closes the stream if you get more than 5 s ahead.
- End the stream with `{"type":"endStream"}`.
- `ENDPOINTING` mode finds where each sentence ends.
- `keywords` improves recognition of names. We fill it from the **live order** (restaurant name, street names, menu items). That's a big help outdoors with wind and traffic noise.
- Supported languages include English, **Indonesian**, Malay, Thai, Vietnamese, Tagalog, Hindi, Arabic, Japanese, Spanish and more, **with code-switching** [7].

**Tools**

| Tool                                                                     | Needs "yes" confirmation? |
| ------------------------------------------------------------------------ | ------------------------- |
| `get_current_offer`                                                      | No                        |
| `accept_offer`                                                           | **Yes**                   |
| `decline_offer(reason)`                                                  | **Yes**                   |
| `get_next_step` (where to go, distance, ETA)                             | No                        |
| `get_session_stats` ("how far have I run?", "active minutes this week?") | No                        |
| `get_workout_status` ("how much of my 5K is left?")                      | No                        |
| `send_message_to_customer(text)` (auto-translated)                       | No (shown on screen)      |
| `mark_arrived_pickup`                                                    | **Yes**                   |
| `report_problem(type, note)`                                             | No (opens a case)         |
| `go_offline`                                                             | **Yes**                   |

**Safety design**

- The API supports only `tool_choice: "auto"` [11]. So confirmation is a **server state machine**, not a prompt trick:
    1. The model's tool call creates a pending action.
    2. The server asks: "Say yes to accept Warung Demo, 250 m."
    3. Only a "yes" in the next turn runs it.
- Finishing a delivery still needs the PIN or a photo. You can't finish by voice.
- There are **no money tools**. Withdrawing needs a tap and a confirm.
- Customer text (delivery notes, chat) goes to the model as **quoted data**, never as instructions. Tools can only touch the courier's current delivery, and Go validates every argument.

**Offer-by-voice flow (the demo moment)**

1. An offer arrives.
2. The app speaks: "New order, Warung Demo, 250 meters off your track, 7,600 rupiah. Accept?"
3. The mic opens for 8 s. The courier says "yes", or "ambil", or "gas" (Indonesian slang).
4. The courier hears "Accepted. Keep running, I'll tell you when to turn."
5. Later, a customer cheer arrives, and the app reads it aloud: "Message from Budi: You got this!" Spoken pace cues come every km.

**Speed tips**

- Use `reasoning_effort: "low"`. It's recommended for fast direct tasks [15].
- Keep the system prompt and tools first, so prompt caching works.
- Stream the reply and start speaking after the first sentence.
- On Day 1, measure the time from end of speech to spoken reply. Target < 2.5 s **(estimate)**.
- Fallback: big buttons, plus "Accept/Decline" buttons on the push notification (Android).

### B. Snap-a-Menu (P0, hero feature)

1. The merchant takes 1–10 photos of a menu board, a paper menu or dishes on a table. The phone resizes them to max 1600 px.
2. Photos are uploaded to the private R2 bucket with presigned PUTs.
3. A River job sends **presigned GET links** to `muse-spark-1.3`. Up to 50 images per request are allowed [13]. It uses **structured output** (`response_format: json_schema`) [12]:

```json
{
    "categories": [
        {
            "name": "Noodles",
            "items": [
                {
                    "name": "Mie Ayam",
                    "description": "Chicken noodles with bok choy",
                    "price_minor": 2500000,
                    "currency": "IDR",
                    "options": [{ "name": "Extra egg", "price_minor": 500000 }],
                    "allergens": ["gluten", "egg"],
                    "dietary": ["halal"],
                    "spicy_level": 1,
                    "size_class": "M",
                    "spill_risk": "medium",
                    "travels_well": true,
                    "max_hold_min": 45,
                    "est_weight_g": 450,
                    "source_language": "id",
                    "confidence": 0.93
                }
            ]
        }
    ]
}
```

4. **Translations:** a second, low-effort pass writes names and descriptions in each enabled language (e.g. en, id, es, ja, ar). They're stored as JSONB per language.
5. **Dish photos (SAM 3.1):**
    - Prompt with a short noun phrase such as "plate of food", "bowl" or "drink" [9].
    - The response has one box (and mask) per dish. Boxes are in source pixels, and masks are base85 [10].
    - **MVP:** crop a square around each box. **P2:** use the mask to remove the background.
    - Muse Spark then suggests which crop belongs to which item.
6. **Review screen:**
    - An editable table. Fields with confidence below 0.8 are yellow.
    - The merchant must tick "I checked all prices" before publishing.
    - **Rules:** the AI never invents a price (unreadable → null + flag). AI-cropped photos get a small label.
7. **Why it's not "basic":** `size_class`, `spill_risk` and `travels_well` go straight into dispatch and the customer menu (§2.1, §6). The AI decides **whether a runner can carry the soup, and whether the fries survive a 40-minute trip**. Items that don't travel well show as "pickup only".

Stretch:

- **Search grounding** ($2.50 per 1,000 searches) to pre-fill hours and cuisine from the web, with citations.
- **Muse Image** to improve the light on real dish photos. Never to make fake dishes.

### C. Trust Brief (P0 for courier review, P1 for delivery proof)

**Courier application**

1. Go computes the facts by code: distance, time, pace splits, speed spikes, gaps, GPS jitter, cadence match, and whether checkpoint photo times fit the GPS.
2. **SAM 3.1** finds "identity card" or "passport" in the ID photo, and we crop it. Then Muse Spark extracts: name, birth date, expiry, document type, country, last 4 digits.
3. Go compares those with the form: fuzzy name match, age ≥ 18, not expired.
    - **Bikers:** Muse Spark also checks the bike photo for a battery, hub motor or throttle (pedal bikes only). It is a flag for the admin, never an automatic reject.
4. Muse Spark (`reasoning_effort: "high"`) writes the brief:
    ```json
    {
        "suggestion": "review",
        "risk_score": 62,
        "reasons": [
            {
                "text": "km 2.1–2.6 at 34 km/h, faster than running",
                "evidence": "segment:2100-2600"
            },
            { "text": "Name on ID matches the form", "evidence": "id:name" }
        ],
        "questions_for_applicant": [
            "Were you on a vehicle between 08:14 and 08:16?"
        ],
        "summary": "Fast segment looks like a vehicle; documents look fine. Ask before approving."
    }
    ```
5. The CMS shows the map with red flagged parts, charts, photos and the brief. **The admin decides.** The brief and model version are saved in the audit log.

**Delivery proof (P1)**

- The courier's photo goes to SAM 3.1 ("bag"). If no bag is found, the app asks for a new photo.
- Then Muse Spark checks: "Is a food bag at a door or being handed over? Sealed? How many?" The JSON is saved for disputes.

**Feedback (P1)**

- Each comment is classified with low effort: sentiment, topics (late, rude, spilled, friendly), and a safety flag.
- Topics roll up on the performance page.
- Safety flags open a case and **suggest** a freeze. The admin decides.

**Moderation (P1):** chat messages and profile photos get an allowed/blocked check with a small schema.

### D. Translated chat (P1)

- Messages are stored with the original and its translations (low effort, cached by text hash).
- Quick replies are pre-translated.
- P1: courier voice notes → Voice Transcribe file endpoint → text → translated.

### E. AI Run Planner (P2, first stretch goal: it serves the health goal directly)

- The courier says: "Plan a 5K easy loop from here for lunch time."
- The plan **fits the workout first** (distance, easy pace, few big hills), then passes busy restaurants.
- Muse Spark calls these tools:
    - `get_hotspots(area, time)`: busy restaurants from past or seeded orders
    - `make_loop(start, waypoints ≤ 10, mode)`: Routes API, which stays on Essentials with ≤ 10 waypoints
    - `estimate_earnings(route, time)`
- It returns 2 options on the map. The chosen one becomes `planned_track`, so **the AI plan drives the dispatch corridor**.

### F. Ops Copilot (P2)

The admin asks: "Which bikers had in-window deliveries under 80% last week?" Muse Spark answers by calling **read-only, pre-made** analytics tools (no raw SQL), then shows a table and a short explanation.

### G. Weekly AI Coach report (P1)

- Every Sunday evening, a River job sends the courier's week to Muse Spark (low effort) as numbers: sessions, km, active minutes, pace trend, rest days, deliveries and earnings.
- It writes a short, friendly report in the courier's language, using structured output: `{headline, wins[], watch_outs[], next_week_plan[], earnings_note}`.
- Example: "142 of 150 active minutes. One more easy 20-minute run hits the WHO goal. You ran 4 days in a row, so take Friday off."
- **Rules, in the prompt and checked in code:**
    - No medical advice, no diagnosis, no weight-loss promises.
    - Increase weekly distance gently, and suggest rest days.
    - Any mention of pain or injury → "please see a professional".
- It arrives as a push notification and shows in the app. The courier can ask the Voice Copilot about it ("what's my plan this week?").

### AI cost per use (estimates from the prices above)

| Feature                                                 | Cost per use **(estimate)** |
| ------------------------------------------------------- | --------------------------- |
| One voice turn (10 s audio + ~2.5k tokens in / 150 out) | ~$0.004 (less with caching) |
| Snap-a-Menu (3 photos + SAM)                            | ~$0.03                      |
| Translate 40 items into 4 languages                     | ~$0.04                      |
| Trust Brief                                             | ~$0.02                      |
| Delivery proof check                                    | ~$0.005                     |
| Chat message translation                                | ~$0.0007                    |
| Weekly AI Coach report                                  | ~$0.005                     |

→ Your **$150 credit covers thousands of demo actions**.

**Open weights (roadmap):** Muse Glimmer is 30B, Apache 2.0, and runs on vLLM, SGLang, llama.cpp or Ollama [16]. It could later run ID reading and moderation **on our own servers** (privacy, cost). If you get Modal credits, it's a stretch demo. Don't rely on it for judging: big models start slowly.

---

## 11. Payments, wallet and payouts

> ⚠️ **Important: Paddle's rules ban this business in live mode.** Paddle's Acceptable Use Policy does not allow [17]:
>
> - "Physical products" or products that need physical delivery
> - marketplaces: any product or service "that enables non-Paddle Sellers to sell products and services to customers"
> - "Virtual currency or stored value, including but not limited to store credit, gift cards, vouchers" (our wallet)
> - "Money transfer services" (close to courier payouts)
>
> **For the hackathon:** use the Paddle **sandbox** (test cards, no real money), as you asked. It works for the demo.
> **In the pitch:** say "payments run through a provider interface. Paddle sandbox is in the demo; production uses a marketplace provider." Judges respect this.
> Paddle's fee (5% + $0.50 per transaction) would also hurt cheap food orders (§12).

### 11.1 Flows

1. **Top-up:**
    1. `POST /v1/wallet/topups {amount, currency}` → a `topups` row + a Paddle transaction with a **non-catalog price**, `custom_data: {kind: "topup", topup_id}`.
    2. The frontend runs `paddle.Checkout.open({ transactionId })`.
    3. The webhook `transaction.completed` → verify the signature → post to the ledger: **debit `paddle_clearing`, credit `customer_wallet`**.
2. **Direct card pay:** the order starts as `awaiting_payment` with a Paddle transaction for the total. The webhook sets it to `placed` and posts: debit `paddle_clearing`, credit `order_escrow`.
3. **Wallet pay:** one DB transaction → lock the wallet row (`SELECT … FOR UPDATE`) → check the balance → debit `customer_wallet`, credit `order_escrow` → `placed`.
4. **Settlement when delivered:** debit `order_escrow` (total) and credit:
    - `merchant_payable` (food − commission)
    - `courier_earnings` (delivery fee − 5% + tip)
    - `platform_revenue` (commission + service fee + courier fee)
5. **Refund before pickup:** debit `order_escrow`, credit `customer_wallet` (instant). Card refund via a Paddle adjustment is P1.
6. **Withdraw anytime** (you asked for this):
    1. The courier requests X (≥ minimum, ≤ available) → debit `courier_earnings`, credit `payout_clearing`.
    2. The payout adapter runs. In the demo it's **mock**: "paid" after 10 s.
    3. On failure, reverse the entry. Notify by push + email.
    - Money is available **right after delivery**. Admins can hold money only for flagged deliveries.

### 11.2 Ledger rules (good "technical depth")

- Money is an integer in the **minor unit** of the currency (ISO 4217) plus a currency code. No floats.
- Every journal entry balances: postings per currency sum to 0. This is checked in Go and in a test.
- `idempotency_key UNIQUE` (Paddle event id / transaction id / our request id), so a webhook delivered twice can't pay twice.
- Postings are never updated or deleted; corrections are new entries.
- Each account caches its balance, updated in the same transaction. Wallet accounts have `CHECK (balance_minor >= 0)`.
- **Webhook check:** use Paddle Go SDK v5's webhook verifier. It checks the `Paddle-Signature` header (HMAC-SHA256 over timestamp + raw body). Save each event in `webhook_events (event_id UNIQUE)` before processing.
- P2: a nightly job compares Paddle transactions with the ledger.

### 11.3 Production options (after the hackathon; check each before choosing)

| Option                               | Split payments to restaurants | Payouts to couriers | Note                                                                                                                                      |
| ------------------------------------ | ----------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe Connect                       | ✓                             | ✓                   | Needs a company in a Stripe country. Your earlier note: Stripe Indonesia accounts can't take foreign payments, so consider a US/SG entity |
| Adyen for Platforms                  | ✓                             | ✓                   | Enterprise onboarding                                                                                                                     |
| Xendit (xenPlatform + Disbursements) | ✓                             | ✓                   | Strong in Indonesia/SEA: QRIS, e-wallets                                                                                                  |

The code has `PaymentProvider` (create checkout, refund, parse webhook) and `PayoutProvider` (send, status). For the hackathon we implement only `paddle` and `mock`.

---

## 12. Pricing and unit economics

**Default fees** (config, per country; amounts are in that currency's minor units)

| Who                          | Big apps                                                                                                                                                                                | Trackfud                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Restaurant commission        | DoorDash 15/25/30% [28]; Uber Eats 15/25/30% [29] (one source says 20–30% since March 2026 [30]); GoFood 20% + Rp 1.000 per item (older report) [31]; ShopeeFood ~15% (2026 guide) [32] | **10%**, or **5%** when its own staff delivers                                      |
| Customer service fee         | varies                                                                                                                                                                                  | **3%**, min $0.10, max $0.99 (Indonesia: min Rp 1.000, max Rp 5.000)                |
| Delivery fee (customer pays) | varies                                                                                                                                                                                  | Base $1.00 + $0.35/km, max $3.50 (Indonesia: Rp 5.000 + Rp 1.500/km, max Rp 15.000) |
| Courier / staff              |                                                                                                                                                                                         | Keeps **95%** of the delivery fee + **100%** of tips                                |
| Withdrawals                  |                                                                                                                                                                                         | Free from $5 (or Rp 50.000)                                                         |

**Example: $20 of food, 2 km**

|                                     | Amount                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| Customer pays                       | $20.00 food + $1.70 delivery + $0.60 service = **$22.30** (+ optional tip)             |
| Restaurant gets                     | $20.00 − 10% = **$18.00** (on DoorDash/Uber Eats it would pay $3–6 commission, not $2) |
| Courier gets                        | $1.70 − $0.09 = **$1.61** + tip                                                        |
| Platform gross                      | $2.00 + $0.60 + $0.09 = **$2.69**                                                      |
| Card cost if live, ~2.9% + $0.30    | ≈ $0.95 → **net ≈ $1.74** **(estimate)**                                               |
| If Paddle were allowed (5% + $0.50) | ≈ $1.62 → net ≈ $1.07 (another reason to switch)                                       |
| AI cost per order                   | < $0.02 **(estimate)**                                                                 |

**Indonesia example: Rp 50.000 of food, 2 km**

- Delivery fee: Rp 8.000. Service fee: Rp 1.500. **Customer pays Rp 59.500.**
- Restaurant gets Rp 45.000. Courier gets Rp 7.600. Platform gross is Rp 6.900, before payment costs.

**Rounding:** round platform fees half-up to the minor unit. The courier gets the rest, so every order sums exactly.

**Wallet top-ups** spread one fixed card fee over several orders.

**Why customers pay without speed:** they are supporters.

- The delivery fee stays lower than car apps.
- The impact card shows what their order did ("2.4 km, 18 active minutes for Rina").
- Suggested "cheer tips" (e.g. Rp 2.000 / Rp 5.000) go 100% to the courier.

**Later revenue:** a merchant Pro plan (analytics, promos), sponsored "challenge runs" from sports brands, promoted listings.

---

## 13. Going global

- **Languages:**
    - `react-i18next` with ICU messages. Demo with English, Bahasa Indonesia + Spanish, and check right-to-left layout with Arabic (P2).
    - A dev script translates `en.json` into other languages with `muse-spark-1.3-contributor`. That's OK because it's our own UI text, and the script keeps the `{placeholders}`.
- **Menus:** stored per language (JSONB) with a `source_language`. Customers see their own language and can tap "show original".
- **Money:** ISO 4217 minor units. Go uses `bojanz/currency`; the browser uses `Intl.NumberFormat`.
    - The order currency is the restaurant's currency.
    - There's one wallet per currency.
    - No currency exchange in the MVP.
- **Units:** stored in meters and seconds. Shown as km or miles, and pace per km or per mile. Defaults by country (US/UK → miles); users can change it.
- **Time:** UTC `timestamptz` in the database. Restaurant hours use the restaurant's IANA time zone. Users see their own time.
- **Phones:** E.164 format (`nyaruka/phonenumbers`). **Addresses:** Google Places + free-text notes.
- **Per-country settings:** currency, fees, test rules, minimum age, tips on/off, default units, legal texts, enabled languages.
- **Privacy (GDPR/CCPA style):**
    - Data export and delete.
    - Consent logs.
    - Location only during sessions.
    - Raw GPS deleted after 30 days.
    - ID files private, with 5-minute links.
    - Customers see only what they need.
    - The privacy policy names Meta Model API as a processor.
- **Legal:** courier rules differ by country (contractor status, platform-work laws). Check each country before launch. Restaurants are responsible for food safety.
- **Accessibility:** large touch targets (sweaty hands, gloves), high contrast, voice control, screen-reader labels.

---

## 14. Architecture and repo layout

```text
 ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
 │ Customer PWA │ │ Courier PWA  │ │ Merchant PWA │ │  Admin CMS   │
 │  /customer/  │ │  /courier/   │ │  /merchant/  │ │   /admin/    │
 └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
        └────── HTTPS REST + WebSocket (JSON) + voice WebSocket (PCM) ─────┘
                                   ▼
     Caddy on https://Trackfud.duckdns.org (TLS, 4 apps by path, /api/ → Go)
                                   ▼
             ┌───────────────────────────────────────────┐
             │ Go API (one binary): REST · WS hub ·       │
             │ voice relay · dispatch · River workers     │
             └─┬───────┬────────┬────────┬────────┬───────┘
               │       │        │        │        └─► Web Push (VAPID) → browser push services
               │       │        │        └──────────► Brevo SMTP (smtp-relay.brevo.com:587)
               │       │        └───────────────────► Paddle sandbox API  ◄── webhooks
               │       └────────────────────────────► Meta Model API (Muse Spark, Voice Transcribe, SAM 3.1)
               │                                      Google Routes API (server key)
               ▼
   PostgreSQL 18 + PostGIS 3.6 (data, ledger, GPS, River job queue)
   Cloudflare R2: public bucket (menu photos, avatars) · private bucket (IDs, selfies, proofs, agreements)
```

**Repo layout (one repo, separate folders)**

```text
Trackfud/
├── backend/                          # standalone Go API
│   ├── cmd/api/                      # main server (also runs River workers)
│   ├── cmd/simulator/                # demo bots: couriers on GPX tracks, auto-merchants
│   ├── internal/
│   │   ├── config/      auth/        platform/   (settings + feature flags)
│   │   ├── courier/     tracking/    dispatch/    order/
│   │   ├── merchant/    menu/        ledger/      payment/ (paddle)   payout/ (mock)
│   │   ├── ai/          (client, prompts, schemas, tools: copilot, menu, brief, moderation)
│   │   ├── realtime/    (WebSocket hub, voice relay)
│   │   ├── notify/      (web push, email templates per language)
│   │   ├── storage/     (R2 presign)   maps/ (Routes API)   admin/ (RBAC, audit)
│   │   └── httpapi/     (router, middleware, handlers generated from OpenAPI)
│   ├── db/migrations/   db/queries/  db/seed/
│   ├── api/openapi.yaml              # the contract → Go server + TS client
│   ├── config.yaml                   # defaults: test distance/time, fees, dispatch
│   └── Containerfile
├── frontend/
│   ├── pnpm-workspace.yaml
│   ├── packages/
│   │   ├── api-client/   # generated types + fetch client
│   │   ├── ui/           # shared components (Tailwind)
│   │   ├── maps/         # LiveMap, RouteLine, PinPicker, CourierMarker
│   │   ├── i18n/         # locales + money/distance/pace/time formatters
│   │   └── pwa/          # push subscribe, wake lock, GPS hook, offline queue, mic → PCM
│   └── apps/
│       ├── customer/     # PWA
│       ├── courier/      # PWA (runner, biker, staff mode)
│       ├── merchant/     # PWA
│       ├── cms/          # admin web app (desktop-first, not a PWA)
│       └── landing/      # judge-mode start page with one-click demo logins
├── deploy/
│   ├── compose.yaml      # local dev with Podman
│   ├── quadlet/          # systemd units for the VPS
│   └── Caddyfile
├── docs/                 # this plan, judge guide, demo script, architecture
└── Makefile              # make dev, make gen, make test, make deploy
```

**Why the OpenAPI contract comes first:**

- `oapi-codegen` makes the Go server interfaces, and `openapi-typescript` makes the TS types.
- Several AI coding agents can then build backend and frontends **at the same time** without drifting apart.

---

## 15. Backend (Go)

### 15.1 Libraries (latest versions checked 2026-10-27 [33])

| Need                           | Choice                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| Language                       | Go 1.27 (you have 1.27.2 installed) [26]                                                      |
| HTTP                           | `net/http` ServeMux or `go-chi/chi` v5.5.0 + `oapi-codegen` v2.8.1                            |
| Postgres                       | `jackc/pgx` v5.11.0 + `sqlc` v1.31.1                                                          |
| Migrations                     | `pressly/goose` v3.29.0                                                                       |
| Jobs                           | `riverqueue/river` v0.49.0 (jobs live in Postgres; can be queued inside the same transaction) |
| WebSocket                      | `coder/websocket` v1.8.15                                                                     |
| Web Push                       | `SherClockHolmes/webpush-go` v1.4.0                                                           |
| Paddle                         | `PaddleHQ/paddle-go-sdk/v5` v5.2.0                                                            |
| Email                          | `wneessen/go-mail` v0.8.1                                                                     |
| R2                             | `aws-sdk-go-v2/service/s3` v1.114.5                                                           |
| Meta Model API                 | `openai/openai-go/v3` v3.88.0 with base URL `https://api.meta.ai/v1`                          |
| JWT                            | `golang-jwt/jwt/v5` v5.3.1                                                                    |
| Geo                            | PostGIS in SQL; `twpayne/go-geom` v1.7.0 for polylines                                        |
| Phone / money                  | `nyaruka/phonenumbers` v1.8.1 · `bojanz/currency` v1.5.0                                      |
| Config                         | `knadh/koanf/v2` v2.4.1 (YAML + env)                                                          |
| Logs / passwords / rate limits | `log/slog` · `x/crypto/argon2` (argon2id) · `x/time/rate`                                     |

### 15.2 `config.yaml` (defaults)

```yaml
app:
    {
        demo_mode: true,
        default_country: ID,
        base_url: "https://Trackfud.duckdns.org",
    }
qualification:
    runner: { distance_m: 2000, max_moving_s: 900 } # 2 km in 15 min (7:30 /km)
    biker: { distance_m: 5000, max_moving_s: 1200 } # 5 km in 20 min (15 km/h)
    max_elapsed_factor: 2
    retry_after_s: 3600
    max_attempts_per_week: 3
    max_gap_s: 60
    checkpoint_photos: 1
courier:
    biker:
        {
            pedal_only: true,
            allowed_bike_types: [road, city, mountain, folding, cargo],
        }
dispatch:
    runner:
        {
            corridor_m: 400,
            max_to_pickup_m: 1500,
            max_trip_m: 3000,
            speed_kmh: 9,
            sizes: [S, M],
            spill: [low],
        }
    biker:
        {
            corridor_m: 800,
            max_to_pickup_m: 3000,
            max_trip_m: 7000,
            speed_kmh: 16,
            sizes: [S, M, L],
            spill: [low, medium],
        }
    circuity: 1.3
    offer_window_s: 30
    cascade_size: 3
    search_timeout_s: 240
    staff_accept_window_s: 180
    merchant_accept_window_s: 180
delivery:
    window_min_minutes: 30 # promise shown to customers
    window_max_minutes: 60
    max_carry_s: { runner: 1500, biker: 1800 }
health:
    active_min_speed_kmh: { runner: 5, biker: 10 }
    weekly_goal_minutes: 150 # WHO: 150–300 min moderate activity per week
    daily_active_cap_s: 10800 # 3 h, then no more offers today
    hydration_reminder_s: 1800
fees: # USD defaults; per-country overrides live in the database
    merchant_commission_bps: 1000 # 10%
    merchant_commission_staff_bps: 500 # 5%
    service_fee_bps: 300 # 3%
    service_fee_min_minor: 10
    service_fee_max_minor: 99
    courier_fee_bps: 500 # 5% of the delivery fee
    delivery_base_minor: 100
    delivery_per_km_minor: 35
    delivery_max_minor: 350
    withdrawal_min_minor: 500
tracking:
    max_accuracy_m: 30
    runner_max_speed_kmh: 25
    biker_max_speed_kmh: 50
    stale_after_s: 60
    raw_points_retention_days: 30
ai:
    model_agent: muse-spark-1.3
    model_cheap_ui_strings: muse-spark-1.3-contributor
    model_asr: muse-voice-transcribe-1.0
    model_segment: sam-3.1
```

### 15.3 Database tables (main columns)

```text
users(id, email, phone_e164, password_hash, name, locale, timezone, country_code, units, status, created_at)
user_roles(user_id, role)   -- customer | courier | merchant_owner | merchant_staff | admin_super | admin_ops | admin_support | admin_finance
refresh_tokens(id, user_id, token_hash, expires_at, revoked_at)

couriers(user_id, mode, status, legal_name, birth_date, nationality, address, emergency_contact,
         id_doc_type, id_number_enc, id_number_hash, id_front_key, id_back_key, selfie_key, bike, bag_liters,
         rating_bayes, rating_count, accept_rate_30d, deliveries_count, lifetime_distance_m, lifetime_moving_s,
         last_delivery_at, approved_at, approved_by)
courier_applications(id, courier_id, qualification_session_id, submitted_at, ai_brief, ai_risk, decision, decision_reason, decided_by, decided_at)
courier_sanctions(id, courier_id, kind, reason_code, note, starts_at, ends_at, created_by, created_at)

activity_sessions(id, courier_id, kind, mode, status, started_at, ended_at, goal_distance_m, goal_duration_s,
                  distance_m, moving_s, active_s, elapsed_s,
                  max_speed_mps, steps, last_pos geography(Point), last_heading, last_seen_at,
                  planned_track geography(LineString), track geography(LineString), flags jsonb)
location_points(session_id, ts, pos geography(Point), accuracy_m, speed_mps, heading, altitude_m, steps_delta, received_at)
checkpoint_photos(id, session_id, file_key, prompted_at, taken_at, ai_verdict)

merchants(id, owner_id, name, slug, phone, location geography(Point), address, pickup_note, country_code, currency,
          timezone, opening_hours, prep_minutes, status, staff_fallback_enabled, created_at)
merchant_agreements(id, merchant_id, version, text_sha256, signer_name, accepted_by, accepted_at, ip, user_agent, snapshot_key)
merchant_staff(merchant_id, user_id, role, can_deliver, on_shift, status)
menu_categories(id, merchant_id, name jsonb, sort)
menu_items(id, merchant_id, category_id, name jsonb, description jsonb, source_lang, price_minor, currency, photo_key,
           available, allergens, dietary, size_class, spill_risk, travels_well, max_hold_min, est_weight_g, ai_confidence)

orders(id, code, customer_id, merchant_id, status, currency, subtotal_minor, delivery_fee_minor, service_fee_minor,
       tip_minor, total_minor, commission_minor, courier_fee_minor, payment_method, payment_status,
       dropoff geography(Point), dropoff_address, dropoff_note, size_class, spill_risk, prep_minutes, ready_at_est, window_start, window_end,
       placed_at, accepted_at, ready_at, delivered_at, cancelled_at, cancel_reason)
order_items(order_id, menu_item_id, name_snapshot jsonb, unit_price_minor, qty, options)
order_events(id, order_id, type, from_status, to_status, actor_type, actor_id, data, created_at)
deliveries(id, order_id, type, status, courier_id, assigned_at, at_pickup_at, picked_up_at, at_dropoff_at, delivered_at,
           pickup_code, dropoff_pin, proof_photo_key, ai_proof, route_polyline, distance_m)
dispatch_offers(id, delivery_id, courier_id, rank, score, detour_m, eta_pickup_s, offered_at, expires_at, response, responded_at)
chat_messages(id, order_id, sender_id, body, lang, translations jsonb, moderation jsonb, created_at)
ratings(id, order_id, rater_id, target_type, target_id, stars, tags, comment, ai_labels, status, created_at)

ledger_accounts(id, owner_type, owner_id, kind, currency, balance_minor)   -- UNIQUE(owner_type, owner_id, kind, currency)
journal_entries(id, kind, idempotency_key UNIQUE, ref_type, ref_id, created_at)
postings(id, entry_id, account_id, amount_minor, currency)                 -- per entry + currency: SUM = 0
payments(id, provider, provider_txn_id UNIQUE, purpose, ref_id, amount_minor, currency, status, raw)
withdrawals(id, user_id, amount_minor, currency, fee_minor, method_enc, status, provider_ref, created_at)
webhook_events(id, provider, event_id UNIQUE, type, payload, processed_at)

platform_settings(key, scope, value jsonb, updated_by, updated_at)        -- scope: global | country:ID | country:GB …
push_subscriptions(id, user_id, app, endpoint UNIQUE, p256dh, auth, created_at, last_ok_at)
files(key, owner_id, bucket, purpose, content_type, size, created_at)
audit_logs(id, actor_id, action, target_type, target_id, reason, before, after, ip, created_at)
ai_calls(id, feature, model, mode, latency_ms, input_tokens, output_tokens, est_cost_usd, ok, error, prompt_version, ref_type, ref_id, created_at)
```

**Indexes:**

- GiST: `merchants.location`, `activity_sessions.last_pos` (partial: `WHERE status = 'active'`), `activity_sessions.planned_track`.
- BRIN: `location_points.ts`.
- B-tree: `orders(merchant_id, status)`, `deliveries(courier_id, status)`, `postings(account_id)`.

### 15.4 API (main endpoints, all under `/v1`)

| Area     | Endpoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth     | `POST auth/signup` · `auth/login` · `auth/refresh` · `auth/logout` · `auth/verify-email` · `auth/demo-login` (demo mode only)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Me       | `GET/PATCH me` · `POST push/subscriptions` · `POST files/presign` · `POST ws/ticket` · `GET ws` · `GET voice`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Customer | `GET merchants?lat&lng` · `GET merchants/{id}/menu?lang` · `POST quotes` · `POST orders` (Idempotency-Key) · `GET orders/{id}` · `POST orders/{id}/cancel` · `POST orders/{id}/no-courier-choice` · `GET orders/{id}/courier` · `POST orders/{id}/rating` · `GET/POST orders/{id}/messages` · `GET wallet` · `POST wallet/topups`                                                                                                                                                                                                                                                          |
| Courier  | `PUT courier/application` · `POST courier/application/submit` · `POST courier/sessions` · `POST courier/sessions/{id}/end` · `POST courier/sessions/{id}/points` (HTTP fallback) · `POST courier/sessions/{id}/checkpoints` · `POST offers/{id}/accept` · `POST offers/{id}/decline` · `POST deliveries/{id}/arrived-pickup` · `POST deliveries/{id}/arrived-dropoff` · `POST deliveries/{id}/delivered` · `GET courier/earnings` · `POST withdrawals` · `GET courier/history` · `POST courier/tracks`                                                                                     |
| Merchant | `POST merchants` · `PATCH merchants/{id}` · `GET merchant-agreement/current` · `POST merchants/{id}/agreement` · `POST merchants/{id}/menu/import` · `GET merchants/{id}/menu/import/{job}` · menu CRUD · `GET merchants/{id}/orders` · `POST orders/{id}/accept` · `POST orders/{id}/reject` · `POST orders/{id}/ready` · `POST orders/{id}/handover` · `POST merchants/{id}/staff/invite` · `PATCH merchants/{id}/staff/{userId}` · `POST merchants/{id}/submit`                                                                                                                         |
| Admin    | `GET admin/dashboard` · `GET admin/live` · `GET admin/applications` · `POST admin/applications/{id}/approve` · `POST admin/applications/{id}/reject` · `GET admin/couriers` · `GET admin/couriers/{id}/performance` · `POST admin/couriers/{id}/freeze` · `POST admin/couriers/{id}/unfreeze` · `POST admin/couriers/{id}/ban` · `POST admin/merchants/{id}/approve` · `GET admin/orders/{id}` · `POST admin/orders/{id}/refund` · `POST admin/orders/{id}/reassign` · `GET admin/withdrawals` · `GET/PUT admin/settings` · `GET admin/audit` · `GET admin/ai-calls` · `POST admin/demo/*` |
| Webhooks | `POST webhooks/paddle`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Conventions:**

- Money is `{amount_minor, currency}`, distances are meters, durations are seconds, times are ISO-8601 UTC.
- Lists use cursor pagination. Errors use RFC 9457 `application/problem+json`.
- An `Idempotency-Key` header is required on orders, top-ups and withdrawals.

### 15.5 WebSocket messages

- **Connect:** `POST /v1/ws/ticket` returns a single-use 30 s ticket. Then connect to `wss://Trackfud.duckdns.org/api/v1/ws?ticket=…`, so no long-lived token ends up in URLs or logs. Caddy strips the `/api` prefix, so Go routes stay `/v1/...`.

| Direction                  | Message                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Courier → server           | `{"type":"loc.batch","session_id":"…","points":[{"ts":…,"lat":…,"lng":…,"acc":…,"spd":…,"hdg":…,"steps":…}]}`                           |
| Client → server            | `{"type":"subscribe","topic":"order:<id>"}` (the server checks the user may see it)                                                     |
| Server → customer/merchant | `{"type":"courier.location","order_id":"…","lat":…,"lng":…,"hdg":…,"ts":…}` · `{"type":"order.status",…}` · `{"type":"chat.message",…}` |
| Server → courier           | `{"type":"offer.new",…}` · `{"type":"offer.closed",…}` · `{"type":"nudge.leave_now",…}` · `{"type":"session.stats",…}`                  |

- **Hub:** an in-memory hub inside the single Go process. If you run 2+ API instances later, add Postgres `LISTEN/NOTIFY`.
- **Reconnect:** clients back off and retry, re-subscribe, and send their GPS backlog. iOS often kills sockets in the background.

### 15.6 River jobs

`offer_expire` · `search_timeout` · `staff_timeout` · `merchant_accept_timeout` · `leave_now_nudge` · `auto_complete` · `ai_menu_import` · `ai_translate` · `ai_trust_brief` · `ai_proof_check` · `ai_feedback_labels` · `push_send` · `email_send` · `payout_process` · `session_finalize` · `gps_retention_cleanup` (daily) · `db_backup_to_r2` (nightly)

### 15.7 Security checklist

- HTTPS everywhere. PWAs, GPS, the mic and push all require it.
- **Same origin:** all 4 apps and the API sit on one hostname, so **no CORS is needed**. Turn CORS off.
- **Auth:**
    - Short JWT access tokens (15 min) kept in memory.
    - Refresh tokens are httpOnly, Secure, SameSite=Strict cookies with `Path=/api/`. Rotate them on each use and store them hashed.
    - **One session per app:** each app sends `X-TF-App: customer|courier|merchant|admin`, and the API uses a separate cookie (`tf_rt_courier` etc.). A judge can then be customer and courier in the same browser at once. Storage keys are also prefixed per app (`tf:courier:*`).
    - **RBAC** is checked in middleware for every route.
- **Rate limits:** login, signup, AI endpoints, presign.
- **Presigned uploads:** fixed content type, max size, 5-minute expiry, key prefix per user.
- **Private data:** KYC files only in the private bucket. ID numbers encrypted (AES-GCM, key from env). Every admin view of KYC is written to the audit log.
- **Webhooks:** verify the signature and store event IDs (idempotent).
- **Headers:** CSP, `X-Content-Type-Options`, `Referrer-Policy`.
- **Keys in the browser:** only the domain-restricted Google Maps key and the Paddle client token (both are made to be public).

---

## 16. Frontend (React PWAs and CMS)

### 16.1 Libraries (latest versions checked 2026-10-27 [33])

| Need                | Choice                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Build / framework   | Vite 8.3.5 + `@vitejs/plugin-react` 6.1.2 · React 19.3.1 · TypeScript 7.0.2 (only for type checks) |
| Workspace           | pnpm 10.30 (installed)                                                                             |
| PWA                 | `vite-plugin-pwa` 2.0.0 (supports Vite 8) + `workbox-window` 7.4.1                                 |
| Styling             | Tailwind CSS 4.3.3                                                                                 |
| Data fetching       | `@tanstack/react-query` 5.105 + `openapi-fetch` 0.17 + `openapi-typescript` 7.13                   |
| Routing / state     | `react-router` 8.5.0 · `zustand` 5.0.16                                                            |
| Maps                | `@vis.gl/react-google-maps` 1.10.1                                                                 |
| i18n                | `i18next` 26.5 + `react-i18next` 17.1                                                              |
| Payments            | `@paddle/paddle-js` 1.6.5                                                                          |
| Offline queue       | `dexie` 4.4.7 (IndexedDB)                                                                          |
| CMS tables / charts | `@tanstack/react-table` 9.3.1 · `recharts` 3.10.1                                                  |
| E2E tests           | `@playwright/test` 1.64.1                                                                          |

### 16.2 PWA details

- **One path per app on one hostname** (no domain needed yet): `/customer/`, `/courier/`, `/merchant/`, `/admin/`.
    - Each Vite app sets `base: '/courier/'` etc.
    - Each has its own manifest (`id`, `start_url` and `scope` = its path), icons and service worker (`/courier/sw.js`, scope `/courier/`). So each installs as a separate app and gets its own push subscription.
    - When you buy a domain, you can keep the paths or move to subdomains.
- **Service worker:**
    - Use `strategies: 'injectManifest'` with your own `sw.ts`.
    - Precache the app shell. Cache menu images with stale-while-revalidate.
    - **Never cache private API responses.**
    - Handle `push` and `notificationclick` (open the right screen).
- **Updates:** use `registerType: 'prompt'`, and show "Update ready" **only when no run or delivery is active**, so nothing reloads mid-run. Serve `sw.js`, `index.html` and manifests with `Cache-Control: no-cache`, and hashed `assets/` files as immutable (Caddyfile in §19.3).
- **iPhone:**
    - There's no install prompt, so show an "Add to Home Screen" guide screen.
    - Push only works after install [21][22]. Ask for notification permission after a tap.
- **Android:** offer install with `beforeinstallprompt`.
- **Sound:** browsers block audio until a tap. The "Go online" (courier) and "Start receiving orders" (merchant) buttons unlock audio and speech.
- **Push action buttons (Android, P1):** "Accept / Decline" on the offer notification. The push payload carries a one-time action token valid for 30 s, so the service worker can POST without the login token.
- **Mic for voice:** `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })` → an AudioWorklet downsamples to 24 kHz Int16 → binary WebSocket frames. **Pause the mic while the app is speaking**, or it hears itself.
- **QR scan (P1):** `BarcodeDetector` on Android Chrome, with a JS library fallback on iPhone. The P0 path is a 4-digit pickup code, which needs no camera.
- **Desktop testing:** Chrome DevTools → Sensors (fake location). Playwright `context.setGeolocation()`.

### 16.3 Courier "Run Mode" screen

```text
┌───────────────────────────────┐
│  🏃 RUN · ONLINE    ● REC     │
│        3.42 km                │   huge digits, dark background
│   21:08    ·   6:10 /km       │
│  ─────────────────────────    │
│  NEW ORDER  ⏱ 22 s            │   offer card (also read aloud)
│  Warung Demo · 250 m off track│
│  Rp 7.600 · deliver 2.0 km    │
│ [  DECLINE  ]  [  ACCEPT  ]   │   big buttons
│        🎤 hold to talk        │
└───────────────────────────────┘
```

---

## 17. Notifications

**Web Push (VAPID)**

- **Keys:** generate them once with webpush-go's `GenerateVAPIDKeys()` or `npx web-push generate-vapid-keys`. The public key goes in the frontend env, the private key in the server env.
- **Sending:** use `webpush.SendNotification` with:
    - `TTL`
    - `Urgency: high` for offers
    - `Topic`, so a newer update replaces an older one
- If the push service answers 404 or 410, delete that subscription.
- **iPhone:** works for Home Screen web apps [21][22].

**Email (Brevo SMTP)**

- **Settings:** host `smtp-relay.brevo.com`, port **587** (STARTTLS). The login is your Brevo SMTP login and the password is an **SMTP key**, not your account password [24].
- **Free plan:** **300 emails per day**, enough for the hackathon [24].
- **No domain yet:**
    - Verify your Gmail address as the sender for now.
    - Since February 2024, Brevo requires an authenticated domain. Without one, it **replaces your sending domain with `@brevosend.com`** [36]. That's fine for the demo, but more emails may land in spam.
    - When you buy a domain, verify it in Brevo (SPF, DKIM, DMARC) and switch the sender. DuckDNS can't hold those DNS records.
- **Demo outbox:** in demo mode, every email is also saved and shown in the CMS ("Email outbox"). Judges can then see the approval email, receipt, etc. without a real inbox.
- **Code:** templates are `html/template` files per language. Emails are sent by a River job with retries. Use Mailpit locally.

| Event                                      | Customer             | Courier             | Merchant          | Staff        | Admin       |
| ------------------------------------------ | -------------------- | ------------------- | ----------------- | ------------ | ----------- |
| Order placed                               | push + receipt email |                     | push + loud sound |              |             |
| Accepted / rejected by merchant            | push                 |                     |                   |              |             |
| Offer                                      |                      | push (high) + voice |                   |              |             |
| Courier assigned                           | push                 |                     | push              |              |             |
| "Leave now" / food ready                   |                      | push + voice        |                   |              |             |
| Staff fallback                             | push                 |                     | push              | push         |             |
| No courier                                 | push (choices)       |                     | push              |              | alert       |
| Picked up / near / delivered               | push                 |                     | push              |              |             |
| Application received / approved / rejected |                      | email + push        |                   |              | queue badge |
| Frozen / unfrozen / banned                 |                      | email + push        |                   |              |             |
| Withdrawal paid / failed                   |                      | push + email        |                   | push + email |             |
| Merchant approved / staff invite           |                      |                     | email             | email        |             |

---

## 18. File storage (R2)

| Bucket             | Contents                                                                 | Access                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Trackfud-public`  | Menu photos, dish crops, avatars                                         | For now, the bucket's `r2.dev` public URL. It is rate-limited but fine for a demo. Move to a custom domain (`cdn.<domain>`) when you have one |
| `Trackfud-private` | ID photos, selfies, checkpoint photos, proof photos, agreement snapshots | **Only** presigned GET links, 5 minutes                                                                                                       |

**Upload flow**

1. The app asks `POST /v1/files/presign {purpose, content_type, size}`.
2. It uploads straight to R2 with PUT.
3. The API records the file in `files`.
4. The phone shrinks images first (max 1600 px). That saves storage **and AI tokens**: a ~1280 px image costs about 1,300–1,500 tokens [13].

**Setup**

- In Go, use aws-sdk-go-v2 with endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` and region `auto`.
- Add a bucket CORS rule that allows PUT from `https://Trackfud.duckdns.org` (your one origin).
- If presigned uploads fail with checksum errors, set `RequestChecksumCalculation` to "when required" in the AWS config.
- To let Meta read images, send presigned GET links (10 minutes) instead of base64.

**Free tier:** 10 GB-month of storage, 1M Class A and 10M Class B operations, and **free egress** [25].

---

## 19. Podman: dev and deploy

Your machine: Podman 5.8.6, Go 1.27.2, Node 24, pnpm 10.30. There is no compose provider yet: install `podman-compose` (pipx/apt) so `podman compose` works.

### 19.1 Local dev (`deploy/compose.yaml`)

```yaml
services:
    db:
        image: docker.io/postgis/postgis:18-3.6
        environment:
            {
                POSTGRES_USER: Trackfud,
                POSTGRES_PASSWORD: Trackfud,
                POSTGRES_DB: Trackfud,
            }
        ports: ["5432:5432"]
        volumes: ["pgdata:/var/lib/postgresql"] # PostgreSQL 18+ uses this path [27]
    mailpit: # dev email inbox (Brevo in production)
        image: docker.io/axllent/mailpit:latest
        ports: ["8025:8025", "1025:1025"]
volumes:
    pgdata: {}
```

- Run the Go API on the host with `go run ./cmd/api` (fast reload) and the Vite apps with `pnpm dev`.
- **Phones need HTTPS**, and WSL2 is hard to reach from a phone.
    - Deploy to the VPS on Day 1 and test on `https://Trackfud.duckdns.org` (§19.3).
    - For a quick local check, use `cloudflared tunnel --url http://localhost:5173`. It gives a random URL that changes, so use it only for testing, never for judging.

### 19.2 Containerfile (Go)

```dockerfile
FROM docker.io/library/golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/api /app/api
COPY db/migrations /app/migrations
EXPOSE 8080
ENTRYPOINT ["/app/api"]
```

### 19.3 Production on one VPS (2 vCPU / 4 GB is enough)

- **Quadlet** files live in `~/.config/containers/systemd/`: `Trackfud.network`, `Trackfud-pgdata.volume`, `Trackfud-db.container`, `Trackfud-api.container`, `Trackfud-caddy.container`.
- Start them with `systemctl --user daemon-reload && systemctl --user start Trackfud-api`.
- Run `loginctl enable-linger <user>` so the services keep running after you log out.

```ini
# Trackfud-api.container
[Unit]
Description=Trackfud API
Requires=Trackfud-db.service
After=Trackfud-db.service

[Container]
Image=ghcr.io/<you>/Trackfud-api:latest
Network=Trackfud.network
EnvironmentFile=%h/Trackfud/.env
PublishPort=127.0.0.1:8080:8080
HealthCmd=/app/api healthcheck
AutoUpdate=registry

[Service]
Restart=always

[Install]
WantedBy=default.target
```

- **Address without a domain: DuckDNS** (free).
    1. Create `Trackfud.duckdns.org` (or any free name) and point it to the VPS IP.
    2. `duckdns.org` is on the Public Suffix List [34], so Let's Encrypt rate limits apply to **your name only**. `sslip.io` and `nip.io` are not on that list, so they share limits with everyone. Use them only as a backup.
    3. Open ports 80 and 443 on the VPS firewall.
- **Caddy** gets the HTTPS certificate automatically and serves everything from **one hostname**: 4 apps by path, and `/api/` → Go. Same origin means no CORS. WebSockets work through `reverse_proxy` as they are.

```text
Trackfud.duckdns.org {
    encode zstd gzip

    handle_path /api/* {                 # strips /api → Go sees /v1/...
        reverse_proxy Trackfud-api:8080
    }

    @bare path /customer /courier /merchant /admin
    redir @bare {path}/ 308

    handle_path /customer/* {
        root * /srv/customer
        try_files {path} /index.html
        file_server
    }
    handle_path /courier/* {
        root * /srv/courier
        try_files {path} /index.html
        file_server
    }
    handle_path /merchant/* {
        root * /srv/merchant
        try_files {path} /index.html
        file_server
    }
    handle_path /admin/* {
        root * /srv/admin
        try_files {path} /index.html
        file_server
    }
    handle {                             # judge-mode landing page
        root * /srv/landing
        try_files {path} /index.html
        file_server
    }

    @hashed path */assets/*              # Vite's hashed files never change
    header @hashed Cache-Control "public, max-age=31536000, immutable"
    @fresh not path */assets/*           # sw.js, index.html, manifests, deep links
    header @fresh Cache-Control "no-cache"
}
```

- Rootless Podman can't bind ports 80/443 by default. Set `net.ipv4.ip_unprivileged_port_start=80`, or run Caddy on the host.
- **When you buy a domain:**
    1. Add it to the Caddyfile, the Google key referrers and the Paddle default payment link, and verify it in Brevo.
    2. An address change means **PWAs must be installed again and push re-subscribed**, because both belong to the old address. So switch **by Mon Nov 2 at the latest**, before the final phone tests. Otherwise stay on DuckDNS for judging.
- **Secrets:** use `podman secret create` or a `.env` file with `chmod 600`. Never commit them.
- **Backups:** nightly `pg_dump` to R2. **Uptime:** a free monitor that checks `/healthz` during judging.

### 19.4 Environment variables

```text
DATABASE_URL  DEMO_MODE  APP_BASE_URL=https://Trackfud.duckdns.org  JWT_SIGNING_KEY  PII_ENCRYPTION_KEY
META_MODEL_API_KEY
GOOGLE_MAPS_SERVER_KEY  VITE_GOOGLE_MAPS_BROWSER_KEY  VITE_GOOGLE_MAP_ID
PADDLE_ENV=sandbox  PADDLE_API_KEY  PADDLE_WEBHOOK_SECRET  VITE_PADDLE_CLIENT_TOKEN
BREVO_SMTP_HOST=smtp-relay.brevo.com  BREVO_SMTP_PORT=587  BREVO_SMTP_LOGIN  BREVO_SMTP_KEY  MAIL_FROM
R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_PUBLIC_BUCKET  R2_PRIVATE_BUCKET  R2_PUBLIC_BASE_URL
VAPID_PUBLIC_KEY  VAPID_PRIVATE_KEY  VAPID_SUBJECT=mailto:<your Gmail for now>
```

---

## 20. Demo plan

### 20.1 Demo cities (fictional restaurants only, no real brands)

| City                                                               | Why                                                         | Settings                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------- |
| **Jakarta: GBK Senayan + the Sudirman–Thamrin Car Free Day route** | Real running hotspot, your home city, real footage possible | IDR, km, Bahasa Indonesia + English |
| **London: Hyde Park**                                              | Shows "global": another currency, **miles**, English        | GBP, miles                          |

### 20.2 Simulator (`backend/cmd/simulator`)

- **Bot couriers** (runners and bikers) "run" real tracks (GPX/GeoJSON) at realistic speed with GPS noise.
    - They accept offers with some probability, turn toward restaurants, deliver, and keep running.
    - Speed-up ×1 / ×3 / ×10 for the video.
- **Bot restaurants** accept orders and press "Ready" after the (scaled) prep time.
- **CMS "Demo controls":** start or stop bots, choose the speed, **force "no courier"** (to show staff fallback), and reset the demo data.
- **Judge mode:**
    - A landing page at `https://Trackfud.duckdns.org/` with one-click logins: "I'm a customer / runner / restaurant / admin". Thanks to per-app sessions, a judge can open all 4 in one browser.
    - In the courier app, **"Demo: replay a run"** feeds a recorded track, so a judge at home can feel like a runner and accept an offer by voice. It is clearly labeled as demo.
- **Reliability:**
    - Cache the AI results for the demo inputs (sample menu photos, sample applications). If a live call fails, show the cached result with a "cached" label.
    - Add a health page and keep the simulator running Nov 4–9.

### 20.3 Video (about 3 minutes; check the rules)

| Time      | Shot                                                                                                                                                                                 | Point          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 0:00–0:12 | **Real footage:** a runner at GBK, phone on the arm. Voice: "New order, 250 m off your track, Rp 7.600. Accept?" → "Ambil!"                                                          | Hook           |
| 0:12–0:30 | Problem: 31% of adults don't move enough (WHO), runners earn nothing, and delivery apps take 15–30% from restaurants. "What if your lunch order helped someone get healthy?"         | Impact         |
| 0:30–0:55 | Merchant Snap-a-Menu: photo → menu in 5 languages + dish crops + "runner-safe" labels                                                                                                | Meta AI        |
| 0:55–1:35 | Customer orders → merchant accepts (12 min) → map shows the **track corridor** and the chosen runner → runner keeps running → "turn now" → pickup code                               | Core + tech    |
| 1:35–2:00 | Customer live map: runner approaching, profile (1,240 km lifetime, ★4.9). The customer taps "Send a cheer" and the runner hears it. Translated chat: "Saya di depan" ↔ "I'm outside" | Live tracking  |
| 2:00–2:15 | Delivered with PIN → customer impact card ("You powered 2.4 km") → runner's "Earned & moved" summary (5.2 km · 31 active min · Rp 15.200) + weekly WHO ring 142/150 → withdraw       | Health + money |
| 2:15–2:30 | No runner nearby → staff fallback → staff earns the fee                                                                                                                              | Fallback       |
| 2:30–2:45 | Admin: the Trust Brief flags a 34 km/h segment ("probably a motorbike") → reject; freeze another courier; performance page                                                           | Meta AI + CMS  |
| 2:45–3:00 | Architecture + "AI under the hood" panel (models, latency, cost) + "Get paid for the kilometers you already run."                                                                    | Close          |

**Filming tips**

- Film one real delivery: you or a friend run with an armband, a friend orders as the customer, and you record both phone screens at the same time (Android and iPhone both have built-in screen recording).
- If you film at a real restaurant, ask permission first.

---

## 21. 9-day schedule

**The golden path, which must never break:**

1. A customer places an order.
2. The merchant accepts.
3. A runner on a nearby track gets the offer and accepts **by voice**.
4. The runner keeps running, picks up and delivers with a PIN.
5. The customer watches the live map with the courier's profile, then rates.
6. The courier's earnings and stats update, and they withdraw.
7. Admin sees everything and can freeze.

The sign-up path also matters: fitness test → Trust Brief → approve.

| Day | Date (WIB)             | Build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Done when                                                                                                                                   |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Tue Oct 27** (today) | **Accounts and keys:** Meta Model API, Google Cloud (Maps JS, Places, Routes, Geocoding, Map ID, 2 restricted keys, budget alert), Paddle sandbox (API key, client token, webhook, **default payment link** = your DuckDNS URL; sandbox needs no domain approval [35]), Brevo (SMTP key, Gmail sender for now), R2 (2 buckets, token, CORS, `r2.dev` public URL), VAPID keys, **DuckDNS name → VPS IP**. **Scaffold:** monorepo, Podman DB, Go skeleton (config, logs, health, migrations, auth), OpenAPI v0, 4 Vite apps with PWA (one path each), shared packages. **Deploy** to the VPS with Quadlet + Caddy. **Measure** Muse Spark and Voice Transcribe speed with a tiny Go script. | The courier PWA installs on your phone from `https://Trackfud.duckdns.org/courier/` and gets a test push; Go gets an answer from Muse Spark |
| 2   | Wed Oct 28             | Merchant sign-up (profile, **lat/lng pin**, hours, agreement e-sign, menu CRUD) + admin merchant approval. Customer: location, list, menu, cart, quote, **wallet checkout**, status page. Order state machine + events + River timeouts. **Ledger** + settlement + refunds, with tests.                                                                                                                                                                                                                                                                                                                                                                                                   | A wallet order is placed and accepted, and the ledger tests pass                                                                            |
| 3   | Thu Oct 29             | Courier sign-up + documents (R2). **GPS sessions** (watchPosition, Wake Lock, IndexedDB buffer, WS ingest, server stats). **Fitness test** against config + anti-cheat rules. CMS applications + approve/reject + **Brevo email + push**. Web Push in all apps.                                                                                                                                                                                                                                                                                                                                                                                                                           | You do the 2 km test (or walk it with lower config values), submit, approve in the CMS, and see the email in the outbox + get the push      |
| 4   | Fri Oct 30             | **Dispatch engine** (PostGIS, scoring, cascade, atomic accept, timeouts) + offer UI + "leave now". Pickup code, PIN/photo delivery, settlement. **WS hub + live maps** (customer, courier, merchant, admin) + Routes API (WALK/BICYCLE + beta warning).                                                                                                                                                                                                                                                                                                                                                                                                                                   | The golden path works end to end with you walking outside and a second phone as the customer                                                |
| 5   | Sat Oct 31             | **Paddle sandbox:** top-up + direct pay (shared code), webhook check, idempotent ledger. **Withdrawals** (mock). **Staff fallback** (invite, on-shift, offers, staff earnings) + "no courier" choices. **Ratings** + courier profile/history + **active minutes vs the WHO goal + customer impact card**. CMS **performance + freeze/unfreeze/ban + settings**.                                                                                                                                                                                                                                                                                                                           | Every feature you asked for exists in simple form                                                                                           |
| 6   | **Sun Nov 1**          | Morning: **film real footage at Car Free Day/GBK** if the golden path is stable. **AI 1: Voice Copilot** (PCM relay → Voice Transcribe → Muse Spark tools → TTS, confirmations, spoken offers). **AI 2: Snap-a-Menu** (vision → JSON → review → translations → SAM 3.1 crops → size/spill labels into dispatch).                                                                                                                                                                                                                                                                                                                                                                          | You accept an order by voice in English **and** Indonesian; a menu photo becomes a live menu in 3+ languages                                |
| 7   | Mon Nov 2              | **AI 3: Trust Brief** (features + SAM ID crop + extraction + bike-photo check + brief) + checkpoint photo. Delivery proof check, feedback labels, translated chat + moderation. "AI under the hood" page. Weekly AI Coach report. **Simulator** + seed data (Jakarta + London) + judge logins + demo controls + email outbox. **If you buy a domain, switch to it today at the latest** (§19.3).                                                                                                                                                                                                                                                                                          | The system "lives" without humans; judge flows work from a laptop                                                                           |
| 8   | Tue Nov 3              | **Harden:** real phones (Android + iPhone installed PWAs: push, wake lock, GPS, mic, motion permission), reconnects, offline buffer. **Polish:** Run Mode, smooth map animation, empty/error/loading states, i18n pass. Security pass, backups, uptime monitor. **Backup filming slot** at GBK.                                                                                                                                                                                                                                                                                                                                                                                           | 3 clean golden-path runs in a row on real phones                                                                                            |
| 9   | Wed Nov 4 → Thu Nov 5  | **Feature freeze Nov 4, 12:00 WIB.** Edit the video. README + write-up + judge guide + diagram + screenshots. Final deploy + smoke test + demo reset. **Submit by Thu Nov 5, 07:00 WIB** (deadline 09:00 WIB). Nov 5–9: keep it running, watch logs, no risky changes.                                                                                                                                                                                                                                                                                                                                                                                                                    | Submitted, with the demo online                                                                                                             |

**How to go fast:**

- Write the OpenAPI contract on Day 1. Then let AI coding agents work in parallel: one on the Go domain packages, one per frontend app.
- Deploy every evening and test on your phone.

**Cut list** (cut from the top if you fall behind):

1. Muse Image extras
2. Ops Copilot
3. AI Run Planner
4. Scheduled orders
5. Chat voice notes (keep text chat)
6. Delivery-proof AI check (keep photo + PIN)
7. Card refunds via Paddle (keep wallet refunds)
8. QR scanning (keep the 4-digit code)
9. Offline GPS buffer (keep live sending; mark gaps)
10. London (keep Jakarta only)
11. Cheers and the AI Coach report (keep the weekly WHO ring)

**Never cut:**

- The golden path
- Fitness test + approve/reject + freeze/ban
- Live map + courier profile + rating
- Top-up + direct pay (sandbox) + withdraw
- Staff fallback (a simple version is fine)
- Voice Copilot, Snap-a-Menu, Trust Brief
- **Health core:** workout goal in dispatch, active minutes vs WHO 150 min, customer impact card, the 30–60 min promise

---

## 22. Testing

- **Unit tests (Go):**
    - Every allowed and forbidden order/delivery transition.
    - Ledger balance + idempotency (the same webhook twice → paid once).
    - Fee math and rounding per currency.
    - Dispatch filters and scoring.
    - Anti-cheat rules on recorded tracks (a real run, a car ride, a GPS-spoof track).
    - Paddle signature check.
    - AI JSON schema validation, including bad AI output.
- **Integration tests:** a real PostGIS in Podman (`make test-db`). Run migrations, seed, then run the SQL queries for real.
- **End-to-end (Playwright):** one test with **3 browser contexts** (customer, courier, merchant). `setGeolocation` moves the courier along a track, and the test checks the whole golden path. Run it on every deploy.
- **Load (P2):** 200 simulated couriers each sending a location batch every 5 s over WS. Check that the API stays under 100 ms p95 **(estimate target)**.
- **Real devices:**
    - Android Chrome: install, push, wake lock, GPS, mic.
    - iPhone Safari: Add to Home Screen, push permission, wake lock, GPS, mic, motion permission, background warning.

---

## 23. Risks and mitigations

| Risk                                                  | Impact              | Mitigation                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Too much to build in 9 days, solo                     | High                | P0 list, OpenAPI-first + parallel AI agents, simulator, cut list, freeze on Nov 4                                                                                                       |
| PWA GPS stops when the screen is off                  | High                | Wake Lock + Run Mode + gap detection; Capacitor/native after the hackathon                                                                                                              |
| iPhone push only after install                        | Medium              | Install guide; test on Day 1                                                                                                                                                            |
| Paddle rules (no physical goods, marketplace, wallet) | High (production)   | Sandbox only; payment interface; say it openly in the write-up                                                                                                                          |
| Voice latency outdoors                                | Medium              | Low effort, caching, streaming, keyword biasing; tap buttons as fallback                                                                                                                |
| AI mistakes (wrong price, false fraud flag)           | Medium              | Human review everywhere; confidence colors; AI never bans or publishes prices alone                                                                                                     |
| Unexpected Google Maps bill                           | Low/Medium          | Restricted keys, quotas, budget alert, few Routes calls                                                                                                                                 |
| Walking/cycling routes are beta                       | Low                 | Show the required warning; "Open in Google Maps" button                                                                                                                                 |
| Runner and biker safety (traffic, heat, overtraining) | Medium              | Voice-first; no countdown timers while moving; no decline penalty; daily active cap; rest-day nudges; hydration reminders; distance limits; no medical advice                           |
| Food quality on slow delivery                         | Medium              | Only "travels well" items can be delivered (AI label + merchant check); runners take S/M low-spill orders; insulated bag; max carry time 25/30 min                                      |
| Customers expect fast delivery                        | Medium              | "Workout delivery · 30–60 min" shown everywhere before paying; impact card; staff fallback keeps the window                                                                             |
| Fake GPS / cheating                                   | Medium              | Anti-cheat signals + checkpoint photos + Trust Brief + human decision                                                                                                                   |
| Legal (courier status, KYC data)                      | Medium (production) | Per-country review; private storage; deletion schedule                                                                                                                                  |
| Demo breaks during judging                            | High                | Simulator, cached AI fallbacks, uptime monitor, reset button, no deploys after submit                                                                                                   |
| No own domain (DuckDNS)                               | Medium              | DuckDNS outage → keep an `sslip.io` hostname ready as backup; emails may hit spam → demo outbox in the CMS; buying a domain later → switch by Nov 2 (PWA reinstall + push re-subscribe) |
| Meta API access                                       | Low                 | Indonesia isn't on the reported list of blocked places [3]; confirm in your dashboard on Day 1                                                                                          |

---

## 24. Decisions for you

**Answered on 2026-10-27:**

- Purpose: **health first.** Customers order to help people get active and earn. Slower than vehicle couriers on purpose (§2.1).
- Track: **Indie**.
- Hosting: **VPS now, domain later** → DuckDNS + one hostname with 4 app paths (§19.3).
- Bikes: **pedal bikes only** (§8.1).
- Fitness test: **short and standard**: runner 2 km in 15 min, biker 5 km in 20 min, moving time (§2, §8.2).

**Still open:**

1. **Delivery window:** promise customers 30–60 min, OK?
2. **Name:** keep "Trackfud"?
3. **Demo cities:** Jakarta (GBK + Car Free Day) + London (miles, GBP)?
4. **Fees:** restaurant 10% (5% staff), customer 3%, courier keeps 95%, OK?
5. **Staff transport:** staff deliver on foot, by bike, or the restaurant's own way (merchant decides). OK?
6. **Domain:** buy one before Mon Nov 2, or stay on DuckDNS for judging?
7. **Filming:** who can play the customer and the restaurant staff for the real footage?
8. **After Nov 9:** as a business, this is a 3-sided marketplace (restaurants, couriers, customers). It needs local recruiting and a marketplace payment partner. That's different from the low-risk, no-outreach business you said you wanted earlier. It's fine for the hackathon; decide after the results.

**Decisions I made for you** (tell me to change any):

- 3 separate PWAs + a desktop CMS, each on its own path of one hostname.
- OpenAPI-first.
- One Go binary with River jobs; PostGIS for all geo work.
- Email + password login + demo logins.
- Paddle sandbox + mock payouts.
- Standard mode for all user data.
- Fictional demo restaurants.

---

## 25. Sources

**Hackathon**

1. Meta hackathon page: https://dev.meta.ai/events/global-hackathon
2. Cerebral Valley event page: https://cerebralvalley.ai/e/meta-ai-developer-hackathon
3. ReconScribe guide (third-party; deadline in UTC, credits, prizes, team size, API country limits): https://reconscribe.com/meta-global-ai-developer-hackathon-2026/

**Meta Model API docs** 4. Overview (base URL, OpenAI compatibility): https://dev.meta.ai/docs/ 5. Models: https://dev.meta.ai/docs/models 6. Pricing and rate limits, Contributor mode: https://dev.meta.ai/docs/pricing-rate-limits 7. Speech to text (25 languages, endpointing, keywords): https://dev.meta.ai/docs/speech-to-text 8. Realtime voice API reference: https://dev.meta.ai/docs/api-reference/voice/realtime 9. SAM 3.1 media segmentation: https://dev.meta.ai/docs/media-segmentation 10. Reading SAM output (boxes, base85 masks): https://dev.meta.ai/docs/sam/reading-segmentation 11. Tool calling (`tool_choice` auto only, strict, parallel calls): https://dev.meta.ai/docs/tool-calling 12. Structured output: https://dev.meta.ai/docs/structured-output 13. Image understanding (50 images, token cost): https://dev.meta.ai/docs/image-understanding 14. Authentication (keep keys on the server): https://dev.meta.ai/docs/authentication 15. Reasoning effort: https://dev.meta.ai/docs/reasoning 16. Muse Glimmer (30B, Apache 2.0): https://dev.meta.ai/docs/muse-glimmer

**Payments, maps, PWA, services** 17. Paddle, what you can't sell: https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle 18. Google Routes API travel modes (WALK/BICYCLE beta + required warning): https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteTravelMode 19. Google Maps Platform pricing overview: https://developers.google.com/maps/billing/overview 20. Woosmap, 2026 Google Maps pricing breakdown (third-party; free caps per SKU): https://www.woosmap.com/blog/google-maps-api-pricing-breakdown 21. MagicBell, PWA iOS limitations 2026 (push after install, Wake Lock iOS 18.4, no background): https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide 22. MobiLoud, PWAs on iOS 2026: https://www.mobiloud.com/blog/progressive-web-apps-ios/ 23. Capawesome, why iOS stops background location: https://capawesome.io/blog/why-ios-stops-background-location-updates/ 24. Brevo free SMTP (300 emails/day): https://www.brevo.com/free-smtp-server/ 25. Filebase, R2 pricing 2026 (third-party; confirm at https://developers.cloudflare.com/r2/pricing/): https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/

**Tools** 26. Go 1.27 release notes: https://go.dev/doc/go1.27 27. docker-postgis (18-3.6 tag, new volume path): https://github.com/postgis/docker-postgis

**Competitor commissions** 28. DoorDash fees for restaurants (Sauce): https://www.getsauce.com/post/doordash-fees-for-restaurants-2 29. Uber Eats fees for restaurants (Sauce): https://www.getsauce.com/post/uber-eats-fees-for-restaurants-2 30. Duck-hub, commission rates 2026 (says Uber Eats rose to 20–30%; not confirmed by Uber): https://www.duck-hub.com/blog/food-delivery-commission-rates 31. Kontan, GoFood 20% + Rp 1.000, ShopeeFood 20% (older report): https://industri.kontan.co.id/news/kisruh-potongan-ke-umkm-oleh-gofood-kemenkop-dan-umkm-bakal-atur-persentase-komisi 32. Majoo, ShopeeFood merchant costs 2026 (~15%): https://majoo.id/solusi/detail/biaya-daftar-shopee-food-untuk-merchant-2026-ini-rincian-dan-cara-gabungnya

**Versions** 33. Library versions: npm registry and Go module proxy, checked 2026-10-27

**Hosting without a domain** 34. Public Suffix List (`duckdns.org` is listed; `sslip.io` and `nip.io` are not; checked 2026-10-27): https://publicsuffix.org/list/public_suffix_list.dat 35. Paddle sandbox (default payment link can be any URL; no domain approval): https://developer.paddle.com/build/tools/sandbox 36. Captain DNS, Brevo transactional email guide (third-party; domain authentication required since Feb 2024; unauthenticated → `@brevosend.com`): https://www.captaindns.com/en/blog/brevo-transactional-email-technical-guide

**Health** 37. WHO news, 26 June 2024: "Nearly 1.8 billion adults at risk of disease from not doing enough physical activity" (31% of adults, 2022 data): https://www.who.int/news/item/26-06-2024-nearly-1.8-billion-adults-at-risk-of-disease-from-not-doing-enough-physical-activity 38. WHO physical activity fact sheet (adults: 150–300 min moderate or 75–150 min vigorous activity per week): https://www.who.int/europe/news-room/fact-sheets/item/physical-activity
