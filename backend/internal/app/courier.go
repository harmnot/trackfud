package app

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---------- Courier profile (B3 application autosave) ----------

// profileBody is the autosaved courier application: personal details plus
// R2 private-bucket document references (plan section 8.1).
type profileBody struct {
	Mode             string         `json:"mode"`
	LegalName        string         `json:"legal_name"`
	BirthDate        string         `json:"birth_date"`
	Nationality      string         `json:"nationality"`
	Address          map[string]any `json:"address"`
	EmergencyContact map[string]any `json:"emergency_contact"`
	Phone            string         `json:"phone"`
	IDDocType        string         `json:"id_doc_type"`
	IDNumber         string         `json:"id_number"`
	IDFrontFileID    string         `json:"id_front_file_id"`
	IDBackFileID     string         `json:"id_back_file_id"`
	SelfieFileID     string         `json:"selfie_file_id"`
	Bike             map[string]any `json:"bike"`
	BagLiters        int            `json:"bag_liters"`
	Consents         map[string]any `json:"consents"`
}

// allowedBikeTypes are pedal bikes only (plan 8.1); e-bikes are rejected.
var allowedBikeTypes = map[string]bool{
	"road": true, "city": true, "hybrid": true,
	"mountain": true, "folding": true, "cargo": true,
}

// getProfile returns the saved application profile plus review state.
func (s *Server) getProfile(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	p, _ := s.loadProfile(r.Context(), c.Sub)
	if p == nil {
		mode := "runner"
		_ = s.db.QueryRow(r.Context(), `SELECT mode FROM courier_applications WHERE user_id=$1`, c.Sub).Scan(&mode)
		if mode != "biker" {
			mode = "runner"
		}
		writeJSON(w, 200, map[string]any{"status": "none", "mode": mode, "profile": map[string]any{}})
		return
	}
	writeJSON(w, 200, map[string]any{"status": p["status"], "mode": p["mode"], "profile": p})
}

// saveProfile autosaves the application (draft survives; finish later).
func (s *Server) saveProfile(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b profileBody
	if !decode(w, r, &b) {
		return
	}
	mode := b.Mode
	if mode != "biker" {
		mode = "runner"
	}
	if msg := checkProfileRefs(r.Context(), s, c.Sub, &b); msg != "" {
		problem(w, 400, "Validation failed", msg)
		return
	}
	if err := s.storeProfile(r.Context(), c.Sub, mode, &b); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"saved": true})
}

// checkProfileRefs validates formats and document references without
// judging completeness (that happens at submit).
func checkProfileRefs(ctx context.Context, s *Server, userID string, b *profileBody) string {
	if b.BirthDate != "" {
		bd, err := time.Parse("2006-01-02", b.BirthDate)
		if err != nil {
			return "birth_date must be YYYY-MM-DD"
		}
		if bd.After(time.Now().AddDate(-18, 0, 0)) {
			return "couriers must be 18 or older"
		}
	}
	if b.Phone != "" && !validE164(b.Phone) {
		return "phone must be E.164 (e.g. +628123456789)"
	}
	if b.Bike != nil {
		if t, _ := b.Bike["type"].(string); t != "" && !allowedBikeTypes[strings.ToLower(t)] {
			return "bike type must be a pedal bike: road, city, hybrid, mountain, folding or cargo (no e-bikes)"
		}
	}
	if b.BagLiters < 0 || b.BagLiters > 200 {
		return "bag_liters must be between 0 and 200"
	}
	// Document files must be finished private uploads owned by the applicant.
	ids := []string{}
	for _, id := range []string{b.IDFrontFileID, b.IDBackFileID, b.SelfieFileID} {
		if id != "" {
			ids = append(ids, id)
		}
	}
	if b.Bike != nil {
		if id, _ := b.Bike["photo_file_id"].(string); id != "" {
			ids = append(ids, id)
		}
	}
	for _, id := range ids {
		var bucket, status, owner string
		if err := s.db.QueryRow(ctx, `SELECT bucket,status,owner_id FROM files WHERE id=$1`, id).Scan(&bucket, &status, &owner); err != nil || owner != userID {
			return "document file not found; upload it first"
		}
		if bucket != "private" || status != "ready" {
			return "documents must be finished private uploads"
		}
	}
	return ""
}

func validE164(p string) bool {
	if len(p) < 8 || len(p) > 16 || !strings.HasPrefix(p, "+") {
		return false
	}
	for _, ch := range p[1:] {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}

// storeProfile upserts the couriers row, encrypting the ID number (AES-GCM)
// and hashing it for duplicate detection. Status columns are preserved.
func (s *Server) storeProfile(ctx context.Context, userID, mode string, b *profileBody) error {
	addrB, _ := json.Marshal(nonNilMap(b.Address))
	emB, _ := json.Marshal(nonNilMap(b.EmergencyContact))
	bikeB, _ := json.Marshal(nonNilMap(b.Bike))
	consB, _ := json.Marshal(nonNilMap(b.Consents))
	var enc, hash string
	if strings.TrimSpace(b.IDNumber) != "" {
		var err error
		if enc, err = s.encryptID(strings.TrimSpace(b.IDNumber)); err != nil {
			return err
		}
		hash = hashIDNumber(b.IDNumber)
	}
	_, err := s.db.Exec(ctx, `INSERT INTO couriers(user_id,mode,legal_name,birth_date,nationality,address,
		emergency_contact,id_doc_type,id_number_enc,id_number_hash,
		id_front_file_id,id_back_file_id,selfie_file_id,bike,bag_liters,consents)
		VALUES($1,$2,$3,NULLIF($4,'')::date,$5,$6,$7,$8,$9,NULLIF($10,''),$11,$12,$13,$14,$15,$16)
		ON CONFLICT (user_id) DO UPDATE SET mode=EXCLUDED.mode, legal_name=EXCLUDED.legal_name,
		birth_date=COALESCE(EXCLUDED.birth_date,couriers.birth_date), nationality=EXCLUDED.nationality,
		address=EXCLUDED.address, emergency_contact=EXCLUDED.emergency_contact,
		id_doc_type=EXCLUDED.id_doc_type,
		id_number_enc=CASE WHEN EXCLUDED.id_number_enc<>'' THEN EXCLUDED.id_number_enc ELSE couriers.id_number_enc END,
		id_number_hash=CASE WHEN EXCLUDED.id_number_hash<>'' THEN EXCLUDED.id_number_hash ELSE couriers.id_number_hash END,
		id_front_file_id=COALESCE(EXCLUDED.id_front_file_id,couriers.id_front_file_id),
		id_back_file_id=COALESCE(EXCLUDED.id_back_file_id,couriers.id_back_file_id),
		selfie_file_id=COALESCE(EXCLUDED.selfie_file_id,couriers.selfie_file_id),
		bike=EXCLUDED.bike, bag_liters=EXCLUDED.bag_liters, consents=EXCLUDED.consents, updated_at=now()`,
		userID, mode, strings.TrimSpace(b.LegalName), nullStr(b.BirthDate), strings.TrimSpace(b.Nationality),
		string(addrB), string(emB), strings.TrimSpace(b.IDDocType), enc, hash,
		nullStr(b.IDFrontFileID), nullStr(b.IDBackFileID), nullStr(b.SelfieFileID),
		string(bikeB), b.BagLiters, string(consB))
	if err != nil {
		return err
	}
	if strings.TrimSpace(b.Phone) != "" {
		_, _ = s.db.Exec(ctx, `UPDATE users SET phone=$2 WHERE id=$1`, userID, strings.TrimSpace(b.Phone))
	}
	return nil
}

func nonNilMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func nullStr(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return strings.TrimSpace(v)
}

// loadProfile reads the couriers row with the review status.
// The application status is the review source of truth; the couriers row
// carries the operational status (approved/frozen/banned) after approval.
func (s *Server) loadProfile(ctx context.Context, userID string) (map[string]any, error) {
	var mode, courierStatus, appStatus, legal, nat, docType, hash string
	var bd *time.Time
	var addrB, emB, bikeB, consB []byte
	var bag int
	var front, back, selfie *string
	var approvedAt *time.Time
	err := s.db.QueryRow(ctx, `SELECT c.mode, c.status, c.legal_name, c.birth_date, c.nationality,
		c.address, c.emergency_contact, c.id_doc_type, c.id_number_hash,
		c.id_front_file_id, c.id_back_file_id, c.selfie_file_id, c.bike, c.bag_liters, c.consents, c.approved_at,
		COALESCE((SELECT status FROM courier_applications WHERE user_id=c.user_id),'none')
		FROM couriers c WHERE c.user_id=$1`, userID).Scan(&mode, &courierStatus, &legal, &bd, &nat,
		&addrB, &emB, &docType, &hash, &front, &back, &selfie, &bikeB, &bag, &consB, &approvedAt, &appStatus)
	if err != nil {
		return nil, err
	}
	var addr, em, bike, cons map[string]any
	_ = json.Unmarshal(addrB, &addr)
	_ = json.Unmarshal(emB, &em)
	_ = json.Unmarshal(bikeB, &bike)
	_ = json.Unmarshal(consB, &cons)
	var phone string
	_ = s.db.QueryRow(ctx, `SELECT phone FROM users WHERE id=$1`, userID).Scan(&phone)
	status := appStatus
	if status == "none" || status == "" {
		status = courierStatus
	}
	out := map[string]any{"mode": mode, "status": status, "legal_name": legal, "nationality": nat,
		"address": addr, "emergency_contact": em, "phone": phone,
		"id_doc_type": docType, "id_number_saved": hash != "",
		"id_front_file_id": strOrEmpty(front), "id_back_file_id": strOrEmpty(back),
		"selfie_file_id": strOrEmpty(selfie), "bike": bike, "bag_liters": bag, "consents": cons}
	if bd != nil {
		out["birth_date"] = bd.Format("2006-01-02")
	}
	if approvedAt != nil {
		out["approved_at"] = approvedAt.UTC().Format("2006-01-02T15:04:05Z07:00")
	}
	return out, nil
}

func strOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// profileMissing lists the fields still needed before submit (plan 8.1).
func (s *Server) profileMissing(ctx context.Context, userID, mode string) []string {
	missing := []string{}
	p, err := s.loadProfile(ctx, userID)
	if err != nil {
		return []string{"profile"}
	}
	need := func(key string, ok bool) {
		if !ok {
			missing = append(missing, key)
		}
	}
	need("legal_name", strings.TrimSpace(strOf(p["legal_name"])) != "")
	need("birth_date", strOf(p["birth_date"]) != "")
	need("phone", validE164(strOf(p["phone"])))
	need("nationality", strings.TrimSpace(strOf(p["nationality"])) != "")
	addr, _ := p["address"].(map[string]any)
	need("address.city", strOf(addr["city"]) != "")
	need("address.country", strOf(addr["country"]) != "")
	em, _ := p["emergency_contact"].(map[string]any)
	need("emergency_contact.name", strOf(em["name"]) != "")
	need("emergency_contact.phone", validE164(strOf(em["phone"])))
	need("id_doc_type", strOf(p["id_doc_type"]) != "")
	need("id_number", p["id_number_saved"] == true)
	need("id_front_file_id", strOf(p["id_front_file_id"]) != "")
	need("id_back_file_id", strOf(p["id_back_file_id"]) != "")
	need("selfie_file_id", strOf(p["selfie_file_id"]) != "")
	if mode == "biker" {
		bike, _ := p["bike"].(map[string]any)
		t := strings.ToLower(strOf(bike["type"]))
		need("bike.type", allowedBikeTypes[t])
		need("bike.photo_file_id", strOf(bike["photo_file_id"]) != "")
		need("bike.no_motor", bike["no_motor"] == true)
	}
	need("bag_liters", intOf(p["bag_liters"]) > 0)
	cons, _ := p["consents"].(map[string]any)
	for _, k := range []string{"terms", "privacy", "location"} {
		c, _ := cons[k].(map[string]any)
		need("consents."+k, strOf(c["version"]) != "" && strOf(c["accepted_at"]) != "")
	}
	return missing
}

func strOf(v any) string {
	s, _ := v.(string)
	return s
}

func intOf(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

// ---------- ID number crypto (demo-grade AES-GCM; KMS in production) ----------

func (s *Server) idKey() [32]byte {
	return sha256.Sum256([]byte("tb-idenc-v1:" + s.cfg.JWTSecret))
}

// encryptID seals an ID number with AES-GCM (base64 nonce+ciphertext).
func (s *Server) encryptID(number string) (string, error) {
	key := s.idKey()
	g, err := cipher.NewGCM(newAES(key[:]))
	if err != nil {
		return "", err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(append(nonce, g.Seal(nil, nonce, []byte(number), nil)...)), nil
}

func newAES(key []byte) cipher.Block {
	b, err := aes.NewCipher(key)
	if err != nil {
		panic(err)
	}
	return b
}

// hashIDNumber normalizes an ID number for duplicate-account detection.
func hashIDNumber(number string) string {
	n := strings.ToLower(strings.TrimSpace(number))
	n = strings.ReplaceAll(n, " ", "")
	n = strings.ReplaceAll(n, "-", "")
	sum := sha256.Sum256([]byte("tb-idhash-v1:" + n))
	return fmt.Sprintf("%x", sum)
}

// ---------- Admin review (approve/reject + sanctions) ----------

// listApplications serves the admin review queue.
func (s *Server) listApplications(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	status := r.URL.Query().Get("status")
	q := `SELECT a.user_id, u.email, a.mode, a.status, a.reject_reason,
		a.fitness_distance_m, a.fitness_moving_s, a.fitness_elapsed_s, a.fitness_passed,
		a.fitness_flags, a.fitness_gap_max_s, a.submitted_at, a.updated_at,
		(SELECT count(*) FROM checkpoint_photos cp JOIN activity_sessions s ON s.id=cp.session_id
			WHERE s.courier_id=a.user_id) AS checkpoints
		FROM courier_applications a JOIN users u ON u.id=a.user_id`
	args := []any{}
	if status != "" {
		q += ` WHERE a.status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY a.updated_at DESC LIMIT 100`
	rows, err := s.db.Query(r.Context(), q, args...)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var uid, email, mode, st, reason string
		var dist float64
		var mov, ela, gap int
		var passed bool
		var flags []byte
		var submitted, updated *time.Time
		var checkpoints int
		if err := rows.Scan(&uid, &email, &mode, &st, &reason, &dist, &mov, &ela, &passed,
			&flags, &gap, &submitted, &updated, &checkpoints); err != nil {
			continue
		}
		var fl []string
		_ = json.Unmarshal(flags, &fl)
		out = append(out, map[string]any{"user_id": uid, "email": email, "mode": mode,
			"status": st, "reject_reason": reason,
			"fitness": map[string]any{"distance_m": dist, "moving_s": mov, "elapsed_s": ela,
				"passed": passed, "flags": fl, "max_gap_s": gap, "checkpoints": checkpoints},
			"submitted_at": tsOrNil(submitted), "updated_at": tsOrNil(updated)})
	}
	writeJSON(w, 200, map[string]any{"applications": out})
}

func tsOrNil(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format("2006-01-02T15:04:05Z07:00")
}

// decideApplication approves or rejects an application in one transaction:
// status write + courier record + email + push queued together.
func (s *Server) decideApplication(w http.ResponseWriter, r *http.Request, approve bool) {
	if !requireRole(w, r, "admin") {
		return
	}
	c := claims(r)
	userID := r.PathValue("user_id")
	var b struct {
		Reason string `json:"reason"`
		Note   string `json:"note"`
	}
	// The approve body is optional; an empty POST must still decide.
	if data, _ := io.ReadAll(r.Body); len(data) > 0 {
		if err := json.Unmarshal(data, &b); err != nil {
			problem(w, 400, "Bad request", "invalid JSON body")
			return
		}
	}
	if !approve && strings.TrimSpace(b.Reason) == "" {
		problem(w, 400, "Validation failed", "a rejection reason is required")
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var st, mode string
	if err := tx.QueryRow(r.Context(), `SELECT status, mode FROM courier_applications WHERE user_id=$1 FOR UPDATE`, userID).Scan(&st, &mode); err != nil {
		problem(w, 404, "Not found", "application not found")
		return
	}
	if st == "approved" && approve {
		_ = tx.Commit(r.Context())
		writeJSON(w, 200, map[string]any{"status": "approved"})
		return
	}
	if st != "pending" && st != "pending_review" && st != "passed_test" && !(approve && st == "testing") {
		problem(w, 409, "Conflict", "application is "+st+"; only pending review can be decided")
		return
	}
	var email string
	_ = tx.QueryRow(r.Context(), `SELECT email FROM users WHERE id=$1`, userID).Scan(&email)
	newStatus := "rejected"
	title, subj, body := "Application update",
		"Your Trackfud courier application",
		fmt.Sprintf("Thanks for applying. This time we could not approve your courier application. Reason: %s. You can apply again in 7 days.", strings.TrimSpace(b.Reason))
	if approve {
		newStatus = "approved"
		body = "Welcome to Trackfud! Your courier application is approved. Start a session and take orders that fit your workout."
		if n := strings.TrimSpace(b.Note); n != "" {
			body += " Note from review: " + n
		}
	}
	if _, err := tx.Exec(r.Context(), `UPDATE courier_applications SET status=$2, reject_reason=$3, updated_at=now() WHERE user_id=$1`,
		userID, newStatus, strings.TrimSpace(b.Reason)); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if approve {
		if _, err := tx.Exec(r.Context(), `INSERT INTO couriers(user_id,mode,status,approved_at,approved_by)
			VALUES($1,$2,'approved',now(),$3) ON CONFLICT (user_id) DO UPDATE SET status='approved',
			approved_at=now(), approved_by=EXCLUDED.approved_by, updated_at=now()`, userID, mode, c.Sub); err != nil {
			problem(w, 500, "Server error", err.Error())
			return
		}
		_, _ = tx.Exec(r.Context(), `INSERT INTO user_roles(user_id,role) VALUES($1,'courier') ON CONFLICT DO NOTHING`, userID)
	} else {
		_, _ = tx.Exec(r.Context(), `UPDATE couriers SET status='rejected', updated_at=now() WHERE user_id=$1`, userID)
	}
	queueApplicantJobs(r.Context(), tx, userID, email, subj, body, title)
	if err := tx.Commit(r.Context()); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	s.hub.Broadcast(userID, fmt.Sprintf(`{"type":"application.status","status":%q}`, newStatus))
	writeJSON(w, 200, map[string]any{"status": newStatus})
}

// queueApplicantJobs enqueues the Brevo/Mailpit email (demo outbox) + push.
func queueApplicantJobs(ctx context.Context, tx pgx.Tx, userID, email, subject, body, title string) {
	if email != "" {
		_, _ = tx.Exec(ctx, `INSERT INTO jobs(kind,payload) VALUES('email_send',$1)`,
			fmt.Sprintf(`{"to":%q,"subject":%q,"body":%q}`, email, subject, body))
	}
	_, _ = tx.Exec(ctx, `INSERT INTO jobs(kind,payload) VALUES('push_send',$1)`,
		fmt.Sprintf(`{"user_id":%q,"title":%q,"body":%q}`, userID, title, body))
}

// listSanctions shows the sanction history of a courier.
func (s *Server) listSanctions(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT id,kind,reason_code,note,starts_at,ends_at,created_by,created_at
		FROM courier_sanctions WHERE courier_id=$1 ORDER BY created_at DESC`, r.PathValue("user_id"))
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, kind, code, note, by string
		var start, created time.Time
		var end *time.Time
		_ = rows.Scan(&id, &kind, &code, &note, &start, &end, &by, &created)
		out = append(out, map[string]any{"id": id, "kind": kind, "reason_code": code, "note": note,
			"starts_at": start.UTC().Format("2006-01-02T15:04:05Z07:00"),
			"ends_at":   tsOrNil(end), "created_by": by,
			"created_at": created.UTC().Format("2006-01-02T15:04:05Z07:00")})
	}
	writeJSON(w, 200, map[string]any{"sanctions": out})
}

// sanctionCourier freezes/unfreezes/bans a courier (human decision only);
// money already earned stays withdrawable (plan 8.4).
func (s *Server) sanctionCourier(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	c := claims(r)
	userID := r.PathValue("user_id")
	var b struct {
		Kind       string `json:"kind"`
		ReasonCode string `json:"reason_code"`
		Note       string `json:"note"`
		EndsAt     string `json:"ends_at"`
	}
	if !decode(w, r, &b) {
		return
	}
	if b.Kind != "freeze" && b.Kind != "unfreeze" && b.Kind != "ban" {
		problem(w, 400, "Validation failed", "kind must be freeze, unfreeze or ban")
		return
	}
	if strings.TrimSpace(b.ReasonCode) == "" {
		problem(w, 400, "Validation failed", "reason_code is required and is audit-logged")
		return
	}
	var endsAt any
	if b.EndsAt != "" {
		t, err := time.Parse(time.RFC3339, b.EndsAt)
		if err != nil {
			problem(w, 400, "Validation failed", "ends_at must be ISO-8601 UTC")
			return
		}
		endsAt = t
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var st string
	if err := tx.QueryRow(r.Context(), `SELECT status FROM couriers WHERE user_id=$1 FOR UPDATE`, userID).Scan(&st); err != nil {
		problem(w, 404, "Not found", "courier not found")
		return
	}
	next := map[string]string{"freeze": "frozen", "unfreeze": "approved", "ban": "banned"}[b.Kind]
	if b.Kind == "freeze" && st != "approved" {
		problem(w, 409, "Conflict", "only an approved courier can be frozen (now "+st+")")
		return
	}
	if b.Kind == "unfreeze" && st != "frozen" {
		problem(w, 409, "Conflict", "only a frozen courier can be unfrozen (now "+st+")")
		return
	}
	if b.Kind == "ban" && st == "banned" {
		problem(w, 409, "Conflict", "courier is already banned")
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE couriers SET status=$2, updated_at=now() WHERE user_id=$1`, userID, next); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO courier_sanctions(courier_id,kind,reason_code,note,ends_at,created_by)
		VALUES($1,$2,$3,$4,$5,$6)`, userID, b.Kind, strings.TrimSpace(b.ReasonCode), strings.TrimSpace(b.Note), endsAt, c.Sub); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	var email string
	_ = tx.QueryRow(r.Context(), `SELECT email FROM users WHERE id=$1`, userID).Scan(&email)
	msg := map[string]string{
		"freeze":   "Your courier account is temporarily frozen: " + b.ReasonCode + ". Money you earned stays withdrawable.",
		"unfreeze": "Your courier account is active again. Thanks for your patience.",
		"ban":      "Your courier account is permanently closed: " + b.ReasonCode + ". Money you earned stays withdrawable unless on fraud hold.",
	}[b.Kind]
	queueApplicantJobs(r.Context(), tx, userID, email, "Your Trackfud courier account", msg, "Account update")
	if err := tx.Commit(r.Context()); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	s.hub.Broadcast(userID, fmt.Sprintf(`{"type":"courier.status","status":%q}`, next))
	writeJSON(w, 200, map[string]any{"status": next})
}
