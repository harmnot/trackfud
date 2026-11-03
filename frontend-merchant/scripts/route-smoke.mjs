/**
 * Route smoke test: every menu route must be served by App.tsx, menu API
 * calls must match openapi.yaml paths, and locales must share key sets.
 * Run: `node scripts/route-smoke.mjs` (also wired as `pnpm smoke`).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const menuApi = readFileSync(join(root, 'src/features/menu/api.ts'), 'utf8');
const ordersApi = readFileSync(join(root, 'src/features/orders/api.ts'), 'utf8');
const ordersPage = readFileSync(join(root, 'src/features/orders/OrdersPage.tsx'), 'utf8');
const openapi = readFileSync(join(root, '..', 'backend/api/openapi.yaml'), 'utf8');

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

// 1. M2 routes served.
const routed = [...appSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
for (const p of ['/setup', '/menu', '/menu/import', '/agreement', '/staff', '/status', '/login', '/signup', '/orders', '/earnings']) {
  check(routed.includes(p), `App serves ${p}`);
}
for (const page of ['MenuPage', 'ImportPage', 'OrdersPage', 'EarningsPage']) {
  check(appSrc.includes(page), `App wires ${page}`);
}
// 1b. M3 order calls stay on contracted paths.
for (const path of ['/merchant/orders', '/accept', '/reject', '/ready', '/ws/ticket', '/push/subscribe', '/push/vapid-public-key']) {
  const src = path === '/ws/ticket' || path.startsWith('/push') ? ordersPage + readFileSync(join(root, 'src/features/orders/socket.ts'), 'utf8') + readFileSync(join(root, 'src/features/orders/push.ts'), 'utf8') : ordersApi;
  check(src.includes(path), `orders feature calls ${path}`);
}
check(ordersPage.includes('unlockKitchenAudio') && ordersPage.includes('Start receiving') === false, 'sound unlock wired via helper (no raw audio before tap)');
check(openapi.includes('getMerchantOrder'), 'openapi has merchant order detail on its own path (no /customer detour)');
check(ordersPage.includes('order.delivery?.status') && ordersPage.includes('order.delivery?.eta_s'), 'courier line reads the real delivery status + ETA from list rows');
check(ordersPage.includes('wakeLock'), 'kitchen requests screen wake lock');
// Earnings derive locally from the order list: no invented payout endpoint.
check(!ordersApi.includes('/payout') && !ordersApi.includes('/earning'), 'no invented earnings endpoint (local summary is correct)');
check(readFileSync(join(root, 'src/features/orders/EarningsPage.tsx'), 'utf8').includes('mock'), 'earnings show the mock-payout note');

// 2. Menu API calls stay on contracted paths.
for (const path of ['/merchant/menu/categories', '/merchant/menu/items', '/files/presign', '/merchant/merchants/me']) {
  check(menuApi.includes(path), `menu api calls ${path}`);
}
// B6 import-job endpoints are real: photo upload, job create, job poll.
check(openapi.includes('/v1/merchant/menu/import-jobs'), 'openapi has merchant import-jobs');
check(menuApi.includes('/merchant/menu/import-jobs'), 'menu api creates/polls server import jobs');
check(menuApi.includes('Idempotency-Key'), 'item create sends Idempotency-Key');
// No review/publish endpoint in the contract: publish writes menu items,
// and the prices-checked gate stays local.
check(!openapi.includes('import-jobs/{id}/review') && !openapi.includes('import-jobs/{id}/publish'), 'no review/publish endpoint in openapi (item create + local gate is correct)');

// 3. AI never sets a price: drafts start null + review gates publish.
const jobSrc = readFileSync(join(root, 'src/features/menu/importJob.ts'), 'utf8');
check(!jobSrc.includes('tb:merchant:import-jobs'), 'no local import-job simulation store');
check(jobSrc.includes('price_minor: null'), 'import drafts start with null price');
const importSrc = readFileSync(join(root, 'src/features/menu/ImportPage.tsx'), 'utf8');
check(importSrc.includes('prices_checked') && importSrc.includes('jobReady'), 'publish gated on prices-checked tick');

// 4. Locales share identical key sets across en/id/ms.
const locales = ['en', 'id', 'ms'];
const keySets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  const keys = Object.keys(json).sort().map((ns) => `${ns}:{${Object.keys(json[ns] ?? {}).sort().join(',')}}`);
  keySets[l] = keys.join('|');
  check(['menu', 'import'].every((ns) => json[ns] && Object.keys(json[ns]).length > 10), `${l}.json has menu/import namespaces`);
}
check(keySets.en === keySets.id && keySets.id === keySets.ms, 'locale key sets identical across en/id/ms');

// 5. Staff invite explains the Stride & Earn join path; order ops respect runner/biker terms.
const merchantAppSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8');
check(merchantAppSrc.includes('staff.howJoin'), 'Staff page shows how teammates join');
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  check(Boolean(json.staff?.howJoin) && Boolean(json.staff?.howJoinBody), `${l}.json has staff join guidance`);
}
const enOrders = JSON.parse(readFileSync(join(root, 'src/locales/en.json'), 'utf8')).orders;
check(!/courier/i.test(enOrders.showCode) && !/courier/i.test(enOrders.courierNotified), 'order ops address runner/biker, not "courier"');

// 6. Agreement review states: approved/rejected labels + banners come from the
// API status, and the page live-updates on the admin decision.
const agreeSrc = readFileSync(join(root, 'src/features/setup/AgreementPage.tsx'), 'utf8');
const agreeSocket = readFileSync(join(root, 'src/features/orders/socket.ts'), 'utf8');
check(agreeSrc.includes('signedApproved') && agreeSrc.includes('signedRejected'), 'Agreement button tracks approved/rejected');
check(agreeSrc.includes('agree.submittedApproved') || agreeSrc.includes('submittedApproved'), 'Agreement shows the approved banner');
check(agreeSrc.includes('agree.submittedRejected') || agreeSrc.includes('submittedRejected'), 'Agreement shows the rejected banner');
check(agreeSocket.includes('merchant.status'), 'Merchant socket types the agreement decision');
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  check(Boolean(json.agree?.signedApproved) && Boolean(json.agree?.signedRejected) && Boolean(json.agree?.submittedApproved) && Boolean(json.agree?.submittedRejected), `${l}.json has agreement review strings`);
}

// 7. A6 sanctions: the status badge stays green only for approved stores —
// banned (and other non-live states) render honestly instead of lit green.
const statusPageSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8');
check(statusPageSrc.includes('status === "approved"'), 'status badge is green only for approved stores');

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nroute smoke: all green');
