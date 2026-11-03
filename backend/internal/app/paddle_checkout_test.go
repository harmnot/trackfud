package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// paddleAPIBase: sandbox by default, production only on explicit opt-in.
func TestPaddleAPIBase(t *testing.T) {
	if got := paddleAPIBase("sandbox"); got != "https://sandbox-api.paddle.com" {
		t.Fatalf("sandbox base = %q", got)
	}
	if got := paddleAPIBase(""); got != "https://sandbox-api.paddle.com" {
		t.Fatalf("empty env must stay sandbox, got %q", got)
	}
	if got := paddleAPIBase("production"); got != "https://api.paddle.com" {
		t.Fatalf("production base = %q", got)
	}
}

// Validation never touches the network: missing key, bad amount/currency,
// empty payment id all fail before any HTTP call.
func TestCreatePaddleTransactionValidation(t *testing.T) {
	ctx := context.Background()
	client := &http.Client{Timeout: time.Second}
	for _, tc := range []struct {
		name           string
		key            string
		amount         int64
		currency       string
		paymentID      string
		wantErrContain string
	}{
		{"missing key", "", 50000, "USD", "pay-1", "not configured"},
		{"bad amount", "k", 0, "USD", "pay-1", "positive"},
		{"bad currency", "k", 100, "idrr", "pay-1", "ISO"},
		{"unsupported currency", "k", 10000, "IDR", "pay-1", "not chargeable"},
		{"missing payment", "k", 100, "USD", "", "payment id"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := createPaddleTransaction(ctx, client, paddleAPIBase("sandbox"), tc.key, tc.paymentID, tc.amount, tc.currency, "d"); err == nil {
				t.Fatal("must fail")
			}
		})
	}
}

// The Transactions create payload: one inline price with our payment id in
// custom_data (the webhook maps back through it).
func TestCreatePaddleTransactionPayload(t *testing.T) {
	var gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		raw := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(raw)
		gotBody = string(raw)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"id":"txn_test_123","status":"ready"}}`))
	}))
	defer srv.Close()
	txn, err := createPaddleTransaction(context.Background(), srv.Client(), srv.URL, "test-key", "pay-1", 2230, "usd", "")
	if err != nil {
		t.Fatalf("create must succeed: %v", err)
	}
	if txn != "txn_test_123" {
		t.Fatalf("txn id = %q", txn)
	}
	if gotAuth != "Bearer test-key" {
		t.Fatalf("auth header = %q", gotAuth)
	}
	var body struct {
		Items []struct {
			Price struct {
				Description  string `json:"description"`
				BillingCycle *struct {
					Interval  string `json:"interval"`
					Frequency int    `json:"frequency"`
				} `json:"billing_cycle"`
				UnitPrice struct {
					Amount       string `json:"amount"`
					CurrencyCode string `json:"currency_code"`
				} `json:"unit_price"`
				Product struct {
					Name        string `json:"name"`
					TaxCategory string `json:"tax_category"`
				} `json:"product"`
			} `json:"price"`
		} `json:"items"`
		CustomData     map[string]string `json:"custom_data"`
		CollectionMode string            `json:"collection_mode"`
	}
	if err := json.Unmarshal([]byte(gotBody), &body); err != nil {
		t.Fatalf("payload must be JSON: %v", err)
	}
	if len(body.Items) != 1 || body.Items[0].Price.UnitPrice.Amount != "2230" {
		t.Fatalf("payload needs one inline price for the exact amount: %s", gotBody)
	}
	if body.Items[0].Price.UnitPrice.CurrencyCode != "USD" {
		t.Fatalf("currency must be uppercased: %s", gotBody)
	}
	// The non-catalog price branch needs the full price object: explicit
	// null billing_cycle (one-time) plus an inline product with name and
	// tax_category — without it Paddle answers `price_id is required`.
	if body.Items[0].Price.BillingCycle != nil {
		t.Fatalf("one-time price needs null billing_cycle: %s", gotBody)
	}
	if body.Items[0].Price.Product.Name == "" || body.Items[0].Price.Product.TaxCategory == "" {
		t.Fatalf("inline product needs name + tax_category: %s", gotBody)
	}
	if body.CustomData["payment_id"] == "" {
		t.Fatalf("custom_data.payment_id must carry our payment: %s", gotBody)
	}
	if body.CollectionMode != "automatic" {
		t.Fatalf("collection_mode must be automatic: %s", gotBody)
	}
}

// Upstream failures surface (never a fake transaction id).
func TestCreatePaddleTransactionUpstreamError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":{"detail":"price required"}}`))
	}))
	defer srv.Close()
	if _, err := createPaddleTransaction(context.Background(), srv.Client(), srv.URL, "k", "pay-1", 100, "USD", "d"); err == nil {
		t.Fatal("upstream 400 must fail")
	}
}
