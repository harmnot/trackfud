-- +goose Up
-- Merchant sanctions (ban/unban) for CMS use. No automatic bans: a human decides.
-- Widens the merchants status check with 'banned'; the audit trail lives in
-- merchant_sanctions (unban restores the status recorded at ban time).

ALTER TABLE merchants DROP CONSTRAINT IF EXISTS merchants_status_check;
ALTER TABLE merchants ADD CONSTRAINT merchants_status_check CHECK (status IN ('draft','pending','approved','rejected','banned'));

CREATE TABLE IF NOT EXISTS merchant_sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ban','unban')),
  reason text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  prev_status text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_merchant_sanctions_merchant ON merchant_sanctions(merchant_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS merchant_sanctions;
ALTER TABLE merchants DROP CONSTRAINT IF EXISTS merchants_status_check;
ALTER TABLE merchants ADD CONSTRAINT merchants_status_check CHECK (status IN ('draft','pending','approved','rejected'));
