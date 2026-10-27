---
name: i18n-string
description: Add or change a Trackfud UI string across locales without breaking placeholders or formatting.
---

# I18n String

Use when adding or changing user-visible copy in any of the three PWAs.
Locales live in each app's `locales/` (`en.json`, `id.json`, +1). Context:
`docs/frontend-architecture.md` §4, `docs/app-context.md` §6 (global rules).

1. Add the key to `en.json` first (source of truth). Reuse an existing key
   when the copy already exists — no duplicates.
2. Add the same key to every other locale file. Keep all `{placeholders}`
   byte-identical across languages; never reorder or rename them unless the
   ICU syntax supports it and every locale matches.
3. Render money via `Intl.NumberFormat` from minor units, distances via the
   km/mi formatter, times via the locale formatter — never interpolate raw
   values into the string.
4. Use the string via the `t()` helper / `react-i18next` hook; check the
   screen in each language (including a long-German-style overflow glance and
   right-to-left-safe layout where applicable).
5. Report keys added/changed, locales touched, and screens checked.
