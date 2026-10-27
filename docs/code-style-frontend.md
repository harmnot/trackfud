# Code Style Guidelines — Frontend (React PWA, TypeScript)

> Applies to `frontend-customer/`, `frontend-runner-biker/`, `frontend-merchant/`.
> Product context: `docs/app-context.md`. Architecture: `docs/frontend-architecture.md`.

## TypeScript

- Always safe types. Never use `any`. Prefer specific types or generics.
  Use `unknown` + narrowing at boundaries (API payloads, WS messages, IDB rows).
- No `var`. Use `let`/`const`.
- Strict equality only (`===`/`!==`).
- No `for` loops. Use `for...of` or `map`/`filter`/`reduce`.
- No `null`/`undefined` as ad-hoc sentinels. Model optional values explicitly
  (e.g. a small `Option<T>`/`Maybe<T>` or `{ status: 'missing' | 'ready', value?: T }`).
- `async/await` for async code. No raw `.then()` chains, no callbacks, no `eval`/`Function`.

## Functions

- Max 2 positional parameters; 3+ means one object parameter
  (e.g. `createOrder({ merchantId, items, address })`).
- Single responsibility, no hidden side effects. Side effects (fetch, IDB,
  geolocation, audio) live in `hooks/` or `lib/`, never inside pure helpers.
- Early returns and guard clauses. No deeply nested `if/else` blocks.
  Prefer flat control flow over nested matching.
- Reusable pure helpers over copy-paste. Name by domain
  (`formatPace`, `quoteTotal`, `isOfferExpired`), not by UI.

## Errors and logging

- Safe error handling: typed error results at API/WS/IDB boundaries, user-safe
  messages in UI, technical detail to the logger. Never throw raw strings.
- No `console.log` in production code. Use the shared logger / error-reporting
  hook (`lib/logger.ts`). `console` is allowed only inside that module.
- Every `catch` either recovers (fallback UI/queue-for-retry), reports, or
  rethrows as a typed error — never silent swallowing.

## Formatting and docs

- Follow the repo ESLint + Prettier config. No unformatted or lint-failing code.
- Documentation comments on every exported function, class, module, hook, and
  component prop type: one line for what + params/returns where non-obvious.
- No magic numbers/strings. Named constants or enums (e.g. `OFFER_WINDOW_S`,
  `CorridorM.Runner`, route paths, storage keys). Design values come from
  `styles/tokens.css`, never hardcoded.

## UI, styling, accessibility

- High fidelity to the design system. No custom one-off styles that deviate.
- Follow color schemes and design tokens. No hardcoded colors, spacing, or fonts.
- No inline styles. CSS classes (design-system tokens) or styled components only.
- Semantic HTML + ARIA. No `div`/`span` used as buttons, headings, or layout
  landmarks. Keyboard navigation, focus states, contrast, readable mobile sizes.
- Reuse existing components/libraries first (`components/ui/`, shared packages).
  A new component must follow the design system and be reusable across the app.
- PWA specifics: installable manifest, versioned service worker, precached app
  shell, network-first API reads, offline queue with client UUIDs, update prompt
  (never silent breaking reloads), iPhone install guide. See
  `docs/frontend-architecture.md` §3.
