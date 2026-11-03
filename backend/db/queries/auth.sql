-- Trackfud sqlc-style queries (Milestone B0+B1). Runtime uses pgx with these shapes in internal/app.
-- name: GetUserByEmail :one
SELECT id, password_hash FROM users WHERE email = $1;
-- name: CreateUser :one
INSERT INTO users(email, password_hash, name, phone) VALUES ($1,$2,$3,$4) RETURNING id;
-- name: ListRoles :many
SELECT role FROM user_roles WHERE user_id = $1;
-- name: CreateRefresh :exec
INSERT INTO refresh_tokens(user_id, app, token_hash, expires_at) VALUES ($1,$2,$3,$4);
-- name: ListRestaurants :many
SELECT id, name, currency, timezone, address, prep_minutes, ST_Distance(location, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS dist FROM merchants WHERE status='approved' AND location IS NOT NULL ORDER BY dist ASC;
-- name: ListMenu :many
SELECT id, name, description, price_minor, size_class, travels_well, photo_url, available FROM menu_items WHERE merchant_id = $1;
