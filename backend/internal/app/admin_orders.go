// Admin order review for the CMS back office (A7 orders list + detail,
// PLAN.md §4.4 P0): queue + detail with event timeline, chat, proof photo,
// ratings/cheers, money trail, and a support refund.
//
// Reads reuse the same builders as the customer/merchant tracks
// (orderView, orderItems, deliveryPublicView), so all three frontends plus
// the CMS always serve the same keys. The refund path reuses the guarded
// Transition() + refundLegsFor() used by every other cancel/refund, so the
// state machine and the double-entry ledger stay the single source of truth.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"Trackfud/internal/order"

	"github.com/jackc/pgx/v5"
)

// orderStatuses is the allowlist for the admin ?status= filter. Unknown
// values are rejected (400) so they can never reach SQL.
var orderStatuses = map[string]bool{
	order.StatusAwaitingPayment: true,
	order.StatusPlaced:          true,
	order.StatusAccepted:        true,
	order.StatusReady:           true,
	order.StatusPickedUp:        true,
	order.StatusDelivered:       true,
	order.StatusCompleted:       true,
	order.StatusRejected:        true,
	order.StatusCancelled:       true,
}

// parseOrderStatusFilter validates an admin ?status= filter. Empty means all.
func parseOrderStatusFilter(v string) (string, bool) {
	v = strings.TrimSpace(strings.ToLower(v))
	if v == "" {
		return "", true
	}
	if orderStatuses[v] {
		return v, true
	}
	return "", false
}

// adminRefundAction is what the support refund does for an order:
// cancel_unpaid voids the intent without touching the ledger (no money has
// moved yet); refund releases the funded escrow back via refundLegsFor.
type adminRefundAction string

const (
	adminRefundNone      adminRefundAction = ""
	adminRefundCancel    adminRefundAction = "cancel_unpaid"
	adminRefundMoneyBack adminRefundAction = "refund"
)

// adminRefundPlan is the pure policy behind POST /v1/admin/orders/{id}/refund.
// Only pre-pickup support cases are refundable in the app: once the courier
// picks up, the food is out of the kitchen and the case needs reassign or
// finance handling; once delivered, the escrow is already split to the
// merchant and courier (settlement), so finance handles it case by case.
func adminRefundPlan(status, payStatus string) (adminRefundAction, string) {
	// Terminal states win over the refunded check so the conflict names the
	// state the operator is looking at (a rejected order is always refunded).
	switch status {
	case order.StatusRejected, order.StatusCancelled, order.StatusCompleted:
		return adminRefundNone, fmt.Sprintf("order is already %s", status)
	}
	if payStatus == "refunded" {
		return adminRefundNone, "this order was already refunded"
	}
	switch status {
	case order.StatusDelivered:
		return adminRefundNone, "order is settled (paid out to merchant and courier); finance handles post-delivery refunds"
	case order.StatusPickedUp:
		return adminRefundNone, "order is already picked up; reassign the delivery or escalate to finance"
	case order.StatusAwaitingPayment:
		return adminRefundCancel, ""
	case order.StatusPlaced, order.StatusAccepted, order.StatusReady:
		return adminRefundMoneyBack, ""
	default:
		return adminRefundNone, fmt.Sprintf("order status %q cannot be refunded", status)
	}
}

func rfc3339(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05Z07:00")
}

// adminOrderCols mirrors orderCols with the orders alias: the queue joins
// merchants, users and deliveries, and bare `id`/`status` would be ambiguous.
// Keep in the same order as orderCols — the row scan depends on it.
const adminOrderCols = `o.id, o.code, o.customer_id, o.merchant_id, o.status, o.currency,
	o.subtotal_minor, o.delivery_fee_minor, o.service_fee_minor, o.tip_minor, o.total_minor,
	o.commission_minor, o.courier_fee_minor, o.size_class, o.payment_method, o.payment_status,
	COALESCE(ST_Y(o.dropoff::geometry), 0), COALESCE(ST_X(o.dropoff::geometry), 0), o.dropoff IS NOT NULL,
	o.dropoff_note, o.pickup_code, o.dropoff_pin, o.prep_minutes,
	o.ready_at_est, o.window_start, o.window_end, o.cancel_reason, o.created_at`

// listAdminOrders serves the CMS order queue, newest first, with an optional
// ?status= filter, free-text ?q= (code, customer email, merchant name) and
// scroll pagination (?page=, ?per_page= default 10, legacy ?limit= alias).
// Every row carries the parties and the live dispatch state, so reviewers
// triage without opening each order.
func (s *Server) listAdminOrders(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	status, ok := parseOrderStatusFilter(r.URL.Query().Get("status"))
	if !ok {
		problem(w, 400, "Validation failed", "status must be one of awaiting_payment, placed, accepted, ready, picked_up, delivered, completed, rejected, cancelled")
		return
	}
	pg := parsePagination(r.URL.Query())
	pattern, filtered, errMsg := parseSearch(r.URL.Query().Get("q"))
	if errMsg != "" {
		problem(w, 400, "Validation failed", errMsg)
		return
	}
	from := `FROM orders o JOIN merchants m ON m.id=o.merchant_id
		JOIN users u ON u.id=o.customer_id
		LEFT JOIN deliveries d ON d.order_id=o.id`
	args := []any{}
	var where strings.Builder
	if status != "" {
		args = append(args, status)
		where.WriteString(` WHERE o.status=$` + strconv.Itoa(len(args)))
	}
	if filtered {
		if len(args) == 0 {
			where.WriteString(` WHERE `)
		} else {
			where.WriteString(` AND `)
		}
		args = append(args, pattern)
		ph := `$` + strconv.Itoa(len(args))
		where.WriteString(ilikeAny(ph, "o.code", "u.email", "m.name"))
	}
	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT COUNT(*) `+from+where.String(), args...).Scan(&total); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	pargs := append(append([]any{}, args...), pg.limit, pg.offset)
	q := `SELECT ` + adminOrderCols + `, m.id, m.name, u.id, u.email,
		d.status, d.type, COALESCE(d.courier_id::text,'')
		` + from + where.String() +
		` ORDER BY o.created_at DESC LIMIT $` + strconv.Itoa(len(pargs)-1) + ` OFFSET $` + strconv.Itoa(len(pargs))
	rows, err := s.db.Query(r.Context(), q, pargs...)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var o orderRow
		var merchantID, merchantName, customerID, customerEmail string
		var dStatus, dType, courierID *string
		// orderCols first, then the joined party/dispatch columns in select order.
		if err := rows.Scan(&o.ID, &o.Code, &o.CustomerID, &o.MerchantID, &o.Status, &o.Currency,
			&o.Subtotal, &o.Delivery, &o.Service, &o.Tip, &o.Total, &o.Commission, &o.CourierFee,
			&o.Size, &o.PayMethod, &o.PayStatus, &o.Lat, &o.Lng, &o.HasDropoff,
			&o.DropoffNote, &o.PickupCode, &o.DropoffPin, &o.PrepMinutes,
			&o.ReadyAtEst, &o.WindowStart, &o.WindowEnd, &o.CancelReason, &o.CreatedAt,
			&merchantID, &merchantName, &customerID, &customerEmail,
			&dStatus, &dType, &courierID); err != nil {
			continue
		}
		v := s.orderView(r.Context(), o, "merchant")
		// Support sees both handover secrets: the pickup code (like the
		// merchant view) plus the customer PIN, so a stuck handover can be
		// talked through when one side cannot open their app.
		v["delivery_pin"] = o.DropoffPin
		v["merchant"] = map[string]any{"id": merchantID, "name": merchantName}
		v["customer"] = map[string]any{"id": customerID, "email": customerEmail}
		if dStatus != nil {
			d := map[string]any{"status": *dStatus, "type": *dType}
			if courierID != nil && *courierID != "" {
				d["courier_id"] = *courierID
			}
			v["delivery"] = d
		}
		out = append(out, v)
	}
	writePaginatedList(w, "orders", out, pg.page, pg.perPage, total)
}

// adminOrderView shapes one order for support: the merchant money view plus
// the customer PIN (see listAdminOrders) and the human-readable parties.
func (s *Server) adminOrderView(ctx context.Context, o orderRow) map[string]any {
	v := s.orderView(ctx, o, "merchant")
	v["delivery_pin"] = o.DropoffPin
	var merchantName, customerEmail string
	_ = s.db.QueryRow(ctx, `SELECT name FROM merchants WHERE id=$1`, o.MerchantID).Scan(&merchantName)
	_ = s.db.QueryRow(ctx, `SELECT email FROM users WHERE id=$1`, o.CustomerID).Scan(&customerEmail)
	v["merchant"] = map[string]any{"id": o.MerchantID, "name": merchantName}
	v["customer"] = map[string]any{"id": o.CustomerID, "email": customerEmail}
	return v
}

// adminOrderEvents is the full audit timeline: from/to plus the actor id and
// the human reason, so support sees who moved the order and why.
func (s *Server) adminOrderEvents(ctx context.Context, orderID string) []map[string]any {
	rows, err := s.db.Query(ctx, `SELECT from_status, to_status, actor_type, actor_id, reason, created_at
		FROM order_events WHERE order_id=$1 ORDER BY created_at`, orderID)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var from, to, actor, actorID, reason string
		var at time.Time
		if err := rows.Scan(&from, &to, &actor, &actorID, &reason, &at); err != nil {
			continue
		}
		out = append(out, map[string]any{"from": from, "to": to, "actor": actor,
			"actor_id": actorID, "reason": reason, "at": rfc3339(at)})
	}
	return out
}

// adminOrderMessages is the support chat view: the customer/courier thread
// plus translation and moderation flags, oldest first like the apps.
func (s *Server) adminOrderMessages(ctx context.Context, orderID string) []map[string]any {
	rows, err := s.db.Query(ctx, `SELECT id, sender_type, body, lang, translated_body, moderated, flagged, created_at
		FROM order_messages WHERE order_id=$1 ORDER BY created_at LIMIT 100`, orderID)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, sender, body, lang, translated string
		var moderated, flagged bool
		var at time.Time
		if err := rows.Scan(&id, &sender, &body, &lang, &translated, &moderated, &flagged, &at); err != nil {
			continue
		}
		m := map[string]any{"id": id, "sender": sender, "body": body,
			"moderated": moderated, "flagged": flagged, "created_at": rfc3339(at)}
		if lang != "" {
			m["lang"] = lang
		}
		if translated != "" {
			m["translated_body"] = translated
		}
		out = append(out, m)
	}
	return out
}

// adminOrderSocial loads cheers (count + recent) and the one-per-order
// ratings row; a missing ratings row is nil, not an error.
func (s *Server) adminOrderSocial(ctx context.Context, orderID string) (map[string]any, map[string]any) {
	var cheers int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM order_cheers WHERE order_id=$1`, orderID).Scan(&cheers)
	recent := []map[string]any{}
	if rows, err := s.db.Query(ctx, `SELECT message, created_at FROM order_cheers
		WHERE order_id=$1 ORDER BY created_at DESC LIMIT 5`, orderID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var msg string
			var at time.Time
			if err := rows.Scan(&msg, &at); err == nil {
				recent = append(recent, map[string]any{"message": msg, "created_at": rfc3339(at)})
			}
		}
	}
	cheerView := map[string]any{"count": cheers, "recent": recent}
	var cStars, rStars *int
	var tagsB, topicsB []byte
	var abusive bool
	var ratedAt time.Time
	if err := s.db.QueryRow(ctx, `SELECT courier_stars, courier_tags, restaurant_stars, topics, abusive, created_at
		FROM order_ratings WHERE order_id=$1`, orderID).Scan(&cStars, &tagsB, &rStars, &topicsB, &abusive, &ratedAt); err != nil {
		return cheerView, nil
	}
	tags, topics := []string{}, []string{}
	_ = json.Unmarshal(tagsB, &tags)
	_ = json.Unmarshal(topicsB, &topics)
	return cheerView, map[string]any{"courier_stars": cStars, "courier_tags": tags,
		"restaurant_stars": rStars, "topics": topics, "abusive": abusive,
		"created_at": rfc3339(ratedAt)}
}

// adminOrderProof loads the delivery photo reference plus the AI proof-check
// verdicts (humans review unclear ones — the admin decides, never the model).
func (s *Server) adminOrderProof(ctx context.Context, orderID string) map[string]any {
	empty := map[string]any{"file_id": nil, "checks": []map[string]any{}}
	d, err := s.loadDeliveryByOrder(ctx, orderID)
	if err != nil {
		return empty
	}
	out := map[string]any{"file_id": nil, "checks": []map[string]any{}}
	if d.ProofFileID != nil && *d.ProofFileID != "" {
		out["file_id"] = *d.ProofFileID
	}
	checks := []map[string]any{}
	rows, err := s.db.Query(ctx, `SELECT file_id, verdict, note, fallback, created_at
		FROM proof_checks WHERE delivery_id=$1 ORDER BY created_at DESC`, d.ID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var fid *string
			var verdict, note string
			var fallback bool
			var at time.Time
			if err := rows.Scan(&fid, &verdict, &note, &fallback, &at); err != nil {
				continue
			}
			c := map[string]any{"verdict": verdict, "note": note, "fallback": fallback,
				"created_at": rfc3339(at)}
			if fid != nil {
				c["file_id"] = *fid
			}
			checks = append(checks, c)
		}
	}
	out["checks"] = checks
	return out
}

// adminOrderMoney is the read-only money trail: every journal posting behind
// ref_type='order' for this order, so support can see charge → settle/refund.
func (s *Server) adminOrderMoney(ctx context.Context, o orderRow) map[string]any {
	rows, err := s.db.Query(ctx, `SELECT e.kind, a.owner_type, a.owner_id, a.kind,
		p.amount_minor, p.currency, e.created_at
		FROM journal_entries e JOIN postings p ON p.entry_id=e.id
		JOIN ledger_accounts a ON a.id=p.account_id
		WHERE e.ref_type='order' AND e.ref_id=$1 ORDER BY e.created_at`, o.ID)
	postings := []map[string]any{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var kind, ot, oid, ak string
			var amt int64
			var cur string
			var at time.Time
			if err := rows.Scan(&kind, &ot, &oid, &ak, &amt, &cur, &at); err != nil {
				continue
			}
			postings = append(postings, map[string]any{"kind": kind,
				"account":      map[string]any{"owner_type": ot, "owner_id": oid, "kind": ak},
				"amount_minor": amt, "currency": cur, "created_at": rfc3339(at)})
		}
	}
	return map[string]any{"method": o.PaymentMethod(), "status": o.PayStatus, "postings": postings}
}

// getAdminOrder serves one order with everything the CMS detail needs:
// parties, items, audit timeline, delivery, chat, cheers/ratings, proof and
// the money trail. Delivery reuses deliveryPublicView (same keys as the
// customer app) plus admin extras (ids, timestamps, proof, cancel note).
func (s *Server) getAdminOrder(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		problem(w, 400, "Validation failed", "order id is required")
		return
	}
	o, err := s.loadOrder(r.Context(), id)
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	ctx := r.Context()
	items, _ := s.orderItems(ctx, o.ID)
	detail := buildOrderDetail(s.adminOrderView(ctx, o), items, s.adminOrderEvents(ctx, o.ID),
		s.deliveryPublicView(ctx, o.ID))
	if d, err := s.loadDeliveryByOrder(ctx, o.ID); err == nil {
		dv, _ := detail["delivery"].(map[string]any)
		if dv == nil {
			dv = map[string]any{}
		}
		dv["id"] = d.ID
		dv["trip_m"] = d.TripM
		if d.CourierID != nil {
			dv["courier_id"] = *d.CourierID
			var email string
			_ = s.db.QueryRow(ctx, `SELECT email FROM users WHERE id=$1`, *d.CourierID).Scan(&email)
			dv["courier_email"] = email
		} else {
			dv["courier_id"] = ""
		}
		dv["assigned_at"] = tsOrNil(d.AssignedAt)
		dv["picked_up_at"] = tsOrNil(d.PickedUpAt)
		dv["delivered_at"] = tsOrNil(d.DeliveredAt)
		dv["cancel_note"] = d.CancelNote
		detail["delivery"] = dv
	}
	cheers, ratings := s.adminOrderSocial(ctx, o.ID)
	detail["messages"] = s.adminOrderMessages(ctx, o.ID)
	detail["cheers"] = cheers
	detail["ratings"] = ratings
	detail["proof"] = s.adminOrderProof(ctx, o.ID)
	detail["payments"] = s.adminOrderMoney(ctx, o)
	action, _ := adminRefundPlan(o.Status, o.PayStatus)
	detail["refundable"] = action != adminRefundNone
	writeJSON(w, 200, map[string]any{"order": detail})
}

// refundAdminOrder cancels an order with a full support refund:
// guarded Transition() to cancelled, escrow released via refundLegsFor (or a
// plain cancel when nothing was funded yet), delivery cancelled so the leg
// cannot proceed, and push + email to the customer and the courier.
func (s *Server) refundAdminOrder(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	c := claims(r)
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		problem(w, 400, "Validation failed", "order id is required")
		return
	}
	var b struct {
		Reason string `json:"reason"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		if !decode(w, r, &b) {
			return
		}
	}
	reason := strings.TrimSpace(b.Reason)
	if reason == "" {
		problem(w, 400, "Validation failed", "a refund reason is required and is audit-logged")
		return
	}
	o, err := s.loadOrder(r.Context(), id)
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	action, msg := adminRefundPlan(o.Status, o.PayStatus)
	if action == adminRefundNone {
		problem(w, 409, "Conflict", msg)
		return
	}
	from := o.Status
	// Card intents that never funded escrow cancel without ledger legs;
	// funded escrow (wallet charge or confirmed card) refunds via the ledger.
	funded := o.PayStatus == "held" || o.PayStatus == "paid"
	var courierID *string
	if d, derr := s.loadDeliveryByOrder(r.Context(), o.ID); derr == nil {
		courierID = d.CourierID
	}
	_, _, _, err = s.transitionOrder(r.Context(), o.ID, from, order.StatusCancelled,
		"admin", c.Sub, "admin refund: "+reason, func(ctx context.Context, tx pgx.Tx) error {
			if action == adminRefundMoneyBack && funded {
				if _, err := tx.Exec(ctx, `UPDATE orders SET payment_status='refunded', cancel_reason=$2 WHERE id=$1`, o.ID, reason); err != nil {
					return err
				}
				legs, key := refundLegsFor(o)
				markCardPaymentRefunded(ctx, tx, o.ID)
				if err := postEntry(ctx, tx, "order_refund", key, "order", o.ID, legs); err != nil {
					return err
				}
			} else {
				// Awaiting payment (or an unfunded intent): the money never
				// moved, so only close the order and void the pending card
				// intent — mirroring the customer cancel path, which leaves
				// payment_status alone on unpaid orders.
				if _, err := tx.Exec(ctx, `UPDATE orders SET cancel_reason=$2 WHERE id=$1`, o.ID, reason); err != nil {
					return err
				}
				_, _ = tx.Exec(ctx, `UPDATE payments SET status='cancelled', updated_at=now()
					WHERE order_id=$1 AND status='pending'`, o.ID)
			}
			_, _ = tx.Exec(ctx, `UPDATE deliveries SET status='cancelled', cancel_note='admin_refund'
				WHERE order_id=$1 AND status NOT IN ('delivered','cancelled')`, o.ID)
			return nil
		})
	if err == order.ErrForbiddenTransition || err == order.ErrUnknownStatus {
		problem(w, 409, "Conflict", "order changed; refresh and try again")
		return
	}
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	var email string
	_ = s.db.QueryRow(r.Context(), `SELECT email FROM users WHERE id=$1`, o.CustomerID).Scan(&email)
	txMsg := fmt.Sprintf("Order %s was refunded in full. Reason: %s.", o.Code, reason)
	s.queuePush(o.CustomerID, "Order refunded", txMsg)
	if email != "" {
		s.enqueueNow(JobEmailSend, fmt.Sprintf(`{"to":%q,"subject":"Your Trackfud order was refunded","body":%q}`, email, txMsg), time.Now())
	}
	if courierID != nil && *courierID != "" {
		s.queuePush(*courierID, "Delivery cancelled",
			fmt.Sprintf("Order %s was refunded by support; do not pick it up.", o.Code))
	}
	var ownerID string
	_ = s.db.QueryRow(r.Context(), `SELECT owner_id FROM merchants WHERE id=$1`, o.MerchantID).Scan(&ownerID)
	if ownerID != "" {
		s.queuePush(ownerID, "Order refunded by support",
			fmt.Sprintf("Order %s was cancelled and refunded in full. Reason: %s.", o.Code, reason))
	}
	updated, _ := s.loadOrder(r.Context(), o.ID)
	s.writeAudit(r.Context(), r, "order.refund", "order", o.ID, reason,
		map[string]any{"status": from, "payment_status": o.PayStatus},
		map[string]any{"status": "cancelled", "payment_status": "refunded", "funded": funded})
	writeJSON(w, 200, map[string]any{"order": s.adminOrderView(r.Context(), updated), "refunded": funded})
}
