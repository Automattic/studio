# lib/icons

Studio's custom icons, for what `lucide-react` doesn't draw the way the design wants.

**Belongs here:** a generic glyph. **Doesn't:** product artwork, app logos or illustrations, which stay with their feature.

## API

Each icon is a component that takes SVG props, exported from `@/lib/icons`.

```tsx
import { PinIcon } from '@/lib/icons';

<PinIcon className={ styles.icon } />;
```

## Constraints

- One file per icon, named `<name>-icon.tsx`, re-exported from `index.ts`.
- Use the internal `Icon` component for stroked artwork on a 24px grid. It supplies the shared size, stroke, rounded caps and joins, and `aria-hidden`. Filled artwork keeps its original viewBox and uses `currentColor`.
- `ICON_SIZE` sets the 16px default for `Icon` and the app's `LucideProvider`; a component's CSS (or `size` on a lucide icon) sets another size. Color comes from CSS.
