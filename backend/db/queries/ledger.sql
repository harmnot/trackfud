-- Trackfud B2 ledger queries (shapes used by internal/app/orders.go).
-- name: EnsureLedgerAccount :one
INSERT INTO ledger_accounts(owner_type,owner_id,kind,currency) VALUES($1,$2,$3,$4)
ON CONFLICT (owner_type,owner_id,kind,currency) DO UPDATE SET currency=EXCLUDED.currency RETURNING id;
-- name: InsertJournalEntry :one
INSERT INTO journal_entries(kind,idempotency_key,ref_type,ref_id) VALUES($1,$2,$3,$4)
ON CONFLICT (idempotency_key) DO NOTHING RETURNING id;
-- name: InsertPosting :exec
INSERT INTO postings(entry_id,account_id,amount_minor,currency) VALUES($1,$2,$3,$4);
-- name: ApplyPostingBalance :exec
UPDATE ledger_accounts SET balance_minor=balance_minor+$2 WHERE id=$1;
-- name: WalletBalanceForUpdate :one
SELECT balance_minor FROM ledger_accounts
WHERE owner_type='customer' AND owner_id=$1 AND kind='customer_wallet' AND currency=$2 FOR UPDATE;
