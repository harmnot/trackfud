package app

import (
	"encoding/json"
	"net/http"
	"strings"
)

// Merchant menu CRUD (B2 catalog). Every write is scoped to the caller's own
// merchant; items carry the size_class/spill_risk/travels_well labels that
// feed dispatch (Snap-a-Menu output lands here in B6).

func validSize(s string) bool {
	return s == "S" || s == "M" || s == "L"
}

func validSpill(s string) bool {
	return s == "low" || s == "medium" || s == "high"
}

// validLocaleMap requires at least one non-empty locale string.
func validLocaleMap(m map[string]string) bool {
	for _, v := range m {
		if strings.TrimSpace(v) != "" {
			return true
		}
	}
	return false
}

// ownMerchantID resolves the caller's merchant or writes the problem.
func (s *Server) ownMerchantID(w http.ResponseWriter, r *http.Request) string {
	c := claims(r)
	for _, rl := range c.Roles {
		if rl == "admin" {
			if id := r.URL.Query().Get("merchant_id"); id != "" {
				return id
			}
		}
	}
	m, err := s.fetchMerchant(r, c.Sub)
	if err != nil {
		problem(w, 400, "Validation failed", "create your store profile first")
		return ""
	}
	id, _ := m["id"].(string)
	return id
}

// ---------- categories ----------

func (s *Server) listCategories(w http.ResponseWriter, r *http.Request) {
	mid := s.ownMerchantID(w, r)
	if mid == "" {
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT id, name, sort FROM menu_categories WHERE merchant_id=$1 ORDER BY sort, id`, mid)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id string
		var nameB []byte
		var sort int
		if err := rows.Scan(&id, &nameB, &sort); err != nil {
			continue
		}
		var name map[string]string
		_ = json.Unmarshal(nameB, &name)
		out = append(out, map[string]any{"id": id, "name": name, "sort": sort})
	}
	writeJSON(w, 200, map[string]any{"categories": out})
}

func (s *Server) createCategory(w http.ResponseWriter, r *http.Request) {
	mid := s.ownMerchantID(w, r)
	if mid == "" {
		return
	}
	var b struct {
		Name map[string]string `json:"name"`
		Sort int               `json:"sort"`
	}
	if !decode(w, r, &b) {
		return
	}
	if !validLocaleMap(b.Name) {
		problem(w, 400, "Validation failed", "category name in at least one language required")
		return
	}
	nameB, _ := json.Marshal(b.Name)
	var id string
	if err := s.db.QueryRow(r.Context(), `INSERT INTO menu_categories(merchant_id,name,sort) VALUES($1,$2,$3) RETURNING id`,
		mid, nameB, b.Sort).Scan(&id); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{"id": id, "name": b.Name, "sort": b.Sort})
}

func (s *Server) updateCategory(w http.ResponseWriter, r *http.Request) {
	mid := s.ownMerchantID(w, r)
	if mid == "" {
		return
	}
	var b struct {
		Name *map[string]string `json:"name"`
		Sort *int               `json:"sort"`
	}
	if !decode(w, r, &b) {
		return
	}
	if b.Name != nil {
		if !validLocaleMap(*b.Name) {
			problem(w, 400, "Validation failed", "category name cannot be emptied")
			return
		}
		nameB, _ := json.Marshal(*b.Name)
		_, _ = s.db.Exec(r.Context(), `UPDATE menu_categories SET name=$3 WHERE id=$1 AND merchant_id=$2`,
			r.PathValue("id"), mid, nameB)
	}
	if b.Sort != nil {
		_, _ = s.db.Exec(r.Context(), `UPDATE menu_categories SET sort=$3 WHERE id=$1 AND merchant_id=$2`,
			r.PathValue("id"), mid, *b.Sort)
	}
	writeJSON(w, 200, map[string]any{"updated": true})
}

func (s *Server) deleteCategory(w http.ResponseWriter, r *http.Request) {
	mid := s.ownMerchantID(w, r)
	if mid == "" {
		return
	}
	// Items keep their row with category_id nulled by the FK rule.
	_, _ = s.db.Exec(r.Context(), `DELETE FROM menu_categories WHERE id=$1 AND merchant_id=$2`, r.PathValue("id"), mid)
	w.WriteHeader(204)
}

// ---------- items ----------

type menuItemBody struct {
	CategoryID  *string           `json:"category_id"`
	Name        map[string]string `json:"name"`
	Description map[string]string `json:"description"`
	PriceMinor  *int64            `json:"price_minor"`
	SizeClass   string            `json:"size_class"`
	SpillRisk   string            `json:"spill_risk"`
	TravelsWell *bool             `json:"travels_well"`
	PhotoURL    string            `json:"photo_url"`
	Available   *bool             `json:"available"`
}

func (b *menuItemBody) validateForCreate() string {
	if !validLocaleMap(b.Name) {
		return "item name in at least one language required"
	}
	if b.PriceMinor != nil && *b.PriceMinor < 0 {
		return "price_minor cannot be negative"
	}
	if !validSize(b.SizeClass) {
		return "size_class must be S, M or L"
	}
	if !validSpill(b.SpillRisk) {
		return "spill_risk must be low, medium or high"
	}
	return ""
}

func (s *Server) listMenuItems(w http.ResponseWriter, r *http.Request) {
	mid := s.ownMerchantID(w, r)
	if mid == "" {
		return
	}
	q := `SELECT id, category_id, name, description, price_minor, size_class, spill_risk, travels_well, photo_url, available
		FROM menu_items WHERE merchant_id=$1`
	args := []any{mid}
	if cat := r.URL.Query().Get("category_id"); cat != "" {
		q += ` AND category_id=$2`
		args = append(args, cat)
	}
	q += ` ORDER BY name->>'en'`
	rows, err := s.db.Query(r.Context(), q, args...)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	writeJSON(w, 200, map[string]any{"items": scanMenuItems(rows)})
}

func scanMenuItems(rows interface {
	Next() bool
	Scan(...any) error
	Err() error
}) []map[string]any {
	out := []map[string]any{}
	for rows.Next() {
		var id, size, spill, photo string
		var cat *string
		var nameB, descB []byte
		var price int64
		var tw, avail bool
		if err := rows.Scan(&id, &cat, &nameB, &descB, &price, &size, &spill, &tw, &photo, &avail); err != nil {
			continue
		}
		var name, desc map[string]string
		_ = json.Unmarshal(nameB, &name)
		_ = json.Unmarshal(descB, &desc)
		out = append(out, map[string]any{"id": id, "category_id": cat, "name": name, "description": desc,
			"price_minor": price, "size_class": size, "spill_risk": spill,
			"travels_well": tw, "photo_url": photo, "available": avail})
	}
	return out
}

func (s *Server) createMenuItem(w http.ResponseWriter, r *http.Request) {
	mid := s.ownMerchantID(w, r)
	if mid == "" {
		return
	}
	var b menuItemBody
	if !decode(w, r, &b) {
		return
	}
	if msg := b.validateForCreate(); msg != "" {
		problem(w, 400, "Validation failed", msg)
		return
	}
	tw, avail := true, true
	if b.TravelsWell != nil {
		tw = *b.TravelsWell
	}
	if b.Available != nil {
		avail = *b.Available
	}
	if b.CategoryID != nil {
		var n int
		_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM menu_categories WHERE id=$1 AND merchant_id=$2`,
			*b.CategoryID, mid).Scan(&n)
		if n == 0 {
			problem(w, 400, "Validation failed", "category not found at this store")
			return
		}
	}
	nameB, _ := json.Marshal(b.Name)
	descB, _ := json.Marshal(b.Description)
	var cat any
	if b.CategoryID != nil {
		cat = *b.CategoryID
	}
	var price int64
	if b.PriceMinor != nil {
		price = *b.PriceMinor
	}
	var id string
	if err := s.db.QueryRow(r.Context(), `INSERT INTO menu_items(merchant_id,category_id,name,description,price_minor,
		size_class,spill_risk,travels_well,photo_url,available) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
		mid, cat, nameB, descB, price, b.SizeClass, b.SpillRisk, tw, b.PhotoURL, avail).Scan(&id); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{"id": id})
}

func (s *Server) updateMenuItem(w http.ResponseWriter, r *http.Request) {
	mid := s.ownMerchantID(w, r)
	if mid == "" {
		return
	}
	var b menuItemBody
	if !decode(w, r, &b) {
		return
	}
	id := r.PathValue("id")
	var n int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM menu_items WHERE id=$1 AND merchant_id=$2`, id, mid).Scan(&n); err != nil || n == 0 {
		problem(w, 404, "Not found", "menu item not found")
		return
	}
	if b.Name != nil {
		if !validLocaleMap(b.Name) {
			problem(w, 400, "Validation failed", "item name cannot be emptied")
			return
		}
		nameB, _ := json.Marshal(b.Name)
		_, _ = s.db.Exec(r.Context(), `UPDATE menu_items SET name=$3 WHERE id=$1 AND merchant_id=$2`, id, mid, nameB)
	}
	if b.Description != nil {
		descB, _ := json.Marshal(b.Description)
		_, _ = s.db.Exec(r.Context(), `UPDATE menu_items SET description=$3 WHERE id=$1 AND merchant_id=$2`, id, mid, descB)
	}
	if b.CategoryID != nil {
		if *b.CategoryID == "" {
			_, _ = s.db.Exec(r.Context(), `UPDATE menu_items SET category_id=NULL WHERE id=$1 AND merchant_id=$2`, id, mid)
		} else {
			var cn int
			_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM menu_categories WHERE id=$1 AND merchant_id=$2`,
				*b.CategoryID, mid).Scan(&cn)
			if cn == 0 {
				problem(w, 400, "Validation failed", "category not found at this store")
				return
			}
			_, _ = s.db.Exec(r.Context(), `UPDATE menu_items SET category_id=$3 WHERE id=$1 AND merchant_id=$2`, id, mid, *b.CategoryID)
		}
	}
	// price_minor is meaningful at zero (free item), so the pointer marks presence.
	if b.PriceMinor != nil {
		if *b.PriceMinor < 0 {
			problem(w, 400, "Validation failed", "price_minor cannot be negative")
			return
		}
		_, _ = s.db.Exec(r.Context(), `UPDATE menu_items SET price_minor=$3 WHERE id=$1 AND merchant_id=$2`, id, mid, *b.PriceMinor)
	}
	if b.SizeClass != "" {
		if !validSize(b.SizeClass) {
			problem(w, 400, "Validation failed", "size_class must be S, M or L")
			return
		}
		_, _ = s.db.Exec(r.Context(), `UPDATE menu_items SET size_class=$3 WHERE id=$1 AND merchant_id=$2`, id, mid, b.SizeClass)
	}
	if b.SpillRisk != "" {
		if !validSpill(b.SpillRisk) {
			problem(w, 400, "Validation failed", "spill_risk must be low, medium or high")
			return
		}
		_, _ = s.db.Exec(r.Context(), `UPDATE menu_items SET spill_risk=$3 WHERE id=$1 AND merchant_id=$2`, id, mid, b.SpillRisk)
	}
	if b.TravelsWell != nil {
		_, _ = s.db.Exec(r.Context(), `UPDATE menu_items SET travels_well=$3 WHERE id=$1 AND merchant_id=$2`, id, mid, *b.TravelsWell)
	}
	if b.Available != nil {
		_, _ = s.db.Exec(r.Context(), `UPDATE menu_items SET available=$3 WHERE id=$1 AND merchant_id=$2`, id, mid, *b.Available)
	}
	if b.PhotoURL != "" {
		_, _ = s.db.Exec(r.Context(), `UPDATE menu_items SET photo_url=$3 WHERE id=$1 AND merchant_id=$2`, id, mid, b.PhotoURL)
	}
	writeJSON(w, 200, map[string]any{"updated": true})
}

func (s *Server) deleteMenuItem(w http.ResponseWriter, r *http.Request) {
	mid := s.ownMerchantID(w, r)
	if mid == "" {
		return
	}
	_, _ = s.db.Exec(r.Context(), `DELETE FROM menu_items WHERE id=$1 AND merchant_id=$2`, r.PathValue("id"), mid)
	w.WriteHeader(204)
}
