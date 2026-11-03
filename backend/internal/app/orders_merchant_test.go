package app

import "testing"

// Merchant order views must carry the same live-dispatch shape on every
// merchant path (PLAN.md §9: "Merchant: courier approaching + ETA").
// The merchant PWA reads `order.delivery.status` / `order.delivery.eta_s`
// straight off list rows, and the merchant detail route serves the same
// full delivery view as the customer detail route. The builders below lock
// that equalized contract (openapi.yaml `Order.delivery`).

func TestMerchantDeliveryLineShape(t *testing.T) {
	eta := 480
	name, mode := "Ali", "biker"
	m := merchantDeliveryLine("assigned", &eta, &name, &mode)
	if m["status"] != "assigned" {
		t.Fatalf("delivery line status not carried through: %v", m)
	}
	if m["eta_s"] != 480 {
		t.Fatalf("delivery line eta_s not carried through: %v", m)
	}
	if m["courier_name"] != "Ali" || m["courier_mode"] != "biker" {
		t.Fatalf("delivery line must carry the assigned courier: %v", m)
	}
	// No courier yet: ETA + identity render as JSON null, keys always present
	// so the merchant PWA can tell "searching" apart from "no data".
	m = merchantDeliveryLine("searching", nil, nil, nil)
	if _, ok := m["eta_s"]; !ok {
		t.Fatalf("delivery line eta_s key missing: %v", m)
	}
	if m["eta_s"] != nil {
		t.Fatalf("delivery line eta_s should be null without a courier: %v", m)
	}
	if m["courier_name"] != nil || m["courier_mode"] != nil {
		t.Fatalf("delivery line must not invent a courier before assignment: %v", m)
	}
}

func TestBuildMerchantOrderDetailShape(t *testing.T) {
	base := map[string]any{"id": "order-1", "pickup_code": "123456"}
	items := []map[string]any{{"menu_item_id": "m1", "qty": 2}}
	events := []map[string]any{{"from": "placed", "to": "accepted"}}
	delivery := map[string]any{"status": "assigned", "eta_s": 480}
	v := buildOrderDetail(base, items, events, delivery)
	for _, k := range []string{"id", "pickup_code", "items", "events", "delivery"} {
		if _, ok := v[k]; !ok {
			t.Fatalf("merchant order detail missing key %q: %v", k, v)
		}
	}
	if v["pickup_code"] != "123456" {
		t.Fatalf("merchant order detail lost pickup_code: %v", v)
	}
	if _, ok := v["delivery_pin"]; ok {
		t.Fatalf("merchant order detail must never carry the customer PIN: %v", v)
	}
	if (v["items"].([]map[string]any))[0]["qty"] != 2 {
		t.Fatalf("merchant order detail items not carried through: %v", v)
	}
	if (v["delivery"].(map[string]any))["status"] != "assigned" {
		t.Fatalf("merchant order detail delivery not carried through: %v", v)
	}
}

func TestBuildOrderDetailWithoutDelivery(t *testing.T) {
	base := map[string]any{"id": "order-2", "delivery_pin": "9999"}
	v := buildOrderDetail(base, nil, nil, nil)
	if _, ok := v["delivery"]; ok {
		t.Fatalf("order detail without dispatch must not carry delivery: %v", v)
	}
	if v["delivery_pin"] != "9999" {
		t.Fatalf("order detail must preserve the caller role view: %v", v)
	}
}
