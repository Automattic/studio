# @studio/ui

A portable UI layer for Studio that can run as both an Electron renderer and a standalone web app.

## Architecture

### Dual-target design

The same React application runs in two environments with different data backends:

- **Electron**: Uses an IPC connector that delegates to `window.ipcApi` (exposed by the Electron preload script). Auth is optional (handled by the desktop app).
- **Web**: Uses a REST connector backed by the Telex API (`telex.automattic.ai`) with WordPress.com OAuth for authentication.

A single entry point (`main.tsx`) selects the connector at runtime based on the `__IS_ELECTRON__` Vite define (set via the `--mode` flag). The UI code never imports environment-specific modules directly.

### Connector pattern

The `Connector` interface (`data/core/types.ts`) defines the data operations the UI needs:

```
data/core/
  types.ts                # Connector interface + domain types (SiteDetails, AuthUser)
  connector-context.tsx   # React Context provider + useConnector() hook
  query-client.ts         # TanStack Query client with localStorage persistence
  connectors/
    ipc/index.ts          # Electron IPC implementation (requiresAuth: false)
    rest/index.ts         # Telex REST API + WP.com OAuth (requiresAuth: true)
```

Components access data through the `useConnector()` hook, which pulls the active connector from React Context. This keeps all UI code environment-agnostic.

The `Connector` interface includes an auth surface (`requiresAuth`, `isAuthenticated`, `authenticate`, `logout`, `getAuthUser`) alongside data methods (`getSites`, `createSite`, `deleteSite`, `startSite`, `stopSite`). The interface is intentionally minimal -- new methods are added as features are built.

### Authentication

The REST connector uses WordPress.com OAuth (implicit grant flow) for authentication:

1. `connector.authenticate()` redirects to `public-api.wordpress.com/oauth2/authorize`
2. After authorization, WordPress.com redirects back to `/auth/callback#access_token=...`
3. `main.tsx` intercepts the callback **before React mounts** to avoid TanStack Router parsing issues with special characters in the hash fragment
4. The token and user profile are stored in `localStorage`

Route protection is handled in the root route's `beforeLoad` hook. When `connector.requiresAuth` is true, all routes except `/login` require authentication -- unauthenticated users are redirected to `/login`.

The IPC connector sets `requiresAuth: false`, so auth checks are skipped entirely in Electron.

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

The router context carries both the `QueryClient` and `Connector`, enabling route-level data prefetching and auth checks in `beforeLoad` hooks.

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

UI is built with `@wordpress/ui` and `@wordpress/theme` from the WordPress Design System, plus `@wordpress/icons` for iconography.

## Development

You can run the UI in two modes during development:


```bash
# Web mode (REST connector, Telex API)
npm -w @studio/ui run dev:web

# Electron mode (Electron app with IPC connector)
npm run start:new-ui
```
