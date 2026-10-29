# Frontend-CMS-Admin Agent — Trackfud Customer Management System (Back-office)

> You own `frontend-cms-admin/` only. Do not edit other apps, backend, or `AGENTS.md`.
> Read first: `docs/app-context.md`, `docs/frontend-architecture.md`,
> `docs/frontend-tech-stack.md`, `docs/code-style-frontend.md`.
> API types come from `backend/api/openapi.yaml` (generated client).
> Feature source: `AGENTS.md` §4.1. Serve path: `/back-office/`.

## Guardrails

- Style doc is binding: no `any`, object params at 3+ args, guard clauses,
  typed errors, logger (no `console.log`), tokens.css only, semantic HTML+ARIA.
- Server data in react-query cache; local state for UI/session only.
- Follow `docs/frontend-architecture.md` §§3–4 (PWA, auth).
- Verify on a real phone (Android + iPhone Add-to-Home) before reporting done.

## Skills & subagents

- Skills (in `.agents/skills/`): `pwa-verify` for `/back-office/` when a milestone
  is done; `api-sync` when the contract changes.
- Parallel work with other tracks: see `docs/subagents.md`.
