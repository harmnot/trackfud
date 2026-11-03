/** Shared admin CMS domain types (wire shapes from the backend API). */

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export type CourierFitness = {
  distance_m: number;
  moving_s: number;
  elapsed_s: number;
  passed: boolean;
  flags: string[];
  max_gap_s: number;
  checkpoints: number;
  checkpoint_file_ids?: string[];
};

export type CourierApplication = {
  user_id: string;
  email: string;
  mode: string;
  status: string;
  /** Operational standing from sanctions (frozen/banned); empty when none. */
  standing?: string;
  reject_reason: string;
  fitness: CourierFitness;
  submitted_at: string | null;
  updated_at: string | null;
};

/**
 * Trust-brief wire shape from GET /v1/admin/courier-applications/{user_id}/trust-brief.
 * Either `{ pending: true }` (worker still running) or the advisory brief, where
 * `reasons` is a free-form list and `risk`/`photo_note` are plain strings.
 */
export type TrustBrief = {
  pending?: boolean;
  user_id?: string;
  risk?: string;
  advisory?: boolean;
  summary?: string;
  reasons?: unknown;
  photo_note?: string;
  fallback?: boolean;
  created_at?: string;
  recommendation?: string;
  signals?: Array<{ label: string; value: unknown }>;
};

/** Courier profile for admin review (GET /v1/admin/courier-applications/{user_id}). */
export type CourierProfile = {
  mode?: string;
  status?: string;
  /** Operational standing from the couriers row (frozen/banned); empty when none. */
  standing?: string;
  legal_name?: string;
  phone?: string;
  nationality?: string;
  birth_date?: string;
  id_doc_type?: string;
  id_number_saved?: boolean;
  id_front_file_id?: string;
  id_back_file_id?: string;
  selfie_file_id?: string;
  bag_liters?: number;
  address?: Record<string, unknown>;
  emergency_contact?: Record<string, unknown>;
  bike?: Record<string, unknown>;
  consents?: Record<string, unknown>;
  approved_at?: string | null;
};

/** Courier application detail: review fields plus the saved profile. */
export type CourierApplicationDetail = {
  user_id: string;
  email: string;
  mode: string;
  status: string;
  /** Operational standing from sanctions (frozen/banned); empty when none. */
  standing?: string;
  reject_reason: string;
  submitted_at?: string | null;
  updated_at?: string | null;
  fitness: CourierFitness;
  profile: CourierProfile;
};

/** Merchant agreement + staff for admin review (GET /v1/admin/merchants/{id}). */
export type MerchantDetail = MerchantRecord & {
  owner_id: string;
  email: string;
  agreement?: {
    signed?: boolean;
    version?: string;
    signer_name?: string;
    agreed?: boolean;
    signed_at?: string | null;
    text?: string;
    sha256?: string;
  };
  staff?: Array<{
    id: string;
    email: string;
    role: string;
    can_deliver: boolean;
    on_shift: boolean;
    status: string;
  }>;
};

/**
 * One opening-hours entry: a plain string ("09:00-22:00"), a structured
 * `{ open, close }` object (backend `map[string]any` shape), or null when closed.
 */
export type OpeningHoursValue = string | { open?: unknown; close?: unknown } | null;

/** Merchant review record. Served by GET /v1/admin/merchants when available. */
export type MerchantRecord = {
  id: string;
  name: string;
  phone?: string;
  country?: string;
  currency?: string;
  timezone?: string;
  address?: string;
  pickup_note?: string;
  status: string;
  /** Admin rejection reason (empty unless status is rejected). */
  reject_reason?: string;
  prep_minutes?: number;
  lat?: number;
  lng?: number;
  opening_hours?: Record<string, OpeningHoursValue>;
  agreement_signed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/**
 * One sanction row. Courier rows use `reason_code` (+ optional `ends_at`);
 * merchant rows use `reason` + `prev_status` (status restored on unban).
 */
export type Sanction = {
  id: string;
  kind: string;
  reason_code?: string;
  reason?: string;
  note?: string;
  prev_status?: string;
  starts_at?: string;
  ends_at?: string | null;
  created_by?: string;
  created_at?: string;
};

export const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'frozen', 'banned'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function isStatus(s: string): s is ReviewStatus {
  return s === 'pending' || s === 'approved' || s === 'rejected';
}
