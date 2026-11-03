// Admin review endpoints for the CMS back office (AGENTS.md task):
// courier application detail plus merchant list/detail/approve/reject.
// All handlers are admin-only via requireRole; login reuses POST
// /v1/auth/login (email contains @, password min 8 — see auth.go).
package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// reviewStatuses is the allowlist for admin status filters and decisions.
// pending/approved/rejected are review states; frozen/banned are operational
// standing (couriers table / merchants.status). Unknown values are rejected
// (400) so they can never reach SQL.
var reviewStatuses = map[string]bool{
	"pending": true, "approved": true, "rejected": true,
	"frozen": true, "banned": true,
}

// parseReviewStatus validates an admin ?status= filter. Empty means "all".
func parseReviewStatus(v string) (string, bool) {
	v = strings.TrimSpace(strings.ToLower(v))
	if v == "" {
		return "", true
	}
	if reviewStatuses[v] {
		return v, true
	}
	return "", false
}

// parseAdminLimit clamps an admin ?limit= filter to 1..100 (default 50).
func parseAdminLimit(v string) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 1 {
		if strings.TrimSpace(v) == "" {
			return 50
		}
		return 50
	}
	if n > 100 {
		return 100
	}
	return n
}

// decisionInput is the approve/reject body shared by courier and merchant
// review. Reject requires a reason; approve accepts an optional note.
type decisionInput struct {
	Reason string `json:"reason"`
	Note   string `json:"note"`
}

// parseDecisionBody decodes an optional decision body: an empty POST is
// valid for approvals. It returns the trimmed reason/note or a validation
// message when the body is malformed or a rejection lacks a reason.
func parseDecisionBody(data []byte, approve bool) (reason, note, errMsg string) {
	var b decisionInput
	if len(data) > 0 {
		if err := json.Unmarshal(data, &b); err != nil {
			return "", "", "invalid JSON body"
		}
	}
	reason = strings.TrimSpace(b.Reason)
	note = strings.TrimSpace(b.Note)
	if !approve && reason == "" {
		return "", "", "a rejection reason is required"
	}
	return reason, note, ""
}

// merchantDecision maps (current status, approve?) to the next status.
// Only pending merchants can be decided; approving an already-approved
// merchant is idempotent ("same"); anything else is a conflict message.
func merchantDecision(current string, approve bool) (next string, verdict string) {
	if approve && current == "approved" {
		return "approved", "same"
	}
	if current != "pending" {
		return "", fmt.Sprintf("merchant is %s; only pending merchants can be decided", current)
	}
	if approve {
		return "approved", "ok"
	}
	return "rejected", "ok"
}

// ---------- Courier application detail ----------

// getApplicationDetail serves one courier application with the applicant's
// saved profile (personal info + document file references) for admin review.
// The encrypted ID number is never returned — only id_number_saved.
func (s *Server) getApplicationDetail(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	userID := r.PathValue("user_id")
	if strings.TrimSpace(userID) == "" {
		problem(w, 400, "Validation failed", "user_id is required")
		return
	}
	var email, mode, st, reason string
	var dist float64
	var mov, ela, gap int
	var passed bool
	var flags []byte
	var submittedAt, updatedAt *time.Time
	var standing string
	err := s.db.QueryRow(r.Context(), `SELECT a.user_id, u.email, a.mode, a.status,
		a.reject_reason, a.fitness_distance_m, a.fitness_moving_s, a.fitness_elapsed_s,
		a.fitness_passed, a.fitness_flags, a.fitness_gap_max_s,
		a.submitted_at, a.updated_at,
		COALESCE((SELECT status FROM couriers WHERE user_id=a.user_id),'')
		FROM courier_applications a JOIN users u ON u.id=a.user_id
		WHERE a.user_id=$1`, userID).Scan(&userID, &email, &mode, &st, &reason,
		&dist, &mov, &ela, &passed, &flags, &gap, &submittedAt, &updatedAt, &standing)
	if err != nil {
		problem(w, 404, "Not found", "application not found")
		return
	}
	var fl []string
	_ = json.Unmarshal(flags, &fl)
	profile, _ := s.loadProfile(r.Context(), userID)
	if profile == nil {
		profile = map[string]any{}
	}
	var checkpoints int
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM checkpoint_photos cp
		JOIN activity_sessions s ON s.id=cp.session_id WHERE s.courier_id=$1`, userID).Scan(&checkpoints)
	// Checkpoint evidence: file IDs the review team can open (private files,
	// admin role may read them via GET /v1/files/{id}/content).
	checkpointFiles := []string{}
	if rows, err := s.db.Query(r.Context(), `SELECT cp.file_id FROM checkpoint_photos cp
		JOIN activity_sessions s ON s.id=cp.session_id WHERE s.courier_id=$1
		ORDER BY cp.taken_at DESC, cp.created_at DESC LIMIT 12`); err == nil {
		defer rows.Close()
		for rows.Next() {
			var fid string
			if err := rows.Scan(&fid); err == nil && fid != "" {
				checkpointFiles = append(checkpointFiles, fid)
			}
		}
	}
	writeJSON(w, 200, map[string]any{
		"user_id": userID, "email": email, "mode": mode,
		"status": st, "standing": standing, "reject_reason": reason,
		"submitted_at": tsOrNil(submittedAt), "updated_at": tsOrNil(updatedAt),
		"fitness": map[string]any{"distance_m": dist, "moving_s": mov, "elapsed_s": ela,
			"passed": passed, "flags": fl, "max_gap_s": gap, "checkpoints": checkpoints,
			"checkpoint_file_ids": checkpointFiles},
		"profile": profile,
	})
}

// ---------- Merchant review ----------

// listMerchants serves the admin merchant review queue with an optional
// ?status=pending|approved|rejected filter, free-text ?q= (name, owner email)
// and scroll pagination (?page=, ?per_page= default 10, legacy ?limit= alias).
func (s *Server) listMerchants(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	status, ok := parseReviewStatus(r.URL.Query().Get("status"))
	if !ok {
		problem(w, 400, "Validation failed", "status must be pending, approved, rejected, frozen or banned")
		return
	}
	pg := parsePagination(r.URL.Query())
	pattern, filtered, errMsg := parseSearch(r.URL.Query().Get("q"))
	if errMsg != "" {
		problem(w, 400, "Validation failed", errMsg)
		return
	}
	from := `FROM merchants m JOIN users u ON u.id=m.owner_id`
	args := []any{}
	var where strings.Builder
	if status != "" {
		args = append(args, status)
		where.WriteString(` WHERE m.status=$` + strconv.Itoa(len(args)))
	}
	if filtered {
		if len(args) == 0 {
			where.WriteString(` WHERE `)
		} else {
			where.WriteString(` AND `)
		}
		args = append(args, pattern)
		ph := `$` + strconv.Itoa(len(args))
		where.WriteString(ilikeAny(ph, "m.name", "u.email"))
	}
	var total int
	if err := s.db.QueryRow(r.Context(), `SELECT COUNT(*) `+from+where.String(), args...).Scan(&total); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	pargs := append(append([]any{}, args...), pg.limit, pg.offset)
	q := `SELECT m.id, m.owner_id, u.email, m.name, m.phone, m.country, m.currency,
		m.timezone, m.address, m.status, m.prep_minutes, m.reject_reason,
		COALESCE(ST_Y(m.location::geometry),0), COALESCE(ST_X(m.location::geometry),0),
		m.created_at, m.updated_at
		` + from + where.String() +
		` ORDER BY m.created_at DESC LIMIT $` + strconv.Itoa(len(pargs)-1) + ` OFFSET $` + strconv.Itoa(len(pargs))
	rows, err := s.db.Query(r.Context(), q, pargs...)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, owner, email, name, phone, country, cur, tz, addr, st, reason string
		var prep int
		var lat, lng float64
		var created, updated time.Time
		if err := rows.Scan(&id, &owner, &email, &name, &phone, &country, &cur,
			&tz, &addr, &st, &prep, &reason, &lat, &lng, &created, &updated); err != nil {
			continue
		}
		out = append(out, map[string]any{"id": id, "owner_id": owner, "email": email,
			"name": name, "phone": phone, "country": country, "currency": cur,
			"timezone": tz, "address": addr, "status": st, "prep_minutes": prep,
			"reject_reason": reason, "lat": lat, "lng": lng,
			"created_at": created.UTC().Format("2006-01-02T15:04:05Z07:00"),
			"updated_at": updated.UTC().Format("2006-01-02T15:04:05Z07:00")})
	}
	writePaginatedList(w, "merchants", out, pg.page, pg.perPage, total)
}

// getMerchantDetail serves one merchant with owner, agreement and staff
// info for admin review. Rejected merchants include reject_reason +
// updated_at so the CMS can show "why + when" without a second call.
func (s *Server) getMerchantDetail(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	id := r.PathValue("id")
	if strings.TrimSpace(id) == "" {
		problem(w, 400, "Validation failed", "merchant id is required")
		return
	}
	var owner, email, name, phone, country, cur, tz, addr, note, st, reason string
	var prep int
	var hours []byte
	var lat, lng float64
	var created, updated time.Time
	err := s.db.QueryRow(r.Context(), `SELECT m.id, m.owner_id, u.email, m.name, m.phone,
		m.country, m.currency, m.timezone, m.address, m.pickup_note, m.status,
		m.prep_minutes, m.opening_hours, m.created_at, m.updated_at, m.reject_reason,
		COALESCE(ST_Y(m.location::geometry),0), COALESCE(ST_X(m.location::geometry),0)
		FROM merchants m JOIN users u ON u.id=m.owner_id WHERE m.id=$1`, id).Scan(
		&id, &owner, &email, &name, &phone, &country, &cur, &tz, &addr, &note,
		&st, &prep, &hours, &created, &updated, &reason, &lat, &lng)
	if err != nil {
		problem(w, 404, "Not found", "merchant not found")
		return
	}
	var h map[string]any
	_ = json.Unmarshal(hours, &h)
	var agreeVersion, signer string
	var agreed bool
	var agreeText, agreeSha string
	var signedAt *time.Time
	_ = s.db.QueryRow(r.Context(), `SELECT version, signer_name, agreed, signed_at,
		text_snapshot, sha256
		FROM merchant_agreements WHERE merchant_id=$1 ORDER BY signed_at DESC LIMIT 1`,
		id).Scan(&agreeVersion, &signer, &agreed, &signedAt, &agreeText, &agreeSha)
	staffRows, err := s.db.Query(r.Context(), `SELECT id, email, role, can_deliver, on_shift, status
		FROM merchant_staff WHERE merchant_id=$1 ORDER BY created_at`, id)
	staff := []map[string]any{}
	if err == nil {
		defer staffRows.Close()
		for staffRows.Next() {
			var sid, semail, srole, sst string
			var cd, os bool
			_ = staffRows.Scan(&sid, &semail, &srole, &cd, &os, &sst)
			staff = append(staff, map[string]any{"id": sid, "email": semail,
				"role": srole, "can_deliver": cd, "on_shift": os, "status": sst})
		}
	}
	agreement := map[string]any{"signed": agreed}
	if agreed || signer != "" {
		agreement = map[string]any{"version": agreeVersion, "signer_name": signer,
			"agreed": agreed, "signed_at": tsOrNil(signedAt),
			"text": agreeText, "sha256": agreeSha}
	}
	writeJSON(w, 200, map[string]any{"merchant": map[string]any{
		"id": id, "owner_id": owner, "email": email, "name": name, "phone": phone,
		"country": country, "currency": cur, "timezone": tz, "address": addr,
		"pickup_note": note, "status": st, "prep_minutes": prep,
		"reject_reason": reason, "opening_hours": h, "lat": lat, "lng": lng,
		"created_at": created.UTC().Format("2006-01-02T15:04:05Z07:00"),
		"updated_at": updated.UTC().Format("2006-01-02T15:04:05Z07:00"),
		"agreement":  agreement, "staff": staff}})
}

// decideMerchant approves or rejects a pending merchant in one transaction:
// status write + merchant role grant + email + push queued together,
// mirroring decideApplication for couriers.
func (s *Server) decideMerchant(w http.ResponseWriter, r *http.Request, approve bool) {
	if !requireRole(w, r, "admin") {
		return
	}
	id := r.PathValue("id")
	if strings.TrimSpace(id) == "" {
		problem(w, 400, "Validation failed", "merchant id is required")
		return
	}
	// The approve body is optional; an empty POST must still decide.
	data, _ := io.ReadAll(r.Body)
	reason, note, msg := parseDecisionBody(data, approve)
	if msg != "" {
		problem(w, 400, "Validation failed", msg)
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var st, ownerID, name string
	if err := tx.QueryRow(r.Context(), `SELECT status, owner_id, name FROM merchants WHERE id=$1 FOR UPDATE`,
		id).Scan(&st, &ownerID, &name); err != nil {
		problem(w, 404, "Not found", "merchant not found")
		return
	}
	next, verdict := merchantDecision(st, approve)
	if verdict == "same" {
		_ = tx.Commit(r.Context())
		writeJSON(w, 200, map[string]any{"id": id, "status": "approved"})
		return
	}
	if verdict != "ok" {
		problem(w, 409, "Conflict", verdict)
		return
	}
	var email string
	_ = tx.QueryRow(r.Context(), `SELECT email FROM users WHERE id=$1`, ownerID).Scan(&email)
	subj := "Your Trackfud merchant application"
	body := fmt.Sprintf("Thanks for applying with %q. This time we could not approve your merchant application. Reason: %s. You can update your store profile and apply again.", name, reason)
	title := "Application update"
	if approve {
		body = fmt.Sprintf("Welcome to Trackfud! %q is approved and LIVE. Customers can now find your store.", name)
		if note != "" {
			body += " Note from review: " + note
		}
	}
	// Persist the decision reason + touch updated_at so the CMS detail can
	// show "why + when" for rejected merchants (approved clears the reason).
	if _, err := tx.Exec(r.Context(), `UPDATE merchants SET status=$2, reject_reason=$3, updated_at=now() WHERE id=$1`, id, next, reason); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if approve {
		_, _ = tx.Exec(r.Context(), `INSERT INTO user_roles(user_id,role) VALUES($1,'merchant') ON CONFLICT DO NOTHING`, ownerID)
	}
	s.queueApplicantJobs(r.Context(), tx, ownerID, email, subj, body, title)
	if err := tx.Commit(r.Context()); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	s.hub.Broadcast(ownerID, fmt.Sprintf(`{"type":"merchant.status","status":%q}`, next))
	decideAction := "merchant.reject"
	if approve {
		decideAction = "merchant.approve"
	}
	s.writeAudit(r.Context(), r, decideAction, "merchant", id, reason,
		map[string]any{"status": st}, map[string]any{"status": next, "note": note})
	writeJSON(w, 200, map[string]any{"id": id, "status": next})
}

// merchantSanctionDecision maps (current status, kind) to the next status.
// Ban is allowed from pending/approved/rejected; unban restores the status
// recorded at ban time. Anything else is a conflict message.
func merchantSanctionDecision(current, kind, restore string) (next string, errMsg string) {
	if kind == "ban" {
		switch current {
		case "pending", "approved", "rejected":
			return "banned", ""
		case "banned":
			return "", "merchant is already banned"
		default:
			return "", "merchant is " + current + "; only submitted merchants can be banned"
		}
	}
	if kind == "unban" {
		if current != "banned" {
			return "", "merchant is " + current + "; only banned merchants can be unbanned"
		}
		switch restore {
		case "pending", "approved", "rejected":
			return restore, ""
		default:
			return "", "no prior status recorded for this ban"
		}
	}
	return "", "kind must be ban or unban"
}

// listMerchantSanctions shows the ban/unban history of a merchant.
func (s *Server) listMerchantSanctions(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT id,kind,reason,note,prev_status,created_by,created_at
		FROM merchant_sanctions WHERE merchant_id=$1 ORDER BY created_at DESC`, r.PathValue("id"))
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, kind, reason, note, prev, by string
		var created time.Time
		_ = rows.Scan(&id, &kind, &reason, &note, &prev, &by, &created)
		out = append(out, map[string]any{"id": id, "kind": kind, "reason": reason,
			"note": note, "prev_status": prev, "created_by": by,
			"created_at": created.UTC().Format("2006-01-02T15:04:05Z07:00")})
	}
	writeJSON(w, 200, map[string]any{"sanctions": out})
}

// sanctionMerchant bans or unbans a merchant (human decision only).
// A ban stores the pre-ban status so unban restores it; customers stop
// seeing the store while it is banned.
func (s *Server) sanctionMerchant(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	c := claims(r)
	id := r.PathValue("id")
	var b struct {
		Kind   string `json:"kind"`
		Reason string `json:"reason"`
		Note   string `json:"note"`
	}
	if !decode(w, r, &b) {
		return
	}
	b.Kind = strings.TrimSpace(b.Kind)
	b.Reason = strings.TrimSpace(b.Reason)
	if b.Kind == "ban" && b.Reason == "" {
		problem(w, 400, "Validation failed", "a ban reason is required and is audit-logged")
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var st, ownerID, name string
	if err := tx.QueryRow(r.Context(), `SELECT status, owner_id, name FROM merchants WHERE id=$1 FOR UPDATE`,
		id).Scan(&st, &ownerID, &name); err != nil {
		problem(w, 404, "Not found", "merchant not found")
		return
	}
	var restore string
	if b.Kind == "unban" {
		_ = tx.QueryRow(r.Context(), `SELECT prev_status FROM merchant_sanctions
			WHERE merchant_id=$1 AND kind='ban' ORDER BY created_at DESC LIMIT 1`, id).Scan(&restore)
	}
	next, msg := merchantSanctionDecision(st, b.Kind, restore)
	if msg != "" {
		problem(w, 409, "Conflict", msg)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE merchants SET status=$2, updated_at=now() WHERE id=$1`, id, next); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO merchant_sanctions(merchant_id,kind,reason,note,prev_status,created_by)
		VALUES($1,$2,$3,$4,$5,$6)`, id, b.Kind, b.Reason, strings.TrimSpace(b.Note), st, c.Sub); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	var email string
	_ = tx.QueryRow(r.Context(), `SELECT email FROM users WHERE id=$1`, ownerID).Scan(&email)
	subj := "Your Trackfud merchant account"
	body := fmt.Sprintf("Thanks for partnering with %q. This time we had to close your merchant account. Reason: %s. Reply to this email to appeal.", name, b.Reason)
	if b.Kind == "unban" {
		body = fmt.Sprintf("Good news: %q is live again. Customers can now find your store.", name)
	}
	s.queueApplicantJobs(r.Context(), tx, ownerID, email, subj, body, "Account update")
	if err := tx.Commit(r.Context()); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	s.hub.Broadcast(ownerID, fmt.Sprintf(`{"type":"merchant.status","status":%q}`, next))
	s.writeAudit(r.Context(), r, "merchant."+b.Kind, "merchant", id, strings.TrimSpace(b.Reason),
		map[string]any{"status": st}, map[string]any{"status": next, "note": strings.TrimSpace(b.Note)})
	writeJSON(w, 200, map[string]any{"id": id, "status": next})
}
