package app

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// Argon2id round-trip: the happy path every signup/login takes.
func TestHashPWRoundTrip(t *testing.T) {
	h, err := hashPW("trackfud123")
	if err != nil {
		t.Fatalf("hashPW: %v", err)
	}
	if !strings.HasPrefix(h, "$argon2id$") {
		t.Fatalf("hash shape = %q, want $argon2id$ prefix", h)
	}
	if strings.Contains(h, "trackfud123") {
		t.Fatalf("hash leaks the plaintext password")
	}
	if !verifyPW(h, "trackfud123") {
		t.Fatalf("correct password did not verify")
	}
	if verifyPW(h, "trackfud124") {
		t.Fatalf("wrong password verified")
	}
	// Random salt: two hashes of the same password differ.
	h2, err := hashPW("trackfud123")
	if err != nil {
		t.Fatalf("hashPW: %v", err)
	}
	if h == h2 {
		t.Fatalf("deterministic hash — salt is not random")
	}
	if !needsRehash("$2a$10$legacy") {
		t.Fatalf("legacy bcrypt hash must need rehash")
	}
	if needsRehash(h) {
		t.Fatalf("argon2id hash must not need rehash")
	}
}

// Legacy bcrypt rows (seeded before the hardening) keep working until login
// re-hashes them — a deploy must never lock users out.
func TestVerifyPWLegacyBcrypt(t *testing.T) {
	legacy, err := bcrypt.GenerateFromPassword([]byte("OldPass123!"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	if !verifyPW(string(legacy), "OldPass123!") {
		t.Fatalf("legacy bcrypt password did not verify")
	}
	if verifyPW(string(legacy), "OldPass124!") {
		t.Fatalf("wrong password verified against legacy hash")
	}
}

// Guard rails: short/empty/oversize inputs never hash or verify.
func TestPasswordLimits(t *testing.T) {
	if _, err := hashPW("short"); err == nil {
		t.Fatalf("short password hashed without error")
	}
	if _, err := hashPW(strings.Repeat("x", pwMaxLen+1)); err == nil {
		t.Fatalf("oversize password hashed without error")
	}
	h, err := hashPW("trackfud123")
	if err != nil {
		t.Fatalf("hashPW: %v", err)
	}
	if verifyPW(h, "") {
		t.Fatalf("empty password verified")
	}
	if verifyPW("not-a-hash", "trackfud123") {
		t.Fatalf("garbage hash verified")
	}
	if verifyPW("$argon2id$v=19$m=1,t=1,p=1$xx$yy", "trackfud123") {
		t.Fatalf("malformed argon2id hash verified")
	}
}
