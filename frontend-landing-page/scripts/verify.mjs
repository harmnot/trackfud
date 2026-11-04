// Focused regression checks for the landing page.
// Run after `npm run build`:  node scripts/verify.mjs
import { readFileSync, existsSync } from 'node:fs';

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

const header = read('src/components/Header.astro');
const phone = read('src/components/PhoneMock.astro');
const dist = read('dist/index.html');

// 1. Double navbar: the collapsible mobile nav must stay hidden until opened.
//    A class rule `display:flex` on .mobile-nav overrides the UA [hidden]
//    rule, so an explicit `.mobile-nav[hidden]` rule is required.
check('mobile nav starts hidden in markup', /data-mobile-nav hidden/.test(header));
check(
  'CSS keeps [hidden] mobile nav off screen (.mobile-nav[hidden] rule)',
  /\.mobile-nav\[hidden\]\s*\{\s*display:\s*none/.test(header),
);
// Phone mocks contain their own app topbars, so count the site header itself.
check('exactly one site header in built page', (dist.match(/<header class="site-header"/g) || []).length === 1);
check('exactly one mobile nav in built page', (dist.match(/data-mobile-nav/g) || []).length >= 1 && (dist.match(/id="mobile-nav"/g) || []).length === 1);

// 2. Phone simulator must mirror the real PWAs and scale with its container.
check('phone scales via container query units (cqw)', /container-type:\s*inline-size/.test(phone) && /cqw/.test(phone));
check('phone has no fixed pixel width', !/\.phone\s*\{\s*width:\s*280px/.test(phone));
check('phone mirrors PWA topbar (.tb-topbar)', phone.includes('tb-topbar'));
check('phone mirrors PWA bottom nav (.tb-nav)', phone.includes('tb-nav'));
check('customer phone mirrors shop card (.tb-shop)', phone.includes('tb-shop'));
check('courier phone mirrors offer card (.tb-offer)', phone.includes('tb-offer'));
check('merchant phone mirrors kitchen bar (.tb-kitchen-bar)', phone.includes('tb-kitchen-bar'));

// 3. Plain language: visitors should never need to know the acronym "PWA".
check('built page never shows the acronym PWA', !/\bPWA\b|Progressive Web App/.test(dist));
check('built page says no download in plain words', /No download/.test(dist));

// 4. Phone frame must read as a real device, not an oval pill.
check('phone has a camera dot (no oval island/cover)', phone.includes('pm-cam') && !phone.includes('pm-island'));
check('phone has side buttons', phone.includes('pm-keys'));
check('phone has a home indicator', phone.includes('pm-home'));
check('phone inner layout has no fixed min-widths that overflow small sizes', !/min-width:\s*26px|min-height:\s*26px|min-width:\s*15px/.test(phone));
check('phone frame is a simple thin bezel (no thick oval border)', /border-radius:\s*3cqw/.test(phone) && !/border:\s*1\.4cqw|outline:/.test(phone));
check('each mock zooms into one feature (focus crop, not a squeezed full page)', phone.includes('pm-focus'));

// 5. Marquee + page must be fluid on desktop and mobile.
const sections = read('src/components/Sections.astro');
const hero = read('src/components/Hero.astro');
check('marquee type scales with viewport (clamp)', /\.marquee-track\s*\{[^}]*font-size:\s*clamp/.test(sections));
check('hero stacks CTAs full-width on small phones', /@media \(max-width: 480px\)[\s\S]*\.hero-ctas/.test(hero));

// 6. No bezel padding on the phone, no overflowing install card, seamless marquee.
const closing = read('src/components/Closing.astro');
check('phone bezel is thin (1cqw, no thick frame)', /\.phone\s*\{[^}]*padding:\s*1cqw/.test(phone));
check('install card cannot overflow (margin-centred, no transform animation)', !/\.install-card\s*\{[^}]*animation:\s*floaty/.test(closing) && /\.install-card\s*\{[^}]*margin-inline:\s*auto/.test(closing));
check('marquee repeats enough chunks to fill wide screens seamlessly', (sections.match(/marquee-chunk/g) || []).length >= 2 && /Array\.from|\[\s*0,\s*1,\s*2,\s*3/.test(sections));

// 7. Audience overlap + mock readability on small screens.
check('audience phone sits below the photo on mobile (no overlap)', /@media \(max-width: 600px\)[\s\S]*\.audience-phone\s*\{[^}]*position:\s*static/.test(sections));
check('mobile audience phone is a cropped zoom of the key card (short aspect, nav hidden)', /@media \(max-width: 600px\)[\s\S]*aspect-ratio:\s*300\s*\/\s*440/.test(sections));
check('phone boosts relative type at small widths (container query)', /@container/.test(phone));
check('customer mock shows only its feature (no stats wall, no sub line)', phone.includes('tb-shop') && !phone.includes('Sorted by distance') && !phone.includes('30–60′</strong>'));
check('courier mock shows only its feature (offer + stats, no goal ring)', phone.includes('tb-offer') && !phone.includes('Of goal'));

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll landing checks passed');
