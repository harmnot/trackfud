-- +goose Up
-- Chat translations remember whether Muse Spark produced them (live) or the
-- offline dictionary / passthrough did, so every client labels them honestly
-- and an open chat can show the AI job's result the moment it lands
-- (`chat.translated` realtime frame). Seeded/canned translations stay false.
ALTER TABLE order_messages ADD COLUMN IF NOT EXISTS translated_live boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE order_messages DROP COLUMN IF EXISTS translated_live;
