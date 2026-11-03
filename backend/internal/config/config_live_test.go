package config

import (
	"testing"
)

// Live-key wiring: every TF_* credential lands in Config, R2 reports
// configured only when endpoint + creds + both buckets are present, and the
// Paddle webhook URL derives from the public base URL.
//
// The VAPID pair uses a deterministic test vector (see vapid_test.go), not
// placeholder text: Load() fail-fast validates any explicitly-set pair, so
// "pub"/"priv" dummies would (correctly) refuse to boot.
func TestLoad_LiveKeys(t *testing.T) {
	vapidPub, vapidPriv := testVAPIDPair(t)
	env := map[string]string{
		"TF_JWT_SECRET":          "0123456789abcdef0123456789abcdef",
		"TF_R2_ENDPOINT":         "https://abc.r2.cloudflarestorage.com",
		"TF_R2_ACCESS_KEY":       "ak",
		"TF_R2_SECRET_KEY":       "sk",
		"TF_R2_PUBLIC_BUCKET":    "tf-menus",
		"TF_R2_PRIVATE_BUCKET":   "tf-vault",
		"TF_R2_PUBLIC_URL":       "https://cdn.example.com",
		"TF_SMTP_HOST":           "smtp-relay.brevo.com",
		"TF_SMTP_PORT":           "587",
		"TF_SMTP_USER":           "brevo-user",
		"TF_SMTP_PASSWORD":       "brevo-pass",
		"TF_SMTP_FROM":           "noreply@example.com",
		"TF_VAPID_PUBLIC_KEY":    vapidPub,
		"TF_VAPID_PRIVATE_KEY":   vapidPriv,
		"TF_VAPID_SUBJECT":       "mailto:ops@example.com",
		"TF_PADDLE_API_KEY":      "paddle-key",
		"TF_PADDLE_ENV":          "sandbox",
		"TF_PADDLE_CLIENT_TOKEN": "ctoken",
		"TF_GOOGLE_MAPS_KEY":     "server-key",
		"TF_PUBLIC_BASE_URL":     "https://api.example.com",
		"TF_DEMO_MODE":           "false",
	}
	for k, v := range env {
		t.Setenv(k, v)
	}
	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !c.R2Configured() {
		t.Fatal("R2Configured must be true")
	}
	if got := c.R2BucketFor("private"); got != "tf-vault" {
		t.Fatalf("private bucket = %q", got)
	}
	if got := c.R2BucketFor("public"); got != "tf-menus" {
		t.Fatalf("public bucket = %q", got)
	}
	if c.SMTPUser != "brevo-user" || c.SMTPPassword != "brevo-pass" || c.SMTPFrom != "noreply@example.com" {
		t.Fatal("SMTP auth/From not loaded")
	}
	if c.VAPIDPublicKey != vapidPub || c.VAPIDPrivateKey != vapidPriv || c.VAPIDSubject != "mailto:ops@example.com" {
		t.Fatal("VAPID keys not loaded")
	}
	if c.PaddleAPIKey != "paddle-key" || c.PaddleEnv != "sandbox" || c.PaddleClientToken != "ctoken" {
		t.Fatal("Paddle keys not loaded")
	}
	if got := c.PaddleWebhookURL(); got != "https://api.example.com/api/v1/webhooks/paddle" {
		t.Fatalf("webhook url = %q", got)
	}
	if c.Maps.APIKey != "server-key" {
		t.Fatal("maps key not loaded")
	}
}

func TestR2ConfiguredRequiresAll(t *testing.T) {
	c := &Config{R2Endpoint: "https://x", R2AccessKey: "a", R2SecretKey: "s", R2PublicBucket: "p"}
	if c.R2Configured() {
		t.Fatal("missing private bucket must not be configured")
	}
	c.R2PrivateBucket = "v"
	if !c.R2Configured() {
		t.Fatal("complete R2 config must be configured")
	}
	if got := (&Config{}).PaddleWebhookURL(); got != "http://localhost:8000/api/v1/webhooks/paddle" {
		t.Fatalf("default webhook url = %q", got)
	}
}
