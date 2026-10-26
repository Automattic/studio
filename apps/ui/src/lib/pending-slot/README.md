# lib/pending-slot

A one-value store for handing something to the next route when it can't ride in the URL: a parsed file, a prompt with attachments.

**Belongs here:** `createPendingSlot`, nothing else. **Doesn't:** the slots themselves (`pendingPromptSlot`, `pendingBlueprintSlot`), which live in the feature that reads them.

## API

```tsx
import { createPendingSlot } from '@/lib/pending-slot';

export const pendingBlueprintSlot = createPendingSlot< SelectedBlueprint >();

// Sender: set it, then navigate.
pendingBlueprintSlot.set( blueprint );

// Receiver: read it, and clear it once used.
const pending = useSyncExternalStore( pendingBlueprintSlot.subscribe, pendingBlueprintSlot.getSnapshot );
useEffect( () => {
	if ( pending ) {
		apply( pending );
		pendingBlueprintSlot.clear( pending );
	}
}, [ pending ] );
```

## Constraints

- Holds one value at a time and lives in memory only: a reload drops it.
- `clear( value )` only clears that same value, so a newer hand-off isn't lost.
- No React, no app imports (lint-enforced).
