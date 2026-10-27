package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"Trackfud/internal/ai"
	"Trackfud/internal/authjwt"

	"github.com/gorilla/websocket"
)

// ---------- B6 AI HTTP: import jobs, trust brief, proof, translate, coach ----------

func (s *Server) merchantIDOf(ctx context.Context, ownerID string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `SELECT id FROM merchants WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1`, ownerID).Scan(&id)
	return id, err
}

// createImportJob starts Snap-a-Menu: photo in, drafts out for review.
// Drafts never carry prices; the merchant types every price (needs_price).
func (s *Server) createImportJob(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	if !requireRole(w, r, "merchant", "admin") {
		return
	}
	var b struct {
		FileID string `json:"file_id"`
	}
	if !decode(w, r, &b) {
		return
	}
	if b.FileID == "" {
		problem(w, 400, "Validation failed", "file_id is required")
		return
	}
	mid, err := s.merchantIDOf(r.Context(), c.Sub)
	if err != nil {
		problem(w, 404, "Not found", "create your restaurant first")
		return
	}
	var owner string
	if err := s.db.QueryRow(r.Context(), `SELECT owner_id FROM files WHERE id=$1 AND status='ready'`, b.FileID).Scan(&owner); err != nil || (owner != c.Sub && !isAdmin(c)) {
		problem(w, 404, "Not found", "photo not found")
		return
	}
	var id string
	if err := s.db.QueryRow(r.Context(), `INSERT INTO menu_import_jobs(merchant_id,file_id,status,progress)
		VALUES($1,$2,'queued',5) RETURNING id`, mid, b.FileID).Scan(&id); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	s.enqueueNow(AIJobMenuImport, fmt.Sprintf(`{"import_job_id":%q}`, id), time.Now())
	s.serveImportJob(w, r, id)
}

// isAdmin reports the admin role from JWT claims (same source as requireRole).
func isAdmin(c *authjwt.Claims) bool {
	for _, r := range c.Roles {
		if r == "admin" {
			return true
		}
	}
	return false
}

func (s *Server) getImportJob(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	if !requireRole(w, r, "merchant", "admin") {
		return
	}
	id := r.PathValue("id")
	var mid string
	_ = s.db.QueryRow(r.Context(), `SELECT merchant_id FROM menu_import_jobs WHERE id=$1`, id).Scan(&mid)
	if mid == "" {
		problem(w, 404, "Not found", "import job not found")
		return
	}
	if mine, _ := s.merchantIDOf(r.Context(), c.Sub); mid != mine && !isAdmin(c) {
		problem(w, 403, "Forbidden", "not your import job")
		return
	}
	s.serveImportJob(w, r, id)
}

// serveImportJob renders the poll shape the merchant PWA swaps against:
// {id,status,progress,drafts,error,prices_checked,...}.
func (s *Server) serveImportJob(w http.ResponseWriter, r *http.Request, id string) {
	var mid, fileID, status, errText string
	var progress int
	var drafts json.RawMessage
	var checked bool
	var created, updated time.Time
	if err := s.db.QueryRow(r.Context(), `SELECT merchant_id, file_id, status, progress,
		drafts, error, prices_checked, created_at, updated_at FROM menu_import_jobs WHERE id=$1`, id).
		Scan(&mid, &fileID, &status, &progress, &drafts, &errText, &checked, &created, &updated); err != nil {
		problem(w, 404, "Not found", "import job not found")
		return
	}
	writeJSON(w, 200, map[string]any{
		"id": id, "status": status, "progress": progress,
		"photo_url": fmt.Sprintf("/api/v1/files/%s/content", fileID),
		"drafts":    json.RawMessage(orEmptyArray(drafts)), "error": errText,
		"prices_checked": checked,
		"created_at":     created.UTC().Format(time.RFC3339),
		"updated_at":     updated.UTC().Format(time.RFC3339),
	})
}

func orEmptyArray(b json.RawMessage) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("[]")
	}
	return b
}

// getTrustBrief serves the advisory brief to admins. Advisory only: approve
// and reject stay human decisions in decideApplication.
func (s *Server) getTrustBrief(w http.ResponseWriter, r *http.Request) {
	if !requireRole(w, r, "admin") {
		return
	}
	userID := r.PathValue("user_id")
	var risk, summary, photoNote string
	var advisory, fallback bool
	var reasons json.RawMessage
	var at time.Time
	err := s.db.QueryRow(r.Context(), `SELECT risk, advisory, summary, reasons, photo_note, fallback, created_at
		FROM trust_briefs WHERE user_id=$1`, userID).Scan(&risk, &advisory, &summary, &reasons, &photoNote, &fallback, &at)
	if err != nil {
		// No brief yet (worker pending): enqueue one and say so honestly.
		s.enqueueNow(AIJobTrustBrief, fmt.Sprintf(`{"user_id":%q}`, userID), time.Now())
		writeJSON(w, 200, map[string]any{"pending": true, "advisory": true})
		return
	}
	writeJSON(w, 200, map[string]any{
		"user_id": userID, "risk": risk, "advisory": advisory,
		"summary": summary, "reasons": orEmptyArray(reasons),
		"photo_note": photoNote, "fallback": fallback,
		"created_at": at.UTC().Format(time.RFC3339),
	})
}

// postProofCheck enqueues a delivery-photo check for a courier-owned delivery.
func (s *Server) postProofCheck(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	d, err := s.loadDelivery(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "delivery not found")
		return
	}
	if d.CourierID == nil || *d.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your delivery")
		return
	}
	var b struct {
		FileID string `json:"file_id"`
	}
	if !decode(w, r, &b) || b.FileID == "" {
		problem(w, 400, "Validation failed", "file_id is required")
		return
	}
	s.enqueueNow(AIJobProofCheck, fmt.Sprintf(`{"delivery_id":%q,"file_id":%q}`, d.ID, b.FileID), time.Now())
	writeJSON(w, 202, map[string]any{"queued": true})
}

// listProofChecks returns recorded verdicts (humans review unclear ones).
func (s *Server) listProofChecks(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	d, err := s.loadDelivery(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "delivery not found")
		return
	}
	if (d.CourierID == nil || *d.CourierID != c.Sub) && !isAdmin(c) {
		problem(w, 403, "Forbidden", "not your delivery")
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT file_id, verdict, note, fallback, created_at
		FROM proof_checks WHERE delivery_id=$1 ORDER BY created_at`, d.ID)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var fileID, verdict, note string
		var fallback bool
		var at time.Time
		if err := rows.Scan(&fileID, &verdict, &note, &fallback, &at); err != nil {
			continue
		}
		out = append(out, map[string]any{"file_id": fileID, "verdict": verdict,
			"note": note, "fallback": fallback, "created_at": at.UTC().Format(time.RFC3339)})
	}
	writeJSON(w, 200, map[string]any{"checks": out})
}

// ---------- translated chat + moderation ----------

// translateCustomerMessage / translateCourierMessage back the C3/R3 chat swap
// points: synchronous translate+moderate of one stored message.
func (s *Server) translateCustomerMessage(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	o, err := s.loadOrder(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "order not found")
		return
	}
	if o.CustomerID != c.Sub {
		problem(w, 403, "Forbidden", "not your order")
		return
	}
	s.translateMessage(w, r, o.ID)
}

func (s *Server) translateCourierMessage(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	d, err := s.loadDelivery(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "delivery not found")
		return
	}
	if d.CourierID == nil || *d.CourierID != c.Sub {
		problem(w, 403, "Forbidden", "not your delivery")
		return
	}
	s.translateMessage(w, r, d.OrderID)
}

func (s *Server) translateMessage(w http.ResponseWriter, r *http.Request, orderID string) {
	var b struct {
		MessageID string `json:"message_id"`
		To        string `json:"to"`
	}
	if !decode(w, r, &b) || b.MessageID == "" {
		problem(w, 400, "Validation failed", "message_id is required")
		return
	}
	if b.To != "en" && b.To != "id" && b.To != "ms" {
		b.To = "en"
	}
	var body, lang, translated string
	var moderated, flagged bool
	err := s.db.QueryRow(r.Context(), `SELECT body, lang, translated_body, moderated, flagged
		FROM order_messages WHERE id=$1 AND order_id=$2`, b.MessageID, orderID).
		Scan(&body, &lang, &translated, &moderated, &flagged)
	if err != nil {
		problem(w, 404, "Not found", "message not found")
		return
	}
	src := lang
	if src == "" {
		src = ai.DetectLang(body)
	}
	if src == b.To {
		writeJSON(w, 200, map[string]any{"translated_body": body, "moderated": true, "flagged": false, "live": false})
		return
	}
	out := translated
	live := false
	if out == "" || !moderated {
		flagged = ai.FallbackModerate(body)
		if s.ai.cli.HasKey() {
			ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
			defer cancel()
			if raw, err := s.ai.cli.ChatJSON(ctx, "chat_translate", ai.PromptTranslateV1, s.ai.cli.SparkModel(),
				ai.TranslateSystemV1, "Translate from "+src+" to "+b.To+": "+body, "translation", ai.TranslateSchema(), s.aiLog); err == nil {
				if parsed, verr := ai.ParseTranslateOutput(raw); verr == nil {
					out, flagged, live = parsed.Text, flagged || parsed.FlagAbusive, true
				}
			}
		}
		if out == "" {
			if hit, ok := ai.FallbackTranslate(body, src, b.To); ok {
				out = hit
			} else {
				out = body
			}
			s.logAICall(r.Context(), ai.CallRecord{Feature: "chat_translate", Model: s.ai.cli.SparkModel(), PromptVersion: ai.PromptTranslateV1, Fallback: true})
		}
		_, _ = s.db.Exec(r.Context(), `UPDATE order_messages SET translated_body=$2, moderated=true, flagged=$3 WHERE id=$1`, b.MessageID, out, flagged)
	}
	writeJSON(w, 200, map[string]any{"translated_body": out, "moderated": true, "flagged": flagged, "live": live})
}

// ---------- AI Coach weekly report ----------

// coachWeekly returns the input-data endpoint: measured stats plus a gentle
// plan text, always labeled not-medical-advice.
func (s *Server) coachWeekly(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var dist float64
	var activeS int64
	var sessions, deliveries int
	_ = s.db.QueryRow(r.Context(), `SELECT COALESCE(sum(distance_m),0), COALESCE(sum(active_s),0), count(*)
		FROM activity_sessions WHERE courier_id=$1 AND started_at>now()-interval '7 days'`, c.Sub).Scan(&dist, &activeS, &sessions)
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM deliveries
		WHERE courier_id=$1 AND status='delivered' AND delivered_at>now()-interval '7 days'`, c.Sub).Scan(&deliveries)
	var earned int64
	var currency string
	_ = s.db.QueryRow(r.Context(), `SELECT COALESCE(sum(p.amount_minor),0), a.currency FROM postings p
		JOIN ledger_accounts a ON a.id=p.account_id
		JOIN journal_entries e ON e.id=p.entry_id
		WHERE a.owner_type='courier' AND a.owner_id=$1 AND a.kind='courier_earnings'
		AND p.amount_minor>0 AND e.created_at>now()-interval '7 days'
		GROUP BY a.currency ORDER BY 1 DESC LIMIT 1`, c.Sub).Scan(&earned, &currency)
	if currency == "" {
		currency = "IDR"
	}
	activeMin := int(activeS / 60)
	goal := s.cfg.Health.WhoWeeklyActiveMin
	rep := ai.FallbackCoach(dist, activeMin, goal, earned, currency)
	live := false
	if s.ai.cli.HasKey() {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		user := fmt.Sprintf("distance_m: %.0f; active_min: %d; who_goal_min: %d; sessions: %d; deliveries: %d",
			dist, activeMin, goal, sessions, deliveries)
		if raw, err := s.ai.cli.ChatJSON(ctx, "coach_report", ai.PromptCoachV1, s.ai.cli.SparkModel(),
			ai.CoachSystemV1, user, "coach", ai.CoachSchema(), s.aiLog); err == nil {
			if parsed, verr := ai.ParseCoachReport(raw); verr == nil {
				rep, live = parsed, true
			}
		}
	} else {
		s.logAICall(r.Context(), ai.CallRecord{Feature: "coach_report", Model: s.ai.cli.SparkModel(), PromptVersion: ai.PromptCoachV1, Fallback: true})
	}
	writeJSON(w, 200, map[string]any{
		"distance_m": dist, "active_s": activeS, "active_min": activeMin,
		"who_goal_min": goal, "sessions": sessions, "deliveries": deliveries,
		"earned":       map[string]any{"amount_minor": earned, "currency": currency},
		"headline":     rep.Headline,
		"body":         rep.Body,
		"next_plan":    rep.NextPlan,
		"advice_label": "not medical advice",
		"live":         live,
	})
}

// ---------- Voice Copilot relay ----------
//
// Endpoint: GET /v1/courier/voice?ticket=... (same ws_tickets as /v1/ws).
// The courier PWA streams 24 kHz Int16 mono PCM as binary WS frames (see
// VOICE_WS_PATH) plus JSON transcript frames from its on-device recognizer
// or typed box:
//
//	{"type":"voice.transcript","text":"...","lang":"id"}
//	{"type":"voice.end"}
//
// Replies are JSON: {"type":"voice.intent","intent","reply_text",
// "offer_id","confirmation","live"}. Accept proposals carry a signed
// confirmation; POST /v1/courier/voice/confirm executes after server checks.

func (s *Server) voiceConnect(w http.ResponseWriter, r *http.Request) {
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
	defer conn.Close()
	_ = conn.WriteJSON(map[string]any{"type": "voice.hello", "live": s.ai.cli.HasKey(), "sample_rate": 24000, "format": "int16-mono"})
	var pcm []byte
	var gotTranscript bool
	for {
		mt, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		if mt == websocket.BinaryMessage {
			pcm = ai.DrainPCM(pcm, msg)
			continue
		}
		var f map[string]any
		if json.Unmarshal(msg, &f) != nil {
			continue
		}
		switch f["type"] {
		case "ping":
			_ = conn.WriteJSON(map[string]any{"type": "pong"})
		case "voice.transcript":
			text, _ := f["text"].(string)
			lang, _ := f["lang"].(string)
			if lang == "" {
				lang = ai.DetectLang(text)
			}
			gotTranscript = true
			s.voiceRespond(conn, userID, text, lang)
		case "voice.end":
			// PCM-only turn: transcribe when a key exists, else report bytes
			// honestly and ask for the typed fallback.
			if gotTranscript || len(pcm) == 0 {
				pcm = nil
				gotTranscript = false
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
			text, rec, terr := s.ai.transcriber.Transcribe(ctx, pcm, "id")
			cancel()
			s.logAICall(context.Background(), rec)
			pcm = nil
			if terr != nil {
				_ = conn.WriteJSON(map[string]any{"type": "voice.intent", "intent": "unknown",
					"reply_text":    "I couldn't hear that — type it or try again.",
					"reply_text_id": "Maaf, tidak terdengar — ketik atau coba lagi.",
					"live":          false})
				continue
			}
			s.voiceRespond(conn, userID, text, ai.DetectLang(text))
		}
	}
}

// voiceRespond runs one transcript through intent → reply → (proposal).
func (s *Server) voiceRespond(conn interface {
	WriteJSON(v any) error
}, courierID, text, lang string,
) {
	ctx := context.Background()
	intent := ai.IntentUnknown
	live := false
	if s.ai.cli.HasKey() {
		tctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		user := "transcript: " + text
		reply, calls, err := s.ai.cli.ChatTools(tctx, "voice_copilot", ai.PromptVoiceV1, s.ai.cli.SparkModel(),
			ai.VoiceSystemV1, user, ai.ToolDefs(), s.aiLog)
		cancel()
		_ = reply
		if err == nil && len(calls) > 0 {
			if _, perr := ai.ParseToolCall(calls[0]); perr == nil {
				intent = ai.IntentForTool(calls[0].Name)
				live = true
			}
		}
		if err != nil {
			intent = ai.ParseVoiceCommand(text) // deterministic fallback
		}
	} else {
		intent = ai.ParseVoiceCommand(text)
		s.logAICall(ctx, ai.CallRecord{Feature: "voice_copilot", Model: s.ai.cli.SparkModel(), PromptVersion: ai.PromptVoiceV1, Fallback: true})
	}
	offer := s.pendingOfferFor(ctx, courierID)
	rctx := ai.ReplyCtx{}
	var offerID string
	if offer != nil {
		offerID = offer.ID
		rctx.MerchantName = offer.MerchantName
		rctx.EtaText = offer.EtaText
		rctx.LastOfferText = offer.OfferText
	}
	resp := map[string]any{"type": "voice.intent", "transcript": text, "lang": lang,
		"intent": string(intent), "live": live}
	switch intent {
	case ai.IntentAccept:
		if offer == nil {
			resp["reply_text"] = ai.VoiceReply(ai.IntentRepeat, lang, rctx)
			break
		}
		exp := time.Now().Add(ai.ConfirmationTTL).Unix()
		resp["offer_id"] = offerID
		resp["confirmation"] = ai.SignConfirmation([]byte(s.cfg.JWTSecret), courierID, offerID, string(ai.IntentAccept), exp)
		resp["reply_text"] = ai.VoiceReply(ai.IntentAccept, lang, rctx)
	case ai.IntentDecline:
		if offer != nil {
			_, _ = s.db.Exec(ctx, `UPDATE dispatch_offers SET status='declined', responded_at=now()
				WHERE id=$1 AND status='pending'`, offer.ID)
			s.runCascade(ctx, offer.DeliveryID)
		}
		resp["reply_text"] = ai.VoiceReply(ai.IntentDecline, lang, rctx)
	case ai.IntentEtaSoon:
		s.voiceEtaSoon(ctx, courierID)
		resp["reply_text"] = ai.VoiceReply(ai.IntentEtaSoon, lang, rctx)
	default:
		resp["reply_text"] = ai.VoiceReply(intent, lang, rctx)
	}
	_ = conn.WriteJSON(resp)
}

type pendingOffer struct {
	ID           string
	DeliveryID   string
	MerchantName string
	EtaText      string
	OfferText    string
}

// pendingOfferFor loads the courier's latest live offer with reply context.
func (s *Server) pendingOfferFor(ctx context.Context, courierID string) *pendingOffer {
	var o offerRow
	row := s.db.QueryRow(ctx, `SELECT `+offerCols+` FROM dispatch_offers
		WHERE courier_id=$1 AND status='pending' AND expires_at>now()
		AND kind IN ('directed','broadcast') ORDER BY created_at DESC LIMIT 1`, courierID)
	off, err := scanOffer(row)
	if err != nil {
		return nil
	}
	o = off
	var merchantName string
	var toPickup, trip float64
	var payload struct {
		ToPickupM float64 `json:"to_pickup_m"`
		TripM     float64 `json:"trip_m"`
	}
	_ = json.Unmarshal(o.Payload, &payload)
	toPickup, trip = payload.ToPickupM, payload.TripM
	d, err := s.loadDelivery(ctx, o.DeliveryID)
	if err != nil {
		return nil
	}
	ord, err := s.loadOrder(ctx, d.OrderID)
	if err != nil {
		return nil
	}
	_ = s.db.QueryRow(ctx, `SELECT name FROM merchants WHERE id=$1`, ord.MerchantID).Scan(&merchantName)
	eta := fmt.Sprintf("Pickup %.0f m away, trip %.0f m.", toPickup, trip)
	return &pendingOffer{ID: o.ID, DeliveryID: o.DeliveryID, MerchantName: merchantName,
		EtaText: eta, OfferText: merchantName + ": " + eta}
}

// voiceEtaSoon notifies the customer (chat + push) after server checks: the
// courier must own an active delivery.
func (s *Server) voiceEtaSoon(ctx context.Context, courierID string) {
	var orderID, customerID string
	err := s.db.QueryRow(ctx, `SELECT d.order_id, o.customer_id FROM deliveries d
		JOIN orders o ON o.id=d.order_id WHERE d.courier_id=$1
		AND d.status IN ('assigned','at_pickup','picked_up','at_dropoff') LIMIT 1`, courierID).Scan(&orderID, &customerID)
	if err != nil {
		return
	}
	const body = "Your courier is 2 minutes away."
	_, _ = s.db.Exec(ctx, `INSERT INTO order_messages(order_id,sender_type,sender_id,body,lang)
		VALUES($1,'courier',$2,$3,'en')`, orderID, courierID, body)
	s.queuePush(customerID, "Courier almost there", body)
	msgB, _ := json.Marshal(map[string]any{"type": "chat.message", "order_id": orderID,
		"sender": "courier", "body": body})
	s.hub.Broadcast(customerID, string(msgB))
}

// voiceConfirm executes an accept proposal after verifying the signed
// confirmation AND re-checking offer state (pending, unexpired, owned,
// approved courier, 1 active order) through the atomic acceptCore.
func (s *Server) voiceConfirm(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	var b struct {
		OfferID      string `json:"offer_id"`
		Confirmation string `json:"confirmation"`
	}
	if !decode(w, r, &b) || b.OfferID == "" || b.Confirmation == "" {
		problem(w, 400, "Validation failed", "offer_id and confirmation are required")
		return
	}
	if _, err := ai.VerifyConfirmation([]byte(s.cfg.JWTSecret), b.Confirmation, c.Sub, b.OfferID, time.Now()); err != nil {
		problem(w, 403, "Forbidden", "voice confirmation rejected")
		return
	}
	offer, err := scanOffer(s.db.QueryRow(r.Context(), `SELECT `+offerCols+` FROM dispatch_offers WHERE id=$1`, b.OfferID))
	if err != nil {
		problem(w, 404, "Not found", "offer not found")
		return
	}
	if offer.CourierID != c.Sub || (offer.Kind != "directed" && offer.Kind != "broadcast") {
		problem(w, 403, "Forbidden", "not your offer")
		return
	}
	if offer.Status != "pending" || time.Now().After(offer.ExpiresAt) {
		problem(w, 410, "Gone", "this offer already expired; keep running, the next one is coming")
		return
	}
	var courierStatus string
	if err := s.db.QueryRow(r.Context(), `SELECT status FROM couriers WHERE user_id=$1`, c.Sub).Scan(&courierStatus); err != nil || courierStatus != "approved" {
		problem(w, 403, "Forbidden", "only approved couriers can accept workout deliveries")
		return
	}
	d, code, msg := s.acceptCore(r.Context(), offer, c.Sub, "workout",
		[]string{DeliverySearching, DeliveryOffered})
	if code != 200 {
		problem(w, code, "Accept failed", msg)
		return
	}
	writeJSON(w, 200, map[string]any{"delivery": s.deliveryViewForCourier(r.Context(), d)})
}

// ---------- demo controls (admin, demo mode) ----------

func (s *Server) requireDemo(w http.ResponseWriter, r *http.Request) bool {
	if !s.cfg.Server.DemoMode {
		problem(w, 404, "Not found", "demo mode disabled")
		return false
	}
	return requireRole(w, r, "admin")
}

func (s *Server) demoState(w http.ResponseWriter, r *http.Request) {
	c := claims(r)
	if !isAdmin(c) {
		problem(w, 403, "Forbidden", "admin only")
		return
	}
	var force, bots bool
	var speed string
	_ = s.db.QueryRow(r.Context(), `SELECT force_no_courier, bots_running, bot_speed FROM demo_state WHERE id=1`).Scan(&force, &bots, &speed)
	writeJSON(w, 200, map[string]any{"force_no_courier": force, "bots_running": bots, "bot_speed": speed})
}

func (s *Server) setDemoState(force, bots *bool, speed string) {
	var curForce, curBots bool
	var curSpeed string
	_ = s.db.QueryRow(context.Background(), `SELECT force_no_courier, bots_running, bot_speed FROM demo_state WHERE id=1`).Scan(&curForce, &curBots, &curSpeed)
	if force != nil {
		curForce = *force
	}
	if bots != nil {
		curBots = *bots
	}
	if speed != "" {
		curSpeed = speed
	}
	_, _ = s.db.Exec(context.Background(), `UPDATE demo_state SET force_no_courier=$1, bots_running=$2, bot_speed=$3, updated_at=now() WHERE id=1`, curForce, curBots, curSpeed)
}

// demoBotsStart flags the simulator loop on (the cmd/simulator binary polls
// this state; the CMS flips it). Speed is x1, x3, or x10.
func (s *Server) demoBotsStart(w http.ResponseWriter, r *http.Request) {
	if !s.requireDemo(w, r) {
		return
	}
	var b struct {
		Speed string `json:"speed"`
	}
	_ = decode(w, r, &b)
	if b.Speed != "x1" && b.Speed != "x3" && b.Speed != "x10" {
		b.Speed = "x1"
	}
	on := true
	s.setDemoState(nil, &on, b.Speed)
	writeJSON(w, 200, map[string]any{"bots_running": true, "bot_speed": b.Speed})
}

func (s *Server) demoBotsStop(w http.ResponseWriter, r *http.Request) {
	if !s.requireDemo(w, r) {
		return
	}
	off := false
	s.setDemoState(nil, &off, "")
	writeJSON(w, 200, map[string]any{"bots_running": false})
}

// demoForceNoCourier makes dispatch skip the courier cascade so judges can
// rehearse staff fallback and the no-courier customer choices.
func (s *Server) demoForceNoCourier(w http.ResponseWriter, r *http.Request) {
	if !s.requireDemo(w, r) {
		return
	}
	var b struct {
		Enabled *bool `json:"enabled"`
	}
	if !decode(w, r, &b) || b.Enabled == nil {
		problem(w, 400, "Validation failed", "enabled is required")
		return
	}
	s.setDemoState(b.Enabled, nil, "")
	writeJSON(w, 200, map[string]any{"force_no_courier": *b.Enabled})
}

// demoReset clears runtime rows (orders, deliveries, ledger, sessions, AI)
// and reseeds demo wallets. Merchants, menus, users, and applications stay.
func (s *Server) demoReset(w http.ResponseWriter, r *http.Request) {
	if !s.requireDemo(w, r) {
		return
	}
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	for _, q := range []string{
		`DELETE FROM proof_checks`,
		`DELETE FROM trust_briefs`,
		`DELETE FROM ai_jobs`,
		`DELETE FROM ai_calls`,
		`DELETE FROM menu_import_jobs`,
		`DELETE FROM postings`,
		`DELETE FROM journal_entries`,
		`DELETE FROM ledger_accounts`,
		`DELETE FROM order_events`,
		`DELETE FROM order_items`,
		`DELETE FROM order_ratings`,
		`DELETE FROM order_cheers`,
		`DELETE FROM order_messages`,
		`DELETE FROM dispatch_offers`,
		`DELETE FROM deliveries`,
		`DELETE FROM payments`,
		`DELETE FROM webhook_events`,
		`DELETE FROM withdrawals`,
		`DELETE FROM orders`,
		`DELETE FROM location_points`,
		`DELETE FROM activity_sessions`,
		`DELETE FROM fitness_attempts`,
		`DELETE FROM checkpoint_photos`,
		`DELETE FROM jobs`,
		`DELETE FROM outbox_emails`,
		`UPDATE couriers SET rating_bayes=4.5, rating_count=0, rating_stars_sum=0, deliveries_count=0, last_delivery_at=NULL, updated_at=now()`,
		`UPDATE demo_state SET force_no_courier=false, bots_running=false, bot_speed='x1', updated_at=now() WHERE id=1`,
	} {
		if _, err := tx.Exec(ctx, q); err != nil {
			problem(w, 500, "Server error", "reset failed at: "+q)
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	if err := s.SeedDemo(ctx); err != nil {
		problem(w, 500, "Server error", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"reset": true})
}

// forceNoCourier reports the demo switch (dispatch consults it per cascade).
func (s *Server) forceNoCourier(ctx context.Context) bool {
	var force bool
	_ = s.db.QueryRow(ctx, `SELECT force_no_courier FROM demo_state WHERE id=1`).Scan(&force)
	return force
}

// devDeliveryCodes hands the simulator (demo mode only) the handover codes
// so bots can run the unattended loop. Never enabled in production.
func (s *Server) devDeliveryCodes(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.Server.DemoMode {
		problem(w, 404, "Not found", "demo mode disabled")
		return
	}
	c := claims(r)
	d, err := s.loadDelivery(r.Context(), r.PathValue("id"))
	if err != nil {
		problem(w, 404, "Not found", "delivery not found")
		return
	}
	if (d.CourierID == nil || *d.CourierID != c.Sub) && !isAdmin(c) {
		problem(w, 403, "Forbidden", "not your delivery")
		return
	}
	writeJSON(w, 200, map[string]any{"pickup_code": d.PickupCode, "delivery_pin": d.DropoffPin})
}
