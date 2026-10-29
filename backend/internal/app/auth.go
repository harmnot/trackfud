package app

import (
	"context"
	"net/http"
	"strings"
	"time"

	"Trackfud/internal/authjwt"

	"golang.org/x/crypto/bcrypt"
)

func hashPW(p string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(p), 10)
	return string(b), err
}

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
	http.SetCookie(w, &http.Cookie{Name: "tf_" + app + "_refresh", Value: raw, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: s.cfg.Auth.RefreshTTLSeconds})
	return map[string]any{"access_token": access, "token_type": "Bearer", "expires_in": s.cfg.Auth.AccessTTLSeconds, "user": map[string]any{"id": userID, "email": email, "roles": roles}}, nil
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
	if b.Role == "" {
		b.Role = "customer"
	}
	if !validRole(b.Role) {
		problem(w, 400, "Validation failed", "role must be customer, courier or merchant")
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
	_, _ = s.db.Exec(r.Context(), `UPDATE merchant_staff SET user_id=$1, status='active'
		WHERE lower(email)=lower($2) AND user_id IS NULL`, id, b.Email)
	tok, _ := authjwt.RandomToken(16)
	_, _ = s.db.Exec(r.Context(), `INSERT INTO verification_tokens(token,user_id,expires_at) VALUES($1,$2,$3)`, tok, id, time.Now().Add(24*time.Hour))
	_, _ = s.db.Exec(r.Context(), `INSERT INTO jobs(kind,payload) VALUES('email_send',$1)`, `{"to":"`+b.Email+`","subject":"Verify your Trackfud email","body":"Your verification token: `+tok+` (demo outbox)"}`)
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
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(b.Password)) != nil {
		problem(w, 401, "Unauthorized", "invalid email or password")
		return
	}
	roles, err := s.roles(r.Context(), id)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	out, err := s.issueTokens(w, r, id, b.Email, appOf(r, b.App), roles)
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
		for _, name := range []string{"tf_customer_refresh", "tf_courier_refresh", "tf_merchant_refresh"} {
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
	err = s.db.QueryRow(r.Context(), `SELECT rt.user_id, u.email FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL AND rt.expires_at>now()`, authjwt.HashToken(c.Value)).Scan(&userID, &email)
	if err != nil {
		problem(w, 401, "Unauthorized", "invalid refresh token")
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1`, authjwt.HashToken(c.Value))
	roles, _ := s.roles(r.Context(), userID)
	out, err := s.issueTokens(w, r, userID, email, app, roles)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, out)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	for _, name := range []string{"tf_customer_refresh", "tf_courier_refresh", "tf_merchant_refresh"} {
		if c, err := r.Cookie(name); err == nil {
			_, _ = s.db.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1`, authjwt.HashToken(c.Value))
			http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
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
	if app == "courier" {
		role = "courier"
	} else if app == "merchant" {
		role = "merchant"
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
	out, err := s.issueTokens(w, r, id, email, app, []string{role})
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

func (s *Server) devOutbox(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.Server.DemoMode {
		problem(w, 404, "Not found", "demo mode disabled")
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT to_email,subject,body,created_at FROM outbox_emails ORDER BY created_at DESC LIMIT 50`)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var to, sub, body string
		var at time.Time
		_ = rows.Scan(&to, &sub, &body, &at)
		out = append(out, map[string]any{"to": to, "subject": sub, "body": body, "created_at": at})
	}
	writeJSON(w, 200, map[string]any{"emails": out})
}
