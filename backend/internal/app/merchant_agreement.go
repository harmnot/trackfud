// Merchant agreement status + idempotent e-sign guard.
//
// GET /v1/merchant/merchants/me/agreement returns the latest signature for
// the caller's store so the PWA can disable the submit button, show the
// signed time, and avoid double submits. POST stays in catalog.go but now
// returns 409 when the same version is already signed.
package app

import (
	"net/http"
	"time"
)

// agreementStatusView shapes one agreement row for the merchant PWA.
func agreementStatusView(version, signer string, agreed bool, signedAt *time.Time, merchantStatus string) map[string]any {
	var signed string
	if signedAt != nil {
		signed = signedAt.UTC().Format(time.RFC3339)
	}
	return map[string]any{
		"version":         version,
		"signer_name":     signer,
		"agreed":          agreed,
		"signed_at":       signed,
		"merchant_status": merchantStatus,
		"signed":          agreed && signed != "",
	}
}

// getMyAgreement serves the latest agreement signature for the caller's store.
// No store yet -> { agreement: null } so the UI can prompt setup first.
func (s *Server) getMyAgreement(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	m, err := s.fetchMerchant(r, c.Sub)
	if err != nil {
		writeJSON(w, 200, map[string]any{"agreement": nil})
		return
	}
	var version, signer string
	var agreed bool
	var signedAt *time.Time
	_ = s.db.QueryRow(r.Context(), `SELECT version, signer_name, agreed, signed_at
		FROM merchant_agreements WHERE merchant_id=$1 ORDER BY signed_at DESC LIMIT 1`,
		m["id"]).Scan(&version, &signer, &agreed, &signedAt)
	if version == "" {
		writeJSON(w, 200, map[string]any{"agreement": nil, "merchant_status": m["status"]})
		return
	}
	status, _ := m["status"].(string)
	writeJSON(w, 200, map[string]any{
		"agreement":       agreementStatusView(version, signer, agreed, signedAt, status),
		"merchant_status": status,
	})
}
