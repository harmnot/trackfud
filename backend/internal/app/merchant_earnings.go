// Merchant earnings from real order + ledger data (no mocks).
//
// GET /v1/merchant/earnings?weeks=8 returns per-currency settled totals,
// weekly buckets, and the ledger payable balance for the caller's store.
// Settled = accepted and beyond, excluding refunded/dead and
// awaiting_payment/placed (same rule as the PWA's old local summary, now
// computed server-side so every device agrees).
package app

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// parseWeeks clamps ?weeks= to 1..12 (default 8).
func parseWeeks(v string) int {
	if strings.TrimSpace(v) == "" {
		return 8
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 1 {
		return 8
	}
	if n > 12 {
		return 12
	}
	return n
}

// mondayOf returns the UTC Monday (YYYY-MM-DD) for a timestamp.
func mondayOf(t time.Time) string {
	y, m, d := t.UTC().Date()
	mid := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	day := (int(mid.Weekday()) + 6) % 7
	return mid.AddDate(0, 0, -day).Format("2006-01-02")
}

// getMerchantEarnings serves settled earnings for the caller's store.
func (s *Server) getMerchantEarnings(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	m, err := s.fetchMerchant(r, c.Sub)
	if err != nil {
		problem(w, 400, "Validation failed", "create your store profile first")
		return
	}
	merchantID, _ := m["id"].(string)
	weeks := parseWeeks(r.URL.Query().Get("weeks"))
	ctx := r.Context()

	rows, err := s.db.Query(ctx, `SELECT currency, status, payment_status,
		subtotal_minor, commission_minor, created_at FROM orders WHERE merchant_id=$1`, merchantID)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()

	type total struct {
		currency          string
		orders            int
		gross, commission int64
	}
	type weekKey struct {
		week, currency string
	}
	type weekVal struct {
		orders int
		gross  int64
	}
	totals := map[string]*total{}
	weeksMap := map[weekKey]*weekVal{}
	for rows.Next() {
		var cur, status, payStatus string
		var sub, com int64
		var created time.Time
		if err := rows.Scan(&cur, &status, &payStatus, &sub, &com, &created); err != nil {
			continue
		}
		if status == "awaiting_payment" || status == "placed" {
			continue
		}
		if status == "rejected" || status == "cancelled" || payStatus == "refunded" {
			continue
		}
		t := totals[cur]
		if t == nil {
			t = &total{currency: cur}
			totals[cur] = t
		}
		t.orders++
		t.gross += sub
		t.commission += com
		k := weekKey{week: mondayOf(created), currency: cur}
		wv := weeksMap[k]
		if wv == nil {
			wv = &weekVal{}
			weeksMap[k] = wv
		}
		wv.orders++
		wv.gross += sub
	}
	// Ledger payable balance per currency (authoritative net awaiting payout).
	balances := map[string]int64{}
	lifetime := map[string]int64{}
	if brow, err := s.db.Query(ctx, `SELECT currency, balance_minor FROM ledger_accounts
		WHERE owner_type='merchant' AND owner_id=$1 AND kind='merchant_payable'`, merchantID); err == nil {
		defer brow.Close()
		for brow.Next() {
			var cur string
			var bal int64
			if err := brow.Scan(&cur, &bal); err == nil {
				balances[cur] = bal
			}
		}
	}
	if lrow, err := s.db.Query(ctx, `SELECT a.currency, COALESCE(sum(p.amount_minor),0)
		FROM postings p JOIN ledger_accounts a ON a.id=p.account_id
		WHERE a.owner_type='merchant' AND a.owner_id=$1 AND a.kind='merchant_payable'
		AND p.amount_minor>0 GROUP BY a.currency`, merchantID); err == nil {
		defer lrow.Close()
		for lrow.Next() {
			var cur string
			var sum int64
			if err := lrow.Scan(&cur, &sum); err == nil {
				lifetime[cur] = sum
			}
		}
	}

	totalsOut := []map[string]any{}
	for _, t := range totals {
		net := t.gross - t.commission
		item := map[string]any{
			"currency": t.currency, "orders": t.orders,
			"gross_minor": t.gross, "commission_minor": t.commission, "net_minor": net,
		}
		if b, ok := balances[t.currency]; ok {
			item["payable_minor"] = b
		}
		if l, ok := lifetime[t.currency]; ok {
			item["lifetime_minor"] = l
		}
		totalsOut = append(totalsOut, item)
	}
	// Newest weeks first, capped at ?weeks= buckets per currency.
	type wrow struct {
		week, cur string
		orders    int
		gross     int64
		net       int64
	}
	var all []wrow
	for k, v := range weeksMap {
		var com int64
		// Commission share per week bucket: re-aggregate is complex; net is
		// derived from the totals ratio when needed. Here net = gross minus
		// proportional commission from the same week rows.
		_ = com
		all = append(all, wrow{week: k.week, cur: k.currency, orders: v.orders, gross: v.gross})
	}
	// Sort desc by week, then slice per currency.
	for i := 0; i < len(all); i++ {
		for j := i + 1; j < len(all); j++ {
			if all[j].week > all[i].week {
				all[i], all[j] = all[j], all[i]
			}
		}
	}
	seen := map[string]int{}
	weeksOut := []map[string]any{}
	for _, r := range all {
		if seen[r.cur] >= weeks {
			continue
		}
		seen[r.cur]++
		// Net per week: look up the week commission proportionally from totals.
		weeksOut = append(weeksOut, map[string]any{
			"week_start": r.week, "currency": r.cur,
			"orders": r.orders, "gross_minor": r.gross, "net_minor": r.gross,
		})
	}
	// Fix weekly net_minor with a second pass over orders grouped by week+currency.
	// (Keeps the first loop simple while staying exact.)
	commissionByWeek := map[weekKey]int64{}
	if crows, err := s.db.Query(ctx, `SELECT currency, created_at, commission_minor, subtotal_minor,
		status, payment_status FROM orders WHERE merchant_id=$1`, merchantID); err == nil {
		defer crows.Close()
		for crows.Next() {
			var cur, status, pay string
			var created time.Time
			var com, sub int64
			if err := crows.Scan(&cur, &created, &com, &sub, &status, &pay); err != nil {
				continue
			}
			if status == "awaiting_payment" || status == "placed" || status == "rejected" || status == "cancelled" || pay == "refunded" {
				continue
			}
			k := weekKey{week: mondayOf(created), currency: cur}
			commissionByWeek[k] += com
		}
		for _, w := range weeksOut {
			k := weekKey{week: w["week_start"].(string), currency: w["currency"].(string)}
			gross := w["gross_minor"].(int64)
			w["net_minor"] = gross - commissionByWeek[k]
			w["commission_minor"] = commissionByWeek[k]
		}
	}

	writeJSON(w, 200, map[string]any{
		"totals":       totalsOut,
		"weeks":        weeksOut,
		"payouts_note": "Demo payouts are mocked — no real money moves.",
	})
}
