# Studio CLI

## About this doc

This document outlines the design and implementation details for the Studio CLI utility. It covers the high-level approach, data flows, and implementation details for this feature.

## Context

The Studio CLI (invoked with the `studio` command) is a globally available CLI utility allowing users to interact with various Studio features independently of the desktop application.

## High level approach

The CLI is independent of the main desktop app, but is written using mostly the same conventions. It's a node.js app written in Typescript, that's transpiled and bundled using Vite. Vitest is used to test CLI modules in the same way as for regular Studio modules.

To run the CLI, we first add a script to a directory on `$PATH`. This script runs the CLI JS file using the node runtime bundled with Studio. Running JS files independently of the main Studio app is possible thanks to the `ELECTRON_RUN_AS_NODE=1` option.

The first iteration of the CLI shipped commands to create, read, update, and delete preview sites. To keep the business logic consolidated, we've refactored Studio to instantiate the CLI when creating, updating, and deleting preview sites.

## Data flow

1. When calling the CLI:

   - `yargs` is used to parse commands and options and to auto-generate help pages.
   - The appropriate command is called.
   - Progress is pretty-printed and the command runs until completion or failure.

2. When Studio instantiates the CLI:

   - The node.js `child_process` module is used to fork a process that runs the CLI.
   - When running in forked mode, the CLI process uses the `process.send` API to communicate back to Studio.
   - IPC messages received from the CLI are parsed and validated. The results are emitted as Electron IPC events to the renderer process.
   - The renderer process uses "logger action" definitions from the `common` folder to determine command progress based on incoming IPC events.

3. Studio reacts when the CLI modifies preview sites:

   - Studio spawns the `_events` CLI command when the application starts.
   - The `_events` command runs a local IPC server that other CLI processes send events to. Those events are passed back to Studio over standard `process.send` IPC.
   - Studio parses and validates the events and emits `snapshot-event` events to the renderer process.
   - State handlers in the renderer process (primarily Redux slices) listen to `snapshot-event` events and update the state accordingly.

## Implementation details

### Installation

On macOS, we install the CLI by creating a symlink at `/usr/local/bin/studio` pointing to `/Applications/Studio.app/Contents/Resources/bin/studio`. Administrative privileges are required to write to `/usr/local/bin`, meaning Studio prompts the user for their password when installing the CLI.

On Windows, we modify the `%PATH%` environment variable programmatically. On startup, we ensure that `C:\Users\fredrik\AppData\Local\studio\bin` is present in the `%PATH%` list.

Modifying the `$PATH` environment variable programmatically on macOS is much more challenging, which is why we opted for a manual installation procedure. Roughly, we would need to determine which shell the user uses and write a snippet to the shell-specific config file (that may or may not already exist) to modify the `PATH` environment variable.

### Why bundle the CLI?

We could almost ship the CLI source code as-is. We know which Node.js version interprets and runs the code, and we always ship the CLI with an accompanying `node_modules` directory. The only bundling we really _need_ is Typescript, and `--experimental-strip-types` might even let us skip that.

Long-term, we might want to move in that direction, but for now, we are still bundling. It offers us some flexibility around which exact code we ship to users (by allowing us to define globals that act as feature flags), and we've seen in testing that bundled code uses less memory, presumably because of code splitting and tree shaking. 

### Studio calling the CLI

Studio instantiates CLI child processes to execute certain operations. In the first CLI iteration, Studio does this when creating, updating, and deleting preview sites. The CLI communicates with Studio through node IPC calls (using the `process.send` API).

This approach of forking CLI processes to run business logic has both pros and cons.

The biggest pro is that when the CLI becomes capable of running Studio sites, we can move the Playground dependencies entirely to the CLI and avoid bundling them twice (which would increase the size of the app by several hundred MBs). Moreover, it consolidates the business logic and creates increased incentives for developers to focus on the CLI when shipping new features.

The biggest con is that it decreases control in the Studio code, particularly when it comes to error handling. We mitigate this by creating as clear a structure as possible around the `process.send` IPC calls.

## Data Liberation Agent integration

The `studio code` agent ships a `/migrate` slash command that pulls a site off a closed hosting platform (Wix, Squarespace, Shopify, etc.) and into a fresh local Studio site. The actual extraction is performed by the [Data Liberation Agent](https://github.com/Automattic/data-liberation-agent) (DLA), an external Node/TypeScript toolkit that exposes its capabilities as a Claude Code plugin and an MCP server. Studio consumes both.

For the alternatives we considered (in-process re-implementation, npm dependency, runtime fetch, child-process CLI) and the trade-offs that drove this shape, see [`issues/rsm-1639-dla-integration/research-report.md`](../../issues/rsm-1639-dla-integration/research-report.md).

### Vendoring

DLA is vendored into `apps/cli/ai/dla/` at a pinned git SHA by `scripts/download-data-liberation-agent.ts`, which runs from the root `postinstall` script. The fetch script downloads the tarball at `DLA_PINNED_SHA`, runs `tsc` against DLA's `tsconfig.json` to pre-compile the TypeScript sources to JS (`dist-vendored/` is renamed to `src/` in the staged tree), copies the curated subset (`.claude-plugin/`, `skills/`, `commands/`, `prompts/`, the compiled `src/`, and the vendored PHP under `src/lib/preview/scripts/`), and writes a `.dla-pinned-sha` file for provenance. Pre-compiling at vendor time means the runtime never needs `tsx`.

DLA lives in a private repo, so the fetch requires a `GH_PAT` (or `GH_TOKEN`) environment variable with read access. When the token is missing, the script logs a warning and exits 0 — installs MUST keep working for contributors without DLA access. The `/migrate` surface is then simply unavailable: `startAiAgent` in `apps/cli/ai/agent.ts` checks `fs.existsSync(dlaPath)` before registering anything DLA-related, so the agent runs normally without DLA.

### Plugin and MCP wiring

DLA loads as a second local SDK plugin alongside Studio's own `apps/cli/ai/plugin/`. Both are registered via the `plugins` array in `startAiAgent` (`apps/cli/ai/agent.ts`), and the second entry is conditional on `dlaAvailable`:

```ts
plugins: [
    { type: 'local', path: path.resolve( import.meta.dirname, 'plugin' ) },
    ...( dlaAvailable ? [ { type: 'local', path: dlaPath } ] : [] ),
],
```

DLA's MCP server is registered alongside Studio's in-process MCP server on the `mcpServers` map under the key `data-liberation`. We spawn it as a stdio child process pointing at the pre-compiled entry:

```ts
mcpServers[ 'data-liberation' ] = {
    type: 'stdio',
    command: process.execPath,
    args: [ path.resolve( dlaPath, 'src/mcp-server.js' ) ],
    env: { ...resolvedEnv, STUDIO_WPCOM_TOKEN: wpcomAccessToken ?? '' },
};
```

A few details that are load-bearing:

- We use `process.execPath` rather than the literal string `'node'`. This matches the precedent in `apps/cli/ai/browser-utils.ts` and `apps/cli/lib/daemon-client.ts`, and ensures DLA runs under the same Electron-bundled Node runtime the host CLI is using.
- The path to `mcp-server.js` is absolute. The Anthropic Agent SDK's `McpStdioServerConfig` exposes `{ type, command, args, env }` only — there is no `cwd` field, and the SDK's spawn pipeline does not forward a working directory to MCP children. DLA's internal scripts therefore resolve their peers via `import.meta.url` (always absolute) rather than relative to a working directory.
- `STUDIO_WPCOM_TOKEN` is forwarded explicitly so DLA tools targeting a remote WordPress.com site work even when the active Studio site is local. Other env vars consumed by DLA (e.g. `LIBERATION_TOKEN`, `SHOPIFY_ADMIN_TOKEN`) are forwarded transitively via `...resolvedEnv`.
- If the spawned child fails to start at runtime, the SDK reports the MCP server status as `failed` and the rest of the agent stays up; `/migrate` then surfaces the failure as a tool-not-available error rather than crashing the session.

### Handoff contract: `delegate: true`

DLA's `liberate_setup` and `liberate_import` MCP tools accept a `delegate: true` flag. With this flag set, DLA does not write to a remote WordPress installation itself. Instead, it returns a structured manifest of artifact paths (`{ wxrFile, outputDir, mediaDir, productsCsv, redirectMap, importAuthors }`), and the calling host (Studio) is expected to drive the actual import.

In our flow, the agent calls DLA's `liberate_*` tools to detect, discover, extract, and verify the source site, then invokes `liberate_setup` / `liberate_import` with `delegate: true` to receive the manifest. From there, it calls Studio's existing `mcp__studio__site_create` to create the local site and uses Studio's `wp_cli` Bash plumbing to import the WXR. This is the contract that lets us consume DLA wholesale without forking it: the manifest is small and stable, and DLA already supports it for "local dev tools with direct database/CLI access" — Studio is the canonical caller.

### Permission scoping

The Agent SDK's `permissionMode: 'auto'` would otherwise auto-approve every DLA MCP tool, including ones that write to disk or hit a remote write API. To scope this, we register a `canUseTool` callback built by `buildDlaCanUseTool` in `apps/cli/ai/dla-permissions.ts`. The callback is only installed when DLA is available — non-DLA sessions keep the SDK's default classifier path untouched.

Per-tool policy:

- **Read-only auto-approve.** `liberate_detect`, `liberate_discover`, `liberate_inspect`, `liberate_status`, and `liberate_verify` pass through immediately.
- **Ask once per session.** `liberate_extract`, `liberate_setup`, `liberate_map_apis`, and `liberate_probe` modify state locally (write to disk, scrape into a manifest, drive a Chromium devtools session). The callback prompts the user via the agent's `onAskUser` plumbing on first use and memoises the answer in a closure-scoped `Set` for the rest of the agent turn.
- **`liberate_import` — always ask unless `delegate: true`.** When the model passes `delegate: true` in the tool input, the call is auto-approved (DLA returns a manifest, Studio drives the actual import). Without the flag, it falls through to the ask-once branch.
- **Unknown DLA tool — deny.** Any `mcp__data-liberation__*` tool not present in the policy sets is denied with a clear message, so a future DLA tool addition can't silently inherit auto-approval. Adding a new DLA tool requires updating the per-tool allow list in `apps/cli/ai/dla-permissions.ts`.
- **Headless / no `onAskUser`.** Ask-once tools deny rather than auto-approve when no interactive surface is wired up, so scripted runs never silently allow a write operation.

Non-DLA tool calls fall through to the SDK's auto classifier (the callback returns `{ behavior: 'allow', updatedInput: input }` — installing `canUseTool` overrides the default classifier path, so we must explicitly allow non-DLA tools to preserve the auto behaviour for them).

### Update cadence

DLA is pinned by SHA in `scripts/download-data-liberation-agent.ts` (`DLA_PINNED_SHA`). Bumping is a one-line change in the fetch script, which means each Studio CLI release ships a known-good DLA snapshot. The trade-off is that DLA goes 0–6 weeks behind upstream depending on the release window. The mitigation path is to move to npm or tagged releases once DLA is published; until then, contributors who need a fresher DLA can re-run the postinstall with `STUDIO_REFRESH_DLA=1` (or `--update`) to refresh the vendored tree in place.
