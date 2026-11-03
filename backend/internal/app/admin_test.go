package app

import (
	"strings"
	"testing"
)

// Realistic fixtures mirroring the CMS review queue (Jakarta + London).
func TestParseReviewStatus(t *testing.T) {
	for in, want := range map[string]string{
		"":          "",
		"pending":   "pending",
		"approved":  "approved",
		"rejected":  "rejected",
		"frozen":    "frozen",
		"banned":    "banned",
		" Pending ": "pending", // trimmed + lowercased
		"APPROVED":  "approved",
	} {
		got, ok := parseReviewStatus(in)
		if !ok || got != want {
			t.Fatalf("parseReviewStatus(%q) = %q,%v, want %q,true", in, got, ok, want)
		}
	}
	// Injection-flavoured and unknown values must never reach SQL.
	for _, bad := range []string{
		"pending' OR '1'='1", "approved; DROP TABLE merchants", "draft",
		"testing", "live",
	} {
		if _, ok := parseReviewStatus(bad); ok {
			t.Fatalf("parseReviewStatus(%q) must be rejected", bad)
		}
	}
}

func TestParseAdminLimit(t *testing.T) {
	if got := parseAdminLimit(""); got != 50 {
		t.Fatalf("empty limit must default to 50, got %d", got)
	}
	if got := parseAdminLimit("20"); got != 20 {
		t.Fatalf("limit 20 must pass through, got %d", got)
	}
	if got := parseAdminLimit("500"); got != 100 {
		t.Fatalf("limit must clamp to 100, got %d", got)
	}
	for _, bad := range []string{"0", "-5", "abc", "10; DROP", ""} {
		if got := parseAdminLimit(bad); got != 50 {
			t.Fatalf("parseAdminLimit(%q) must default to 50, got %d", bad, got)
		}
	}
}

func TestParseDecisionBody(t *testing.T) {
	// Empty POST approves (admin one-click approve).
	if reason, note, msg := parseDecisionBody(nil, true); msg != "" || reason != "" || note != "" {
		t.Fatalf("empty approve body must pass, got %q %q %q", reason, note, msg)
	}
	// Approve with a reviewer note.
	if reason, note, msg := parseDecisionBody(
		[]byte(`{"note":"Siti's warung photos check out, agreement v2026-10-27.v1 signed"}`), true); msg != "" || note == "" {
		t.Fatalf("approve note must pass, got %q %q %q", reason, note, msg)
	}
	// Reject without a reason is a 400.
	if _, _, msg := parseDecisionBody([]byte(`{}`), false); msg == "" {
		t.Fatal("reject without reason must fail")
	}
	if _, _, msg := parseDecisionBody(nil, false); msg == "" {
		t.Fatal("empty reject body must fail")
	}
	if _, _, msg := parseDecisionBody([]byte(`{"reason":"   "}`), false); msg == "" {
		t.Fatal("blank reject reason must fail")
	}
	// Reject with a realistic reason passes, trimmed.
	reason, _, msg := parseDecisionBody(
		[]byte(`{"reason":"  ID selfie does not match the ID photo  "}`), false)
	if msg != "" || reason != "ID selfie does not match the ID photo" {
		t.Fatalf("reject reason must be trimmed, got %q %q", reason, msg)
	}
	// Malformed JSON is a 400.
	if _, _, msg := parseDecisionBody([]byte(`{not json`), true); msg == "" {
		t.Fatal("malformed JSON must fail")
	}
}

func TestCourierDecision(t *testing.T) {
	// Submitted states decide; approve from approved is idempotent.
	for _, st := range []string{"pending", "pending_review", "passed_test"} {
		if next, v := courierDecision(st, true); v != "ok" || next != "approved" {
			t.Fatalf("courierDecision(%q, approve) = %q/%q, want approved/ok", st, next, v)
		}
		if next, v := courierDecision(st, false); v != "ok" || next != "rejected" {
			t.Fatalf("courierDecision(%q, reject) = %q/%q, want rejected/ok", st, next, v)
		}
	}
	if next, v := courierDecision("approved", true); v != "same" || next != "approved" {
		t.Fatalf("approved+approve must be idempotent, got %q/%q", next, v)
	}
	// Mid-test, draft, decided and unknown states conflict for both verbs.
	for _, st := range []string{"draft", "testing", "rejected", "approved", "", "banned"} {
		if st == "approved" {
			continue // idempotent approve covered above; reject still conflicts
		}
		if _, v := courierDecision(st, true); v == "ok" || v == "same" {
			t.Fatalf("courierDecision(%q, approve) must conflict, got %q", st, v)
		}
		if _, v := courierDecision(st, false); v == "ok" {
			t.Fatalf("courierDecision(%q, reject) must conflict, got %q", st, v)
		}
	}
	if _, v := courierDecision("draft", false); !strings.Contains(v, "draft") {
		t.Fatalf("conflict must name the state, got %q", v)
	}
}

func TestMerchantDecision(t *testing.T) {
	next, v := merchantDecision("pending", true)
	if v != "ok" || next != "approved" {
		t.Fatalf("pending+approve = approved/ok, got %q/%q", next, v)
	}
	next, v = merchantDecision("pending", false)
	if v != "ok" || next != "rejected" {
		t.Fatalf("pending+reject = rejected/ok, got %q/%q", next, v)
	}
	// Idempotent re-approve.
	next, v = merchantDecision("approved", true)
	if v != "same" || next != "approved" {
		t.Fatalf("approved+approve must be idempotent, got %q/%q", next, v)
	}
	// Everything else conflicts.
	for _, st := range []string{"draft", "rejected", "approved", "suspended", ""} {
		if st == "approved" {
			continue // covered above for approve
		}
		if _, v := merchantDecision(st, true); v == "ok" || v == "same" {
			t.Fatalf("merchantDecision(%q, approve) must conflict, got %q", st, v)
		}
		if _, v := merchantDecision(st, false); v == "ok" {
			t.Fatalf("merchantDecision(%q, reject) must conflict, got %q", st, v)
		}
	}
	if _, v := merchantDecision("rejected", false); v == "ok" {
		t.Fatalf("rejected+reject must conflict, got %q", v)
	}
	// Conflict message names the state for the admin UI.
	if _, v := merchantDecision("draft", false); !strings.Contains(v, "draft") {
		t.Fatalf("conflict must name the state, got %q", v)
	}
}

func TestMerchantSanctionDecision(t *testing.T) {
	// Ban from any submitted state; unban restores the recorded one.
	for _, st := range []string{"pending", "approved", "rejected"} {
		if next, msg := merchantSanctionDecision(st, "ban", ""); msg != "" || next != "banned" {
			t.Fatalf("merchantSanctionDecision(%q, ban) = %q/%q, want banned/\"\"", st, next, msg)
		}
	}
	if next, msg := merchantSanctionDecision("banned", "unban", "approved"); msg != "" || next != "approved" {
		t.Fatalf("unban must restore approved, got %q/%q", next, msg)
	}
	if next, msg := merchantSanctionDecision("banned", "unban", "rejected"); msg != "" || next != "rejected" {
		t.Fatalf("unban must restore rejected, got %q/%q", next, msg)
	}
	// Already banned, drafts, and non-banned unbans conflict.
	for _, tc := range []struct{ current, kind, restore string }{
		{"banned", "ban", ""},
		{"draft", "ban", ""},
		{"", "ban", ""},
		{"approved", "unban", "approved"},
		{"banned", "unban", ""},
		{"banned", "unban", "banned"},
		{"pending", "freeze", ""},
		{"banned", "ban'; DROP TABLE merchants", ""},
	} {
		if _, msg := merchantSanctionDecision(tc.current, tc.kind, tc.restore); msg == "" {
			t.Fatalf("merchantSanctionDecision(%q, %q, %q) must conflict", tc.current, tc.kind, tc.restore)
		}
	}
	// Conflict message names the state for the admin UI.
	if _, msg := merchantSanctionDecision("banned", "ban", ""); !strings.Contains(msg, "banned") {
		t.Fatalf("conflict must name the state, got %q", msg)
	}
}

func TestSanctionReasonOK(t *testing.T) {
	// Freeze and ban always need an audit-logged reason.
	for _, kind := range []string{"freeze", "ban"} {
		if !sanctionReasonOK(kind, "fake GPS trace on fitness test") {
			t.Fatalf("sanctionReasonOK(%q, reason) must pass", kind)
		}
		if sanctionReasonOK(kind, "") {
			t.Fatalf("sanctionReasonOK(%q, empty) must fail", kind)
		}
		if sanctionReasonOK(kind, "   ") {
			t.Fatalf("sanctionReasonOK(%q, blank) must fail", kind)
		}
	}
	// Unfreeze lifts a sanction and may carry an empty reason — the CMS
	// SanctionBox sends none for restorative actions (REASON_OPTIONAL).
	if !sanctionReasonOK("unfreeze", "") {
		t.Fatal("sanctionReasonOK(unfreeze, empty) must pass")
	}
	if !sanctionReasonOK("unfreeze", "appeal upheld by review team") {
		t.Fatal("sanctionReasonOK(unfreeze, reason) must pass")
	}
}

func TestWorkSessionBlocked(t *testing.T) {
	// Frozen and banned couriers cannot go online (plan 8.4).
	for _, standing := range []string{"frozen", "banned"} {
		if !workSessionBlocked(standing) {
			t.Fatalf("workSessionBlocked(%q) must be true", standing)
		}
	}
	// Everyone else — approved couriers, applicants mid-review, and ordinary
	// free-tracking runners without a couriers row — may start sessions.
	for _, standing := range []string{"", "approved", "testing", "draft", "pending_review", "rejected"} {
		if workSessionBlocked(standing) {
			t.Fatalf("workSessionBlocked(%q) must be false", standing)
		}
	}
}
