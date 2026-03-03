# Studio Addon System

## About this doc

This document describes the design and implementation of Studio's addon system — an extension mechanism that lets Automattic teams (and eventually third parties) add functionality to Studio without modifying the core codebase.

## Context

Studio shipped features that were really independent tools built into the app — a VIP Local Development Environment integration and a WordPress Contributor Toolkit are both good examples. Every such feature requires a PR into Studio core, goes through the same review pipeline as product changes, ships with every Studio update, and is co-maintained by the Studio team.

That works fine for small features but doesn't scale. Some integrations are useful only to specific teams. Some are exploratory. Some should be authored and maintained by the teams that own the underlying systems. The addon system defines an extension surface and lets contributors build on it.

## High-level approach

An addon is a self-contained TypeScript module that integrates with Studio through a defined set of "slots." It declares what it needs, Studio exposes those surfaces, and the rest of the app doesn't change.

**v1: Build-time bundling.** Addons live in `apps/studio/src/modules/addons/` and ship with Studio. They are updated when Studio updates. The loading mechanism (`getBundledAddons()`) is a single function that can later be swapped for a dynamic directory scan when runtime loading is needed.

**Future:** A dedicated `studio-addons` monorepo (separate GitHub repo) where each addon is an npm workspace package. A CI job opens a PR to Studio with the vendored addon tarball and a one-line update to `registry.ts`. This gives cleaner separation while keeping the Studio team in control of what ships.

## Slot surface (integration points)

| Slot | `AddonDefinition` field | `AddonPermission` |
|------|------------------------|-------------------|
| **IPC handlers** | `ipcHandlers` | `ipc:<prefix>` |
| **Preload API** | `preloadApi` | `ipc:<prefix>` |
| **App providers** | `appProviders` | `ui:app-providers` |
| **Main content renderer** | `mainContentRenderer` | `ui:main-content` |
| **Sidebar content** | `sidebarContent` | `ui:sidebar-content` |
| **Content tabs** | `contentTabs` | `ui:content-tabs` |
| **Add site flow** | `addSiteFlows` | `ui:add-site-flow` |
| **Context menu items** | `contextMenuItems` | `ui:context-menu` |
| **Header action buttons** | `headerActions` | `ui:header-actions` |
| **Settings panels** | `settingsPanels` | `ui:settings-panel` |
| **Top bar items** | `topBarItems` | `ui:top-bar` |
| **Redux slices** | `redux` | — |
| **CLI commands** | `cliCommands` | `cli:commands` |
| **Storage** | via `onInitialize` ctx | `storage:addon-data` |

An addon declares which slots it uses via `manifest.permissions`. In v1 this is informational (logged as a warning if violated). In a future sandboxed model, it becomes enforcement.

## Core types (`addon-api.ts`)

```typescript
export interface AddonManifest {
  id: string;               // kebab-case unique id, e.g. "studio-vip-environment"
  name: string;
  version: string;
  author: string;
  description: string;
  studioVersionRange: string; // semver range
  permissions: AddonPermission[];
}

export type AddonPermission =
  | `ipc:${ string }`
  | 'ui:content-tabs' | 'ui:context-menu' | 'ui:header-actions'
  | 'ui:sidebar-content' | 'ui:settings-panel' | 'ui:top-bar'
  | 'ui:main-content' | 'ui:add-site-flow' | 'ui:app-providers'
  | 'cli:commands' | 'storage:addon-data';

export interface AddonIpcRegistration {
  channelName: string;
  handler: ( event: unknown, ...args: unknown[] ) => Promise< unknown >;
  /** If true, uses ipcMain.on (fire-and-forget). Default: false (ipcMain.handle). */
  isVoid?: boolean;
}

export interface AddonStorageApi< T = unknown > {
  read(): Promise< T | undefined >;
  write( data: T ): Promise< void >;
}

export interface AddonInitContext {
  storage: AddonStorageApi;
}

export interface MainContentContext {
  selectedSiteId: string | null;
  focusedAddonId: string | null;
  setFocusedAddonId: ( id: string | null ) => void;
}

export interface AddonDefinition {
  manifest: AddonManifest;
  // Main process
  ipcHandlers?: AddonIpcRegistration[];
  preloadApi?: Record< string, ( ...args: unknown[] ) => unknown >;
  // Renderer: state
  redux?: AddonReduxRegistration[];
  appProviders?: ComponentType< { children: ReactNode } >[];
  // Renderer: navigation / layout
  mainContentRenderer?: ( context: MainContentContext ) => ReactNode | null;
  // Renderer: UI surfaces
  contentTabs?: AddonContentTab[];
  contextMenuItems?: AddonContextMenuItem[];
  headerActions?: AddonHeaderAction[];
  sidebarContent?: ComponentType;
  settingsPanels?: AddonSettingsPanel[];
  topBarItems?: AddonTopBarItem[];
  addSiteFlows?: AddonAddSiteFlow[];
  // CLI
  cliCommands?: AddonCliRegistration[];
  // Lifecycle
  onInitialize?: ( ctx: AddonInitContext ) => Promise< void >;
  onTeardown?: () => Promise< void >;
}
```

The `tools/addon-api/` package mirrors these types for external addon authors (no Electron imports, safe to use from a `studio-addons` monorepo as a peer dep).

## What an addon looks like

Each addon has two entry points — Main-process and renderer — because the Electron main bundle must not import React:

```
apps/studio/src/modules/addons/vip-environment/
├── index.main.ts          # Main-process entry: ipcHandlers + lifecycle only
├── index.preload.ts       # Preload API wrappers (uses ipcRenderer)
├── index.renderer.tsx     # Full AddonDefinition with all UI slots
├── types.ts               # Types shared between main and renderer
├── lib/
│   ├── ipc-handlers.ts    # Async IPC handler functions
│   └── vip-environment.ts # Business logic
└── renderer/
    ├── vip-context.tsx    # React context + provider
    ├── vip-site-menu.tsx  # sidebarContent component
    └── create-vip-site.tsx # addSiteFlows component
```

```typescript
// index.renderer.tsx (full example)
const addon: AddonDefinition = {
  manifest: {
    id: 'studio-vip-environment',
    name: 'VIP Local Development Environment',
    version: '1.0.0',
    author: 'Automattic',
    description: 'Manage VIP Local Development Environments from Studio.',
    studioVersionRange: '>=3.0.0',
    permissions: [
      'ipc:vip',
      'ui:app-providers',
      'ui:main-content',
      'ui:sidebar-content',
      'ui:add-site-flow',
      'storage:addon-data',
    ],
  },

  appProviders: [ VipProvider ],    // wraps entire app tree; provides useVipContext() globally

  mainContentRenderer: ( ctx ) => {
    // Return JSX to take over the main content area, null to yield to Studio default.
    // Studio renders the first non-null result across all registered addons.
    if ( ctx.focusedAddonId !== 'studio-vip-environment' ) return null;
    return <VipContentTabs />;
  },

  sidebarContent: VipSiteMenu,      // rendered in the sidebar after <SiteMenu />

  addSiteFlows: [ {
    type: 'vip',
    label: 'Create a VIP site',
    description: 'Create a VIP Local Development Environment',
    icon: <VipIcon size={ 26 } />,
    component: CreateVipSite,       // implements AddonAddSiteFlowProps
  } ],
};
export default addon;
```

## Registration

Three files must be updated to add a new addon:

| File | What to update |
|------|----------------|
| `registry.ts` | Import renderer entry; add to `BUNDLED_ADDONS` |
| `registry-main.ts` | Import main entry; add to `BUNDLED_ADDON_MAIN_REGISTRATIONS` |
| `addon-preload-api.ts` | Import preload entry; spread into `mergeAddonPreloadApis()` return |

`registry-main.ts` is separate from `registry.ts` so that the Electron main bundle never imports React-dependent code.

## Renderer companion files

| File | Role |
|------|------|
| `addon-api.ts` | All TypeScript contracts (`AddonDefinition`, `AddonPermission`, `AddonAddSiteFlowProps`, `MainContentContext`, etc.) |
| `registry.ts` | `BUNDLED_ADDONS`, `getBundledAddons()`, `validateAddonAgainstManifest()`, enabled-addon boot helpers |
| `addon-loader.ts` | Main-process boot: registers IPC handlers on `ipcMain`, calls `onInitialize` hooks. Also exports `getAddonContextMenuItems()` used for building the site context menu. |
| `addon-storage.ts` | `createAddonStorage(addonId)` — namespaced read/write into `userData.addonData[addonId]` with file locking |
| `enabled-addons-context.tsx` | `EnabledAddonsProvider` + `useEnabledAddons()` — reactive enabled-addon state persisted in appdata; used by Settings "Add-ons" tab |
| `addon-preload-api.ts` | `mergeAddonPreloadApis()` — merged into `window.ipcApi` in `preload.ts` |
| `addon-store-enhancer.ts` | `buildAddonReducers()` + `getAddonMiddlewares()` — merged into the root Redux store |
| `addon-main-content.tsx` | `AddonFocusProvider`, `useFocusedAddon()`, `useAddonMainContentRenderer()` |
| `addon-app-providers.tsx` | `<AddonAppProviders>` — wraps the app root with all `appProviders` |
| `addon-sidebar-content.tsx` | `<AddonSidebarContent>` — rendered after `<SiteMenu />` |
| `addon-add-site-flows.tsx` | Feeds addon flows into the Add Site modal |
| `addon-header-actions.tsx` | `<AddonHeaderActions>` |
| `addon-settings-panels.tsx` | `<AddonSettingsPanels>` |
| `use-addon-content-tabs.tsx` | `useAddonContentTabs()` hook merged into `useContentTabs()` |

## Boot sequence

In `appBoot()` (`apps/studio/src/index.ts`):

```typescript
// Before setupIpc():
await initializeAddons( validateIpcSender );

// On before-quit:
await teardownAddons();
```

`initializeAddons()` iterates `getBundledAddonMainRegistrations()`, registers each addon's `ipcHandlers` on `ipcMain` (sharing the same `validateIpcSender` closure from `appBoot()`), then calls `onInitialize` with a storage context.

## IPC conventions

Addon IPC handlers follow exactly the same conventions as core Studio handlers:

- Handlers MUST be `async` and return `Promise<T>`
- Channel names are namespaced: `addon-id:channelName` (e.g. `wct:getState`)
- The `isVoid: true` flag registers via `ipcMain.on` for fire-and-forget calls
- Push events from Main to Renderer: `ipcEvent.sender.send('channel', payload)`
- Always guard: `if ( !ipcEvent.sender.isDestroyed() ) { ... }`

## Storage conventions

Addon data is namespaced under `userData.addonData[addonId]`. The storage API wraps `lockAppdata()` / `unlockAppdata()`:

```typescript
// Inside onInitialize:
export async function onInitialize( { storage }: AddonInitContext ) {
  const data = await storage.read< MyData >();
  // ... restore state from data
}

// Later, when writing:
await storage.write( { sites: updatedSites } );
```

## Add Site flow integration

The Add Site modal uses `@wordpress/components` Navigator. Addon flows are registered at path `/addon-{type}`. The `handleOptionSelect` function in `add-site/index.tsx` maps option type strings to `goTo('/addon-{type}')` calls.

Add Site flow components implement `AddonAddSiteFlowProps`:

```typescript
interface AddonAddSiteFlowProps {
  onSubmit: () => void;          // called to close the modal
  onValidityChange: ( isValid: boolean ) => void;  // enables/disables "Add site" button
  submitRef?: React.RefObject< ( () => void ) | null >;  // called when "Add site" is clicked
}
```

## Main content routing

`useAddonMainContentRenderer(selectedSiteId)` iterates all enabled addons and calls each addon's `mainContentRenderer(context)`. The first non-null return is rendered; Studio's default site content renders if all return null.

Addons use `focusedAddonId` from `MainContentContext` to decide whether to render. When a sidebar item is clicked, it calls `setFocusedAddonId(addonId)`. `AddonFocusProvider` auto-clears `focusedAddonId` when the user selects a Studio site.

```
app.tsx
└── <AddonFocusProvider selectedSiteId={selectedSite?.id}>
    ├── Sidebar → <AddonSidebarContent>
    │             └── calls setFocusedAddonId(addonId) on click
    └── <MainContent>
        └── useAddonMainContentRenderer() → returns addon JSX or null
```

## Enabled/disabled addons

`EnabledAddonsProvider` wraps the app root and exposes `useEnabledAddons()` (returns `AddonDefinition[]` filtered to enabled ones). The Settings "Add-ons" tab calls `useEnabledAddonIds()` + `setEnabledIds()` to toggle addons; the change persists to appdata immediately and re-renders all consumers without a restart.

`validateAddonAgainstManifest()` in `registry.ts` checks that every field an addon populates has a corresponding declared permission — currently a `console.warn` (informational), but the structure is in place to make it a hard gate when needed.

## Where addons live today

Addons are in the Studio repo at `apps/studio/src/modules/addons/<addon-id>/`. This simplifies tooling and CI for the initial addons. The `studio-addons` external monorepo is the planned next step for addons authored by teams outside the core Studio team.

## Alternatives considered

### Runtime installation

Users install addons on demand, like VS Code extensions. Deferred because:
- Requires sandboxing or signature verification (downloaded code in an Electron app is a real attack surface)
- Renderer-side addons (React, Redux) are hard to load at runtime — Vite bundles the renderer at build time, so true runtime loading would need `React.lazy` + dynamic import split points
- Requires an in-app addon store UI

The design is deliberately structured so that `getBundledAddons()` in `registry.ts` is the only thing that changes when runtime loading is added — the `AddonDefinition` contract and all downstream code are unchanged.

For renderer-side runtime loading, `AddonContentTab.component` being a `ComponentType` (not a URL) means v2 loads it via `React.lazy(() => import(addonRendererUrl))` — the slot contract is unchanged.

### Iframe/worker sandbox

Each addon runs in an isolated context. Maximum security, but:
- Addons can't use Studio's React tree, Redux store, or component library directly — everything needs a serializable message-passing API
- Significant overhead for small integrations
- v1 addons are vetted code, authored by teams we trust, reviewed like any other PR

Isolation remains on the table for a future "unverified addons" tier.

### Single repo, `apps/addons/`

Keep everything in the Studio repo but in a separate workspace. Simpler for the first addons, but all addon CI runs on every Studio PR and addon-specific tooling (versioning, authorship, e2e tagging) is harder to manage. The external `studio-addons` repo with a vendoring workflow gives clean separation.

### JSON manifest (separate from code)

Some plugin systems (Obsidian, VS Code) use a JSON manifest file. We chose TypeScript because:
- The `AddonDefinition` object is the manifest — no separate file to keep in sync
- TypeScript types give addon authors compile-time feedback before they open a PR
- The `AddonPermission` union type makes permission mistakes easy to catch
