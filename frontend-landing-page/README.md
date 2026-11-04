# Trackfud — Landing Page

Public marketing site for **Trackfud** (`Run. Ride. Earn.`). English only, SEO-friendly, built with Astro as a fully static page — no backend or API needed to serve it.

It introduces the three audiences — **customers**, **couriers (runners & bikers)** and **merchants** — and the core promise: no mobile-app download, everything runs right in the browser. The page never uses the acronym “PWA”; it says “no download” and “works in your browser” instead.

## Features

- **Hero:** staggered headline (`Run. Ride. Earn.`), floating CSS phone mockups with a live route animation and count-up earnings, dual CTAs (get started / see how it works).
- **Phone simulator:** `PhoneMock.astro` renders CSS phone mockups mirroring the real apps — customer topbar/display/search/promo/shop, courier goal ring + offer card, merchant kitchen bar, shared bottom nav. Scales with container-query (`cqw`) units, stays proportional at hero, side-phone and mobile sizes.
- **Sections:** how-it-works steps, three audience cards (customers / couriers / merchants), feature grid, customer/merchant/courier stories, install-guide strip, FAQ accordion, final CTA + footer.
- **Design:** tokens shared with the other frontends (`tokens.css` pairing: `#060709` ink, `#34d399` live-green only), Newsreader (serif) + Inter (sans) self-hosted in `public/fonts/`; motion (reveal, counter, marquee) disabled under `prefers-reduced-motion`.
- **SEO:** semantic landmarks, one `<h1>`, meta description, Open Graph / Twitter cards, `Organization` + `WebSite` + `FAQPage` JSON-LD, descriptive alt text, `robots.txt`. All copy lives in `src/data/content.ts` so wording changes never touch markup.

## Flow

```text
hero (promise + live mock) → how it works → audiences (customers / couriers / merchants)
  → features → stories → install guide → FAQ → get started (scrolls to on-page sections)
```

Calls to action scroll to on-page sections by design — no app links are wired yet. The slogan is always `run. ride. earn` (wordmark) / `Run. Ride. Earn.` (headlines).

## Run locally

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
npm run preview  # preview the production build
```

## Design

- **Colors** follow the other frontends exactly (`src/styles/tokens.css` in each app): background `#060709`, ink `#f4f4f5`, muted `#a1a1aa`, faint `#63636b`, line `rgba(255,255,255,0.1)`, good `#34d399`, warn `#fbbf24`, danger `#fb7185`. Monochrome black / gray / white throughout; green only for live signals.
- **Type** is the shared app pairing: Newsreader (serif display) + Inter (sans), self-hosted in `public/fonts/`.
- **Motion**: staggered hero headline, floating phone mockups with a live route animation and count-up earnings, marquee slogan, scroll reveals, image zoom and card lifts on hover — all disabled under `prefers-reduced-motion`.
- **Phone simulator**: `src/components/PhoneMock.astro` renders CSS phone mockups that mirror the real apps — same `tb-topbar`, `tb-display`, `tb-search`, `tb-promo`, `tb-shop`, courier goal ring + `tb-offer`, merchant `tb-kitchen-bar`, and `tb-nav` bottom bar. It scales fluidly with container-query (`cqw`) units, so it stays proportional at hero, side-phone and mobile sizes. Run `npm run verify` for the regression checks (hidden mobile nav, single site header, mock fidelity and scaling).
- **People photography**: AI-generated realistic people in `public/images/` (runner, biker, merchant, customer). No logos or readable text in the images.
- **Favicon**: `public/favicon.png` is the project `merchant.png`, used only as the browser icon — never shown in page banners.

## Structure

```text
src/
  data/content.ts       all copy in one place (nav, steps, audiences, features, stories, FAQs)
  layouts/Layout.astro  SEO head (title, description, Open Graph, Twitter, JSON-LD), reveal + counter scripts
  components/           Header, Hero, PhoneMock, Sections (how / audiences / features), Closing (stories / PWA / FAQ / CTA), Footer (FAQ JSON-LD)
  styles/global.css     design tokens + base, buttons, reveal and keyframes
  pages/index.astro     page assembly only
public/
  images/  fonts/  favicon.png  robots.txt
```

## SEO

Semantic landmarks, one `<h1>` (`Run. Ride. Earn.`), meta description, Open Graph / Twitter cards, `Organization` + `WebSite` + `FAQPage` JSON-LD, descriptive alt text, and `robots.txt`. Copy lives in `src/data/content.ts` so wording changes never touch markup.

## Brand / X kit

Profile + banner art in `public/brand/x/`, set in the header wordmark
(Inter ExtraBold `Trackfud` + Newsreader italic `run. ride. earn`,
`#060709` / `#F4F4F5` / `#A1A1AA`, live dot `#34D399`).

- `trackfud-x-profile-400.png` — upload this as the X avatar (400×400,
  shows as a circle; type stays inside the safe ring). `-800` is the
  2× master.
- `trackfud-x-profile-mono-*.png` — `T + live dot` alt, reads better
  at reply-size.
- `trackfud-x-banner-1500.png` — upload this as the X header
  (1500×500, ≤5 MB). `-3000` is the 2× retina master. Wordmark sits
  dead-centre so desktop (left avatar overlap) and mobile (centre
  crop) both keep it.
- `*.svg` — vector masters (web-font import, for print/web reuse).

PNGs are rasterized from the same self-hosted `public/fonts/` files
the page uses (variable woff2 instanced to static TTF at build time,
so Pillow shaping matches the browser). Re-run:

```sh
/home/pcalmira/.pyenv/versions/3.10.0/bin/python /tmp/trackfud-x-render.py
# (needs pillow + fonttools + brotli on that interpreter)
```

## Notes

- Main calls to action scroll to on-page sections (`#customers`, `#couriers`, `#merchants`, `#pwa`, `#get-started`) by design — no app links are wired yet.
- The slogan is always `run. ride. earn` (wordmark) / `Run. Ride. Earn.` (headlines).
