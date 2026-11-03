-- Trackfud B2 order-machine queries (shapes used by internal/app/orders.go).
-- name: CreateOrder :one
INSERT INTO orders(code,customer_id,merchant_id,status,currency,
  subtotal_minor,delivery_fee_minor,service_fee_minor,tip_minor,total_minor,
  commission_minor,courier_fee_minor,size_class,payment_method,payment_status,
  dropoff,dropoff_note,dropoff_pin,prep_minutes,placed_at,idempotency_key)
VALUES($1,$2,$3,'placed',$4,$5,$6,$7,$8,$9,$10,$11,$12,'wallet','held',
  ST_SetSRID(ST_MakePoint($13,$14),4326)::geography,$15,$16,$17,now(),$18) RETURNING id;
-- name: TransitionOrder :one
UPDATE orders SET status=$2, updated_at=now() WHERE id=$1 AND status=$3
RETURNING customer_id, merchant_id, status;
-- name: AppendOrderEvent :exec
INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id,reason)
VALUES($1,$2,$3,$4,$5,$6);
-- name: CreateDeliverySearch :exec
INSERT INTO deliveries(order_id,type,status,pickup_code,dropoff_pin)
VALUES($1,'workout','searching',$2,$3) ON CONFLICT (order_id) DO NOTHING;
-- name: QuoteDistanceM :one
SELECT ST_Distance(
  ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
  ST_SetSRID(ST_MakePoint($3,$4),4326)::geography);
