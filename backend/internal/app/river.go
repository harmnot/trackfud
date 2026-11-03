// ---------- River background jobs ----------
//
// River replaces the legacy Postgres jobs-table poll loop (removed
// workOnce). One args struct per job kind, one worker each, registered in
// initRiver. Enqueue sites are unchanged: they still call enqueueTx (same
// transaction as the state change), enqueueNow, enqueueUnlessPending and
// queuePush — those helpers now InsertTx/Insert into River instead of the
// jobs table, preserving the same-tx crash safety (state change + order
// events + ledger postings + job insert commit atomically).
//
// Legacy kind strings are kept as the Kind() values so in-flight payloads
// keep their meaning; typed args only add compile-time shape. Retry-style
// kinds (dispatch_retry, dispatch_run, route_refresh) insert with ByArgs
// uniqueness, which is the River equivalent of the old
// enqueueUnlessPending SELECT guard. MaxAttempts 3 mirrors the old
// "3 attempts then failed" rule. River tables (river_*) are created by
// migrateRiver, called from Migrate at boot; the old jobs table is no
// longer written (left in place for history, superseded by river_job).
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
)

// Domain job kinds (payload keys in parentheses). AI kinds live in
// ai_jobs.go as AIJob* and are reused here as Kind() values.
const (
	JobEmailSend             = "email_send"              // {"to","subject","body"}
	JobPushSend              = "push_send"               // {"user_id","title","body"}
	JobMerchantAcceptTimeout = "merchant_accept_timeout" // {"order_id"}
	JobDispatchRun           = "dispatch_run"            // {"delivery_id"}
	JobOfferExpire           = "offer_expire"            // {"offer_id"}
	JobDispatchRetry         = "dispatch_retry"          // {"delivery_id"}
	JobSearchTimeout         = "search_timeout"          // {"delivery_id"}
	JobStaffTimeout          = "staff_timeout"           // {"delivery_id"}
	JobLeaveNowNudge         = "leave_now_nudge"         // {"delivery_id"} — ready-wave nudge
	JobRouteRefresh          = "route_refresh"           // {"delivery_id"}
	JobAutoComplete          = "auto_complete"           // {"order_id"}
	JobPayoutProcess         = "payout_process"          // {"withdrawal_id"}
)

// riverMaxAttempts mirrors the legacy shim: 3 total attempts, then failed.
const riverMaxAttempts = 3

// riverMaxWorkers bounds concurrent job execution per process.
const riverMaxWorkers = 20

// --- typed args (JSON tags match the legacy payload keys, so every args
// struct round-trips through River's JSON serialization) ---

type emailArgs struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

func (emailArgs) Kind() string { return JobEmailSend }

type pushArgs struct {
	UserID string `json:"user_id"`
	Title  string `json:"title"`
	Body   string `json:"body"`
}

func (pushArgs) Kind() string { return JobPushSend }

type dispatchRunArgs struct {
	DeliveryID string `json:"delivery_id"`
}

func (dispatchRunArgs) Kind() string { return JobDispatchRun }

type dispatchRetryArgs struct {
	DeliveryID string `json:"delivery_id"`
}

func (dispatchRetryArgs) Kind() string { return JobDispatchRetry }

type searchTimeoutArgs struct {
	DeliveryID string `json:"delivery_id"`
}

func (searchTimeoutArgs) Kind() string { return JobSearchTimeout }

type staffTimeoutArgs struct {
	DeliveryID string `json:"delivery_id"`
}

func (staffTimeoutArgs) Kind() string { return JobStaffTimeout }

type leaveNowNudgeArgs struct {
	DeliveryID string `json:"delivery_id"`
}

func (leaveNowNudgeArgs) Kind() string { return JobLeaveNowNudge }

type routeRefreshArgs struct {
	DeliveryID string `json:"delivery_id"`
}

func (routeRefreshArgs) Kind() string { return JobRouteRefresh }

type offerExpireArgs struct {
	OfferID string `json:"offer_id"`
}

func (offerExpireArgs) Kind() string { return JobOfferExpire }

type merchantAcceptTimeoutArgs struct {
	OrderID string `json:"order_id"`
}

func (merchantAcceptTimeoutArgs) Kind() string { return JobMerchantAcceptTimeout }

type autoCompleteArgs struct {
	OrderID string `json:"order_id"`
}

func (autoCompleteArgs) Kind() string { return JobAutoComplete }

type payoutArgs struct {
	WithdrawalID string `json:"withdrawal_id"`
}

func (payoutArgs) Kind() string { return JobPayoutProcess }

type menuImportArgs struct {
	ImportJobID string `json:"import_job_id"`
}

func (menuImportArgs) Kind() string { return AIJobMenuImport }

type translateArgs struct {
	MessageID string `json:"message_id"`
}

func (translateArgs) Kind() string { return AIJobTranslate }

type trustBriefArgs struct {
	UserID string `json:"user_id"`
}

func (trustBriefArgs) Kind() string { return AIJobTrustBrief }

type proofCheckArgs struct {
	DeliveryID string `json:"delivery_id"`
	FileID     string `json:"file_id"`
}

func (proofCheckArgs) Kind() string { return AIJobProofCheck }

type feedbackLabelsArgs struct {
	OrderID string `json:"order_id"`
}

func (feedbackLabelsArgs) Kind() string { return AIJobFeedbackLabels }

// riverJobArgs maps a legacy (kind, JSON payload string) pair to typed
// River args. It is the only place that parses payload strings, so enqueue
// call sites stay untouched while workers get typed values. Every returned
// struct JSON-serializes back to the same keys, which is what River stores.
func riverJobArgs(kind, payload string) (river.JobArgs, error) {
	decode := func(v any) error {
		if err := json.Unmarshal([]byte(payload), v); err != nil {
			return fmt.Errorf("river: bad %s payload: %w", kind, err)
		}
		return nil
	}
	switch kind {
	case JobEmailSend:
		var a emailArgs
		if err := decode(&a); err != nil {
			return nil, err
		}
		if a.To == "" {
			return nil, fmt.Errorf("river: %s payload missing to", kind)
		}
		return a, nil
	case JobPushSend:
		var a pushArgs
		if err := decode(&a); err != nil {
			return nil, err
		}
		if a.UserID == "" {
			return nil, fmt.Errorf("river: %s payload missing user_id", kind)
		}
		return a, nil
	case JobDispatchRun, JobDispatchRetry, JobSearchTimeout, JobStaffTimeout,
		JobLeaveNowNudge, JobRouteRefresh:
		var d struct {
			DeliveryID string `json:"delivery_id"`
		}
		if err := decode(&d); err != nil {
			return nil, err
		}
		if d.DeliveryID == "" {
			return nil, fmt.Errorf("river: %s payload missing delivery_id", kind)
		}
		switch kind {
		case JobDispatchRun:
			return dispatchRunArgs(d), nil
		case JobDispatchRetry:
			return dispatchRetryArgs(d), nil
		case JobSearchTimeout:
			return searchTimeoutArgs(d), nil
		case JobStaffTimeout:
			return staffTimeoutArgs(d), nil
		case JobLeaveNowNudge:
			return leaveNowNudgeArgs(d), nil
		default:
			return routeRefreshArgs(d), nil
		}
	case JobOfferExpire:
		var a offerExpireArgs
		if err := decode(&a); err != nil {
			return nil, err
		}
		if a.OfferID == "" {
			return nil, fmt.Errorf("river: %s payload missing offer_id", kind)
		}
		return a, nil
	case JobMerchantAcceptTimeout:
		var a merchantAcceptTimeoutArgs
		if err := decode(&a); err != nil {
			return nil, err
		}
		if a.OrderID == "" {
			return nil, fmt.Errorf("river: %s payload missing order_id", kind)
		}
		return a, nil
	case JobAutoComplete:
		var a autoCompleteArgs
		if err := decode(&a); err != nil {
			return nil, err
		}
		if a.OrderID == "" {
			return nil, fmt.Errorf("river: %s payload missing order_id", kind)
		}
		return a, nil
	case JobPayoutProcess:
		var a payoutArgs
		if err := decode(&a); err != nil {
			return nil, err
		}
		if a.WithdrawalID == "" {
			return nil, fmt.Errorf("river: %s payload missing withdrawal_id", kind)
		}
		return a, nil
	case AIJobMenuImport:
		var a menuImportArgs
		if err := decode(&a); err != nil {
			return nil, err
		}
		return a, nil
	case AIJobTranslate:
		var a translateArgs
		if err := decode(&a); err != nil {
			return nil, err
		}
		return a, nil
	case AIJobTrustBrief:
		var a trustBriefArgs
		if err := decode(&a); err != nil {
			return nil, err
		}
		return a, nil
	case AIJobProofCheck:
		var a proofCheckArgs
		if err := decode(&a); err != nil {
			return nil, err
		}
		return a, nil
	case AIJobFeedbackLabels:
		var a feedbackLabelsArgs
		if err := decode(&a); err != nil {
			return nil, err
		}
		return a, nil
	}
	return nil, fmt.Errorf("river: unknown job kind %q", kind)
}

// riverUniqueOpts is the River equivalent of enqueueUnlessPending: retry and
// refresh-style kinds dedupe per kind+args, so GPS-speed callers cannot spam
// the queue. One-shot kinds (email, push, timeouts, AI) insert freely —
// timeouts are scheduled once per state transition upstream.
func riverUniqueOpts(kind string) river.UniqueOpts {
	switch kind {
	case JobDispatchRun, JobDispatchRetry, JobRouteRefresh:
		return river.UniqueOpts{ByArgs: true}
	}
	return river.UniqueOpts{}
}

// --- workers (one per kind; the existing domain handlers stay the unit of
// work, and each is already idempotent: guarded on current status, deduped
// on idempotency/event keys, AI jobs additionally claim ai_jobs rows) ---

type emailWorker struct {
	river.WorkerDefaults[emailArgs]
	s *Server
}

func (w *emailWorker) Work(ctx context.Context, job *river.Job[emailArgs]) error {
	a := job.Args
	if msg := w.s.doEmail(ctx, map[string]string{"to": a.To, "subject": a.Subject, "body": a.Body}); msg != "" {
		return errors.New(msg)
	}
	return nil
}

type pushWorker struct {
	river.WorkerDefaults[pushArgs]
	s *Server
}

func (w *pushWorker) Work(ctx context.Context, job *river.Job[pushArgs]) error {
	a := job.Args
	if msg := w.s.doPush(ctx, map[string]string{"user_id": a.UserID, "title": a.Title, "body": a.Body}); msg != "" {
		return errors.New(msg)
	}
	return nil
}

type merchantTimeoutWorker struct {
	river.WorkerDefaults[merchantAcceptTimeoutArgs]
	s *Server
}

func (w *merchantTimeoutWorker) Work(ctx context.Context, job *river.Job[merchantAcceptTimeoutArgs]) error {
	w.s.handleMerchantTimeout(ctx, job.Args.OrderID)
	return nil
}

type dispatchRunWorker struct {
	river.WorkerDefaults[dispatchRunArgs]
	s *Server
}

func (w *dispatchRunWorker) Work(ctx context.Context, job *river.Job[dispatchRunArgs]) error {
	w.s.handleDispatchRun(ctx, job.Args.DeliveryID)
	return nil
}

type offerExpireWorker struct {
	river.WorkerDefaults[offerExpireArgs]
	s *Server
}

func (w *offerExpireWorker) Work(ctx context.Context, job *river.Job[offerExpireArgs]) error {
	w.s.handleOfferExpire(ctx, job.Args.OfferID)
	return nil
}

type dispatchRetryWorker struct {
	river.WorkerDefaults[dispatchRetryArgs]
	s *Server
}

func (w *dispatchRetryWorker) Work(ctx context.Context, job *river.Job[dispatchRetryArgs]) error {
	w.s.handleDispatchRetry(ctx, job.Args.DeliveryID)
	return nil
}

type searchTimeoutWorker struct {
	river.WorkerDefaults[searchTimeoutArgs]
	s *Server
}

func (w *searchTimeoutWorker) Work(ctx context.Context, job *river.Job[searchTimeoutArgs]) error {
	w.s.handleSearchTimeout(ctx, job.Args.DeliveryID)
	return nil
}

type staffTimeoutWorker struct {
	river.WorkerDefaults[staffTimeoutArgs]
	s *Server
}

func (w *staffTimeoutWorker) Work(ctx context.Context, job *river.Job[staffTimeoutArgs]) error {
	w.s.handleStaffTimeout(ctx, job.Args.DeliveryID)
	return nil
}

type leaveNudgeWorker struct {
	river.WorkerDefaults[leaveNowNudgeArgs]
	s *Server
}

func (w *leaveNudgeWorker) Work(ctx context.Context, job *river.Job[leaveNowNudgeArgs]) error {
	w.s.handleLeaveNudge(ctx, job.Args.DeliveryID)
	return nil
}

type routeRefreshWorker struct {
	river.WorkerDefaults[routeRefreshArgs]
	s *Server
}

func (w *routeRefreshWorker) Work(ctx context.Context, job *river.Job[routeRefreshArgs]) error {
	w.s.handleRouteRefresh(ctx, job.Args.DeliveryID)
	return nil
}

type autoCompleteWorker struct {
	river.WorkerDefaults[autoCompleteArgs]
	s *Server
}

func (w *autoCompleteWorker) Work(ctx context.Context, job *river.Job[autoCompleteArgs]) error {
	w.s.handleAutoComplete(ctx, job.Args.OrderID)
	return nil
}

type payoutWorker struct {
	river.WorkerDefaults[payoutArgs]
	s *Server
}

func (w *payoutWorker) Work(ctx context.Context, job *river.Job[payoutArgs]) error {
	w.s.handlePayoutProcess(ctx, job.Args.WithdrawalID)
	return nil
}

type menuImportWorker struct {
	river.WorkerDefaults[menuImportArgs]
	s *Server
}

func (w *menuImportWorker) Work(ctx context.Context, job *river.Job[menuImportArgs]) error {
	w.s.handleAIMenuImport(ctx, job.Args.ImportJobID)
	return nil
}

type translateWorker struct {
	river.WorkerDefaults[translateArgs]
	s *Server
}

func (w *translateWorker) Work(ctx context.Context, job *river.Job[translateArgs]) error {
	w.s.handleAITranslate(ctx, job.Args.MessageID)
	return nil
}

type trustBriefWorker struct {
	river.WorkerDefaults[trustBriefArgs]
	s *Server
}

func (w *trustBriefWorker) Work(ctx context.Context, job *river.Job[trustBriefArgs]) error {
	w.s.handleAITrustBrief(ctx, job.Args.UserID)
	return nil
}

type proofCheckWorker struct {
	river.WorkerDefaults[proofCheckArgs]
	s *Server
}

func (w *proofCheckWorker) Work(ctx context.Context, job *river.Job[proofCheckArgs]) error {
	w.s.handleAIProofCheck(ctx, job.Args.DeliveryID, job.Args.FileID)
	return nil
}

type feedbackLabelsWorker struct {
	river.WorkerDefaults[feedbackLabelsArgs]
	s *Server
}

func (w *feedbackLabelsWorker) Work(ctx context.Context, job *river.Job[feedbackLabelsArgs]) error {
	w.s.handleAIFeedbackLabels(ctx, job.Args.OrderID)
	return nil
}

// initRiver builds the River client and registers every worker. It performs
// no I/O, so New() can call it even before the database is reachable; the
// river_* tables are created by migrateRiver (via Migrate at boot).
func (s *Server) initRiver() error {
	workers := river.NewWorkers()
	river.AddWorker[emailArgs](workers, &emailWorker{s: s})
	river.AddWorker[pushArgs](workers, &pushWorker{s: s})
	river.AddWorker[merchantAcceptTimeoutArgs](workers, &merchantTimeoutWorker{s: s})
	river.AddWorker[dispatchRunArgs](workers, &dispatchRunWorker{s: s})
	river.AddWorker[offerExpireArgs](workers, &offerExpireWorker{s: s})
	river.AddWorker[dispatchRetryArgs](workers, &dispatchRetryWorker{s: s})
	river.AddWorker[searchTimeoutArgs](workers, &searchTimeoutWorker{s: s})
	river.AddWorker[staffTimeoutArgs](workers, &staffTimeoutWorker{s: s})
	river.AddWorker[leaveNowNudgeArgs](workers, &leaveNudgeWorker{s: s})
	river.AddWorker[routeRefreshArgs](workers, &routeRefreshWorker{s: s})
	river.AddWorker[autoCompleteArgs](workers, &autoCompleteWorker{s: s})
	river.AddWorker[payoutArgs](workers, &payoutWorker{s: s})
	river.AddWorker[menuImportArgs](workers, &menuImportWorker{s: s})
	river.AddWorker[translateArgs](workers, &translateWorker{s: s})
	river.AddWorker[trustBriefArgs](workers, &trustBriefWorker{s: s})
	river.AddWorker[proofCheckArgs](workers, &proofCheckWorker{s: s})
	river.AddWorker[feedbackLabelsArgs](workers, &feedbackLabelsWorker{s: s})

	rq, err := river.NewClient(riverpgxv5.New(s.db), &river.Config{
		Queues:      map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: riverMaxWorkers}},
		Workers:     workers,
		MaxAttempts: riverMaxAttempts,
		Logger:      s.log,
	})
	if err != nil {
		return fmt.Errorf("river: new client: %w", err)
	}
	s.rq = rq
	return nil
}

// migrateRiver creates the river_* tables (idempotent; safe on every boot).
func migrateRiver(ctx context.Context, db *pgxpool.Pool) error {
	mig, err := rivermigrate.New(riverpgxv5.New(db), &rivermigrate.Config{})
	if err != nil {
		return fmt.Errorf("river: migrator: %w", err)
	}
	if _, err := mig.Migrate(ctx, rivermigrate.DirectionUp, &rivermigrate.MigrateOpts{}); err != nil {
		return fmt.Errorf("river: migrate: %w", err)
	}
	return nil
}

// riverInsertOpts centralizes per-kind insert options: scheduled time plus
// the ByArgs dedup for retry-style kinds.
func riverInsertOpts(kind string, runAt time.Time) *river.InsertOpts {
	return &river.InsertOpts{ScheduledAt: runAt, UniqueOpts: riverUniqueOpts(kind)}
}
