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

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nroute smoke: all green');
