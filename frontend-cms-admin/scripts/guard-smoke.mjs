/**
 * Guard smoke: the /back-office merchant + courier detail crash
 * (React #31 "object with keys {close, open}") and the refresh-login loop
 * must not regress. Run: `node scripts/guard-smoke.mjs`.
 *
 * Part 1 exercises the real helpers (format.ts, trust.ts) — the crash was an
 * opening_hours `{ open, close }` object rendered as a React child.
 * Part 2 asserts the wiring that keeps the fixes live (safe renderers,
 * keyed fragments, refresh-before-/auth/me boot).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatHours, formatList, formatValue } from '../src/lib/format.ts';
import { toBriefView } from '../src/lib/trust.ts';
import {
  isRefundable,
  parseAdminOrder,
  parseAdminOrderDetail,
} from '../src/features/orders/types.ts';
import { groupSettings, parseSettingItem, settingError } from '../src/features/settings/types.ts';
import { parseAuditEntry, parseAuditPage } from '../src/features/audit/types.ts';
import { formatMicros, parseAICall, parseAISummaryRow, totalCostMicros } from '../src/features/ai/types.ts';
import { copilotError, parseCopilotResult } from '../src/features/copilot/types.ts';
import {
  parseActiveOrder,
  parseDashboard,
  parseDashboardToday,
  parseLiveCourier,
} from '../src/features/overview/types.ts';
import {
  parsePerformance,
  parsePerfCourier,
  parsePerfRate,
} from '../src/features/overview/performance.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
const dashSrc = readFileSync(join(root, 'src/features/dashboard.tsx'), 'utf8');
const apiSrc = readFileSync(join(root, 'src/lib/api.ts'), 'utf8');
const appSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const authSrc = readFileSync(join(root, 'src/features/auth.tsx'), 'utf8');
const cssSrc = readFileSync(join(root, 'src/index.css'), 'utf8');
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
  readFileSync(join(root, 'src/features/audit/AuditPage.tsx'), 'utf8') +
  readFileSync(join(root, 'src/features/ai/AIPage.tsx'), 'utf8') +
  readFileSync(join(root, 'src/features/copilot/CopilotPage.tsx'), 'utf8');

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

// 1. The exact crash shape: { open, close } must render as text, never an object.
check(formatHours({ open: '09:00', close: '22:00' }) === '09:00 – 22:00', 'hours object renders as text');
check(typeof formatValue({ open: '09:00', close: '22:00' }) === 'string', 'hours object is render-safe via formatValue');
check(formatHours('09:00-22:00') === '09:00-22:00', 'plain hours string passes through');
check(formatHours(null) === '—', 'missing hours render as dash');
check(formatValue(null) === '—', 'null renders as dash');
check(formatList(['too-fast', 'gap']) === 'too-fast, gap', 'flag list joins safely');
check(formatList([]) === '—', 'empty list renders as dash');

// 1b. Order validators: garbage rows never render, valid rows parse,
// detail degrades section by section instead of crashing.
check(parseAdminOrder(null) === null, 'garbage order row parses to null');
check(parseAdminOrder({ id: 'o1' }) === null, 'row without status/money parses to null');
const orderRow = {
  id: 'o1',
  code: 'TF-ABC123',
  status: 'placed',
  currency: 'IDR',
  subtotal: { amount_minor: 50000, currency: 'IDR' },
  total: { amount_minor: 59500, currency: 'IDR' },
  merchant: { id: 'm1', name: 'Warung Demo' },
  customer: { id: 'c1', email: 'budi@example.id' },
  delivery: { status: 'searching', type: 'workout' },
};
check(parseAdminOrder(orderRow)?.code === 'TF-ABC123', 'valid order row parses');
const orderDetail = parseAdminOrderDetail({ order: { ...orderRow, refundable: true } });
check(orderDetail !== null && orderDetail.refundable === true, 'detail carries the refundable flag');
check(orderDetail !== null && orderDetail.messages.length === 0, 'missing chat degrades to empty');
check(isRefundable(orderDetail) === true, 'refundable detail enables the refund');
check(isRefundable(null) === false, 'missing detail disables the refund');

// 2. Trust brief: pending must not render an empty card; reasons stay strings.
const pending = toBriefView({ pending: true });
check(pending !== null && pending.pending === true, 'pending brief is explicit');
const brief = toBriefView({ risk: 'low', summary: 'Steady pace.', reasons: ['steady pace', { segment: 'km 2', note: 'fast' }] });
check(brief !== null && brief.signals.length === 3, 'reasons normalize to three signals');
check(brief !== null && brief.signals.every((s) => typeof s.value === 'string'), 'every signal value is a string');
check(toBriefView(null) === null, 'missing brief stays null');

// 3. The fixes stay wired in the source.
check(detailSrc.includes('formatHours(value)'), 'merchant detail formats hours entries');
check(!detailSrc.includes('<dd>{hours}</dd>'), 'no raw hours object rendered');
check(detailSrc.includes('<Fragment key='), 'list children use keyed fragments');
check(detailSrc.includes('briefPending'), 'pending brief has a dedicated state');
check(apiSrc.includes('refreshSession'), 'explicit refresh helper exists');
check(apiSrc.includes('/auth/me') || !apiSrc.includes("startsWith('/auth/')"), 'auth verify is refresh-eligible');
check(appSrc.includes('await refreshSession()'), 'boot rotates the session before verifying');
check(dashSrc.includes('courierSub'), 'courier rows tolerate missing fitness');

// 4. Sanctions: ban/unban actions with audit reasons, history from the API.
check(detailSrc.includes('useSanction'), 'sanction server-state hook exists');
check(detailSrc.includes('SanctionBox'), 'sanction panel rendered');
check(detailSrc.includes('reason_code'), 'courier sanction maps reason to reason_code');
check(detailSrc.includes("kinds={q.data?.status === 'banned' ? ['unban'] : ['ban']}"), 'merchant ban flips to unban');
check(detailSrc.includes('pending_review'), 'courier decide covers review states');
check(detailSrc.includes("['pending', 'pending_review', 'passed_test']"), 'courier decide matches backend decidable states (no mid-test decide)');
check(detailSrc.includes('checkpoint_file_ids'), 'courier detail carries checkpoint photo ids');
check(detailSrc.includes('Signed text'), 'merchant agreement text shown for review');
check(apiSrc.includes('fetchFileBlob'), 'authed file fetch for evidence photos');

// 5. Responsive queue + login: list spacing, full-width filter, centered auth.
check(cssSrc.includes('.tb-list { display: flex'), 'queue list has even spacing');
check(cssSrc.includes('.tb-dd { width: 100%'), 'status filter goes full-width on mobile');
check(authSrc.includes('tb-auth'), 'login form is centered');
check(cssSrc.includes('.tb-auth'), 'centered auth style exists');

// 5b. A6 sanctions standing: queue badge + detail panel key off standing,
// unfreeze stays reason-optional end to end.
check(dashSrc.includes('queueStatus(a)'), 'queue badge resolves via queueStatus');
check(detailSrc.includes("standing === 'frozen'"), 'detail panel keys off operational standing');
check(detailSrc.includes('REASON_OPTIONAL'), 'restorative sanctions stay reason-optional');
check(detailSrc.includes('unfreeze'), 'unfreeze action wired in sanction panel');

// 6. Withdrawals monitor (B5 money real paths): validated rows from the API,
// hold gated on reason, release only for held rows, admin-gated route.
check(wdSrc.includes('parseWithdrawal'), 'withdrawal rows validated before render');
check(wdSrc.includes('/admin/withdrawals${q}') || wdSrc.includes('/admin/withdrawals'), 'withdrawals listed from the admin endpoint');
check(wdSrc.includes('holdWithdrawal') && wdSrc.includes('releaseWithdrawal'), 'hold + release go through typed API helpers');
check(wdSrc.includes('A hold reason is required'), 'hold requires a reason client-side');
check(wdSrc.includes('isHoldable') && wdSrc.includes("status === 'pending'"), 'hold renders only for pending/processing');
check(wdSrc.includes("status === 'held'"), 'release renders only for held');
check(appSrc.includes('/withdrawals') && appSrc.includes('RequireAdmin'), 'withdrawals route is admin-gated');

// 7. Orders review (A7): validated rows, two-step refund gated on reason,
// timeline/chat/proof/money from one detail endpoint, admin-gated routes.
check(ordSrc.includes('parseAdminOrderDetail'), 'order detail validated before render');
check(ordSrc.includes('Click again to confirm refund'), 'refund needs an explicit confirm step');
check(ordSrc.includes('A refund reason is required'), 'refund requires a reason client-side');
check(ordSrc.includes('pre-pickup orders refund'), 'non-refundable orders explain the finance path');
check(ordSrc.includes('FileImage') && ordSrc.includes("label=\"Delivery proof\""), 'proof photo loads through the authed file API');
check(ordSrc.includes("moderated") && ordSrc.includes("flagged"), 'chat shows translation + moderation flags');
check(appSrc.includes('/orders') && appSrc.includes('/orders/:id') && appSrc.includes('RequireAdmin'), 'orders routes are admin-gated');

// 8. A9 platform controls: validated rows, client-side range checks, honest
// live/fallback states, admin-gated routes, no hardcoded platform data.
const settingRow = {
  key: 'dispatch.runner_corridor_m', group: 'dispatch', label: 'Runner track corridor (m)',
  kind: 'float', min: 100, max: 3000, hint: '', override: 500, effective: 500, is_default: 400,
};
const parsed = parseSettingItem(settingRow);
check(parsed !== null && parsed.override === 500 && parsed.effective === 500, 'valid setting row parses');
check(parseSettingItem(null) === null, 'garbage setting row parses to null');
check(parseSettingItem({ key: 'x', group: 'g' }) === null, 'setting without effective parses to null');
check(settingError(settingRow, '400') === '', 'in-range value passes');
check(settingError(settingRow, '50') !== '', 'out-of-range value rejected client-side');
check(settingError(settingRow, 'fast') !== '', 'non-numeric value rejected client-side');
check(settingError({ ...settingRow, kind: 'int' }, '400.5') !== '', 'fractional int rejected client-side');
check(groupSettings([settingRow, { ...settingRow, key: 'other', group: 'fees' }]).length === 2, 'settings group into sections');
const auditRow = {
  actor_id: 'admin-1', action: 'order.refund', target_type: 'order', target_id: 'o1',
  reason: 'support case', before: { status: 'placed' }, after: { status: 'cancelled' }, created_at: '2026-10-30T00:00:00Z',
};
check(parseAuditEntry(auditRow)?.action === 'order.refund', 'valid audit entry parses');
check(parseAuditEntry(null) === null, 'garbage audit entry parses to null');
const auditPage = parseAuditPage({ entries: [auditRow, null], total: 2, limit: 25, offset: 0 });
check(auditPage !== null && auditPage.entries.length === 1 && auditPage.total === 2, 'audit page keeps total while dropping garbage');
const aiRow = {
  feature: 'trust_brief', model: 'muse-spark-open', prompt_version: 'v1', latency_ms: 1200,
  input_tokens: 2000, output_tokens: 150, cost_micros: 25000, fallback: false, error: '', created_at: '2026-10-30T00:00:00Z',
};
check(parseAICall(aiRow)?.model === 'muse-spark-open', 'valid AI call parses');
check(parseAICall({ feature: 'x' }) === null, 'AI call without model parses to null');
check(formatMicros(25000) === '$0.0250', 'micro cost formats to USD');
check(totalCostMicros([{ cost_micros: 100 }, { cost_micros: 200 }]) === 300, 'summary cost totals');
check(parseAISummaryRow({ feature: 'copilot', calls: 3 })?.calls === 3, 'AI summary row parses');
check(parseAISummaryRow(null) === null, 'garbage summary row parses to null');
const copilotAnswer = {
  answer: 'Measured over the last 7 days: weekly_volume: 5 row(s); first row [2026-10-29 · 4 · 3].',
  tables: [{ title: 'Order volume (7d)', columns: ['day', 'orders', 'delivered'], rows: [['2026-10-29', '4', '3']] }],
  tools_used: ['weekly_volume'], live: false,
};
check(parseCopilotResult(copilotAnswer)?.tables.length === 1, 'valid copilot answer parses with tables');
check(parseCopilotResult({ answer: '  ' }) === null, 'empty copilot answer parses to null');
check(copilotError('x') !== '', 'one-letter question rejected client-side');
check(copilotError('Which bikers were late?') === '', 'real question passes client-side');
check(a9Src.includes('fallback') && a9Src.includes('live'), 'AI pages distinguish live from fallback');
check(a9Src.includes('tb-table'), 'copilot evidence renders as a real table');
check(appSrc.includes('/settings') && appSrc.includes('/audit') && appSrc.includes('/ai') && appSrc.includes('/copilot'), 'A9 routes are admin-gated');
check(cssSrc.includes('.tb-table'), 'evidence table style exists');

// 9. A8 dashboard + performance (PLAN §4.4/§8.6 P0): validated overview rows,
// null-on-empty rates (never a damning 0%), schematic fallback + 30 s poll,
// responsive nav from one list.
const todayRow = {
  date: '2026-10-30', orders_placed: 4, orders_delivered: 3, active_orders: 1,
  couriers_online: 2, pending_applications: 1, pending_merchants: 0,
  gmv_delivered: [{ currency: 'IDR', amount_minor: 59500 }],
};
check(parseDashboardToday(todayRow)?.orders_placed === 4, 'valid today block parses');
check(parseDashboardToday(null) === null, 'garbage today block parses to null');
check(parseDashboardToday({ orders_placed: 1 }) === null, 'today without core counts parses to null');
const dotRow = {
  user_id: 'c1', email: 'rina@example.id', mode: 'runner', standing: '',
  lat: -6.2, lng: 106.85, last_seen_at: '2026-10-30T00:00:00Z',
  session_distance_m: 2400, delivery_id: '', delivery_status: '',
};
check(parseLiveCourier(dotRow)?.email === 'rina@example.id', 'valid courier dot parses');
check(parseLiveCourier({ user_id: 'c1' }) === null, 'dot without position parses to null');
check(parseLiveCourier({ ...dotRow, lat: 999 }) === null, 'dot with impossible lat parses to null');
const activeRow = {
  id: 'o1', code: 'TF-1', status: 'accepted', merchant_name: 'Warung Demo',
  customer_email: 'budi@example.id', created_at: '2026-10-30T00:00:00Z',
  delivery_status: 'assigned', courier_email: 'rina@example.id',
  dropoff: { lat: -6.21, lng: 106.86 },
};
check(parseActiveOrder(activeRow)?.code === 'TF-1', 'valid active order parses');
check(parseActiveOrder({ id: 'o1' }) === null, 'order without status parses to null');
const dashPage = parseDashboard({ today: todayRow, live_couriers: [dotRow, null], active_orders: [activeRow, null] });
check(dashPage !== null && dashPage.live_couriers.length === 1 && dashPage.active_orders.length === 1, 'dashboard keeps valid rows while dropping garbage');
check(parseDashboard(null) === null, 'garbage dashboard parses to null');
check(parsePerfRate({ have: 8, total: 10, rate: 0.8 })?.rate === 0.8, 'real rate parses as a fraction');
check(parsePerfRate({ have: 0, total: 0, rate: null })?.rate === null, 'empty window parses to null, never 0%');
check(parsePerfRate(null) === null, 'garbage rate parses to null');
const perfCourier = { user_id: 'c1', email: 'rina@example.id', mode: 'runner', rating_bayes: 4.8 };
check(parsePerfCourier(perfCourier)?.mode === 'runner', 'valid performance courier parses');
check(parsePerfCourier({ email: 'x' }) === null, 'performance without user_id parses to null');
const perfPage = parsePerformance({
  courier: perfCourier,
  acceptance: { have: 6, total: 10, rate: 0.6 },
  rating: { complaints_per_100: 1.5 },
  work: { weekly: [{ week: '2026-10-26', active_s: 9000, sessions: 3, goal_met: true }, null] },
  sessions: [{ id: 's1' }, null],
});
check(perfPage !== null && perfPage.acceptance.rate === 0.6 && perfPage.weekly.length === 1 && perfPage.sessions.length === 1, 'performance keeps valid rows while dropping garbage');
check(parsePerformance(null) === null, 'garbage performance parses to null');
check(parsePerformance({}) === null, 'performance without courier parses to null');

// 10. A8 wiring stays live: overview polls, map falls back without a key,
// courier detail links performance, nav reads from one list.
check(ovSrc.includes('refetchInterval'), 'overview polls the dashboard for live dots');
check(ovSrc.includes('SchematicMap'), 'live map renders a schematic without a key');
check(ovSrc.includes('/admin/dashboard') && ovSrc.includes('/performance'), 'overview hits the contracted admin endpoints');
check(detailSrc.includes('/performance'), 'courier detail links the performance page');
check(appSrc.includes('tb-topnav') && appSrc.includes('tb-sheet'), 'nav collapses to top bar + More sheet');
check(appSrc.includes('tb-sys') && appSrc.includes('sysItems') && appSrc.includes('isPrimary'), 'slim top bar + System menu derive from one list');
check(cssSrc.includes('.tb-topnav') && cssSrc.includes('.tb-stats') && cssSrc.includes('.tb-map'), 'overview + responsive nav styles exist');
check(cssSrc.includes('min-width: 720px') && cssSrc.includes('.tb-sys-btn'), 'top bar starts at tablet widths with a System menu');
check(appSrc.includes('tb-sheet-mail'), 'More sheet repeats the signed-in email');
check(cssSrc.includes('tb-sheet-mail') && cssSrc.includes('max-width: 1023px'), 'sheet identity + tablet compaction styles exist');

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('cms guard smoke: all checks passed');
