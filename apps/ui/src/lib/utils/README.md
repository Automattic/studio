# lib/utils

Small framework-free helpers that several features need.

**Belongs here:** keyboard handling (`isShortcut`, `isTextEntry`, `isDialogOpen`, `isImeComposing`) and `createPendingSlot`, a one-value store for handing something to the next route when it can't ride in the URL. **Doesn't:** helpers that know about sites, chats or other product concepts. Those stay in their feature.

## API

```ts
import { createPendingSlot, isShortcut } from '@/lib/utils';

const pendingPromptSlot = createPendingSlot< PendingPrompt >();

if ( isShortcut( event, 'k' ) ) openPalette();
```

## Constraints

- Plain TypeScript: no React components, no app imports (lint-enforced).
