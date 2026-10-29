---
name: seed-test-data
description: Seed and log in with the canonical Trackfud local test accounts.
---

# Seed Test Data

Use when testing needs a cms admin (back-ffoice), courier, merchant, or customer account, or when login
with a test account fails after a database reset.

## Canonical accounts (password for all three: `trackfud123`)

| Role      | Email                   | Ready to use because                             |
| --------  | ----------------------- | ------------------------------------------------ |
| Courier   | runnerbiker@example.com | `couriers` row is `approved`, mode `runner`      |
| Merchant  | merchant@example.com    | owns approved store `Warung Test Rasa` + 3 items |
| Customer  | customer@example.com    | `customer_wallet` funded with Rp 200.000         |
| CMS Admin | admin@example.com       |                                                  |

Never invent other test emails. Never use these credentials outside local dev.
make sure data should be realistic enough to test the app based on the canonical accounts and features. For example, the merchant account has a store with three items, so you can test ordering and checkout flows.

## How seeding works

`SeedTestAccounts` in `backend/internal/app/seed.go` runs on every backend boot
while `TF_DEMO_MODE=true` (set in `compose.yaml`). It is idempotent:
re-running resets all three passwords to `trackfud123` and repairs roles, the
courier/merchant/menu rows, and the customer wallet. To reseed, restart the
backend container — no manual SQL needed.

## Verify login (backend on :8081 via compose)

```sh
curl -s localhost:8081/v1/auth/login -H 'Content-Type: application/json' \
  -H 'X-TF-App: customer' \
  -d '{"email":"customer@example.com","password":"trackfud123"}'
```

Swap `X-TF-App` to `courier` / `merchant` and the email for the other two.
A 200 with tokens means the account is healthy. A 401 means the seed did not
run: check the backend logs for a `seed` warning and confirm `TF_DEMO_MODE`.
