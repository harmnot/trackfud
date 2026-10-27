---
name: db-migrate
description: Add a Trackfud Postgres migration plus its sqlc queries — goose file, queries, generated code, integration check.
---

# DB Migrate

Use when backend work needs a schema or query change. Context:
`docs/backend-architecture.md` §§2–4, `docs/app-context.md` §3 (domain rules
are fixed — no new actors, fees, or statuses without user approval).

1. Inspect `backend/db/migrations/` for numbering/conventions and
   `backend/db/queries/` for sqlc style before writing.
2. Write one `goose` migration: forward + rollback, PostGIS types as
   `geography(Point/LineString, 4326)`, required indexes (GiST for geo and
   `last_pos` partial index, BRIN for `location_points.ts`, B-tree for
   foreign-key/status lookups). No inline SQL outside `db/queries/`.
3. Add/extend the `sqlc` query, regenerate, and keep money as integer minor
   units + currency (never floats).
4. Verify: `make test-db` (migrate + seed + query check), then the `go-verify`
   skill loop for touched packages.
5. Report migration + query names, regen output, and test results.
