package ai

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

func TestHedgeFastSuccessStartsNoDuplicate(t *testing.T) {
	var calls atomic.Int32
	v, err := Hedge(context.Background(), 50*time.Millisecond, func(context.Context) (string, error) {
		calls.Add(1)
		return "plans", nil
	})
	if err != nil || v != "plans" {
		t.Fatalf("got %q, %v", v, err)
	}
	time.Sleep(80 * time.Millisecond) // past the hedge delay: still one call
	if n := calls.Load(); n != 1 {
		t.Fatalf("calls = %d, want 1", n)
	}
}

func TestHedgeStuckCallIsRescuedAndCancelled(t *testing.T) {
	var calls atomic.Int32
	firstCancelled := make(chan struct{})
	begin := time.Now()
	v, err := Hedge(context.Background(), 30*time.Millisecond, func(ctx context.Context) (string, error) {
		if calls.Add(1) == 1 { // the parked request: hangs until cancelled
			<-ctx.Done()
			close(firstCancelled)
			return "", ctx.Err()
		}
		return "fresh", nil
	})
	if err != nil || v != "fresh" {
		t.Fatalf("got %q, %v", v, err)
	}
	if took := time.Since(begin); took > time.Second {
		t.Fatalf("took %v; the duplicate should answer right after the hedge delay", took)
	}
	select {
	case <-firstCancelled:
	case <-time.After(time.Second):
		t.Fatal("the stuck call was not cancelled after the duplicate won")
	}
}

func TestHedgeFastFailureIsNotRetried(t *testing.T) {
	var calls atomic.Int32
	boom := errors.New("400 bad schema")
	_, err := Hedge(context.Background(), 30*time.Millisecond, func(context.Context) (string, error) {
		calls.Add(1)
		return "", boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want %v", err, boom)
	}
	time.Sleep(60 * time.Millisecond)
	if n := calls.Load(); n != 1 {
		t.Fatalf("calls = %d, want 1 (fast failures are returned, not hedged)", n)
	}
}

func TestHedgeRespectsParentDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	var calls atomic.Int32
	_, err := Hedge(ctx, 20*time.Millisecond, func(ctx context.Context) (string, error) {
		calls.Add(1)
		<-ctx.Done()
		return "", ctx.Err()
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want deadline exceeded", err)
	}
	if n := calls.Load(); n != 2 {
		t.Fatalf("calls = %d, want 2 (one duplicate, never more)", n)
	}
}

func TestHedgeMarksOnlyTheDuplicate(t *testing.T) {
	var firstHedge, secondHedge atomic.Bool
	var calls atomic.Int32
	_, _ = Hedge(context.Background(), 20*time.Millisecond, func(ctx context.Context) (string, error) {
		if calls.Add(1) == 1 {
			firstHedge.Store(IsHedge(ctx))
			<-ctx.Done()
			return "", ctx.Err()
		}
		secondHedge.Store(IsHedge(ctx))
		return "ok", nil
	})
	if firstHedge.Load() || !secondHedge.Load() {
		t.Fatalf("IsHedge first=%v second=%v, want false/true", firstHedge.Load(), secondHedge.Load())
	}
}

func TestModelClientHasHTTP2HealthChecks(t *testing.T) {
	tr, ok := newModelHTTPClient().Transport.(*http.Transport)
	if !ok || tr.HTTP2 == nil || tr.HTTP2.SendPingTimeout <= 0 || tr.HTTP2.PingTimeout <= 0 {
		t.Fatalf("model transport lacks HTTP/2 health pings: %#v", tr)
	}
}
