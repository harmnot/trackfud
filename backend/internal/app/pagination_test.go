package app

import (
	"net/url"
	"strings"
	"testing"
)

func vals(q string) url.Values {
	v, err := url.ParseQuery(q)
	if err != nil {
		return url.Values{}
	}
	return v
}

func TestParsePage(t *testing.T) {
	cases := map[string]int{
		"":    1,
		"1":   1,
		"3":   3,
		"0":   1,
		"-2":  1,
		"abc": 1,
		" 2 ": 2,
	}
	for in, want := range cases {
		if got := parsePage(in); got != want {
			t.Fatalf("parsePage(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestParsePerPage(t *testing.T) {
	// Default 10 when absent or garbage; clamp 1..100; per_page wins over
	// the legacy limit alias.
	if got := parsePerPage(vals("")); got != 10 {
		t.Fatalf("default per_page = %d, want 10", got)
	}
	if got := parsePerPage(vals("per_page=25")); got != 25 {
		t.Fatalf("per_page=25 = %d, want 25", got)
	}
	if got := parsePerPage(vals("per_page=500")); got != 100 {
		t.Fatalf("per_page=500 = %d, want 100", got)
	}
	if got := parsePerPage(vals("per_page=0")); got != 10 {
		t.Fatalf("per_page=0 = %d, want 10", got)
	}
	if got := parsePerPage(vals("per_page=abc")); got != 10 {
		t.Fatalf("per_page=abc = %d, want 10", got)
	}
	if got := parsePerPage(vals("limit=50")); got != 50 {
		t.Fatalf("legacy limit=50 = %d, want 50", got)
	}
	if got := parsePerPage(vals("per_page=10&limit=50")); got != 10 {
		t.Fatalf("per_page must win over limit, got %d", got)
	}
}

func TestParsePaginationOffset(t *testing.T) {
	pg := parsePagination(vals("page=3&per_page=10"))
	if pg.limit != 10 || pg.offset != 20 || pg.page != 3 || pg.perPage != 10 {
		t.Fatalf("page=3&per_page=10 -> %+v, want page 3 limit 10 offset 20", pg)
	}
	pg = parsePagination(vals(""))
	if pg.page != 1 || pg.perPage != 10 || pg.offset != 0 {
		t.Fatalf("defaults -> %+v, want page 1 per_page 10 offset 0", pg)
	}
}

func TestHasMore(t *testing.T) {
	if !hasMore(1, 10, 25) {
		t.Fatal("page 1 of 25 at 10/page must have more")
	}
	if hasMore(3, 10, 25) {
		t.Fatal("page 3 of 25 at 10/page must not have more")
	}
	if hasMore(1, 10, 10) {
		t.Fatal("exact full page must not have more")
	}
	if hasMore(1, 10, 0) {
		t.Fatal("empty list must not have more")
	}
}

func TestParseSearch(t *testing.T) {
	pat, filtered, errMsg := parseSearch("")
	if filtered || errMsg != "" || pat != "" {
		t.Fatalf("empty q must mean no filter, got %q %v %q", pat, filtered, errMsg)
	}
	pat, filtered, errMsg = parseSearch("  TB-12 ")
	if !filtered || errMsg != "" || pat != "%TB-12%" {
		t.Fatalf("q=TB-12 -> %q %v %q", pat, filtered, errMsg)
	}
	// LIKE metacharacters match literally, never as wildcards.
	pat, filtered, errMsg = parseSearch("100%_x\\y")
	if !filtered || errMsg != "" {
		t.Fatalf("metachar q must still filter, got %q %v %q", pat, filtered, errMsg)
	}
	if pat != `%100\%\_x\\y%` {
		t.Fatalf("metachar q escaped to %q", pat)
	}
	long := ""
	for i := 0; i < 65; i++ {
		long += "a"
	}
	if _, _, errMsg := parseSearch(long); errMsg == "" {
		t.Fatal("65-char q must be rejected")
	}
}

func TestILikeAny(t *testing.T) {
	got := ilikeAny("$2", "o.code", "u.email", "m.name")
	want := `(o.code ILIKE $2 ESCAPE '\' OR u.email ILIKE $2 ESCAPE '\' OR m.name ILIKE $2 ESCAPE '\')`
	if got != want {
		t.Fatalf("ilikeAny = %s\nwant      %s", got, want)
	}
	// Every ESCAPE literal is exactly '\' (one backslash): quotes stay balanced.
	if n := strings.Count(got, "'"); n%2 != 0 {
		t.Fatalf("unbalanced quotes (%d) in %s", n, got)
	}
	if got := ilikeAny("$1", "m.name"); got != `(m.name ILIKE $1 ESCAPE '\')` {
		t.Fatalf("single column: %s", got)
	}
}
