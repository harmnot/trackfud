package ai

import (
	"context"
	"time"
)

// Hedge runs call and, if it has not returned after `after`, starts exactly
// one duplicate; the first success wins and the other call is cancelled.
//
// Why: the serverless model endpoint occasionally parks a request on a cold
// container, where it hangs for the caller's whole budget while a fresh
// request answers in seconds. A fast failure is returned as is (the HTTP
// client already retried retryable errors), and no duplicate starts once the
// parent context is done. Each call logs its own ai_calls row, so a cancelled
// duplicate stays visible on the CMS AI page.
func Hedge[T any](ctx context.Context, after time.Duration, call func(context.Context) (T, error)) (T, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	type result struct {
		v   T
		err error
	}
	results := make(chan result, 2) // buffered: the losing call never blocks
	start := func(callCtx context.Context) {
		go func() {
			v, err := call(callCtx)
			results <- result{v, err}
		}()
	}
	start(ctx)
	inflight, hedged := 1, false
	timer := time.NewTimer(after)
	defer timer.Stop()
	var firstErr *result
	for {
		select {
		case r := <-results:
			inflight--
			if r.err == nil {
				return r.v, nil
			}
			if firstErr == nil {
				firstErr = &r
			}
			if inflight == 0 {
				return firstErr.v, firstErr.err
			}
		case <-timer.C:
			if !hedged && inflight == 1 && firstErr == nil && ctx.Err() == nil {
				hedged = true
				inflight++
				start(context.WithValue(ctx, hedgeKey{}, true))
			}
		}
	}
}

type hedgeKey struct{}

// IsHedge reports a hedged duplicate's context: model clients route it over
// a separate connection pool (a stuck connection must not take both calls).
func IsHedge(ctx context.Context) bool {
	v, _ := ctx.Value(hedgeKey{}).(bool)
	return v
}
