/**
 * Weekly AI Coach report (B6): measured stats plus a gentle plan from
 * `GET /courier/coach/weekly` (openapi `coachWeekly`). The body is
 * always labelled "not medical advice" via the server `advice_label`.
 */
import { fetchCoachWeekly, type CoachWeekly } from '../delivery/courierApi';

/** Load this week's coach report; throws a typed error when offline. */
export async function fetchCoach(): Promise<CoachWeekly> {
  return fetchCoachWeekly();
}

export type { CoachWeekly };
