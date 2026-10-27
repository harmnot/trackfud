package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/smtp"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"Trackfud/internal/authjwt"
	"Trackfud/internal/authjwt"
usulockHolmes/webpush-go"
	"github.com/gorilla/websocket"
)

// ---------- Files (local presign for Milestone 1; same contract as R2 presign) ----------
func (s *Server) signUpload(fileID string, exp int64) string {
	mac := hmac.New(sha256.New, []byte(s.cfg.JWTSecret))
	mac.Write([]byte(fileID + ":" + strconv.FormatInt(exp, 10)))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) presign(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b struct {
		Bucket      string `json:"bucket"`
		ContentType string `json:"content_type"`
		SizeBytes   int64  `json:"size_bytes"`
	}
	if !decode(w, r, &b) {
		return
	}
	if b.Bucket != "private" {
		b.Bucket = "public"
	}
	allowed := map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true, "application/pdf": true}
	if !allowed[b.ContentType] {
		problem(w, 400, "Validation failed", "content_type must be image/jpeg, image/png, image/webp or application/pdf")
		return
	}
	if b.SizeBytes <= 0 || b.SizeBytes > 5*1024*1024 {
		problem(w, 400, "Validation failed", "size_bytes must be between 1 and 5242880")
		return
	}
	var id string
	err := s.db.QueryRow(r.Context(), `INSERT INTO files(owner_id,bucket,content_type,size_bytes) VALUES($1,$2,$3,$4) RETURNING id`, c.Sub, b.Bucket, b.ContentType, b.SizeBytes).Scan(&id)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	exp := time.Now().Add(5 * time.Minute).Unix()
	tok := s.signUpload(id, exp)
	url := fmt.Sprintf("/api/v1/files/local/%s?token=%s&exp=%d", id, tok, exp)
	writeJSON(w, 201, map[string]any{"file_id": id, "upload_url": url, "expires_at": time.Unix(exp, 0).UTC().Format(time.RFC3339), "bucket": b.Bucket})
}

func (s *Server) localUpload(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	exp, _ := strconv.ParseInt(r.URL.Query().Get("exp"), 10, 64)
	if time.Now().Unix() > exp || !hmac.Equal([]byte(s.signUpload(id, exp)), []byte(r.URL.Query().Get("token"))) {
		problem(w, 403, "Forbidden", "invalid or expired upload token")
		return
	}
	var owner string
	if err := s.db.QueryRow(r.Context(), `SELECT owner_id FROM files WHERE id=$1`, id).Scan(&owner); err != nil {
		problem(w, 404, "Not found", "file not found")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 6*1024*1024))
	if err != nil || len(body) == 0 {
		problem(w, 400, "Validation failed", "empty upload body")
		return
	}
	dir := filepath.Join(s.cfg.UploadDir, owner)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	path := filepath.Join(dir, id)
	if err := os.WriteFile(path, body, 0o644); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE files SET status='ready', size_bytes=$2, storage_path=$3 WHERE id=$1`, id, len(body), path)
	writeJSON(w, 200, map[string]any{"file_id": id, "status": "ready", "size_bytes": len(body)})
}

func (s *Server) fileContent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var bucket, ct, path, owner string
	err := s.db.QueryRow(r.Context(), `SELECT bucket,content_type,storage_path,owner_id FROM files WHERE id=$1 AND status='ready'`, id).Scan(&bucket, &ct, &path, &owner)
	if err != nil {
		problem(w, 404, "Not found", "file not found")
		return
	}
	if bucket == "private" {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			problem(w, 401, "Unauthorized", "private file requires auth")
			return
		}
		cl, err := authjwt.Verify(s.cfg.JWTSecret, strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			problem(w, 401, "Unauthorized", "invalid token")
			return
		}
		ok := cl.Sub == owner
		for _, role := range cl.Roles {
			if role == "admin" {
				ok = true
			}
		}
		if !ok {
			problem(w, 403, "Forbidden", "not your file")
			return
		}
	}
	b, err := os.ReadFile(path)
	if err != nil {
		problem(w, 404, "Not found", "file bytes missing")
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = w.Write(b)
}

// ---------- Push ----------
func (s *Server) vapidKeys(r *http.Request) (string, string, error) {
	var v string
	err := s.db.QueryRow(r.Context(), `SELECT value FROM app_secrets WHERE key='vapid'`).Scan(&v)
	if err == nil && strings.Contains(v, "|") {
		p := strings.SplitN(v, "|", 2)
		return p[0], p[1], nil
	}
	privK, pubK, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return "", "", err
	}
	_, _ = s.db.Exec(r.Context(), `INSERT INTO app_secrets(key,value) VALUES('vapid',$1) ON CONFLICT (key) DO NOTHING`, pubK+"|"+privK)
	return pubK, privK, nil
}

func (s *Server) vapidKey(w http.ResponseWriter, r *http.Request) {
	pub, _, err := s.vapidKeys(r)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"public_key": pub})
}

func (s *Server) pushSubscribe(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b struct {
		App          string `json:"app"`
		Subscription struct {
			Endpoint string `json:"endpoint"`
			Keys     struct {
				P256dh string `json:"p256dh"`
				Auth   string `json:"auth"`
			} `json:"keys"`
		} `json:"subscription"`
		Endpoint string `json:"endpoint"`
		P256dh   string `json:"p256dh"`
		Auth     string `json:"auth"`
	}
	if !decode(w, r, &b) {
		return
	}
	ep, p256, auth := b.Subscription.Endpoint, b.Subscription.Keys.P256dh, b.Subscription.Keys.Auth
	if ep == "" {
		ep, p256, auth = b.Endpoint, b.P256dh, b.Auth
	}
	if ep == "" || p256 == "" || auth == "" {
		problem(w, 400, "Validation failed", "subscription endpoint and keys required")
		return
	}
	app := b.App
	if app == "" {
		app = appOf(r, "")
	}
	var id string
	err := s.db.QueryRow(r.Context(), `INSERT INTO push_subscriptions(user_id,app,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5) ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id`, c.Sub, app, ep, p256, auth).Scan(&id)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{"id": id})
}

func (s *Server) pushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Endpoint string `json:"endpoint"`
	}
	_ = decode(w, r, &b)
	_, _ = s.db.Exec(r.Context(), `DELETE FROM push_subscriptions WHERE endpoint=$1`, b.Endpoint)
	w.WriteHeader(204)
}

func (s *Server) pushTest(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	_, _ = s.db.Exec(r.Context(), `INSERT INTO jobs(kind,payload) VALUES('push_send',$1)`, fmt.Sprintf(`{"user_id":%q,"title":"Trackfud test","body":"Push plumbing works (Milestone 1)."}`, c.Sub))
	writeJSON(w, 202, map[string]any{"queued": true})
}

// ---------- Jobs worker (Postgres queue with same-tx enqueue; River-swappable behind this worker) ----------
func (s *Server) StartWorker() {
	go func() {
		for {
			time.Sleep(2 * time.Second)
			s.workOnce()
		}
	}()
}

func (s *Server) workOnce() {
	ctx := context.Background()
	var id, kind string
	var payload []byte
	err := s.db.QueryRow(ctx, `SELECT id,kind,payload FROM jobs WHERE status='pending' AND run_at<=now() ORDER BY created_at LIMIT 1`).Scan(&id, &kind, &payload)
	if err != nil {
		return
	}
	var p map[string]string
	_ = json.Unmarshal(payload, &p)
	var jobErr string
	switch kind {
	case "email_send":
		jobErr = s.doEmail(ctx, p)
	case "push_send":
		jobErr = s.doPush(ctx, p)
	case "merchant_accept_timeout":
		s.handleMerchantTimeout(ctx, p["order_id"])
	case "dispatch_run":
		s.handleDispatchRun(ctx, p["delivery_id"])
	case "offer_expire":
		s.handleOfferExpire(ctx, p["offer_id"])
	case "dispatch_retry":
		s.handleDispatchRetry(ctx, p["delivery_id"])
	case "search_timeout":
		s.handleSearchTimeout(ctx, p["delivery_id"])
	case "staff_timeout":
		s.handleStaffTimeout(ctx, p["delivery_id"])
	case "leave_now_nudge":
		s.handleLeaveNudge(ctx, p["delivery_id"])
	case "route_refresh":
		s.handleRouteRefresh(ctx, p["delivery_id"])
	case "auto_complete":
		s.handleAutoComplete(ctx, p["order_id"])
	case "payout_process":
		s.handlePayoutProcess(ctx, p["withdrawal_id"])
	case "ai_menu_import", "ai_translate", "ai_trust_brief", "ai_proof_check", "ai_feedback_labels":
		s.runAIJob(kind, p)
	}
	if jobErr != "" {
		_, _ = s.db.Exec(ctx, `UPDATE jobs SET attempts=attempts+1, last_error=$2, status=CASE WHEN attempts+1>=3 THEN 'failed' ELSE 'pending' END, run_at=now()+interval '10 seconds' WHERE id=$1`, id, jobErr)
		return
	}
	_, _ = s.db.Exec(ctx, `UPDATE jobs SET status='done' WHERE id=$1`, id)
}

func (s *Server) doEmail(ctx context.Context, p map[string]string) string {
	_, err := s.db.Exec(ctx, `INSERT INTO outbox_emails(to_email,subject,body) VALUES($1,$2,$3)`, p["to"], p["subject"], p["body"])
	if err != nil {
		return err.Error()
	}
	if s.cfg.SMTPHost != "" {
		addr := s.cfg.SMTPHost + ":" + s.cfg.SMTPPort
		msg := "From: no-reply@Trackfud.local\r\nTo: " + p["to"] + "\r\nSubject: " + p["subject"] + "\r\n\r\n" + p["body"]
		if err := smtp.SendMail(addr, nil, "no-reply@Trackfud.local", []string{p["to"]}, []byte(msg)); err != nil {
			s.log.Warn("smtp send failed (outbox kept)", "err", err)
		}
	}
	return ""
}

func (s *Server) doPush(ctx context.Context, p map[string]string) string {
	pub, priv, err := s.vapidKeysReq(ctx)
	if err != nil {
		return err.Error()
	}
	rows, err := s.db.Query(ctx, `SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=$1`, p["user_id"])
	if err != nil {
		return err.Error()
	}
	defer rows.Close()
	payload, _ := json.Marshal(map[string]string{"title": p["title"], "body": p["body"]})
	sent := 0
	for rows.Next() {
		var ep, k1, k2 string
		if err := rows.Scan(&ep, &k1, &k2); err != nil {
			continue
		}
		sub := &webpush.Subscription{Endpoint: ep, Keys: webpush.Keys{P256dh: k1, Auth: k2}}
		resp, err := webpush.SendNotificationWithContext(ctx, payload, sub, &webpush.Options{Subscriber: "mailto:demo@Trackfud.local", VAPIDPrivateKey: priv, VAPIDPublicKey: pub, TTL: 60, Urgency: webpush.UrgencyHigh})
		if err != nil {
			continue
		}
		_ = resp.Body.Close()
		if resp.StatusCode == 404 || resp.StatusCode == 410 {
			_, _ = s.db.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint=$1`, ep)
			continue
		}
		sent++
	}
	_ = sent
	// No subscription yet is not an error in demo: job completes, frontend subscribe enables real delivery.
	return ""
}

func (s *Server) vapidKeysReq(ctx context.Context) (string, string, error) {
	var v string
	err := s.db.QueryRow(ctx, `SELECT value FROM app_secrets WHERE key='vapid'`).Scan(&v)
	if err == nil && strings.Contains(v, "|") {
		p := strings.SplitN(v, "|", 2)
		return p[0], p[1], nil
	}
	privK, pubK, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return "", "", err
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO app_secrets(key,value) VALUES('vapid',$1) ON CONFLICT (key) DO NOTHING`, pubK+"|"+privK)
	return pubK, privK, nil
}

// ---------- WebSocket hub ----------
type Hub struct {
	mu   sync.Mutex
	conn map[string][]*websocket.Conn
}

func NewHub() *Hub { return &Hub{conn: map[string][]*websocket.Conn{}} }

func (h *Hub) Broadcast(userID, msg string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, c := range h.conn[userID] {
		_ = c.WriteMessage(websocket.TextMessage, []byte(msg))
	}
}

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func (s *Server) wsTicket(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	tok, err := authjwt.RandomToken(16)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	app := appOf(r, "")
	if _, err := s.db.Exec(r.Context(), `INSERT INTO ws_tickets(ticket,user_id,app,expires_at) VALUES($1,$2,$3,$4)`, tok, c.Sub, app, time.Now().Add(30*time.Second)); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{"ticket": tok, "expires_in": 30})
}

func (s *Server) wsConnect(w http.ResponseWriter, r *http.Request) {
	ticket := r.URL.Query().Get("ticket")
	var userID string
	err := s.db.QueryRow(r.Context(), `SELECT user_id FROM ws_tickets WHERE ticket=$1 AND used_at IS NULL AND expires_at>now()`, ticket).Scan(&userID)
	if err != nil {
		problem(w, 401, "Unauthorized", "invalid ws ticket")
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE ws_tickets SET used_at=now() WHERE ticket=$1`, ticket)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.hub.mu.Lock()
	s.hub.conn[userID] = append(s.hub.conn[userID], conn)
	s.hub.mu.Unlock()
	_ = conn.WriteJSON(map[string]any{"type": "hello", "user_id": userID})
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var m map[string]any
		if json.Unmarshal(msg, &m) != nil {
			continue
		}
		switch m["type"] {
		case "ping":
			_ = conn.WriteJSON(map[string]any{"type": "pong"})
		case "loc.batch":
			// Live GPS streaming; the ack lets the phone clear its buffer.
			// Same guards as the HTTP fallback (forward-only, no future).
			var b ingestBody
			if json.Unmarshal(msg, &b) != nil {
				_ = conn.WriteJSON(map[string]any{"type": "loc.ack", "accepted": 0, "error": "bad batch shape"})
				continue
			}
			ack, code, detail := s.ingestCore(context.Background(), userID, b.SessionID, b.Points)
			if code != 200 {
				_ = conn.WriteJSON(map[string]any{"type": "loc.ack", "session_id": b.SessionID, "accepted": 0, "error": detail})
				continue
			}
			ack["type"] = "loc.ack"
			_ = conn.WriteJSON(ack)
		}
	}
	s.hub.mu.Lock()
	list := s.hub.conn[userID]
	for i, cc := range list {
		if cc == conn {
			s.hub.conn[userID] = append(list[:i], list[i+1:]...)
			break
		}
	}
	s.hub.mu.Unlock()
	_ = conn.Close()
}
