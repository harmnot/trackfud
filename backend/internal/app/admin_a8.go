// Admin dashboard + courier performance for the CMS back office (A8,
// PLAN.md §4.4 P0): live map numbers plus the §8.6 performance page.
//
// Both routes are admin-only via requireRole. Every number comes from the
// same tables the customer/courier/merchant tracks write (orders,
// deliveries, dispatch_offers, activity_sessions, order_ratings, ledger
// postings) — the CMS never invents rows, and the courier PWA needs no
// change: it already streams live GPS into activity_sessions and takes
// offers through dispatch, which is exactly what this page reads.
//
//   - GET /v1/admin/dashboard: today's counts + live couriers (active work
//     sessions with a recent fix) + active orders (placed→picked_up).
//   - GET /v1/admin/couriers/{user_id}/performance: §8.6 metrics over the
//     last 30 days — acceptance/completion/in-window rates, pickup/delivery
//     timing, Bayesian rating + complaints, distance/active minutes, WHO-week
//     trend, overexertion guards, earnings, anti-cheat flags, peer rank,
//     plus recent session + delivery history for the map links.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// liveWindow trims the live map to couriers heard from recently. Dispatch
// itself offers only to sessions seen within 60 s; the dashboard shows a
// wider 5-minute window so a courier in a GPS shadow still reads as "was
// just here" instead of vanishing mid-delivery.
const dashboardLiveWindow = `interval '5 minutes'`

// perfWindowDays is the §8.6 lookback: "last 30 days" across every metric.
const perfWindowDays = 30

// getAdminDashboard serves today's numbers, live courier dots and active
// orders in one call so the overview page renders without N+1 fetches.
func (s *Server) getAdminDashboard(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	ctx := r.Context()
	today := map[string]any{"date": time.Now().UTC().Format("2006-01-02")}

	var placed, delivered, active int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM orders WHERE created_at >= date_trunc('day', now())`).Scan(&placed)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM orders WHERE status='delivered' AND created_at >= date_trunc('day', now())`).Scan(&delivered)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM orders WHERE status IN ('placed','accepted','ready','picked_up')`).Scan(&active)
	today["orders_placed"] = placed
	today["orders_delivered"] = delivered
	today["active_orders"] = active

	var online int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM activity_sessions
		WHERE kind='work' AND status='active' AND last_seen_at > now() - `+dashboardLiveWindow).Scan(&online)
	today["couriers_online"] = online

	var pendingApps, pendingMerchants int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM courier_applications WHERE status IN ('pending','pending_review','passed_test')`).Scan(&pendingApps)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM merchants WHERE status='pending'`).Scan(&pendingMerchants)
	today["pending_applications"] = pendingApps
	today["pending_merchants"] = pendingMerchants

	gmv := []map[string]any{}
	if rows, err := s.db.Query(ctx, `SELECT currency, COALESCE(sum(total_minor),0) FROM orders
		WHERE status IN ('delivered','completed') AND created_at >= date_trunc('day', now())
		GROUP BY currency ORDER BY currency`); err == nil {
		defer rows.Close()
		for rows.Next() {
			var cur string
			var sum int64
			if err := rows.Scan(&cur, &sum); err == nil {
				gmv = append(gmv, map[string]any{"currency": cur, "amount_minor": sum})
			}
		}
	}
	today["gmv_delivered"] = gmv

	live := []map[string]any{}
	if rows, err := s.db.Query(ctx, `SELECT s.courier_id, COALESCE(u.email,''),
			COALESCE(c.mode, a.mode, 'runner'), COALESCE(c.status,''),
			COALESCE(ST_Y(s.last_pos::geometry),0), COALESCE(ST_X(s.last_pos::geometry),0),
			s.last_seen_at, s.distance_m
		FROM activity_sessions s
		JOIN users u ON u.id=s.courier_id
		LEFT JOIN couriers c ON c.user_id=s.courier_id
		LEFT JOIN courier_applications a ON a.user_id=s.courier_id
		WHERE s.kind='work' AND s.status='active'
		  AND s.last_seen_at > now() - `+dashboardLiveWindow+`
		  AND s.last_pos IS NOT NULL
		ORDER BY s.last_seen_at DESC LIMIT 100`); err == nil {
		defer rows.Close()
		for rows.Next() {
			var uid, email, mode, standing string
			var lat, lng, dist float64
			var seen time.Time
			if err := rows.Scan(&uid, &email, &mode, &standing, &lat, &lng, &seen, &dist); err != nil {
				continue
			}
			dot := map[string]any{"user_id": uid, "email": email, "mode": mode,
				"standing": standing, "lat": lat, "lng": lng,
				"last_seen_at": seen.UTC().Format(time.RFC3339), "session_distance_m": dist}
			var did, dstatus string
			_ = s.db.QueryRow(ctx, `SELECT id, status FROM deliveries WHERE courier_id=$1
				AND status IN ('assigned','at_pickup','picked_up','at_dropoff')
				ORDER BY assigned_at DESC NULLS LAST, created_at DESC LIMIT 1`, uid).Scan(&did, &dstatus)
			if did != "" {
				dot["delivery_id"] = did
				dot["delivery_status"] = dstatus
			}
			live = append(live, dot)
		}
	}

	orders := []map[string]any{}
	if rows, err := s.db.Query(ctx, `SELECT o.id, o.code, o.status, m.name, u.email,
			o.created_at, d.status, COALESCE(dc.email,''),
			COALESCE(ST_Y(o.dropoff::geometry),0), COALESCE(ST_X(o.dropoff::geometry),0),
			o.dropoff IS NOT NULL
		FROM orders o JOIN merchants m ON m.id=o.merchant_id
		JOIN users u ON u.id=o.customer_id
		LEFT JOIN deliveries d ON d.order_id=o.id
		LEFT JOIN users dc ON dc.id=d.courier_id
		WHERE o.status IN ('placed','accepted','ready','picked_up')
		ORDER BY o.created_at DESC LIMIT 50`); err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, code, st, mname, cemail string
			var dstatus, courierEmail *string
			var created time.Time
			var lat, lng float64
			var hasDrop bool
			if err := rows.Scan(&id, &code, &st, &mname, &cemail, &created,
				&dstatus, &courierEmail, &lat, &lng, &hasDrop); err != nil {
				continue
			}
			row := map[string]any{"id": id, "code": code, "status": st,
				"merchant_name": mname, "customer_email": cemail,
				"created_at": created.UTC().Format(time.RFC3339)}
			if dstatus != nil {
				row["delivery_status"] = *dstatus
			}
			if courierEmail != nil && *courierEmail != "" {
				row["courier_email"] = *courierEmail
			}
			if hasDrop {
				row["dropoff"] = map[string]any{"lat": lat, "lng": lng}
			}
			orders = append(orders, row)
		}
	}

	writeJSON(w, 200, map[string]any{"today": today, "live_couriers": live, "active_orders": orders})
}

// perfRate renders a §8.6 rate for the wire: a fraction when there is data,
// JSON null when the courier has none — "no deliveries" must never read as
// "0% in-window".
func perfRate(have, total int64) any {
	if total <= 0 {
		return nil
	}
	return float64(have) / float64(total)
}

// perfTrendWeeks is the WHO-week trend length, newest week first.
const perfTrendWeeks = 8

// courierWeeklyTrendQuery returns the WHO-week trend SQL with its bound
// args for one courier: active seconds and ended sessions per week
// (date_trunc 'week', Monday start) over the last perfTrendWeeks weeks,
// newest first. Every placeholder is bound here: the courier filter once
// shipped without its $1 argument, so the query errored and the trend
// always read empty.
func courierWeeklyTrendQuery(userID string) (string, []any) {
	return `SELECT to_char(date_trunc('week', started_at),'YYYY-MM-DD'),
			COALESCE(sum(active_s),0), count(*) FILTER (WHERE status='ended')
		FROM activity_sessions WHERE courier_id=$1
		  AND started_at > now() - make_interval(days => $2)
		GROUP BY 1 ORDER BY 1 DESC LIMIT $3`, []any{userID, 7 * perfTrendWeeks, perfTrendWeeks}
}

// complaintMaxStars: a 1–2★ courier rating is a complaint on its own. The
// customer rating form offers only positive courier tags, so low stars are
// the main negative signal a customer can give.
const complaintMaxStars = 2

// courierComplaintTopics are the AI rating topics (ai.LabelsSystemV1
// vocabulary) that blame the courier: PLAN §8.6 counts complaints "by AI
// topic (late, rude, spilled)". cold_food and wrong_item point at the
// kitchen; praise, other and legacy labels are not complaints.
var courierComplaintTopics = map[string]bool{"late": true, "rude": true, "spilled": true}

// isCourierComplaint reports whether one order rating is genuinely negative
// feedback about the courier: 1–2 courier stars, or a topic that blames the
// courier. The abusive flag alone does not count: it marks the rater's
// language for moderation, not the courier's service.
func isCourierComplaint(stars *int, topics []string) bool {
	if stars != nil && *stars <= complaintMaxStars {
		return true
	}
	for _, t := range topics {
		if courierComplaintTopics[t] {
			return true
		}
	}
	return false
}

// countCourierComplaints counts the courier's ratings inside the §8.6
// window that isCourierComplaint calls genuinely negative.
func (s *Server) countCourierComplaints(ctx context.Context, userID string) (int64, error) {
	rows, err := s.db.Query(ctx, `SELECT courier_stars, topics FROM order_ratings
		WHERE courier_id=$1 AND created_at > now() - make_interval(days => $2)`, userID, perfWindowDays)
	if err != nil {
		return 0, fmt.Errorf("complaints: %w", err)
	}
	defer rows.Close()
	var n int64
	for rows.Next() {
		var stars *int
		var topicsB []byte
		if err := rows.Scan(&stars, &topicsB); err != nil {
			return 0, fmt.Errorf("complaints scan: %w", err)
		}
		var topics []string
		_ = json.Unmarshal(topicsB, &topics) // a malformed label row falls back to the stars rule
		if isCourierComplaint(stars, topics) {
			n++
		}
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("complaints rows: %w", err)
	}
	return n, nil
}

// getCourierPerformance serves one courier's §8.6 performance page: rates,
// timing, rating, work, WHO trend, overexertion, earnings, flags, peers,
// and recent history. Unknown user_ids 404; couriers that never delivered
// get nulled rates (not 0) so "no data" never reads as "bad".
func (s *Server) getCourierPerformance(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	userID := strings.TrimSpace(r.PathValue("user_id"))
	if userID == "" {
		problem(w, 400, "Validation failed", "user_id is required")
		return
	}
	ctx := r.Context()
	var email, mode, standing string
	var bayes float64
	var ratingCount, deliveriesCount int
	var lifeDist float64
	var lifeMov, lifeAct int64
	err := s.db.QueryRow(ctx, `SELECT COALESCE(u.email,''), COALESCE(c.mode, a.mode, 'runner'),
			COALESCE(c.status,''), COALESCE(c.rating_bayes,4.5), COALESCE(c.rating_count,0),
			COALESCE(c.deliveries_count,0), COALESCE(c.lifetime_distance_m,0),
			COALESCE(c.lifetime_moving_s,0), COALESCE(c.lifetime_active_s,0)
		FROM users u
		LEFT JOIN couriers c ON c.user_id=u.id
		LEFT JOIN courier_applications a ON a.user_id=u.id
		WHERE u.id=$1`, userID).Scan(&email, &mode, &standing, &bayes,
		&ratingCount, &deliveriesCount, &lifeDist, &lifeMov, &lifeAct)
	if err != nil {
		problem(w, 404, "Not found", "courier not found")
		return
	}

	rateOf := perfRate
	var offers, accepted int64
	_ = s.db.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE status='accepted')
		FROM dispatch_offers WHERE courier_id=$1 AND created_at > now() - make_interval(days => $2)`,
		userID, perfWindowDays).Scan(&offers, &accepted)

	var assigned, delivered int64
	_ = s.db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status IN ('assigned','at_pickup','picked_up','at_dropoff','delivered')),
			count(*) FILTER (WHERE status='delivered')
		FROM deliveries WHERE courier_id=$1 AND created_at > now() - make_interval(days => $2)`,
		userID, perfWindowDays).Scan(&assigned, &delivered)

	var winTotal, winIn int64
	_ = s.db.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE d.delivered_at <= o.window_end)
		FROM deliveries d JOIN orders o ON o.id=d.order_id
		WHERE d.courier_id=$1 AND d.status='delivered'
		  AND d.delivered_at > now() - make_interval(days => $2)`,
		userID, perfWindowDays).Scan(&winTotal, &winIn)

	var pickupAvg, tripAvg *float64
	_ = s.db.QueryRow(ctx, `SELECT avg(EXTRACT(EPOCH FROM (picked_up_at - assigned_at))),
			avg(EXTRACT(EPOCH FROM (delivered_at - picked_up_at)))
		FROM deliveries WHERE courier_id=$1 AND status='delivered'
		  AND delivered_at > now() - make_interval(days => $2)
		  AND picked_up_at IS NOT NULL AND assigned_at IS NOT NULL`,
		userID, perfWindowDays).Scan(&pickupAvg, &tripAvg)

	complaints, err := s.countCourierComplaints(ctx, userID)
	if err != nil {
		s.log.Warn("courier performance: complaints query failed", "err", err)
	}
	tags := []map[string]any{}
	if rows, err := s.db.Query(ctx, `SELECT t.tag, count(*) FROM order_ratings r,
			LATERAL jsonb_array_elements_text(COALESCE(r.courier_tags,'[]'::jsonb)) AS t(tag)
		WHERE r.courier_id=$1 AND r.created_at > now() - make_interval(days => $2)
		GROUP BY t.tag ORDER BY 2 DESC LIMIT 8`, userID, perfWindowDays); err == nil {
		defer rows.Close()
		for rows.Next() {
			var tag string
			var n int64
			if err := rows.Scan(&tag, &n); err == nil && tag != "" {
				tags = append(tags, map[string]any{"tag": tag, "count": n})
			}
		}

	}
	topics := []map[string]any{}
	if rows, err := s.db.Query(ctx, `SELECT t.topic, count(*) FROM order_ratings r,
			LATERAL jsonb_array_elements_text(COALESCE(r.topics,'[]'::jsonb)) AS t(topic)
		WHERE r.courier_id=$1 AND r.created_at > now() - make_interval(days => $2)
		GROUP BY t.topic ORDER BY 2 DESC LIMIT 8`, userID, perfWindowDays); err == nil {
		defer rows.Close()
		for rows.Next() {
			var topic string
			var n int64
			if err := rows.Scan(&topic, &n); err == nil && topic != "" {
				topics = append(topics, map[string]any{"topic": topic, "count": n})
			}
		}
	}

	var workDist, perDelivery float64
	var workActive int64
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(sum(carried_distance_m),0), COALESCE(sum(carried_active_s),0),
			COALESCE(avg(carried_distance_m),0)
		FROM deliveries WHERE courier_id=$1 AND status='delivered'
		  AND delivered_at > now() - make_interval(days => $2)`,
		userID, perfWindowDays).Scan(&workDist, &workActive, &perDelivery)

	weeks := []map[string]any{}
	weeksAtGoal := 0
	goalMin := s.effectiveHealthGoal(ctx, "")
	trendSQL, trendArgs := courierWeeklyTrendQuery(userID)
	if rows, err := s.db.Query(ctx, trendSQL, trendArgs...); err != nil {
		s.log.Warn("courier performance: weekly trend query failed", "err", err)
	} else {
		defer rows.Close()
		for rows.Next() {
			var week string
			var a int64
			var n int64
			if err := rows.Scan(&week, &a, &n); err != nil {
				continue
			}
			met := a >= int64(goalMin*60)
			if met {
				weeksAtGoal++
			}
			weeks = append(weeks, map[string]any{"week": week, "active_s": a,
				"sessions": n, "goal_met": met})
		}
	}

	capMin := s.cfg.Health.DailyActiveCapMin
	if capMin <= 0 {
		capMin = 180
	}
	var daysOver int64
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM (
			SELECT date_trunc('day', started_at) AS d, sum(active_s) AS a
			FROM activity_sessions WHERE courier_id=$1
			  AND started_at > now() - make_interval(days => $2)
			GROUP BY 1) t WHERE a > $3*60`, userID, perfWindowDays, capMin).Scan(&daysOver)
	var longSessions int64
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM activity_sessions WHERE courier_id=$1
		AND started_at > now() - make_interval(days => $2) AND elapsed_s > 4*3600`,
		userID, perfWindowDays).Scan(&longSessions)

	earnings := []map[string]any{}
	var earnTotal int64
	var earnCur string
	if rows, err := s.db.Query(ctx, `SELECT a.currency, COALESCE(sum(p.amount_minor) FILTER (WHERE p.amount_minor>0),0)
		FROM postings p JOIN ledger_accounts a ON a.id=p.account_id
		JOIN journal_entries e ON e.id=p.entry_id
		WHERE a.owner_type='courier' AND a.owner_id=$1 AND a.kind='courier_earnings'
		  AND e.created_at > now() - make_interval(days => $2)
		GROUP BY a.currency ORDER BY a.currency`, userID, perfWindowDays); err == nil {
		defer rows.Close()
		for rows.Next() {
			var cur string
			var sum int64
			if err := rows.Scan(&cur, &sum); err == nil {
				earnings = append(earnings, map[string]any{"currency": cur, "amount_minor": sum})
				if earnCur == "" {
					earnCur, earnTotal = cur, sum
				}
			}
		}
	}
	var perHour any
	if lifeAct > 0 && earnCur != "" {
		perHour = map[string]any{"currency": earnCur,
			"amount_minor": earnTotal * 3600 / lifeAct}
	}

	var flagged int64
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM activity_sessions WHERE courier_id=$1
		AND started_at > now() - make_interval(days => $2) AND flags::text <> '[]'`,
		userID, perfWindowDays).Scan(&flagged)
	latest := []map[string]any{}
	if rows, err := s.db.Query(ctx, `SELECT id, kind, flags, started_at, distance_m, active_s
		FROM activity_sessions WHERE courier_id=$1 AND flags::text <> '[]'
		ORDER BY started_at DESC LIMIT 5`, userID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, kind, flags string
			var at time.Time
			var dist float64
			var act int64
			if err := rows.Scan(&id, &kind, &flags, &at, &dist, &act); err != nil {
				continue
			}
			latest = append(latest, map[string]any{"session_id": id, "kind": kind,
				"flags": flags, "started_at": at.UTC().Format(time.RFC3339),
				"distance_m": dist, "active_s": act})
		}
	}

	var rank, of int64
	_ = s.db.QueryRow(ctx, `SELECT count(*)+1 FROM (
			SELECT courier_id, count(*) AS n FROM deliveries
			WHERE status='delivered' AND delivered_at > now() - make_interval(days => $1)
			  AND courier_id IS NOT NULL GROUP BY courier_id) t
		WHERE t.n > (SELECT count(*) FROM deliveries
			WHERE courier_id=$2 AND status='delivered'
			  AND delivered_at > now() - make_interval(days => $1))`,
		perfWindowDays, userID).Scan(&rank)
	_ = s.db.QueryRow(ctx, `SELECT count(DISTINCT courier_id) FROM deliveries
		WHERE status='delivered' AND delivered_at > now() - make_interval(days => $1)
		  AND courier_id IS NOT NULL`, perfWindowDays).Scan(&of)
	var percentile any
	if of > 0 {
		percentile = float64(of-rank+1) / float64(of)
	}

	sessions := []map[string]any{}
	if rows, err := s.db.Query(ctx, `SELECT id, kind, mode, status, started_at, ended_at,
			distance_m, moving_s, active_s, flags,
			COALESCE(ST_Y(last_pos::geometry),0), COALESCE(ST_X(last_pos::geometry),0),
			last_pos IS NOT NULL
		FROM activity_sessions WHERE courier_id=$1
		ORDER BY started_at DESC LIMIT 10`, userID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, kind, mode, st, flags string
			var started time.Time
			var ended *time.Time
			var dist float64
			var mov, act int64
			var lat, lng float64
			var hasPos bool
			if err := rows.Scan(&id, &kind, &mode, &st, &started, &ended,
				&dist, &mov, &act, &flags, &lat, &lng, &hasPos); err != nil {
				continue
			}
			row := map[string]any{"id": id, "kind": kind, "mode": mode, "status": st,
				"started_at": started.UTC().Format(time.RFC3339),
				"distance_m": dist, "moving_s": mov, "active_s": act, "flags": flags}
			if ended != nil {
				row["ended_at"] = ended.UTC().Format(time.RFC3339)
			}
			if hasPos {
				row["last_lat"] = lat
				row["last_lng"] = lng
			}
			sessions = append(sessions, row)
		}
	}

	deliveries := []map[string]any{}
	if rows, err := s.db.Query(ctx, `SELECT d.id, o.id, o.code, d.status, d.type,
			d.assigned_at, d.picked_up_at, d.delivered_at,
			d.carried_distance_m, d.carried_active_s, r.courier_stars,
			(o.window_end IS NOT NULL AND d.delivered_at <= o.window_end)
		FROM deliveries d JOIN orders o ON o.id=d.order_id
		LEFT JOIN order_ratings r ON r.order_id=o.id
		WHERE d.courier_id=$1 ORDER BY d.created_at DESC LIMIT 10`, userID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, orderID, code, st, typ string
			var assignedAt, pickedAt, deliveredAt *time.Time
			var dist float64
			var act int64
			var stars *int
			var inWin *bool
			if err := rows.Scan(&id, &orderID, &code, &st, &typ, &assignedAt, &pickedAt,
				&deliveredAt, &dist, &act, &stars, &inWin); err != nil {
				continue
			}
			row := map[string]any{"id": id, "order_id": orderID, "order_code": code,
				"status": st, "type": typ,
				"distance_m": dist, "active_s": act}
			if assignedAt != nil {
				row["assigned_at"] = assignedAt.UTC().Format(time.RFC3339)
			}
			if pickedAt != nil {
				row["picked_up_at"] = pickedAt.UTC().Format(time.RFC3339)
			}
			if deliveredAt != nil {
				row["delivered_at"] = deliveredAt.UTC().Format(time.RFC3339)
			}
			if stars != nil {
				row["courier_stars"] = *stars
			}
			if inWin != nil {
				row["in_window"] = *inWin
			}
			deliveries = append(deliveries, row)
		}
	}

	var complaintsPer100 any
	if delivered > 0 {
		complaintsPer100 = float64(complaints) * 100 / float64(delivered)
	}

	writeJSON(w, 200, map[string]any{
		"courier": map[string]any{"user_id": userID, "email": email, "mode": mode,
			"standing": standing, "rating_bayes": bayes, "rating_count": ratingCount,
			"deliveries_count": deliveriesCount, "lifetime_distance_m": lifeDist,
			"lifetime_moving_s": lifeMov, "lifetime_active_s": lifeAct},
		"window_days":       perfWindowDays,
		"acceptance":        map[string]any{"offers": offers, "accepted": accepted, "rate": rateOf(accepted, offers)},
		"completion":        map[string]any{"assigned": assigned, "delivered": delivered, "rate": rateOf(delivered, assigned)},
		"in_window":         map[string]any{"delivered": winTotal, "in_window": winIn, "rate": rateOf(winIn, winTotal)},
		"pickup_wait_s_avg": pickupAvg, "delivery_s_avg": tripAvg,
		"rating": map[string]any{"bayes": bayes, "count": ratingCount,
			"complaints": complaints, "complaints_per_100": complaintsPer100,
			"top_tags": tags, "top_topics": topics},
		"work": map[string]any{"distance_m": workDist, "active_s": workActive,
			"per_delivery_m": perDelivery, "weekly": weeks,
			"weeks_at_goal": weeksAtGoal, "goal_min": goalMin},
		"overexertion": map[string]any{"days_over_cap": daysOver,
			"long_sessions": longSessions, "daily_cap_min": capMin},
		"earnings": map[string]any{"by_currency": earnings, "per_active_hour": perHour},
		"flags":    map[string]any{"sessions_flagged": flagged, "latest": latest},
		"peers":    map[string]any{"rank": rank, "of": of, "percentile": percentile},
		"sessions": sessions, "deliveries": deliveries,
	})
}
