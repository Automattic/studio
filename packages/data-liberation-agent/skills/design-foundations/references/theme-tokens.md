# Extracting theme.json tokens from captured styles

> **Since step 6 of `/liberate` (`design-foundations`), the site's `design.md` is the authoritative source for palette roles, font families, shadow stacks, and radius scale.** This file explains *how* to derive each value; `design.md` is *what* was derived. When emitting `theme.json`, copy values from `design.md` and use this file only to resolve format questions — e.g. how to express the captured spacing scale in `settings.spacing.spacingSizes`, or how `@font-face` URLs map into `settings.typography.fontFamilies`. If the two ever disagree, `design.md` wins and this file is the bug.

Translate the tokens and palette data in `<outputDir>/palette.json`, `<outputDir>/typography.json`, and captured section analysis into a `theme.json` for the generated block theme. Aim for a clean, minimal token set — do not port every computed value verbatim.

## Colors

The pipeline returns two color sources:

- **Button color token** — a non-framework-default button color, when one was found. Null otherwise. The extractor blacklists known page-builder default button colors (e.g. `#116DFF`, the Wix editor's default) because every page that hasn't been customized will return it, and it's almost never the user's actual brand color. If `tokens.defaultButtonSkipped: true` you can confirm the blacklist fired.
- **`palette.json`** — dominant colors sampled from the hero area, ranked by coverage. May be empty if CORS prevented canvas reads from the source CDN.

Decide the palette in this order:

1. **`base`** — almost always white (`#ffffff`) or the captured body bg if it's a near-white off-white.
2. **`contrast`** — `tokens.body.color` when it's a dark color; otherwise `#111111`.
3. **`primary`** — first try `tokens.button.bg`. If null, take `palette[0].hex` if it's not near-white and not near-black. If both fail, use a neutral charcoal `#1a1a1a`.
4. **`secondary`** — `palette[1]` if present, else a light tint of `primary`.
5. Optionally `tertiary` / `accent` from `palette[2..3]` if they are visually distinct.

Cap the palette at 6 named colors. Always include `base` and `contrast` so WP's duotone and style variations work.

```json
"color": {
  "palette": [
    { "slug": "base", "name": "Base", "color": "#ffffff" },
    { "slug": "contrast", "name": "Contrast", "color": "#111111" },
    { "slug": "primary", "name": "Primary", "color": "#2563eb" },
    { "slug": "secondary", "name": "Secondary", "color": "#f1f5f9" }
  ]
}
```

**Never use a page-builder default color as `primary` unless the original site is genuinely branded in that color.** The extractor already blacklists the known defaults; honor its signal. If you find yourself tempted to override `tokens.defaultButtonSkipped: true` and use the skipped color, first verify against the desktop screenshot that the color actually appears as a brand accent and not just as an unstyled button.

### Page-wide background gradient

If the captured body background is a gradient (from the pipeline's aggregated `palette.json` or `typography.json` body-bg field), emit it into `theme.json` `styles.background.gradient` so every section inherits it from `<body>`:

```json
"styles": {
  "background": { "gradient": "<captured gradient verbatim>" },
  "color": { "text": "var(--wp--preset--color--contrast)" },
  ...
}
```

With this set, the pattern generator MUST omit `backgroundColor` / `style.background` on any section whose `effectiveBg.source === 'pageBackground'` — painting it twice produces visible stripes as each `core/group` restarts the gradient. Sections with a locally-scoped gradient (`source: 'wrapper' | 'ancestor' | 'sibling'`) still emit inline per `references/section-mapping.md` gradient rule.

Also emit a `style.css` fallback for page-wide gradients, because Automattic Studio (our preview runtime) may apply only inline global styles until the theme stylesheet is explicitly enqueued. Use `functions.php` to enqueue `style.css`, and prefer a scroll-sized full-page background for visual QA screenshots:

```css
body {
  background-color: <dominant-end-stop>;
  background-image: <captured-gradient>;
  background-repeat: no-repeat;
  background-size: 100% 100%;
  background-attachment: scroll;
}
```

Avoid `background-attachment: fixed` for benchmark screenshots unless the source capture visibly requires it; full-page screenshot tools often paint fixed backgrounds only for the first viewport.

### Gradient color stops

If any captured section has an effective background that is a gradient, parse its first two color stops with a simple regex (`#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)`) and check each against the palette above. If one of the stops is within ~20 LAB units of `primary` or `secondary`, no change — the gradient will read as a brand tint. If neither stop matches, add the two stops as additional palette entries (`accent-start`, `accent-end`) so later edits in the Site Editor surface them as pickable colors. Don't try to auto-register gradient **presets** in `theme.json` for this iteration — inline `style.background` on each `core/group` (per `references/section-mapping.md`) is enough.

## Typography

`typography.json` (produced by the pipeline's screenshot aggregator) captures font metrics per selector, deduped and ranked by URL-coverage. The largest visible text on the page — not whatever `<h1>` happens to be in the DOM — is the display font source of truth. Body font is sampled from paragraph-sized text elements, not from `getComputedStyle(body)` (which often returns a browser default like `Arial, Helvetica, sans-serif` and is useless).

Many builder sites use commercial fonts via their own CDNs. You cannot ship those. Match the captured family against this commercial-to-free substitution table, then self-host the free replacement via the theme's `assets/fonts/` directory — **do not** emit `@import url('https://fonts.googleapis.com/...')` in `theme/style.css`. Google Fonts' CDN blocks offline rendering, causes a flash of unstyled text on first paint, and leaks visitor IPs to a third party.

| Captured family substring (case-insensitive) | Free replacement |
| --- | --- |
| `quasimoda` | Hanken Grotesk (Google Fonts) — closest free geometric-humanist grotesque (x-height + terminal shape); preferred over rounder Mulish / narrower Figtree |
| `madefor-display`, `madefor-text`, `madefor` | Inter (Google Fonts) |
| `helvetica-w01`, `helveticaneuew01`, `helveticaneuew02`, `helveticaneuew10` | Inter or system Helvetica Neue |
| `helvetica neue`, `helvetica` | Inter or system stack |
| `avenir next`, `avenir` | Nunito Sans (Google Fonts) |
| `futura` | Jost (Google Fonts) |
| `proxima nova`, `proxima-nova` | Montserrat (Google Fonts) |
| `sofia pro`, `sofia-pro` | Manrope (Google Fonts) |
| `ideal sans` | Source Sans 3 (Google Fonts) |
| `brandon grotesque`, `brandon-grot` | Mulish (Google Fonts) |
| `adobe garamond pro`, `adobe-garamond` | EB Garamond (Google Fonts) |
| `gotham` | Inter or Montserrat |
| `freight sans`, `freight-sans` | Source Sans 3 (Google Fonts) |
| `freight display`, `freight-display` | Cormorant Garamond (Google Fonts) |
| `eb garamond` | EB Garamond (Google Fonts — already free, use as-is) |
| `playfair display`, `playfair` | Playfair Display (Google Fonts — use as-is) |
| `cormorant garamond`, `cormorant` | Cormorant Garamond (Google Fonts — use as-is) |
| `bodoni`, `libre bodoni` | Libre Bodoni (Google Fonts) |
| `libre baskerville`, `baskerville` | Libre Baskerville (Google Fonts — use as-is) |
| Webflow default UI sans | Inter (Google Fonts) |
| Squarespace default serif | Cormorant Garamond or Playfair Display |
| Typekit-served family with `typekit.net` or `use.typekit.com` URL | Look up the kit ID → match against this table; otherwise pick a visual lookalike (serif → EB Garamond, sans-serif → Inter) |
| `wfont_*` (hashed Wix font name) or any other hashed/obfuscated family | **Unrecoverable** — fall back to a visual lookalike based on the screenshot: serif → EB Garamond, sans-serif → Inter, display → Archivo Black |

Match by case-insensitive substring against the captured font family from `typography.json`. Self-host via the theme's `assets/fonts/` directory and wire up `@font-face` rules in `style.css`. Never reference a commercial-font CDN (`parastorage.com`, `static.wixstatic.com`, `use.typekit.net`, `fonts.squarespace-cdn.com`, `uploads-ssl.webflow.com`).

If the captured display element is actually the headline (not the `<h1>`), use that element's `fontSize` for the `xx-large` preset upper bound.

### Commercial / uncapturable → free substitution (deterministic)

This substitution is now **automated** in the deterministic theme-scaffold path — you usually don't hand-write it:

- `src/lib/replicate/font-substitution.ts` holds the substitution table (commercial/uncapturable family → free replacement) plus the gstatic woff2 URLs for each free family. The free families are Google Fonts **variable** woff2 (one file covers the whole weight axis via a `font-weight` range like `"400 700"`).
- `src/lib/replicate/font-substitution-download.ts` downloads the free woff2 into `assets/fonts/` (self-hosted — never an `@import url(fonts.googleapis.com/...)`).
- The `liberate_theme_scaffold` handler runs this whenever the observed BODY or DISPLAY family (from `typography.json`) has **no self-hostable `@font-face`** among the captured fonts (e.g. a Typekit family served CSS-only on `use.typekit.net`). It binds the body/display `fontFamily` in `theme.json` to the self-hosted free family. The captured-but-self-hostable case (e.g. getsnooz's heading `Larsseit` on the Shopify CDN) is untouched — only genuinely uncapturable families are swapped.

When adding a new mapping, prefer matching the source font's classification (geometric-humanist sans → Hanken Grotesk; neutral sans → Inter; geometric sans → Montserrat; old-style serif → EB Garamond) and verify the substitute computes live (body paragraphs should report the substituted family, not a bare `sans-serif`). Unmapped uncapturable families fall back to a visual lookalike (serif → EB Garamond, sans → Inter).

## Font sizes

Build a fluid scale. Use `clamp()` for responsive sizes:

```json
"fontSizes": [
  { "slug": "small",  "name": "Small",  "size": "0.875rem" },
  { "slug": "medium", "name": "Medium", "size": "1rem" },
  { "slug": "large",  "name": "Large",  "size": "clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem)" },
  { "slug": "x-large","name": "XL",     "size": "clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem)" },
  { "slug": "xx-large","name": "XXL",   "size": "clamp(2.5rem, 1.8rem + 3vw, 4rem)", "fluid": false }
]
```

Pick the `xx-large` upper bound from the captured display font size (in `rem`, where 1rem = 16px). For example, captured `fontSize: 110` (px) → `xx-large` upper = `6.875rem`. Cap at `8rem` to avoid runaway display sizes.

## Spacing

Snap derived spacing to:

```
20: 0.25rem
30: 0.5rem
40: 1rem
50: 1.5rem
60: 2rem
70: 3rem
80: 4rem
```

Use these for block spacing presets and template spacing. Don't hardcode pixel values in templates.

## Layout widths

From the captured content width (via `breakpoints.json` or section analysis):

```json
"layout": {
  "contentSize": "720px",
  "wideSize": "1200px"
}
```

Round `wideSize` to the nearest 20px below the captured content width (e.g. captured `1425px` → `1400px`). Set `contentSize` to ~720–820px for readable prose regardless of `wideSize`.

## The brightness rule (determines `core/cover` vs `core/group` hero)

After picking `base` and `contrast`, compute the brightness of `base`:

```
brightness = 0.299 * R + 0.587 * G + 0.114 * B
```

- **brightness ≥ 200** (near-white base) → pattern generation MUST use the `core/group` variant of the `cover-with-headline` template from `references/section-mapping.md`. `core/cover` forces its inner text color to white when an overlay is present, which produces invisible headings on light backgrounds. This is a hard rule, not a preference.
- **brightness < 200** (dark base) → `core/cover` is fine and its default white inner text reads correctly.

Record the computed brightness value in the spec file's "Captured palette" section so the pattern generator can pick the right template variant without recomputing.

## What NOT to copy

- Hashed class selectors from page builders (`.comp-xxxx`, `.txt-xxxx`, `.w-XXXX`, `.sqsrte-*`)
- Inline absolute `top/left` positioning
- Builder-specific CSS variables (`--wix-*`, `--sqs-*`, `--w-*`) — start fresh with `--wp--preset--*`
- Any font file hosted on a builder CDN (`parastorage.com`, `wixstatic.com`, `fonts.squarespace-cdn.com`, `uploads-ssl.webflow.com`)
- Framework-default button colors as brand colors — the extractor already blacklists these via `tokens.defaultButtonSkipped`
