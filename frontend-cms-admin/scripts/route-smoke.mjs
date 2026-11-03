/**
 * Route smoke test: every CMS route must be served by App.tsx, admin API
 * calls must match real backend/openapi paths, and no review data may be
 * hardcoded. Run: `node scripts/route-smoke.mjs`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const authSrc = readFileSync(join(root, 'src/features/auth.tsx'), 'utf8');
const dashSrc = readFileSync(join(root, 'src/features/dashboard.tsx'), 'utf8');
const wdSrc =
  readFileSync(join(root, 'src/features/withdrawals/WithdrawalsPage.tsx'), 'utf8') +
  readFileSync(join(root, 'src/features/withdrawals/api.ts'), 'utf8') +
  readFileSync(join(root, 'src/features/withdrawals/types.ts'), 'utf8');
const ordSrc =
  readFileSync(join(root, 'src/features/orders/OrdersPage.tsx'), 'utf8') +
  readFileSync(join(root, 'src/features/orders/OrderDetailPage.tsx'), 'utf8') +
  readFileSync(join(root, 'src/features/orders/api.ts'), 'utf8') +
  readFileSync(join(root, 'src/features/orders/types.ts'), 'utf8');
const a9Src =
  readFileSync(join(root, 'src/features/settings/SettingsPage.tsx'), 'utf8') +
  readFileSync(join(root, 'src/features/settings/api.ts'), 'utf8') +
  readFileSync(join(root, 'src/features/settings/types.ts'), 'utf8') +
  readFileSync(join(root, 'src/features/audit/AuditPage.tsx'), 'utf8') +
  readFileSync(join(root, 'src/features/audit/api.ts'), 'utf8') +
  readFileSync(join(root, 'src/features/audit/types.ts'), 'utf8') +
  readFileSync(join(root, 'src/features/ai/AIPage.tsx'), 'utf8') +
  readFileSync(join(root, 'src/features/ai/api.ts'), 'utf8') +
  readFileSync(join(root, 'src/features/ai/types.ts'), 'utf8') +
  readFileSync(join(root, 'src/features/copilot/CopilotPage.tsx'), 'utf8') +
  readFileSync(join(root, 'src/features/copilot/api.ts'), 'utf8') +
  readFileSync(join(root, 'src/features/copilot/types.ts'), 'utf8');
function readDetailTree() {
  const parts = [readFileSync(join(root, 'src/features/detail.tsx'), 'utf8')];
  const dir = join(root, 'src/features/detail');
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.ts') || f.endsWith('.tsx')) parts.push(readFileSync(join(dir, f), 'utf8'));
  }
  return parts.join('\n');
}
function readOverviewTree() {
  const parts = [];
  const dir = join(root, 'src/features/overview');
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.ts') || f.endsWith('.tsx')) parts.push(readFileSync(join(dir, f), 'utf8'));
  }
  return parts.join('\n');
}
const detailSrc = readDetailTree();
const ovSrc = readOverviewTree();
const apiSrc = readFileSync(join(root, 'src/lib/api.ts'), 'utf8');
const typesSrc = readFileSync(join(root, 'src/lib/types.ts'), 'utf8');
const mapsSrc = readFileSync(join(root, 'src/lib/maps.ts'), 'utf8');
const cssSrc = readFileSync(join(root, 'src/index.css'), 'utf8');
const all = appSrc + authSrc + dashSrc + detailSrc + apiSrc + wdSrc + ordSrc + a9Src + ovSrc;
const openapi = readFileSync(join(root, '..', 'backend/api/openapi.yaml'), 'utf8');

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

// 1. CMS routes served.
const routed = [...appSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
for (const p of ['/login', '/', '/review', '/couriers/:userId', '/couriers/:userId/performance', '/merchants/:id', '/withdrawals', '/orders', '/orders/:id', '/settings', '/audit', '/ai', '/copilot']) {
  check(routed.includes(p), `App serves ${p}`);
}
check(appSrc.includes('RequireAdmin'), 'routes gated by RequireAdmin');
check(appSrc.includes('/login') && appSrc.includes('Navigate'), 'unauthenticated redirect to /login');
check(appSrc.includes('OverviewPage') && appSrc.includes('PerformancePage'), 'overview + performance pages render at their routes');
check(appSrc.includes('RequireAdmin'), 'routes gated by RequireAdmin');
check(appSrc.includes('/login') && appSrc.includes('Navigate'), 'unauthenticated redirect to /login');
check(appSrc.includes('/withdrawals') && appSrc.includes('WithdrawalsPage'), 'withdrawals route renders the finance queue');
check(appSrc.includes('/orders') && appSrc.includes('OrdersPage') && appSrc.includes('OrderDetailPage'), 'orders routes render the order queue + detail');

// 2. Login-only with email+password validation, no signup.
check(authSrc.includes("includes('@')"), 'email validation checks @');
check(authSrc.includes('minLength={8}') || authSrc.includes('length < 8'), 'password min-8 validation');
check(!/api\(\s*['"`]\/auth\/signup/.test(all), 'no signup endpoint used');
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
check(openapi.includes('/v1/admin/merchants/{id}/sanctions'), 'openapi has merchant sanctions');
check(openapi.includes('MerchantSanctionInput'), 'openapi has merchant sanction input');
check(openapi.includes('/v1/admin/couriers/{user_id}/sanctions'), 'openapi has courier sanctions');

// 4b. Decide buttons hide once decided; bans stay available via sanctions.
check(detailSrc.includes("status === 'pending'"), 'merchant decide hidden once decided');
check(detailSrc.includes('DECIDABLE_APPLICATION'), 'courier decide hidden once decided');
check(detailSrc.includes('/sanctions'), 'detail pages use sanctions endpoints');
// 4c. Merchant approve/reject stay disabled until the signed agreement lands;
// review photos come from the authed file API, never hardcoded.
check(detailSrc.includes('signed agreement'), 'merchant decide gated until agreement signed');
check(detailSrc.includes('fetchFileBlob') && detailSrc.includes('FileImage'), 'review evidence photos from file API');

// 4d. A6 freeze/unfreeze/ban: operational standing from the API, frozen/banned
// queue filters, unfreeze reason-optional end to end (backend sanctionReasonOK).
check(dashSrc.includes('queueStatus'), 'queue badge shows sanction standing over review status');
check(detailSrc.includes('standing'), 'courier detail carries operational standing');
check(typesSrc.includes("'frozen', 'banned'"), 'queue filters include frozen/banned');
check(typesSrc.includes('standing?'), 'review types carry operational standing');
check(openapi.includes('pending, approved, rejected, frozen, banned'), 'openapi review filters include frozen/banned');
check(!openapi.includes('required: [kind, reason_code]'), 'openapi no longer requires a reason for unfreeze');
check(openapi.includes('optional for unfreeze'), 'openapi marks reason optional for unfreeze');
check(openapi.includes('standing'), 'openapi exposes operational standing');

// 5. No hardcoded review data; statuses come from the API.
check(!/(jane\.doe|john\.smith|demo\.courier|acme|Acme)/i.test(all), 'no hardcoded partner names');
check(all.includes('pending') && all.includes('approved') && all.includes('rejected'), 'all three statuses handled');

// 6. Auth hardening: admin role gate + app header + refresh.
check(all.includes("roles.includes('admin')") || all.includes('isAdmin'), 'admin role gate');
check(apiSrc.includes("X-TF-App") && apiSrc.includes('tb:cms:user'), 'X-TF-App header + cms storage prefix');
check(apiSrc.includes('/auth/refresh'), '401 refresh wired');

// 7. Withdrawals monitor (B5 money real paths): finance queue from the API,
// hold with a required reason, release back to the queue — no hardcoded rows.
check(openapi.includes('/v1/admin/withdrawals:'), 'openapi has withdrawals queue');
check(openapi.includes('/v1/admin/withdrawals/{id}/hold'), 'openapi has withdrawal hold');
check(openapi.includes('/v1/admin/withdrawals/{id}/release'), 'openapi has withdrawal release');
check(wdSrc.includes('/admin/withdrawals'), 'withdrawals page calls the admin queue');
check(wdSrc.includes('/hold') && wdSrc.includes('/release'), 'withdrawals page wires hold + release');
check(wdSrc.includes('A hold reason is required'), 'withdrawal hold requires a reason');
check(wdSrc.includes('isHoldable') && wdSrc.includes('isReleasable'), 'hold/release render only for actionable statuses');

// 8. Orders review (A7 orders list + detail, PLAN §4.4 P0): queue + detail
// with timeline, chat, proof photo and refund — all rows from the API.
check(openapi.includes('/v1/admin/orders:'), 'openapi has admin orders queue');
check(openapi.includes('/v1/admin/orders/{id}:'), 'openapi has admin order detail');
check(openapi.includes('/v1/admin/orders/{id}/refund'), 'openapi has admin order refund');
check(openapi.includes('RefundInput'), 'openapi has refund input');
check(ordSrc.includes('/admin/orders'), 'orders pages call the admin endpoints');
check(ordSrc.includes('/refund'), 'order detail wires the refund endpoint');
check(ordSrc.includes('A refund reason is required'), 'refund requires a reason');
check(ordSrc.includes('isRefundable') && ordSrc.includes('refundable'), 'refund renders only for refundable orders');
check(ordSrc.includes('parseAdminOrder'), 'order rows validated before render');
check(ordSrc.includes('Timeline') && ordSrc.includes('Chat') && ordSrc.includes('Proof photo') && ordSrc.includes('Money trail'), 'order detail covers timeline/chat/proof/money');

// 9. A9 platform controls (settings editor P0, audit log P1, AI page P1,
// Ops Copilot P2): admin-gated routes, contract paths, validated rows.
check(appSrc.includes('/settings') && appSrc.includes('SettingsPage'), 'settings route renders the editor');
check(appSrc.includes('/audit') && appSrc.includes('AuditPage'), 'audit route renders the viewer');
check(appSrc.includes('/ai') && appSrc.includes('AIPage'), 'AI route renders the usage page');
check(appSrc.includes('/copilot') && appSrc.includes('CopilotPage'), 'copilot route renders the Q&A page');
for (const path of ['/v1/admin/settings', '/v1/admin/audit', '/v1/admin/ai/calls', '/v1/admin/ai/summary', '/v1/admin/copilot/ask']) {
  check(openapi.includes(path), `openapi has ${path}`);
}
for (const schema of ['SettingList', 'SettingInput', 'AuditList', 'AICallList', 'AISummary', 'CopilotAsk', 'CopilotResponse']) {
  check(openapi.includes(schema), `openapi has ${schema}`);
}
check(a9Src.includes('/admin/settings'), 'settings editor calls the admin endpoint');
check(a9Src.includes('/admin/audit'), 'audit viewer calls the admin endpoint');
check(a9Src.includes('/admin/ai/calls') && a9Src.includes('/admin/ai/summary'), 'AI page calls usage + summary');
check(a9Src.includes('/admin/copilot/ask'), 'copilot posts questions to the admin endpoint');
check(a9Src.includes('parseSettingItem') && a9Src.includes('parseAuditEntry') && a9Src.includes('parseAICall') && a9Src.includes('parseCopilotResult'), 'A9 rows validated before render');
check(a9Src.includes("method: 'PUT'") && a9Src.includes('scope'), 'settings save carries scope + key');
check(a9Src.includes('Clear to default'), 'settings override clears back to default');

// 10. A8 dashboard live map + numbers, courier performance (PLAN §4.4/§8.6 P0):
// admin-gated overview + performance routes, contract paths, validated rows,
// live map with schematic fallback, responsive nav.
check(openapi.includes('/v1/admin/dashboard:'), 'openapi has admin dashboard');
check(openapi.includes('/v1/admin/couriers/{user_id}/performance:'), 'openapi has courier performance');
check(openapi.includes('Dashboard'), 'openapi has Dashboard schema');
check(openapi.includes('CourierPerformance'), 'openapi has CourierPerformance schema');
check(ovSrc.includes('/admin/dashboard'), 'overview calls the dashboard endpoint');
check(ovSrc.includes('/performance'), 'performance page calls the performance endpoint');
check(ovSrc.includes('parseDashboard') && ovSrc.includes('parsePerformance'), 'overview rows validated before render');
check(ovSrc.includes('parseLiveCourier') && ovSrc.includes('parseActiveOrder'), 'live dots + active orders validated');
check(ovSrc.includes('refetchInterval'), 'overview map polls for live dots');
check(ovSrc.includes('SchematicMap') || ovSrc.includes('schematic'), 'live map degrades to a schematic without a key');
check(mapsSrc.includes('importLibrary') && mapsSrc.includes('gm_authFailure'), 'maps loader keeps the importLibrary readiness contract');
check(detailSrc.includes('/performance'), 'courier detail links the performance page');
check(appSrc.includes('tb-topnav') && appSrc.includes('tb-sheet'), 'nav collapses to top bar + More sheet');
check(appSrc.includes('PRIMARY'), 'bottom bar renders primaries from one list');
check(appSrc.includes('tb-sys') && appSrc.includes('System') && appSrc.includes('sysItems'), 'top bar shows four primaries + one System menu from one list');
check(appSrc.includes('NavIcon') && appSrc.includes('tb-user-menu'), 'nav uses icons + avatar account menu');
check(cssSrc.includes('.tb-sys-btn') && cssSrc.includes('.tb-sys-menu') && cssSrc.includes('.tb-sheet-group'), 'slim nav + grouped sheet styles exist');
// Responsive hi-fi nav: avatar survives on phones, More sheet carries the
// identity, tablet top bar compacts, bottom bar fits 320px.
check(appSrc.includes('tb-sheet-mail'), 'More sheet repeats the signed-in email');
check(!cssSrc.includes('.tb-user { display: none'), 'avatar account menu stays visible on phones');
check(cssSrc.includes('.tb-sys-btn') && cssSrc.includes('flex-wrap'), 'five-slot top bar wraps instead of scrolling');
check(cssSrc.includes('max-width: 1023px') && cssSrc.includes('.tb-sys-btn'), 'tablet top bar tightens five slots');
check(cssSrc.includes('tb-sheet-mail'), 'sheet identity styles exist');

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('cms route smoke: all checks passed');
