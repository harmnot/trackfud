package config

import (
	"crypto/elliptic"
	"encoding/base64"
	"testing"
)

// testVAPIDPair builds a deterministic, mathematically-valid P-256 pair
// (fixed private scalar 1..32, valid since it is far below the curve order).
// No secret is committed: the scalar is a test vector, never a live key.
func testVAPIDPair(t *testing.T) (pub, priv string) {
	t.Helper()
	scalar := make([]byte, 32)
	for i := range scalar {
		scalar[i] = byte(i + 1)
	}
	x, y := elliptic.P256().ScalarBaseMult(scalar)
	return base64.RawURLEncoding.EncodeToString(elliptic.Marshal(elliptic.P256(), x, y)),
		base64.RawURLEncoding.EncodeToString(scalar)
}

func TestCheckVAPIDPair_EmptyOK(t *testing.T) {
	if err := checkVAPIDPair("", ""); err != nil {
		t.Fatalf("empty pair (DB dev fallback) must pass: %v", err)
	}
}

func TestCheckVAPIDPair_HalfPair(t *testing.T) {
	pub, priv := testVAPIDPair(t)
	if err := checkVAPIDPair(pub, ""); err == nil {
		t.Fatal("public-only pair must fail")
	}
	if err := checkVAPIDPair("", priv); err == nil {
		t.Fatal("private-only pair must fail")
	}
}

func TestCheckVAPIDPair_Random(t *testing.T) {
	// The exact failure that motivated this check: hand-typed text.
	if err := checkVAPIDPair("random-public", "random-private"); err == nil {
		t.Fatal("hand-typed keys must fail")
	}
	if err := checkVAPIDPair("!!!", "???"); err == nil {
		t.Fatal("non-base64url keys must fail")
	}
}

func TestCheckVAPIDPair_Mismatched(t *testing.T) {
	pubA, _ := testVAPIDPair(t)
	scalar := make([]byte, 32)
	for i := range scalar {
		scalar[i] = byte(32 - i)
	}
	privB := base64.RawURLEncoding.EncodeToString(scalar)
	if err := checkVAPIDPair(pubA, privB); err == nil {
		t.Fatal("keys from two different generations must fail")
	}
}

func TestCheckVAPIDPair_Valid(t *testing.T) {
	pub, priv := testVAPIDPair(t)
	if len(priv) != 43 || len(pub) != 87 {
		t.Fatalf("test vector shape changed: priv=%d pub=%d", len(priv), len(pub))
	}
	if err := checkVAPIDPair(pub, priv); err != nil {
		t.Fatalf("matched pair must pass: %v", err)
	}
}

func TestLoad_RejectsRandomVAPID(t *testing.T) {
	t.Setenv("TF_VAPID_PUBLIC_KEY", "random-public")
	t.Setenv("TF_VAPID_PRIVATE_KEY", "random-private")
	if _, err := Load(); err == nil {
		t.Fatal("Load with hand-typed VAPID keys must fail fast")
	}
}

func TestLoad_AcceptsValidVAPID(t *testing.T) {
	pub, priv := testVAPIDPair(t)
	t.Setenv("TF_VAPID_PUBLIC_KEY", pub)
	t.Setenv("TF_VAPID_PRIVATE_KEY", priv)
	c, err := Load()
	if err != nil {
		t.Fatalf("Load with a matched pair must succeed: %v", err)
	}
	if c.VAPIDPublicKey != pub || c.VAPIDPrivateKey != priv {
		t.Fatal("valid VAPID pair not loaded")
	}
}
