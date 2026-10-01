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
   - Progress for most commands is read from these messages, using the "logger action" definitions in `packages/common/logger-actions`. Push, pull and preview instead publish their progress as sync activity events (see below), so every UI shows them whoever started them.

3. Studio reacts when the CLI changes state:

   - CLI processes publish events with `emitCliEvent` to the events socket (`~/.studio/daemon/events.sock`, a named pipe on Windows): sites created, updated or deleted, site operations claimed or released, snapshot changes, auth changes, and sync activity (a push, pull or preview's progress and result).
   - Every Studio host runs the `_events` CLI command: the desktop app when it starts, and the `studio ui` server. The first one to bind the events socket is the hub and rebroadcasts each event to the others; they follow it and take over when it exits (`apps/cli/lib/event-hub.ts`). `_events` also turns the process-manager daemon's site-process events into site events.
   - `_events` passes each event back to its host over `process.send` IPC. The desktop relays them to the renderer over Electron IPC (`site-event`, `snapshot-event`, `auth-updated`, `sync-activity`); the `studio ui` server relays them on its SSE stream (`site-event`, `auth-event`, `sync-activity`).
   - The agentic UI refetches its data on site events and renders sync activity from its activity store, so a sync started by the agent, a terminal or another window shows the same progress and result as one started from a button. The legacy renderer listens to `site-event` in its site details hook and to `snapshot-event` in its snapshot Redux slice.

## Implementation details

### Installation

On macOS, we install the CLI by creating a symlink at `/usr/local/bin/studio` pointing to `/Applications/Studio.app/Contents/Resources/bin/studio`. Administrative privileges are required to write to `/usr/local/bin`, meaning Studio prompts the user for their password when installing the CLI.

On Windows, we modify the `%PATH%` environment variable programmatically. On startup, we ensure that `C:\Users\fredrik\AppData\Local\studio\bin` is present in the `%PATH%` list.

Modifying the `$PATH` environment variable programmatically on macOS is much more challenging, which is why we opted for a manual installation procedure. Roughly, we would need to determine which shell the user uses and write a snippet to the shell-specific config file (that may or may not already exist) to modify the `PATH` environment variable.

### Why bundle the CLI?

We could almost ship the CLI source code as-is. We know which Node.js version interprets and runs the code, and we always ship the CLI with an accompanying `node_modules` directory. The only bundling we really _need_ is Typescript, and `--experimental-strip-types` might even let us skip that.

Long-term, we might want to move in that direction, but for now, we are still bundling. It offers us some flexibility around which exact code we ship to users (by allowing us to define globals that act as feature flags), and we've seen in testing that bundled code uses less memory, presumably because of code splitting and tree shaking. 

### Pulling a remote site (`pull-reprint`)

`studio pull-reprint` refreshes an **existing** local Studio site from a connected WordPress.com or Pressable source using the reprint pull tool. It is a state-transition on a site, not a site creator — the same shape as the WordPress.com sync `pull`. Third-party WordPress hosts are not supported: a source URL must resolve to a site returned by the user's authenticated WordPress.com Jetpack API site list.

The flow is:

1. `studio create` — create the local site (a full `SiteData` record plus a blank WordPress install). This is a prerequisite; `pull-reprint` never creates a site.
2. `studio pull-reprint --path <site> --url <remote>` — pull the remote into the local site resolved by `--path`. `--url` identifies only the remote source; if omitted, `pull-reprint` first reuses the site's saved `reprintOrigin.remoteUrl`, and if there is no saved origin, a WordPress.com/Pressable source picker runs (Pressable support is still WIP). The matched remote must be `syncable`. Each run rotates a fresh Reprint secret through the WordPress.com API, enables the exporter, then runs preflight once. The pull is idempotent: re-running it resumes an interrupted pull or performs a delta re-pull of an already-imported site.
3. `studio delete --path <site>` — the only teardown path. It trashes the site folder and the site's `technicalSiteDirectory`, which for a reprint-pulled site is the `siteId`-keyed scratch under `~/.studio/pulls/<siteId>` (reprint's `.import-state.json`, the preflight cache, and the raw/runtime working dirs). `pull-reprint` records `technicalSiteDirectory` on the site at pull *start*, so the scratch is cleaned up even for a pull that failed before linking. There is no `--abort` verb.

#### State model

All durable state lives on the `SiteData` record in `cli.json`. The pull-relevant fields are:

- `status: 'ready' | 'pulling' | 'pull-failed'` — health of the local install. `site create` produces `ready`; a pull sets `pulling` up front, `ready` on success, and `pull-failed` if it errors or is killed. A missing value (legacy records) is treated as `ready`. `site start` refuses to start a non-`ready` site rather than serving a half-written install.
- `reprintOrigin` — durable origin metadata for a pulled site (`remoteUrl`, `remoteSiteUrl`, `tablePrefix`), so a re-pull can reuse the remote source.
- `importComplete: boolean` — true once a full pull has completed at least once; selects first-full-pull vs. delta on the next run.

#### Resume by derivation

Rather than a written stage cursor, "where do I continue from?" is computed from observable state: reprint resumes its own pipeline from `.import-state.json` (and the pull is idempotent), the server-start phase keys off whether the process is already running, the skipped-files phase keys off `hasSkippedFiles`, and full-vs-delta keys off `importComplete`. A `pull-failed` (or interrupted `pulling`) site is recovered by **re-running** the pull, not repaired in place — or removed with `site delete`.

> The only on-disk pull state is reprint's opaque `.import-state.json` and the preflight cache, both in the `siteId`-keyed scratch dir. An interrupted reprint pull can leave the live site half-written; making that crash-atomic is upstream work in reprint. The `pull-failed` status + idempotent re-run is the consumer-side safety net until that lands, so resume is not advertised as crash-proof.

### Studio calling the CLI

Studio instantiates CLI child processes to execute site operations: creating, starting and stopping sites, import and export, push and pull, and preview sites, as well as running the agent. The CLI communicates with Studio through node IPC calls (using the `process.send` API).

This approach of forking CLI processes to run business logic has both pros and cons.

The biggest pro is that when the CLI becomes capable of running Studio sites, we can move the Playground dependencies entirely to the CLI and avoid bundling them twice (which would increase the size of the app by several hundred MBs). Moreover, it consolidates the business logic and creates increased incentives for developers to focus on the CLI when shipping new features.

The biggest con is that it decreases control in the Studio code, particularly when it comes to error handling. We mitigate this by creating as clear a structure as possible around the `process.send` IPC calls.
