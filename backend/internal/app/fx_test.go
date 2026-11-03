package app

import "testing"

// Paddle cannot settle every country currency: IDR converts to USD.
func TestPaddleSupported(t *testing.T) {
	if !PaddleSupported("USD") || !PaddleSupported("GBP") {
		t.Fatal("USD/GBP must be Paddle-supported")
	}
	if PaddleSupported("IDR") {
		t.Fatal("IDR must NOT be Paddle-supported (converts to USD)")
	}
	if !PaddleSupported("usd") {
		t.Fatal("support check must be case-insensitive")
	}
}

func TestCountryCurrency(t *testing.T) {
	if got := countryCurrency("ID"); got != "IDR" {
		t.Fatalf("ID -> IDR, got %s", got)
	}
	if got := countryCurrency("GB"); got != "GBP" {
		t.Fatalf("GB -> GBP, got %s", got)
	}
	if got := countryCurrency(""); got != "USD" {
		t.Fatalf("empty -> USD, got %s", got)
	}
	if got := countryCurrency("XX"); got != "USD" {
		t.Fatalf("unknown -> USD, got %s", got)
	}
}
