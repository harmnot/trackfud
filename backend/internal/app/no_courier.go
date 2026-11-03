package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"Trackfud/internal/order"

	"github.com/jackc/pgx/v5"
)

// ---------- No-courier choices (POST /v1/customer/orders/{id}/delivery-choice) ----------
//
// Dispatch starts at merchant accept, so it can only give up (delivery
// `no_courier`) on an order the kitchen already accepted: `accepted` while
// cooking, or `ready` after the food-ready wave also ran dry. That is the
// window where the customer chooses: keep searching (fresh courier wave),
// collect it themselves, or cancel with a full refund.

// noteNoCourierCancel is the cancel note on a given-up delivery the
// customer cancelled. The pickup switch is stamped DeliveryCustomerPick
// instead: the deliveries status check has no customer_pickup value, so the
// switch persists as cancelled + that note, which also keeps the row out of
// every later dispatch wave (canRestartCourierSearch never restarts it).
const noteNoCourierCancel = "customer_cancel_no_courier"

// releaseNoCourierSQL closes a given-up delivery for the pickup or cancel
// choice ($1 delivery id, $2 cancel note). The WHERE clause is the race
// story: only a row still in no_courier with nobody on it flips, so a
// food-ready wave or a courier that claimed the order in between keeps it
// (0 rows: the caller answers 409 and the customer sees the fresh state).
const releaseNoCourierSQL = `UPDATE deliveries SET status='cancelled', cancel_note=$2
WHERE id=$1 AND status='no_courier' AND courier_id IS NULL`

// errNoCourierChoiceStale reports that dispatch moved on between the read
// and the guarded write (a fresh wave started or a courier claimed it).
var errNoCourierChoiceStale = errors.New("no-courier choice: delivery moved on")

// Wire values of the three choices (OpenAPI DeliveryChoice.choice).
const (
	choiceWaitMore = "wait_more"
	choicePickup   = "pickup"
	choiceCancel   = "cancel"
)

// isNoCourierChoice reports whether a wire value names one of the choices.
func isNoCourierChoice(choice string) bool {
	switch choice {
	case choiceWaitMore, choicePickup, choiceCancel:
		return true
	}
	return false
}

// noCourierChoiceAllowed is the pure guard behind delivery-choice: dispatch
// gave up (no_courier, nobody claimed it) on an order the kitchen accepted
// and nobody has collected yet. Placed orders have no delivery (dispatch
// starts at accept) and cancel through the regular customer cancel.
func noCourierChoiceAllowed(orderStatus, deliveryStatus string, hasCourier bool) bool {
	if hasCourier || deliveryStatus != DeliveryNoCourier {
		return false
	}
	return orderStatus == order.StatusAccepted || orderStatus == order.StatusReady
}

// isCustomerPickup reports a delivery the customer switched to self-pickup
// (exposed as `customer_pickup` on the public delivery view).
func isCustomerPickup(status, cancelNote string) bool {
	return status == DeliveryCancelled && cancelNote == DeliveryCustomerPick
}

// deliveryChoice runs one of the three no-courier choices for the caller's
// own order. Every choice re-checks the guard against fresh rows and loses
// cleanly (409) when dispatch moved on in between.
func (s *Server) deliveryChoice(w http.ResponseWriter, r *http.Request) {
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
	var b struct {
		Choice string `json:"choice"`
	}
	if !decode(w, r, &b) {
		return
	}
	if !isNoCourierChoice(b.Choice) {
		problem(w, 400, "Validation failed", "choice must be wait_more, pickup, or cancel")
		return
	}
	d, err := s.loadDeliveryByOrder(r.Context(), o.ID)
	if err != nil || !noCourierChoiceAllowed(o.Status, d.Status, d.CourierID != nil) {
		problem(w, 409, "Conflict", "courier choices are only available when no courier was found")
		return
	}
	switch b.Choice {
	case choiceWaitMore:
		s.chooseKeepSearching(w, r, o, d)
	case choicePickup:
		s.chooseSelfPickup(w, r, o, d)
	default:
		s.chooseNoCourierCancel(w, r, o, d)
	}
}

// chooseKeepSearching starts a fresh courier-first wave with the same
// machinery as the food-ready restart (stale offers cleared, CMS-effective
// search window, order.status broadcast so every screen flips to searching).
func (s *Server) chooseKeepSearching(w http.ResponseWriter, r *http.Request, o orderRow, d deliveryRow) {
	if !s.restartCourierSearch(r.Context(), d.ID, false) {
		problem(w, 409, "Conflict", "a courier was just found; refresh and try again")
		return
	}
	updated, _ := s.loadDeliveryByOrder(r.Context(), o.ID)
	writeJSON(w, 200, map[string]any{"choice": choiceWaitMore, "delivery_status": updated.Status})
}

// chooseSelfPickup ends the courier search for good: the customer collects
// at the counter. Codes stay in their pairs: the customer identifies with
// the order code both screens show, the kitchen's pickup code stays on the
// kitchen screen, and the delivery PIN (customer<->courier) is not used.
func (s *Server) chooseSelfPickup(w http.ResponseWriter, r *http.Request, o orderRow, d deliveryRow) {
	ctx := r.Context()
	tag, err := s.db.Exec(ctx, releaseNoCourierSQL, d.ID, DeliveryCustomerPick)
	if err != nil {
		s.log.Warn("pickup switch failed", "order", o.ID, "err", err)
		problem(w, 500, "Server error", "could not switch to pickup; try again")
		return
	}
	if tag.RowsAffected() == 0 {
		problem(w, 409, "Conflict", "a courier was just found; refresh and try again")
		return
	}
	s.pushMerchantOwner(ctx, o.MerchantID, "Customer will collect "+o.Code,
		fmt.Sprintf("No courier was free, so the customer is collecting order %s at your counter. "+
			"Hand it over when they give you that order code.", o.Code))
	// Customer + kitchen screens refetch at once (delivery_status=cancelled).
	s.broadcastOrder(ctx, o.CustomerID, o.MerchantID, o.ID, o.Status)
	writeJSON(w, 200, map[string]any{"choice": choicePickup, "delivery_status": DeliveryCancelled,
		"customer_pickup": true})
}

// chooseNoCourierCancel cancels an accepted or ready order whose search ran
// dry and refunds it in full through the ledger refund legs, all in one
// transaction with the guarded delivery release.
func (s *Server) chooseNoCourierCancel(w http.ResponseWriter, r *http.Request, o orderRow, d deliveryRow) {
	c := claims(r)
	_, _, _, err := s.transitionOrder(r.Context(), o.ID, o.Status, order.StatusCancelled,
		"customer", c.Sub, "cancelled: no courier and no staff", func(ctx context.Context, tx pgx.Tx) error {
			tag, err := tx.Exec(ctx, releaseNoCourierSQL, d.ID, noteNoCourierCancel)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return errNoCourierChoiceStale
			}
			if _, err := tx.Exec(ctx, `UPDATE orders SET payment_status='refunded',
				cancel_reason='no courier available' WHERE id=$1`, o.ID); err != nil {
				return err
			}
			legs, key := refundLegsFor(o)
			markCardPaymentRefunded(ctx, tx, o.ID)
			return postEntry(ctx, tx, "order_refund", key, "order", o.ID, legs)
		})
	switch {
	case errors.Is(err, errNoCourierChoiceStale):
		problem(w, 409, "Conflict", "a courier was just found; refresh and try again")
		return
	case errors.Is(err, order.ErrForbiddenTransition), errors.Is(err, order.ErrUnknownStatus):
		problem(w, 409, "Conflict", "order changed; refresh and try again")
		return
	case err != nil:
		s.log.Warn("no-courier cancel failed", "order", o.ID, "err", err)
		problem(w, 500, "Server error", "could not cancel the order; try again")
		return
	}
	s.pushMerchantOwner(r.Context(), o.MerchantID, "Order cancelled",
		fmt.Sprintf("No courier was free, so the customer cancelled order %s with a full refund. Stop preparing it.", o.Code))
	updated, _ := s.loadOrder(r.Context(), o.ID)
	writeJSON(w, 200, map[string]any{"choice": choiceCancel,
		"order": s.orderView(r.Context(), updated, "customer"), "refunded": true})
}

// pushMerchantOwner sends one push to the account that owns the merchant.
func (s *Server) pushMerchantOwner(ctx context.Context, merchantID, title, body string) {
	var ownerID string
	_ = s.db.QueryRow(ctx, `SELECT owner_id FROM merchants WHERE id=$1`, merchantID).Scan(&ownerID)
	if ownerID != "" {
		s.queuePush(ownerID, title, body)
	}
}
