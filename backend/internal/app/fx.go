package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"Trackfud/internal/ledger"
)

// ---------- FX B5+: Paddle payout currencies + conversion ----------
//
// Paddle sandbox supports a subset of world currencies. Country currencies
// outside that subset (e.g. IDR) convert to USD for payouts at a regularly
// refreshed rate. Rates live in fx_rates; a daily worker (fxRefresh, queued
// as a River job) pulls a free public feed and falls back to the last good
// row, so payouts never block on a feed outage.

// paddleSupported is the Paddle-supported payout set served to the courier
// PWA. Paddle docs list ~20 settlement currencies; IDR is not among them,
// so IDR payouts convert to USD. Keep this list in one place.
var paddleSupported = map[string]bool{
	"USD": true, "EUR": true, "GBP": true, "AUD": true, "CAD": true,
	"CHF": true, "NZD": true, "SGD": true, "HKD": true, "JPY": true,
	"MXN": true, "BRL": true, "ZAR": true, "SEK": true, "NOK": true,
	"DKK": true, "PLN": true, "CZK": true, "HUF": true, "ILS": true,
	"AED": true, "THB": true, "PHP": true, "MYR": true,
}

// PaddleSupported reports whether Paddle can settle a currency directly.
func PaddleSupported(cur string) bool {
	return paddleSupported[strings.ToUpper(strings.TrimSpace(cur))]
}

// fxRow is one cached conversion.
type fxRow struct {
	Rate      float64
	Source    string
	UpdatedAt time.Time
}

// loadRate reads a direct base->quote row; ok=false when absent.
func (s *Server) loadRate(ctx context.Context, base, quote string) (fxRow, bool) {
	var r fxRow
	err := s.db.QueryRow(ctx, `SELECT rate, source, updated_at FROM fx_rates WHERE base=$1 AND quote=$2`,
		base, quote).Scan(&r.Rate, &r.Source, &r.UpdatedAt)
	if err != nil || r.Rate <= 0 {
		return fxRow{}, false
	}
	return r, true
}

// resolveRate returns base->quote, trying direct, inverse, then USD bridge.
// All math stays in float64 for display/conversion only — money itself is
// always integer minor units (ledger package).
func (s *Server) resolveRate(ctx context.Context, base, quote string) (rate float64, source string, updatedAt time.Time, ok bool) {
	base = strings.ToUpper(strings.TrimSpace(base))
	quote = strings.ToUpper(strings.TrimSpace(quote))
	if base == "" || quote == "" || len(base) != 3 || len(quote) != 3 {
		return 0, "", time.Time{}, false
	}
	if base == quote {
		return 1, "identity", time.Now(), true
	}
	if r, found := s.loadRate(ctx, base, quote); found {
		return r.Rate, r.Source, r.UpdatedAt, true
	}
	if inv, found := s.loadRate(ctx, quote, base); found && inv.Rate > 0 {
		return 1 / inv.Rate, inv.Source + "+inverse", inv.UpdatedAt, true
	}
	// USD bridge: base->USD * USD->quote.
	b2u, ok1 := s.loadRate(ctx, base, "USD")
	if !ok1 {
		if inv, found := s.loadRate(ctx, "USD", base); found && inv.Rate > 0 {
			b2u = fxRow{Rate: 1 / inv.Rate, Source: inv.Source + "+inverse", UpdatedAt: inv.UpdatedAt}
			ok1 = true
		}
	}
	u2q, ok2 := s.loadRate(ctx, "USD", quote)
	if !ok2 {
		if inv, found := s.loadRate(ctx, quote, "USD"); found && inv.Rate > 0 {
			u2q = fxRow{Rate: 1 / inv.Rate, Source: inv.Source + "+inverse", UpdatedAt: inv.UpdatedAt}
			ok2 = true
		}
	}
	if ok1 && ok2 {
		at := b2u.UpdatedAt
		if u2q.UpdatedAt.Before(at) {
			at = u2q.UpdatedAt
		}
		return b2u.Rate * u2q.Rate, b2u.Source + "+bridge", at, true
	}
	return 0, "", time.Time{}, false
}

// listCurrencies serves the payout-currency picker: every platform currency
// with its Paddle flag, so the PWA never hardcodes the list.
func (s *Server) listCurrencies(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT DISTINCT quote AS code FROM fx_rates
		UNION SELECT DISTINCT base AS code FROM fx_rates ORDER BY 1`)
	codes := []string{"USD", "IDR", "GBP"}
	if err == nil {
		defer rows.Close()
		var out []string
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err == nil && c != "" {
				out = append(out, strings.ToUpper(c))
			}
		}
		if len(out) > 0 {
			codes = out
		}
	}
	type row struct {
		Code            string `json:"code"`
		PaddleSupported bool   `json:"paddle_supported"`
	}
	list := make([]row, 0, len(codes))
	for _, c := range codes {
		list = append(list, row{Code: c, PaddleSupported: PaddleSupported(c)})
	}
	writeJSON(w, 200, map[string]any{"currencies": list})
}

// getFxRate serves one conversion with freshness metadata. Stale rows (>24h)
// trigger a best-effort background refresh; the stale rate is still served.
func (s *Server) getFxRate(w http.ResponseWriter, r *http.Request) {
	from := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("from")))
	to := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("to")))
	if !validCurrency(from) || !validCurrency(to) {
		problem(w, 400, "Validation failed", "from and to must be 3-letter ISO codes")
		return
	}
	rate, source, updatedAt, ok := s.resolveRate(r.Context(), from, to)
	if !ok {
		problem(w, 404, "Not found", "no conversion rate for "+from+" to "+to)
		return
	}
	if time.Since(updatedAt) > 24*time.Hour {
		go s.refreshFxRate(from, to)
	}
	writeJSON(w, 200, map[string]any{
		"from": from, "to": to, "rate": rate,
		"source": source, "updated_at": updatedAt.UTC().Format(time.RFC3339),
		"paddle_supported_from": PaddleSupported(from),
		"paddle_supported_to":   PaddleSupported(to),
		"stale":                 time.Since(updatedAt) > 24*time.Hour,
		"converted":             fxConverted(r, from, to, rate),
	})
}

// fxConverted previews one conversion server-side (?amount= minor units) so
// the PWA shows the exact charge math without duplicating minor-unit scales:
// the top-up form tells the customer the USD charge before they pay.
func fxConverted(r *http.Request, from, to string, rate float64) any {
	raw := strings.TrimSpace(r.URL.Query().Get("amount"))
	if raw == "" {
		return nil
	}
	amount, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || amount <= 0 {
		return nil
	}
	return map[string]any{
		"amount_minor":       amount,
		"currency":           from,
		"converted_minor":    ledger.ConvertMinor(amount, from, to, rate),
		"converted_currency": to,
	}
}

// payoutInfo tells the courier PWA which currency Paddle will actually pay:
// the country currency when supported, else USD with the live rate.
func (s *Server) payoutInfo(w http.ResponseWriter, r *http.Request) {
	country := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("country")))
	cur := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("currency")))
	if cur == "" {
		cur = countryCurrency(country)
	}
	if !validCurrency(cur) {
		problem(w, 400, "Validation failed", "currency must be a 3-letter ISO code")
		return
	}
	settle := cur
	var rate float64 = 1
	var rateAt any
	var source = "identity"
	if !PaddleSupported(cur) {
		settle = "USD"
		if r_, src, at, ok := s.resolveRate(r.Context(), cur, "USD"); ok {
			rate, source, rateAt = r_, src, at.UTC().Format(time.RFC3339)
		} else {
			problem(w, 404, "Not found", "no conversion rate for "+cur+" to USD")
			return
		}
	}
	writeJSON(w, 200, map[string]any{
		"country_currency": cur,
		"settle_currency":  settle,
		"paddle_supported": PaddleSupported(cur),
		"rate":             rate,
		"rate_source":      source,
		"rate_updated_at":  rateAt,
	})
}

// countryCurrency maps a country to its platform currency. Unknown or empty
// countries fall back to USD; the mapping stays server-side so the PWA never
// hardcodes it.
func countryCurrency(country string) string {
	switch strings.ToUpper(strings.TrimSpace(country)) {
	case "ID", "IDN", "INDONESIA":
		return "IDR"
	case "GB", "UK", "GBR":
		return "GBP"
	case "MY", "MYS", "MALAYSIA":
		return "MYR"
	case "":
		return "USD"
	default:
		return "USD"
	}
}

// refreshFxRate pulls USD-base rates from a free public feed (no key) and
// upserts them. Failures are silent: the last good row keeps serving.
func (s *Server) refreshFxRate(from, to string) {
	ctx := context.Background()
	// Fetch USD base once; derive any pair from it.
	resp, err := http.DefaultClient.Get("https://open.er-api.com/v6/latest/USD")
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return
	}
	var wire struct {
		Result string             `json:"result"`
		Rates  map[string]float64 `json:"rates"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil || wire.Result != "success" {
		return
	}
	usd, ok := wire.Rates["USD"]
	if !ok || usd <= 0 {
		usd = 1
	}
	now := time.Now()
	for _, code := range []string{from, to, "IDR", "GBP", "USD", "MYR"} {
		v, ok := wire.Rates[code]
		if !ok || v <= 0 {
			continue
		}
		perUSD := v / usd
		_, _ = s.db.Exec(ctx, `INSERT INTO fx_rates(base,quote,rate,source,updated_at)
			VALUES('USD',$1,$2,'er-api', $3)
			ON CONFLICT (base,quote) DO UPDATE SET rate=EXCLUDED.rate, source='er-api', updated_at=EXCLUDED.updated_at`,
			code, perUSD, now)
		if perUSD > 0 {
			_, _ = s.db.Exec(ctx, `INSERT INTO fx_rates(base,quote,rate,source,updated_at)
				VALUES($1,'USD',$2,'er-api', $3)
				ON CONFLICT (base,quote) DO UPDATE SET rate=EXCLUDED.rate, source='er-api', updated_at=EXCLUDED.updated_at`,
				code, 1/perUSD, now)
		}
	}
}

// handleFxRefresh is the daily River worker: refresh the seeded set.
func (s *Server) handleFxRefresh(ctx context.Context, _ string) {
	s.refreshFxRate("IDR", "USD")
	s.refreshFxRate("GBP", "USD")
}
