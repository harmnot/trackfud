package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"Trackfud/internal/ai"
	"Trackfud/internal/order"
)

// ---------- Social B4: ratings, cheers, chat, impact ----------
//
// These close the R2/B4 gap the frontends queue against. Each stays tight:
// one table, one guarded write, WS + push on the side. Translation and
// moderation of chat arrive with the B6 AI jobs. The no-courier choices
// live in no_courier.go.

// rateOrder records the separate courier + restaurant ratings (one per
// order). Courier stars feed the Bayesian average; tags are free-form.
func (s *Server) rateOrder(w http.ResponseWriter, r *http.Request) {
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
	if o.Status != order.StatusDelivered && o.Status != order.StatusCompleted {
		problem(w, 409, "Conflict", "you can rate once the order is delivered")
		return
	}
	var b struct {
		CourierStars    *int     `json:"courier_stars"`
		CourierTags     []string `json:"courier_tags"`
		RestaurantStars *int     `json:"restaurant_stars"`
	}
	if !decode(w, r, &b) {
		return
	}
	if b.CourierStars == nil && b.RestaurantStars == nil {
		problem(w, 400, "Validation failed", "rate the courier, the restaurant, or both")
		return
	}
	if b.CourierStars != nil && (*b.CourierStars < 1 || *b.CourierStars > 5) {
		problem(w, 400, "Validation failed", "courier_stars must be 1-5")
		return
	}
	if b.RestaurantStars != nil && (*b.RestaurantStars < 1 || *b.RestaurantStars > 5) {
		problem(w, 400, "Validation failed", "restaurant_stars must be 1-5")
		return
	}
	if len(b.CourierTags) > 5 {
		problem(w, 400, "Validation failed", "at most 5 courier tags")
		return
	}
	for _, t := range b.CourierTags {
		if len(t) > 40 {
			problem(w, 400, "Validation failed", "courier tags must be under 40 chars")
			return
		}
	}
	d, err := s.loadDeliveryByOrder(r.Context(), o.ID)
	if err != nil {
		problem(w, 409, "Conflict", "no delivery to rate")
		return
	}
	tagsB, _ := json.Marshal(b.CourierTags)
	if b.CourierTags == nil {
		tagsB = []byte("[]")
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var exists bool
	_ = tx.QueryRow(r.Context(), `SELECT true FROM order_ratings WHERE order_id=$1`, o.ID).Scan(&exists)
	if exists {
		problem(w, 409, "Conflict", "this order is already rated")
		return
	}
	var courierID any
	if d.CourierID != nil {
		courierID = *d.CourierID
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO order_ratings(order_id,customer_id,courier_id,courier_stars,courier_tags,restaurant_stars)
		VALUES($1,$2,$3,$4,$5,$6)`, o.ID, c.Sub, courierID, intOrNil(b.CourierStars), string(tagsB), intOrNil(b.RestaurantStars)); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	// Bayesian average: (10 × 4.5 + stars) ÷ (10 + count).
	if b.CourierStars != nil && d.CourierID != nil {
		_, _ = tx.Exec(r.Context(), `UPDATE couriers SET rating_stars_sum=rating_stars_sum+$2,
			rating_count=rating_count+1,
			rating_bayes=(45.0+rating_stars_sum+$2::bigint)/(10.0+rating_count+1),
			updated_at=now() WHERE user_id=$1`, *d.CourierID, *b.CourierStars)
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	// B6: topic labels for the support queue (idempotent job).
	s.enqueueNow(AIJobFeedbackLabels, fmt.Sprintf(`{"order_id":%q}`, o.ID), time.Now())
	writeJSON(w, 201, map[string]any{"rated": true})
}

func intOrNil(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

// cheerOrder sends the courier a short encouragement (max 3/min per order
// so the Voice Copilot never becomes a megaphone).
func (s *Server) cheerOrder(w http.ResponseWriter, r *http.Request) {
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
		Message string `json:"message"`
	}
	if !decode(w, r, &b) {
		return
	}
	msg := strings.TrimSpace(b.Message)
	if msg == "" || len(msg) > 140 {
		problem(w, 400, "Validation failed", "message must be 1-140 chars")
		return
	}
	d, err := s.loadDeliveryByOrder(r.Context(), o.ID)
	if err != nil || d.CourierID == nil {
		problem(w, 409, "Conflict", "cheers need an assigned courier")
		return
	}
	switch d.Status {
	case DeliveryAssigned, DeliveryAtPickup, DeliveryPickedUp, DeliveryAtDropoff:
	default:
		problem(w, 409, "Conflict", "cheers are for live deliveries only")
		return
	}
	var recent int
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM order_cheers
		WHERE order_id=$1 AND created_at>now()-interval '1 minute'`, o.ID).Scan(&recent)
	if recent >= 3 {
		problem(w, 429, "Too many requests", "slow down — 3 cheers per minute")
		return
	}
	if _, err := s.db.Exec(r.Context(), `INSERT INTO order_cheers(order_id,customer_id,courier_id,message)
		VALUES($1,$2,$3,$4)`, o.ID, c.Sub, *d.CourierID, msg); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	s.queuePush(*d.CourierID, "A customer cheered you on", msg)
	// The Courier PWA socket types `{type:"cheer", text}` (legacy frames only
	// carried `message`); send both so old and new clients speak the cheer
	// aloud in Run Mode. `from` stays a role label — customer names are never
	// exposed to couriers.
	cheerB, _ := json.Marshal(map[string]any{"type": "cheer", "order_id": o.ID,
		"message": msg, "text": msg, "from": "customer", "lang": "en"})
	s.hub.Broadcast(*d.CourierID, string(cheerB))
	writeJSON(w, 201, map[string]any{"sent": true})
}

// ---------- chat: one thread per order ----------

func (s *Server) postCustomerMessage(w http.ResponseWriter, r *http.Request) {
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
	s.postMessage(w, r, o, "customer", c.Sub)
}

func (s *Server) postCourierMessage(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	d, err := s.loadDelivery(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "delivery not found")
		return
	}
	if d.CourierID == nil || *d.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your delivery")
		return
	}
	o, err := s.loadOrder(r.Context(), d.OrderID)
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	s.postMessage(w, r, o, "courier", c.Sub)
}

func (s *Server) postMessage(w http.ResponseWriter, r *http.Request, o orderRow, senderType, senderID string) {
	var b struct {
		Body string `json:"body"`
		Lang string `json:"lang"`
	}
	if !decode(w, r, &b) {
		return
	}
	body := strings.TrimSpace(b.Body)
	if body == "" || len(body) > 500 {
		problem(w, 400, "Validation failed", "body must be 1-500 chars")
		return
	}
	var id string
	var at time.Time
	err := s.db.QueryRow(r.Context(), `INSERT INTO order_messages(order_id,sender_type,sender_id,body,lang)
		VALUES($1,$2,$3,$4,$5) RETURNING id, created_at`, o.ID, senderType, senderID, body, b.Lang).Scan(&id, &at)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	// B6: translate + moderate in the background (idempotent job).
	s.enqueueNow(AIJobTranslate, fmt.Sprintf(`{"message_id":%q}`, id), time.Now())
	// Notify the other side (translation fills translated_body in B6).
	d, _ := s.loadDeliveryByOrder(r.Context(), o.ID)
	other := o.CustomerID
	if senderType == "customer" && d.CourierID != nil {
		other = *d.CourierID
	}
	if other != senderID {
		s.queuePush(other, "New message", body)
		// The Courier PWA socket types `{type:"chat.message", text, lang}`
		// (legacy frames only carried `body`); send both shapes so old and
		// new clients render the thread and the courier voice pipeline hears it.
		lang := strings.TrimSpace(b.Lang)
		if lang == "" {
			lang = ai.DetectLang(body)
		}
		msgB, _ := json.Marshal(map[string]any{"type": "chat.message", "order_id": o.ID,
			"message_id": id, "sender": senderType, "body": body, "text": body, "lang": lang})
		s.hub.Broadcast(other, string(msgB))
	}
	writeJSON(w, 201, map[string]any{"id": id, "sender": senderType, "body": body,
		"created_at": at.UTC().Format(time.RFC3339)})
}

func (s *Server) listCustomerMessages(w http.ResponseWriter, r *http.Request) {
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
	s.listMessages(w, r, o.ID)
}

func (s *Server) listCourierMessages(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	d, err := s.loadDelivery(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "delivery not found")
		return
	}
	if d.CourierID == nil || *d.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your delivery")
		return
	}
	s.listMessages(w, r, d.OrderID)
}

func (s *Server) listMessages(w http.ResponseWriter, r *http.Request, orderID string) {
	rows, err := s.db.Query(r.Context(), `SELECT id, sender_type, body, lang, translated_body, translated_live, created_at
		FROM order_messages WHERE order_id=$1 ORDER BY created_at LIMIT 100`, orderID)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, sender, body, lang, translated string
		var translatedLive bool
		var at time.Time
		if err := rows.Scan(&id, &sender, &body, &lang, &translated, &translatedLive, &at); err != nil {
			continue
		}
		m := map[string]any{"id": id, "sender": sender, "body": body,
			"created_at": at.UTC().Format(time.RFC3339)}
		if lang != "" {
			m["lang"] = lang
		}
		if translated != "" {
			m["translated_body"] = translated
			m["translated_live"] = translatedLive
		}
		out = append(out, m)
	}
	writeJSON(w, 200, map[string]any{"messages": out})
}

// customerImpact aggregates what the customer powered: delivered orders,
// couriers supported, and measured workout (distance + active seconds).
func (s *Server) customerImpact(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var orders, couriers int
	var distM float64
	var activeS int64
	_ = s.db.QueryRow(r.Context(), `SELECT count(*), count(DISTINCT d.courier_id),
		COALESCE(sum(d.carried_distance_m),0), COALESCE(sum(d.carried_active_s),0)
		FROM deliveries d JOIN orders o ON o.id=d.order_id
		WHERE o.customer_id=$1 AND d.status='delivered' AND d.type='workout'`, c.Sub).Scan(&orders, &couriers, &distM, &activeS)
	rows, err := s.db.Query(r.Context(), `SELECT o.code, u.name, d.carried_distance_m, d.carried_active_s, d.delivered_at
		FROM deliveries d JOIN orders o ON o.id=d.order_id LEFT JOIN users u ON u.id=d.courier_id
		WHERE o.customer_id=$1 AND d.status='delivered' AND d.type='workout' ORDER BY d.delivered_at DESC LIMIT 20`, c.Sub)
	recent := []map[string]any{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var code string
			var name *string
			var m float64
			var a int64
			var at *time.Time
			if err := rows.Scan(&code, &name, &m, &a, &at); err != nil {
				continue
			}
			first := ""
			if name != nil {
				if f := strings.Fields(*name); len(f) > 0 {
					first = f[0]
				}
			}
			item := map[string]any{"order_code": code, "courier_first_name": first,
				"distance_m": m, "active_s": a}
			if at != nil {
				item["delivered_at"] = at.UTC().Format(time.RFC3339)
			}
			recent = append(recent, item)
		}
	}
	writeJSON(w, 200, map[string]any{
		"orders_delivered":   orders,
		"couriers_supported": couriers,
		"distance_m":         distM,
		"active_s":           activeS,
		"recent":             recent,
	})
}
