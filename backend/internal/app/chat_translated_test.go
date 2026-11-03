package app

import (
	"encoding/json"
	"testing"
)

func TestChatTranslatedFrame(t *testing.T) {
	raw := chatTranslatedFrame("ord-1", "msg-9", "Saya di lobi, di sebelah air mancur.", "id", true)
	var f map[string]any
	if err := json.Unmarshal([]byte(raw), &f); err != nil {
		t.Fatalf("frame is not JSON: %v (%s)", err, raw)
	}
	want := map[string]any{
		"type": "chat.translated", "order_id": "ord-1", "message_id": "msg-9",
		"translated_body": "Saya di lobi, di sebelah air mancur.", "lang": "id", "live": true,
	}
	for k, v := range want {
		if f[k] != v {
			t.Errorf("%s = %v, want %v", k, f[k], v)
		}
	}
	if len(f) != len(want) {
		t.Errorf("unexpected fields in %s", raw)
	}
}
