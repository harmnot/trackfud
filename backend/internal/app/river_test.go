package app

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/riverqueue/river"
)

// Every kind string used by enqueue call sites must decode to typed args
// whose Kind() matches, and every Kind() must be distinct (River panics on
// duplicate registration).
func TestRiverJobArgsCoversAllEnqueueKinds(t *testing.T) {
	cases := []struct {
		kind    string
		payload string
		check   func(t *testing.T, args river.JobArgs)
	}{
		{JobEmailSend, `{"to":"a@x.io","subject":"s","body":"b"}`, func(t *testing.T, a river.JobArgs) {
			if got := a.(emailArgs).To; got != "a@x.io" {
				t.Fatalf("to = %q", got)
			}
		}},
		{JobPushSend, pushPayload("u1", "t", "b"), func(t *testing.T, a river.JobArgs) {
			if got := a.(pushArgs).UserID; got != "u1" {
				t.Fatalf("user_id = %q", got)
			}
		}},
		{JobMerchantAcceptTimeout, `{"order_id":"o1"}`, nil},
		{JobDispatchRun, `{"delivery_id":"d1"}`, nil},
		{JobOfferExpire, `{"offer_id":"of1"}`, nil},
		{JobDispatchRetry, `{"delivery_id":"d1"}`, nil},
		{JobSearchTimeout, `{"delivery_id":"d1"}`, nil},
		{JobStaffTimeout, `{"delivery_id":"d1"}`, nil},
		{JobLeaveNowNudge, `{"delivery_id":"d1"}`, nil},
		{JobRouteRefresh, `{"delivery_id":"d1"}`, nil},
		{JobAutoComplete, `{"order_id":"o1"}`, nil},
		{JobPayoutProcess, `{"withdrawal_id":"w1"}`, nil},
		{AIJobMenuImport, `{"import_job_id":"m1"}`, nil},
		{AIJobTranslate, `{"message_id":"msg1"}`, nil},
		{AIJobTrustBrief, `{"user_id":"u1"}`, nil},
		{AIJobProofCheck, `{"delivery_id":"d1","file_id":"f1"}`, nil},
		{AIJobFeedbackLabels, `{"order_id":"o1"}`, nil},
	}
	seen := map[string]string{}
	for _, tc := range cases {
		args, err := riverJobArgs(tc.kind, tc.payload)
		if err != nil {
			t.Fatalf("%s: decode: %v", tc.kind, err)
		}
		if args.Kind() != tc.kind {
			t.Fatalf("Kind() = %q, want %q", args.Kind(), tc.kind)
		}
		if prev, dup := seen[args.Kind()]; dup {
			t.Fatalf("duplicate Kind %q (also %s)", args.Kind(), prev)
		}
		seen[args.Kind()] = tc.kind
		// River stores args as JSON: the decoded struct must serialize back
		// to the same keys, or workers would see empty fields.
		raw, err := json.Marshal(args)
		if err != nil {
			t.Fatalf("%s: marshal: %v", tc.kind, err)
		}
		var back map[string]any
		if err := json.Unmarshal(raw, &back); err != nil {
			t.Fatalf("%s: remarshal: %v", tc.kind, err)
		}
		var want map[string]any
		if err := json.Unmarshal([]byte(tc.payload), &want); err != nil {
			t.Fatalf("%s: bad fixture: %v", tc.kind, err)
		}
		for k, v := range want {
			if !reflect.DeepEqual(back[k], v) {
				t.Fatalf("%s: round-trip key %q = %v, want %v", tc.kind, k, back[k], v)
			}
		}
		if tc.check != nil {
			tc.check(t, args)
		}
	}
	if len(seen) != 17 {
		t.Fatalf("covered %d kinds, want 17", len(seen))
	}
}

// Retry-style kinds dedupe per kind+args (the old enqueueUnlessPending
// SELECT guard); one-shot kinds insert freely.
func TestRiverUniqueOpts(t *testing.T) {
	for _, kind := range []string{JobDispatchRun, JobDispatchRetry, JobRouteRefresh} {
		if !riverUniqueOpts(kind).ByArgs {
			t.Fatalf("%s must be ByArgs-unique", kind)
		}
	}
	for _, kind := range []string{JobEmailSend, JobPushSend, JobSearchTimeout, JobStaffTimeout,
		JobLeaveNowNudge, JobOfferExpire, JobMerchantAcceptTimeout, JobAutoComplete,
		JobPayoutProcess, AIJobMenuImport, AIJobTranslate, AIJobTrustBrief, AIJobProofCheck, AIJobFeedbackLabels} {
		if riverUniqueOpts(kind).ByArgs {
			t.Fatalf("%s must NOT be ByArgs-unique", kind)
		}
	}
}

func TestRiverJobArgsRejectsBad(t *testing.T) {
	for _, tc := range []struct{ kind, payload string }{
		{"nope", `{}`},
		{JobEmailSend, `not-json`},
		{JobEmailSend, `{}`},
		{JobPushSend, `{}`},
		{JobDispatchRun, `{"delivery_id":""}`},
		{JobOfferExpire, `{}`},
		{JobMerchantAcceptTimeout, `{}`},
		{JobPayoutProcess, `{}`},
	} {
		if _, err := riverJobArgs(tc.kind, tc.payload); err == nil {
			t.Fatalf("%s %s: want error", tc.kind, tc.payload)
		}
	}
}

// Retry-safety at the enqueue layer: decoding the same payload twice yields
// identical args, so River's ByArgs uniqueness collapses a retried insert
// into one job. Handler-level double-delivery is covered by
// TestAIClaimDoubleDelivery and the status guards in each handle* method.
func TestRiverRetryDedupKey(t *testing.T) {
	for _, tc := range []struct{ kind, payload string }{
		{JobDispatchRetry, `{"delivery_id":"d1"}`},
		{JobDispatchRun, `{"delivery_id":"d1"}`},
		{JobRouteRefresh, `{"delivery_id":"d1"}`},
	} {
		a, err := riverJobArgs(tc.kind, tc.payload)
		if err != nil {
			t.Fatal(err)
		}
		b, err := riverJobArgs(tc.kind, tc.payload)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(a, b) {
			t.Fatalf("%s: same payload decoded differently", tc.kind)
		}
	}
}
