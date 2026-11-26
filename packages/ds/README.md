# @studio/ds

Studio's design system: the UI primitives, the theme, the icons and generic React hooks. `apps/ui` builds on it, and any app or package can import it.

| Entry | What | README |
| --- | --- | --- |
| `@studio/ds` | Button, Dialog, Menu, Select, Field, Tooltip and the other primitives | [primitives](primitives/README.md) |
| `@studio/ds/theme` | `applyTheme` and the appearance logic | [theme](theme/README.md) |
| `@studio/ds/theme/tokens.css`, `@studio/ds/theme/base.css` | The tokens and the base styles, loaded once by each app entry | [theme](theme/README.md) |
| `@studio/ds/theme/recipes.module.css`, `@studio/ds/surface.module.css` | Declaration groups for `composes` | [theme](theme/README.md) |
| `@studio/ds/icons` | Studio's custom icons | [icons](icons/README.md) |
| `@studio/ds/icons/paths` | Icon paths for code that draws without React, such as the preview's annotation script | [icons](icons/README.md) |
| `@studio/ds/hooks` | Hooks built only on React and web APIs | [hooks](hooks/README.md) |

## Constraints

- Knows nothing about Studio's data: imports no other workspace package, only libraries. No `@tanstack/*`, `@wordpress/ui` or `@wordpress/components`.
- The four folders import each other only through their entries (`index.ts`).
- Styles are CSS Modules in the `ui` cascade layer, which `tokens.css` declares after `base`, so an app's own CSS overrides them.

These are lint-enforced in the root `.oxlintrc.json`, and the styles in `eslint.config.mjs`.
