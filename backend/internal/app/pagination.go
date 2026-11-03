package app

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Scroll-pagination defaults shared by every GET list endpoint.
//
// Infinite scroll everywhere uses page=1 + per_page=10; clients append the
// next page when the sentinel row intersects. `page` is 1-indexed so page 1
// is the newest rows.
const (
	defaultPage    = 1
	defaultPerPage = 10
	maxPerPage     = 100
	// maxSearchLen caps ?q= so a hostile client cannot force a huge
	// pathological LIKE pattern; longer input is a 400.
	maxSearchLen = 64
)

// pageParams is a parsed + clamped scroll window over a newest-first list.
type pageParams struct {
	page    int
	perPage int
	limit   int
	offset  int
}

// parsePage clamps a ?page= value to >= 1 (default 1). Garbage means 1, never
// a 400: a bad page is not worth failing a scroll refill over.
func parsePage(v string) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 1 {
		return defaultPage
	}
	return n
}

// parsePerPage reads ?per_page= (default 10, clamped 1..100). The legacy
// ?limit= alias is honoured only when ?per_page= is absent, so old callers
// keep working while new scroll clients send per_page.
func parsePerPage(vals url.Values) int {
	if raw := strings.TrimSpace(vals.Get("per_page")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return defaultPerPage
		}
		if n > maxPerPage {
			return maxPerPage
		}
		return n
	}
	if raw := strings.TrimSpace(vals.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return defaultPerPage
		}
		if n > maxPerPage {
			return maxPerPage
		}
		return n
	}
	return defaultPerPage
}

// parsePagination parses the shared scroll window (?page=, ?per_page= with a
// legacy ?limit= alias) from a list query.
func parsePagination(vals url.Values) pageParams {
	page := parsePage(vals.Get("page"))
	perPage := parsePerPage(vals)
	return pageParams{page: page, perPage: perPage, limit: perPage, offset: (page - 1) * perPage}
}

// hasMore reports whether another page follows the current one.
func hasMore(page, perPage, total int) bool {
	return page*perPage < total
}

// writePaginatedList writes the equalized scroll envelope every list endpoint
// serves: the rows under their usual key plus page/per_page/total/has_more.
// Old clients that only read the row key keep working; scroll clients drive
// the sentinel off has_more.
func writePaginatedList(w http.ResponseWriter, key string, items []map[string]any, page, perPage, total int) {
	if items == nil {
		items = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{
		key:        items,
		"page":     page,
		"per_page": perPage,
		"total":    total,
		"has_more": hasMore(page, perPage, total),
	})
}

// parseSearch validates an optional ?q= free-text filter (order code,
// merchant name, customer email depending on the endpoint). Empty means "no
// filter". It returns the LIKE-escaped, %-wrapped pattern plus false when no
// filter applies; overlong input is an error message for a 400.
func parseSearch(v string) (pattern string, filtered bool, errMsg string) {
	q := strings.TrimSpace(v)
	if q == "" {
		return "", false, ""
	}
	if len([]rune(q)) > maxSearchLen {
		return "", false, "q must be at most 64 characters"
	}
	return "%" + likeEscape(q) + "%", true, ""
}

// likeEscape escapes the LIKE metacharacters so ?q= matches literally; the
// queries pair it with ESCAPE '\'.
func likeEscape(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

// ilikeAny matches one parseSearch pattern (bound once at placeholder ph)
// against several columns: "(c1 ILIKE $n ESCAPE '\' OR c2 ILIKE $n ESCAPE '\')".
// Keeping the ESCAPE literal in one place stops hand-written quoting slips.
func ilikeAny(ph string, cols ...string) string {
	parts := make([]string, len(cols))
	for i, c := range cols {
		parts[i] = c + ` ILIKE ` + ph + ` ESCAPE '\'`
	}
	return `(` + strings.Join(parts, ` OR `) + `)`
}
