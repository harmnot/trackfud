package app

import (
	"strings"
	"testing"
)

func TestCourierKindNamesStaffAsStaff(t *testing.T) {
	cases := []struct{ deliveryType, mode, want string }{
		{"staff", "runner", "staff"}, // kasir accounts deliver on foot
		{"workout", "runner", "runner"},
		{"workout", "biker", "biker"},
		{"workout", "", "staff"},
	}
	for _, c := range cases {
		if got := courierKind(c.deliveryType, c.mode); got != c.want {
			t.Errorf("courierKind(%q,%q) = %q, want %q", c.deliveryType, c.mode, got, c.want)
		}
	}
}

func TestAssignedPushCopy(t *testing.T) {
	title, body := assignedPushCopy("staff")
	if strings.Contains(strings.ToLower(title+body), "runner") {
		t.Errorf("staff push mentions a runner: %q / %q", title, body)
	}
	if title, _ := assignedPushCopy("biker"); title != "Biker assigned" {
		t.Errorf("biker title = %q", title)
	}
	if title, _ := assignedPushCopy("runner"); title != "Runner assigned" {
		t.Errorf("runner title = %q", title)
	}
}

func TestDeliveredCopyFollowsDeliveryKind(t *testing.T) {
	_, body, email := deliveredCopy("staff", "TF-CZPNAK", 1800, 900)
	if strings.Contains(strings.ToLower(body+email), "workout") || strings.Contains(body+email, "km") {
		t.Errorf("staff delivery copy claims a workout: %q / %q", body, email)
	}
	_, body, email = deliveredCopy("workout", "TF-CZPNAK", 1800, 900)
	if body != "You powered 1.8 km of your courier's workout." || email != "Order TF-CZPNAK delivered. You powered 1.8 km and 15 active minutes." {
		t.Errorf("workout copy = %q / %q", body, email)
	}
}
