# Frontend Tech Stack — Trackfud

> Pinned choices from `AGENTS.md` §16.1 (checked 2026-10-27). One stack for all
> three PWAs so code and agents stay interchangeable.

| Need                   | Choice                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Build / framework      | Vite 8.3.5 + `@vitejs/plugin-react` 6.1.2 · React 19.3.1 · TypeScript 7.0.2 (type checks)                                    |
| Workspace              | pnpm 10.30                                                                                                                   |
| PWA                    | `vite-plugin-pwa` 2.0.0 + `workbox-window` 7.4.1, `injectManifest` with own `sw.ts`                                          |
| Styling                | Tailwind CSS 4.3.3 + `styles/tokens.css` custom properties                                                                   |
| Data fetching          | `@tanstack/react-query` 5.105 + `openapi-fetch` 0.17 + `openapi-typescript` 7.13 (generated from `backend/api/openapi.yaml`) |
| Routing / state        | `react-router` 8.5.0 · `zustand` 5.0.16 (UI/session state only)                                                              |
| Maps                   | `@vis.gl/react-google-maps` 1.10.1 (domain-restricted browser key)                                                           |
| i18n                   | `i18next` 26.5 + `react-i18next` 17.1 (`en.json`, `id.json`, +1 language)                                                    |
| Payments               | `@paddle/paddle-js` 1.6.5 (overlay only, never card data)                                                                    |
| Offline queue          | `dexie` 4.4.7 (IndexedDB)                                                                                                    |
| CMS-only tables/charts | `@tanstack/react-table` 9.3.1 · `recharts` 3.10.1 (not needed in the 3 PWAs)                                                 |
| E2E tests              | `@playwright/test` 1.64.1 (3 browser contexts for golden path)                                                               |

## Per-app serving (one hostname, §19.3)

- Paths: `/customer/`, `/courier/`, `/merchant/` (+ `/admin/`, `/` landing — CMS/landing out of scope here).
- Each app: own Vite `base`, own manifest (`id`/`start_url`/`scope` = its path),
  own service worker (`sw.js`, scope = its path), own push subscription.
- Cache policy: hashed `assets/` immutable; `sw.js`, `index.html`, manifests `no-cache`.
- Show "Update ready" prompt only when no run/delivery is active.
