-- +goose Up
-- B7: customer address book — display address, one default per user,
-- updated_at for edits. Dropoff coordinates stay as lat/lng doubles
-- (validated in the API like merchant pins); the B-tree serves the
-- per-user list and the partial unique index enforces a single default.

ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '';
ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill: earliest saved address per user becomes the default when the
-- user has addresses but no default yet (fresh installs start empty).
UPDATE customer_addresses a SET is_default = true
WHERE a.id IN (
  SELECT DISTINCT ON (user_id) id FROM customer_addresses ORDER BY user_id, created_at ASC
) AND NOT EXISTS (
  SELECT 1 FROM customer_addresses d WHERE d.user_id = a.user_id AND d.is_default AND d.id <> a.id
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_user ON customer_addresses(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_addresses_default ON customer_addresses(user_id) WHERE is_default;

-- +goose Down
DROP INDEX IF EXISTS uq_customer_addresses_default;
DROP INDEX IF EXISTS idx_customer_addresses_user;
ALTER TABLE customer_addresses DROP COLUMN IF EXISTS updated_at;
ALTER TABLE customer_addresses DROP COLUMN IF EXISTS is_default;
ALTER TABLE customer_addresses DROP COLUMN IF EXISTS address;
