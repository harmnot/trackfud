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
};

export type CourierApplication = {
  user_id: string;
  email: string;
  mode: string;
  status: string;
  reject_reason: string;
  fitness: CourierFitness;
  submitted_at: string | null;
  updated_at: string | null;
};

export type TrustBrief = {
  user_id: string;
  recommendation?: string;
  summary?: string;
  signals?: Array<{ label: string; value: string }>;
  [key: string]: unknown;
};

/** Courier profile for admin review (GET /v1/admin/courier-applications/{user_id}). */
export type CourierProfile = {
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
};

/** Courier application detail: review fields plus the saved profile. */
export type CourierApplicationDetail = {
  user_id: string;
  email: string;
  mode: string;
  status: string;
  reject_reason: string;
  fitness: Omit<CourierFitness, 'checkpoints'>;
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
  prep_minutes?: number;
  lat?: number;
  lng?: number;
  opening_hours?: Record<string, string>;
  agreement_signed_at?: string | null;
};

export const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function isStatus(s: string): s is ReviewStatus {
  return s === 'pending' || s === 'approved' || s === 'rejected';
}
