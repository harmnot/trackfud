/**
 * Courier delivery-leg API: thin typed wrappers over the real backend
 * endpoints from `backend/api/openapi.yaml` (B4 dispatch payouts, B5
 * wallet, B6 voice/coach). Paths here are relative to `/api/v1` (see
 * `lib/api.ts`); operationIds are noted per function. No demo fallbacks
 * in this module — callers decide how to degrade (offline queue, honest
 * labels) and log through `lib/logger`.
 */
import { ApiError, api } from '../../lib/api';

/** `true` when the backend cannot serve the call (offline / unknown route). */
export function isMissingBackend(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}

/** Integer minor units, ISO-4217 (never floats). */
export type Money = { amount_minor: number; currency: string };

/** `GET /courier/offers` item (openapi `Offer`). */
export type ServerOffer = {
  id: string;
  delivery_id: string;
  kind: string;
  status: string;
  expires_at: string;
  seconds_left: number;
  order: {
    merchant_name: string;
    to_pickup_m: number;
    trip_m: number;
    payout_minor: number;
    currency: string;
    size_class: string;
    spill_risk: string;
    ready_at_est: string;
    window_end: string;
  };
};

/** `Delivery` inside `DeliveryEnvelope`. */
export type ServerDelivery = {
  id: string;
  order_id: string;
  type: string;
  status: string;
  order_status: string;
  currency: string;
  pickup: { merchant_name: string; lat: number; lng: number; note: string; address: string };
  eta_s: number;
  route_polyline: string;
  route_warning: string;
  size_class: string;
  spill_risk: string;
  ready_at_est: string;
  window_end: string;
  nudged: boolean;
  assigned_at: string;
};

/** `DeliveryEnvelope`: delivery + measured impact + payout. */
export type DeliveryEnvelope = {
  delivery: ServerDelivery;
  impact?: { distance_m: number; active_s: number };
  payout?: Money;
};

/** One chat line from `MessageList` (openapi `Message`). */
export type ServerMessage = {
  id: string;
  sender: string;
  body: string;
  lang: string;
  translated_body: string;
  created_at: string;
};

/** One row of `Earnings.earnings` (per currency). */
export type EarningsRow = {
  currency: string;
  balance: Money;
  lifetime_earned: Money;
  reserved: Money;
  withdrawable: Money;
};

/** One row of `WithdrawalList` (openapi `Withdrawal`). */
export type WithdrawalRow = {
  id: string;
  courier_id: string;
  status: string;
  amount: Money;
  hold_reason: string;
  failure_reason: string;
  payout_ref: string;
  created_at: string;
};

/** `GET /courier/coach/weekly` (openapi `CoachWeekly`). */
export type CoachWeekly = {
  distance_m: number;
  active_s: number;
  active_min: number;
  who_goal_min: number;
  sessions: number;
  deliveries: number;
  earned: Money;
  headline: string;
  body: string;
  next_plan: string;
  advice_label: string;
  live: boolean;
};

/** One row of `DeliveryHistory.deliveries` (ratings source, names hidden). */
export type DeliveryHistoryRow = {
  delivery_id: string;
  type: string;
  order_code: string;
  payout: Money;
  merchant_name: string;
  distance_m: number;
  active_s: number;
  courier_stars: number;
  delivered_at: string;
};

/** Server voice intent frame (openapi `GET /courier/voice` replies). */
export type VoiceIntentFrame = {
  intent: string;
  reply_text: string;
  offer_id: string | null;
  confirmation: string | null;
  live: boolean;
};

/** List pending dispatch offers (openapi `listOffers`). */
export async function listOffers(): Promise<ServerOffer[]> {
  const res = await api<{ offers: ServerOffer[] }>('/courier/offers');
  return res.offers ?? [];
}

/** List pending staff fallback offers (openapi `listStaffOffers`). */
export async function listStaffOffers(): Promise<ServerOffer[]> {
  const res = await api<{ offers: ServerOffer[] }>('/courier/staff/offers');
  return res.offers ?? [];
}

/** Accept a dispatch offer (openapi `acceptOffer`; 409/410 = taken). */
export async function acceptOffer(args: { offerId: string }): Promise<DeliveryEnvelope> {
  return api<DeliveryEnvelope>(`/courier/offers/${args.offerId}/accept`, { method: 'POST' });
}

/** Decline a dispatch offer, never penalised (openapi `declineOffer`). */
export async function declineOffer(args: { offerId: string }): Promise<void> {
  await api(`/courier/offers/${args.offerId}/decline`, { method: 'POST' });
}

/** Accept a staff fallback offer (openapi `acceptStaffOffer`). */
export async function acceptStaffOffer(args: { offerId: string }): Promise<DeliveryEnvelope> {
  return api<DeliveryEnvelope>(`/courier/staff/offers/${args.offerId}/accept`, { method: 'POST' });
}

/**
 * Current assigned delivery, or null when there is none (openapi
 * `activeDelivery`; a 404 means "nothing assigned", not an error).
 */
export async function fetchActiveDelivery(): Promise<DeliveryEnvelope | null> {
  try {
    return await api<DeliveryEnvelope>('/courier/deliveries/active');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Mark arrival at the restaurant or the customer (openapi `arrivedDelivery`). */
export async function markArrived(args: { deliveryId: string; at: 'pickup' | 'dropoff' }): Promise<DeliveryEnvelope> {
  return api<DeliveryEnvelope>(`/courier/deliveries/${args.deliveryId}/arrived`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ at: args.at }),
  });
}

/** Confirm pickup with the merchant's 4-digit code (openapi `pickupDelivery`). */
export async function confirmPickup(args: { deliveryId: string; code: string }): Promise<DeliveryEnvelope> {
  return api<DeliveryEnvelope>(`/courier/deliveries/${args.deliveryId}/pickup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pickup_code: args.code }),
  });
}

/** Complete the handover with the customer PIN or a photo (openapi `deliveredDelivery`). */
export async function confirmDropoff(args: {
  deliveryId: string;
  pin: string | null;
  photoFileId: string | null;
}): Promise<DeliveryEnvelope> {
  return api<DeliveryEnvelope>(`/courier/deliveries/${args.deliveryId}/delivered`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: args.pin, proof_file_id: args.photoFileId }),
  });
}

/** Read the courier↔customer thread (openapi `listCourierMessages`). */
export async function fetchMessages(args: { deliveryId: string }): Promise<ServerMessage[]> {
  const res = await api<{ messages: ServerMessage[] }>(`/courier/deliveries/${args.deliveryId}/messages`);
  return res.messages ?? [];
}

/** Send one chat line (openapi `postCourierMessage`). */
export async function sendChat(args: { deliveryId: string; text: string; lang: string }): Promise<void> {
  await api(`/courier/deliveries/${args.deliveryId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: args.text, lang: args.lang }),
  });
}

/** Translate one message server-side (openapi `translateCourierMessage`). */
export async function translateMessage(args: {
  deliveryId: string;
  messageId: string;
  to: string;
}): Promise<{ translated: string; moderated: boolean; flagged: boolean; live: boolean }> {
  const res = await api<{ translated_body: string; moderated: boolean; flagged: boolean; live: boolean }>(
    `/courier/deliveries/${args.deliveryId}/messages/translate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: args.messageId, to: args.to }),
    },
  );
  return { translated: res.translated_body, moderated: res.moderated, flagged: res.flagged, live: res.live };
}

/** Live earnings per currency (openapi `getEarnings`, B5). */
export async function fetchEarnings(): Promise<EarningsRow[]> {
  const res = await api<{ earnings: EarningsRow[] }>('/courier/earnings');
  return res.earnings ?? [];
}

/** Withdrawal history (openapi `listWithdrawals`, B5). */
export async function listWithdrawals(): Promise<WithdrawalRow[]> {
  const res = await api<{ withdrawals: WithdrawalRow[] }>('/courier/withdrawals');
  return res.withdrawals ?? [];
}

/** Request a payout; idempotent on retry (openapi `createWithdrawal`, B5). */
export async function createWithdrawal(args: { amountMinor: number; currency: string }): Promise<WithdrawalRow> {
  const res = await api<{ withdrawal: WithdrawalRow }>('/courier/withdrawals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ amount_minor: args.amountMinor, currency: args.currency }),
  });
  return res.withdrawal;
}

/** Delivery history with courier stars (openapi `listDeliveryHistory`). */
export async function fetchDeliveryHistory(): Promise<DeliveryHistoryRow[]> {
  const res = await api<{ deliveries: DeliveryHistoryRow[] }>('/courier/deliveries/history');
  return res.deliveries ?? [];
}

/** Weekly AI coach stats + plan, not medical advice (openapi `coachWeekly`, B6). */
export async function fetchCoachWeekly(): Promise<CoachWeekly> {
  return api<CoachWeekly>('/courier/coach/weekly');
}

/**
 * Execute a voice accept proposal after the relay signs it (openapi
 * `voiceConfirm`, B6). Re-checks offer state server-side; 409/410 means
 * the offer is gone.
 */
export async function confirmVoiceAccept(args: { offerId: string; confirmation: string }): Promise<DeliveryEnvelope> {
  return api<DeliveryEnvelope>('/courier/voice/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer_id: args.offerId, confirmation: args.confirmation }),
  });
}

/** One roster row from `GET /courier/staff/memberships` (openapi `listMemberships`). */
export type StaffMembership = {
  merchant_id: string;
  merchant_name: string;
  can_deliver: boolean;
  on_shift: boolean;
  status: string;
};

/**
 * Restaurants where this account's email is on the staff roster
 * (openapi `listMemberships`). The merchant invites by email; no codes.
 */
export async function fetchMemberships(): Promise<StaffMembership[]> {
  const res = await api<{ memberships: StaffMembership[] }>('/courier/staff/memberships');
  return res.memberships ?? [];
}

/**
 * Clock a staff member on/off shift. `merchantId` comes from
 * `fetchMemberships` (openapi `staffShift`).
 */
export async function setStaffShift(args: { merchantId: string; onShift: boolean }): Promise<void> {
  await api('/courier/staff/shift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchant_id: args.merchantId, on_shift: args.onShift }),
  });
}
