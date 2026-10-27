-- +goose Up
-- B3: courier onboarding + sessions + GPS ingest + sanctions (ready for B5/CMS).

-- Operational courier record (created on approval; application drafts live in
-- courier_applications). Status follows AGENTS.md section 8.4.
CREATE TABLE IF NOT EXISTS couriers (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'runner' CHECK (mode IN ('runner','biker')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','testing','passed_test','pending_review','approved','frozen','banned','rejected')),
  legal_name text NOT NULL DEFAULT '',
  birth_date date,
  nationality text NOT NULL DEFAULT '',
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  emergency_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  id_doc_type text NOT NULL DEFAULT '',
  id_number_enc text NOT NULL DEFAULT '',
  id_number_hash text NOT NULL DEFAULT '',
  id_front_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  id_back_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  selfie_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  bike jsonb NOT NULL DEFAULT '{}'::jsonb,
  bag_liters int NOT NULL DEFAULT 0,
  consents jsonb NOT NULL DEFAULT '{}'::jsonb,
  rating_bayes double precision NOT NULL DEFAULT 4.5,
  rating_count int NOT NULL DEFAULT 0,
  deliveries_count int NOT NULL DEFAULT 0,
  lifetime_distance_m double precision NOT NULL DEFAULT 0,
  lifetime_moving_s bigint NOT NULL DEFAULT 0,
  lifetime_active_s bigint NOT NULL DEFAULT 0,
  last_delivery_at timestamptz,
  approved_at timestamptz,
  approved_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Extend the B1 application statuses to the full section 8.4 flow.
-- 'pending' is kept as an alias of 'pending_review' for B1 compat.
ALTER TABLE courier_applications DROP CONSTRAINT IF EXISTS courier_applications_status_check;
ALTER TABLE courier_applications ADD CONSTRAINT courier_applications_status_check
  CHECK (status IN ('draft','testing','passed_test','pending','pending_review','approved','rejected'));
ALTER TABLE courier_applications ADD COLUMN IF NOT EXISTS qualification_session_id uuid;
ALTER TABLE courier_applications ADD COLUMN IF NOT EXISTS fitness_flags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE courier_applications ADD COLUMN IF NOT EXISTS fitness_gap_max_s int NOT NULL DEFAULT 0;
ALTER TABLE courier_applications ADD COLUMN IF NOT EXISTS fitness_evaluated_at timestamptz;

-- One row per qualification attempt (retry rule: 1 h gap, max 3 per 7 days).
CREATE TABLE IF NOT EXISTS fitness_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid,
  mode text NOT NULL DEFAULT 'runner',
  passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fitness_attempts_user ON fitness_attempts(user_id, created_at DESC);

-- Run/ride sessions: qualification tests and workout sessions.
CREATE TABLE IF NOT EXISTS activity_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'work' CHECK (kind IN ('qualification','work')),
  mode text NOT NULL DEFAULT 'runner' CHECK (mode IN ('runner','biker')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','ended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  goal_distance_m double precision NOT NULL DEFAULT 0,
  goal_duration_s int NOT NULL DEFAULT 0,
  distance_m double precision NOT NULL DEFAULT 0,
  moving_s bigint NOT NULL DEFAULT 0,
  active_s bigint NOT NULL DEFAULT 0,
  elapsed_s bigint NOT NULL DEFAULT 0,
  max_speed_mps double precision NOT NULL DEFAULT 0,
  steps bigint NOT NULL DEFAULT 0,
  last_pos geography(Point,4326),
  last_heading double precision,
  last_seen_at timestamptz,
  last_point_ts timestamptz,
  planned_track geography(LineString,4326),
  track geography(LineString,4326),
  splits jsonb NOT NULL DEFAULT '[]'::jsonb,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  checkpoint_prompt_at timestamptz,
  points_accepted bigint NOT NULL DEFAULT 0,
  points_skipped bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_courier ON activity_sessions(courier_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active_pos ON activity_sessions USING GIST (last_pos)
  WHERE status = 'active' AND last_pos IS NOT NULL;

-- Raw GPS points: short-lived (deleted after 30 days), BRIN on time.
CREATE TABLE IF NOT EXISTS location_points (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  phone_ts timestamptz NOT NULL,
  pos geography(Point,4326) NOT NULL,
  accuracy_m double precision NOT NULL DEFAULT 0,
  speed_mps double precision NOT NULL DEFAULT 0,
  heading double precision,
  altitude_m double precision,
  steps_delta int NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, ts)
);
CREATE INDEX IF NOT EXISTS idx_points_session_ts ON location_points(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_points_ts_brin ON location_points USING BRIN (ts);

-- Checkpoint photos taken during qualification tests.
CREATE TABLE IF NOT EXISTS checkpoint_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  prompted_at timestamptz,
  taken_at timestamptz NOT NULL DEFAULT now(),
  ai_verdict text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoint_photos(session_id);

-- Sanctions (freeze/ban) for B5/CMS use. No automatic bans: a human decides.
CREATE TABLE IF NOT EXISTS courier_sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('freeze','unfreeze','ban')),
  reason_code text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sanctions_courier ON courier_sanctions(courier_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS courier_sanctions, checkpoint_photos, location_points, activity_sessions, fitness_attempts, couriers CASCADE;
ALTER TABLE courier_applications DROP CONSTRAINT IF EXISTS courier_applications_status_check;
ALTER TABLE courier_applications ADD CONSTRAINT courier_applications_status_check
  CHECK (status IN ('draft','pending','approved','rejected'));
ALTER TABLE courier_applications DROP COLUMN IF EXISTS fitness_evaluated_at;
ALTER TABLE courier_applications DROP COLUMN IF EXISTS fitness_gap_max_s;
ALTER TABLE courier_applications DROP COLUMN IF EXISTS fitness_flags;
ALTER TABLE courier_applications DROP COLUMN IF EXISTS qualification_session_id;
