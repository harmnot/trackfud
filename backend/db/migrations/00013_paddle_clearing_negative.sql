-- +goose Up
-- Paddle clearing is a receivable: when a webhook confirms money BEFORE any
-- settlement batch runs, the clearing leg posts negative ("Paddle owes us").
-- The blanket balance_minor >= 0 floor made every live top-up and card order
-- fail at apply time (caught live 2026-11-03: webhook claimed fine, then the
-- whole tx rolled back on ledger_accounts_balance_minor_check). Keep the
-- floor for customer/courier/merchant money, exempt only paddle_clearing.

ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_balance_minor_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_balance_minor_check
  CHECK (balance_minor >= 0 OR kind = 'paddle_clearing');

-- +goose Down
ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_balance_minor_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_balance_minor_check
  CHECK (balance_minor >= 0);
