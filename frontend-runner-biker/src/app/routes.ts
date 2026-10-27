/** Canonical route table for the Courier PWA (used by App + smoke test). */

export const ROUTES = {
  onboarding: '/onboarding',
  checklist: '/checklist',
  fitness: '/fitness',
  status: '/status',
  runSetup: '/run-setup',
  run: '/run',
  delivery: '/delivery',
  wallet: '/wallet',
  staff: '/staff',
  tracks: '/tracks',
  chat: '/chat',
  ratings: '/ratings',
  login: '/login',
  signup: '/signup',
} as const;

export type RouteKey = keyof typeof ROUTES;

/** Every path the router must serve (smoke-tested). */
export const ALL_PATHS: readonly string[] = Object.values(ROUTES);
