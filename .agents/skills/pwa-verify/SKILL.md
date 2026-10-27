---
name: pwa-verify
description: Verify a Trackfud PWA install, service worker, offline queue, push, and real-phone behavior.
---

# PWA Verify

Use after frontend changes to `frontend-customer/`, `frontend-runner-biker/`,
or `frontend-merchant/`, per app (pass the app path). Context:
`docs/frontend-architecture.md` §§3–4, `docs/code-style-frontend.md`.

1. Installability: manifest has per-app `id`/`start_url`/`scope`, maskable
   icons, theme color, `display: standalone`; service worker registered with
   versioned caches and old-cache cleanup on `activate`; served over HTTPS.
2. Caching: app shell precached; network-first API reads with cached fallback;
   cache-first static assets/food images; **no private API responses cached**.
   "Update ready" prompt present — and suppressed mid-run/mid-delivery/mid-order.
3. Offline: airplane-mode pass — queued writes get client UUIDs
   (`crypto.randomUUID()`), persist in IndexedDB, sync on `online`/focus;
   UI shows online/offline + pending-sync states.
4. Push: subscription per app install; notification opens the right screen;
   permission asked after a tap; iPhone Add-to-Home guide shown.
5. Real phones (Android Chrome + iPhone Safari): install, push, GPS, mic,
   Wake Lock (courier), loud order alert (merchant), no silent breaking reload.
6. Report per-app pass/fail with observed evidence; mark anything not
   exercised on a real device as unverified, never as passing.
