-- +goose Up
-- B4: dispatch offers + delivery completion + social data (ratings, cheers, chat).

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS search_started_at timestamptz;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS trip_m double precision NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS to_pickup_m double precision NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS carried_distance_m double precision NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS carried_active_s bigint NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS eta_s int NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS route_polyline text NOT NULL DEFAULT '';
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS last_route_lat double precision;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS last_route_lng double precision;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS last_route_at timestamptz;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS nudged_at timestamptz;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS arrived_pickup_at timestamptz;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS arrived_dropoff_at timestamptz;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS proof_file_id uuid REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cancel_note text NOT NULL DEFAULT '';

-- One row per courier per delivery (UNIQUE blocks duplicate offers and
-- re-offers after decline; declining carries no penalty, it just moves on).
CREATE TABLE IF NOT EXISTS dispatch_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank int NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'directed' CHECK (kind IN ('directed','broadcast','staff')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
  score double precision NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, courier_id)
);
CREATE INDEX IF NOT EXISTS idx_offers_delivery ON dispatch_offers(delivery_id, status);
CREATE INDEX IF NOT EXISTS idx_offers_courier ON dispatch_offers(courier_id, status);

-- Link staff invites to the user who signed up with the invited email.
ALTER TABLE merchant_staff ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_staff_user ON merchant_staff(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_merchant_shift ON merchant_staff(merchant_id) WHERE can_deliver AND on_shift;

-- Bayesian rating needs the raw star sum, not just the average.
ALTER TABLE couriers ADD COLUMN IF NOT EXISTS rating_stars_sum bigint NOT NULL DEFAULT 0;

-- Courier and restaurant are rated separately (couriers are never blamed
-- for the food). One row per order.
CREATE TABLE IF NOT EXISTS order_ratings (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  courier_id uuid REFERENCES users(id) ON DELETE SET NULL,
  courier_stars smallint CHECK (courier_stars IS NULL OR (courier_stars BETWEEN 1 AND 5)),
  courier_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  restaurant_stars smallint CHECK (restaurant_stars IS NULL OR (restaurant_stars BETWEEN 1 AND 5)),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Cheers: short encouragements the Voice Copilot reads aloud to the courier.
CREATE TABLE IF NOT EXISTS order_cheers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cheers_order ON order_cheers(order_id, created_at);

-- One chat thread per order (translation/moderation arrive with B6 AI).
CREATE TABLE IF NOT EXISTS order_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('customer','courier')),
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  lang text NOT NULL DEFAULT '',
  translated_body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_order ON order_messages(order_id, created_at);

-- +goose Down
DROP TABLE IF EXISTS order_messages, order_cheers, order_ratings, dispatch_offers;
ALTER TABLE couriers DROP COLUMN IF EXISTS rating_stars_sum;
DROP INDEX IF EXISTS idx_staff_merchant_shift;
DROP INDEX IF EXISTS idx_staff_user;
ALTER TABLE merchant_staff DROP COLUMN IF EXISTS user_id;
ALTER TABLE deliveries DROP COLUMN IF EXISTS cancel_note;
ALTER TABLE deliveries DROP COLUMN IF EXISTS proof_file_id;
ALTER TABLE deliveries DROP COLUMN IF EXISTS arrived_dropoff_at;
ALTER TABLE deliveries DROP COLUMN IF EXISTS arrived_pickup_at;
ALTER TABLE deliveries DROP COLUMN IF EXISTS nudged_at;
ALTER TABLE deliveries DROP COLUMN IF EXISTS last_route_at;
ALTER TABLE deliveries DROP COLUMN IF EXISTS last_route_lng;
ALTER TABLE deliveries DROP COLUMN IF EXISTS last_route_lat;
ALTER TABLE deliveries DROP COLUMN IF EXISTS route_polyline;
ALTER TABLE deliveries DROP COLUMN IF EXISTS eta_s;
ALTER TABLE deliveries DROP COLUMN IF EXISTS carried_active_s;
ALTER TABLE deliveries DROP COLUMN IF EXISTS carried_distance_m;
ALTER TABLE deliveries DROP COLUMN IF EXISTS to_pickup_m;
ALTER TABLE deliveries DROP COLUMN IF EXISTS trip_m;
ALTER TABLE deliveries DROP COLUMN IF EXISTS search_started_at;
