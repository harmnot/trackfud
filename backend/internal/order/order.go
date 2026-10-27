// Package order owns the Trackfud order state machine and fee math.
//
// The state machine mirrors docs/app-context.md §4: an Order tracks the
// kitchen and the money (awaiting_payment → placed → accepted → ready →
// picked_up → delivered → completed), while delivery assignment is handled
// separately (B4). Every change goes through Check/Transition so forbidden
// jumps are rejected before any database write.
//
// Money is integer minor units (ISO 4217) plus a currency code; fee math
// follows AGENTS.md §12 with half-up rounding. The courier always receives
// the remainder so each quote distributes exactly.
package order

import "errors"

// Order statuses (docs/app-context.md §4).
const (
	StatusAwaitingPayment = "awaiting_payment"
	StatusPlaced          = "placed"
	StatusAccepted        = "accepted"
	StatusReady           = "ready"
	StatusPickedUp        = "picked_up"
	StatusDelivered       = "delivered"
	StatusCompleted       = "completed"
	StatusRejected        = "rejected"
	StatusCancelled       = "cancelled"
)

// ErrForbiddenTransition is returned when a status jump is not allowed.
// ErrUnknownStatus is returned for a status outside the machine.
var (
	ErrForbiddenTransition = errors.New("order: forbidden transition")
	ErrUnknownStatus       = errors.New("order: unknown status")
)

// allowed maps each status to the statuses it may move to.
// Cancel rules per AGENTS.md §5: the customer may cancel only before the
// merchant accepts; after accept only support/admin cancels ( Casey P1);
// merchant accept timeout is enforced by the merchant_accept_timeout job.
var allowed = map[string][]string{
	StatusAwaitingPayment: {StatusPlaced, StatusCancelled},
	StatusPlaced:          {StatusAccepted, StatusRejected, StatusCancelled},
	StatusAccepted:        {StatusReady, StatusCancelled},
	StatusReady:           {StatusPickedUp},
	StatusPickedUp:        {StatusDelivered},
	StatusDelivered:       {StatusCompleted},
	StatusCompleted:       {},
	StatusRejected:        {},
	StatusCancelled:       {},
}

// Can reports whether moving from one status to another is allowed.
func Can(from, to string) bool {
	next, ok := allowed[from]
	if !ok {
		return false
	}
	for _, s := range next {
		if s == to {
			return true
		}
	}
	return false
}

// Check validates a transition, distinguishing unknown statuses from
// forbidden jumps so callers can map them to the right problem response.
func Check(from, to string) error {
	if _, ok := allowed[from]; !ok {
		return ErrUnknownStatus
	}
	if _, ok := allowed[to]; !ok {
		return ErrUnknownStatus
	}
	if !Can(from, to) {
		return ErrForbiddenTransition
	}
	return nil
}

// Terminal reports whether no further transition leaves the status.
func Terminal(s string) bool {
	next, ok := allowed[s]
	return ok && len(next) == 0
}

// Fee rates in basis points (AGENTS.md §12).
const (
	CommissionBps      = 1000 // 10% restaurant commission
	CommissionStaffBps = 500  // 5% when the merchant's own staff delivers
	ServiceFeeBps      = 300  // 3% customer service fee
	CourierFeeBps      = 500  // 5% platform share of the delivery fee
)

// FeeSchedule carries the per-currency delivery-fee shape and the
// service-fee min/max clamp (all in that currency's minor units).
type FeeSchedule struct {
	DeliveryBaseMinor  int64
	DeliveryPerKmMinor int64
	DeliveryMaxMinor   int64
	ServiceMinMinor    int64
	ServiceMaxMinor    int64
}

// Schedules per AGENTS.md §12 (USD defaults; IDR values from the worked
// example; GBP mirrors USD). Unknown currencies fall back to USD.
var Schedules = map[string]FeeSchedule{
	"USD": {DeliveryBaseMinor: 100, DeliveryPerKmMinor: 35, DeliveryMaxMinor: 350, ServiceMinMinor: 10, ServiceMaxMinor: 99},
	"GBP": {DeliveryBaseMinor: 100, DeliveryPerKmMinor: 35, DeliveryMaxMinor: 350, ServiceMinMinor: 10, ServiceMaxMinor: 99},
	"IDR": {DeliveryBaseMinor: 5000, DeliveryPerKmMinor: 1500, DeliveryMaxMinor: 15000, ServiceMinMinor: 1000, ServiceMaxMinor: 5000},
}

// ScheduleFor returns the fee schedule for a currency, defaulting to USD.
func ScheduleFor(currency string) FeeSchedule {
	if s, ok := Schedules[currency]; ok {
		return s
	}
	return Schedules["USD"]
}

// mulBps multiplies minor units by basis points with half-up rounding.
func mulBps(v int64, bps int) int64 {
	if v <= 0 {
		return 0
	}
	return (v*int64(bps) + 5000) / 10000
}

// DeliveryFee quotes the customer-facing delivery fee for a trip length.
func DeliveryFee(distanceKm float64, sched FeeSchedule) int64 {
	if distanceKm < 0 {
		distanceKm = 0
	}
	fee := float64(sched.DeliveryBaseMinor) + distanceKm*float64(sched.DeliveryPerKmMinor)
	if fee > float64(sched.DeliveryMaxMinor) {
		fee = float64(sched.DeliveryMaxMinor)
	}
	return int64(fee + 0.5)
}

// ServiceFee is 3% of the food subtotal, clamped to the currency min/max.
func ServiceFee(subtotalMinor int64, sched FeeSchedule) int64 {
	fee := mulBps(subtotalMinor, ServiceFeeBps)
	if fee < sched.ServiceMinMinor {
		return sched.ServiceMinMinor
	}
	if fee > sched.ServiceMaxMinor {
		return sched.ServiceMaxMinor
	}
	return fee
}

// Commission is the restaurant's cut of the food subtotal.
func Commission(subtotalMinor int64, staffDelivery bool) int64 {
	if staffDelivery {
		return mulBps(subtotalMinor, CommissionStaffBps)
	}
	return mulBps(subtotalMinor, CommissionBps)
}

// CourierFee is the platform's 5% share of the delivery fee.
func CourierFee(deliveryMinor int64) int64 {
	return mulBps(deliveryMinor, CourierFeeBps)
}

// Quote is a fully computed order price. Payout fields always satisfy:
// MerchantPayout + CourierPayout + PlatformTake == Total.
type Quote struct {
	Currency        string
	SubtotalMinor   int64
	DeliveryMinor   int64
	ServiceMinor    int64
	TipMinor        int64
	TotalMinor      int64
	CommissionMinor int64
	CourierFeeMinor int64
	MerchantPayout  int64
	CourierPayout   int64
	PlatformTake    int64
}

// QuoteInput prices one order.
type QuoteInput struct {
	SubtotalMinor int64
	DistanceKm    float64
	Currency      string
	StaffDelivery bool
	TipMinor      int64
}

// QuoteFor computes every amount for an order. The courier receives the
// remainder after the rounded platform fee, so the split sums exactly.
func QuoteFor(in QuoteInput) Quote {
	sched := ScheduleFor(in.Currency)
	if in.SubtotalMinor < 0 {
		in.SubtotalMinor = 0
	}
	if in.TipMinor < 0 {
		in.TipMinor = 0
	}
	delivery := DeliveryFee(in.DistanceKm, sched)
	service := ServiceFee(in.SubtotalMinor, sched)
	commission := Commission(in.SubtotalMinor, in.StaffDelivery)
	courierFee := CourierFee(delivery)
	total := in.SubtotalMinor + delivery + service + in.TipMinor
	return Quote{
		Currency:        in.Currency,
		SubtotalMinor:   in.SubtotalMinor,
		DeliveryMinor:   delivery,
		ServiceMinor:    service,
		TipMinor:        in.TipMinor,
		TotalMinor:      total,
		CommissionMinor: commission,
		CourierFeeMinor: courierFee,
		MerchantPayout:  in.SubtotalMinor - commission,
		CourierPayout:   delivery - courierFee + in.TipMinor,
		PlatformTake:    commission + service + courierFee,
	}
}
