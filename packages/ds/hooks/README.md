# Hooks

React hooks that any app could use: they read the browser, not Studio.

**Belongs here:** a hook built only on React and web APIs (`useMediaQuery`, `useReducedMotion`, `useOffline`, `usePointerDrag`, `useStoredFlag`, `useWindowControlsOverlay`). Keyboard hooks go in `apps/ui`'s `lib/keyboard`. **Doesn't:** a hook that calls the connector or a query (it goes in `apps/ui`'s `data/`, `data/host/` for host APIs), or one that knows a product concept (it goes in its feature).

## API

```tsx
import { useOffline } from '@studio/ds/hooks';

function SyncButton() {
	const offline = useOffline();
	return <Button disabled={ offline }>Sync</Button>;
}
```

## Constraints

- No imports from `data/`, `features/`, `router/` or `app/` (lint-enforced), and no `@tanstack/*`.
- A hook used by a single feature lives in that feature until a second one needs it.
