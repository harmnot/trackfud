# Frontend Architecture — Trackfud

> Frontend system design for AI assistants. Product context: `docs/app-context.md`.
> Technology choices: `docs/frontend-tech-stack.md`. Backend design: `docs/backend-architecture.md`.
> Style rules: `docs/code-style-frontend.md`.
> Applies to `frontend-customer/`, `frontend-runner-biker/`, `frontend-merchant/`
> ( Admin CMS `/admin/` and landing page are out of scope of these three tracks).

## 1. Overview

React PWA per actor (Customer, Courier runner/biker/staff-mode, Merchant).
One hostname, one path per app (`/customer/`, `/courier/`, `/merchant/`).
Same origin as the API (`/api/` → Go), so **no CORS**. All apps are installable,
work offline-first for their critical flows, and share typed API contracts
generated from `backend/api/openapi.yaml`.

## 2. Folder layout

Each frontend app follows this layout (adjusted to its own features):

```
src/
  main.tsx              # app bootstrap, service worker registration
  app/                  # router, route table, layouts, auth context, i18n provider
  features/
    <domain>/           # mirrors backend domains (e.g. orders, offers, sessions, menu, wallet)
      components/
      hooks/
      api.ts            # typed calls to /api/v1
      types.ts
  components/ui/        # shared UI: Button, Input, Card, Modal, Chart primitives (SVG)
  lib/
    api-client.ts       # fetch wrapper: auth header, refresh on 401, retries, AbortController
    idb.ts              # IndexedDB wrapper
    sync-queue.ts       # offline write queue
    i18n.ts             # t() helper + Intl formatters
    router.ts           # History API router
  styles/
    tokens.css          # CSS custom properties (colors, spacing, type scale, dark mode)
    base.css
  locales/
    en.json
    id.json
public/
  manifest.webmanifest
  sw.js                 # hand-written service worker
  icons/                # incl. maskable icons
```

Shared cross-app packages (when the `frontend/` workspace exists):
`packages/api-client` (generated types + fetch client), `packages/ui`,
`packages/maps` (LiveMap, RouteLine, PinPicker, CourierMarker), `packages/i18n`,
`packages/pwa` (push subscribe, wake lock, GPS hook, offline queue, mic → PCM).

## 3. PWA and offline rules

- Must pass installability: valid manifest (`name: "Trackfud"`,
  per-app display name, icons incl. maskable, theme color,
  `display: standalone`, start URL = app path) and a registered service worker,
  served over HTTPS.
- Service worker is plain JavaScript with versioned cache names; old caches are
  deleted on `activate`.
- Caching: precache the app shell (build output list injected at build time);
  network-first for API reads with cached fallback; cache-first for static
  assets and food images. **Never cache private API responses.**
- **Offline-first logging:** courier GPS points (IndexedDB buffer with real
  timestamps), merchant edits, and queued writes are saved locally and synced
  when back online (Background Sync where supported, retry on `online` event
  and app focus otherwise). Each queued item carries a client-generated UUID
  (`crypto.randomUUID()`) so the backend can deduplicate (idempotent create).
- Show clear online/offline and "pending sync" states in the UI.
- Prompt users to update when a new service worker version is available
  (no silent breaking reloads); suppress the prompt mid-run/mid-delivery.
- **Web Push** is the primary reminder channel. On iOS/iPadOS, web push only
  works after the user adds the PWA to the home screen (iOS 16.4+), so show an
  install guide for iPhone users. Notification permission is requested after a
  user tap. Push action buttons (Android, P1): Accept/Decline via one-time
  action token (30 s).
- Audio/speech unlock on explicit tap ("Go online" / "Start receiving orders");
  browsers block audio before interaction. Pause mic while the app is speaking.

## 4. App rules

- Auth: access token in memory; refresh token in an `HttpOnly`, `Secure`,
  `SameSite` cookie set by the API; never store tokens in `localStorage`.
  Per-app session: send `X-TB-App: customer|courier|merchant`, separate cookie
  per app; storage keys prefixed per app (`tb:courier:*`). Enables judge
  multi-login in one browser. WS connects via single-use 30 s `ws/ticket`.
- Payments open Paddle Checkout (Paddle.js overlay); never handle card data in
  the app. Money renders via `Intl.NumberFormat` from integer minor units.
- Server data lives in the `useApi` (react-query) cache; React state/Context
  only for UI and session state.
- Maps: `@vis.gl/react-google-maps`, domain-restricted key. Desktop testing via
  DevTools Sensors / Playwright `setGeolocation`. "Open in Google Maps" fallback
  for walking/cycling beta routes.
- Performance budget: fast first load on mid-range Android phones over 4G —
  code-split routes, lazy-load charts, keep the initial JS bundle small.
- Accessibility: semantic HTML, keyboard navigation, sufficient contrast,
  readable font sizes on mobile. Large touch targets (sweaty hands, gloves).
- Branding: colors and type from the Trackfud brand (see
  `docs/app-context.md`), defined once in `styles/tokens.css`.
- Units/time: meters/seconds from API → km/mi + pace per locale; UTC ISO times
  → user locale; restaurant hours in restaurant timezone.
