-- Trackfud B7 customer address-book queries (shapes used by internal/app/catalog.go).
-- Money-free: pins are lat/lng doubles validated in the API; one default per
-- user is enforced by the uq_customer_addresses_default partial unique index.
-- name: ListAddresses :many
SELECT id, label, address, lat, lng, note, is_default, created_at, updated_at
FROM customer_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC;
-- name: CreateAddress :one
INSERT INTO customer_addresses(user_id,label,address,lat,lng,note,is_default)
VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at, updated_at;
-- name: UpdateAddress :one
UPDATE customer_addresses SET label=$3, address=$4, lat=$5, lng=$6, note=$7,
  is_default=$8, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING updated_at;
-- name: DeleteAddress :one
DELETE FROM customer_addresses WHERE id=$1 AND user_id=$2 RETURNING is_default;
-- name: ClearDefaults :exec
UPDATE customer_addresses SET is_default=false, updated_at=now()
WHERE user_id=$1 AND is_default;
-- name: SetDefaultAddress :exec
UPDATE customer_addresses SET is_default=true, updated_at=now()
WHERE id=$1 AND user_id=$2;
-- name: DefaultAddress :one
SELECT lat, lng, note FROM customer_addresses
WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC LIMIT 1;
