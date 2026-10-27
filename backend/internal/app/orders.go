package app

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"Trackfud/internal/ledger"
	"Trackfud/internal/order"

	"github.com/jackc/pgx/v5"
)

// ---------- journal store (double-entry writes, same-tx) ----------

// ensureAccount returns the ledger account id, creating the row at zero
// balance when missing. Callers lock/spend within the same transaction.
func ensureAccount(ctx context.Context, tx pgx.Tx, ownerType, ownerID, kind, currency string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `INSERT INTO ledger_accounts(owner_type,owner_id,kind,currency) VALUES($1,$2,$3,$4)
		ON CONFLICT (owner_type,owner_id,kind,currency) DO UPDATE SET currency=EXCLUDED.currency RETURNING id`,
		ownerType, ownerID, kind, currency).Scan(&id)
	return id, err
}

// postEntry validates balance (sum zero per currency) and appends one
// immutable journal entry plus its postings, updating cached balances in the
// same transaction. A repeated idempotency key is a no-op returning nil, so
// retried webhooks and timeout races can never double-post.
func postEntry(ctx context.Context, tx pgx.Tx, kind, idemKey, refType, refID string, legs []ledger.Posting) error {
	if err := ledger.CheckBalanced(legs); err != nil {
		return err
	}
	var entryID string
	err := tx.QueryRow(ctx, `INSERT INTO journal_entries(kind,idempotency_key,ref_type,ref_id) VALUES($1,$2,$3,$4)
		ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, kind, idemKey, refType, refID).Scan(&entryID)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	for _, leg := range legs {
		ownerType, ownerID, accKind := splitAccount(leg.Account)
		acctID, err := ensureAccount(ctx, tx, ownerType, ownerID, accKind, leg.Currency)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO postings(entry_id,account_id,amount_minor,currency) VALUES($1,$2,$3,$4)`,
			entryID, acctID, leg.AmountMinor, leg.Currency); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE ledger_accounts SET balance_minor=balance_minor+$2 WHERE id=$1`,
			acctID, leg.AmountMinor); err != nil {
			return err
		}
	}
	return nil
}

// splitAccount parses "kind:ownerID" names built by the ledger package.
func splitAccount(a string) (ownerType, ownerID, kind string) {
	if i := strings.Index(a, ":"); i >= 0 {
		left, right := a[:i], a[i+1:]
		switch {
		case strings.HasSuffix(left, "_wallet"):
			return "customer", right, "customer_wallet"
		case strings.HasPrefix(left, "order_escrow"):
			return "order", right, "order_escrow"
		case strings.HasPrefix(left, "merchant_payable"):
			return "merchant", right, "merchant_payable"
		case strings.HasPrefix(left, "courier_earnings"):
			return "courier", right, "courier_earnings"
		default:
			return "global", right, left
		}
	}
	return "global", "global", a
}

// walletBalanceForUpdate locks the customer's wallet row and returns its
// balance in minor units.
func walletBalanceForUpdate(ctx context.Context, tx pgx.Tx, userID, currency string) (int64, error) {
	if _, err := ensureAccount(ctx, tx, "customer", userID, "customer_wallet", currency); err != nil {
		return 0, err
	}
	var bal int64
	err := tx.QueryRow(ctx, `SELECT balance_minor FROM ledger_accounts
		WHERE owner_type='customer' AND owner_id=$1 AND kind='customer_wallet' AND currency=$2 FOR UPDATE`, userID, currency).Scan(&bal)
	return bal, err
}

// ---------- Transition() ----------

var orderStampCol = map[string]string{
	order.StatusPlaced:    "placed_at",
	order.StatusAccepted:  "accepted_at",
	order.StatusReady:     "ready_at",
	order.StatusDelivered: "delivered_at",
	order.StatusCancelled: "cancelled_at",
	order.StatusRejected:  "cancelled_at",
}

// transitionOrder moves one order from one status to another in a single
// transaction: guarded UPDATE ... WHERE status=from, order_events append,
// caller-supplied ledger/job writes via apply, then commit. The WebSocket
// broadcast happens only after commit. A concurrent mover wins the guard
// and the loser gets a 409 conflict.
func (s *Server) transitionOrder(ctx context.Context, orderID, from, to, actorType, actorID, reason string, apply func(ctx context.Context, tx pgx.Tx) error) (customerID, merchantID, status string, err error) {
	if err := order.Check(from, to); err != nil {
		return "", "", "", err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", "", "", err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	setClause := "status=$2, updated_at=now()"
	if col, ok := orderStampCol[to]; ok {
		setClause += ", " + col + "=now()"
	}
	err = tx.QueryRow(ctx, `UPDATE orders SET `+setClause+` WHERE id=$1 AND status=$3
		RETURNING customer_id, merchant_id, status`, orderID, to, from).Scan(&customerID, &merchantID, &status)
	if err == pgx.ErrNoRows {
		return "", "", "", order.ErrForbiddenTransition
	}
	if err != nil {
		return "", "", "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id,reason)
		VALUES($1,$2,$3,$4,$5,$6)`, orderID, from, to, actorType, actorID, reason); err != nil {
		return "", "", "", err
	}
	if apply != nil {
		if err := apply(ctx, tx); err != nil {
			return "", "", "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", "", err
	}
	committed = true
	s.broadcastOrder(ctx, customerID, merchantID, orderID, to)
	return customerID, merchantID, status, nil
}

// broadcastOrder notifies the customer, the merchant owner, and the assigned
// courier after commit (the delivery status rides along when a search exists).
func (s *Server) broadcastOrder(ctx context.Context, customerID, merchantID, orderID, status string) {
	var ownerID string
	_ = s.db.QueryRow(ctx, `SELECT owner_id FROM merchants WHERE id=$1`, merchantID).Scan(&ownerID)
	var courierID *string
	var dstatus string
	_ = s.db.QueryRow(ctx, `SELECT courier_id, status FROM deliveries WHERE order_id=$1`, orderID).Scan(&courierID, &dstatus)
	m := map[string]any{"type": "order.status", "order_id": orderID, "status": status}
	if dstatus != "" {
		m["delivery_status"] = dstatus
	}
	msg, _ := json.Marshal(m)
	recipients := []string{customerID, ownerID}
	if courierID != nil {
		recipients = append(recipients, *courierID)
	}
	for _, uid := range recipients {
		if uid != "" {
			s.hub.Broadcast(uid, string(msg))
		}
	}
}

// ---------- order row helpers ----------

type orderRow struct {
	ID, Code, CustomerID, MerchantID, Status, Currency string
	Subtotal, Delivery, Service, Tip, Total            int64
	Commission, CourierFee                             int64
	Size, Spill, PayMethod, PayStatus                  string
	Lat, Lng                                           float64
	HasDropoff                                         bool
	DropoffNote, PickupCode, DropoffPin                string
	PrepMinutes                                        int
	ReadyAtEst, WindowStart, WindowEnd                 *time.Time
	CancelReason                                       string
	CreatedAt                                          time.Time
}

func scanOrderRow(r pgx.Row) (orderRow, error) {
	var o orderRow
	var lat, lng float64
	var ready, ws, we *time.Time
	err := r.Scan(&o.ID, &o.Code, &o.CustomerID, &o.MerchantID, &o.Status, &o.Currency,
		&o.Subtotal, &o.Delivery, &o.Service, &o.Tip, &o.Total, &o.Commission, &o.CourierFee,
		&o.Size, &o.Spill, &o.PayMethod, &o.PayStatus, &lat, &lng, &o.HasDropoff,
		&o.DropoffNote, &o.PickupCode, &o.DropoffPin, &o.PrepMinutes,
		&ready, &ws, &we, &o.CancelReason, &o.CreatedAt)
	if err != nil {
		return o, err
	}
	o.Lat, o.Lng = lat, lng
	o.ReadyAtEst, o.WindowStart, o.WindowEnd = ready, ws, we
	return o, nil
}

const orderCols = `id, code, customer_id, merchant_id, status, currency,
	subtotal_minor, delivery_fee_minor, service_fee_minor, tip_minor, total_minor,
	commission_minor, courier_fee_minor, size_class, spill_risk, payment_method, payment_status,
	COALESCE(ST_Y(dropoff::geometry), 0), COALESCE(ST_X(dropoff::geometry), 0), dropoff IS NOT NULL,
	dropoff_note, pickup_code, dropoff_pin, prep_minutes,
	ready_at_est, window_start, window_end, cancel_reason, created_at`

func (o orderRow) quote() order.Quote {
	return order.Quote{
		Currency: o.Currency, SubtotalMinor: o.Subtotal, DeliveryMinor: o.Delivery,
		ServiceMinor: o.Service, TipMinor: o.Tip, TotalMinor: o.Total,
		CommissionMinor: o.Commission, CourierFeeMinor: o.CourierFee,
		MerchantPayout: o.Subtotal - o.Commission,
		CourierPayout:  o.Delivery - o.CourierFee + o.Tip,
		PlatformTake:   o.Commission + o.Service + o.CourierFee,
	}
}

func money(amount int64, cur string) map[string]any {
	return map[string]any{"amount_minor": amount, "currency": cur}
}

func iso(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

// orderView shapes one order for a role: customers see their delivery PIN,
// merchants see the pickup code; neither sees the other's secret.
func (s *Server) orderView(ctx context.Context, o orderRow, role string) map[string]any {
	v := map[string]any{
		"id": o.ID, "code": o.Code, "status": o.Status, "merchant_id": o.MerchantID,
		"currency": o.Currency,
		"subtotal": money(o.Subtotal, o.Currency), "delivery_fee": money(o.Delivery, o.Currency),
		"service_fee": money(o.Service, o.Currency), "tip": money(o.Tip, o.Currency),
		"total": money(o.Total, o.Currency), "commission": money(o.Commission, o.Currency),
		"size_class": o.Size, "spill_risk": o.Spill,
		"payment_method": o.PaymentMethod(), "payment_status": o.PayStatus,
		"ready_at_est": iso(o.ReadyAtEst), "window_start": iso(o.WindowStart), "window_end": iso(o.WindowEnd),
		"cancel_reason": o.CancelReason, "created_at": o.CreatedAt.UTC().Format(time.RFC3339),
	}
	if o.HasDropoff {
		v["dropoff"] = map[string]any{"lat": o.Lat, "lng": o.Lng, "note": o.DropoffNote}
	}
	if role == "merchant" {
		v["pickup_code"] = o.PickupCode
	} else {
		v["delivery_pin"] = o.DropoffPin
	}
	return v
}

// PaymentMethod returns the wire value for the payment method column.
func (o orderRow) PaymentMethod() string { return o.PayMethod }

// refundLegsFor returns the escrow-release postings for an order plus their
// journal key: wallet orders pay the customer back, card orders return to
// Paddle clearing (Paddle settles back to the card off-ledger).
func refundLegsFor(o orderRow) ([]ledger.Posting, string) {
	if o.PayMethod == "card" {
		return ledger.CardRefundPostings(o.quote(), o.ID), ledger.CardRefundKey(o.ID)
	}
	return ledger.RefundPostings(o.quote(), o.CustomerID, o.ID), ledger.RefundKey(o.ID)
}

// markCardPaymentRefunded closes the Paddle payment behind a refunded card
// order; a no-op for wallet orders.
func markCardPaymentRefunded(ctx context.Context, tx pgx.Tx, orderID string) {
	_, _ = tx.Exec(ctx, `UPDATE payments SET status='refunded', updated_at=now()
		WHERE order_id=$1 AND status='paid'`, orderID)
}

// ---------- customer: create order (wallet pay) ----------

type createOrderItem struct {
	MenuItemID string `json:"menu_item_id"`
	Qty        int    `json:"qty"`
}

type createOrderBody struct {
	MerchantID    string            `json:"merchant_id"`
	Items         []createOrderItem `json:"items"`
	AddressID     string            `json:"address_id"`
	Lat           *float64          `json:"lat"`
	Lng           *float64          `json:"lng"`
	Note          string            `json:"note"`
	TipMinor      int64             `json:"tip_minor"`
	PaymentMethod string            `json:"payment_method"`
}

func (s *Server) createOrder(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	if !requireRole(w, r, "customer", "admin") {
		return
	}
	var b createOrderBody
	if !decode(w, r, &b) {
		return
	}
	// Endpoint idempotency: a retried request with the same key returns the
	// stored response instead of charging twice.
	idemKey := r.Header.Get("Idempotency-Key")
	if idemKey != "" {
		var st int
		var resp []byte
		if err := s.db.QueryRow(r.Context(), `SELECT status, response FROM idempotency_keys
			WHERE key=$1 AND user_id=$2 AND endpoint='create_order'`, idemKey, c.Sub).Scan(&st, &resp); err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(st)
			_, _ = w.Write(resp)
			return
		}
	}
	if len(b.Items) == 0 || len(b.Items) > 20 {
		problem(w, 400, "Validation failed", "1-20 order items required")
		return
	}
	if b.TipMinor < 0 {
		problem(w, 400, "Validation failed", "tip cannot be negative")
		return
	}
	// Collapse repeated lines for the same item (order_items is keyed per item).
	merged := map[string]int{}
	var itemOrder []string
	for _, it := range b.Items {
		if _, ok := merged[it.MenuItemID]; !ok {
			itemOrder = append(itemOrder, it.MenuItemID)
		}
		merged[it.MenuItemID] += it.Qty
	}
	b.Items = b.Items[:0]
	for _, id := range itemOrder {
		b.Items = append(b.Items, createOrderItem{MenuItemID: id, Qty: merged[id]})
	}
	// Merchant must be orderable.
	var mCur, mStatus string
	var mLat, mLng *float64
	var mPrep int
	err := s.db.QueryRow(r.Context(), `SELECT currency, status,
		ST_Y(location::geometry), ST_X(location::geometry), prep_minutes
		FROM merchants WHERE id=$1`, b.MerchantID).Scan(&mCur, &mStatus, &mLat, &mLng, &mPrep)
	if err != nil || mStatus != "approved" || mLat == nil {
		problem(w, 400, "Validation failed", "restaurant is not available for delivery")
		return
	}
	// Dropoff: saved address or explicit pin.
	var lat, lng float64
	note := b.Note
	if b.AddressID != "" {
		if err := s.db.QueryRow(r.Context(), `SELECT lat, lng, note FROM customer_addresses WHERE id=$1 AND user_id=$2`,
			b.AddressID, c.Sub).Scan(&lat, &lng, &note); err != nil {
			problem(w, 400, "Validation failed", "delivery address not found")
			return
		}
		if b.Note != "" {
			note = b.Note
		}
	} else if b.Lat != nil && b.Lng != nil {
		lat, lng = *b.Lat, *b.Lng
	} else {
		problem(w, 400, "Validation failed", "address_id or lat/lng required")
		return
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		problem(w, 400, "Validation failed", "dropoff coordinates out of range")
		return
	}
	// Items: same merchant, available, travels-well gate (app-context §3).
	type picked struct {
		id    string
		name  []byte
		price int64
		size  string
		spill string
		qty   int
	}
	var items []picked
	var subtotal int64
	worstSize, worstSpill := 0, 0
	sizeRank := map[string]int{"S": 0, "M": 1, "L": 2}
	spillRank := map[string]int{"low": 0, "medium": 1, "high": 2}
	for _, it := range b.Items {
		if it.Qty < 1 || it.Qty > 20 {
			problem(w, 400, "Validation failed", "item qty must be 1-20")
			return
		}
		var p picked
		var avail, tw bool
		err := s.db.QueryRow(r.Context(), `SELECT id, name, price_minor, size_class, spill_risk, available, travels_well
			FROM menu_items WHERE id=$1 AND merchant_id=$2`, it.MenuItemID, b.MerchantID).Scan(
			&p.id, &p.name, &p.price, &p.size, &p.spill, &avail, &tw)
		if err != nil {
			problem(w, 400, "Validation failed", "menu item not found at this restaurant")
			return
		}
		if !avail {
			problem(w, 400, "Validation failed", "a menu item is sold out")
			return
		}
		if !tw {
			problem(w, 400, "Validation failed", "a menu item is pickup-only (does not travel well)")
			return
		}
		p.qty = it.Qty
		items = append(items, p)
		subtotal += p.price * int64(it.Qty)
		if sizeRank[p.size] > worstSize {
			worstSize = sizeRank[p.size]
		}
		if spillRank[p.spill] > worstSpill {
			worstSpill = spillRank[p.spill]
		}
	}
	sizes := []string{"S", "M", "L"}
	spills := []string{"low", "medium", "high"}
	// Server-quoted distance and fees (never trust client math).
	var distM float64
	err = s.db.QueryRow(r.Context(), `SELECT ST_Distance(
		ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
		ST_SetSRID(ST_MakePoint($3,$4),4326)::geography)`, *mLng, *mLat, lng, lat).Scan(&distM)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	q := order.QuoteFor(order.QuoteInput{SubtotalMinor: subtotal, DistanceKm: distM / 1000, Currency: mCur, TipMinor: b.TipMinor})
	payMethod := strings.ToLower(strings.TrimSpace(b.PaymentMethod))
	if payMethod == "" {
		payMethod = "wallet"
	}
	if payMethod != "wallet" && payMethod != "card" {
		problem(w, 400, "Validation failed", "payment_method must be wallet or card")
		return
	}
	if payMethod == "card" && !s.cardPaymentsEnabled() {
		problem(w, 503, "Unavailable", "card payments are disabled: Paddle sandbox only")
		return
	}
	code, pin, err := newOrderSecrets()
	if err != nil {
		problem(w, 500, "Server error", "could not generate order codes")
		return
	}
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	if payMethod == "wallet" {
		bal, err := walletBalanceForUpdate(ctx, tx, c.Sub, mCur)
		if err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
		if bal < q.TotalMinor {
			_ = tx.Rollback(ctx)
			committed = true // already rolled back; suppress deferred rollback
			problem(w, 402, "Insufficient balance", "wallet balance too low for this order; top up first")
			return
		}
	}
	// Wallet orders charge at once (placed + held in escrow); card orders
	// wait for the Paddle webhook, which moves them awaiting_payment→placed.
	initStatus, payStatus := "placed", "held"
	var placedAt any = time.Now()
	if payMethod == "card" {
		initStatus, payStatus, placedAt = "awaiting_payment", "unpaid", nil
	}
	var orderID string
	err = tx.QueryRow(ctx, `INSERT INTO orders(code,customer_id,merchant_id,status,currency,
		subtotal_minor,delivery_fee_minor,service_fee_minor,tip_minor,total_minor,
		commission_minor,courier_fee_minor,size_class,spill_risk,payment_method,payment_status,
		dropoff,dropoff_note,dropoff_pin,prep_minutes,placed_at,idempotency_key)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
		ST_SetSRID(ST_MakePoint($17,$18),4326)::geography,$19,$20,$21,$22,$23) RETURNING id`,
		code, c.Sub, b.MerchantID, initStatus, mCur, q.SubtotalMinor, q.DeliveryMinor, q.ServiceMinor,
		q.TipMinor, q.TotalMinor, q.CommissionMinor, q.CourierFeeMinor,
		sizes[worstSize], spills[worstSpill], payMethod, payStatus,
		lng, lat, note, pin, mPrep, placedAt, sqlNullIfEmpty(idemKey)).Scan(&orderID)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			problem(w, 409, "Conflict", "duplicate order; retry with a new idempotency key")
			return
		}
		problem(w, 500, "Server error", err.Error())
		return
	}
	for _, p := range items {
		if _, err := tx.Exec(ctx, `INSERT INTO order_items(order_id,menu_item_id,name_snapshot,unit_price_minor,qty)
			VALUES($1,$2,$3,$4,$5)`, orderID, p.id, p.name, p.price, p.qty); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
	}
	var pay paymentRow
	if payMethod == "card" {
		if _, err := tx.Exec(ctx, `INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id,reason)
			VALUES($1,'created','awaiting_payment','customer',$2,'card payment started (Paddle sandbox)')`, orderID, c.Sub); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
		// The card leg shares the Paddle payment path with top-ups: one
		// pending row, confirmed by the same webhook apply.
		if pay, err = insertPayment(ctx, tx, c.Sub, "order", orderID, q.TotalMinor, mCur, idemKey); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
	} else {
		if _, err := tx.Exec(ctx, `INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id,reason)
			VALUES($1,'awaiting_payment','placed','customer',$2,'wallet charged')`, orderID, c.Sub); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
		if err := postEntry(ctx, tx, "order_charge", ledger.ChargeKey(orderID), "order", orderID,
			ledger.ChargePostings(q, c.Sub, orderID)); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
		runAt := time.Now().Add(time.Duration(s.cfg.Order.MerchantAcceptWindowS) * time.Second)
		if _, err := tx.Exec(ctx, `INSERT INTO jobs(kind,payload,run_at) VALUES('merchant_accept_timeout',$1,$2)`,
			fmt.Sprintf(`{"order_id":%q}`, orderID), runAt); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	committed = true
	s.broadcastOrder(ctx, c.Sub, b.MerchantID, orderID, initStatus)
	o, err := s.loadOrder(ctx, orderID)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	resp := map[string]any{"order": s.orderView(ctx, o, "customer")}
	if payMethod == "card" {
		resp["payment"] = paymentView(pay)
	}
	body, _ := json.Marshal(resp)
	if idemKey != "" {
		_, _ = s.db.Exec(ctx, `INSERT INTO idempotency_keys(key,user_id,endpoint,status,response) VALUES($1,$2,'create_order',201,$3)
			ON CONFLICT DO NOTHING`, idemKey, c.Sub, body)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(201)
	_, _ = w.Write(body)
}

// ---------- customer: read + cancel ----------

func (s *Server) loadOrder(ctx context.Context, orderID string) (orderRow, error) {
	return scanOrderRow(s.db.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE id=$1`, orderID))
}

func (s *Server) getOrder(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	o, err := s.loadOrder(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	role := "customer"
	if o.CustomerID != c.Sub {
		// Merchant owners read their own orders; others are forbidden.
		var owner string
		_ = s.db.QueryRow(r.Context(), `SELECT owner_id FROM merchants WHERE id=$1`, o.MerchantID).Scan(&owner)
		isAdmin := false
		for _, rl := range c.Roles {
			if rl == "admin" {
				isAdmin = true
			}
		}
		if owner == "" || (owner != c.Sub && !isAdmin) {
			problem(w, 403, "Forbidden", "not your order")
			return
		}
		role = "merchant"
	}
	items, _ := s.orderItems(r.Context(), o.ID)
	events, _ := s.orderEvents(r.Context(), o.ID)
	v := s.orderView(r.Context(), o, role)
	v["items"] = items
	v["events"] = events
	if dv := s.deliveryPublicView(r.Context(), o.ID); dv != nil {
		v["delivery"] = dv
	}
	writeJSON(w, 200, map[string]any{"order": v})
}

func (s *Server) orderItems(ctx context.Context, orderID string) ([]map[string]any, error) {
	rows, err := s.db.Query(ctx, `SELECT menu_item_id, name_snapshot, unit_price_minor, qty FROM order_items WHERE order_id=$1`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cur string
	_ = s.db.QueryRow(ctx, `SELECT currency FROM orders WHERE id=$1`, orderID).Scan(&cur)
	out := []map[string]any{}
	for rows.Next() {
		var mid string
		var nameB []byte
		var price int64
		var qty int
		if err := rows.Scan(&mid, &nameB, &price, &qty); err != nil {
			continue
		}
		var name map[string]string
		_ = json.Unmarshal(nameB, &name)
		out = append(out, map[string]any{"menu_item_id": mid, "name": name,
			"unit_price": money(price, cur), "qty": qty, "line_total": money(price*int64(qty), cur)})
	}
	return out, nil
}

func (s *Server) orderEvents(ctx context.Context, orderID string) ([]map[string]any, error) {
	rows, err := s.db.Query(ctx, `SELECT from_status, to_status, actor_type, created_at FROM order_events WHERE order_id=$1 ORDER BY created_at`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var from, to, actor string
		var at time.Time
		if err := rows.Scan(&from, &to, &actor, &at); err != nil {
			continue
		}
		out = append(out, map[string]any{"from": from, "to": to, "actor": actor, "at": at.UTC().Format(time.RFC3339)})
	}
	return out, nil
}

func (s *Server) listCustomerOrders(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	rows, err := s.db.Query(r.Context(), `SELECT `+orderCols+` FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 50`, c.Sub)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		o, err := scanOrderRow(rows)
		if err != nil {
			continue
		}
		out = append(out, s.orderView(r.Context(), o, "customer"))
	}
	writeJSON(w, 200, map[string]any{"orders": out})
}

func (s *Server) cancelOrder(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	o, err := s.loadOrder(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	if o.CustomerID != c.Sub {
		problem(w, 403, "Forbidden", "not your order")
		return
	}
	if o.Status != order.StatusAwaitingPayment && o.Status != order.StatusPlaced {
		problem(w, 409, "Conflict", "order can no longer be cancelled in the app; contact support")
		return
	}
	refund := o.Status == order.StatusPlaced
	_, _, _, err = s.transitionOrder(r.Context(), o.ID, o.Status, order.StatusCancelled, "customer", c.Sub,
		"cancelled by customer before merchant accept", func(ctx context.Context, tx pgx.Tx) error {
			if !refund {
				// Awaiting payment: no money moved, just drop the card intent.
				_, _ = tx.Exec(ctx, `UPDATE payments SET status='cancelled', updated_at=now()
					WHERE order_id=$1 AND status='pending'`, o.ID)
				return nil
			}
			if _, err := tx.Exec(ctx, `UPDATE orders SET payment_status='refunded', cancel_reason='cancelled by customer' WHERE id=$1`, o.ID); err != nil {
				return err
			}
			legs, key := refundLegsFor(o)
			markCardPaymentRefunded(ctx, tx, o.ID)
			return postEntry(ctx, tx, "order_refund", key, "order", o.ID, legs)
		})
	if err == order.ErrForbiddenTransition || err == order.ErrUnknownStatus {
		problem(w, 409, "Conflict", "order changed; refresh and try again")
		return
	}
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	updated, _ := s.loadOrder(r.Context(), o.ID)
	writeJSON(w, 200, map[string]any{"order": s.orderView(r.Context(), updated, "customer"), "refunded": refund})
}

// ---------- merchant: accept / reject / ready ----------

// merchantOwnsOrder checks the caller owns the merchant behind the order.
func (s *Server) merchantOwnsOrder(w http.ResponseWriter, r *http.Request, o orderRow) bool {
	c := claims(r)
	for _, rl := range c.Roles {
		if rl == "admin" {
			return true
		}
	}
	var owner string
	_ = s.db.QueryRow(r.Context(), `SELECT owner_id FROM merchants WHERE id=$1`, o.MerchantID).Scan(&owner)
	if owner == "" || owner != c.Sub {
		problem(w, 403, "Forbidden", "not your restaurant's order")
		return false
	}
	return true
}

func (s *Server) acceptOrder(w http.ResponseWriter, r *http.Request) {
	o, err := s.loadOrder(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	if !s.merchantOwnsOrder(w, r, o) {
		return
	}
	if o.Status != order.StatusPlaced {
		problem(w, 409, "Conflict", "only placed orders can be accepted")
		return
	}
	var prep int
	_ = s.db.QueryRow(r.Context(), `SELECT prep_minutes FROM merchants WHERE id=$1`, o.MerchantID).Scan(&prep)
	if prep <= 0 {
		prep = 15
	}
	now := time.Now()
	readyEst := now.Add(time.Duration(prep) * time.Minute)
	winStart := now.Add(time.Duration(s.cfg.Order.WindowMinMinutes) * time.Minute)
	winEnd := now.Add(time.Duration(s.cfg.Order.WindowMaxMinutes) * time.Minute)
	pickup := randomDigits(4)
	_, _, _, err = s.transitionOrder(r.Context(), o.ID, order.StatusPlaced, order.StatusAccepted,
		"merchant", claims(r).Sub, "merchant accepted", func(ctx context.Context, tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `UPDATE orders SET ready_at_est=$2, window_start=$3, window_end=$4, pickup_code=$5 WHERE id=$1`,
				o.ID, readyEst, winStart, winEnd, pickup); err != nil {
				return err
			}
			// The delivery search (B4 dispatch) starts here so the courier can
			// keep training while the kitchen cooks. Search timeout + first
			// cascade step are queued in the same transaction.
			if _, err := tx.Exec(ctx, `INSERT INTO deliveries(order_id,type,status,pickup_code,dropoff_pin,search_started_at)
				VALUES($1,'workout','searching',$2,$3,now()) ON CONFLICT (order_id) DO NOTHING`, o.ID, pickup, o.DropoffPin); err != nil {
				return err
			}
			var deliveryID string
			_ = tx.QueryRow(ctx, `SELECT id FROM deliveries WHERE order_id=$1`, o.ID).Scan(&deliveryID)
			_, _ = tx.Exec(ctx, `UPDATE deliveries SET trip_m=(
				SELECT ST_Distance(m.location, o.dropoff) FROM orders o
				JOIN merchants m ON m.id=o.merchant_id WHERE o.id=$1) WHERE order_id=$1`, o.ID)
			if deliveryID != "" {
				now := time.Now()
				if err := enqueueTx(ctx, tx, "search_timeout", fmt.Sprintf(`{"delivery_id":%q}`, deliveryID),
					now.Add(time.Duration(s.cfg.Dispatch.SearchS)*time.Second)); err != nil {
					return err
				}
				if err := enqueueTx(ctx, tx, "dispatch_run", fmt.Sprintf(`{"delivery_id":%q}`, deliveryID), now); err != nil {
					return err
				}
			}
			return nil
		})
	if err == order.ErrForbiddenTransition {
		problem(w, 409, "Conflict", "order changed; refresh and try again")
		return
	}
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	// First cascade step right away (the in-tx dispatch_run job is the
	// crash-safe backup; runCascade is idempotent so both are safe).
	if d, err := s.loadDeliveryByOrder(r.Context(), o.ID); err == nil {
		s.runCascade(r.Context(), d.ID)
	}
	updated, _ := s.loadOrder(r.Context(), o.ID)
	writeJSON(w, 200, map[string]any{"order": s.orderView(r.Context(), updated, "merchant")})
}

func (s *Server) rejectOrder(w http.ResponseWriter, r *http.Request) {
	o, err := s.loadOrder(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	if !s.merchantOwnsOrder(w, r, o) {
		return
	}
	if o.Status != order.StatusPlaced {
		problem(w, 409, "Conflict", "only placed orders can be rejected")
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
	_, _, _, err = s.transitionOrder(r.Context(), o.ID, order.StatusPlaced, order.StatusRejected,
		"merchant", claims(r).Sub, "rejected: "+b.Reason, func(ctx context.Context, tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `UPDATE orders SET payment_status='refunded', cancel_reason=$2 WHERE id=$1`, o.ID, b.Reason); err != nil {
				return err
			}
			legs, key := refundLegsFor(o)
			markCardPaymentRefunded(ctx, tx, o.ID)
			return postEntry(ctx, tx, "order_refund", key, "order", o.ID, legs)
		})
	if err == order.ErrForbiddenTransition {
		problem(w, 409, "Conflict", "order changed; refresh and try again")
		return
	}
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	_, _ = s.db.Exec(r.Context(), `INSERT INTO jobs(kind,payload) VALUES('push_send',$1)`,
		fmt.Sprintf(`{"user_id":%q,"title":"Order update","body":"The restaurant could not take your order; you were refunded in full."}`, o.CustomerID))
	updated, _ := s.loadOrder(r.Context(), o.ID)
	writeJSON(w, 200, map[string]any{"order": s.orderView(r.Context(), updated, "merchant"), "refunded": true})
}

func (s *Server) readyOrder(w http.ResponseWriter, r *http.Request) {
	o, err := s.loadOrder(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	if !s.merchantOwnsOrder(w, r, o) {
		return
	}
	if o.Status != order.StatusAccepted {
		problem(w, 409, "Conflict", "only accepted orders can be marked ready")
		return
	}
	_, _, _, err = s.transitionOrder(r.Context(), o.ID, order.StatusAccepted, order.StatusReady,
		"merchant", claims(r).Sub, "food ready", nil)
	if err == order.ErrForbiddenTransition {
		problem(w, 409, "Conflict", "order changed; refresh and try again")
		return
	}
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	// Ready early: the assigned courier heads over at once (the nudged_at
	// guard drops this if the scheduled nudge already fired).
	if d, err := s.loadDeliveryByOrder(r.Context(), o.ID); err == nil &&
		(d.Status == DeliveryAssigned || d.Status == DeliveryAtPickup) && d.NudgedAt == nil {
		s.enqueueNow("leave_now_nudge", fmt.Sprintf(`{"delivery_id":%q}`, d.ID), time.Now())
	}
	updated, _ := s.loadOrder(r.Context(), o.ID)
	writeJSON(w, 200, map[string]any{"order": s.orderView(r.Context(), updated, "merchant")})
}

func (s *Server) listMerchantOrders(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	m, err := s.fetchMerchant(r, c.Sub)
	if err != nil {
		problem(w, 400, "Validation failed", "create your store profile first")
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+orderCols+` FROM orders WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 50`, m["id"])
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		o, err := scanOrderRow(rows)
		if err != nil {
			continue
		}
		out = append(out, s.orderView(r.Context(), o, "merchant"))
	}
	writeJSON(w, 200, map[string]any{"orders": out})
}

// ---------- merchant_accept_timeout worker ----------

// handleMerchantTimeout cancels a still-placed order and refunds the wallet
// in full when the merchant never answered in time (AGENTS.md §5).
func (s *Server) handleMerchantTimeout(ctx context.Context, orderID string) {
	o, err := s.loadOrder(ctx, orderID)
	if err != nil || o.Status != order.StatusPlaced {
		return
	}
	_, _, _, err = s.transitionOrder(ctx, o.ID, order.StatusPlaced, order.StatusCancelled,
		"system", "", "merchant_accept_timeout: no answer in time", func(ctx context.Context, tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `UPDATE orders SET payment_status='refunded', cancel_reason='restaurant did not respond in time' WHERE id=$1`, o.ID); err != nil {
				return err
			}
			legs, key := refundLegsFor(o)
			markCardPaymentRefunded(ctx, tx, o.ID)
			return postEntry(ctx, tx, "order_refund", key, "order", o.ID, legs)
		})
	if err != nil {
		s.log.Warn("merchant timeout transition failed", "order", orderID, "err", err)
		return
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO jobs(kind,payload) VALUES('push_send',$1)`,
		fmt.Sprintf(`{"user_id":%q,"title":"Order update","body":"The restaurant did not respond; you were refunded in full."}`, o.CustomerID))
}

// ---------- small helpers ----------

// newOrderSecrets generates a human-readable order code, a 4-digit delivery
// PIN for the customer, and reports crypto failures.
func newOrderSecrets() (code, pin string, err error) {
	const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	b := make([]byte, 6)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", "", err
		}
		b[i] = alphabet[n.Int64()]
	}
	return "TB-" + string(b), randomDigits(4), nil
}

func randomDigits(n int) string {
	var sb strings.Builder
	for i := 0; i < n; i++ {
		d, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			sb.WriteByte('0')
			continue
		}
		sb.WriteByte(byte('0' + d.Int64()))
	}
	return sb.String()
}

func sqlNullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
