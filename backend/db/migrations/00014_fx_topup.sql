-- +goose Up
-- FX-converted top-ups (2026-11-03): Paddle cannot charge IDR at all, so an
-- IDR top-up is charged in USD at the fx_rates rate while the wallet is
-- credited the full IDR amount. The quote locks on the payment row at
-- checkout (charge_currency/charge_amount_minor/fx_rate, NULL = same-currency
-- charge). The 4-leg FX entry balances per currency through fx_position, a
-- position account like paddle_clearing (it holds the cross-currency
-- difference, so both are exempt from the non-negative floor).

ALTER TABLE payments ADD COLUMN IF NOT EXISTS charge_currency text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS charge_amount_minor bigint;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fx_rate double precision;

ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_kind_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_kind_check
  CHECK (kind = ANY (ARRAY['customer_wallet'::text, 'courier_earnings'::text, 'merchant_payable'::text,
    'order_escrow'::text, 'platform_revenue'::text, 'payout_clearing'::text,
    'paddle_clearing'::text, 'fx_position'::text]));

ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_balance_minor_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_balance_minor_check
  CHECK (balance_minor >= 0 OR kind = ANY (ARRAY['paddle_clearing'::text, 'fx_position'::text]));

-- +goose Down
ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_balance_minor_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_balance_minor_check
  CHECK (balance_minor >= 0 OR kind = 'paddle_clearing'::text);
ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_kind_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_kind_check
  CHECK (kind = ANY (ARRAY['customer_wallet'::text, 'courier_earnings'::text, 'merchant_payable'::text,
    'order_escrow'::text, 'platform_revenue'::text, 'payout_clearing'::text,
    'paddle_clearing'::text]));
ALTER TABLE payments DROP COLUMN IF EXISTS fx_rate;
ALTER TABLE payments DROP COLUMN IF EXISTS charge_amount_minor;
ALTER TABLE payments DROP COLUMN IF EXISTS charge_currency;
