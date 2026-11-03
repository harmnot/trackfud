package main

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
)

// The auto-merchant signs in as the demo-mode seed owner of the three demo
// stores (SeedDemo) with the demo seed password.
const (
	demoMerchantEmail = "demo-merchant@Trackfud.local"
	demoSeedPassword  = "DemoPass123!"
)

// autoMerchant accepts placed orders and readies accepted ones so the bot
// loop runs unattended. All calls carry X-TF-App: merchant.
type autoMerchant struct {
	who *actor
	log *slog.Logger
}

// tick signs in when needed (failed sign-ins back off) and advances the
// demo merchant's orders by one step each.
func (m *autoMerchant) tick() {
	if m.who.token == "" {
		if err := m.who.login(); err != nil {
			if !errors.Is(err, errLoginBackoff) {
				m.log.Warn("auto-merchant sign-in failed", "err", err)
			}
			return
		}
	}
	var out struct {
		Orders []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"orders"`
	}
	if code, err := m.who.call(http.MethodGet, "/v1/merchant/orders", nil, &out); err != nil || code >= 300 {
		return
	}
	for _, o := range out.Orders {
		base := "/v1/merchant/orders/" + url.PathEscape(o.ID)
		switch o.Status {
		case "placed":
			_, _ = m.who.call(http.MethodPost, base+"/accept", map[string]any{}, nil)
		case "accepted":
			_, _ = m.who.call(http.MethodPost, base+"/ready", map[string]any{}, nil)
		}
	}
}
