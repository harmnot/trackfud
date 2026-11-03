-- +goose Up
-- A9 settings editor + audit log (PLAN.md §4.4: Settings P0 per country,
-- audit log viewer P1). Defaults live in config.yaml; this table holds only
-- admin overrides. Scope is 'global' or 'country:XX' (ISO-3166 alpha-2).
-- audit_logs records every admin mutation (decisions, sanctions, refunds,
-- hold/release, settings, demo controls) for the CMS audit viewer.

CREATE TABLE IF NOT EXISTS platform_settings (
  key text NOT NULL,
  scope text NOT NULL DEFAULT 'global'
    CHECK (scope = 'global' OR scope LIKE 'country:__'),
  value jsonb NOT NULL,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, scope)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL DEFAULT '',
  action text NOT NULL,
  target_type text NOT NULL DEFAULT '',
  target_id text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  before jsonb NOT NULL DEFAULT '{}'::jsonb,
  after jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);

-- +goose Down
DROP INDEX IF EXISTS idx_audit_logs_target;
DROP INDEX IF EXISTS idx_audit_logs_created;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS platform_settings;
