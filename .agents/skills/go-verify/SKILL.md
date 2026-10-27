---
name: go-verify
description: Run the Trackfud backend verify loop — build, vet, unit tests, and PostGIS integration tests.
---

# Go Verify

Run this after any `backend/` change, and before reporting backend work done.
Context: `docs/backend-architecture.md` §5, `docs/code-style-backend.md`,
milestone guardrails in `backend/AGENTS.md`.

1. From `backend/`, run in order:
    - `go build ./...`
    - `go vet ./...`
    - `go test` on every touched domain package (full `go test ./...` when time allows)
    - Integration against real PostGIS: `make test-db` (migrations, seed, SQL checks)
2. A failing test that covers changed code is the requirement — fix the code,
   never delete, skip, or narrow the test.
3. `gofmt` clean on edited files.
4. Report the exact commands run with pass/fail, and name anything left red or
   unrun instead of claiming success.
