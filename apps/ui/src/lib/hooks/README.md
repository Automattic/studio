# lib/hooks

React hooks that any app could use: they read the browser, not Studio.

**Belongs here:** a hook built only on React and web APIs (`useOffline`, `usePointerDrag`, `useStoredFlag`, `useWindowControlsOverlay`, `useConfirmOnEnter`). **Doesn't:** a hook that calls the connector or a query (it goes in `data/`, `data/host/` for host APIs), or one that knows a product concept (it goes in its feature).

## API

```tsx
import { useOffline } from '@/lib/hooks';

function SyncButton() {
	const offline = useOffline();
	return <Button disabled={ offline }>Sync</Button>;
}
```

## Constraints

- No imports from `data/`, `features/`, `router/` or `app/` (lint-enforced), and no `@tanstack/*`.
- A hook used by a single feature lives in that feature until a second one needs it.
