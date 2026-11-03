/** Back-office detail pages (barrel). Implementation lives in `./detail/`
 * modules so Courier + Merchant stay independently maintainable:
 * - `./detail/CourierDetail.tsx` — application + profile + fitness + evidence + trust brief
 * - `./detail/MerchantDetail.tsx` — business + operations + hours + agreement + staff
 * - `./detail/DecisionCard.tsx` — Approve / two-step Reject (+ gated placeholder)
 * - `./detail/SanctionCard.tsx` — freeze/ban/unban + history
 * - `./detail/fields.tsx` — interactive card fields (mailto/tel/maps/copy,
 *   AddressBlock, ContactBlock, BikeBlock, ConsentsBlock, HoursList,
 *   StaffList, AgreementBlock, ReviewOutcome)
 * - `./detail/evidence.tsx` — authed FileImage + EvidenceCard (fetchFileBlob)
 * - `./detail/review.ts` + `./detail/useReview.ts` — DECIDABLE_APPLICATION,
 *   detailRetry, useDecide/useSanction
 *
 * Contract endpoints used (see backend/api/openapi.yaml):
 * - `/admin/courier-applications/${userId}` + `/trust-brief`
 * - `/admin/courier-applications/${id}/approve|reject` (rejection reason is required)
 * - `/admin/couriers/${id}/sanctions`
 * - `/admin/merchants/${id}` + `/admin/merchants/${id}/approve|reject|sanctions`
 * Merchant approve/reject render only when status === 'pending' with the
 * signed agreement; rejected merchants show reject_reason + updated_at.
 */
export { CourierDetail } from './detail/CourierDetail';
export { MerchantDetail } from './detail/MerchantDetail';
