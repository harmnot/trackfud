-- Trackfud B2 menu queries (shapes used by internal/app/menu.go).
-- name: ListCategories :many
SELECT id, name, sort FROM menu_categories WHERE merchant_id=$1 ORDER BY sort, id;
-- name: CreateCategory :one
INSERT INTO menu_categories(merchant_id,name,sort) VALUES($1,$2,$3) RETURNING id;
-- name: ListMenuItems :many
SELECT id, category_id, name, description, price_minor, size_class, travels_well, photo_url, available
FROM menu_items WHERE merchant_id=$1 ORDER BY name->>'en';
-- name: CreateMenuItem :one
INSERT INTO menu_items(merchant_id,category_id,name,description,price_minor,
  size_class,travels_well,photo_url,available)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id;
