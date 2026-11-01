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

Use `--hover` for neutral hovered, pressed, expanded and selected button or row fills. It follows the enclosing `--surface`, so current sidebar rows and Settings tabs use the same fill as hover. Accent toolbar toggles use an accent fill and text while active.

Floating surfaces set `--surface` to `--popover` and use `--popover-border` for their opaque outline.

Filled accent buttons, feature popovers and annotation markers use `--accent-solid` with `--accent-solid-foreground`. This pair keeps the light scheme's contrast-adjusted accent and white foreground in both schemes. Buttons and feature popovers share `--accent-inset-shadow`; the popover arrow uses its `--accent-inset-color`. Text, icons, focus rings and subtle accent states keep using the scheme-aware `--accent-text` and `--accent` tokens.

## Constraints

- The two stylesheets are imported once, by the app entries, before anything else.
- Colors derive in CSS from a few inputs on the root (`--tint-hue`, `--tint-intensity`, `--tint-saturation`, `--contrast`, `--accent-fill`). Add a token rather than a literal color anywhere in the app.
- Imports nothing from the app; `@studio/common` only for the preference types and defaults.
