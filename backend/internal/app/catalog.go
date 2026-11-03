package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ---------- Customer ----------
func (s *Server) listRestaurants(w http.ResponseWriter, r *http.Request) {
	lat, _ := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, _ := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if lat == 0 && lng == 0 {
		lat, lng = -6.2088, 106.8456
	}
	// Optional ?category= filters to merchants serving that menu category.
	// Category names are per-merchant rows matched across locales (en/id/ms),
	// so a global chip like "Minuman" matches every merchant carrying it.
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	query := `SELECT id,name,currency,timezone,address,prep_minutes,country, ST_Distance(location, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS dist, ST_Y(location::geometry), ST_X(location::geometry) FROM merchants WHERE status='approved' AND location IS NOT NULL`
	args := []any{lng, lat}
	if category != "" {
		args = append(args, category, category, category)
		n := len(args) - 2
		query += ` AND EXISTS (SELECT 1 FROM menu_categories mc WHERE mc.merchant_id=merchants.id AND (mc.name->>'en' ILIKE $` + strconv.Itoa(n) + ` OR mc.name->>'id' ILIKE $` + strconv.Itoa(n+1) + ` OR mc.name->>'ms' ILIKE $` + strconv.Itoa(n+2) + `))`
	}
	query += ` ORDER BY dist ASC`
	rows, err := s.db.Query(r.Context(), query, args...)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	heads := []merchantHead{}
	for rows.Next() {
		var h merchantHead
		if err := rows.Scan(&h.id, &h.name, &h.cur, &h.tz, &h.addr, &h.prep, &h.country, &h.dist, &h.mlat, &h.mlng); err != nil {
			continue
		}
		heads = append(heads, h)
	}
	rows.Close()
	// One batched live-presence lookup for every listed merchant (no N+1):
	// each badge reflects couriers online right now near that restaurant.
	ids := make([]string, 0, len(heads))
	for _, h := range heads {
		ids = append(ids, h.id)
	}
	presence := s.livePresenceByMerchant(r.Context(), ids)
	// Collected restaurant stars, aggregated in the same batched pass so the
	// rating on every card is real data, never a placeholder.
	ratings := s.merchantRatingsByMerchant(r.Context(), ids)
	for _, h := range heads {
		p := presence[h.id]
		avg, count := ratingView(ratings[h.id].count, ratings[h.id].avg)
		out = append(out, map[string]any{"id": h.id, "name": h.name, "currency": h.cur, "timezone": h.tz, "address": h.addr, "prep_minutes": h.prep, "distance_m": h.dist, "lat": h.mlat, "lng": h.mlng, "availability": p.availability, "live_couriers_count": p.count, "live_modes": p.modes, "live_nearest_m": p.nearestM, "rating_avg": avg, "rating_count": count, "delivery_window": "30-60 min"})
	}
	writeJSON(w, 200, map[string]any{"restaurants": out})
}

// merchantRating is one restaurant's honest aggregate: the plain average of
// collected restaurant_stars plus how many orders rated it. No Bayesian
// shrinkage here (that rule is the CMS courier-performance page): a small
// count renders next to the average so customers see exactly how much
// signal stands behind it.
type merchantRating struct {
	avg   float64
	count int
}

// ratingView shapes one aggregate for the wire: null average with a zero
// count means "unrated" (the app shows New, never a made-up number).
// Pure so the unrated-vs-rated shaping is unit-tested without a database.
func ratingView(count int, avg float64) (any, int) {
	if count <= 0 {
		return nil, 0
	}
	return avg, count
}

// merchantRatingsByMerchant batches the restaurant-star aggregate for a set
// of merchants: one grouped query over order_ratings, never one per
// restaurant. Only non-null restaurant_stars count.
func (s *Server) merchantRatingsByMerchant(ctx context.Context, ids []string) map[string]merchantRating {
	out := map[string]merchantRating{}
	if len(ids) == 0 {
		return out
	}
	rows, err := s.db.Query(ctx, `SELECT o.merchant_id,
		round(avg(r.restaurant_stars)::numeric,1)::float8, count(*)
		FROM order_ratings r JOIN orders o ON o.id=r.order_id
		WHERE o.merchant_id = ANY($1) AND r.restaurant_stars IS NOT NULL
		GROUP BY 1`, ids)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var mr merchantRating
		if err := rows.Scan(&id, &mr.avg, &mr.count); err == nil {
			out[id] = mr
		}
	}
	return out
}

// merchantHead is one listed restaurant row before the live badge is attached.
type merchantHead struct {
	id, name, cur, tz, addr string
	prep                    int
	dist, mlat, mlng        float64
	country                 string
}

// merchantPresence is the live badge for one restaurant.
type merchantPresence struct {
	availability string
	count        int
	modes        []string
	nearestM     *float64
}

// liveCourierSight is one online session near a merchant (raw pair row).
type liveCourierSight struct {
	mode  string
	distM float64
}

// resolveLiveAvailability is pure: which sightings are close enough to earn
// the badge, given the per-mode pickup radii. Near = within the sighting's
// own mode radius (runner 1500 m / biker 3000 m defaults, CMS-overridable).
// Unit-tested without a database.
func resolveLiveAvailability(sights []liveCourierSight, runnerMaxM, bikerMaxM float64) merchantPresence {
	p := merchantPresence{availability: "staff_only", modes: []string{}}
	seen := map[string]bool{}
	for _, sg := range sights {
		max := bikerMaxM
		if sg.mode != "biker" {
			max = runnerMaxM
		}
		if sg.distM > max {
			continue
		}
		p.count++
		if !seen[sg.mode] {
			seen[sg.mode] = true
			p.modes = append(p.modes, sg.mode)
		}
		if p.nearestM == nil || sg.distM < *p.nearestM {
			d := sg.distM
			p.nearestM = &d
		}
	}
	if p.count > 0 {
		p.availability = "runners_bikers_nearby"
	}
	return p
}

// livePresenceByMerchant batches the live check for a set of merchants: one
// indexed platform_settings lookup per country plus one PostGIS pair query,
// never one query per restaurant. A courier counts as live exactly like
// dispatch treats them: active work session, positioned within the last
// 60 s, approved account, not currently carrying a delivery.
func (s *Server) livePresenceByMerchant(ctx context.Context, ids []string) map[string]merchantPresence {
	out := map[string]merchantPresence{}
	if len(ids) == 0 {
		return out
	}
	countries := map[string]string{}
	crows, err := s.db.Query(ctx, `SELECT id, COALESCE(country,'') FROM merchants WHERE id = ANY($1)`, ids)
	if err == nil {
		defer crows.Close()
		for crows.Next() {
			var id, cc string
			if err := crows.Scan(&id, &cc); err == nil {
				countries[id] = cc
			}
		}
	}
	// Effective per-country dispatch radii (CMS overrides win, no restart).
	dispatchByCountry := map[string]struct{ runner, biker float64 }{}
	maxRadius := 0.0
	for _, cc := range countries {
		if _, ok := dispatchByCountry[cc]; ok {
			continue
		}
		d := s.effectiveDispatch(ctx, cc)
		dispatchByCountry[cc] = struct{ runner, biker float64 }{d.RunnerMaxToPickupM, d.BikerMaxToPickupM}
		if d.RunnerMaxToPickupM > maxRadius {
			maxRadius = d.RunnerMaxToPickupM
		}
		if d.BikerMaxToPickupM > maxRadius {
			maxRadius = d.BikerMaxToPickupM
		}
	}
	if maxRadius < 200 {
		maxRadius = 3000
	}
	if maxRadius > 10000 {
		maxRadius = 10000
	}
	sights := map[string][]liveCourierSight{}
	prows, err := s.db.Query(ctx, `SELECT m.id, c.mode, ST_Distance(s.last_pos, m.location)::float8 AS dist_m
		FROM merchants m
		JOIN activity_sessions s ON s.kind='work' AND s.status='active'
			AND s.last_seen_at > now() - interval '60 seconds'
			AND s.last_pos IS NOT NULL
			AND ST_DWithin(s.last_pos, m.location, $2)
		JOIN couriers c ON c.user_id = s.courier_id AND c.status='approved'
		LEFT JOIN deliveries d ON d.courier_id = s.courier_id
			AND d.status IN ('assigned','at_pickup','picked_up','at_dropoff')
		WHERE m.id = ANY($1) AND d.id IS NULL`, ids, maxRadius)
	if err == nil {
		defer prows.Close()
		for prows.Next() {
			var mid, mode string
			var dist float64
			if err := prows.Scan(&mid, &mode, &dist); err != nil {
				continue
			}
			sights[mid] = append(sights[mid], liveCourierSight{mode: mode, distM: dist})
		}
	}
	for _, id := range ids {
		d := dispatchByCountry[countries[id]]
		if d.runner == 0 && d.biker == 0 {
			d.runner, d.biker = 1500, 3000
		}
		out[id] = resolveLiveAvailability(sights[id], d.runner, d.biker)
	}
	return out
}

func (s *Server) getRestaurant(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	lat, _ := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, _ := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	var name, cur, tz, addr, note string
	var prep int
	var mlat, mlng, dist float64
	err := s.db.QueryRow(r.Context(), `SELECT name,currency,timezone,address,pickup_note,prep_minutes, ST_Y(location::geometry), ST_X(location::geometry),
		ST_Distance(location, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) FROM merchants WHERE id=$1`, id, lng, lat).Scan(&name, &cur, &tz, &addr, &note, &prep, &mlat, &mlng, &dist)
	if err != nil {
		problem(w, 404, "Not found", "restaurant not found")
		return
	}
	// Live badge for this restaurant only: online couriers near it right now.
	p := s.livePresenceByMerchant(r.Context(), []string{id})[id]
	// Real collected stars for this restaurant (same batched aggregate).
	ratings := s.merchantRatingsByMerchant(r.Context(), []string{id})
	if p.availability == "" {
		p.availability = "staff_only"
		p.modes = []string{}
	}
	out := map[string]any{"id": id, "name": name, "currency": cur, "timezone": tz, "address": addr,
		"pickup_note": note, "prep_minutes": prep, "lat": mlat, "lng": mlng, "availability": p.availability,
		"live_couriers_count": p.count, "live_modes": p.modes, "live_nearest_m": p.nearestM}
	avg, count := ratingView(ratings[id].count, ratings[id].avg)
	out["rating_avg"], out["rating_count"] = avg, count
	if lat != 0 || lng != 0 {
		out["distance_m"] = dist
	}
	writeJSON(w, 200, out)
}

func (s *Server) getMenu(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var cur string
	if err := s.db.QueryRow(r.Context(), `SELECT currency FROM merchants WHERE id=$1`, id).Scan(&cur); err != nil {
		problem(w, 404, "Not found", "restaurant not found")
		return
	}
	// Categories for the chip row (per-merchant rows, sort order preserved).
	catRows, err := s.db.Query(r.Context(), `SELECT id, name, sort FROM menu_categories WHERE merchant_id=$1 ORDER BY sort, id`, id)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	categories := []map[string]any{}
	for catRows.Next() {
		var cid string
		var nameB []byte
		var sort int
		if err := catRows.Scan(&cid, &nameB, &sort); err != nil {
			continue
		}
		var name map[string]string
		_ = json.Unmarshal(nameB, &name)
		categories = append(categories, map[string]any{"id": cid, "name": name, "sort": sort})
	}
	catRows.Close()
	// Optional ?category_id= narrows the item list server-side so the
	// customer chip row actually filters instead of paginating client-side.
	categoryID := strings.TrimSpace(r.URL.Query().Get("category_id"))
	itemQuery := `SELECT id,category_id,name,description,price_minor,size_class,travels_well,photo_url,available FROM menu_items WHERE merchant_id=$1`
	itemArgs := []any{id}
	if categoryID != "" {
		itemQuery += ` AND category_id=$2`
		itemArgs = append(itemArgs, categoryID)
	}
	itemQuery += ` ORDER BY name->>'en'`
	rows, err := s.db.Query(r.Context(), itemQuery, itemArgs...)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var iid, size, photo string
		var cat *string
		var nameB, descB []byte
		var price int64
		var tw, avail bool
		if err := rows.Scan(&iid, &cat, &nameB, &descB, &price, &size, &tw, &photo, &avail); err != nil {
			continue
		}
		var name, desc map[string]string
		_ = json.Unmarshal(nameB, &name)
		_ = json.Unmarshal(descB, &desc)
		items = append(items, map[string]any{"id": iid, "category_id": cat, "name": name, "description": desc, "price": map[string]any{"amount_minor": price, "currency": cur}, "size_class": size, "travels_well": tw, "photo_url": photo, "available": avail})
	}
	writeJSON(w, 200, map[string]any{"merchant_id": id, "currency": cur, "categories": categories, "items": items})
}

// listCustomerCategories returns the distinct menu-category names across
// approved merchants so the customer chip row is API-driven, never hardcoded.
// Grouped by the English name (per-merchant rows share names like "Minuman");
// each entry carries one localized label map plus how many restaurants serve it.
func (s *Server) listCustomerCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT mc.name, COUNT(DISTINCT mc.merchant_id) AS restaurants
		FROM menu_categories mc JOIN merchants m ON m.id=mc.merchant_id
		WHERE m.status='approved'
		GROUP BY mc.name->>'en', mc.name ORDER BY COUNT(DISTINCT mc.merchant_id) DESC, mc.name->>'en' ASC`)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var nameB []byte
		var count int
		if err := rows.Scan(&nameB, &count); err != nil {
			continue
		}
		var name map[string]string
		_ = json.Unmarshal(nameB, &name)
		label := name["en"]
		if label == "" {
			for _, v := range name {
				if strings.TrimSpace(v) != "" {
					label = v
					break
				}
			}
		}
		if label == "" {
			continue
		}
		out = append(out, map[string]any{"name": name, "label": label, "restaurant_count": count})
	}
	writeJSON(w, 200, map[string]any{"categories": out})
}

func (s *Server) listAddresses(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	rows, err := s.db.Query(r.Context(), `SELECT id,label,address,lat,lng,note,is_default,created_at,updated_at FROM customer_addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC`, c.Sub)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, label, addr, note string
		var lat, lng float64
		var def bool
		var created, updated time.Time
		if err := rows.Scan(&id, &label, &addr, &lat, &lng, &note, &def, &created, &updated); err != nil {
			continue
		}
		out = append(out, addressView(id, label, addr, lat, lng, note, def, created, updated))
	}
	writeJSON(w, 200, map[string]any{"addresses": out})
}

// addressView renders one address row in wire shape (ISO-8601 UTC times,
// matching what the customer PWA parseAddress expects).
func addressView(id, label, addr string, lat, lng float64, note string, def bool, created, updated time.Time) map[string]any {
	return map[string]any{"id": id, "label": label, "address": addr, "lat": lat, "lng": lng,
		"note": note, "is_default": def,
		"created_at": created.UTC().Format(time.RFC3339),
		"updated_at": updated.UTC().Format(time.RFC3339)}
}

// validateAddressBody enforces dispatch-grade pins plus UI-sized text.
func validateAddressBody(label string, lat, lng float64, note, addr string) string {
	if strings.TrimSpace(label) == "" {
		return "label is required (e.g. Home, Office)"
	}
	if len(label) > 60 {
		return "label must be 60 characters or fewer"
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat == 0 && lng == 0) {
		return "a valid delivery pin (lat/lng) is required"
	}
	if len(note) > 500 {
		return "note must be 500 characters or fewer"
	}
	if len(addr) > 500 {
		return "address must be 500 characters or fewer"
	}
	return ""
}

type addressBody struct {
	Label     string  `json:"label"`
	Address   string  `json:"address"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	Note      string  `json:"note"`
	IsDefault *bool   `json:"is_default"`
}

func (s *Server) createAddress(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b addressBody
	if !decode(w, r, &b) {
		return
	}
	if strings.TrimSpace(b.Label) == "" {
		b.Label = "Home"
	}
	if msg := validateAddressBody(b.Label, b.Lat, b.Lng, b.Note, b.Address); msg != "" {
		problem(w, 400, "Validation failed", msg)
		return
	}
	ctx := r.Context()
	var count int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM customer_addresses WHERE user_id=$1`, c.Sub).Scan(&count)
	wantDefault := count == 0
	if b.IsDefault != nil {
		wantDefault = *b.IsDefault
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	if wantDefault {
		if _, err := tx.Exec(ctx, `UPDATE customer_addresses SET is_default=false, updated_at=now() WHERE user_id=$1 AND is_default`, c.Sub); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
	}
	var id string
	var created, updated time.Time
	err = tx.QueryRow(ctx, `INSERT INTO customer_addresses(user_id,label,address,lat,lng,note,is_default) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at, updated_at`,
		c.Sub, strings.TrimSpace(b.Label), strings.TrimSpace(b.Address), b.Lat, b.Lng, b.Note, wantDefault).Scan(&id, &created, &updated)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 201, addressView(id, strings.TrimSpace(b.Label), strings.TrimSpace(b.Address), b.Lat, b.Lng, b.Note, wantDefault, created, updated))
}

func (s *Server) updateAddress(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	id := r.PathValue("id")
	var b addressBody
	if !decode(w, r, &b) {
		return
	}
	if strings.TrimSpace(b.Label) == "" {
		b.Label = "Home"
	}
	if msg := validateAddressBody(b.Label, b.Lat, b.Lng, b.Note, b.Address); msg != "" {
		problem(w, 400, "Validation failed", msg)
		return
	}
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	var curDefault bool
	err = tx.QueryRow(ctx, `SELECT is_default FROM customer_addresses WHERE id=$1 AND user_id=$2`, id, c.Sub).Scan(&curDefault)
	if err != nil {
		problem(w, 404, "Not found", "delivery address not found")
		return
	}
	wantDefault := curDefault
	if b.IsDefault != nil {
		wantDefault = *b.IsDefault
	}
	if wantDefault && !curDefault {
		if _, err := tx.Exec(ctx, `UPDATE customer_addresses SET is_default=false, updated_at=now() WHERE user_id=$1 AND is_default`, c.Sub); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
	}
	var updated time.Time
	err = tx.QueryRow(ctx, `UPDATE customer_addresses SET label=$3, address=$4, lat=$5, lng=$6, note=$7, is_default=$8, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING updated_at`,
		id, c.Sub, strings.TrimSpace(b.Label), strings.TrimSpace(b.Address), b.Lat, b.Lng, b.Note, wantDefault).Scan(&updated)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"id": id, "label": strings.TrimSpace(b.Label), "address": strings.TrimSpace(b.Address), "lat": b.Lat, "lng": b.Lng, "note": b.Note, "is_default": wantDefault, "updated_at": updated.UTC().Format(time.RFC3339)})
}

func (s *Server) deleteAddress(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	id := r.PathValue("id")
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	var wasDefault bool
	err = tx.QueryRow(ctx, `DELETE FROM customer_addresses WHERE id=$1 AND user_id=$2 RETURNING is_default`, id, c.Sub).Scan(&wasDefault)
	if err != nil {
		problem(w, 404, "Not found", "delivery address not found")
		return
	}
	promoted := ""
	if wasDefault {
		// Keep the book usable: promote the newest remaining address.
		_ = tx.QueryRow(ctx, `UPDATE customer_addresses SET is_default=true, updated_at=now() WHERE id=(SELECT id FROM customer_addresses WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1) RETURNING id`, c.Sub).Scan(&promoted)
	}
	if err := tx.Commit(ctx); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"deleted": true, "promoted_default_id": promoted})
}

func (s *Server) setDefaultAddress(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	id := r.PathValue("id")
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	var exists bool
	_ = s.db.QueryRow(ctx, `SELECT true FROM customer_addresses WHERE id=$1 AND user_id=$2`, id, c.Sub).Scan(&exists)
	if !exists {
		problem(w, 404, "Not found", "delivery address not found")
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE customer_addresses SET is_default=false, updated_at=now() WHERE user_id=$1 AND is_default`, c.Sub); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE customer_addresses SET is_default=true, updated_at=now() WHERE id=$1 AND user_id=$2`, id, c.Sub); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"id": id, "is_default": true})
}

// defaultAddressFor returns the user's default (else newest) dropoff for
// orders that omit both address_id and an explicit pin.
func (s *Server) defaultAddressFor(ctx context.Context, userID string) (lat, lng float64, note string, ok bool) {
	err := s.db.QueryRow(ctx, `SELECT lat, lng, note FROM customer_addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC LIMIT 1`, userID).Scan(&lat, &lng, &note)
	return lat, lng, note, err == nil
}

// ---------- Courier ----------
func (s *Server) getApplication(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var mode, status, reason string
	var draft, flags []byte
	var dist float64
	var mov, ela, gap int
	var passed bool
	var submittedAt, updatedAt *time.Time
	err := s.db.QueryRow(r.Context(), `SELECT mode,status,reject_reason,draft,fitness_distance_m,fitness_moving_s,fitness_elapsed_s,fitness_passed,fitness_flags,fitness_gap_max_s,submitted_at,updated_at FROM courier_applications WHERE user_id=$1`, c.Sub).Scan(&mode, &status, &reason, &draft, &dist, &mov, &ela, &passed, &flags, &gap, &submittedAt, &updatedAt)
	if err != nil {
		writeJSON(w, 200, map[string]any{"status": "none", "mode": "runner", "draft": map[string]any{}})
		return
	}
	var d map[string]any
	_ = json.Unmarshal(draft, &d)
	var fl []string
	_ = json.Unmarshal(flags, &fl)
	var checkpoints int
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM checkpoint_photos cp JOIN activity_sessions s ON s.id=cp.session_id WHERE s.courier_id=$1`, c.Sub).Scan(&checkpoints)
	var standing string
	_ = s.db.QueryRow(r.Context(), `SELECT status FROM couriers WHERE user_id=$1`, c.Sub).Scan(&standing)
	writeJSON(w, 200, map[string]any{"mode": mode, "status": status, "standing": standing, "reject_reason": reason, "draft": d,
		"fitness": map[string]any{"distance_m": dist, "moving_s": mov, "elapsed_s": ela, "passed": passed,
			"flags": fl, "max_gap_s": gap, "checkpoints": checkpoints},
		"submitted_at": tsOrNil(submittedAt), "updated_at": tsOrNil(updatedAt)})
}

func (s *Server) saveApplication(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b struct {
		Mode  string         `json:"mode"`
		Draft map[string]any `json:"draft"`
	}
	if !decode(w, r, &b) {
		return
	}
	if b.Mode != "biker" {
		b.Mode = "runner"
	}
	draftB, _ := json.Marshal(b.Draft)
	_, err := s.db.Exec(r.Context(), `INSERT INTO courier_applications(user_id,mode,draft) VALUES($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET mode=EXCLUDED.mode, draft=EXCLUDED.draft, updated_at=now() WHERE courier_applications.status IN ('draft','testing','passed_test','rejected')`, c.Sub, b.Mode, draftB)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"saved": true})
}

// EvaluateFitness applies config rules (moving time, 2x elapsed cap).
func EvaluateFitness(mode string, dist float64, movingS, elapsedS int, cfgDist float64, cfgMoving int, mult int) bool {
	_ = mode
	if dist < cfgDist || movingS <= 0 || elapsedS <= 0 {
		return false
	}
	if movingS > cfgMoving {
		return false
	}
	if elapsedS >= mult*cfgMoving {
		return false
	}
	return true
}

func (s *Server) submitFitness(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b struct {
		Mode           string  `json:"mode"`
		DistanceM      float64 `json:"distance_m"`
		MovingS        int     `json:"moving_s"`
		ElapsedS       int     `json:"elapsed_s"`
		CheckpointFile string  `json:"checkpoint_file_id"`
		Points         int     `json:"points"`
	}
	if !decode(w, r, &b) {
		return
	}
	// Under review the test locks: the courier cannot submit again until
	// the admin approves or rejects (mirrors the qualification-session gate).
	// Approved partners never retake it (one-time gate, PLAN §8.2).
	var appStatus string
	_ = s.db.QueryRow(r.Context(), `SELECT status FROM courier_applications WHERE user_id=$1`, c.Sub).Scan(&appStatus)
	if appStatus == "pending" || appStatus == "pending_review" {
		problem(w, 409, "Conflict", "application under review; the fitness test unlocks after the review team approves or rejects it")
		return
	}
	if appStatus == "approved" {
		problem(w, 409, "Conflict", "already approved; the fitness test is a one-time gate and cannot be retaken")
		return
	}
	cfg := s.cfg
	target, limit := cfg.Fitness.RunnerDistanceM, cfg.Fitness.RunnerMovingLimitS
	if b.Mode == "biker" {
		target, limit = cfg.Fitness.BikerDistanceM, cfg.Fitness.BikerMovingLimitS
	}
	passed := EvaluateFitness(b.Mode, b.DistanceM, b.MovingS, b.ElapsedS, target, limit, cfg.Fitness.ElapsedCapMultiplier)
	_, _ = s.db.Exec(r.Context(), `INSERT INTO courier_applications(user_id,mode,fitness_distance_m,fitness_moving_s,fitness_elapsed_s,fitness_passed) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO UPDATE SET fitness_distance_m=EXCLUDED.fitness_distance_m, fitness_moving_s=EXCLUDED.fitness_moving_s, fitness_elapsed_s=EXCLUDED.fitness_elapsed_s, fitness_passed=EXCLUDED.fitness_passed, updated_at=now()`, c.Sub, b.Mode, b.DistanceM, b.MovingS, b.ElapsedS, passed)
	writeJSON(w, 200, map[string]any{"passed": passed, "target_distance_m": target, "moving_limit_s": limit, "distance_m": b.DistanceM, "moving_s": b.MovingS, "elapsed_s": b.ElapsedS})
}

func (s *Server) submitApplication(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var passed bool
	var status, mode string
	var updated time.Time
	err := s.db.QueryRow(r.Context(), `SELECT fitness_passed,status,mode,updated_at FROM courier_applications WHERE user_id=$1`, c.Sub).Scan(&passed, &status, &mode, &updated)
	if err != nil {
		problem(w, 400, "Validation failed", "save a draft and fitness test first")
		return
	}
	if status == "approved" {
		writeJSON(w, 200, map[string]any{"status": "approved"})
		return
	}
	if status == "rejected" && time.Since(updated) < 7*24*time.Hour {
		problem(w, 409, "Conflict", "you can apply again 7 days after a rejection")
		return
	}
	if status != "draft" && status != "testing" && status != "passed_test" && status != "pending" && status != "pending_review" && status != "rejected" {
		problem(w, 409, "Conflict", "application is "+status)
		return
	}
	// Personal details + private-bucket documents (plan 8.1) come first.
	if missing := s.profileMissing(r.Context(), c.Sub, mode); len(missing) > 0 {
		writeJSON(w, 422, map[string]any{"status": status, "missing": missing,
			"detail": "complete your profile and documents before submitting"})
		return
	}
	if !passed {
		problem(w, 400, "Validation failed", "pass the fitness test first")
		return
	}
	// The ID hash blocks duplicate accounts.
	var idHash string
	_ = s.db.QueryRow(r.Context(), `SELECT id_number_hash FROM couriers WHERE user_id=$1`, c.Sub).Scan(&idHash)
	if idHash != "" {
		var dup int
		_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM couriers WHERE id_number_hash=$1 AND user_id<>$2`, idHash, c.Sub).Scan(&dup)
		if dup > 0 {
			problem(w, 409, "Conflict", "this ID is already registered")
			return
		}
	}
	// Submit → pending_review → admin queue (plan 8.2). Status write,
	// applicant email + push are queued in the same transaction.
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `UPDATE courier_applications SET status='pending_review', submitted_at=now(), updated_at=now() WHERE user_id=$1`, c.Sub); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	var email string
	_ = tx.QueryRow(r.Context(), `SELECT email FROM users WHERE id=$1`, c.Sub).Scan(&email)
	s.queueApplicantJobs(r.Context(), tx, c.Sub, email,
		"Your Trackfud courier application is under review",
		"Thanks! Your fitness test passed and your application is now in the review queue. We will email you the decision.",
		"Application under review")
	// B6: advisory Trust Brief in the same transaction (advisory only).
	_ = s.enqueueTx(r.Context(), tx, AIJobTrustBrief, fmt.Sprintf(`{"user_id":%q}`, c.Sub), time.Now())
	if err := tx.Commit(r.Context()); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"status": "pending_review", "fitness_passed": passed})
}

// ---------- Merchant ----------
const agreementVersion = "2026-10-27.v1"
const agreementText = "Trackfud Partner Agreement v2026-10-27.v1\n\n1. Commission 10% (5% when your own staff delivers). 2. Staff-fallback clause: when no runner/biker accepts, your on-shift staff may be offered the delivery. 3. Only travels_well items are eligible for courier delivery. 4. Demo uses Paddle sandbox and mock payouts only. You agree by typing your full name and ticking the box."

func (s *Server) currentAgreement(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"version": agreementVersion, "text": agreementText, "sha256": fmt.Sprintf("%x", sha256.Sum256([]byte(agreementText)))})
}

func (s *Server) createMerchant(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	if !requireRole(w, r, "merchant", "admin") {
		return
	}
	var b merchantBody
	if !decode(w, r, &b) {
		return
	}
	if strings.TrimSpace(b.Name) == "" {
		problem(w, 400, "Validation failed", "business name required")
		return
	}
	if msg := validateMerchantBody(b); msg != "" {
		problem(w, 400, "Validation failed", msg)
		return
	}
	id, err := s.insertMerchant(r, c.Sub, b)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{"id": id, "status": "draft"})
}

type merchantBody struct {
	Name         string         `json:"name"`
	Phone        string         `json:"phone"`
	Country      string         `json:"country"`
	Currency     string         `json:"currency"`
	Timezone     string         `json:"timezone"`
	Address      string         `json:"address"`
	PickupNote   string         `json:"pickup_note"`
	Lat          float64        `json:"lat"`
	Lng          float64        `json:"lng"`
	PrepMinutes  int            `json:"prep_minutes"`
	OpeningHours map[string]any `json:"opening_hours"`
}

func (s *Server) insertMerchant(r *http.Request, owner string, b merchantBody) (string, error) {
	if b.Currency == "" {
		b.Currency = "IDR"
	}
	if b.Timezone == "" {
		b.Timezone = "Asia/Jakarta"
	}
	if b.Country == "" {
		b.Country = "ID"
	}
	if b.PrepMinutes <= 0 {
		b.PrepMinutes = 15
	}
	hours, _ := json.Marshal(b.OpeningHours)
	var id string
	err := s.db.QueryRow(r.Context(), `INSERT INTO merchants(owner_id,name,phone,country,currency,timezone,address,pickup_note,location,prep_minutes,opening_hours) VALUES($1,$2,$3,$4,$5,$6,$7,$8,ST_SetSRID(ST_MakePoint($9,$10),4326)::geography,$11,$12) RETURNING id`, owner, b.Name, b.Phone, b.Country, b.Currency, b.Timezone, b.Address, b.PickupNote, b.Lng, b.Lat, b.PrepMinutes, hours).Scan(&id)
	return id, err
}

func (s *Server) myMerchant(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	m, err := s.fetchMerchant(r, c.Sub)
	if err != nil {
		writeJSON(w, 200, map[string]any{"merchant": nil})
		return
	}
	writeJSON(w, 200, map[string]any{"merchant": m})
}

func (s *Server) fetchMerchant(r *http.Request, owner string) (map[string]any, error) {
	var id, name, phone, country, cur, tz, addr, note, status string
	var prep int
	var hours []byte
	var lat, lng float64
	err := s.db.QueryRow(r.Context(), `SELECT id,name,phone,country,currency,timezone,address,pickup_note,status,prep_minutes,opening_hours, COALESCE(ST_Y(location::geometry),0), COALESCE(ST_X(location::geometry),0) FROM merchants WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1`, owner).Scan(&id, &name, &phone, &country, &cur, &tz, &addr, &note, &status, &prep, &hours, &lat, &lng)
	if err != nil {
		return nil, err
	}
	var h map[string]any
	_ = json.Unmarshal(hours, &h)
	return map[string]any{"id": id, "name": name, "phone": phone, "country": country, "currency": cur, "timezone": tz, "address": addr, "pickup_note": note, "status": status, "prep_minutes": prep, "opening_hours": h, "lat": lat, "lng": lng}, nil
}

// validateMerchantBody enforces dispatch-grade location plus sane prep times.
func validateMerchantBody(b merchantBody) string {
	if b.Lat < -90 || b.Lat > 90 || b.Lng < -180 || b.Lng > 180 || (b.Lat == 0 && b.Lng == 0) {
		return "a valid restaurant location pin (lat/lng) is required for dispatch"
	}
	if b.PrepMinutes < 1 || b.PrepMinutes > 120 {
		return "prep_minutes must be between 1 and 120"
	}
	if b.Currency != "" && len(b.Currency) != 3 {
		return "currency must be an ISO-4217 code (e.g. IDR, GBP)"
	}
	if b.OpeningHours != nil {
		for day, v := range b.OpeningHours {
			hours, ok := v.(map[string]any)
			if !ok {
				return "opening_hours must map each weekday to an object with open/close times"
			}
			_ = day
			if _, ok := hours["open"]; !ok {
				return "opening_hours entries need open and close times"
			}
			if _, ok := hours["close"]; !ok {
				return "opening_hours entries need open and close times"
			}
		}
	}
	return ""
}

func (s *Server) updateMerchant(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b merchantBody
	if !decode(w, r, &b) {
		return
	}
	if msg := validateMerchantBody(b); msg != "" {
		problem(w, 400, "Validation failed", msg)
		return
	}
	m, err := s.fetchMerchant(r, c.Sub)
	if err != nil {
		id, err := s.insertMerchant(r, c.Sub, b)
		if err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"id": id})
		return
	}
	hours, _ := json.Marshal(b.OpeningHours)
	_, err = s.db.Exec(r.Context(), `UPDATE merchants SET name=$2,phone=$3,country=$4,currency=$5,timezone=$6,address=$7,pickup_note=$8,location=ST_SetSRID(ST_MakePoint($9,$10),4326)::geography,prep_minutes=$11,opening_hours=$12 WHERE id=$1`, m["id"], b.Name, b.Phone, b.Country, b.Currency, b.Timezone, b.Address, b.PickupNote, b.Lng, b.Lat, b.PrepMinutes, hours)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	s2, _ := s.fetchMerchant(r, c.Sub)
	writeJSON(w, 200, map[string]any{"merchant": s2})
}

func (s *Server) signAgreement(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b struct {
		SignerName string `json:"signer_name"`
		Agreed     bool   `json:"agreed"`
		Version    string `json:"version"`
	}
	if !decode(w, r, &b) {
		return
	}
	if !b.Agreed || strings.TrimSpace(b.SignerName) == "" {
		problem(w, 400, "Validation failed", "type your full name and tick the agreement box")
		return
	}
	if b.Version != "" && b.Version != agreementVersion {
		problem(w, 400, "Validation failed", "agreement version changed; reload and sign the current text")
		return
	}
	m, err := s.fetchMerchant(r, c.Sub)
	if err != nil {
		problem(w, 400, "Validation failed", "create your store profile first")
		return
	}
	// Idempotency: the same version signed twice returns the original row
	// so a double-tap can never create a duplicate signature.
	var existingID string
	var existingAt time.Time
	err = s.db.QueryRow(r.Context(), `SELECT id, signed_at FROM merchant_agreements
		WHERE merchant_id=$1 AND version=$2 AND agreed=true ORDER BY signed_at DESC LIMIT 1`,
		m["id"], agreementVersion).Scan(&existingID, &existingAt)
	if err == nil {
		writeJSON(w, 200, map[string]any{
			"id": existingID, "status": "pending", "version": agreementVersion,
			"signed_at": existingAt.UTC().Format(time.RFC3339), "duplicate": true,
		})
		return
	}
	// Versioned e-sign: the exact text snapshot is stored with its sha256 so
	// a future version change can force re-acceptance; signer IP/UA are kept
	// for the audit trail.
	sum := fmt.Sprintf("%x", sha256.Sum256([]byte(agreementText)))
	ip := r.RemoteAddr
	if h := r.Header.Get("X-Forwarded-For"); h != "" {
		ip = strings.Split(h, ",")[0]
	}
	var id string
	err = s.db.QueryRow(r.Context(), `INSERT INTO merchant_agreements(merchant_id,version,signer_name,agreed,sha256,text_snapshot,ip,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, m["id"], agreementVersion, strings.TrimSpace(b.SignerName), b.Agreed, sum, agreementText, strings.TrimSpace(ip), r.UserAgent()).Scan(&id)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE merchants SET status='pending' WHERE id=$1`, m["id"])
	writeJSON(w, 201, map[string]any{"id": id, "status": "pending", "version": agreementVersion})
}

func (s *Server) listStaff(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	m, err := s.fetchMerchant(r, c.Sub)
	if err != nil {
		writeJSON(w, 200, map[string]any{"staff": []any{}})
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT id,email,role,can_deliver,on_shift,status FROM merchant_staff WHERE merchant_id=$1 ORDER BY created_at`, m["id"])
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, email, role, st string
		var cd, os bool
		_ = rows.Scan(&id, &email, &role, &cd, &os, &st)
		out = append(out, map[string]any{"id": id, "email": email, "role": role, "can_deliver": cd, "on_shift": os, "status": st})
	}
	writeJSON(w, 200, map[string]any{"staff": out})
}

func (s *Server) inviteStaff(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	m, err := s.fetchMerchant(r, c.Sub)
	if err != nil {
		problem(w, 400, "Validation failed", "create your store profile first")
		return
	}
	var b struct {
		Email      string `json:"email"`
		Role       string `json:"role"`
		CanDeliver bool   `json:"can_deliver"`
	}
	if !decode(w, r, &b) {
		return
	}
	if !strings.Contains(b.Email, "@") {
		problem(w, 400, "Validation failed", "valid staff email required")
		return
	}
	if b.Role == "" {
		b.Role = "staff"
	}
	var id string
	err = s.db.QueryRow(r.Context(), `INSERT INTO merchant_staff(merchant_id,email,role,can_deliver) VALUES($1,$2,$3,$4) ON CONFLICT (merchant_id,email) DO UPDATE SET role=EXCLUDED.role, can_deliver=EXCLUDED.can_deliver RETURNING id`, m["id"], strings.ToLower(b.Email), b.Role, b.CanDeliver).Scan(&id)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	s.enqueueNow(JobEmailSend, fmt.Sprintf(`{"to":%q,"subject":"You are invited to Trackfud staff","body":"You were invited as staff. Sign up with this email to accept (demo)."}`, strings.ToLower(b.Email)), time.Now())
	writeJSON(w, 201, map[string]any{"id": id, "email": strings.ToLower(b.Email), "status": "invited"})
}

func (s *Server) updateStaff(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	m, err := s.fetchMerchant(r, c.Sub)
	if err != nil {
		problem(w, 404, "Not found", "merchant not found")
		return
	}
	var b struct {
		CanDeliver *bool  `json:"can_deliver"`
		OnShift    *bool  `json:"on_shift"`
		Role       string `json:"role"`
	}
	if !decode(w, r, &b) {
		return
	}
	id := r.PathValue("id")
	if b.CanDeliver != nil {
		_, _ = s.db.Exec(r.Context(), `UPDATE merchant_staff SET can_deliver=$3 WHERE id=$1 AND merchant_id=$2`, id, m["id"], *b.CanDeliver)
	}
	if b.OnShift != nil {
		_, _ = s.db.Exec(r.Context(), `UPDATE merchant_staff SET on_shift=$3 WHERE id=$1 AND merchant_id=$2`, id, m["id"], *b.OnShift)
	}
	if b.Role != "" {
		_, _ = s.db.Exec(r.Context(), `UPDATE merchant_staff SET role=$3 WHERE id=$1 AND merchant_id=$2`, id, m["id"], b.Role)
	}
	writeJSON(w, 200, map[string]any{"updated": true})
}

var _ = time.Now
