package app

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"Trackfud/internal/ai"
)

// A8 dashboard + courier performance: the rates behind every §8.6 card.
// DB-backed rows (counts, sums, histories) are covered by route + smoke
// tests against seeded backends; these pin the pure policy that "no data"
// renders as null, never as a damning 0%.

func TestPerfRate(t *testing.T) {
	if got := perfRate(8, 10); got != 0.8 {
		t.Fatalf("perfRate(8,10) = %v, want 0.8", got)
	}
	if got := perfRate(0, 10); got != 0.0 {
		t.Fatalf("perfRate(0,10) = %v, want 0.0 (real zeroes stay zeroes)", got)
	}
	// Empty windows are null on the wire: a new courier must not read as
	// "0% acceptance".
	if got := perfRate(0, 0); got != nil {
		t.Fatalf("perfRate(0,0) = %v, want nil", got)
	}
	if got := perfRate(5, -3); got != nil {
		t.Fatalf("perfRate(5,-3) = %v, want nil", got)
	}
}

// Complaints count genuinely negative courier feedback only: 1–2 stars or a
// courier-blaming AI topic. Praise, neutral/legacy labels and kitchen
// topics on a good rating must not read as complaints.
func TestIsCourierComplaint(t *testing.T) {
	star := func(n int) *int { return &n }
	cases := []struct {
		stars  *int
		topics []string
		want   bool
	}{
		{star(5), []string{"praise"}, false},
		{star(5), []string{"delivery_speed"}, false}, // seeded legacy label
		{star(4), []string{"other"}, false},
		{star(3), nil, false},
		{star(5), []string{"cold_food", "wrong_item"}, false}, // kitchen, not courier
		{nil, nil, false},
		{star(2), nil, true},
		{star(1), []string{"praise"}, true},
		{star(3), []string{"late"}, true},
		{star(5), []string{"other", "spilled"}, true},
		{nil, []string{"rude"}, true},
	}
	for _, c := range cases {
		stars := "nil"
		if c.stars != nil {
			stars = strconv.Itoa(*c.stars)
		}
		if got := isCourierComplaint(c.stars, c.topics); got != c.want {
			t.Fatalf("isCourierComplaint(%s★, %v) = %v, want %v", stars, c.topics, got, c.want)
		}
	}
}

// The complaint topics must stay inside the labeler's vocabulary, or the
// rule silently never matches.
func TestCourierComplaintTopicsAreLabels(t *testing.T) {
	for topic := range courierComplaintTopics {
		raw := fmt.Sprintf(`{"topics":[%q],"abusive":false}`, topic)
		if _, err := ai.ParseFeedbackLabels(raw); err != nil {
			t.Fatalf("complaint topic %q is not an AI label: %v", topic, err)
		}
	}
}

// The WHO-week trend binds every placeholder, the courier first, and the
// window as an integer (pgx cannot encode a Go int into a $n::text operand).
func TestCourierWeeklyTrendQuery(t *testing.T) {
	const courier = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f"
	sql, args := courierWeeklyTrendQuery(courier)
	maxN := 0
	for _, m := range regexp.MustCompile(`\$(\d+)`).FindAllStringSubmatch(sql, -1) {
		if n, _ := strconv.Atoi(m[1]); n > maxN {
			maxN = n
		}
	}
	if maxN != len(args) {
		t.Fatalf("trend SQL uses $1..$%d but binds %d args", maxN, len(args))
	}
	if !strings.Contains(sql, "courier_id=$1") || args[0] != courier {
		t.Fatalf("trend must filter by the courier as $1, got %q with %v", sql, args[0])
	}
	if args[1] != 7*perfTrendWeeks || args[2] != perfTrendWeeks || strings.Contains(sql, "::text") {
		t.Fatalf("trend window must bind %d integer days / %d weeks, got %v", 7*perfTrendWeeks, perfTrendWeeks, args[1:])
	}
}

func TestPerfWindowDays(t *testing.T) {
	// §8.6 says "last 30 days" — the window constant is the contract.
	if perfWindowDays != 30 {
		t.Fatalf("perfWindowDays = %d, want 30", perfWindowDays)
	}
}
