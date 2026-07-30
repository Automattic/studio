# ACP engine for Studio Code — Claude Pro/Max subscription provider

Date: 2026-07-30 · Worktree: `~/worktrees.nosync/acp-claude-code-engine-073011` (branch `acp-claude-code-engine-073011`)
Status: PoC (draft-PR scope per AGENTS.md "Large & Exploratory Contributions")

## Goal

Let Studio Code (Agentic UI, `apps/ui` served by `studio ui` on :8081) run agent turns on a user's **Claude Pro/Max subscription** instead of the WPcom AI proxy — compliantly. Direct subscription-OAuth in a third-party harness is banned by Anthropic (Jan–Apr 2026 enforcement); the sanctioned path is the one Zed uses: **ACP (Agent Client Protocol)** fronting the official Claude Code / Agent SDK harness. Anthropic confirmed ACP/Agent-SDK usage keeps drawing from Pro/Max subscriptions (Zed blog, June 2026).

## Decisions (confirmed with Antonio)

1. **New provider, keep pi.** `claude-code` becomes a third provider next to `wpcom` and `anthropic-api-key`. pi runtime untouched for the other two. No regression risk; A/B-able.
2. **Auto-approve tools scoped to the site dir.** ACP `session/request_permission` auto-answered "allow"; session `cwd` = site path (`~/Studio/<site>`). Matches current Studio behavior (pi tools don't prompt either).
3. **Studio tools via existing MCP.** `studio mcp` already exposes Studio tools; passed to the ACP session as an MCP server (`{ command: <cli>, args: ['mcp'] }`). No new bridge code.

## Architecture (as found)

- UI → `Connector` (SSE) → `apps/local` Express :8081 → `RunManager.startAgentRun` forks `studio code sessions resume <id> <prompt> --json` → CLI turn loop → **`runStudioAgentTurn`** (`apps/cli/ai/runtimes/pi/index.ts:107`; sole call site `apps/cli/commands/ai/index.ts:543`) → `JsonEvent`s over Node IPC → SSE → UI reducer.
- **No runtime abstraction exists** (`pickRuntime` in models.ts:11 comment is stale — symbol doesn't exist). The seam must be created at the turn-dispatch call site.
- Sessions: pi-format JSONL (`packages/common/ai/sessions/store.ts`), `SessionManager.appendMessage` is public → a non-pi engine can append pi-format entries and the whole transcript/replay/UI keeps working.
- `--json` (GUI-spawned) mode **hardcodes `wpcom`** at `apps/cli/commands/ai/index.ts:344-347` — must honor the saved provider when it's `claude-code`, otherwise the UI can never reach the new engine.
- Provider choice persisted as `aiProvider` in `~/.studio/cli.json` (`aiProviderSchema` enum, `apps/cli/lib/cli-config/core.ts:67`). No provider picker exists in any GUI — CLI `/provider` only.

## Design

New runtime `apps/cli/ai/runtimes/acp/`:

- Spawn `@agentclientprotocol/claude-agent-acp` (v0.63.x, Apache-2.0; wraps `@anthropic-ai/claude-agent-sdk@0.3.220`) as a stdio child.
- Speak ACP via `@agentclientprotocol/sdk` `ClientSideConnection`: `initialize` → `session/new` (cwd = site dir, mcpServers = studio mcp) → `session/prompt`; map `session/update` notifications (agent_message_chunk, tool_call, tool_call_update, plan) onto Studio's `JsonAdapter` events and pi-format session entries.
- Client callbacks: `requestPermission` → auto-allow (decision 2); `fs` read/write → deny (adapter uses its own tools); terminal — not implemented in PoC.
- Auth: reuse the user's existing Claude Code login (keychain, `claude /login`). Provider `isReady()` = `claude-agent-acp` resolvable + Claude Code credentials present. No tokens stored by Studio; nothing to leak.

Touched files:

| File | Change |
|---|---|
| `apps/cli/ai/providers.ts` | add `claude-code` to `AI_PROVIDERS`, priority list, definition (anthropic family only) |
| `apps/cli/lib/cli-config/core.ts` | add `claude-code` to `aiProviderSchema` |
| `apps/cli/commands/ai/index.ts` | JSON mode honors saved `claude-code` provider; turn dispatch branches pi vs ACP |
| `apps/cli/ai/runtimes/acp/index.ts` | new engine (`runAcpAgentTurn`) |
| `apps/cli/package.json` | deps `@agentclientprotocol/sdk`, `@agentclientprotocol/claude-agent-acp` |

## Trade-offs

| Decision | Chosen | Cost |
|---|---|---|
| ACP vs Agent SDK direct | ACP | One extra process + protocol hop. Buys: ToS-safe seam identical to Zed's, and the same client later plugs Gemini CLI / Codex adapters (one integration, many engines). |
| New provider vs replace pi | Add provider | Two engines to maintain; model picker semantics differ per provider (GUI picker lists all `AI_MODELS` unfiltered — divergence becomes visible once a family-restricted provider is GUI-reachable). |
| Auto-allow permissions | Yes (PoC) | Claude Code can edit/run anything under the site dir without confirmation. Same trust level as current pi tools, but Bash is broader. Production wants `session/request_permission` → Studio's `question.asked` UI flow. |
| Session persistence | Append pi-format entries | ACP-side session state (Claude Code's own session) not resumable across turns unless we keep `session/load` / adapter alive; PoC creates a fresh ACP session per turn and replays context via prompt. Costs context fidelity on long sessions. |
| Model picker | Ignored by ACP engine (Claude Code default model) | `/model` + GUI picker have no effect on ACP turns in PoC. Mapping `AiModelId` → Agent SDK model ids is straightforward follow-up. |
| Packaging | npm dep, spawned via `require.resolve` | Fine for CLI/`studio ui`. Electron-packaged app needs the adapter shipped in ASAR/resources — out of PoC scope. |
| Subscription economics | Rides Pro/Max pool today | Anthropic's paused "Agent SDK credits" plan ($20/$100/$200 monthly) may cap this later. Don't market as unlimited. |

## Known gaps (PoC)

- No streaming-token-level parity: ACP `agent_message_chunk` mapped to Studio message events; thinking blocks summarized/omitted per Claude Code defaults.
- Interrupt (`POST /runs/:id/interrupt`) → `session/cancel` wired best-effort.
- Usage caps / 429 UX (wpcom-specific in `ui.ts:2100`) doesn't apply; subscription limit errors surface as plain errors.
- e2e not covered; verified manually via `npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui --no-open`.

## How to run

1. `cd ~/worktrees.nosync/acp-claude-code-engine-073011 && npm run cli:build:ui`
2. `node apps/cli/dist/cli/main.mjs ui --no-open` → http://localhost:8081
3. Set provider: `node apps/cli/dist/cli/main.mjs code` → `/provider` → Claude Code (or `aiProvider: "claude-code"` in `~/.studio/cli.json`).
4. Send prompt in Agentic UI; confirm turn runs without WPcom/Anthropic key, transcript renders, entries persist across reload.

## Implementation notes (post-build findings)

- Bare `'module'` import got stubbed by the CLI bundler (`vite.config.base.ts` externals regex covers `node:*` + a fixed builtin list only) — use `node:module` for `createRequire` in bundled CLI code.
- Added `autoSelectable: false` to `AiProviderDefinition`: `claude-code` shows in `/provider` but is never auto-picked by the first-run scan or fallback logic — opting a user's subscription in silently would be wrong. Guarded by a unit test in `apps/cli/ai/tests/auth.test.ts`.
- `--json` (UI-spawned) mode needed no change: it only forces `wpcom` when no provider is saved; a saved `claude-code` flows through.

## Verified (2026-07-30)

- `npm run typecheck`, `npx eslint --fix` on touched files, `npm test -- apps/cli/...` — all green (13/13 auth tests).
- Headless: `node apps/cli/dist/cli/main.mjs code "…" --json` → full pi-shaped event stream (message_start/update/end, turn_end, agent_end), `turn.completed status:success`, streamed via Claude subscription. No WPcom/Anthropic key in env.
- Agentic UI on :8081 (`npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui --no-open`): prompt sent from composer answered "Claude Code harness. Fable 5 model."; live streaming spinner worked; transcript survived a full page reload (JSONL replay).
