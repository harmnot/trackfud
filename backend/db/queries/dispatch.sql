-- Trackfud B4 dispatch queries (shapes used by internal/app/dispatch.go).
-- Plan: AGENTS.md section 6. Coordinates stay in PostGIS; Go sees meters.
-- name: DispatchCandidates :many
WITH o AS (
  SELECT o.id, o.dropoff, o.size_class, m.location AS pickup
  FROM orders o JOIN merchants m ON m.id = o.merchant_id
  WHERE o.id = $1
)
SELECT s.courier_id, c.mode,
       ST_Distance(s.last_pos, o.pickup)::int AS to_pickup_m,
       ST_Distance(o.pickup, o.dropoff)::int AS trip_m,
       ST_Y(s.last_pos::geometry), ST_X(s.last_pos::geometry),
       s.last_heading, c.rating_bayes,
       GREATEST(COALESCE(s.goal_distance_m, 0) - s.distance_m, 0) AS goal_left_m,
       EXTRACT(EPOCH FROM now() - COALESCE(c.last_delivery_at, s.started_at))::int AS idle_s,
       CASE WHEN s.planned_track IS NULL THEN 0 ELSE 1 END AS has_track
FROM activity_sessions s
JOIN couriers c ON c.user_id = s.courier_id
CROSS JOIN o
WHERE s.kind = 'work' AND s.status = 'active'
  AND s.last_seen_at > now() - interval '60 seconds'
  AND c.status = 'approved'
  AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.courier_id = s.courier_id
                  AND d.status IN ('assigned','at_pickup','picked_up','at_dropoff'))
  AND NOT EXISTS (SELECT 1 FROM dispatch_offers x
                  WHERE x.courier_id = s.courier_id AND x.delivery_id = $2)
  AND (
    (c.mode = 'runner'
      AND ST_DWithin(s.last_pos, o.pickup, $3)
      AND ST_DWithin(o.pickup, o.dropoff, $4)
      AND o.size_class = ANY(string_to_array($5, ','))
      AND (s.planned_track IS NULL OR ST_DWithin(s.planned_track, o.pickup, $6)))
    OR
    (c.mode = 'biker'
      AND ST_DWithin(s.last_pos, o.pickup, $7)
      AND ST_DWithin(o.pickup, o.dropoff, $8)
      AND o.size_class = ANY(string_to_array($9, ','))
      AND (s.planned_track IS NULL OR ST_DWithin(s.planned_track, o.pickup, $10)))
  )
ORDER BY to_pickup_m
LIMIT 20;
-- name: ClaimDelivery :one
UPDATE deliveries SET courier_id = $2, status = 'assigned', type = $5,
  assigned_at = now(), to_pickup_m = $3, trip_m = $4
WHERE id = $1 AND status = ANY($6) AND courier_id IS NULL
RETURNING id, order_id;
-- name: CreateOffer :one
INSERT INTO dispatch_offers(delivery_id,courier_id,rank,kind,score,payload,expires_at)
VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id;
-- name: ExpireOffer :exec
UPDATE dispatch_offers SET status = 'expired' WHERE id = $1 AND status = 'pending';
-- name: ExpirePendingOffers :exec
UPDATE dispatch_offers SET status = 'expired'
WHERE delivery_id = $1 AND status = 'pending' AND id <> COALESCE($2, '00000000-0000-0000-0000-000000000000');
-- name: EligibleStaff :many
SELECT u.id FROM merchant_staff ms JOIN users u ON lower(u.email) = lower(ms.email)
WHERE ms.merchant_id = $1 AND ms.can_deliver AND ms.on_shift;
-- name: CarriedPoints :many
SELECT lp.ts, ST_Y(lp.pos::geometry), ST_X(lp.pos::geometry)
FROM location_points lp JOIN activity_sessions s ON s.id = lp.session_id
WHERE s.courier_id = $1 AND lp.ts BETWEEN $2 AND $3 ORDER BY lp.ts;
