package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"Trackfud/internal/ai"
	"Trackfud/internal/config"
)

// ---------- B6 AI services + background jobs ----------
//
// One args struct per job kind (payload keys below), one River worker each
// (registered in river.go). Workers claim an ai_jobs row first, so a
// double-delivered job runs its side effects once; every domain write is
// additionally idempotent (upserts / guarded updates).

// AI job kinds (payload keys in parentheses).
const (
	AIJobMenuImport     = "ai_menu_import"     // {"import_job_id"}
	AIJobTranslate      = "ai_translate"       // {"message_id"}
	AIJobTrustBrief     = "ai_trust_brief"     // {"user_id"}
	AIJobProofCheck     = "ai_proof_check"     // {"delivery_id","file_id"}
	AIJobFeedbackLabels = "ai_feedback_labels" // {"order_id"}
)

// aiLogTimeout bounds the ai_calls insert (detached from the caller's
// context, which may already have expired).
const aiLogTimeout = 5 * time.Second

// AIService bundles the Meta client with the voice and crop helpers.
type AIService struct {
	cli         *ai.Client
	transcriber ai.Transcriber
	cropper     ai.Cropper
}

func newAIService(cfg ai.Config) *AIService {
	c := ai.New(cfg)
	var tr ai.Transcriber = ai.LocalTranscriber{}
	if cfg.APIKey != "" {
		tr = ai.NewMetaTranscriber(cfg)
	}
	return &AIService{cli: c, transcriber: tr, cropper: ai.NewMetaCropper(cfg)}
}

// liveTranscription reports whether courier audio is sent to Meta Muse
// Voice Transcribe (false = typed/local fallback only). A boolean only —
// never which credential is configured.
func (a *AIService) liveTranscription() bool {
	_, local := a.transcriber.(ai.LocalTranscriber)
	return !local
}

// aiConfigOf maps server config to the AI client config. Credentials come
// from env only and never appear in any API response.
func aiConfigOf(cfg *config.Config) ai.Config {
	return ai.Config{
		APIKey: cfg.AI.MetaAPIKey, BaseURL: cfg.AI.MetaBaseURL,
		ModalKey: cfg.AI.ModalKey, ModalSecret: cfg.AI.ModalSecret,
		SparkModel: cfg.AI.SparkModel, ContributorModel: cfg.AI.ContributorModel,
		TranscribeModel: cfg.AI.TranscribeModel, SAMModel: cfg.AI.SAMModel,
	}
}

// logAICall persists one ai_calls row (feature, model, latency, tokens,
// integer cost). Logging never fails the caller.
func (s *Server) logAICall(ctx context.Context, rec ai.CallRecord) {
	// Timed-out calls are exactly the ones worth logging, but their context
	// is already done: write with a detached, bounded context instead.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), aiLogTimeout)
	defer cancel()
	_, _ = s.db.Exec(ctx, `INSERT INTO ai_calls(feature,model,prompt_version,latency_ms,
		input_tokens,output_tokens,cost_micros,fallback,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		rec.Feature, rec.Model, rec.PromptVersion, rec.LatencyMs,
		rec.InputTokens, rec.OutputTokens, rec.CostMicros, rec.Fallback, rec.ErrText)
}

// aiLog adapts logAICall to the ai.CallLogger signature.
func (s *Server) aiLog(ctx context.Context, rec ai.CallRecord) { s.logAICall(ctx, rec) }

// claimAIJob inserts the idempotency row. ok=false means another delivery
// already finished this job: the caller must return without side effects.
// A re-run after crash (pending/failed) still proceeds, and every domain
// write below is itself idempotent (upserts / guarded updates).
func (s *Server) claimAIJob(ctx context.Context, kind, key string) (ok bool) {
	var status string
	var attempts int
	err := s.db.QueryRow(ctx, `INSERT INTO ai_jobs(kind,job_key) VALUES($1,$2)
		ON CONFLICT (kind,job_key) DO UPDATE SET attempts=ai_jobs.attempts+1, updated_at=now()
		RETURNING status, attempts`, kind, key).Scan(&status, &attempts)
	if err != nil {
		return false
	}
	return aiClaimRunnable(status, attempts)
}

// aiClaimRunnable is the pure double-delivery rule behind claimAIJob: a
// finished row with a prior attempt means another delivery already ran the
// side effects, so this delivery must be a no-op. Pending/failed rows run
// (first attempt or crash retry); their domain writes are convergent
// upserts, so even a racing double-claim settles to one effect.
func aiClaimRunnable(status string, attempts int) bool {
	return !(status == "done" && attempts > 0)
}

func (s *Server) finishAIJob(ctx context.Context, kind, key, status, result, errText string) {
	_, _ = s.db.Exec(ctx, `UPDATE ai_jobs SET status=$3, result=$4::jsonb, last_error=$5, updated_at=now()
		WHERE kind=$1 AND job_key=$2`, kind, key, status, result, errText)
}

// fileBytes loads a ready upload's bytes for vision/crop inputs through the
// storage layer: R2 objects (s3:// keys) via the S3 client, legacy local
// uploads from disk. Reads are capped at the 5 MiB upload limit.
func (s *Server) fileBytes(ctx context.Context, fileID string) (bytes []byte, contentType string, sha string, err error) {
	var path string
	if err = s.db.QueryRow(ctx, `SELECT storage_path, content_type FROM files WHERE id=$1 AND status='ready'`, fileID).Scan(&path, &contentType); err != nil {
		return nil, "", "", err
	}
	bytes, err = s.st.Read(ctx, path)
	if err != nil {
		return nil, "", "", err
	}
	return bytes, contentType, ai.HashBytes(bytes), nil
}

// ---------- ai_menu_import ----------

func (s *Server) handleAIMenuImport(ctx context.Context, importJobID string) {
	key := "import:" + importJobID
	if !s.claimAIJob(ctx, AIJobMenuImport, key) {
		return
	}
	var fileID *string
	var status string
	if err := s.db.QueryRow(ctx, `SELECT file_id, status FROM menu_import_jobs WHERE id=$1`, importJobID).Scan(&fileID, &status); err != nil {
		s.finishAIJob(ctx, AIJobMenuImport, key, "done", `{"failed":true}`, "import job gone")
		return
	}
	if status == "done" || status == "failed" {
		s.finishAIJob(ctx, AIJobMenuImport, key, "done", `{"skipped":"terminal"}`, "")
		return
	}
	_, _ = s.db.Exec(ctx, `UPDATE menu_import_jobs SET status='analyzing', progress=65, updated_at=now() WHERE id=$1`, importJobID)
	var out ai.MenuOutput
	usedFallback := false
	photoSHA := ""
	if fileID != nil {
		if b, ct, sha, err := s.fileBytes(ctx, *fileID); err != nil {
			s.log.Warn("menu photo unreadable, using fallback", "import_job", importJobID, "err", err)
		} else {
			photoSHA = sha
			if s.ai.cli.HasKey() && len(b) <= 4*1024*1024 {
				dataURL := "data:" + ct + ";base64," + base64.StdEncoding.EncodeToString(b)
				raw, cerr := s.ai.cli.ChatVisionJSON(ctx, "menu_import", ai.PromptMenuV2, s.ai.cli.SparkModel(),
					ai.MenuSystemV2, "Extract every dish from this menu photo for languages en, id, ms.", dataURL, "menu", ai.MenuSchema(), s.aiLog)
				if cerr == nil {
					if parsed, verr := ai.ParseMenuOutput(raw); verr == nil {
						out = parsed
					} else {
						s.log.Warn("menu output invalid, using fallback", "err", verr)
					}
				} else {
					s.log.Warn("menu vision failed, using fallback", "err", cerr)
				}
			}
		}
	}
	if len(out.Items) == 0 {
		out = ai.FallbackMenu(photoSHA)
		usedFallback = true
		s.logAICall(ctx, ai.CallRecord{Feature: "menu_import", Model: s.ai.cli.SparkModel(), PromptVersion: ai.PromptMenuV2, Fallback: true})
	}
	// SAM crops: one advisory dish box per draft (stub offline, honest log).
	for i := range out.Items {
		box, rec, _ := s.ai.cropper.Crop(ctx, ai.CropRequest{FileSHA256: photoSHA, Subject: "dish", Hint: out.Items[i].Name["en"]})
		s.logAICall(ctx, rec)
		out.Items[i].CropBox = &box
	}
	drafts, _ := json.Marshal(out.Items)
	_, _ = s.db.Exec(ctx, `UPDATE menu_import_jobs SET status='needs_review', progress=100, drafts=$2, updated_at=now() WHERE id=$1`, importJobID, string(drafts))
	s.finishAIJob(ctx, AIJobMenuImport, key, "done", fmt.Sprintf(`{"items":%d,"fallback":%v}`, len(out.Items), usedFallback), "")
}

// ---------- ai_translate ----------

func (s *Server) handleAITranslate(ctx context.Context, messageID string) {
	key := "msg:" + messageID
	if !s.claimAIJob(ctx, AIJobTranslate, key) {
		return
	}
	var orderID, body, lang string
	if err := s.db.QueryRow(ctx, `SELECT order_id, body, lang FROM order_messages WHERE id=$1`, messageID).Scan(&orderID, &body, &lang); err != nil {
		s.finishAIJob(ctx, AIJobTranslate, key, "done", `{"failed":true}`, "message gone")
		return
	}
	src := lang
	if src == "" {
		src = ai.DetectLang(body)
	}
	target := "en"
	if src == "en" {
		target = "id"
	}
	translated := ""
	flagged := ai.FallbackModerate(body)
	usedFallback := false
	if s.ai.cli.HasKey() {
		raw, err := s.ai.cli.ChatJSON(ctx, "chat_translate", ai.PromptTranslateV1, s.ai.cli.SparkModel(),
			ai.TranslateSystemV1, "Translate from "+src+" to "+target+": "+body, "translation", ai.TranslateSchema(), s.aiLog)
		if err == nil {
			if parsed, verr := ai.ParseTranslateOutput(raw); verr == nil {
				translated = parsed.Text
				flagged = flagged || parsed.FlagAbusive
			}
		}
	}
	if translated == "" {
		if hit, ok := ai.FallbackTranslate(body, src, target); ok {
			translated = hit
		} else {
			translated = body // honest passthrough; moderated flag still set
		}
		usedFallback = true
		s.logAICall(ctx, ai.CallRecord{Feature: "chat_translate", Model: s.ai.cli.SparkModel(), PromptVersion: ai.PromptTranslateV1, Fallback: true})
	}
	_, _ = s.db.Exec(ctx, `UPDATE order_messages SET translated_body=$2, moderated=true, flagged=$3, translated_live=$4 WHERE id=$1`,
		messageID, translated, flagged, !usedFallback)
	s.notifyChatTranslated(ctx, orderID, messageID, translated, target, !usedFallback)
	s.finishAIJob(ctx, AIJobTranslate, key, "done", fmt.Sprintf(`{"fallback":%v,"flagged":%v}`, usedFallback, flagged), "")
}

// ---------- ai_trust_brief ----------

func (s *Server) handleAITrustBrief(ctx context.Context, userID string) {
	key := "user:" + userID
	if !s.claimAIJob(ctx, AIJobTrustBrief, key) {
		return
	}
	var appID *string
	var passed bool
	var checkpoint *string
	_ = s.db.QueryRow(ctx, `SELECT id, fitness_passed, checkpoint_file_id FROM courier_applications WHERE user_id=$1`, userID).Scan(&appID, &passed, &checkpoint)
	var failedAttempts int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM fitness_attempts WHERE user_id=$1 AND passed=false`, userID).Scan(&failedAttempts)
	flagCount := failedAttempts
	if !passed {
		flagCount++
	}
	photoReadable := checkpoint != nil
	brief := ai.FallbackTrustBrief(flagCount, photoReadable, false)
	usedFallback := true
	if s.ai.cli.HasKey() {
		user := fmt.Sprintf("failed attempts: %d; fitness passed: %v; checkpoint photo present: %v",
			failedAttempts, passed, checkpoint != nil)
		if raw, err := s.ai.cli.ChatJSON(ctx, "trust_brief", ai.PromptTrustV1, s.ai.cli.SparkModel(),
			ai.TrustSystemV1, user, "trust_brief", ai.TrustSchema(), s.aiLog); err == nil {
			if parsed, verr := ai.ParseTrustBrief(raw); verr == nil {
				brief = parsed
				usedFallback = false
			}
		}
	} else {
		s.logAICall(ctx, ai.CallRecord{Feature: "trust_brief", Model: s.ai.cli.SparkModel(), PromptVersion: ai.PromptTrustV1, Fallback: true})
	}
	reasons, _ := json.Marshal(brief.Reasons)
	_, _ = s.db.Exec(ctx, `INSERT INTO trust_briefs(user_id,application_id,risk,summary,reasons,photo_note,fallback)
		VALUES($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (user_id) DO UPDATE SET risk=EXCLUDED.risk, summary=EXCLUDED.summary,
		  reasons=EXCLUDED.reasons, photo_note=EXCLUDED.photo_note, fallback=EXCLUDED.fallback`,
		userID, appID, brief.Risk, brief.Summary, string(reasons), brief.PhotoNote, usedFallback)
	s.finishAIJob(ctx, AIJobTrustBrief, key, "done", fmt.Sprintf(`{"risk":%q,"fallback":%v}`, brief.Risk, usedFallback), "")
}

// ---------- ai_proof_check ----------

func (s *Server) handleAIProofCheck(ctx context.Context, deliveryID, fileID string) {
	key := "delivery:" + deliveryID + ":file:" + fileID
	if !s.claimAIJob(ctx, AIJobProofCheck, key) {
		return
	}
	check := ai.FallbackProofCheck()
	usedFallback := true
	if s.ai.cli.HasKey() {
		b, ct, _, err := s.fileBytes(ctx, fileID)
		if err != nil {
			s.log.Warn("proof photo unreadable, using fallback", "delivery", deliveryID, "err", err)
		}
		if err == nil && len(b) <= 4*1024*1024 {
			dataURL := "data:" + ct + ";base64," + base64.StdEncoding.EncodeToString(b)
			raw, cerr := s.ai.cli.ChatVisionJSON(ctx, "proof_check", ai.PromptProofV1, s.ai.cli.SparkModel(),
				ai.ProofSystemV1, "Check this delivery proof photo.", dataURL, "proof", ai.ProofSchema(), s.aiLog)
			if cerr == nil {
				if parsed, verr := ai.ParseProofCheck(raw); verr == nil {
					check = parsed
					usedFallback = false
				}
			}
		}
	} else {
		s.logAICall(ctx, ai.CallRecord{Feature: "proof_check", Model: s.ai.cli.SparkModel(), PromptVersion: ai.PromptProofV1, Fallback: true})
	}
	// Idempotent write: one verdict per (delivery, file).
	tx, err := s.db.Begin(ctx)
	if err == nil {
		_, _ = tx.Exec(ctx, `DELETE FROM proof_checks WHERE delivery_id=$1 AND file_id=$2`, deliveryID, fileID)
		_, _ = tx.Exec(ctx, `INSERT INTO proof_checks(delivery_id,file_id,verdict,note,fallback) VALUES($1,$2,$3,$4,$5)`,
			deliveryID, fileID, check.Verdict, check.Note, usedFallback)
		_ = tx.Commit(ctx)
	}
	s.finishAIJob(ctx, AIJobProofCheck, key, "done", fmt.Sprintf(`{"verdict":%q,"fallback":%v}`, check.Verdict, usedFallback), "")
}

// ---------- ai_feedback_labels ----------

func (s *Server) handleAIFeedbackLabels(ctx context.Context, orderID string) {
	key := "order:" + orderID
	if !s.claimAIJob(ctx, AIJobFeedbackLabels, key) {
		return
	}
	var stars *int
	var tags string
	if err := s.db.QueryRow(ctx, `SELECT courier_stars, courier_tags::text FROM order_ratings WHERE order_id=$1`, orderID).Scan(&stars, &tags); err != nil {
		s.finishAIJob(ctx, AIJobFeedbackLabels, key, "done", `{"failed":true}`, "rating gone")
		return
	}
	text := tags
	n := 5
	if stars != nil {
		n = *stars
	}
	labels := ai.FallbackFeedbackLabels(n, text)
	usedFallback := true
	if s.ai.cli.HasKey() {
		raw, err := s.ai.cli.ChatJSON(ctx, "feedback_labels", ai.PromptLabelsV1, s.ai.cli.SparkModel(),
			ai.LabelsSystemV1, fmt.Sprintf("stars: %d; tags: %s", n, text), "labels", ai.LabelsSchema(), s.aiLog)
		if err == nil {
			if parsed, verr := ai.ParseFeedbackLabels(raw); verr == nil {
				labels = parsed
				usedFallback = false
			}
		}
	} else {
		s.logAICall(ctx, ai.CallRecord{Feature: "feedback_labels", Model: s.ai.cli.SparkModel(), PromptVersion: ai.PromptLabelsV1, Fallback: true})
	}
	topics, _ := json.Marshal(labels.Topics)
	_, _ = s.db.Exec(ctx, `UPDATE order_ratings SET topics=$2, abusive=$3 WHERE order_id=$1`, orderID, string(topics), labels.Abusive)
	s.finishAIJob(ctx, AIJobFeedbackLabels, key, "done", fmt.Sprintf(`{"fallback":%v,"abusive":%v}`, usedFallback, labels.Abusive), "")
}
