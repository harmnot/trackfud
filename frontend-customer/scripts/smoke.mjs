/**
 * Customer smoke: Maps first-load race, courier status card, wallet refresh,
 * no-courier choices.
 * Run: `node scripts/smoke.mjs` (also wired as `pnpm smoke`).
 * Style follows the courier/CMS smokes: source guards + locale parity.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

const maps = read('src/lib/maps.ts');
const live = read('src/features/tracking/LiveMap.tsx');
const picker = read('src/features/addresses/GoogleMapPicker.tsx');
const card = read('src/features/tracking/CourierCard.tsx');
const orderPage = read('src/features/tracking/OrderPage.tsx');
const checkout = read('src/features/orders/CheckoutPage.tsx');

// 1. Maps loader: readiness means `importLibrary('maps')` resolved, never
// script onload alone (the first-visit race: onload fires for the bootstrap
// while `google.maps.Map` is still undefined, Retry then succeeds).
check(maps.includes("await boot.importLibrary('maps')"), 'loader awaits importLibrary(maps) as the readiness signal');
check(maps.includes('await waitForScript(tag)') && maps.includes('await waitForBootstrap(deadline)'), 'loader waits for script AND bootstrap poll in order');
check(maps.includes('gm_authFailure'), 'loader captures gm_authFailure so key/billing errors stay distinct from races');
check(!maps.includes('tag.onload = () => resolve()'), 'loader never resolves ready on script onload alone');
check(maps.includes("querySelector<HTMLScriptElement>('script[data-trackfud-maps]')") || maps.includes('script[data-trackfud-maps]'), 'retry removes the failed script tag for a clean rebuild');
check(!/mapId:\s*['"]/.test(maps + live + picker), 'no hardcoded mapId literal (arbitrary ids fail some keys); map id only via VITE_GOOGLE_MAPS_MAP_ID');
check(maps.includes('VITE_GOOGLE_MAPS_MAP_ID'), 'optional map id comes from env');
check(live.includes('ensureMaps()') && picker.includes('ensureMaps()'), 'live map + pin picker share the single loader path');
check(!picker.includes('window.google'), 'pin picker uses the typed handle, never window.google');

// 2. Courier status card follows the order lifecycle, not just assignment.
for (const branch of ['cancelled', 'rejected', 'delivered', 'completed', 'loading', 'onRetry']) {
  check(card.includes(branch), `CourierCard handles ${branch}`);
}
check(orderPage.includes('status={order.status}') && orderPage.includes('onRetry'), 'OrderPage feeds status + retry into CourierCard');
check(card.includes('courierNoneCancelled') && card.includes('courierNoneRejected'), 'terminal states use dedicated copy, never the searching line');

// 3. Locales: identical keys across en/id/ms, identical placeholders,
// inclusive courier wording on the renamed strings.
const locales = ['en', 'id', 'ms'];
const json = Object.fromEntries(locales.map((l) => [l, JSON.parse(read(`src/locales/${l}.json`))]));
const nsSets = locales.map((l) => Object.keys(json[l]).join(','));
check(new Set(nsSets).size === 1, 'locale namespaces identical across en/id/ms');
let keysOk = true;
for (const ns of Object.keys(json.en)) {
  for (const l of ['id', 'ms']) {
    const a = Object.keys(json.en[ns]).sort().join(',');
    const b = Object.keys(json[l][ns] ?? {}).sort().join(',');
    if (a !== b) { keysOk = false; console.log(`  MISMATCH ${l}.${ns}`); }
  }
}
check(keysOk, 'locale keys identical across en/id/ms per namespace');
let phOk = true;
const ph = (s) => [...String(s).matchAll(/\{[^}]*\}/g)].map((m) => m[0]).sort().join(',');
for (const ns of Object.keys(json.en)) {
  for (const k of Object.keys(json.en[ns])) {
    for (const l of ['id', 'ms']) {
      if (ph(json.en[ns][k]) !== ph((json[l][ns] ?? {})[k])) { phOk = false; console.log(`  PLACEHOLDER ${l}.${ns}.${k}`); }
    }
  }
}
check(phOk, 'placeholders byte-identical across en/id/ms');
const inclusive = [
  ['track.searching', ['courier', 'kurir', 'kurier']],
  ['nocourier.title', ['courier', 'kurir', 'kurier']],
  ['track.d_picked_up', ['courier', 'kurir', 'kurier']],
  ['cheer.sub', ['courier', 'kurir', 'kurier']],
];
for (const [dotted, wants] of inclusive) {
  const [ns, k] = dotted.split('.');
  const vals = locales.map((l) => String(json[l][ns][k]));
  const okName = vals.every((v, i) => v.toLowerCase().includes(wants[i]));
  const okNoRunner = vals.every((v) => !/(runner|pelari)/i.test(v));
  check(okName && okNoRunner, `${dotted} addresses the courier inclusively in en/id/ms`);
}

// 4. Wallet hold: the server deducts into escrow at order time, so the app
// must drop its cached balance right after money moves.
check(checkout.includes("invalidateQueries({ queryKey: ['wallet'] })"), 'checkout refreshes the wallet after pay (hold shows at once)');
check(orderPage.includes("invalidateQueries({ queryKey: ['wallet'] })"), 'order page refreshes the wallet after cancel (refund shows at once)');

// 5. Delivery point: Home + topbar follow the chosen/default address, never
// a stale hardcoded fallback. All coords come from the address book
// (`GET /v1/customer/addresses`) or the stored active point.
const hook = read('src/features/addresses/useDeliveryLocation.ts');
const active = read('src/features/addresses/active.ts');
const app = read('src/App.tsx');
const addrPage = read('src/features/addresses/AddressesPage.tsx');
check(active.includes('tb:delivery-location'), 'active point notifies mounted screens when the delivery point changes');
check(hook.includes("queryKey: ['addresses']") && hook.includes('listAddresses'), 'delivery hook reads the server address book, never hardcoded coords');
check(hook.includes('is_default') && hook.includes('DEFAULT_CENTER'), 'delivery hook prefers chosen/default address, Jakarta is the last-resort fallback only');
check(app.includes('useDeliveryLocation'), 'Home/topbar read the shared delivery hook instead of a one-shot localStorage read');
check(!app.includes('function customerLoc'), 'legacy one-shot customerLoc reader is gone');
check(app.includes('home.deliveringTo') && app.includes('home.change') && app.includes('home.noLocationSet'), 'Home shows the chosen/default point with a Change action, and honest empty copy');
check(addrPage.includes('setActiveDelivery'), 'address book persists through the shared delivery setter');

// 6. Live availability badge: the restaurant badge reflects couriers online
// near that restaurant right now — never a global hardcoded flag. One
// shared component renders both placements with runner+biker wording.
const badge = read('src/features/catalog/AvailabilityBadge.tsx');
const catalogApi = read('src/features/catalog/api.ts');
const catalogTypes = read('src/features/catalog/types.ts');
const catalogHooks = read('src/features/catalog/hooks.ts');
check(app.includes('<AvailabilityBadge') && !app.includes('runners_nearby'), 'Home + detail share AvailabilityBadge, no inline runners_nearby conditional left');
check(badge.includes('runnersBikersNearby') && badge.includes('isLiveNearby'), 'badge names runners & bikers via the live helper, never "courier" for a partner');
check(catalogTypes.includes('live_couriers_count') && catalogTypes.includes('parseLiveExtras'), 'restaurant rows carry live extras with a validating parser');
check(catalogTypes.includes('runners_nearby') && catalogApi.includes('parseLiveExtras'), 'legacy runners_nearby still parses (old backends/cached rows) and live fields are parsed');
check(catalogHooks.includes('refetchInterval'), 'catalog queries refetch on an interval so the badge stays live');
for (const l of locales) {
  check(typeof json[l].home.runnersBikersNearby === 'string' && json[l].home.runnersBikersNearby.length > 0, `${l}.home.runnersBikersNearby names runners & bikers`);
}

// 7. Restaurant rating: the stars on cards + detail come from the server
// aggregate over collected restaurant_stars — never a made-up number. One
// shared component renders both placements; unrated shows the New label.
const rating = read('src/features/catalog/RestaurantRating.tsx');
const ui = read('src/components/ui.tsx');
check(!ui.includes('ratingFor') && !app.includes('ratingFor'), 'no deterministic pseudo-rating helper left anywhere');
check(app.includes('<RestaurantRating') && rating.includes('home.unrated'), 'Home + detail share RestaurantRating with an honest unrated label');
check(catalogTypes.includes('rating_avg') && catalogTypes.includes('parseRatingExtras'), 'restaurant rows carry the rating aggregate with a validating parser');
check(catalogApi.includes('parseRatingExtras'), 'list + detail parsers pick up the rating aggregate');
for (const l of locales) {
  check(typeof json[l].home.unrated === 'string' && json[l].home.unrated.length > 0, `${l}.home.unrated labels unrated restaurants`);
}

// 8. No-courier choices: reachable exactly when dispatch gives up. The panel
// keys off the server's `delivery.status` (`no_courier`) on an accepted or
// ready order (dispatch only starts at merchant accept) — never the old
// `placed` + client-clock age — and every choice hits the real endpoint.
const panel = read('src/features/postdelivery/NoCourierPanel.tsx');
const postTypes = read('src/features/postdelivery/types.ts');
const postApi = read('src/features/postdelivery/api.ts');
const postHooks = read('src/features/postdelivery/hooks.ts');
const orderTypes = read('src/features/orders/types.ts');
const selfPickupCard = read('src/features/postdelivery/SelfPickupCard.tsx');
const between = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
const chooseFn = between(postApi, 'export async function chooseNoCourier', '/* ---------- impact');
const chooseHook = between(postHooks, 'export function useChooseNoCourier', '/** Measured customer impact');
check(postTypes.includes("args.delivery?.status === 'no_courier'") && postTypes.includes("status === 'accepted' || status === 'ready'"), 'choices open when the delivery is no_courier on an accepted/ready order');
check(panel.includes('needsNoCourierChoice') && !panel.includes("'placed'") && !panel.includes('created_at'), 'NoCourierPanel follows server dispatch state, not placed + client age');
check(orderPage.includes('<NoCourierPanel order={order} delivery={delivery} />'), 'OrderPage feeds the live delivery into NoCourierPanel');
check(orderPage.includes('!choiceNeeded && !selfPickup'), 'courier card steps aside while the choices or self-pickup own the slot');
check(orderTypes.includes("m['customer_pickup'] === true"), 'delivery parser reads customer_pickup from the server');
check(selfPickupCard.includes('order.code') && !selfPickupCard.includes('delivery_pin') && !selfPickupCard.includes('pickup_code'), 'self-pickup card shows the order code, never the PIN or the kitchen code');
check(orderPage.includes('{!selfPickup && <PinHandover'), 'delivery PIN card hidden once the customer collects it themselves');
check(chooseFn.includes('/delivery-choice') && !chooseFn.includes('cancelOrder') && !chooseFn.includes('enqueue'), 'choices hit delivery-choice only: no cancel fallback, no offline replay');
check(chooseHook.includes("queryKey: ['wallet']") && chooseHook.includes('orderKey(args.orderId)'), 'a choice refreshes the order + wallet (refund shows at once)');
check(locales.every((l) => Object.values(json[l].nocourier).every((v) => !/\d/.test(String(v)))), 'no-courier copy never hardcodes minutes (the wave follows the server search window)');

if (failures > 0) {
  console.error(`${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('smoke: all checks passed');
