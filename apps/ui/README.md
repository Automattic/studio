# @studio/ui

A new UI layer for Studio that runs as the Electron renderer.

The UI is built around a portable connector pattern, so the same React app could be wired to a different backend (e.g. a REST API for a hosted/web version) without changing the UI code. For now, only the Electron IPC connector is shipped.

## Architecture

### Connector pattern

The `Connector` interface (`data/core/types.ts`) defines the data operations the UI needs:

```
data/core/
  types.ts                # Connector interface + domain types (SiteDetails, AuthUser)
  connector-context.tsx   # React Context provider + useConnector() hook
  query-client.ts         # TanStack Query client with localStorage persistence
  connectors/
    ipc/index.ts          # Electron IPC implementation
```

Components access data through the `useConnector()` hook, which pulls the active connector from React Context. This keeps all UI code environment-agnostic.

The interface includes both a data surface (`getSites`, `createSite`, `deleteSite`, `startSite`, `stopSite`) and an auth surface (`requiresAuth`, `isAuthenticated`, `authenticate`, `logout`, `getAuthUser`). The auth surface is reserved for future non-Electron connectors -- the IPC connector sets `requiresAuth: false` and delegates to the desktop app.

### Data fetching with TanStack Query

Query hooks in `data/queries/` wrap connector methods with TanStack Query for caching, deduplication, and cache invalidation. The query client uses localStorage persistence (24h max age) mirroring the wp-calypso setup.

```typescript
function useSites() {
  const connector = useConnector();
  return useQuery({
    queryKey: ['sites'],
    queryFn: () => connector.getSites(),
  });
}
```

Mutations invalidate related queries on success, keeping the UI in sync without manual refetching.

### Routing with TanStack Router

Routes are **code-based** (not file-based), following the wp-calypso hosting dashboard pattern. Routes are defined with `createRoute()` calls under `router/` and assembled into a route tree in `router/router.tsx`.

The router context carries both the `QueryClient` and `Connector`, enabling route-level data prefetching in `beforeLoad` hooks.

### Component structure

Components use a folder-per-component pattern with CSS Modules:

```
components/
  sidebar-layout/
    index.tsx
    style.module.css
  site-list/
    index.tsx
    style.module.css
  onboarding-layout/
    index.tsx
    style.module.css
```

UI is built on Base UI with its own primitives and theme. Icons come from `lucide-react`, plus custom icons in `src/lib/icons/`, one file each, drawn the same way (24px grid, stroke 2).

## Design system

`src/theme/tokens.css` defines every token the UI uses:

- **Surfaces**, from lightest to darkest in light mode: `--surface-0`…`--surface-4`, named by role as `--background`, `--chrome` (sidebar, header band), `--chat`, `--composer`, `--popover`, `--content` and `--muted` (cards, code, chips). `--hover` is the hover fill of the surface it sits on.
- **Text and lines**: `--foreground`, `--muted-foreground`, `--border`, `--input`, `--ring`.
- **Actions and status**: `--primary`, `--secondary`, `--accent` (and `--accent-text`, `--accent-foreground`), `--destructive`, `--success`, `--warning`, plus `--status-*` for the vivid status dots.
- **Type, shape and motion**: `--font-sans`, `--font-mono`, `--text-xxs`…`--text-xl`, `--font-weight-*`, `--radius-*`, `--focus-width`, `--band-height`, `--control-size`, `--motion-duration-*` and `--motion-ease-*`.

Primitives live in `src/components/ui/` (Button, IconButton, Dialog, Menu, Popover, Select, Field, Input, InputGroup, Textarea, Switch, Checkbox, Tooltip, Alert, Badge, Progress, Empty, Kbd, VisuallyHidden). They follow the rebuild's kit, sit in the `ui` cascade layer so feature CSS overrides them without specificity tricks, and import nothing from app code.

Colors derive in CSS from a few inputs on the root element (`--tint-hue`, `--tint-intensity`, `--tint-saturation`, `--contrast`, `--accent-fill`), so light, dark and the Appearance settings change them without any palette code. Dark values apply under `[data-color-scheme='dark']`, on the root or on any element that should render in the other scheme.

## Development

Run the full Electron app with the new UI as the renderer:

```bash
npm run start:new
```
