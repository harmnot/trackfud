package app

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

// Argon2id parameters for password hashing. 64 MiB / 1 pass / 4 lanes costs
// roughly 50–100 ms on a small VPS — slow enough to hurt offline guessing,
// fast enough to keep login feeling instant.
const (
	pwTime    uint32 = 1
	pwMemory  uint32 = 64 * 1024
	pwThreads uint8  = 4
	pwKeyLen  uint32 = 32
	pwSaltLen        = 16
	pwMaxLen         = 256
)

// hashPW hashes a password with Argon2id, encoded as
// $argon2id$v=19$m=65536,t=1,p=4$<salt-b64>$<key-b64>.
func hashPW(p string) (string, error) {
	if len(p) < 8 {
		return "", errors.New("password too short")
	}
	if len(p) > pwMaxLen {
		return "", errors.New("password too long")
	}
	salt := make([]byte, pwSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(p), salt, pwTime, pwMemory, pwThreads, pwKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, pwMemory, pwTime, pwThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

// verifyPW checks a password against a stored hash. Argon2id is primary;
// legacy bcrypt rows (seeded or registered before the hardening) still verify
// so a deploy never locks users out — login re-hashes them (see login).
func verifyPW(hash, password string) bool {
	if strings.HasPrefix(hash, "$argon2id$") {
		return verifyArgon2id(hash, password)
	}
	if len(password) == 0 || len(password) > pwMaxLen {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// needsRehash reports whether a stored hash predates Argon2id.
func needsRehash(hash string) bool {
	return !strings.HasPrefix(hash, "$argon2id$")
}

func verifyArgon2id(hash, password string) bool {
	parts := strings.Split(hash, "$")
	// ["", "argon2id", "v=19", "m=...,t=...,p=...", salt, key]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var mem uint32
	var time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &mem, &time, &threads); err != nil {
		return false
	}
	if mem == 0 || mem > 1<<20 || time == 0 || time > 10 || threads == 0 || threads > 16 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) == 0 || len(salt) > 64 {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 || len(want) > 128 {
		return false
	}
	if len(password) == 0 || len(password) > pwMaxLen {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, time, mem, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}
