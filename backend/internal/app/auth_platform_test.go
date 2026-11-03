package app

import "testing"

// Platform isolation: each role signs in only on its own platform.
// This is the regression test for cross-platform logins (admin on customer,
// customer on courier, and so on must be forbidden).
func TestPlatformAccess(t *testing.T) {
	cases := []struct {
		name      string
		roles     []string
		app       string
		allowed   bool
		needStaff bool
	}{
		{"admin on cms", []string{"admin"}, "cms", true, false},
		{"admin on customer forbidden", []string{"admin"}, "customer", false, false},
		{"admin on courier forbidden", []string{"admin"}, "courier", false, false},
		{"admin on merchant forbidden", []string{"admin"}, "merchant", false, false},
		{"admin with customer role still cms-only", []string{"admin", "customer"}, "customer", false, false},
		{"customer on customer", []string{"customer"}, "customer", true, false},
		{"customer on courier needs staff check", []string{"customer"}, "courier", false, true},
		{"customer on merchant forbidden", []string{"customer"}, "merchant", false, false},
		{"customer on cms forbidden", []string{"customer"}, "cms", false, false},
		{"courier on courier", []string{"courier"}, "courier", true, false},
		{"courier on customer forbidden", []string{"courier"}, "customer", false, false},
		{"courier on merchant forbidden", []string{"courier"}, "merchant", false, false},
		{"courier on cms forbidden", []string{"courier"}, "cms", false, false},
		{"merchant on merchant", []string{"merchant"}, "merchant", true, false},
		{"merchant on customer forbidden", []string{"merchant"}, "customer", false, false},
		{"merchant on courier needs staff check", []string{"merchant"}, "courier", false, true},
		{"merchant on cms forbidden", []string{"merchant"}, "cms", false, false},
		{"multi-role customer+courier on customer", []string{"customer", "courier"}, "customer", true, false},
		{"multi-role customer+courier on courier", []string{"customer", "courier"}, "courier", true, false},
		{"empty roles forbidden everywhere", nil, "customer", false, false},
		{"unknown app forbidden", []string{"customer"}, "spaceship", false, false},
	}
	for _, tc := range cases {
		got, needStaff := platformAccess(tc.roles, tc.app)
		if got != tc.allowed || needStaff != tc.needStaff {
			t.Fatalf("%s: platformAccess(%v,%q) = %v,%v; want %v,%v",
				tc.name, tc.roles, tc.app, got, needStaff, tc.allowed, tc.needStaff)
		}
	}
}

func TestNormalizeApp(t *testing.T) {
	for in, want := range map[string]string{
		"cms": "cms", "admin": "cms", "back-office": "cms",
		"customer": "customer", "courier": "courier",
		"runner-biker": "courier", "merchant": "merchant",
		"  Courier  ": "courier",
	} {
		if got := normalizeApp(in); got != want {
			t.Fatalf("normalizeApp(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestAllowedRolesForApp(t *testing.T) {
	for app, want := range map[string]string{
		"customer": "customer", "courier": "courier",
		"merchant": "merchant", "cms": "admin",
	} {
		got := allowedRolesForApp(app)
		if len(got) != 1 || got[0] != want {
			t.Fatalf("allowedRolesForApp(%q) = %v, want [%s]", app, got, want)
		}
	}
	if got := allowedRolesForApp("spaceship"); len(got) != 0 {
		t.Fatalf("unknown app must allow no roles, got %v", got)
	}
}
