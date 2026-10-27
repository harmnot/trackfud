-- +goose Up
-- B2: order machine + ledger + menu hardening.

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('awaiting_payment','placed','accepted','ready','picked_up','delivered','completed','rejected','cancelled')),
  currency text NOT NULL DEFAULT 'IDR',
  subtotal_minor bigint NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  delivery_fee_minor bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_minor >= 0),
  service_fee_minor bigint NOT NULL DEFAULT 0 CHECK (service_fee_minor >= 0),
  tip_minor bigint NOT NULL DEFAULT 0 CHECK (tip_minor >= 0),
  total_minor bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  commission_minor bigint NOT NULL DEFAULT 0 CHECK (commission_minor >= 0),
  courier_fee_minor bigint NOT NULL DEFAULT 0 CHECK (courier_fee_minor >= 0),
  size_class text NOT NULL DEFAULT 'M' CHECK (size_class IN ('S','M','L')),
  spill_risk text NOT NULL DEFAULT 'low' CHECK (spill_risk IN ('low','medium','high')),
  payment_method text NOT NULL DEFAULT 'wallet' CHECK (payment_method IN ('wallet','card')),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','held','paid','refunded')),
  dropoff geography(Point,4326),
  dropoff_note text NOT NULL DEFAULT '',
  pickup_code text NOT NULL DEFAULT '',
  dropoff_pin text NOT NULL DEFAULT '',
  prep_minutes int NOT NULL DEFAULT 15,
  ready_at_est timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  idempotency_key text,
  placed_at timestamptz,
  accepted_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_status ON orders(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  name_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  qty int NOT NULL CHECK (qty >= 1 AND qty <= 20),
  PRIMARY KEY (order_id, menu_item_id)
);

CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('customer','merchant','courier','system','admin')),
  actor_id text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);

CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'workout' CHECK (type IN ('workout','staff')),
  status text NOT NULL DEFAULT 'searching'
    CHECK (status IN ('searching','offered','assigned','at_pickup','picked_up','at_dropoff','delivered','staff_searching','no_courier','cancelled')),
  courier_id uuid REFERENCES users(id) ON DELETE SET NULL,
  pickup_code text NOT NULL DEFAULT '',
  dropoff_pin text NOT NULL DEFAULT '',
  assigned_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_courier_status ON deliveries(courier_id, status);

-- Double-entry ledger: balances cached per account, postings immutable.
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL,
  owner_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('customer_wallet','courier_earnings','merchant_payable','order_escrow','platform_revenue','payout_clearing','paddle_clearing')),
  currency text NOT NULL,
  balance_minor bigint NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  UNIQUE (owner_type, owner_id, kind, currency)
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  ref_type text NOT NULL DEFAULT '',
  ref_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL,
  currency text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_postings_account ON postings(account_id);
CREATE INDEX IF NOT EXISTS idx_postings_entry ON postings(entry_id);

-- Agreement snapshot + signer context (B2 e-sign hardening).
ALTER TABLE merchant_agreements ADD COLUMN IF NOT EXISTS text_snapshot text NOT NULL DEFAULT '';
ALTER TABLE merchant_agreements ADD COLUMN IF NOT EXISTS ip text NOT NULL DEFAULT '';
ALTER TABLE merchant_agreements ADD COLUMN IF NOT EXISTS user_agent text NOT NULL DEFAULT '';

-- Menu hardening: prices are integer minor units, never negative.
ALTER TABLE menu_items ADD CONSTRAINT menu_items_price_nonneg CHECK (price_minor >= 0);

-- +goose Down
ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_price_nonneg;
ALTER TABLE merchant_agreements DROP COLUMN IF EXISTS user_agent;
ALTER TABLE merchant_agreements DROP COLUMN IF EXISTS ip;
ALTER TABLE merchant_agreements DROP COLUMN IF EXISTS text_snapshot;
DROP TABLE IF EXISTS postings, journal_entries, ledger_accounts CASCADE;
DROP TABLE IF EXISTS deliveries, order_events, order_items, orders CASCADE;
