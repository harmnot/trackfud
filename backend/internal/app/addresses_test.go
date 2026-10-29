package app

import (
	"testing"
	"time"
)

func TestAddressViewTimesAreRFC3339UTC(t *testing.T) {
	wib := time.FixedZone("WIB", 7*3600)
	created := time.Date(2026, 10, 28, 15, 4, 5, 0, wib)
	updated := time.Date(2026, 10, 28, 15, 5, 6, 0, time.UTC)
	v := addressView("id-1", "Home", "Jl. Sudirman", -6.2, 106.8, "gate", true, created, updated)
	if v["created_at"] != "2026-10-28T08:04:05Z" {
		t.Errorf("created_at = %v, want UTC RFC3339", v["created_at"])
	}
	if v["updated_at"] != "2026-10-28T15:05:06Z" {
		t.Errorf("updated_at = %v, want UTC RFC3339", v["updated_at"])
	}
	for _, k := range []string{"id", "label", "address", "lat", "lng", "note", "is_default"} {
		if _, ok := v[k]; !ok {
			t.Errorf("missing key %q", k)
		}
	}
}

func TestValidateAddressBody(t *testing.T) {
	ok := validateAddressBody("Home", -6.2, 106.8, "gate", "Jl. Sudirman")
	if ok != "" {
		t.Fatalf("valid address rejected: %s", ok)
	}
	cases := []struct {
		name       string
		label      string
		lat, lng   float64
		note, addr string
	}{
		{"empty label", "   ", -6.2, 106.8, "", ""},
		{"zero pin", "Home", 0, 0, "", ""},
		{"lat out of range", "Home", -91, 106.8, "", ""},
		{"lng out of range", "Home", -6.2, 181, "", ""},
	}
	for _, tc := range cases {
		if msg := validateAddressBody(tc.label, tc.lat, tc.lng, tc.note, tc.addr); msg == "" {
			t.Errorf("%s: expected a validation message", tc.name)
		}
	}
	long := make([]byte, 501)
	for i := range long {
		long[i] = 'a'
	}
	if msg := validateAddressBody("Home", -6.2, 106.8, string(long), ""); msg == "" {
		t.Error("overlong note: expected a validation message")
	}
}
