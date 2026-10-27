-- +goose Up
-- B6: AI call log, idempotent AI jobs, Snap-a-Menu import jobs, trust briefs,
-- proof checks, demo controls state, chat moderation + rating topic columns.

-- One row per model call: feature, model, latency, tokens, integer cost.
CREATE TABLE IF NOT EXISTS ai_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL DEFAULT '',
  latency_ms bigint NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_micros bigint NOT NULL DEFAULT 0,
  fallback boolean NOT NULL DEFAULT false,
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_feature ON ai_calls(feature, created_at);

-- Idempotency guard for AI background jobs: one row per (kind, job_key).
-- Double-delivered jobs claim the same row; the loser is a no-op.
CREATE TABLE IF NOT EXISTS ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  job_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  attempts int NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, job_key)
);

-- Snap-a-Menu import jobs: photo in, merchant-reviewed drafts out.
-- Drafts carry no prices (price_minor always null); the merchant types them.
CREATE TABLE IF NOT EXISTS menu_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','uploading','analyzing','needs_review','done','failed')),
  progress int NOT NULL DEFAULT 5 CHECK (progress BETWEEN 0 AND 100),
  drafts jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text NOT NULL DEFAULT '',
  prices_checked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_merchant ON menu_import_jobs(merchant_id, created_at);

-- Advisory Trust Briefs: AI summarizes, the admin decides (never auto-ban).
CREATE TABLE IF NOT EXISTS trust_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id uuid REFERENCES courier_applications(id) ON DELETE SET NULL,
  risk text NOT NULL DEFAULT 'medium' CHECK (risk IN ('low','medium','high')),
  advisory boolean NOT NULL DEFAULT true,
  summary text NOT NULL DEFAULT '',
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  photo_note text NOT NULL DEFAULT '',
  fallback boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- Delivery proof-photo checks (human reviews anything unclear).
CREATE TABLE IF NOT EXISTS proof_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  verdict text NOT NULL DEFAULT 'unclear' CHECK (verdict IN ('ok','unclear','missing_item')),
  note text NOT NULL DEFAULT '',
  fallback boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proof_delivery ON proof_checks(delivery_id);

-- Single-row demo controls (id always 1): simulator + judge switches.
CREATE TABLE IF NOT EXISTS demo_state (
  id int PRIMARY KEY CHECK (id = 1),
  force_no_courier boolean NOT NULL DEFAULT false,
  bots_running boolean NOT NULL DEFAULT false,
  bot_speed text NOT NULL DEFAULT 'x1' CHECK (bot_speed IN ('x1','x3','x10')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO demo_state(id) VALUES(1) ON CONFLICT (id) DO NOTHING;

-- Chat moderation flags (translation fills translated_body; B6 workers).
ALTER TABLE order_messages ADD COLUMN IF NOT EXISTS moderated boolean NOT NULL DEFAULT false;
ALTER TABLE order_messages ADD COLUMN IF NOT EXISTS flagged boolean NOT NULL DEFAULT false;

-- Rating topic labels for the support queue.
ALTER TABLE order_ratings ADD COLUMN IF NOT EXISTS topics jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE order_ratings ADD COLUMN IF NOT EXISTS abusive boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE order_ratings DROP COLUMN IF EXISTS abusive;
ALTER TABLE order_ratings DROP COLUMN IF EXISTS topics;
ALTER TABLE order_messages DROP COLUMN IF EXISTS flagged;
ALTER TABLE order_messages DROP COLUMN IF EXISTS moderated;
DROP TABLE IF EXISTS demo_state, proof_checks, trust_briefs, menu_import_jobs, ai_jobs, ai_calls;
