/** C3 post-delivery domain (ratings, impact, chat, cheers, no-courier, receipts).
 *
 * Source of truth is `backend/api/openapi.yaml`: ratings, cheers, messages,
 * delivery-choice, impact, and message translate all have real endpoints, so
 * writes below go to the server first and only queue in the offline outbox
 * (`outbox.ts`) when the network fails. Nothing here invents fees, roles, or
 * statuses from `docs/app-context.md`. */

export type Stars = 1 | 2 | 3 | 4 | 5;
export const STAR_VALUES: Stars[] = [1, 2, 3, 4, 5];

export type RatingTarget = 'courier' | 'restaurant';

export const COURIER_TAGS = ['friendly', 'careful', 'on_time', 'great_chat'] as const;
export type CourierTag = (typeof COURIER_TAGS)[number];

export const RESTAURANT_TAGS = ['tasty', 'well_packed', 'good_portion', 'as_described'] as const;
export type RestaurantTag = (typeof RESTAURANT_TAGS)[number];

/** One submitted rating. `synced` flips true once the server accepts it. */
export type Rating = {
  orderId: string;
  target: RatingTarget;
  stars: Stars;
  tags: string[];
  note: string;
  createdAt: string;
  synced: boolean;
};

function isStars(n: unknown): n is Stars {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5;
}

/** Narrow an unknown stored payload to a `Rating`. */
export function parseRating(raw: unknown): Rating | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['orderId'] !== 'string') return null;
  if (m['target'] !== 'courier' && m['target'] !== 'restaurant') return null;
  if (!isStars(m['stars'])) return null;
  if (!Array.isArray(m['tags']) || !m['tags'].every((t) => typeof t === 'string')) return null;
  if (typeof m['note'] !== 'string' || typeof m['createdAt'] !== 'string') return null;
  return {
    orderId: m['orderId'],
    target: m['target'],
    stars: m['stars'],
    tags: m['tags'],
    note: m['note'],
    createdAt: m['createdAt'],
    synced: m['synced'] === true,
  };
}

/** Canonical quick replies: a closed set, so each one is fully translated in
 * `locales/` and renders in the reader's language in both directions. */
export const QUICK_REPLY_IDS = ['at_gate', 'take_your_time', 'thank_you'] as const;
export type QuickReplyId = (typeof QUICK_REPLY_IDS)[number];

export function isQuickReplyId(v: unknown): v is QuickReplyId {
  return v === 'at_gate' || v === 'take_your_time' || v === 'thank_you';
}

export type ChatSide = 'me' | 'them';

/** One chat message. Free text keeps its `lang` + original; quick replies
 * carry a `canonicalId` so both sides read them translated. `serverId` links
 * a local row to its stored `order_messages` row for translate calls. */
export type ChatMessage = {
  id: string;
  orderId: string;
  from: ChatSide;
  text: string;
  canonicalId: QuickReplyId | null;
  lang: string;
  at: string;
  synced: boolean;
  serverId: string | null;
  translated: string | null;
};

/** Narrow an unknown payload (storage or WS) to a `ChatMessage`. */
export function parseChatMessage(raw: unknown): ChatMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['id'] !== 'string' || typeof m['orderId'] !== 'string') return null;
  if (m['from'] !== 'me' && m['from'] !== 'them') return null;
  if (typeof m['text'] !== 'string' || typeof m['lang'] !== 'string') return null;
  if (typeof m['at'] !== 'string') return null;
  const cid = m['canonicalId'];
  if (cid !== null && cid !== undefined && !isQuickReplyId(cid)) return null;
  return {
    id: m['id'],
    orderId: m['orderId'],
    from: m['from'],
    text: m['text'],
    canonicalId: isQuickReplyId(cid) ? cid : null,
    lang: m['lang'],
    at: m['at'],
    synced: m['synced'] === true,
    serverId: typeof m['serverId'] === 'string' ? m['serverId'] : null,
    translated: typeof m['translated'] === 'string' ? m['translated'] : null,
  };
}

/** Narrow an unknown WS payload to an incoming `chat.message`.
 * Accepts the server wire shape (`order_id` + `message_id` + `sender` +
 * `body`) as well as a full stored message under `message`. */
export function parseWsChatMessage(raw: unknown): ChatMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m['type'] !== 'chat.message') return null;
  if (m['message'] !== undefined) return parseChatMessage(m['message']);
  if (typeof m['order_id'] !== 'string' || typeof m['body'] !== 'string') return null;
  const sender = m['sender'];
  if (sender !== 'customer' && sender !== 'courier') return null;
  return {
    id: typeof m['message_id'] === 'string' ? m['message_id'] : crypto.randomUUID(),
    orderId: m['order_id'],
    from: sender === 'customer' ? 'me' : 'them',
    text: m['body'],
    canonicalId: null,
    lang: '',
    at: new Date().toISOString(),
    synced: true,
    serverId: typeof m['message_id'] === 'string' ? m['message_id'] : null,
    translated: null,
  };
}

export const CHEER_IDS = ['muscle', 'party', 'go_run'] as const;
export type CheerId = (typeof CHEER_IDS)[number];

/** A cheer the courier hears read aloud by the Voice Copilot while running. */
export type Cheer = {
  id: string;
  orderId: string;
  cheerId: CheerId | null;
  text: string;
  at: string;
  synced: boolean;
};

export type NoCourierChoice = 'wait' | 'pickup' | 'cancel';

/** Map a local choice to the `POST .../delivery-choice` wire value. */
export function toServerChoice(choice: NoCourierChoice): 'wait_more' | 'pickup' | 'cancel' {
  if (choice === 'wait') return 'wait_more';
  return choice;
}

/** Courier search runs 4 min before staff fallback; the customer waits in
 * `placed` all along, so age the order client-side from `created_at`. */
export const NO_COURIER_SEARCH_S = 240;
/** "Wait 5 more min" snooze before the panel nudges again. */
export const NO_COURIER_SNOOZE_S = 300;

/** Powered distance for one order. `estimated` is false when the server
 * measured the real carry with courier GPS. */
export type Impact = {
  orderId: string;
  distanceKm: number;
  activeMin: number;
  estimated: boolean;
};

/** One entry of the server `recent` impact list (measured carry). */
export type ImpactRecent = {
  orderCode: string;
  courierFirstName: string;
  distanceM: number;
  activeS: number;
  deliveredAt: string;
};

/** Measured customer impact from `GET /v1/customer/impact`. */
export type ServerImpact = {
  ordersDelivered: number;
  couriersSupported: number;
  distanceM: number;
  activeS: number;
  recent: ImpactRecent[];
};

/** Narrow an unknown payload to a `ServerImpact`. */
export function parseServerImpact(raw: unknown): ServerImpact | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['orders_delivered'] !== 'number') return null;
  if (typeof m['couriers_supported'] !== 'number') return null;
  if (typeof m['distance_m'] !== 'number' || typeof m['active_s'] !== 'number') return null;
  const recent: ImpactRecent[] = [];
  if (Array.isArray(m['recent'])) {
    for (const row of m['recent']) {
      if (typeof row !== 'object' || row === null) continue;
      const r = row as Record<string, unknown>;
      if (typeof r['order_code'] !== 'string') continue;
      recent.push({
        orderCode: r['order_code'],
        courierFirstName: typeof r['courier_first_name'] === 'string' ? r['courier_first_name'] : '',
        distanceM: typeof r['distance_m'] === 'number' ? r['distance_m'] : 0,
        activeS: typeof r['active_s'] === 'number' ? r['active_s'] : 0,
        deliveredAt: typeof r['delivered_at'] === 'string' ? r['delivered_at'] : '',
      });
    }
  }
  return {
    ordersDelivered: m['orders_delivered'],
    couriersSupported: m['couriers_supported'],
    distanceM: m['distance_m'],
    activeS: m['active_s'],
    recent,
  };
}

/** One stored message from `GET .../messages` (server shape). */
export type ServerMessage = {
  id: string;
  sender: 'customer' | 'courier';
  body: string;
  lang: string;
  translatedBody: string | null;
  createdAt: string;
};

/** Narrow an unknown payload to a `ServerMessage`. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['id'] !== 'string') return null;
  if (m['sender'] !== 'customer' && m['sender'] !== 'courier') return null;
  if (typeof m['body'] !== 'string') return null;
  return {
    id: m['id'],
    sender: m['sender'],
    body: m['body'],
    lang: typeof m['lang'] === 'string' ? m['lang'] : '',
    translatedBody: typeof m['translated_body'] === 'string' ? m['translated_body'] : null,
    createdAt: typeof m['created_at'] === 'string' ? m['created_at'] : '',
  };
}

/** Result of `POST .../messages/translate` (B6 live or dictionary fallback). */
export type TranslateResult = {
  translatedBody: string;
  moderated: boolean;
  flagged: boolean;
  live: boolean;
};

/** Narrow an unknown payload to a `TranslateResult`. */
export function parseTranslateResult(raw: unknown): TranslateResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['translated_body'] !== 'string') return null;
  return {
    translatedBody: m['translated_body'],
    moderated: m['moderated'] === true,
    flagged: m['flagged'] === true,
    live: m['live'] === true,
  };
}

/** Planning speed used only for the active-minute estimate (runner pace). */
export const IMPACT_PLANNING_KMH = 9;
