-- +goose Up
-- Merchant review parity with courier_applications: persist the admin's
-- rejection reason and bump updated_at on every decision so the CMS detail
-- can show "why + when" for rejected merchants (couriers already have both).

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS reject_reason text NOT NULL DEFAULT '';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- +goose Down
ALTER TABLE merchants DROP COLUMN IF EXISTS updated_at;
ALTER TABLE merchants DROP COLUMN IF EXISTS reject_reason;
