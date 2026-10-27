-- +goose Up
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('customer','courier','merchant','admin')),
  PRIMARY KEY (user_id, role)
);
CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
CREATE TABLE verification_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket text NOT NULL CHECK (bucket IN ('public','private')),
  content_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready')),
  storage_path text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_files_owner ON files(owner_id);
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbox_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_pending ON jobs(run_at) WHERE status='pending';
CREATE TABLE idempotency_keys (
  key text NOT NULL,
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  status int NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (key, user_id, endpoint)
);
CREATE TABLE app_secrets (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE ws_tickets (
  ticket text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'ID',
  currency text NOT NULL DEFAULT 'IDR',
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  address text NOT NULL DEFAULT '',
  pickup_note text NOT NULL DEFAULT '',
  location geography(Point,4326),
  prep_minutes int NOT NULL DEFAULT 15,
  opening_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_merchants_location ON merchants USING GIST (location);
CREATE INDEX idx_merchants_owner ON merchants(owner_id);
CREATE TABLE merchant_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  version text NOT NULL,
  signer_name text NOT NULL,
  agreed boolean NOT NULL DEFAULT false,
  sha256 text NOT NULL DEFAULT '',
  signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE merchant_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  can_deliver boolean NOT NULL DEFAULT false,
  on_shift boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, email)
);
CREATE TABLE menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort int NOT NULL DEFAULT 0
);
CREATE TABLE menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  category_id uuid REFERENCES menu_categories(id) ON DELETE SET NULL,
  name jsonb NOT NULL DEFAULT '{}'::jsonb,
  description jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_minor bigint NOT NULL DEFAULT 0,
  size_class text NOT NULL DEFAULT 'M' CHECK (size_class IN ('S','M','L')),
  spill_risk text NOT NULL DEFAULT 'low' CHECK (spill_risk IN ('low','medium','high')),
  travels_well boolean NOT NULL DEFAULT true,
  photo_url text NOT NULL DEFAULT '',
  available boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_items_merchant ON menu_items(merchant_id);
CREATE TABLE courier_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'runner' CHECK (mode IN ('runner','biker')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected')),
  reject_reason text NOT NULL DEFAULT '',
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  fitness_distance_m double precision NOT NULL DEFAULT 0,
  fitness_moving_s int NOT NULL DEFAULT 0,
  fitness_elapsed_s int NOT NULL DEFAULT 0,
  fitness_passed boolean NOT NULL DEFAULT false,
  checkpoint_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Home',
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS customer_addresses, courier_applications, menu_items, menu_categories, merchant_staff, merchant_agreements, merchants, ws_tickets, app_secrets, idempotency_keys, jobs, outbox_emails, push_subscriptions, files, verification_tokens, refresh_tokens, user_roles, users CASCADE;
