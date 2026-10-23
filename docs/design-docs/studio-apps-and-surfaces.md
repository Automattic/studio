# Studio Apps & Surfaces

## About this doc

This document maps the different Studio "surfaces" (desktop, CLI, local web, external agents), the architecture of each, and the shared layers that let them run the same product. It focuses on how the **agentic UI**, the **`@studio/common` backend**, and the **CLI execution engine** are reused across surfaces, and on the convergence between the local web server and the desktop app.

## Context

Studio began as a single Electron desktop app. It has since grown a CLI, a local web server, and an MCP server for external agents, all of which share large amounts of code. Rather than four independent apps, Studio is better understood as **one product rendered through several surfaces**, layered on a common, Electron-free core and a single execution engine (the CLI).

This doc is the map of that structure. It does not replace the per-feature docs ([cli.md](./cli.md), [sync.md](./sync.md), [custom-domains-and-ssl.md](./custom-domains-and-ssl.md)); it explains how the pieces fit together.

## The surfaces at a glance

| Surface | Package(s) | Runtime | UI | Backend | Audience |
| --- | --- | --- | --- | --- | --- |
| **Desktop** | `apps/studio` | Electron (main/preload/renderer) | `apps/ui` | `@studio/common` in-process + forks the CLI | End users on macOS/Windows/Linux |
| **CLI** | `apps/cli` | Node (via Electron's `ELECTRON_RUN_AS_NODE`, or standalone npm) | none (terminal) | Native PHP site servers | Power users, scripts, and the other surfaces |
| **Local web** (`studio ui`) | `apps/local` + `apps/ui` | Node (Express + SSE), bundled into the CLI | `apps/ui` (`dist-local`) in the browser | `@studio/common` in-process + forks the CLI | Users who want the agentic UI in a browser, on their own machine |
| **External agents** (`studio mcp`) | `apps/cli` + `apps/mcp-ui` | The CLI, started by an agent app over stdio | The agent app's chat, plus MCP Apps pages (`apps/mcp-ui`, the design picker) | The CLI in-process | Users of Codex, ChatGPT, Claude and other agents |

Two of these surfaces run **on the user's machine and own real local WordPress sites** (desktop and local web). One is a pure **execution engine** that the others delegate to (CLI). The last runs on the user's machine too, but **inside someone else's agent app**: Studio provides tools and pages, not the app (external agents).

## The layers

```
   ┌─────────────────────────────────────────────────────────────┐
   │                         apps/ui                              │   Shared agentic UI
   │     React app + Connector abstraction + capabilities         │   (one codebase)
   └───────────────┬───────────────┬─────────────────────────────┘
        ipc        │     local     │   ← 2 connectors (transport)
   ┌───────────────┴──┐ ┌──────────┴─────┐
   │   apps/studio    │ │   apps/local   │   Per-surface shells
   │  (Electron/IPC)  │ │ (Express/SSE)  │
   └───────────────┬──┘ └──────────┬─────┘
                   │               │
   ┌───────────────┴───────────────┴─────────────────────────────┐
   │                  @studio/common (packages/common)            │   Shared, Electron-free
   │   ai/sessions/*   sites/*   lib/*   (business logic)         │   business logic
   └───────────────┬─────────────────────────────────────────────┘
                   │ forks the binary (createCliRunner)
   ┌───────────────┴─────────────────────────────────────────────┐
   │                         apps/cli                             │   Execution engine
   │        native PHP site servers, site lifecycle               │   (`studio` command)
   └─────────────────────────────────────────────────────────────┘
```

Reading the stack bottom-up:

1. **`apps/cli` — the execution engine.** Everything that actually boots WordPress (native PHP), creates/starts/stops sites, imports/exports, and runs the agent lives here. It is invoked directly as the `studio` command, and it is also the thing every machine-local surface delegates to.
2. **`@studio/common` (`packages/common`) — shared business logic.** Transport-agnostic, Electron-free TypeScript: session management, site operations, snapshots, sync, the REST proxy, app detection, OAuth URL building, etc. It is the layer that makes the desktop and the local web server run *the same code*.
3. **Per-surface shells.** Thin adapters that expose `@studio/common` over a transport: `apps/studio` over Electron IPC, and `apps/local` over HTTP/SSE.
4. **`apps/ui` — the shared agentic UI.** One React application that talks to whichever shell it's running against through a single **Connector** seam.

## The shared UI layer (`apps/ui`)

`apps/ui` is a single React app (React 19, TanStack Query/Router, its own Base UI primitives and CSS theme tokens). It is rendered by **two** surfaces — desktop and local — without forking.

It reaches its backend exclusively through the **`Connector`** interface (`apps/ui/src/data/core/types.ts`). The UI never imports IPC, `fetch`, or SSE directly; it calls `connector.getSites()`, `connector.createSite()`, `connector.authenticate()`, etc. Each surface provides one implementation:

| Connector | File | Transport | Used by |
| --- | --- | --- | --- |
| `ipc` | `connectors/ipc/` | `window.ipcApi.*` / `ipcListener` (Electron contextBridge) | Desktop |
| `local` | `connectors/local/` | HTTP + SSE to the local server | `studio ui` |

Each connector maps the interface onto its own backend; browser-only helpers sit next to them in `connectors/`.

### Capabilities

Where surfaces genuinely differ, the UI branches on the connector's `capabilities` (`ConnectorCapabilities` in `types.ts`) instead of sniffing the environment. For example, the create-site form shows an editable path field when `nativeFolderPicker` is false, and the preview's **Annotate** control is hidden when `annotatePreview` is false (a cross-origin `<iframe>` can't host the inspector). `reservesTrafficLightSpace` plus `isFullscreen()` tells the UI when to leave room for the macOS window controls, which only the desktop app has.

### Build targets

`apps/ui` builds per target via `STUDIO_TARGET`, each entry constructing its connector and mounting `AppProviders`:

- none → `index.html` / `main.tsx` (the `ipc` connector), built into the desktop app by `scripts/build-ui-renderer.ts`
- `local` → `index.local.html` / `main.local.tsx` → `dist-local`

## Surface architectures

### Desktop (`apps/studio`)

The Electron three-process app: **Main** (Node.js — IPC handlers, windows and menus, updates, storage, the `wp-studio://` protocol handler, migrations), **Preload** (the `contextBridge` exposing `window.ipcApi`), and **Renderer** (`apps/ui` driven by the `ipc` connector). Main reaches the business logic by importing `@studio/common` and by forking the CLI for site and agent operations; what it implements itself is what needs Electron (dialogs, menus, the preview `<webview>`, thumbnails via `capturePage`, auto-updates).

### CLI (`apps/cli`)

The `studio` command (see [cli.md](./cli.md)). A Node app bundled with Vite, run via Electron's `ELECTRON_RUN_AS_NODE=1` (or standalone from npm). It owns the native PHP site servers and the on-disk site lifecycle. It exposes commands (`site`, `auth`, `import`/`export`, `pull`/`push`, `wp`, `code`, `mcp`, `ui`, …) and emits structured progress over `process.send` when forked. Crucially, the CLI is **both a user-facing surface and the shared execution engine** the desktop and local web server delegate to.

### Local web — `studio ui` (`apps/local` + `apps/ui`)

`apps/local` (`@studio/local`) is an Express + SSE server that is the **browser analog of the desktop app**. It is bundled *into* the CLI at build time (a Vite alias folds its source into the CLI bundle; the built `dist-local` UI is copied next to it) and launched by `studio ui`. It serves `apps/ui` and exposes the same operations the desktop exposes over IPC, but over HTTP routes and an SSE event stream. Every real site/agent operation is delegated to the CLI by forking the same binary — *exactly* the way the desktop forks it. The dependency direction is **CLI → local server**, never the reverse.

### External agents — `studio mcp` (`apps/cli` + `apps/mcp-ui`)

`studio mcp` is an MCP server that agent apps (Codex and ChatGPT, Claude, and others) start over stdio. The agent's own model drives Studio's tools, and loads Studio's instructions and runbooks on demand (`studio_instructions`); the tools run in the CLI process, as they do for Studio Code. What the server offers depends on the client, known once it connects (`apps/cli/ai/runtimes/mcp`).

Agent apps that render [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) also show Studio pages: the design picker under `present_design_options`, and the WordPress library (`apps/mcp-ui`), which OpenAI's apps open from their sidebar once the Studio plugin is installed. Each page:

- is one self-contained HTML document, served as a `ui://` resource whose URI carries a hash of its content, since hosts cache pages by URI;
- talks to the host over JSON-RPC on `postMessage`, and calls the server's tools through it, some of them visible to the page only;
- gets its data in the tool results' `_meta`, which hosts keep out of the model's context (some show `structuredContent` to the model instead of `content`);
- reports its height, so the host sizes its frame.

Site changes reach each `studio mcp` process through an `_events` socket of its own (see [How the CLI and Studio apps communicate](./cli-host-communication.md)); the library waits on them to refresh its list.

`apps/mcp-ui` is not another target of `apps/ui`: hosts load a page as one small document with nothing to fetch, while `apps/ui` is a whole app for other backends. It follows `apps/ui`'s conventions (React, TanStack Query, a data layer apart from the components) but shares no code, and has no connectors: there is one host to reach, through one bridge (`apps/mcp-ui/src/data/bridge.ts`).

## Convergence: local ↔ desktop

For sites, sessions, and the agent, **the desktop app and the local web server run the exact same code**. They differ only in transport (Electron IPC vs. HTTP routes and an SSE stream) and in how each locates the `studio` binary.

The rule: **when both apps do something, it is written once in `@studio/common`**, taking what differs as parameters, and the desktop's IPC handler and the `apps/local` route only wrap it: validate the input, call it, return the result. For example, `lib/user-settings/user-preferences.ts` reads and writes preferences and records their Tracks events, `sites/sync.ts` runs and cancels pushes and pulls (`createSyncRunner`), and `lib/local-media.ts` decides which images the chat may read. To check whether something is shared, look for its two callers.

### The seam

Shared modules are constructed with two injected dependencies and nothing Electron-specific:

- **`executeCliCommand`** — produced by `createCliRunner` in `lib/cli-process.ts`. The desktop passes its bundled CLI and Node binaries, the Tracks origin, and echoes the CLI's stderr into its log; the local server passes `STUDIO_CLI_BIN ?? process.argv[1]` (the CLI that launched it).
- **`emit`** — a single event sink. The desktop wires it to `webContents.send` on named IPC channels; the local server wires it to SSE channels (`agent`, `placement`, `sync-connect`).

So the agent run-manager, for instance, is `createAgentRunManager({ cliBinary, emit, surface, … })`: each app builds it with its own `emit`, and the orchestration code is identical.

Changes the CLI makes from anywhere (sites, auth, and the progress of a push, pull or preview) reach both apps the same way: each runs `studio _events`, which receives the CLI's events (see [cli.md](./cli.md)), and forwards them to its UI over its own transport.

### What differs per surface

- **Native dialogs vs. browser** — folder and save dialogs on desktop; editable text fields, browser downloads, and uploads in the browser.
- **Window and OS integration** — menus, the macOS window controls, the preview `<webview>`, and the native window theme exist only on desktop. Folders open with `shell.openPath` on desktop and `open`/`xdg-open`/`explorer` on the server; terminals and editors are launched by each app's own code (`apps/studio/src/ipc-handlers.ts`, `apps/local/src/open-in-os.ts`), with the editors' launch targets and app detection shared in `lib/user-settings/`.
- **PHP-error recovery** — only the desktop serves a site's PHP fatal error on its port and restarts the site once the file is fixed (`apps/studio/src/lib/php-error-recovery.ts`).
- **Auth login** — see below.

## The CLI as the convergence point

Convergence is possible *because* the heavy lifting already lives in one place. The CLI owns the PHP site servers and the site lifecycle, so the machine-local surfaces don't reimplement any of it — they **fork the binary** and stream its structured events.

How the CLI reports what it does back to these surfaces, whoever started the work, is described in [How the CLI and Studio apps communicate](./cli-host-communication.md).

One deliberate exception (matching the desktop's existing behavior): **session-store and shared-config reads** are plain `~/.studio` file access via `@studio/common` in-process, not a CLI spawn. Only true site/agent operations fork the binary.

## Auth across surfaces

All surfaces read the same WordPress.com token from `~/.studio/shared.json`, so "who am I logged in as" is shared. **Logging in** differs because the OAuth redirect target differs per runtime:

- **Desktop** — implicit grant to the `wp-studio://auth` custom protocol, which the app registers as an OS handler (OAuth client `95109`).
- **CLI** — implicit grant to WordPress.com's copy-token page; the user pastes the token back (`studio auth login`).
- **Local web** — implicit grant to a server-served `/auth/callback` page (a separate public OAuth client that allows `http://localhost:<port>` and `https://studio.local` redirects). The page reads the token from the URL fragment, posts it to the server to validate + store, and `postMessage`s the opener. Falls back to the CLI paste flow when no client is configured.

## Build & distribution

- **`apps/ui`** builds into `dist-local` for `studio ui` (`STUDIO_TARGET=local`); the desktop bundles it with the `ipc` connector.
- **`apps/local`** has no build of its own — the CLI's Vite build folds its source in (via an alias) and copies `dist-local` next to the CLI bundle, so `studio ui` is self-contained.
- **`apps/mcp-ui`** builds into one HTML document, which the CLI's Vite build copies next to the CLI bundle as for `apps/ui`: release builds build it first, and `npm run cli:build:mcp-ui` does for development builds.
- **`apps/cli`** is bundled with Vite and shipped inside the desktop app (and standalone to npm). See [cli.md](./cli.md) for installation details.
- **`apps/studio`** is packaged per platform with electron-forge.

## Summary

| Concern | Desktop | CLI | Local web | External agents |
| --- | --- | --- | --- | --- |
| UI | `apps/ui` (ipc) | none | `apps/ui` (local) | the agent app + `apps/mcp-ui` pages |
| Business logic | `@studio/common` | `@studio/common` | `@studio/common` | `@studio/common` |
| Site execution | forks CLI | **is** the engine | forks CLI | **is** the engine |
| Transport | IPC | process I/O | HTTP/SSE | MCP over stdio |
| Local sites | yes | yes | yes | yes |
| OS integration | full (Electron) | n/a | server-side adapters | n/a |

The shape to keep in mind: **one UI, one shared backend, one execution engine — wrapped by thin, surface-specific transports.** New machine-local features should land in `@studio/common` (shared) and the CLI (execution), with each surface contributing only its transport adapter and its genuinely runtime-specific bits.
