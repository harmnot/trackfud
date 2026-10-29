/**
 * Route smoke test: every path in the route table must be served by the
 * router in App.tsx with no duplicate or missing entries.
 * Run: `node scripts/route-smoke.mjs` (also wired as `pnpm smoke`).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const routesSrc = readFileSync(join(root, 'src/app/routes.ts'), 'utf8');
const appSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8');

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

// 1. Route table parses: extract path values.
const paths = [...routesSrc.matchAll(/'(\/[a-z-]*)'/g)].map((m) => m[1]);
check(paths.length >= 8, `route table holds ${paths.length} paths (want >= 8)`);
check(new Set(paths).size === paths.length, 'no duplicate paths in route table');

// 2. Every table path has a <Route> in App.tsx (except / and auth aliases).
const routed = [...appSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
for (const p of paths) {
  if (p === '/login' || p === '/signup') continue; // auth pages predate the table
  check(routed.includes(p), `App serves ${p}`);
}

// 3. R2 pages exist and are imported.
for (const page of ['RunSetupPage', 'RunModePage', 'DeliveryPage', 'WalletPage']) {
  check(appSrc.includes(page), `App wires ${page}`);
}

// 4. Every locale file carries the R2 namespaces with identical key sets.
const locales = ['en', 'id', 'ms'];
const keySets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  const keys = ['run', 'delivery', 'wallet'].map((ns) => `${ns}:{${Object.keys(json[ns] ?? {}).sort().join(',')}}`);
  keySets[l] = keys.join('|');
  check(['run', 'delivery', 'wallet'].every((ns) => json[ns] && Object.keys(json[ns]).length > 5), `${l}.json has run/delivery/wallet namespaces`);
}
check(keySets.en === keySets.id && keySets.id === keySets.ms, 'locale key sets identical across en/id/ms');

// 5. Stride & Earn account: personal data + partner CTA are wired, locales agree.
const statusSrc = readFileSync(join(root, 'src/pages/StatusPage.tsx'), 'utf8');
check(statusSrc.includes('fetchMe') && statusSrc.includes('fetchProfile'), 'Status page loads personal data from API');
check(statusSrc.includes('becomePartner') || statusSrc.includes('account.becomePartner'), 'Status page offers Become a Partner');
check(!appSrc.includes('Runner courier') && !appSrc.includes('Trackfud · Courier'), 'App no longer brands runner/biker as Courier');
check(!appSrc.includes('role: "courier"'), 'Signup no longer forces the partner role');
check(appSrc.includes('nav("/run-setup")'), 'Login/signup land on Run Setup (open tracking)');
const accountSets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  accountSets[l] = Object.keys(json.account ?? {}).sort().join(',');
  check(Boolean(json.account?.personal) && Boolean(json.account?.becomePartner), `${l}.json has Stride & Earn account strings`);
  check((json.account?.addressLine ?? '').includes('{city}') && (json.account?.addressLine ?? '').includes('{country}'), `${l}.json address placeholders intact`);
}
check(accountSets.en === accountSets.id && accountSets.id === accountSets.ms, 'account locale keys identical across en/id/ms');

// 6. Staff mode joins by email membership + real shift clock (no invite codes).
const staffPage = readFileSync(join(root, 'src/pages/StaffPage.tsx'), 'utf8');
const staffStore = readFileSync(join(root, 'src/features/staff/staffStore.ts'), 'utf8');
const courierApiSrc = readFileSync(join(root, 'src/features/delivery/courierApi.ts'), 'utf8');
check(staffPage.includes('fetchMemberships') && staffPage.includes('setStaffShift'), 'Staff page enters via memberships + server shift clock');
check(!staffPage.includes('inviteCode') && !staffStore.includes('inviteCode'), 'no invite-code fiction left in staff flow');
check(courierApiSrc.includes('/courier/staff/memberships'), 'client calls the memberships endpoint');
const openapi = readFileSync(join(root, '../backend/api/openapi.yaml'), 'utf8');
check(openapi.includes('/v1/courier/staff/memberships') && openapi.includes('listMemberships'), 'contract serves the memberships endpoint');
const staffSets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  staffSets[l] = Object.keys(json.staff ?? {}).sort().join(',');
  check(Boolean(json.staff?.restaurant) && Boolean(json.staff?.noInvite), `${l}.json has staff membership strings`);
}
check(staffSets.en === staffSets.id && staffSets.id === staffSets.ms, 'staff locale keys identical across en/id/ms');

// 7. No hardcoded demo data rendered as live data.
const ratingsSrc = readFileSync(join(root, 'src/pages/RatingsPage.tsx'), 'utf8');
check(!ratingsSrc.includes('setSummary(DEMO_RATINGS)'), 'Ratings page never renders sample data as live');
const chatSrc = readFileSync(join(root, 'src/pages/ChatPage.tsx'), 'utf8');
check(chatSrc.includes('chat.noDelivery'), 'Chat explains itself without an active delivery');

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nroute smoke: all green');
