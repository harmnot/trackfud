package app

import "testing"

// The memberships response must carry the exact StaffMembership shape from
// backend/api/openapi.yaml (merchant_id, merchant_name, can_deliver,
// on_shift, status) so the Stride & Earn staff mode can enter with a real
// merchant instead of an invite code.
func TestStaffMembershipViewShape(t *testing.T) {
	m := staffMembershipView("11111111-1111-1111-1111-111111111111", "Demo Restaurant", true, false, "invited")
	for _, k := range []string{"merchant_id", "merchant_name", "can_deliver", "on_shift", "status"} {
		if _, ok := m[k]; !ok {
			t.Fatalf("membership view missing key %q", k)
		}
	}
	if m["merchant_name"] != "Demo Restaurant" {
		t.Fatalf("merchant_name not carried through: %v", m["merchant_name"])
	}
	if m["can_deliver"] != true || m["on_shift"] != false {
		t.Fatalf("flags not carried through: %v", m)
	}
}
