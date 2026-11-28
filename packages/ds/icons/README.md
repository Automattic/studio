# Icons

Studio's custom icons, for what `lucide-react` doesn't draw the way the design wants.

**Belongs here:** a generic glyph. **Doesn't:** product artwork, app logos or illustrations, which stay with their feature.

## API

Each icon is a component that takes SVG props, exported from `@studio/ds/icons`.

```tsx
import { PinIcon } from '@studio/ds/icons';

<PinIcon className={ styles.icon } />;
```

Code that draws without React, such as the annotation script injected into the site preview, reads the shared paths from `@studio/ds/icons/paths`, so its pencil and plus match the components.

## Constraints

- One file per icon, named `<name>-icon.tsx`, re-exported from `index.ts`.
- Use the internal `Icon` component for stroked artwork on a 24px grid. It supplies the shared size, stroke, rounded caps and joins, and `aria-hidden`. Filled artwork keeps its original viewBox and uses `currentColor`.
- `ICON_SIZE` sets the 16px default for `Icon` and the app's `LucideProvider`; a component's CSS (or `size` on a lucide icon) sets another size. Color comes from CSS.

`ChecklistIcon` and `FileImageIcon` use [Solar Linear](https://github.com/480-Design/Solar-Icon-Set) artwork by 480 Design, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They preserve Solar's 1.5px stroke.
