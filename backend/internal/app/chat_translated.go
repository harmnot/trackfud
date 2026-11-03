package app

import (
	"context"
	"encoding/json"
)

// chatTranslatedFrame is the realtime frame both chat parties receive when a
// message's translation is stored, so an open thread shows it without a tap.
// `live` is true only when Muse Spark produced it (false = offline dictionary
// or passthrough), mirroring order_messages.translated_live.
func chatTranslatedFrame(orderID, messageID, translated, lang string, live bool) string {
	b, _ := json.Marshal(map[string]any{
		"type":            "chat.translated",
		"order_id":        orderID,
		"message_id":      messageID,
		"translated_body": translated,
		"lang":            lang,
		"live":            live,
	})
	return string(b)
}

// notifyChatTranslated pushes chatTranslatedFrame to the order's customer and
// to its courier when one is assigned.
func (s *Server) notifyChatTranslated(ctx context.Context, orderID, messageID, translated, lang string, live bool) {
	o, err := s.loadOrder(ctx, orderID)
	if err != nil {
		return
	}
	frame := chatTranslatedFrame(orderID, messageID, translated, lang, live)
	s.hub.Broadcast(o.CustomerID, frame)
	if d, derr := s.loadDeliveryByOrder(ctx, orderID); derr == nil && d.CourierID != nil {
		s.hub.Broadcast(*d.CourierID, frame)
	}
}
