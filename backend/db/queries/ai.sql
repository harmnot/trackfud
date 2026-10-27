-- Trackfud B6 AI queries (shapes used by internal/app/ai*.go).
-- Money stays integer (cost_micros); AI never writes prices or sanctions.
-- name: LogAICall :exec
INSERT INTO ai_calls(feature,model,prompt_version,latency_ms,input_tokens,output_tokens,cost_micros,fallback,error)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9);
-- name: ClaimAIJob :one
INSERT INTO ai_jobs(kind,job_key) VALUES($1,$2)
ON CONFLICT (kind,job_key) DO UPDATE SET attempts=ai_jobs.attempts+1, updated_at=now()
RETURNING id, status, attempts;
-- name: FinishAIJob :exec
UPDATE ai_jobs SET status=$3, result=$4, last_error=$5, updated_at=now()
WHERE kind=$1 AND job_key=$2;
-- name: CreateImportJob :one
INSERT INTO menu_import_jobs(merchant_id,file_id,status,progress) VALUES($1,$2,'queued',5)
RETURNING id;
-- name: UpdateImportJob :exec
UPDATE menu_import_jobs SET status=$2, progress=$3, drafts=$4, error=$5, updated_at=now()
WHERE id=$1;
-- name: GetImportJob :one
SELECT id, merchant_id, file_id, status, progress, drafts, error, prices_checked, created_at, updated_at
FROM menu_import_jobs WHERE id=$1;
-- name: UpsertTrustBrief :exec
INSERT INTO trust_briefs(user_id,application_id,risk,summary,reasons,photo_note,fallback)
VALUES($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT (user_id) DO UPDATE SET risk=EXCLUDED.risk, summary=EXCLUDED.summary,
  reasons=EXCLUDED.reasons, photo_note=EXCLUDED.photo_note, fallback=EXCLUDED.fallback;
-- name: GetTrustBrief :one
SELECT user_id, risk, advisory, summary, reasons, photo_note, fallback, created_at
FROM trust_briefs WHERE user_id=$1;
-- name: InsertProofCheck :exec
INSERT INTO proof_checks(delivery_id,file_id,verdict,note,fallback) VALUES($1,$2,$3,$4,$5);
-- name: TranslateMessage :exec
UPDATE order_messages SET translated_body=$2, moderated=true, flagged=$3 WHERE id=$1;
-- name: LabelRating :exec
UPDATE order_ratings SET topics=$2, abusive=$3 WHERE order_id=$1;
-- name: GetDemoState :one
SELECT force_no_courier, bots_running, bot_speed FROM demo_state WHERE id=1;
-- name: SetDemoState :exec
UPDATE demo_state SET force_no_courier=$1, bots_running=$2, bot_speed=$3, updated_at=now() WHERE id=1;
