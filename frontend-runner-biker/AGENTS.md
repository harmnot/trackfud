# Frontend-Runner-Biker Agent — Trackfud Courier PWA

> You own `frontend-runner-biker/` only. Do not edit other apps, backend, or `AGENTS.md`.
> Read first: `docs/app-context.md`, `docs/frontend-architecture.md`,
> `docs/frontend-tech-stack.md`, `docs/code-style-frontend.md`.
> API types come from `backend/api/openapi.yaml` (generated client).
> Feature source: `AGENTS.md` §4.2. Serve path: `/courier/`.

## Scope

Courier PWA for three actors in one app: **runner**, **biker (pedal only)**,
**merchant staff mode** (fallback deliveries, no fitness test). Workout-first:
big Run Mode screen, voice-first controls, screen stays on (Wake Lock), GPS
always streaming, offline buffer with real timestamps.

## Milestones (in order)

### R1 — Onboarding + pre-run + fitness test

- Signup; runner/biker choice; pre-run checklist (GPS ✓, Wake Lock ✓, mic ✓,
  notifications ✓, iOS motion permission); "Add to Home Screen" guide (iPhone);
  audio unlock on "Go online" tap.
- Fitness-test recorder: `watchPosition` GPS, moving-time computation, 1
  checkpoint photo prompt, IndexedDB autosave of draft application; personal
  details + ID/selfie (+ bike photo) upload via presigned R2 PUT (shrunk ≤1600 px);
  submit → status screen (draft/pending/approved/rejected + reason).
- Done when: full signup → 2 km test (or lowered config values) → submit works
  outdoors on a real phone; draft survives app restart.

### R2 — Run Mode + offers + delivery (the golden path)

- Session start (run/ride, goal distance-or-time, free/saved-track/AI-track
  placeholder); huge Run Mode stats (distance, time, pace, active min, earnings);
  WS `loc.batch` streaming + HTTP fallback + IndexedDB offline buffer (real `ts`,
  UUID per point); reconnect + backlog resend; gap marking.
- Offer card (sound + vibration + voice + push, 30 s timer, track-fit info:
  "250 m off track, adds 2.4 km, Rp 7.600") with big ACCEPT/DECLINE; "head to
  restaurant now" nudge; navigation route + "Open in Google Maps".
- Pickup code/QR confirm; arrival buttons; customer-PIN/photo completion;
  earnings wallet + anytime withdraw (mock); session summary ("Earned & moved")
    - lifetime stats + WHO 150-min ring; daily-cap/rest/hydration nudges.
- Done when: offer → accept → keep running → pickup code → PIN delivered →
  earnings update, all while moving outside; update prompt never fires mid-run.

### R3 — Voice Copilot + staff mode + health extras

- Hold-to-talk: mic → AudioWorklet 24 kHz Int16 PCM → voice WS (pause mic while
  speaking); commands "accept", "how far?", "I'm 2 min away" (EN + ID);
  spoken offers + cheers read aloud; per-km/mi pace cues; chat with
  auto-translation + voice notes (P1, text first).
- Staff mode: invited-login, no fitness test, fallback offers only, tracked
  delivery on foot/bike/own way, staff earnings.
- Saved tracks (draw/save), step-cadence display (P1 signal), ratings received
  (tags, names hidden), GPX export (P2 — cut first).
- Done when: hands-free voice accept works in EN + ID outdoors; staff delivery
  completes end to end.

## Guardrails

- Style doc is binding: no `any`, object params at 3+ args, guard clauses,
  typed errors, logger (no `console.log`), tokens.css only, semantic HTML+ARIA.
- Never cache private API responses. Suppress "Update ready" during active
  run/delivery. Mark GPS gaps honestly — never interpolate fake movement.
- Safety copy: no rush timers while moving, no decline penalty, 30–60 min
  promise visible, no medical advice.
- Verify outdoors on real Android + iPhone (install, push, Wake Lock, GPS, mic)
  before reporting done.

## Skills & subagents

- Skills (in `.agents/skills/`): `pwa-verify` for `/courier/` when a milestone
  is done; `i18n-string` for copy changes; `api-sync` when the contract changes.
- Parallel work with other tracks: see `docs/subagents.md`.
