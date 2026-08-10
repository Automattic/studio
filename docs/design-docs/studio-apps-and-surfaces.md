# Studio Apps & Surfaces

## About this doc

This document maps the different Studio "surfaces" (desktop, CLI, local web, hosted), the architecture of each, and the shared layers that let them run the same product. It focuses on how the **agentic UI**, the **`@studio/common` backend**, and the **CLI execution engine** are reused across surfaces, and on the convergence between the local web server and the desktop app.

## Context

Studio began as a single Electron desktop app. It has since grown a CLI, a cloud-hosted variant, and a local web server, all of which share large amounts of code. Rather than four independent apps, Studio is better understood as **one product rendered through several surfaces**, layered on a common, Electron-free core and a single execution engine (the CLI).

This doc is the map of that structure. It does not replace the per-feature docs ([cli.md](./cli.md), [sync.md](./sync.md), [custom-domains-and-ssl.md](./custom-domains-and-ssl.md)); it explains how the pieces fit together.

## The surfaces at a glance

| Surface | Package(s) | Runtime | UI | Backend | Audience |
| --- | --- | --- | --- | --- | --- |
| **Desktop** | `apps/studio` | Electron (main/preload/renderer) | `apps/ui` (+ legacy renderer) | `@studio/common` in-process + forks the CLI | End users on macOS/Windows/Linux |
| **CLI** | `apps/cli` | Node (via Electron's `ELECTRON_RUN_AS_NODE`, or standalone npm) | none (terminal) | WordPress Playground / PHP-WASM | Power users, scripts, and the other surfaces |
| **Local web** (`studio ui`) | `apps/local` + `apps/ui` | Node (Express + SSE), bundled into the CLI | `apps/ui` (`dist-local`) in the browser | `@studio/common` in-process + forks the CLI | Users who want the agentic UI in a browser, on their own machine |
| **Hosted** | `apps/hosted` + `apps/ui` | Node server in the cloud | `apps/ui` (`dist-hosted`) in the browser | Cloud backend (WordPress.com / Telex sandbox agent) | Cloud product; no local machine |

Two of these surfaces run **on the user's machine and own real local WordPress sites** (desktop and local web). One is a pure **execution engine** that the others delegate to (CLI). One targets a **remote backend** with a deliberately reduced scope (hosted).

## The layers

```
   ┌─────────────────────────────────────────────────────────────┐
   │                         apps/ui                              │   Shared agentic UI
   │     React app + Connector abstraction + capabilities         │   (one codebase)
   └───────────────┬───────────────┬───────────────┬─────────────┘
        ipc        │     local     │    hosted     │   ← 3 connectors (transport)
   ┌───────────────┴──┐ ┌──────────┴─────┐ ┌───────┴──────────┐
   │   apps/studio    │ │   apps/local   │ │   apps/hosted    │   Per-surface shells
   │  (Electron/IPC)  │ │ (Express/SSE)  │ │  (cloud server)  │
   └───────────────┬──┘ └──────────┬─────┘ └──────────────────┘
                   │               │
   ┌───────────────┴───────────────┴─────────────────────────────┐
   │                  @studio/common (tools/common)               │   Shared, Electron-free
   │   ai/sessions/*   sites/*   lib/*   (business logic)         │   business logic
   └───────────────┬─────────────────────────────────────────────┘
                   │ forks the binary (createCliRunner)
   ┌───────────────┴─────────────────────────────────────────────┐
   │                         apps/cli                             │   Execution engine
   │        WordPress Playground / PHP-WASM, site lifecycle       │   (`studio` command)
   └─────────────────────────────────────────────────────────────┘
```

Reading the stack bottom-up:

1. **`apps/cli` — the execution engine.** Everything that actually boots WordPress (Playground / PHP-WASM), creates/starts/stops sites, imports/exports, and runs the agent lives here. It is invoked directly as the `studio` command, and it is also the thing every machine-local surface delegates to.
2. **`@studio/common` (`tools/common`) — shared business logic.** Transport-agnostic, Electron-free TypeScript: session management, site operations, snapshots, sync, the REST proxy, app detection, OAuth URL building, etc. It is the layer that makes the desktop and the local web server run *the same code*.
3. **Per-surface shells.** Thin adapters that expose `@studio/common` over a transport: `apps/studio` over Electron IPC, `apps/local` over HTTP/SSE, `apps/hosted` over its cloud API.
4. **`apps/ui` — the shared agentic UI.** One React application that talks to whichever shell it's running against through a single **Connector** seam.

## The shared UI layer (`apps/ui`)

`apps/ui` is a single React app (React 19, TanStack Query/Router, `@wordpress/ui` + `@wordpress/dataviews`, themed via `@wordpress/theme`'s `ThemeProvider`). It is rendered by **three** surfaces — desktop, local, hosted — without forking.

It reaches its backend exclusively through the **`Connector`** interface (`apps/ui/src/data/core/types.ts`). The UI never imports IPC, `fetch`, or SSE directly; it calls `connector.getSites()`, `connector.createSite()`, `connector.authenticate()`, etc. Each surface provides one implementation:

| Connector | File | Transport | Used by |
| --- | --- | --- | --- |
| `ipc` | `connectors/ipc/` | `window.ipcApi.*` / `ipcListener` (Electron contextBridge) | Desktop |
| `local` | `connectors/local/` | HTTP + SSE to the local server | `studio ui` |
| `hosted` | `connectors/hosted/` | Cloud API | Hosted |

The connectors are intentionally **not** unified behind capability negotiation; each is honest to its own backend. Duplication between `local` and `hosted` is accepted so that machine-local features can grow in `local` without risk to the cloud product. The only shared connector helper is `connectors/unsupported-error.ts`.

### Capabilities

Where surfaces genuinely differ (native dialogs, OS integration, preview annotation), the UI branches on a small declarative descriptor instead of sniffing the environment:

```ts
interface ConnectorCapabilities {
  nativeFolderPicker: boolean;  // native folder dialog vs. editable path field
  nativeSaveDialog: boolean;    // native Save-As vs. browser download
  openInOS: boolean;            // open folder/editor/terminal + app detection
  annotatePreview: boolean;     // inject the annotation inspector into the preview
}
```

For example, the create-site form renders an editable path field when `nativeFolderPicker` is false; exports stream to a browser download when `nativeSaveDialog` is false; the preview's **Annotate** control is hidden entirely when `annotatePreview` is false (a cross-origin `<iframe>` can't host the inspector). A separate `reservesTrafficLightSpace` flag plus `isFullscreen()` tells the UI when to leave room for macOS window controls — true only in the desktop app.

### Build targets

`apps/ui` builds per target via `STUDIO_TARGET`:

- `local` → `index.local.html` / `main.local.tsx` → `dist-local`
- `hosted` → `index.hosted.html` / `main.hosted.tsx` → `dist-hosted`

The desktop consumes `apps/ui` through its own bundling with the `ipc` connector injected. Each `main.*.tsx` constructs the appropriate connector and mounts `AppProviders`.

## Surface architectures

### Desktop (`apps/studio`)

The classic Electron three-process app: **Main** (Node.js — IPC handlers, site servers, storage, OAuth, sync, migrations), **Preload** (the `contextBridge` exposing `window.ipcApi`), and **Renderer** (React). The renderer is `apps/ui` driven by the `ipc` connector (behind a feature flag alongside the legacy renderer). The Main process holds the business logic by importing `@studio/common` **and** by forking the CLI for true site/agent operations. Electron-only concerns (thumbnails via `capturePage`, native dialogs, the `wp-studio://` protocol handler, `shell.openPath`) stay in the desktop wrapper.

### CLI (`apps/cli`)

The `studio` command (see [cli.md](./cli.md)). A Node app bundled with Vite, run via Electron's `ELECTRON_RUN_AS_NODE=1` (or standalone from npm). It owns WordPress Playground / PHP-WASM and the on-disk site lifecycle. It exposes commands (`site`, `auth`, `import`/`export`, `pull`/`push`, `wp`, `code`, `mcp`, `ui`, …) and emits structured progress over `process.send` when forked. Crucially, the CLI is **both a user-facing surface and the shared execution engine** the desktop and local web server delegate to.

### Local web — `studio ui` (`apps/local` + `apps/ui`)

`apps/local` (`@studio/local`) is an Express + SSE server that is the **browser analog of the desktop app**. It is bundled *into* the CLI at build time (a Vite alias folds its source into the CLI bundle; the built `dist-local` UI is copied next to it) and launched by `studio ui`. It serves `apps/ui` and exposes the same operations the desktop exposes over IPC, but over HTTP routes and an SSE event stream. Every real site/agent operation is delegated to the CLI by forking the same binary — *exactly* the way the desktop forks it. The dependency direction is **CLI → local server**, never the reverse.

### Hosted (`apps/hosted` + `apps/ui`)

A cloud product (see the package for specifics). It targets WordPress.com / a server-side sandbox agent, deliberately has **no `apps/cli` dependency**, and has a reduced scope (no local sites, no OS integration). It reuses `apps/ui` through the `hosted` connector. It is intentionally *not* the model for the local server — `apps/local` mirrors the **desktop**, not hosted.

## Convergence: local ↔ desktop

The guiding principle (set by the team): for sites, sessions, and the agent, **the desktop app and the local web server run the exact same code**. The only differences are:

1. **Transport** — Electron IPC (`ipcMain.handle` + `webContents.send`) vs. HTTP routes + an SSE stream.
2. **CLI binary injection** — how each process locates the `studio` binary to fork.

Everything else is shared in `@studio/common`. Concretely:

### The seam

Shared modules are constructed with two injected dependencies and nothing Electron-specific:

- **`executeCliCommand`** — produced by `createCliRunner({ cliBinary, nodeBinary })` in `lib/cli-process.ts`. The binary resolves once, from `STUDIO_CLI_BIN ?? process.argv[1]` (the CLI launching the server via `studio ui`), with an env override for development.
- **`emit`** — a single event sink. The desktop wires it to `webContents.send` on named IPC channels; the local server wires it to SSE channels (`agent`, `placement`, `snapshot`, `sync`). There are no per-feature setter functions.

So the agent run-manager, for instance, is `createAgentRunManager({ cliBinary, emit, surface, … })`: the desktop and the local server build it with their own `emit`, and the orchestration code is identical.

### What is converged (shared, both surfaces)

| Domain | Shared module(s) |
| --- | --- |
| AI sessions | `ai/sessions/manage.ts`, `placement.ts`, `run-manager.ts`, `store.ts`, `agent-stats.ts` |
| Site lifecycle | `sites/index.ts` (list/start/stop) |
| Site create / edit | `sites/create.ts` (`buildSiteCreateArgs`), `sites/edit.ts` (`buildSiteSetArgs`) |
| Snapshots / preview | `sites/snapshots.ts` |
| Sync (pull/push) | `sites/sync.ts` |
| Blueprint bundles | `sites/blueprint-extract.ts` |
| Local media MIME | `lib/media-mime.ts` |
| Installed-app detection | `lib/user-settings/installed-apps.ts` |
| OAuth URL building | `lib/oauth.ts` |
| Error reporting | `lib/error-reporting.ts` (`captureException`) |

The desktop's former private copies of this logic are now thin wrappers over the shared modules (e.g. `apps/studio/.../cli-site-creator.ts` calls `buildSiteCreateArgs`; `apps/studio/src/lib/is-installed.ts` re-exports the shared detector). This keeps the two surfaces from drifting — a change to site creation or app detection lands in one place for both.

### What stays per-surface (by design)

Some things are *inherently* runtime-specific and are **not** forced into the shared layer — they are the legitimate analog of the transport seam:

- **OS-app launch** — the desktop uses Electron's `shell.openPath`; the local server uses `child_process` (`open`/`xdg-open`/`explorer`). The *targets* (bundle IDs, `$PATH` commands, Windows paths) and *detection* are shared; only the syscall differs.
- **Native dialogs vs. browser** — folder/save dialogs on desktop; editable text fields, browser downloads, and raw-body uploads in the browser.
- **Preferences storage** — Electron `app.json` / `nativeTheme` on desktop; `localStorage` in the browser.
- **Auth login** — see below.

## The CLI as the convergence point

Convergence is possible *because* the heavy lifting already lives in one place. The CLI owns Playground/PHP-WASM and the site lifecycle, so the machine-local surfaces don't reimplement any of it — they **fork the binary** and stream its structured events. That makes the desktop's IPC handlers and the local server's HTTP routes both thin: resolve inputs, call a `@studio/common` function, forward the CLI's events over the surface's transport.

One deliberate exception (matching the desktop's existing behavior): **session-store and shared-config reads** are plain `~/.studio` file access via `@studio/common` in-process, not a CLI spawn. Only true site/agent operations fork the binary.

## Auth across surfaces

All surfaces read the same WordPress.com token from `~/.studio/shared.json`, so "who am I logged in as" is shared. **Logging in** differs because the OAuth redirect target differs per runtime:

- **Desktop** — implicit grant to the `wp-studio://auth` custom protocol, which the app registers as an OS handler (OAuth client `95109`).
- **CLI** — implicit grant to WordPress.com's copy-token page; the user pastes the token back (`studio auth login`).
- **Local web** — implicit grant to a server-served `/auth/callback` page (a separate public OAuth client that allows `http://localhost:<port>` and `https://studio.local` redirects). The page reads the token from the URL fragment, posts it to the server to validate + store, and `postMessage`s the opener. Falls back to the CLI paste flow when no client is configured.

## Build & distribution

- **`apps/ui`** builds twice (`STUDIO_TARGET=local|hosted`) into `dist-local` / `dist-hosted`; the desktop bundles it with the `ipc` connector.
- **`apps/local`** has no build of its own — the CLI's Vite build folds its source in (via an alias) and copies `dist-local` next to the CLI bundle, so `studio ui` is self-contained.
- **`apps/cli`** is bundled with Vite and shipped inside the desktop app (and standalone to npm). See [cli.md](./cli.md) for installation details.
- **`apps/studio`** is packaged per platform with electron-forge.

## Summary

| Concern | Desktop | CLI | Local web | Hosted |
| --- | --- | --- | --- | --- |
| UI | `apps/ui` (ipc) | none | `apps/ui` (local) | `apps/ui` (hosted) |
| Business logic | `@studio/common` | `@studio/common` | `@studio/common` | cloud backend |
| Site execution | forks CLI | **is** the engine | forks CLI | cloud sandbox |
| Transport | IPC | process I/O | HTTP/SSE | cloud API |
| Local sites | yes | yes | yes | no |
| OS integration | full (Electron) | n/a | server-side adapters | none |

The shape to keep in mind: **one UI, one shared backend, one execution engine — wrapped by thin, surface-specific transports.** New machine-local features should land in `@studio/common` (shared) and the CLI (execution), with each surface contributing only its transport adapter and its genuinely runtime-specific bits.
