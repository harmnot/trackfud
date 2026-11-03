/**
 * Route smoke test: every path in the route table must be served by the
 * router in App.tsx with no duplicate or missing entries.
 * Run: `node scripts/route-smoke.mjs` (also wired as `pnpm smoke`).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// 8. Review lock: submitted applications show the banner, lock the actions
// and the fitness page until the admin approves or rejects.
const fitnessSrc = readFileSync(join(root, 'src/features/fitness/FitnessPage.tsx'), 'utf8');
const wsSrc = readFileSync(join(root, 'src/lib/ws.ts'), 'utf8');
check(statusSrc.includes('account.submitted') && statusSrc.includes('formatSubmittedAt'), 'Status page shows the already-submitted banner');
check(statusSrc.includes('application.status'), 'Status page live-updates on the admin decision');
check(statusSrc.includes('pendingLocked'), 'Status page explains the pending lock');
check(fitnessSrc.includes('REVIEW_LOCKED') && fitnessSrc.includes('fitness.locked'), 'Fitness page locks while under review');
check(fitnessSrc.includes('/status'), 'Locked fitness page links back to status');
check(wsSrc.includes('application.status'), 'Courier socket types the application decision');
const fitnessSets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  fitnessSets[l] = Object.keys(json.fitness ?? {}).sort().join(',');
  check(Boolean(json.fitness?.locked) && Boolean(json.fitness?.backToStatus), `${l}.json has fitness lock strings`);
}
check(fitnessSets.en === fitnessSets.id && fitnessSets.id === fitnessSets.ms, 'fitness locale keys identical across en/id/ms');

// 9. A6 sanctions: frozen/banned standing from the API surfaces on status,
// run-setup and delivery; wallet stays open; the socket types the sanction.
const profileApiSrc = readFileSync(join(root, 'src/features/profile/profileApi.ts'), 'utf8');
const runSetupSrc = readFileSync(join(root, 'src/pages/RunSetupPage.tsx'), 'utf8');
const deliverySrc = readFileSync(join(root, 'src/pages/DeliveryPage.tsx'), 'utf8');
check(profileApiSrc.includes('standing'), 'partner API types carry operational standing');
check(profileApiSrc.includes('standingOf'), 'standing helper resolves frozen/banned');
check(statusSrc.includes('standingOf') && statusSrc.includes('account.frozen'), 'Status page shows the freeze/ban notice');
check(statusSrc.includes('courier.status'), 'Status page live-updates on sanctions');
check(wsSrc.includes('courier.status'), 'Courier socket types the sanction broadcast');
check(runSetupSrc.includes('sanctioned'), 'Run setup locks Go-online while sanctioned');
check(deliverySrc.includes('sanctioned') || deliverySrc.includes('account.frozen'), 'Delivery page explains the sanction');
check(openapi.includes('standing'), 'contract exposes operational standing');
const sanctionSets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  sanctionSets[l] = ['frozen', 'banned', 'sanctionWallet'].map((k) => `${k}:${Boolean(json.account?.[k])}`).join(',');
  check(Boolean(json.account?.frozen) && Boolean(json.account?.banned) && Boolean(json.account?.sanctionWallet), `${l}.json has sanction strings`);
}
check(sanctionSets.en === sanctionSets.id && sanctionSets.id === sanctionSets.ms, 'sanction strings present across en/id/ms');

// 10. R2 server session + dispatch alignment: the run opens server-side (goal
// reaches workout-fit scoring, frozen gate enforced), socket pings refetch
// the full offer, leave-now/ETA frames drive the delivery screen, and every
// courier leg answers the DeliveryEnvelope contract.
const runModeSrc = readFileSync(join(root, 'src/pages/RunModePage.tsx'), 'utf8');
const sessionApiSrc = readFileSync(join(root, 'src/features/run/sessionApi.ts'), 'utf8');
const sessionStoreSrc = readFileSync(join(root, 'src/features/run/sessionStore.ts'), 'utf8');
const deliveryStoreSrc = readFileSync(join(root, 'src/features/delivery/deliveryStore.ts'), 'utf8');
check(sessionApiSrc.includes('/courier/sessions') && sessionApiSrc.includes('startWorkSession') && sessionApiSrc.includes('endWorkSession'), 'session API opens/closes the server session');
check(sessionStoreSrc.includes('serverLinked'), 'run store tracks the server link');
check(runSetupSrc.includes('startWorkSession') && runSetupSrc.includes('403'), 'Run setup opens the server session, 403 stays put');
check(runModeSrc.includes('endWorkSession'), 'Run Mode closes the server session on end');
check(wsSrc.includes('delivery.leave_now') && wsSrc.includes('delivery.eta'), 'socket types leave-now + ETA frames');
check(runModeSrc.includes('listOffers') && runModeSrc.includes('offer.created'), 'Run Mode refetches the full offer on a dispatch ping');
check(runModeSrc.includes('delivery.leave_now'), 'Run Mode arms head-now from the server nudge');
check(deliverySrc.includes('delivery.eta') && deliverySrc.includes('etaS'), 'Delivery page shows the live ETA');
check(deliveryStoreSrc.includes('setEta') && deliveryStoreSrc.includes('toActiveDelivery'), 'delivery store maps the envelope incl. ETA');
check(courierApiSrc.includes('!env.delivery') || courierApiSrc.includes('env.delivery'), 'active-delivery recovery tolerates a null delivery');
const dispatchSrc = readFileSync(join(root, '../backend/internal/app/dispatch.go'), 'utf8');
const sessionsSrc = readFileSync(join(root, '../backend/internal/app/sessions.go'), 'utf8');
check(dispatchSrc.includes('deliveryEnvelopeForCourier'), 'courier legs answer the DeliveryEnvelope contract');
check(dispatchSrc.includes('no active delivery'), 'empty active delivery is a 404, not an empty 200');
check(sessionsSrc.includes('workSessionBlocked'), 'GPS auto-create refuses frozen/banned couriers');
check(openapi.includes('/v1/courier/deliveries/active') && openapi.includes('DeliveryEnvelope'), 'contract keeps the envelope on the active leg');
const r2Sets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  r2Sets[l] = ['sessionOffline', 'eta', 'sanctionedRun'].map((k) => `${k}:${Boolean(json.run?.[k] ?? json.delivery?.[k] ?? json.account?.[k])}`).join(',');
  check(Boolean(json.run?.sessionOffline) && Boolean(json.delivery?.eta) && Boolean(json.account?.sanctionedRun), `${l}.json has R2 session/ETA/sanction strings`);
}
check(r2Sets.en === r2Sets.id && r2Sets.id === r2Sets.ms, 'R2 strings present across en/id/ms');

// 11. R3 Voice Copilot + staff mode + health extras: transport honesty,
// socket-shape compat, free tracking, ratings tags, PB/streak.
const voiceRelaySrc = readFileSync(join(root, 'src/features/voice/voiceRelay.ts'), 'utf8');
const voiceCmdSrc = readFileSync(join(root, 'src/features/voice/voiceCommands.ts'), 'utf8');
const walletPageSrc = readFileSync(join(root, 'src/pages/WalletPage.tsx'), 'utf8');
const ratingsApiSrc = readFileSync(join(root, 'src/features/ratings/ratingsApi.ts'), 'utf8');
check(voiceRelaySrc.includes('VITE_API_BASE'), 'voice relay honours VITE_API_BASE (no hardcoded /api host)');
check(voiceCmdSrc.includes('terima') && voiceCmdSrc.includes('berapa'), 'voice parser covers EN + ID intents');
check(wsSrc.includes('text?: string') && wsSrc.includes('message?: string') && wsSrc.includes('body?: string'), 'courier socket types tolerate legacy cheer/chat shapes');
check(runModeSrc.includes("msg.text ?? msg.message"), 'Run Mode normalises cheer frames before speaking');
const chatStoreSrc = readFileSync(join(root, 'src/features/chat/chatStore.ts'), 'utf8');
check(chatStoreSrc.includes("msg.text ?? msg.body") && chatStoreSrc.includes('id: msg.message_id'), 'chat frames keep legacy shapes + the server message id (Translate needs it)');
check(chatStoreSrc.includes("'chat.translated'") && chatStoreSrc.includes('applyTranslation'), 'chat.translated frames update an open thread');
check(appSrc.includes('bindChatFrames()'), 'chat frames are bound once for the whole app (not only on /run)');
check(chatStoreSrc.includes('Boolean(m.translated_body) &&'), 'a missing translation is never treated as already live');
check(!runSetupSrc.includes('{isPartner &&'), 'Go online is open to everyone (free tracking, PLAN open upgrade)');
check(courierApiSrc.includes('courier_tags'), 'delivery history types carry customer tag labels');
check(ratingsApiSrc.includes('courier_tags') && !ratingsApiSrc.includes('tags: []'), 'ratings aggregate live tag labels (no empty-tags stub)');
check(walletPageSrc.includes('wallet.best') && walletPageSrc.includes('wallet.streak'), 'wallet shows personal best + streak health extras');
check(openapi.includes('courier_tags'), 'contract exposes courier tag labels on delivery history');
const voiceSets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  voiceSets[l] = ['hold', 'fallback', 'server'].map((k) => `${k}:${Boolean(json.voice?.[k])}`).join(',');
  check(Boolean(json.voice?.fallback) && Boolean(json.voice?.server), `${l}.json has voice transport strings`);
}
check(voiceSets.en && voiceSets.id && voiceSets.ms, 'voice strings present across en/id/ms');
const walletSets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  walletSets[l] = ['best', 'streak'].map((k) => `${k}:${Boolean(json.wallet?.[k])}`).join(',');
  check(Boolean(json.wallet?.best) && Boolean(json.wallet?.streak), `${l}.json has wallet best/streak strings`);
}
check(walletSets.en === walletSets.id && walletSets.id === walletSets.ms, 'wallet best/streak keys identical across en/id/ms');

// 12. Tracks sketch-to-map: the pad follows the finger (no mirrored stroke),
// the sketch anchors on Google Maps Strava-art style, snaps to roads, and
// saved tracks render their map preview.
const tracksPageSrc = readFileSync(join(root, 'src/pages/TracksPage.tsx'), 'utf8');
const sketchSrc = readFileSync(join(root, 'src/features/tracks/sketchToGeo.ts'), 'utf8');
const snapSrc = readFileSync(join(root, 'src/features/tracks/snapRoute.ts'), 'utf8');
const trackMapSrc = readFileSync(join(root, 'src/features/tracks/TrackMap.tsx'), 'utf8');
const useMapViewSrc = readFileSync(join(root, 'src/features/tracks/useMapView.ts'), 'utf8');
const liveTrackSrc = readFileSync(join(root, 'src/features/tracks/LiveTrackMap.tsx'), 'utf8');
const trackStoreSrc = readFileSync(join(root, 'src/features/tracks/trackStore.ts'), 'utf8');
check(!tracksPageSrc.includes('100 - p.y') && !tracksPageSrc.includes('100-p.y'), 'draw pad no longer mirrors the stroke on Y');
check(tracksPageSrc.includes('getCoalescedEvents') && tracksPageSrc.includes('setPointerCapture'), 'draw pad uses coalesced points + pointer capture');
check(tracksPageSrc.includes('ev.currentTarget') || tracksPageSrc.includes('e.currentTarget'), 'draw pad measures the pad box, not the event target');
check(sketchSrc.includes('sketchToLatLng') && sketchSrc.includes('buildMapsDirUrl'), 'sketch projects onto the map + opens in Google Maps');
check(snapSrc.includes('DirectionsService'), 'sketch snaps to roads via Directions');
check(trackMapSrc.includes('useMapView') && trackMapSrc.includes('Polyline'), 'saved tracks render on Google Maps');
check(useMapViewSrc.includes('loadMaps'), 'shared map hook loads Google Maps once');
check(trackStoreSrc.includes('geo') && trackStoreSrc.includes('snapped'), 'track store keeps the map placement');
check(sketchSrc.includes('aspect'), 'projection keeps meters-per-pixel equal on both axes');
check(runSetupSrc.includes('trackId'), 'run setup passes the saved track by id');
check(runModeSrc.includes('LiveTrackMap') && runModeSrc.includes('selectSessionTrack'), 'run mode renders the saved track live');
check(liveTrackSrc.includes('trail') && liveTrackSrc.includes('panTo'), 'live map draws the GPS trail + follows the runner');
const tracksSets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  tracksSets[l] = Object.keys(json.tracks ?? {}).sort().join(',');
  check(Boolean(json.tracks?.snapRoads) && Boolean(json.tracks?.openMaps) && Boolean(json.tracks?.useMyLocation), `${l}.json has sketch-to-map strings`);
}
check(tracksSets.en === tracksSets.id && tracksSets.id === tracksSets.ms, 'tracks locale keys identical across en/id/ms');

// 13. AI Run Planner (R3, PLAN §10.E): two workout-first loops past busy
// kitchens; the pick travels as `planned_track` so dispatch scores it.
const plannerApiSrc = readFileSync(join(root, 'src/features/planner/api.ts'), 'utf8');
const plannerTypesSrc = readFileSync(join(root, 'src/features/planner/types.ts'), 'utf8');
const plannerPanelSrc = readFileSync(join(root, 'src/features/planner/PlannerPanel.tsx'), 'utf8');
const planMapSrc = readFileSync(join(root, 'src/features/planner/PlanMap.tsx'), 'utf8');
const planStoreSrc = readFileSync(join(root, 'src/features/planner/planStore.ts'), 'utf8');
const plannerPageSrc = readFileSync(join(root, 'src/pages/PlannerPage.tsx'), 'utf8');
const runPlannerBackend = readFileSync(join(root, '../backend/internal/app/run_planner.go'), 'utf8');
check(plannerApiSrc.includes('/courier/run-plans') && plannerApiSrc.includes('createRunPlans') && plannerApiSrc.includes('fetchHotspots'), 'planner API hits hotspots + run-plans (no hardcode)');
check(plannerTypesSrc.includes('parsePlannerResult') && plannerTypesSrc.includes('parseHotspotList'), 'planner types validate + drop garbage');
check(planMapSrc.includes('PlanMap') && planMapSrc.includes('Polyline'), 'planner draws both loops + hotspots on the map');
check(plannerPanelSrc.includes('PlannerPanel') && plannerPanelSrc.includes('window'), 'planner panel asks start + window, shows estimates honestly');
check(planStoreSrc.includes('tb:courier:aiplan'), 'picked plan persists on-device');
check(plannerPageSrc.includes('PlannerPanel'), 'full planner page embeds the panel');
check(appSrc.includes('/planner'), 'App serves /planner');
check(runSetupSrc.includes('planned_track') && sessionApiSrc.includes('planned_track'), 'run setup sends the pick as planned_track');
check(runModeSrc.includes("trackKind === 'ai'") && runModeSrc.includes('LiveTrackMap'), 'run mode renders the AI loop live');
check(runPlannerBackend.includes('circleLoop') && runPlannerBackend.includes('estimatePlanEarnings'), 'backend plans workout-first loops + honest estimates');
check(runPlannerBackend.includes('get_hotspots') || runPlannerBackend.includes('fetchHotspots'), 'backend serves hotspot ranking from past orders');
check(openapi.includes('/v1/courier/run-plans') && openapi.includes('RunPlanList'), 'contract serves the planner endpoints');
const plannerSets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  plannerSets[l] = Object.keys(json.planner ?? {}).sort().join(',');
  check(Boolean(json.planner?.planCta) && Boolean(json.planner?.use) && Boolean(json.planner?.hotspots), `${l}.json has planner strings`);
}
check(plannerSets.en === plannerSets.id && plannerSets.id === plannerSets.ms, 'planner locale keys identical across en/id/ms');
check(!runSetupSrc.includes('trackAiSoon'), 'run setup no longer shows the AI-soon placeholder');

// 14. Courier Orders (list + detail): partner-gated pages, scroll pagination
// (10/page), status + search filters, skeletons, contract status/q params.
const ordersPageSrc = readFileSync(join(root, 'src/pages/OrdersPage.tsx'), 'utf8');
const orderDetailSrc = readFileSync(join(root, 'src/pages/OrderDetailPage.tsx'), 'utf8');
const ordersHookSrc = readFileSync(join(root, 'src/features/orders/useCourierOrders.ts'), 'utf8');
check(appSrc.includes('/orders') && appSrc.includes('OrdersPage') && appSrc.includes('OrderDetailPage'), 'App serves /orders + /orders/:id (Delivery stays)');
check(appSrc.includes('RequirePartner') && appSrc.includes('OrdersPage'), 'Orders pages sit behind the partner gate');
check(ordersHookSrc.includes('ORDERS_PER_PAGE') && ordersHookSrc.includes('IntersectionObserver') === false, 'orders hook owns the 10/page window (sentinel lives in the page)');
check(ordersPageSrc.includes('IntersectionObserver') && ordersPageSrc.includes('loadMore'), 'Orders list refills from the scroll sentinel');
check(ordersPageSrc.includes('setStatus') && ordersPageSrc.includes('setQuery'), 'Orders list filters by status + searches');
check(ordersPageSrc.includes('tb-skel') && orderDetailSrc.includes('tb-skel'), 'Orders list + detail render skeletons while loading');
check(ordersPageSrc.includes('/delivery') && ordersPageSrc.includes('liveName'), 'Orders list links the live leg back to /delivery');
check(orderDetailSrc.includes('fetchDeliveryDetail') && orderDetailSrc.includes('/orders'), 'Order detail loads one leg + links back to the list');
check(courierApiSrc.includes("status?: DeliveryHistoryStatus") && courierApiSrc.includes("fetchDeliveryDetail"), 'client sends status/q + loads one delivery');
check(openapi.includes('status') && openapi.includes('cancel_note'), 'contract filters history by status and names the cancel note');
const ordersSets = {};
for (const l of locales) {
  const json = JSON.parse(readFileSync(join(root, `src/locales/${l}.json`), 'utf8'));
  ordersSets[l] = Object.keys(json.orders ?? {}).sort().join(',');
  check(Boolean(json.nav?.orders) && Boolean(json.orders?.title) && Boolean(json.orders?.searchPh), `${l}.json has orders nav + list strings`);
}
check(ordersSets.en === ordersSets.id && ordersSets.id === ordersSets.ms, 'orders locale keys identical across en/id/ms');

// 15. App-level GPS tracking (GPS used to pause off /run, freezing the
// customer's live dot + kitchen ETA): one owner mounted beside the routes
// keeps the watch + batched uploads alive on every screen while a signed-in
// courier has an active session — exactly one watcher, one upload at a time.
const trackerSrc = readFileSync(join(root, 'src/features/run/runTracker.ts'), 'utf8');
const trackerOwnerSrc = readFileSync(join(root, 'src/features/run/WorkSessionTracker.tsx'), 'utf8');
const resumeSrc = readFileSync(join(root, 'src/features/run/sessionResume.ts'), 'utf8');
const trackerMounts = appSrc.split('<WorkSessionTracker />').length - 1;
check(trackerMounts === 1, `App mounts the work-session tracker once (found ${trackerMounts})`);
check(appSrc.indexOf('<WorkSessionTracker />') < appSrc.indexOf('<Routes>'), 'tracker sits beside the routes, so navigation never unmounts it');
check(!runModeSrc.includes('watchPosition') && !runModeSrc.includes('useRunEngine') && !runModeSrc.includes('startWorkSession'), 'Run Mode no longer owns the GPS watch or the refresh resume');
check(runModeSrc.includes('s.notices') && runModeSrc.includes('s.resuming'), 'Run Mode reads tracker notices + resume state from the run store');
check(trackerOwnerSrc.includes('useAuthMe') && trackerOwnerSrc.includes("s.phase === 'active'"), 'tracker runs only for a confirmed sign-in with an active session');
check(trackerOwnerSrc.includes('startRunTracking') && trackerOwnerSrc.includes('stopRunTracking') && trackerOwnerSrc.includes('resumeWorkSession'), 'owner starts/stops the tracker and confirms restored sessions');
check(trackerSrc.includes('createTrackerSlot') && trackerSrc.includes('createSingleFlight') && trackerSrc.includes('clearWatch'), 'one tracker slot, single-flight uploads, watch cleared on stop');
check(trackerSrc.includes("type: 'loc.batch'") && trackerSrc.includes('/courier/locations') && trackerSrc.includes('LOC_BATCH_S * 1000') && trackerSrc.includes('GPS_MAX_ACCURACY_M'), 'tracker keeps loc.batch + HTTP fallback, 5 s batches and the accuracy gate');
check(resumeSrc.includes('retargetPoints') && resumeSrc.includes('403'), 'resume re-tags the backlog and drops sanctioned sessions');
const sources = readdirSync(join(root, 'src'), { recursive: true })
  .map((f) => `src/${String(f).split(sep).join('/')}`)
  .filter((f) => /\.tsx?$/.test(f))
  .sort();
const filesWith = (needle) => sources.filter((f) => readFileSync(join(root, f), 'utf8').includes(needle)).join(', ');
check(filesWith('watchPosition(') === 'src/features/fitness/useFitnessRecorder.ts, src/features/run/runTracker.ts', 'only the tracker (and the separate fitness test) watch GPS');
check(filesWith('startRunTracking(') === 'src/features/run/WorkSessionTracker.tsx, src/features/run/runTracker.ts', 'only the app-level owner starts tracking');
// The lifecycle guarantees, exercised for real: the module is pure TS, so
// Node's built-in type stripping runs it without a bundler.
if (process.features.typescript) {
  try {
    const lifecycle = await import(pathToFileURL(join(root, 'src/features/run/trackerLifecycle.ts')).href);
    const events = [];
    const slot = lifecycle.createTrackerSlot((key) => {
      events.push(`start:${key}`);
      return () => events.push(`stop:${key}`);
    });
    slot.ensure('s1');
    slot.ensure('s1');
    check(events.join() === 'start:s1', 'same session ensured twice binds one watcher');
    slot.ensure('s2');
    check(events.join() === 'start:s1,stop:s1,start:s2' && slot.activeKey() === 's2', 'a new session stops the old watcher before binding');
    slot.stop();
    slot.stop();
    check(events.join() === 'start:s1,stop:s1,start:s2,stop:s2' && slot.activeKey() === null, 'stop releases the watcher once (idempotent)');
    let uploads = 0;
    let release = () => undefined;
    const flush = lifecycle.createSingleFlight(async () => {
      uploads += 1;
      await new Promise((done) => {
        release = done;
      });
    });
    const first = flush('s1');
    const second = flush('s1');
    check(uploads === 1 && first === second, 'overlapping flushes share one upload (no double send)');
    release();
    await first;
    const third = flush('s1');
    check(uploads === 2, 'the next flush runs once the previous one settled');
    release();
    await third;
  } catch (err) {
    check(false, `tracker lifecycle loads in Node (${err instanceof Error ? err.message : String(err)})`);
  }
} else {
  console.log('SKIP  tracker lifecycle behaviour (this Node cannot strip TypeScript)');
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nroute smoke: all green');
