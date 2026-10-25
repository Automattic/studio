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
- Drawn the same way as lucide: a 24px grid, `stroke="currentColor"`, `strokeWidth="2"`, round caps and joins, `aria-hidden`.
- Icons render at 16px, like lucide's under the app's `LucideProvider`; a component's CSS (or `size` on a lucide icon) sets another size. Color comes from CSS.
