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

The `studio code` agent and the `studio migrate` command both delegate platform-extraction work to the [Data Liberation Agent](https://github.com/Automattic/data-liberation-agent) (DLA). This section documents the integration internals. For the user-facing surface, see `apps/cli/README.md`. For the trade-off rationale, see `issues/rsm-3143-dla-pi-research/research-report.md`.

### Topology

- DLA ships as a `github:` npm dependency pinned by SHA in `apps/cli/package.json` (`data-liberation: github:Automattic/data-liberation-agent#<sha>`). Bumping is a one-line edit — DLA has no semver releases and no automatic version tracking.
- Once installed, DLA lives at `node_modules/data-liberation/`. Its MCP server entry is `data-liberation/src/mcp-server.ts` and its standalone CLI entry is `data-liberation/src/cli.ts`.
- Studio's integration layer is a workspace package at `tools/dla/` (`@studio/dla`), consumed from `apps/cli/ai/runtimes/pi/index.ts`. The package owns three modules: `bridge.ts` (process spawn + MCP client), `agent-tool-adapter.ts` (MCP-tool → pi `ToolDefinition` shape conversion), and `policy.ts` (permission buckets + extension factory).

### Bridge spawn

`startDlaBridge` in `tools/dla/bridge.ts` spawns DLA's stdio MCP server as a child process and connects an MCP `Client` over stdio. The spawn pipeline:

- `process.execPath` runs Node (the same Electron-as-Node binary the CLI itself uses).
- `tsx` is loaded as the loader entry. Both the bridge (`tools/dla/bridge.ts`) and the standalone `studio migrate` path (`apps/cli/commands/migrate/resolvers.ts`) resolve it as `tsx/cli` — the canonical key in tsx's package `exports` map. The deep `tsx/dist/cli.mjs` subpath is intentionally not exposed by `exports` and throws `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime; the regression tests in `tools/dla/tests/bridge.test.ts` (the `defaultTransportProvider — real require.resolve paths` block) lock both invariants in so the bridge can never silently regress back to the deep subpath.
- DLA's MCP server is resolved via `require.resolve('data-liberation/src/mcp-server.ts')`.
- The spawn passes a sanitised env: `PATH`, plus a passthrough allowlist (`LIBERATION_TOKEN`, `SHOPIFY_ADMIN_TOKEN`, `NODE_PATH`, `NODE_OPTIONS`), plus `STUDIO_WPCOM_TOKEN` injected from the session's resolved wpcom access token. The parent never has to set `STUDIO_WPCOM_TOKEN` on its own environment.
- `listTools` is called with a 10-second `AbortSignal.timeout` cap. Failures to spawn or list resolve to a bridge handle with `degraded: true` and an empty `tools` array — a missing or broken DLA install warns and continues, never crashes session startup.
- `dispose()` calls `client.close()` (sends EOF on the child's stdin), then schedules a SIGKILL on the child pid after a 2-second grace period. DLA's MCP server normally exits on stdin EOF, but `liberate_extract` can hold a long-running adapter loop open, so the SIGKILL is the safety net.

### Tool wrapping

`tools/dla/agent-tool-adapter.ts` exports `adaptMcpToolToPi`, which converts each MCP `Tool` descriptor returned by `listTools` into a pi `ToolDefinition`:

- `inputSchema` is forwarded as-is via `inputSchema as unknown as TSchema`. This cast is safe because pi-ai's `validateToolArguments` accepts plain JSON Schema — no TypeBox metadata required at runtime. This is the inverse of Studio's existing pi → MCP shim at `apps/cli/ai/mcp-server.ts`, which uses the same idiom in the other direction.
- The wrapper's `execute()` consults the policy via `shouldBlock` before forwarding, then calls `client.callTool` with pi's `AbortSignal` plumbed through `RequestOptions.signal`. MCP's SDK emits `notifications/cancelled` on abort — see the orphan-work caveat below for what DLA does with it.
- Returned `CallToolResult.content[]` blocks are adapted to pi's narrower content shape via `content-adapter.ts`; `structuredContent` surfaces as `AgentToolResult.details`. `result.isError === true` is rethrown so pi's `executePreparedToolCall` reports it as a tool-call error in the model transcript.

### Permission gating

`tools/dla/policy.ts` provides two cooperating policy layers:

- **Adapter-layer**: `shouldBlock(toolName, input, buckets)` runs inside each adapted tool's `execute()` wrapper. Tools are assigned a bucket (`read-only`, `network-read`, `fs-write`, `destructive`, `delegate-only`); unknown tool names default to a hard block. The destructive bucket (today only `liberate_import`) is blocked unless the call carries `delegate: true`.
- **Runtime-layer**: `createDlaPolicyFactory(buckets)` returns a pi `ExtensionFactory` that subscribes to `pi.on('tool_call', handler)` and returns `{ block: true, reason }` for the same set of blocking decisions. Defence in depth — any future tool registration path that bypasses the adapter still hits the runtime hook.

The runtime factory is wired in `apps/cli/ai/runtimes/pi/index.ts` via `resolveDlaExtensionFactories`, which is passed into `DefaultResourceLoader`'s `extensionFactories` slot. Inline `extensionFactories` are loaded even when `noExtensions: true` (which Studio sets to disable user-installed extensions), so no other resource-loader flag flips.

### Feature flag

The v1 integration is gated behind `STUDIO_DLA_ENABLED=1`. Both the bridge spawn (`maybeStartDlaBridge` in `apps/cli/ai/runtimes/pi/index.ts`) and the runtime-layer policy factory (`resolveDlaExtensionFactories`) check the same env var. With the flag unset the runtime behaves identically to pre-integration: no child process is spawned, no DLA tools land in `customTools`, and the extension factory list is empty.

### Tool name surface

DLA's tools are exposed as plain pi `customTools`. They surface to the model under their bare names — `liberate_inspect`, `liberate_extract`, `liberate_setup`, `liberate_import`, etc. — and **not** under the `mcp__data-liberation__*` prefix that pi reserves for first-party MCP registrations. The wrapper skill at `apps/cli/ai/skills/migrate/SKILL.md` references the bare names.

### `delegate: true` handoff

`liberate_setup` and `liberate_import` accept a `delegate: true` argument. In delegate mode DLA returns a manifest of artifact paths — `wxrFile`, `outputDir`, `mediaDir`, `productsCsv?`, `redirectMap`, `importAuthors` — without writing to any live WordPress site. Studio's own tools then act on the manifest: `site_create` consumes the WXR via an inline `importWxr` blueprint step (routed through Playground to dodge the WP-CLI IPC 120-second no-activity timeout), and `wp_cli` handles follow-up steps like author creation and product import. The destructive `liberate_import` bucket forces this contract — calling it without `delegate: true` is blocked by both policy layers.

### Surfaces: `/migrate` slash and standalone CLI

DLA is reachable through two independent surfaces:

- **`/migrate` skill inside `studio code`**: the agent walks the user through detect → extract → verify → site-create → import using the bridged DLA tools and Studio's own tools, with `AskUserQuestion` confirmations between heavier steps. Routes through the agent + bridge.
- **`studio migrate <url>`**: a thin yargs wrapper in `apps/cli/commands/migrate/index.ts` that spawns DLA's CLI (`data-liberation/src/cli.ts`) directly via `process.execPath` + `tsx`, inheriting stdio. No agent is involved; DLA's own Ink UI streams to the terminal. Useful for CI, bulk runs, and any context where an LLM loop is unwanted. The standalone path prunes `STUDIO_WPCOM_TOKEN` from the child env because DLA's CLI does not read it (only DLA's MCP server does).

### Caveat: orphan in-flight work on abort

DLA's MCP server **does not honor `notifications/cancelled` from the client**. When a user aborts a tool call (e.g. cancels `liberate_extract` mid-flight), the cancellation reaches the bridge (`client.callTool`'s `AbortSignal` triggers, the MCP SDK emits `notifications/cancelled`), but DLA's server-side work continues to completion. The filesystem footprint is bounded by DLA's resume-safe protocol — partial extracts are recoverable on the next run rather than orphaned indefinitely — but the child process keeps spending CPU and network after the user's "cancel" until either the work finishes or the bridge's `dispose()` SIGKILLs the process at session teardown.

This is a candidate upstream issue against `Automattic/data-liberation-agent`. Studio's bridge cannot fix it client-side.

### Caveat: Playwright Chromium postinstall

DLA depends on Playwright Chromium for the Wix and Squarespace platform adapters. The `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` env var is set in Studio's CI configs as defensive forward-compat, but it is currently **inert against modern Playwright**: neither `playwright` nor `playwright-core` has a postinstall hook, and DLA's own postinstall invokes `installBrowsers()` directly without consulting the env var. The setting still lands as zero-cost future-proofing. End-users pay the ~150 MB download cost on `npm install -g wp-studio`, driven by DLA's `postinstall: "playwright install chromium"` hook.

### Update cadence

DLA is pinned by SHA in `apps/cli/package.json`. Bumping is a one-line edit, but there is no automatic version-tracking because DLA does not publish semver releases. Each bump should re-verify the `defaultPolicyBuckets` table in `tools/dla/policy.ts` against DLA's current `mcp-server.ts` tool list — new tools without a bucket assignment hard-block by default, which is safe but surprising.
