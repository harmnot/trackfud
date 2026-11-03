-- +goose Up
-- Dispatch no longer filters on spill risk (product decision 2026-10-31):
-- runners and bikers take any order their size class allows. Drop the
-- label columns so no dead field lingers in the API or UIs.

ALTER TABLE menu_items DROP COLUMN IF EXISTS spill_risk;
ALTER TABLE orders DROP COLUMN IF EXISTS spill_risk;

-- +goose Down
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS spill_risk text NOT NULL DEFAULT 'low' CHECK (spill_risk IN ('low','medium','high'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS spill_risk text NOT NULL DEFAULT 'low' CHECK (spill_risk IN ('low','medium','high'));
