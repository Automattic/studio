# @studio/ui

The UI of Studio: the renderer of the Desktop app and the page `studio ui` serves in the browser.

The UI is built around a portable connector pattern, so the same React app runs against either backend without changing the UI code: the `ipc` connector talks to the Electron main process, the `local` connector to the `apps/local` HTTP server.

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
    local/index.ts        # `studio ui` HTTP/SSE implementation
```

Components access data through the `useConnector()` hook, which pulls the active connector from React Context. This keeps all UI code environment-agnostic.

The interface includes both a data surface (`getSites`, `createSite`, `deleteSite`, `startSite`, `stopSite`, …) and an auth surface (`getAuthUser`, `authenticate`, `logout`).

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

### Source layout

```
src/
  lib/        internal packages: ui, theme, icons, hooks, keyboard, pending-slot
  features/   product areas: chats, composer, sidebar, sites, settings, sync,
              sharing, credits, account, commands, notifications, annotations,
              onboarding
  data/       connectors, queries, data/host/ for hooks over host APIs, and
              the app state several features share
  router/     routes
  app/        providers
```

- `lib/` packages know nothing about Studio, so they can move to `packages/` later (for example to share `lib/ui` and `lib/theme` with `apps/mcp-ui`). Each has a README and one entry: import `@/lib/ui`, never `@/lib/ui/button`. They import nothing from `features/`, `data/`, `router/` or `app/`.
- A feature owns its components, hooks and helpers, in a folder per component with a CSS Module:

  ```
  features/sites/
    index.ts            what other features, routes and providers may use
    site-preview/
      index.tsx
      style.module.css
    get-site-url.ts
  ```

  Inside a feature, import with the full path (`@/features/sites/site-preview`). From anywhere else, import the entry (`@/features/sites`). Only `router/`, `app/` and other features import features; `data/` and `lib/` don't.
- `data/` holds the connectors and the TanStack Query hooks built on them, plus the app state several features read, such as the session's preview UI, the sidebar's state and the settings sections. It imports only `lib/`.
- Something used by one feature lives in that feature. Something product-aware used by several lives in the feature that owns the concept and is exported from its entry. Only app-agnostic pieces go in `lib/`.
- Features depend on each other in one direction: if `sidebar` imports `chats`, `chats` doesn't import `sidebar`, not even through another feature. Type-only imports don't count. When two features need each other, move the shared piece down into `data/` (state and hooks) or into the lower feature, or let `router/` pass the higher feature's component in as a prop.

These boundaries are lint-enforced (`import-x/no-restricted-paths` and `import-x/no-cycle` in the root `eslint.config.mjs`).

UI is built on Base UI with its own primitives and theme. Icons come from `lucide-react`, plus custom icons in `src/lib/icons/`, one file each, drawn the same way (24px grid, stroke 2).

## Design system

The theme lives in `src/lib/theme/`:

- `tokens.css`: every design token, below.
- `base.css`: the page and element defaults (fonts, body, headings, icon size, reduced transparency).
- `index.ts`: applies the color scheme and the Appearance settings to the root; `accent-contrast.ts` and `color.ts` keep the accent readable; `motion.ts` reads the motion tokens from script.

`tokens.css` defines every token the UI uses:

- **Surfaces**, from lightest to darkest in light mode: `--surface-0`…`--surface-4`, named by role as `--background`, `--chrome` (sidebar, header band), `--chat`, `--composer`, `--popover` and `--muted` (cards, code, chips). `--hover` is the hover fill of the surface it sits on.
- **Text and lines**: `--foreground`, `--muted-foreground`, `--border`, `--input`, `--ring`.
- **Actions and status**: `--primary`, `--secondary`, `--accent` (and `--accent-text`, `--accent-foreground`), `--destructive`, `--success`, `--warning`, plus `--status-*` for the vivid status dots.
- **Type, shape and motion**: `--font-sans`, `--font-mono`, `--text-xxs`…`--text-xl`, `--font-weight-*`, `--radius-*`, `--shadow-*`, `--z-*` layers, `--focus-width`, `--band-height`, `--control-size`, `--motion-duration-*` and `--motion-ease-*`.

Primitives live in `src/lib/ui/` (Button, IconButton, Dialog, Menu, Popover, Select, Field, Input, InputGroup, Textarea, Switch, Checkbox, Tooltip, Alert, Badge, Progress, Empty, Kbd, VisuallyHidden). They follow the rebuild's kit, sit in the `ui` cascade layer so feature CSS overrides them without specificity tricks, and import nothing from app code.

Colors derive in CSS from a few inputs on the root element (`--tint-hue`, `--tint-intensity`, `--tint-saturation`, `--contrast`, `--accent-fill`), so light, dark and the Appearance settings change them without any palette code. Dark values apply under `[data-color-scheme='dark']`, on the root or on any element that should render in the other scheme.

## Development

Run the Desktop app with the UI as its renderer:

```bash
npm start
```

Or serve it in the browser through `studio ui`:

```bash
npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui
```

For hot reload in the browser, keep that server running and start the Vite dev server, which proxies `/api` to it (`STUDIO_UI_SERVER=http://localhost:<port>` for a server on another port), then open http://localhost:5400:

```bash
npm -w @studio/ui run dev:local
```
