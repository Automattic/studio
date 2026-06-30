---
name: design-foundations
description: Build a coherent design-foundation JSON from a liberated site — semantic color/typography/spacing roles with evidence trails. Consumes the partial scaffold produced by liberate_design_foundation_scaffold plus aggregate HTML/CSS analysis and representative rendered HTML; produces a complete design-foundation matching the schema. Call after liberation, before theme generation.
---

# Design Foundations

You build a coherent **design foundation** — a semantic, reviewable intermediate between raw SP1 token observations and WordPress theme generation.

## Input contract

The agent gives you:

1. A `PartialDesignFoundation` JSON blob (the output of `liberate_design_foundation_scaffold`). Some roles are already filled in by deterministic rules. The remaining slots are `null`, listed in `skillTodos`.
2. Aggregate HTML/CSS analysis files: `palette.json`, `typography.json`, `breakpoints.json`, and when present `computed-styles.json`.
3. Paths to representative rendered HTML excerpts (e.g. `<outputDir>/html/homepage.html`).
4. Optional paths to screenshots for ambiguity checks only.
5. Access to the MCP tool `liberate_design_foundation_validate`.

### Evidence mode — HTML/CSS first, screenshots only for ambiguity

Vision context is the dominant cost in this skill. The normal path should not open screenshots. Use rendered HTML, aggregate computed CSS, and deterministic scaffold evidence first.

If the invoking runner provides a `Foundation sample` JSON, that sample is a hard cap: do **not** inspect HTML outside the listed entries. Use aggregate `palette.json`, `typography.json`, `breakpoints.json`, and `computed-styles.json` for broad frequency and component signals. Use only the sampled HTML for semantic role decisions.

**Step 1 — aggregate CSS analysis (cheap):**

Read aggregate analysis before opening any visual asset:

- `palette.json`: high-frequency background colors.
- `typography.json`: observed font families, sizes, weights, and line heights.
- `computed-styles.json`: component-level text, background, border, radius, padding, typography, and background-image evidence for selectors like `header`, `footer`, `a`, `button`, form controls, hero/card/CTA containers.
- `breakpoints.json`: responsive tier evidence.

These files are generated from the live DOM using browser-computed CSS. They are the source of truth for colors and typography; screenshots are not needed to discover tokens.

**Step 2 — inspect the representative HTML (cap):**

Use the provided Foundation sample. In the fast path it contains at most one representative rendered HTML file, preferring the homepage. Inspect it for:

- `<header>`, `<footer>`, `<main>` boundaries.
- Button/link/nav/form selectors and class names.
- Inline styles, CSS variables, gradients, and background images.
- Whether a high-frequency color is actually a surface, text color, CTA, border, or decoration.

**Step 3 — screenshot fallback only when needed:**

Open a screenshot only if HTML/CSS evidence cannot answer a specific semantic question, for example:

- A color appears in multiple roles and computed selectors do not identify usage.
- A gradient/background image needs a role (`hero background`, `cta banner`, `decorative`) and HTML class names are unclear.
- Mobile stacking or overlaid composition affects a token decision.

If you open a screenshot, state exactly what ambiguity it resolved. **Do not read all screenshots.**

## Output contract

Return a **complete** `DesignFoundation` matching the schema documented in `src/lib/design-foundation/schema.ts`. The JSON must pass `liberate_design_foundation_validate` with `{ ok: true }`.

**You MUST call `liberate_design_foundation_validate` on your output before returning.** If it returns errors, fix them and re-validate. Do not return until validation passes.

## Role assignments — judgment criteria

The scaffold fills:
- `color.surface.base` — lightest high-frequency palette entry
- `color.text.default` — darkest high-frequency palette entry
- `typography.families.body` — most-common body fontFamily
- `breakpoints.{sm,md,lg,xl}` — nearest-tier mapping
- `gradient.*` — CSS strings (roles marked "TODO")
- `inputsDigest.*` — sha256s

You fill everything else. Use the criteria below.

### color.surface

| Role | How to pick |
|---|---|
| `raised` | A slightly-darker-or-lighter palette entry commonly used for cards, alternate sections, subtle containers. Prefer `computed-styles.json` selectors like card/section containers and representative HTML class names. |
| `inverse` | A saturated dark entry commonly used as a dark hero / footer background. Usually appears on most pages in header/footer patterns. |

### color.text

| Role | How to pick |
|---|---|
| `muted` | A mid-lightness entry used for secondary labels, placeholders, metadata. Usually appears in button labels, form hints, deemphasized text. |
| `inverse` | Near-white; used on inverse surfaces (dark hero text, footer text). |
| `subtle` | A very-light-on-light or very-dark-on-dark entry used for placeholder/ghost text. Often `#999`, `#ccc`, or the equivalent inversed on dark. |

### color.accent

Distinguish by saturation, frequency, and usage signal:

| Role | How to pick |
|---|---|
| `primary` | The dominant saturated color used on primary CTAs (Book a Demo, Sign Up, etc.). Usually visible on the homepage hero and most page footers. |
| `primaryAlt` | A slightly-varied primary (darker for hover state, or a closely-related hue used in gradients with primary). |
| `warning` | A red / warm orange used for urgent CTAs, alerts, "important" banners. Often appears on pricing or trial pages. |
| `warm` | A secondary accent in the orange/coral family used as a visual counterweight to primary. |
| `highlight` | A yellow / gold used in gradients or for highlighted text. Usually low-frequency but visually prominent where it appears. |

**Ambiguity rule:** If two entries both look like primary candidates, pick the one with higher `urls` (more pages). If still tied, pick the one with higher saturation.

### color.border

| Role | How to pick |
|---|---|
| `default` | A light-grey entry commonly used as a hairline divider (often `#ccc`, `#ddd`). |
| `subtle` | A lighter grey (or a tinted alternative) used inside low-contrast containers. |

### typography.families

The scaffold fills `body`. Fill:

| Role | How to pick |
|---|---|
| `display` | The family used for the largest headlines (h1, hero titles). Often a serif or display face. Check `typography.h1` entries in the raw SP1 file. |
| `mono` | A monospace family used for tags, labels, small caps. Check typography entries with `fontFamily` containing "Mono", "Courier", or "Code". If no mono family is observed, set to `null` — do NOT hallucinate one. |

### gradient

Scaffold fills `css` and `evidence`; you fill `role`. Map each gradient to its usage:

- `hero background` — dark, full-bleed, used as page hero/header background
- `cta banner` — used on call-to-action bands and subscribe blocks
- `headline accent` — light-to-highlight gradients used with `background-clip: text` on headlines
- `decorative` — anything else

Look at the HTML excerpt to see which selectors use the gradient.

### components (minimal fixed set)

Fill all five with token references (not raw values). Reference form: `"color.accent.primary"`, `"radius.base"`, `"spacing.4"`.

| Component | Required tokens |
|---|---|
| `button` | `background` (accent.primary), `text` (text.inverse), `radius` (radius.base), `padding`, `fontFamily` (families.body), `fontWeight` |
| `input` | `background` (surface.base), `border` (border.default), `text` (text.default), `radius`, `padding` |
| `card` | `background` (surface.base or surface.raised), `border` (border.subtle), `radius` (radius.lg), `padding` |
| `surface` | `background` (surface.base) — baseline container |
| `divider` | `background` (border.default), `height` (e.g. "1px") |

### openQuestions

Flag things that will affect downstream theme generation:

- Commercial fonts (e.g. Reckless, Displaay faces) → suggest open-source substitution (`Fraunces`, `Playfair`).
- **Uncapturable fonts (Typekit / Monotype / hashed builder names) →** these can't be self-hosted (no reachable woff/woff2). The deterministic font pipeline now AUTO-SUBSTITUTES them to the closest FREE web font, self-hosts its woff2, and binds it as the theme's body/display family — see `references/theme-tokens.md` ("Commercial / uncapturable → free substitution"). Record the substitution as an `openQuestion` (`blocksReplica:false`) noting which family was swapped (e.g. `quasimoda → Hanken Grotesk`) so an operator can confirm the visual match; do NOT leave the family as a bare `sans-serif` fallback.
- Font files loaded from unknown CDNs (no open license path).
- Colors observed once or twice that look like one-off overrides rather than design-system tokens — worth flagging for operator review.

Each entry: `{ id: "short-slug", question: "Confirm ...", blocksReplica: true|false }`.

## Evidence discipline

Every role you fill must have at least one evidence entry. Good evidence:

- `"palette[5]: 92/186 urls, 341 occurrences"` (cites raw SP1 frequency)
- `"computed button background on homepage.html"` (cites HTML + element)
- `"hero section @ screenshots/desktop/homepage.png"` (cites screenshot)

Bad evidence:

- `"looks like primary"` (no citation)
- `"skill-filled"` (placeholder — unacceptable)

## Process

1. Read the PartialDesignFoundation. Note every path in `skillTodos`.
2. Read aggregate HTML/CSS analysis and the representative HTML excerpt.
3. For each slot in `skillTodos`:
   - Apply the criteria above.
   - If you cannot confidently fill a slot (e.g. no mono family exists), leave it `null` AND remove its path from `skillTodos`. This communicates "deliberately empty" instead of "forgot to fill."
4. Populate `components` with the fixed set above.
5. Populate `openQuestions` with any concerns.
6. Set `skillTodos: []` once every remaining slot is filled.
7. Invoke `liberate_design_foundation_validate`. If it fails, fix and retry.
8. Return the validated JSON to the calling agent.

## Anti-patterns

- **Hallucinating tokens.** If SP1 didn't observe a `serif` family but the agent seems to want one, do NOT invent `"Merriweather"`. Leave `display: null` and add an `openQuestion` about font substitution.
- **Skipping evidence.** Every role must cite its source. No bare strings.
- **Skipping validate.** You MUST call `liberate_design_foundation_validate` before returning.
- **Over-confident mapping.** If two palette entries tie for `primary`, flag the tie in `openQuestions` rather than silently picking one.
- **Duplicating deterministic work.** Do not override the scaffold's filled slots (surface.base, text.default, etc.) unless they're demonstrably wrong.

## Known scaffold-pollution failure modes (correct these every run)

The deterministic scaffold can be misled by markup that isn't the real page design. These are common enough to check explicitly — when you see them, the slot IS "demonstrably wrong," so correct it against `palette.json` frequency + a screenshot and note the correction in `openQuestions`:

- **Inverted surface/text from a one-off CSS variable.** The scaffold can fill `color.surface.base` and `color.text.default` from a low-frequency `:root`/component CSS var (e.g. `--tooltip-background-color`) instead of palette frequency — producing `surface.base: "black"` / `text.default: "white"` on a site that's actually white-background/dark-text. **Sanity check: if `surface.base` is dark or `text.default` is light, verify against `palette.json` — the dominant high-count entry is the real surface; the darkest high-count entry is the real text.** Swiftlumber (2026-05-28): scaffold gave black/white from a 1-url tooltip var; palette showed `#ffffff`×57 / `#000000`×3 → corrected to #fff/#000.
- **10px base font size from a hidden SEO `<body>`.** `typography.scale.base` (and `typography.body.fontSize`) can read ~10px from a visually-hidden SEO body element. Real body copy is ~16px (check `typography.scale.steps.base`). Reconstruction uses captured per-element sizes, so this rarely changes output — but flag it in `openQuestions` so it isn't trusted downstream.
- **Hidden-SEO display font.** Computed `h1`/`h2` may report a hidden-SEO face (e.g. `orig_sf_pro_display_bold`, `wfont_*`) that is NOT the visible heading face. Cross-check `h3`/visible headings — the real display family often surfaces there (swiftlumber: visible headings are `"libre baskerville", serif` from h3; h1/h2 were the SEO SF-Pro face).

## Example (abbreviated)

Input partial (relevant slots only):

```json
{
  "color": {
    "accent": { "primary": null, "warning": null, "highlight": null }
  },
  "skillTodos": ["color.accent.primary", "color.accent.warning", "color.accent.highlight"]
}
```

Screenshot evidence: homepage CTA button is teal; "Book a Demo" button is red; headline text has a gold→red gradient.

Output:

```json
{
  "color": {
    "accent": {
      "primary": {
        "value": "#00a4bd",
        "role": "primary CTA, link",
        "evidence": [
          "palette[5]: 40/100 urls, 200 occurrences",
          "button.primary@homepage.html computed background"
        ]
      },
      "warning": {
        "value": "#f2545b",
        "role": "urgent CTA (Book a Demo)",
        "evidence": [
          "palette[7]: 30/100 urls",
          "a.cta-book@homepage.html computed background"
        ]
      },
      "highlight": {
        "value": "#ffc700",
        "role": "gradient highlight",
        "evidence": [
          "gradient.headlineAccent uses #ffc700 → #cc0201",
          "h1 span.highlight@homepage.html"
        ]
      }
    }
  },
  "skillTodos": []
}
```

Then call `liberate_design_foundation_validate` and return.
