/**
 * Route smoke test: every CMS route must be served by App.tsx, admin API
 * calls must match real backend/openapi paths, and no review data may be
 * hardcoded. Run: `node scripts/route-smoke.mjs`.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const authSrc = readFileSync(join(root, 'src/features/auth.tsx'), 'utf8');
const dashSrc = readFileSync(join(root, 'src/features/dashboard.tsx'), 'utf8');
const detailSrc = readFileSync(join(root, 'src/features/detail.tsx'), 'utf8');
const apiSrc = readFileSync(join(root, 'src/lib/api.ts'), 'utf8');
const all = appSrc + authSrc + dashSrc + detailSrc + apiSrc;
const openapi = readFileSync(join(root, '..', 'backend/api/openapi.yaml'), 'utf8');

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

// 1. CMS routes served.
const routed = [...appSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
for (const p of ['/login', '/', '/couriers/:userId', '/merchants/:id']) {
  check(routed.includes(p), `App serves ${p}`);
}
check(appSrc.includes('RequireAdmin'), 'routes gated by RequireAdmin');
check(appSrc.includes('/login') && appSrc.includes('Navigate'), 'unauthenticated redirect to /login');

// 2. Login-only with email+password validation, no signup.
check(authSrc.includes("includes('@')"), 'email validation checks @');
check(authSrc.includes('minLength={8}') || authSrc.includes('length < 8'), 'password min-8 validation');
check(!all.includes('/auth/signup'), 'no signup endpoint used');
check(all.includes('/auth/login') && all.includes('/auth/logout') && all.includes('/auth/me'), 'login/logout/me wired');

// 3. Courier review calls stay on contracted paths.
for (const path of ['/admin/courier-applications', 'approve', 'reject', '/trust-brief']) {
  check(dashSrc.includes(path) || detailSrc.includes(path), `courier review calls ${path}`);
}
check(openapi.includes('/v1/admin/courier-applications'), 'openapi has courier applications');
check(openapi.includes('/v1/admin/courier-applications/{user_id}/approve'), 'openapi has approve');
check(openapi.includes('/v1/admin/courier-applications/{user_id}/reject'), 'openapi has reject');
check(openapi.includes('/v1/admin/courier-applications/{user_id}:'), 'openapi has courier detail');
check(detailSrc.includes('/admin/courier-applications/${userId}'), 'courier detail uses detail endpoint');
check(detailSrc.includes('rejection reason is required'), 'reject requires a reason');

// 4. Merchant review served by the admin endpoints.
check(dashSrc.includes('/admin/merchants'), 'merchant queue probes /admin/merchants');
check(dashSrc.includes('unavailable'), 'merchant queue degrades without hardcoding');
check(openapi.includes('/v1/admin/merchants:'), 'openapi has merchant queue');
check(openapi.includes('/v1/admin/merchants/{id}:'), 'openapi has merchant detail');
check(openapi.includes('/v1/admin/merchants/{id}/approve'), 'openapi has merchant approve');
check(openapi.includes('/v1/admin/merchants/{id}/reject'), 'openapi has merchant reject');
check(detailSrc.includes('/admin/merchants/${id}'), 'merchant detail uses detail endpoint');

// 5. No hardcoded review data; statuses come from the API.
check(!/(jane\.doe|john\.smith|demo\.courier|acme|Acme)/i.test(all), 'no hardcoded partner names');
check(all.includes('pending') && all.includes('approved') && all.includes('rejected'), 'all three statuses handled');

// 6. Auth hardening: admin role gate + app header + refresh.
check(all.includes("roles.includes('admin')") || all.includes('isAdmin'), 'admin role gate');
check(apiSrc.includes("X-TF-App") && apiSrc.includes('tb:cms:user'), 'X-TF-App header + cms storage prefix');
check(apiSrc.includes('/auth/refresh'), '401 refresh wired');

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('cms route smoke: all checks passed');
