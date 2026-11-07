# lib/theme

The design tokens, the base element styles, and the code that applies the color scheme and the Appearance settings to the page.

**Belongs here:** tokens, the reset and element defaults, color math for the accent and tint. **Doesn't:** component styles (those live next to each component) or reading the saved preferences (the app does that and calls `applyTheme`).

## API

- `tokens.css`: every token (`--background`, `--foreground`, `--muted`, `--border`, `--accent`, `--text-*`, `--radius-*`, `--motion-*`, `--z-*`, …). Dark values apply under `[data-color-scheme='dark']`.
- `base.css`: the reset, fonts, body and element defaults, reduced transparency.
- `@/lib/theme`: `applyTheme`, `applyColorTint`, `resolveColorScheme`, `previewAccentColor`, `DEFAULT_COLOR_TINT`, `isDefaultColorTint`, `getMotionDuration`.

```ts
import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import { applyTheme, resolveColorScheme } from '@/lib/theme';

applyTheme( resolveColorScheme( preferences.colorScheme ), preferences.colorTint );
```

## Surfaces and selection

Use `--hover` for neutral hovered, pressed, expanded and selected button or row fills. It follows the enclosing `--surface`, so current sidebar rows and Settings tabs use the same fill as hover. Accent toolbar toggles and tool links share `--accent-subtle` and `--accent-text`, switching to `--accent-subtle-hover` and `--accent-text-hover` on hover. Subtle fills are opaque, so they stay identical across enclosing surfaces. Use these tokens rather than mixing a component-specific accent wash.

`--accent` / `--accent-hover` are solid action fills with `--accent-foreground` labels. Text and solid fills are contrast-adjusted independently; a readable link must not lighten its button. Appearance settings rotate the palette together, and contrast adjustment checks text against surfaces 0–3 and both subtle fills (surface 4 and its hover are checked for indicators).

Floating surfaces set `--surface` to `--popover` and use `--popover-border` for their opaque outline.

## Constraints

- The two stylesheets are imported once, by the app entries, before anything else.
- Colors derive in CSS from a few inputs on the root (`--tint-hue`, `--tint-intensity`, `--tint-saturation`, `--contrast`, `--accent-fill`). Add a token rather than a literal color anywhere in the app.
- Imports nothing from the app; `@studio/common` only for the preference types and defaults.
