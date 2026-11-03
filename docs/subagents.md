# Subagents — Trackfud

> How to fan work out across focused child agents. Muse Code has no
> project-local agent-definition files (custom agent types ship inside plugins
> or via ephemeral `--agents` overlays), so a "subagent" here is a spawn
> recipe: role + objective + isolation + the track file the child must read
> first. Each track's `AGENTS.md` is the persistent instruction set the child
> loads — that file plus these recipes is the full subagent config.

## When to spawn (and when not)

- Spawn when: a milestone has independent units (e.g. B1 vs B2, or C1 vs R1),
  a 9-day deadline rewards parallel tracks, or a long verification
  (Playwright golden path, real-device passes) should run beside implementation.
- Stay inline when: the change is one file, one milestone unit, or a
  contract edit (`api/openapi.yaml`) that all tracks must follow — contract
  edits stay in the parent so drift is caught immediately (then run the
  `api-sync` skill).

## Spawn recipes (one child per recipe)

| Child            | Reads first                                                         | Objective pattern                                                                                            | Isolation                                                                 |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Backend builder  | `backend/AGENTS.md` + `docs/backend-architecture.md`                | "Implement backend milestone <B0–B6 unit> per backend/AGENTS.md; finish with the go-verify skill"            | shared until files overlap; `true` when two backend children run together |
| Customer builder | `frontend-customer/AGENTS.md` + `docs/frontend-architecture.md`     | "Implement <C1–C3 unit> per frontend-customer/AGENTS.md; finish with the pwa-verify skill for /customer/"    | shared (own folder)                                                       |
| Courier builder  | `frontend-runner-biker/AGENTS.md` + `docs/frontend-architecture.md` | "Implement <R1–R3 unit> per frontend-runner-biker/AGENTS.md; finish with the pwa-verify skill for /courier/" | shared (own folder)                                                       |
| Merchant builder | `frontend-merchant/AGENTS.md` + `docs/frontend-architecture.md`     | "Implement <M1–M3 unit> per frontend-merchant/AGENTS.md; finish with the pwa-verify skill for /merchant/"    | shared (own folder)                                                       |
| Contract keeper  | `docs/backend-architecture.md` + `docs/frontend-architecture.md`    | "Apply the openapi.yaml diff and resync both sides" — run the `api-sync` skill                               | shared, parent-supervised                                                 |
| Verifier         | track AGENTS.md + `docs/app-context.md`                             | "Verify milestone <id> done-criteria only; report pass/fail with evidence, no fixes"                         | shared, read-only                                                         |

Rules for every child: one milestone unit per spawn; the child's track
`AGENTS.md` outranks general guidance; conflicting domain facts resolve via
`docs/app-context.md`; verification uses the track's real tests/checks, and
anything not exercised is reported unverified, never passing.

## Skill routing (all tracks)

- Backend code changed → `go-verify`. Schema/query changed → `db-migrate`.
  Async work → `river-job`. Contract changed → `api-sync` (parent runs it).
- Frontend copy changed → `i18n-string`. Any PWA milestone done → `pwa-verify`
  for that app's path.
- Multi-track feature/fix (2+ of backend/customer/courier/merchant/cms) →
  `cross-track-sync` (parent runs it; it fans out via the recipes above and
  reconciles `docs/milestone-checklist.md`).
