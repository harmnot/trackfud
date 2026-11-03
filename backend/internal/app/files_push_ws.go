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
	"github.com/SherClockHolmes/webpush-go"
	"github.com/gorilla/websocket"
)

// ---------- Files (R2 live with local fallback; same presign contract) ----------
// Public bucket: menus/avatars. Private bucket: IDs/selfie/proof/agreements.
// Presigned URLs expire in 5 minutes (storage.PresignTTL).
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
	// Live R2: presigned PUT to the right bucket (public: menus/avatars,
	// private: IDs/selfie/proof/agreements), 5-min expiry. The storage key
	// is saved now so completeUpload can mark it ready after the PUT.
	if s.st.Configured() {
		uploadURL, storageKey, err := s.st.PresignPUT(r.Context(), b.Bucket, id, b.ContentType)
		if err != nil {
			problem(w, 500, "Server error", "storage presign failed")
			return
		}
		_, _ = s.db.Exec(r.Context(), `UPDATE files SET storage_path=$2 WHERE id=$1`, id, storageKey)
		exp := time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339)
		writeJSON(w, 201, map[string]any{"file_id": id, "upload_url": uploadURL, "expires_at": exp, "bucket": b.Bucket, "storage": "r2"})
		return
	}
	exp := time.Now().Add(5 * time.Minute).Unix()
	tok := s.signUpload(id, exp)
	url := fmt.Sprintf("/api/v1/files/local/%s?token=%s&exp=%d", id, tok, exp)
	writeJSON(w, 201, map[string]any{"file_id": id, "upload_url": url, "expires_at": time.Unix(exp, 0).UTC().Format(time.RFC3339), "bucket": b.Bucket, "storage": "local"})
}

// completeUpload marks an R2 direct upload ready after the client PUTs bytes
// to the presigned URL. Local uploads keep using PUT /v1/files/local/{id}.
func (s *Server) completeUpload(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	id := r.PathValue("id")
	var owner, bucket, storagePath string
	if err := s.db.QueryRow(r.Context(), `SELECT owner_id, bucket, storage_path FROM files WHERE id=$1`, id).Scan(&owner, &bucket, &storagePath); err != nil {
		problem(w, 404, "Not found", "file not found")
		return
	}
	if owner != c.Sub && !hasAdminRole(c.Roles) {
		problem(w, 403, "Forbidden", "not your file")
		return
	}
	if !s.st.Configured() || storagePath == "" || storagePath[0] != 's' {
		problem(w, 409, "Conflict", "local upload uses PUT /v1/files/local/{id}")
		return
	}
	var b struct {
		SizeBytes int64 `json:"size_bytes"`
	}
	// size_bytes is optional metadata: only parse a body when the client
	// sent one, so a bare POST still reports the real outcome below.
	if r.ContentLength != 0 {
		if !decode(w, r, &b) {
			return
		}
	}
	if b.SizeBytes > 0 && b.SizeBytes <= 5*1024*1024 {
		_, _ = s.db.Exec(r.Context(), `UPDATE files SET status='ready', size_bytes=$2 WHERE id=$1`, id, b.SizeBytes)
	} else {
		_, _ = s.db.Exec(r.Context(), `UPDATE files SET status='ready' WHERE id=$1`, id)
	}
	writeJSON(w, 200, map[string]any{"file_id": id, "status": "ready", "bucket": bucket})
}

func (s *Server) localUpload(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var storagePath string
	_ = s.db.QueryRow(r.Context(), `SELECT storage_path FROM files WHERE id=$1`, id).Scan(&storagePath)
	if s.st.Configured() && len(storagePath) > 5 && storagePath[:5] == "s3://" {
		problem(w, 410, "Gone", "R2 upload uses the presigned PUT URL, then POST /v1/files/{id}/complete")
		return
	}
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
	// Live R2: public files redirect to the CDN/public base when configured;
	// private files (IDs/selfie/proof/agreements) need auth then a 5-min
	// presigned GET redirect — bytes never proxy through the API.
	if len(path) > 5 && path[:5] == "s3://" {
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
			signed, err := s.st.PresignGET(r.Context(), bucket, path)
			if err != nil {
				problem(w, 500, "Server error", "storage presign failed")
				return
			}
			http.Redirect(w, r, signed, http.StatusFound)
			return
		}
		if pub := s.st.PublicURL(bucket, path); pub != "" {
			http.Redirect(w, r, pub, http.StatusFound)
			return
		}
		// No bucket-bound public base (single-endpoint setup): serve public
		// files via a 5-min presigned GET like private ones, minus the auth
		// check — frontends load `/files/{id}/content` fresh on every view.
		signed, err := s.st.PresignGET(r.Context(), bucket, path)
		if err != nil {
			problem(w, 500, "Server error", "storage presign failed")
			return
		}
		http.Redirect(w, r, signed, http.StatusFound)
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

// ---------- Push (VAPID env wins, DB pair is the dev fallback) ----------
func (s *Server) vapidKeys(r *http.Request) (string, string, error) {
	if s.cfg.VAPIDPublicKey != "" && s.cfg.VAPIDPrivateKey != "" {
		return s.cfg.VAPIDPublicKey, s.cfg.VAPIDPrivateKey, nil
	}
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
	s.queuePush(c.Sub, "Trackfud test", "Push plumbing works (Milestone 1).")
	writeJSON(w, 202, map[string]any{"queued": true})
}

// ---------- Jobs worker (River; args, workers and enqueue live in river.go) ----------
func (s *Server) StartWorker() {
	go func() {
		ctx := context.Background()
		if s.rq == nil {
			s.log.Error("river: worker not initialized, jobs disabled")
			return
		}
		if err := s.rq.Start(ctx); err != nil {
			s.log.Error("river: start failed", "err", err)
		}
	}()
}

func (s *Server) doEmail(ctx context.Context, p map[string]string) string {
	_, err := s.db.Exec(ctx, `INSERT INTO outbox_emails(to_email,subject,body) VALUES($1,$2,$3)`, p["to"], p["subject"], p["body"])
	if err != nil {
		return err.Error()
	}
	if s.cfg.SMTPHost == "" {
		return ""
	}
	// Header-injection guard: recipients/subjects come from job payloads.
	to, subject := sanitizeHeader(p["to"]), sanitizeHeader(p["subject"])
	if to == "" || !strings.Contains(to, "@") {
		s.log.Warn("smtp skip: bad recipient (outbox kept)")
		return ""
	}
	from := s.cfg.SMTPFrom
	if from == "" {
		from = "no-reply@Trackfud.local"
	}
	var auth smtp.Auth
	if s.cfg.SMTPUser != "" {
		// Brevo: smtp-relay.brevo.com:587 + API-key user/pass over STARTTLS.
		auth = smtp.PlainAuth("", s.cfg.SMTPUser, s.cfg.SMTPPassword, s.cfg.SMTPHost)
	}
	msg := "From: " + sanitizeHeader(from) + "\r\nTo: " + to + "\r\nSubject: " + subject + "\r\n\r\n" + p["body"]
	if err := smtp.SendMail(s.cfg.SMTPHost+":"+s.cfg.SMTPPort, auth, from, []string{to}, []byte(msg)); err != nil {
		s.log.Warn("smtp send failed (outbox kept)", "err", err)
	}
	return ""
}

// sanitizeHeader strips CR/LF so job payloads cannot inject SMTP headers.
func sanitizeHeader(v string) string {
	v = strings.ReplaceAll(v, "\r", "")
	v = strings.ReplaceAll(v, "\n", "")
	return strings.TrimSpace(v)
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
	sent, attempted, failed := 0, 0, 0
	for rows.Next() {
		var ep, k1, k2 string
		if err := rows.Scan(&ep, &k1, &k2); err != nil {
			continue
		}
		attempted++
		sub := &webpush.Subscription{Endpoint: ep, Keys: webpush.Keys{P256dh: k1, Auth: k2}}
		subscriber := s.cfg.VAPIDSubject
		if subscriber == "" {
			subscriber = "mailto:demo@Trackfud.local"
		}
		resp, err := webpush.SendNotificationWithContext(ctx, payload, sub, &webpush.Options{Subscriber: subscriber, VAPIDPrivateKey: priv, VAPIDPublicKey: pub, TTL: 60, Urgency: webpush.UrgencyHigh})
		if err != nil {
			failed++
			continue
		}
		_ = resp.Body.Close()
		if resp.StatusCode == 404 || resp.StatusCode == 410 {
			_, _ = s.db.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint=$1`, ep)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			failed++
			continue
		}
		sent++
	}
	// No subscription yet is not an error in demo: job completes, frontend subscribe enables real delivery.
	if attempted > 0 && sent == 0 && failed > 0 {
		return fmt.Sprintf("push: %d subscription(s) attempted, all failed", failed)
	}
	return ""
}

func (s *Server) vapidKeysReq(ctx context.Context) (string, string, error) {
	// Env pair (TF_VAPID_*) wins; DB-generated pair is the dev fallback.
	if s.cfg.VAPIDPublicKey != "" && s.cfg.VAPIDPrivateKey != "" {
		return s.cfg.VAPIDPublicKey, s.cfg.VAPIDPrivateKey, nil
	}
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
