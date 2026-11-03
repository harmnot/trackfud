-- +goose Up
-- FX rates for Paddle payouts (courier run-setup): Paddle sandbox does not
-- support every country currency, so non-supported currencies convert to USD.
-- Rates are base->quote with source + timestamp; the API refreshes stale
-- rows from a free public feed and always falls back to the last good rate.

CREATE TABLE IF NOT EXISTS fx_rates (
  base text NOT NULL,
  quote text NOT NULL,
  rate double precision NOT NULL CHECK (rate > 0),
  source text NOT NULL DEFAULT 'seed',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (base, quote)
);

-- Seed: USD base. IDR ~16,200/USD, GBP ~0.79/USD (demo rates; refreshed live).
INSERT INTO fx_rates(base, quote, rate, source) VALUES
  ('USD','USD',1,'seed'),
  ('USD','IDR',16200,'seed'),
  ('USD','GBP',0.79,'seed'),
  ('IDR','USD',0.000061728,'seed'),
  ('GBP','USD',1.2658,'seed'),
  ('IDR','IDR',1,'seed'),
  ('GBP','GBP',1,'seed')
ON CONFLICT (base, quote) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS fx_rates;
