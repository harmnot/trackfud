# Trackfud — Landing Page

Public marketing site for **Trackfud** (`Run. Ride. Earn.`). English only, SEO-friendly, built with Astro as a fully static page — no backend or API needed to serve it.

It introduces the three audiences — **customers**, **couriers (runners & bikers)** and **merchants** — and the core promise: no mobile-app download, everything runs right in the browser. The page never uses the acronym “PWA”; it says “no download” and “works in your browser” instead.

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

## Notes

- Main calls to action scroll to on-page sections (`#customers`, `#couriers`, `#merchants`, `#pwa`, `#get-started`) by design — no app links are wired yet.
- The slogan is always `run. ride. earn` (wordmark) / `Run. Ride. Earn.` (headlines).
