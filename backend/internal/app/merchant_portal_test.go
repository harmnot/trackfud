package app

import (
	"testing"
	"time"
)

// Weeks clamp to 1..12 (default 8) so the earnings endpoint never scans
// unbounded history from a query param.
func TestParseWeeks(t *testing.T) {
	if parseWeeks("") != 8 {
		t.Fatalf("empty weeks should default to 8, got %d", parseWeeks(""))
	}
	if parseWeeks("4") != 4 {
		t.Fatalf("weeks=4 should stay 4, got %d", parseWeeks("4"))
	}
	if parseWeeks("0") != 8 {
		t.Fatalf("weeks=0 should default to 8, got %d", parseWeeks("0"))
	}
	if parseWeeks("99") != 12 {
		t.Fatalf("weeks=99 should clamp to 12, got %d", parseWeeks("99"))
	}
	if parseWeeks("bad") != 8 {
		t.Fatalf("non-numeric weeks should default to 8, got %d", parseWeeks("bad"))
	}
}

// Monday buckets must be stable in UTC so weekly statements agree across
// merchant timezones (same rule as the PWA's old local summary).
func TestMondayOf(t *testing.T) {
	// Wednesday 2026-10-28 -> Monday 2026-10-26.
	mid := time.Date(2026, 10, 28, 15, 4, 0, 0, time.UTC)
	if got := mondayOf(mid); got != "2026-10-26" {
		t.Fatalf("mondayOf Wednesday should be 2026-10-26, got %s", got)
	}
	// Monday itself stays on the same day.
	mon := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	if got := mondayOf(mon); got != "2026-10-26" {
		t.Fatalf("mondayOf Monday should be itself, got %s", got)
	}
	// Sunday rolls back to the Monday that started its week.
	sun := time.Date(2026, 11, 1, 23, 59, 0, 0, time.UTC)
	if got := mondayOf(sun); got != "2026-10-26" {
		t.Fatalf("mondayOf Sunday should be 2026-10-26, got %s", got)
	}
}

// Agreement status view must expose the signed flag + ISO time the PWA
// disables on, and never leak anything besides version/signer/time/status.
func TestAgreementStatusView(t *testing.T) {
	at := time.Date(2026, 10, 29, 10, 30, 0, 0, time.UTC)
	v := agreementStatusView("v1", "Budi Santoso", true, &at, "pending")
	if v["signed"] != true {
		t.Fatalf("signed agreement should report signed=true: %v", v)
	}
	if v["signed_at"] != "2026-10-29T10:30:00Z" {
		t.Fatalf("signed_at should be RFC3339 UTC, got %v", v["signed_at"])
	}
	if v["signer_name"] != "Budi Santoso" {
		t.Fatalf("signer_name not carried through: %v", v)
	}
	// Unsigned (never signed) renders with empty time and signed=false.
	v = agreementStatusView("", "", false, nil, "draft")
	if v["signed"] != false {
		t.Fatalf("unsigned agreement should report signed=false: %v", v)
	}
	if v["signed_at"] != "" {
		t.Fatalf("unsigned agreement should have empty signed_at: %v", v)
	}
}
