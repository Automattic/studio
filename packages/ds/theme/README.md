# Theme

The design tokens, the base element styles, and the code that applies the color scheme and the Appearance settings to the page.

**Belongs here:** tokens, the reset and element defaults, color math for the accent and tint. **Doesn't:** component styles (those live next to each component) or reading the saved preferences (the app does that and calls `applyTheme`).

## API

- `tokens.css`: every token (`--background`, `--foreground`, `--muted`, `--border`, `--accent`, `--text-*`, `--radius-*`, `--motion-*`, `--z-*`, …). Dark values apply under `[data-color-scheme='dark']`.
- `base.css`: the reset, fonts, body and element defaults, reduced transparency.
- `@studio/ds/theme`: `applyTheme`, `applyColorTint`, `resolveColorScheme`, `getMotionDuration`, `getEmbeddedFontData`.

```ts
import '@studio/ds/theme/tokens.css';
import '@studio/ds/theme/base.css';
import { applyTheme, resolveColorScheme } from '@studio/ds/theme';

applyTheme( resolveColorScheme( preferences.colorScheme ), preferences.colorTint );
```

## Motion

Use `--motion-duration-layout` for deliberate changes to the sidebar or workspace panes and `--motion-duration-disclosure` for expanding content. Both use the shared soft-close curve. Small floating surfaces and feedback use the surface and feedback durations; dialogs use the quick duration for scale.

Keep navigation, selection, streamed text and status updates, and initial or restored layouts immediate. A dragged or keyboard-resized boundary follows its input directly; transitions can finish a drag after release. Let movement reverse without blocking interaction, and wait for an exit to finish before replacing its visible content. Reduced motion removes layout movement while retaining brief opacity and color feedback.

## Surfaces and selection

The numbered `--surface-0` through `--surface-4` tokens form the palette. Every element derives `--muted` / `--hover`, `--selected`, and `--border` directly from its current `--surface`, preserving hue and chroma. Interaction steps darken in light mode and lighten in dark mode; selection uses 1.5 times the hover step. There is no separate canvas palette or lookup table. Containers declare `--surface` using their opaque semantic token, including when the native sidebar paints a translucent version of chrome.

Use `--hover` for pointer and keyboard highlights in menus and for neutral hover, press, and expanded feedback. Active browser tabs use the floating surface recipe. Selected site and chat rows use the sidebar’s local `--muted` fill. Use `--selected` for locally derived selection fills such as segmented and Settings tabs. Outline controls use `--hover-subtle`, half the same surface-relative interaction step, for quieter feedback. Accent toolbar toggles use `--accent-subtle` with `--accent-subtle-foreground`, switching to their hover tokens on hover. Their foreground is contrast-adjusted against the subtle fills alone, keeping the accent visible without the extra brightening needed for text on raised neutral surfaces. Tool links use `--accent-text` and `--accent-text-hover`. Subtle fills are opaque, so they stay identical across enclosing surfaces. Use these tokens rather than mixing a component-specific accent wash. Destructive menu items and quiet buttons use the neutral hover fill with a destructive foreground. Subtle error surfaces use the local hover lightness with a restrained red tint.

`--accent` / `--accent-hover` are solid action fills with `--accent-foreground` labels. Text and solid fills are contrast-adjusted independently; a readable link must not lighten its button. Appearance settings rotate the palette together. Accent text derives locally from the actual surface, preserving its chroma instead of brightening every link for the brightest possible selection. Solid fills and subtle foregrounds are checked separately in rendered sRGB; a subtle foreground is checked against both subtle fills.

Accent and destructive colors have three roles: solid fills with their on-fill foregrounds; subtle surfaces with their matching colored foregrounds; and colored text on neutral surfaces (`--accent-text` / `--destructive`). Solid destructive buttons use `--destructive-button-fill` and `--destructive-button-foreground`, while other indicators use `--destructive-fill` and `--destructive-foreground`. Do not use a text token as a control fill. Accent subtle foregrounds are checked against the subtle palette, while destructive foregrounds adapt to the actual declared surface. Badges, alerts, feedback buttons and error panels should declare their painted surface instead of adding separate color mixes or opacity to their text.

Controls that paint an inherited interaction fill (for example, `--surface: var(--muted)`) must inherit that source token explicitly (`--muted: inherit`) to avoid a circular definition. Their children derive new interaction colors from the painted surface. This is an inheritance boundary, not a component color adjustment.

Controls use `--border-width` (1px), including inputs, textareas, selects, outlined buttons and scope switches. Workspace dividers, composer groups and floating surfaces use `--hairline-width` (0.5px), including sidebar edges, browser headers and responsive preview frames and toolbars. Controls inside a composer or popover keep their 1px borders. Focused inputs and composer groups use a 1px accent outline overlapping the resting border, without changing layout. Resize dividers share this `--focus-border-width` and accent color for keyboard focus and dragging. Button focus rings keep their own width. Decorative borders derive from each element’s `--surface` with a separate OKLCH lightness step: lighter in dark mode and darker in light mode. `--popover-border` follows that local border color. `--input` uses that same quieter border for resting fields, while `--input-ring` / `--ring` use the exact `--accent` color used by accent buttons for keyboard focus, without a separate focus palette. Decorative preview dots stay subtle and are excluded from control/text contrast targets. The Appearance contrast control increases that step. Floating surfaces set `--surface` to `--popover` and use `--popover-border` for their opaque outline; the composer shares that surface and outline color.

## Text contrast

Primary, secondary and destructive text resolve locally alongside the interaction fills. Primary text uses the strongest local fill (`--text-surface`) as its contrast background. Destructive text checks the actual `--surface`, preserving its red chroma when an item is highlighted. Muted text targets 4.8:1 against the actual `--surface`, keeping secondary content quieter at rest. Menu, select and command rows declare their painted highlight as their surface, so muted content adapts when highlighted. Section and placeholder colors share the muted foreground calculation. Primary text targets 5.2:1, with the base primary color retained where it already exceeds that target. These CSS calculations approximate luminance with OKLCH L³ for the low-chroma surfaces; measure rendered sRGB colors when changing the palette or tint range. Hover and selected fills stop at lightness limits that leave room for readable text.

Destructive text follows the same contrast calculation, with chroma reduced near the gamut boundary. The destructive button fill and its foreground stay paired; making a warning label readable must not also change the button fill.

`--section-foreground` targets readable secondary text against the current surface alone. Use it for section labels that do not paint a hover or selected background; sidebar group headers keep this quieter color on hover. Interactive secondary text continues to use `--muted-foreground`, which accounts for the stronger interaction fills.

Placeholders use `--placeholder-foreground`, a quieter foreground checked against the resting surface rather than selected fills. The composer’s custom placeholder and native input/textarea placeholders share it.

## Constraints

- The two stylesheets are imported once, by the app entries, before anything else.
- Colors derive in CSS from a few inputs on the root (`--tint-hue`, `--tint-intensity`, `--tint-saturation`, `--contrast`, `--accent-fill`). Add a token rather than a literal color anywhere in the app.
- Imports nothing from the app or another workspace package. The saved preferences and their defaults belong to `@studio/common`; `applyColorTint` treats a missing value as the base palette `tokens.css` is drawn from.
