# Embedded Claude Code terminal in the Agentic UI

Date: 2026-07-30 · Worktree: `~/worktrees.nosync/claude-terminal-agentic-ui-073011` (branch `claude-terminal-agentic-ui-073011`)
Status: PoC, verified end-to-end (draft-PR scope per AGENTS.md). Supersedes the ACP-engine approach for subscription users; the ACP worktree (`acp-claude-code-engine-073011`) stays parked.

## Why this approach

Anthropic's announced (currently paused) billing change moves ACP / Agent SDK / `claude -p` usage off the Pro/Max subscription pool onto capped monthly "Agent SDK credits" ($20 Pro / $100 Max 5x / $200 Max 20x). The one surface that keeps **full subscription limits** is the official `claude` CLI running interactively in a terminal — Zed's own recommendation to its users. So Studio embeds a real terminal running the real CLI and contributes what Studio uniquely knows: the site directory, the `wordpress-studio` MCP server, and preview refresh.

## Decisions (confirmed with Antonio)

1. **Terminal plan over finishing ACP** — future-proof vs credit cap; ACP branch parked, ~70% done if the revised billing treats ACP kindly.
2. **Chat-pane replacement per site** — route `/sites/:siteId/terminal` renders the terminal where the chat transcript normally sits; the site preview panel stays on the right and its reload pipeline keeps working.
3. **WebSocket + node-pty** — ws upgrade on the existing loopback Express server (origin-allowlisted), xterm.js on the client.

## What was built

| Piece | File | Notes |
|---|---|---|
| Terminal manager | `apps/local/src/terminal.ts` | node-pty spawns `claude --mcp-config <generated>` with `cwd` = site path; one pty per site, reused across page reloads (200KB replay buffer); `POST /api/terminals`, `DELETE /api/terminals/:id`, WS at `/api/terminals/:id/ws` (origin-checked); chokidar watcher on the site dir → debounced `preview.reload` over the agent SSE channel with synthetic session id `terminal-<siteId>` |
| Server wiring | `apps/local/src/index.ts` | manager creation, routes, `server.on('upgrade')`, cleanup in `close()` |
| Terminal view | `apps/ui/src/components/claude-terminal/` | xterm + fit addon, WS input/resize/output, light/dark theme pick, error banner when `claude` is missing, subscribes to `preview.reload` and dispatches the existing `preview/reload` UI action |
| Route | `apps/ui/src/ui-classic/router/route-site-terminal/` + `router.tsx` | TanStack route under the dashboard layout |
| Preview co-existence | `apps/ui/src/ui-classic/router/layout-dashboard/index.tsx` | terminal route counts as preview-capable, same as overview/new-session |
| Entry point | `apps/ui/src/components/site-list/index.tsx` | site context menu → "Open Claude Code terminal" |
| Deps | apps/cli: `node-pty`, `ws`; apps/ui: `@xterm/xterm`, `@xterm/addon-fit` | server deps live in apps/cli's package.json because the CLI build externalizes exactly that list |

MCP injection: the manager writes a temp config `{ mcpServers: { 'wordpress-studio': { command: <node>, args: [<cli main.mjs>, 'mcp'] } } }` and passes `--mcp-config` (no `--strict-mcp-config`, so the user's own MCP setup stays intact).

## Verified (2026-07-30, Playwright against :8081)

- `npm run typecheck` green across workspaces; eslint clean on touched files; `npm run cli:build:ui` builds.
- `node apps/cli/dist/cli/main.mjs ui --no-open` → terminal route renders Claude Code v2.1.220 header: **“Fable 5 · Claude Max · ~/Studio/seven-islands”** — subscription auth, site cwd.
- `/mcp` inside the terminal lists **wordpress-studio · connected · 27 tools**.
- Keyboard round trip: prompt “Reply with exactly: STUDIO TERMINAL OK” → reply rendered.
- Preview watcher: `touch wp-content/…` → `preview.reload` event with `sessionId: terminal-<siteId>` observed on `/api/events` SSE.
- Site context menu shows “Open Claude Code terminal”.

## Trade-offs

| Decision | Cost |
|---|---|
| Terminal UX instead of native chat | Transcript lives in Claude Code's own session files, not Studio's JSONL store — no Studio history/replay/model-picker for terminal sessions. Composer, queueing, artifacts, questions UI all bypassed. |
| Interactive CLI (not `claude -p`) | The whole point — programmatic drive would land in the credit bucket. Means Studio cannot inject prompts on the user's behalf; the user types. |
| Auto tool approval | Claude Code's own permission prompts appear inside the terminal (its `auto mode` is the user's choice) — Studio adds no extra gating. |
| fs-watcher preview refresh | Fires on any site-dir change (even non-visual); debounced 800ms. Alternative (hooking MCP tool calls) would miss Bash edits. |
| `node-pty` native dep | Works under `studio ui` (system node). Electron packaging needs prebuild handling later (see memory note on Windows signtool + cross-platform .node prebuilds — same class of problem). npm sometimes drops the exec bit on node-pty's `spawn-helper` (`posix_spawnp failed.`) — the manager re-chmods it at startup as a safeguard. |
| Terminal reachable only in `studio ui` (local connector) | Electron/hosted builds show the menu entry but POST fails; needs gating or IPC-side pty before shipping beyond PoC. |
| `claude` binary discovery | PATH + common install dirs; clear error banner otherwise. |

## Fallback CTAs (added 2026-07-30)

Visible switches to the terminal when the WPcom assistant is unusable:

- **Usage cap / AI disabled / login required** — `TurnErrorMarker` (`session-view/conversation/index.tsx`) shows a "Continue in the Claude Code terminal" button linking to the session owner site's terminal. Trigger: `isUsageCapError`, `isAiBlockedError`, or a login-required error message (English-substring match — localized CLIs fall back to plain text).
- **Signed out** — `AgenticSigninBanner`/`SigninNotice` gains an outline "Use Claude Code terminal instead" button when given `terminalSiteId` (site overview passes it). Note: the local (`studio ui`) connector sets `agenticRequiresAuth: false`, so this banner only renders in Electron/hosted; in `studio ui` the logged-out state surfaces as the login-required turn error, covered above.

Verified via Playwright interception (fake usage-cap turn error injected into the session response): notice + CTA rendered, click navigated to `/sites/<ownerSite>/terminal`, Claude Code booted with the right cwd.

## Known gaps (PoC)

- Menu entry not hidden on non-local connectors (Electron/hosted).
- No terminal session persistence across server restarts (`claude --continue` mitigates manually).
- Watcher may fire during `studio` CLI operations (pull/import), reloading the preview mid-operation.
- xterm theme: static light/dark palettes, not derived from wpds tokens.
- The schema enum `claude-code` (from the parked ACP branch) was added to `apps/cli/lib/cli-config/core.ts` here too, so a cli.json written by that branch doesn't brick this build's CLI ops.

## How to run

1. `cd ~/worktrees.nosync/claude-terminal-agentic-ui-073011 && npm run cli:build:ui`
2. `node apps/cli/dist/cli/main.mjs ui --no-open` → http://localhost:8081
3. Right-click a site → “Open Claude Code terminal”.

## Alternatives considered

- **Finish ACP engine** (parked worktree): native chat UX, but credit-capped once Anthropic's billing change lands; revisit when the revised plan ships.
- **BYOK API keys**: already shipped (`anthropic-api-key`); OpenAI-key provider still a cheap add.
- **`claude -p` headless as engine**: same billing bucket as ACP — rejected.
