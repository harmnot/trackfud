package app

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"Trackfud/internal/authjwt"
)

func (s *Server) roles(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.Query(ctx, `SELECT role FROM user_roles WHERE user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Server) issueTokens(w http.ResponseWriter, r *http.Request, userID, email, app string, roles []string) (map[string]any, error) {
	now := time.Now()
	access, err := authjwt.Sign(s.cfg.JWTSecret, authjwt.Claims{Sub: userID, Email: email, Roles: roles, App: app, Iat: now.Unix(), Exp: now.Add(time.Duration(s.cfg.Auth.AccessTTLSeconds) * time.Second).Unix()})
	if err != nil {
		return nil, err
	}
	raw, err := authjwt.RandomToken(32)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(r.Context(), `INSERT INTO refresh_tokens(user_id,app,token_hash,expires_at) VALUES($1,$2,$3,$4)`, userID, app, authjwt.HashToken(raw), now.Add(time.Duration(s.cfg.Auth.RefreshTTLSeconds)*time.Second)); err != nil {
		return nil, err
	}
	setRefreshCookie(w, r, app, raw, s.cfg.Auth.RefreshTTLSeconds)
	return map[string]any{"access_token": access, "token_type": "Bearer", "expires_in": s.cfg.Auth.AccessTTLSeconds, "user": map[string]any{"id": userID, "email": email, "roles": roles}}, nil
}

// setRefreshCookie writes the per-app HttpOnly refresh cookie. Secure is set
// on TLS (or behind a TLS-terminating proxy via X-Forwarded-Proto) so the
// cookie never travels over plain HTTP in production, while local http dev
// keeps working. SameSite=Lax plus the required X-TF-App header (enforced
// by the locked CORS policy) is the CSRF defense for the cookie-only
// refresh endpoint.
func setRefreshCookie(w http.ResponseWriter, r *http.Request, app, value string, maxAge int) {
	secure := r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
	http.SetCookie(w, &http.Cookie{Name: "tf_" + app + "_refresh", Value: value, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}

type authBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
	Phone    string `json:"phone"`
	Role     string `json:"role"`
	App      string `json:"app"`
}

func validRole(r string) bool {
	return r == "customer" || r == "courier" || r == "merchant"
}

// normalizeApp maps the X-TF-App / body app value to one canonical platform:
// customer, courier, merchant or cms. Aliases from older clients are folded
// so a renamed header can never bypass the platform gate.
func normalizeApp(s string) string {
	a := strings.ToLower(strings.TrimSpace(s))
	switch a {
	case "cms", "admin", "back-office", "backoffice", "cms-admin", "back_office":
		return "cms"
	case "courier", "runner", "biker", "runner-biker", "runner_biker", "stride":
		return "courier"
	case "merchant", "store", "restaurant":
		return "merchant"
	case "customer", "customer-app", "customer_app", "":
		if a == "" {
			return ""
		}
		return "customer"
	default:
		return a
	}
}

// allowedRolesForApp is the single source of truth for platform isolation:
// an admin account signs in only on the CMS, a customer only on the customer
// PWA, a courier only on the runner-biker PWA, and a merchant owner only on
// the merchant PWA.
func allowedRolesForApp(app string) []string {
	switch normalizeApp(app) {
	case "cms":
		return []string{"admin"}
	case "customer":
		return []string{"customer"}
	case "courier":
		return []string{"courier"}
	case "merchant":
		return []string{"merchant"}
	default:
		return nil
	}
}

func hasAnyRole(roles, allowed []string) bool {
	for _, have := range roles {
		for _, want := range allowed {
			if have == want {
				return true
			}
		}
	}
	return false
}

func hasAdminRole(roles []string) bool { return hasAnyRole(roles, []string{"admin"}) }

// platformAccess decides whether roles may use app. Admin accounts are
// cms-only even when they also carry another role (separate accounts for
// separate platforms). Courier access additionally allows invited merchant
// staff (matched by account email in merchant_staff), who deliver fallback
// orders from inside the runner-biker PWA in staff mode — that case needs a
// DB check, signalled by needStaffCheck.
func platformAccess(roles []string, app string) (allowed, needStaffCheck bool) {
	switch normalizeApp(app) {
	case "cms":
		return hasAdminRole(roles), false
	case "customer":
		if hasAdminRole(roles) {
			return false, false
		}
		return hasAnyRole(roles, []string{"customer"}), false
	case "courier":
		if hasAdminRole(roles) {
			return false, false
		}
		if hasAnyRole(roles, []string{"courier"}) {
			return true, false
		}
		return false, true
	case "merchant":
		if hasAdminRole(roles) {
			return false, false
		}
		return hasAnyRole(roles, []string{"merchant"}), false
	default:
		return false, false
	}
}

// platformName is the human label used in 403 messages.
func platformName(app string) string {
	switch normalizeApp(app) {
	case "cms":
		return "admin (CMS)"
	case "customer":
		return "customer"
	case "courier":
		return "runner-biker (courier)"
	case "merchant":
		return "merchant"
	default:
		return strings.TrimSpace(app)
	}
}

func forbidPlatform(w http.ResponseWriter, app string) {
	problem(w, 403, "Forbidden", "this account cannot sign in on the "+platformName(app)+" platform")
}

// isStaffUser reports whether userID is on any merchant staff roster
// (matched by account email, the same link the merchant invite and signup
// use). Invited staff enter staff mode from the runner-biker PWA.
func (s *Server) isStaffUser(ctx context.Context, userID string) bool {
	var one int
	err := s.db.QueryRow(ctx, `SELECT 1 FROM merchant_staff ms
		JOIN users u ON lower(u.email)=lower(ms.email)
		WHERE u.id=$1 LIMIT 1`, userID).Scan(&one)
	return err == nil && one == 1
}

// linkStaffInvites accepts every pending staff invite for email: the roster
// rows get userID and turn active. Signup runs it when an invited address
// registers; the seed reuses it so seeded staff link exactly the same way.
func (s *Server) linkStaffInvites(ctx context.Context, userID, email string) error {
	if _, err := s.db.Exec(ctx, `UPDATE merchant_staff SET user_id=$1, status='active'
		WHERE lower(email)=lower($2) AND user_id IS NULL`, userID, email); err != nil {
		return fmt.Errorf("link staff invites: %w", err)
	}
	return nil
}

func (s *Server) signup(w http.ResponseWriter, r *http.Request) {
	var b authBody
	if !decode(w, r, &b) {
		return
	}
	b.Email = strings.ToLower(strings.TrimSpace(b.Email))
	if !strings.Contains(b.Email, "@") || len(b.Password) < 8 {
		problem(w, 400, "Validation failed", "valid email and password (min 8 chars) required")
		return
	}
	// Platform isolation: an account is created only on its own platform.
	// The CMS has no signup. An empty role defaults to the platform the
	// request came from, so clients never force a role at signup — partner
	// status still unlocks later via onboarding + CMS approval.
	signupApp := appOf(r, b.App)
	if b.Role == "" {
		if r := normalizeApp(signupApp); validRole(r) {
			b.Role = r
		} else {
			b.Role = "customer"
		}
	}
	if !validRole(b.Role) {
		problem(w, 400, "Validation failed", "role must be customer, courier or merchant")
		return
	}
	// The CMS has no signup; the role must match the signup platform.
	if normalizeApp(signupApp) == "cms" {
		forbidPlatform(w, signupApp)
		return
	}
	if normalizeApp(signupApp) != b.Role {
		forbidPlatform(w, signupApp)
		return
	}
	hash, err := hashPW(b.Password)
	if err != nil {
		problem(w, 500, "Server error", "hash failed")
		return
	}
	var id string
	err = s.db.QueryRow(r.Context(), `INSERT INTO users(email,password_hash,name,phone) VALUES($1,$2,$3,$4) RETURNING id`, b.Email, hash, b.Name, b.Phone).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			problem(w, 409, "Conflict", "email already registered")
			return
		}
		problem(w, 500, "Server error", err.Error())
		return
	}
	if _, err := s.db.Exec(r.Context(), `INSERT INTO user_roles(user_id,role) VALUES($1,$2)`, id, b.Role); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	// Staff invite accepted: signing up with the invited email links the roster.
	if err := s.linkStaffInvites(r.Context(), id, b.Email); err != nil {
		s.log.Warn("staff invite link failed", "err", err)
	}
	tok, _ := authjwt.RandomToken(16)
	_, _ = s.db.Exec(r.Context(), `INSERT INTO verification_tokens(token,user_id,expires_at) VALUES($1,$2,$3)`, tok, id, time.Now().Add(24*time.Hour))
	s.enqueueNow(JobEmailSend, fmt.Sprintf(`{"to":%q,"subject":"Verify your Trackfud email","body":"Your verification token: %s (demo outbox)"}`, b.Email, tok), time.Now())
	app := appOf(r, b.App)
	out, err := s.issueTokens(w, r, id, b.Email, app, []string{b.Role})
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	out["email_verification_token_demo"] = tok
	writeJSON(w, 201, out)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var b authBody
	if !decode(w, r, &b) {
		return
	}
	b.Email = strings.ToLower(strings.TrimSpace(b.Email))
	var id, hash string
	err := s.db.QueryRow(r.Context(), `SELECT id,password_hash FROM users WHERE email=$1`, b.Email).Scan(&id, &hash)
	if err != nil || !verifyPW(hash, b.Password) {
		problem(w, 401, "Unauthorized", "invalid email or password")
		return
	}
	// Seamless migration: a legacy bcrypt row that just verified is re-hashed
	// to Argon2id so old hashes disappear with use, not with a flag day.
	if needsRehash(hash) {
		if nh, herr := hashPW(b.Password); herr == nil {
			_, _ = s.db.Exec(r.Context(), `UPDATE users SET password_hash=$2 WHERE id=$1`, id, nh)
		}
	}
	roles, err := s.roles(r.Context(), id)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	loginApp := appOf(r, b.App)
	if ok, needStaff := platformAccess(roles, loginApp); !ok {
		if !needStaff || !s.isStaffUser(r.Context(), id) {
			forbidPlatform(w, loginApp)
			return
		}
	}
	out, err := s.issueTokens(w, r, id, b.Email, loginApp, roles)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, out)
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	app := appOf(r, "")
	// app may come from query for cookie selection
	if q := r.URL.Query().Get("app"); q != "" {
		app = q
	}
	c, err := r.Cookie("tf_" + app + "_refresh")
	if err != nil || c.Value == "" {
		// try any app cookie
		for _, name := range []string{"tf_customer_refresh", "tf_courier_refresh", "tf_merchant_refresh", "tf_cms_refresh"} {
			if cc, e := r.Cookie(name); e == nil && cc.Value != "" {
				c, err = cc, nil
				break
			}
		}
	}
	if err != nil || c.Value == "" {
		problem(w, 401, "Unauthorized", "missing refresh cookie")
		return
	}
	var userID, email string
	var revokedAt *time.Time
	var expiresAt time.Time
	err = s.db.QueryRow(r.Context(), `SELECT rt.user_id, u.email, rt.revoked_at, rt.expires_at FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id WHERE rt.token_hash=$1`, authjwt.HashToken(c.Value)).Scan(&userID, &email, &revokedAt, &expiresAt)
	if err != nil {
		problem(w, 401, "Unauthorized", "invalid refresh token")
		return
	}
	if revokedAt != nil {
		// Rotation reuse: a revoked token presented again means theft or
		// replay — revoke every session for this user and force sign-in.
		_, _ = s.db.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, userID)
		problem(w, 401, "Unauthorized", "session revoked — sign in again")
		return
	}
	if time.Now().After(expiresAt) {
		problem(w, 401, "Unauthorized", "invalid refresh token")
		return
	}
	roles, _ := s.roles(r.Context(), userID)
	if ok, needStaff := platformAccess(roles, app); !ok {
		if !needStaff || !s.isStaffUser(r.Context(), userID) {
			forbidPlatform(w, app)
			return
		}
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1`, authjwt.HashToken(c.Value))
	out, err := s.issueTokens(w, r, userID, email, app, roles)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, out)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	for _, name := range []string{"tf_customer_refresh", "tf_courier_refresh", "tf_merchant_refresh", "tf_cms_refresh"} {
		if c, err := r.Cookie(name); err == nil {
			_, _ = s.db.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1`, authjwt.HashToken(c.Value))
			setRefreshCookie(w, r, strings.TrimSuffix(strings.TrimPrefix(name, "tf_"), "_refresh"), "", -1)
		}
	}
	w.WriteHeader(204)
}

func (s *Server) demoLogin(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.Server.DemoMode {
		problem(w, 404, "Not found", "demo mode disabled")
		return
	}
	var b struct {
		App string `json:"app"`
	}
	_ = decode(w, r, &b)
	app := appOf(r, b.App)
	role := "customer"
	switch normalizeApp(app) {
	case "courier":
		role = "courier"
	case "merchant":
		role = "merchant"
	case "cms":
		role = "admin"
	}
	email := "demo-" + role + "@Trackfud.local"
	var id string
	err := s.db.QueryRow(r.Context(), `SELECT id FROM users WHERE email=$1`, email).Scan(&id)
	if err != nil {
		hash, _ := hashPW("DemoPass123!")
		if err := s.db.QueryRow(r.Context(), `INSERT INTO users(email,password_hash,name,email_verified) VALUES($1,$2,$3,true) RETURNING id`, email, hash, "Demo "+role).Scan(&id); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
		_, _ = s.db.Exec(r.Context(), `INSERT INTO user_roles(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING`, id, role)
	}
	roles, _ := s.roles(r.Context(), id)
	if len(roles) == 0 {
		roles = []string{role}
	}
	if ok, _ := platformAccess(roles, app); !ok {
		forbidPlatform(w, app)
		return
	}
	out, err := s.issueTokens(w, r, id, email, app, roles)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, out)
}

func (s *Server) verifyEmail(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Token string `json:"token"`
	}
	if !decode(w, r, &b) {
		return
	}
	var userID string
	err := s.db.QueryRow(r.Context(), `SELECT user_id FROM verification_tokens WHERE token=$1 AND used_at IS NULL AND expires_at>now()`, b.Token).Scan(&userID)
	if err != nil {
		problem(w, 400, "Validation failed", "invalid or expired verification token")
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE verification_tokens SET used_at=now() WHERE token=$1`, b.Token)
	_, _ = s.db.Exec(r.Context(), `UPDATE users SET email_verified=true WHERE id=$1`, userID)
	writeJSON(w, 200, map[string]any{"verified": true})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var name, phone string
	var verified bool
	_ = s.db.QueryRow(r.Context(), `SELECT name,phone,email_verified FROM users WHERE id=$1`, c.Sub).Scan(&name, &phone, &verified)
	writeJSON(w, 200, map[string]any{"id": c.Sub, "email": c.Email, "name": name, "phone": phone, "roles": c.Roles, "email_verified": verified})
}

// devOutbox lists the 50 newest queued emails. Bodies carry verification
// and reset tokens, so it is guarded exactly like GET /v1/dev/push-log:
// s.auth on the route, then demo mode (404 otherwise) + admin role.
func (s *Server) devOutbox(w http.ResponseWriter, r *http.Request) {
	if !s.requireDemo(w, r) {
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT to_email,subject,body,created_at FROM outbox_emails ORDER BY created_at DESC LIMIT 50`)
	if err != nil {
		s.log.Warn("dev outbox query failed", "err", err)
		problem(w, 500, "Server error", "outbox unavailable")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var to, sub, body string
		var at time.Time
		if err := rows.Scan(&to, &sub, &body, &at); err != nil {
			s.log.Warn("dev outbox scan failed", "err", err)
			problem(w, 500, "Server error", "outbox unavailable")
			return
		}
		out = append(out, map[string]any{"to": to, "subject": sub, "body": body, "created_at": at})
	}
	if err := rows.Err(); err != nil {
		s.log.Warn("dev outbox rows failed", "err", err)
		problem(w, 500, "Server error", "outbox unavailable")
		return
	}
	writeJSON(w, 200, map[string]any{"emails": out})
}
