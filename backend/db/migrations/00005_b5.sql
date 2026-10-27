-- +goose Up
-- B5: Paddle sandbox payments, webhook dedupe, mock withdrawals.

-- One row per Paddle-side payment: wallet top-ups and direct card orders
-- share this table and the webhook apply path.
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('topup','order')),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','cancelled')),
  paddle_txn_id text,
  idempotency_key text,
  checkout_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_paddle_txn ON payments(paddle_txn_id) WHERE paddle_txn_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);

-- Every Paddle webhook lands here first; event_id UNIQUE is the dedupe so a
-- double-delivered event can never pay twice.
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'paddle',
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed','ignored')),
  error text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- Mock payouts: courier_earnings -> payout_clearing -> paid, with fail-reverse
-- and admin hold/release. Staff couriers withdraw from the same account kind.
CREATE TABLE IF NOT EXISTS withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','failed','held','cancelled')),
  debited boolean NOT NULL DEFAULT false,
  idempotency_key text,
  hold_reason text NOT NULL DEFAULT '',
  failure_reason text NOT NULL DEFAULT '',
  payout_ref text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (courier_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_courier ON withdrawals(courier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- +goose Down
DROP TABLE IF EXISTS withdrawals, webhook_events, payments;
