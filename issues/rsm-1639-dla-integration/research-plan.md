# RSM-1639: DLA Integration Research Plan

## Research question

How can the Data Liberation Agent (DLA) be made available from inside **Studio Code** (the `studio code` AI-agent CLI command in `apps/cli/`) so that a future `/migrate` slash command can call it?

The deliverable is a synthesis report covering viable options, their tradeoffs, and a recommended path forward. **No code changes.** Scope is the CLI only — anything that would require touching `apps/studio/` (the Electron desktop app) must be flagged.

## Sub-questions

1. **What is DLA, concretely?** What artifact does the repo produce — a Claude plugin? An MCP server? A standalone CLI? A library? What runtime does it need (Node version, Python, PHP, browser, network)? What does its happy-path invocation look like and what does it output?
2. **What is the integration surface today?** What entry points does DLA expose that a host like Studio Code can hook into — a Claude Code plugin (`.claude-plugin/`), MCP server (`.mcp.json`), CLI binary (`cli.js`, `start.sh`), commands/prompts/skills directories, library import? Which of these are stable vs experimental?
3. **How does Studio Code wire skills / slash commands today?** Where would a `/migrate` skill plug in? How are existing skills (`annotate`, `need-for-speed`, etc.) registered and discovered by the Claude Agent SDK at runtime? What contract does a skill need to satisfy to appear in the slash-command list and be invoked correctly?
4. **What integration patterns are viable?** Enumerate the realistic options end-to-end (e.g., bundle DLA as a local Claude plugin inside `apps/cli/ai/plugin/`; consume DLA's MCP server as an `mcpServers` entry; vendor DLA's skills/commands; spawn DLA's CLI as a child process; install DLA from npm at runtime; depend on it as a workspace dep). For each, describe how `/migrate` invocation would flow end-to-end, who owns the process, and how user data moves.
5. **What does it take to ship?** Bundling cost (binary size, native deps), packaging story for the npm CLI publish, runtime/auth requirements, secret/credential model (does DLA need its own API keys? does it piggyback on Studio Code's WPCOM/Anthropic credentials?), update cadence, version pinning, security posture (where does user data go, what does DLA exfiltrate or call out to).
6. **What does DLA actually do during a migration?** What inputs does it expect (source URL? credentials? a destination Studio site path?) and what outputs does it produce (SQL dump? wp-content tarball? a running Studio site? a report?)? This shapes how `/migrate` should orchestrate it.
7. **Cross-cutting concerns:** Does DLA assume a Claude Code host harness (TUI, file tools, Bash tool) that the Studio Code agent SDK runtime may or may not provide? Does it need browser access (we have shared Playwright)? Does it need PHP (we have `@php-wasm/node`)?

## Initial signal (so the researchers don't redo it)

- DLA repo (private): `Automattic/data-liberation-agent`, TypeScript, default branch `main`, last pushed 2026-04-28. Top level contains: `.claude-plugin/`, `.codex-plugin/`, `.mcp.json`, `cli.js`, `start.sh`, `commands/`, `prompts/`, `skills/`, `src/`, `docs/`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `gemini-extension.json`, `DISCOVERIES.md`. This strongly suggests DLA is shipped as a multi-host AI plugin (Claude Code plugin + Codex plugin + Gemini extension + MCP server) with a thin Node CLI driver.
- Studio Code's slash-command surface lives in `tools/common/ai/slash-commands.ts` (`AI_SKILL_COMMANDS`) and `apps/cli/ai/slash-commands.ts` (handler-based commands). Skill commands have no JS handler — they route to the agent via `buildSkillInvocationPrompt(name)` ("Run the /<name> skill using the Skill tool.").
- Skills are bundled at `apps/cli/ai/plugin/skills/<name>/SKILL.md` with frontmatter (`name`, `description`, `user-invokable`). The plugin path is loaded by the Claude Agent SDK via `plugins: [{ type: 'local', path: <pluginRoot> }]` in `apps/cli/ai/agent.ts`.
- Studio Code's Claude Agent SDK config also exposes MCP servers via `mcpServers: { studio: ... }` (see `apps/cli/ai/agent.ts`). Adding a second MCP server is a one-key addition there.
- Studio Code uses `@anthropic-ai/claude-agent-sdk@^0.2.117`, runs on Node ≥22, ships via npm `wp-studio` with bundled `dist/cli/`, and is also packaged inside Electron's resources for the desktop app. Bundling extra files happens via Vite + `vite-plugin-static-copy` (need to confirm what's currently copied).
- DLA being TypeScript means it builds — so there's a "compiled artifact" question (are the published `commands/`, `skills/`, `prompts/` plain markdown? is `src/` runtime code we need to compile/bundle?).

## Approach

We launch one wave focused on grounding facts: what DLA *is* and what it *exposes*, plus how Studio Code's plugin/MCP plumbing works in detail. Once those facts land we can pick approaches with real evidence and (if needed) run a wave 2 that pressure-tests the top one or two candidate integrations against bundling, auth, and update concerns.

## Wave 1 tasks

See `tasks/wave-1-*.md` for the assignable task briefs. The researchers should treat each as independent and parallelizable.

| ID | Title |
|----|-------|
| wave-1-dla-inventory | Inventory DLA — what it is, what it exposes, how it runs |
| wave-1-studio-skill-plumbing | Map Studio Code's skill/MCP/slash-command plumbing end-to-end |
| wave-1-claude-plugin-mechanics | Anthropic Claude Agent SDK — plugin/MCP loading semantics |
| wave-1-bundling-distribution | Studio CLI bundling and distribution constraints for adding DLA |

## What "research complete" looks like

Wave 1 is complete when, for each sub-question 1–5, we have **evidence** (file paths, code excerpts, README quotes, command runs) — not speculation — that lets us name the realistic integration approaches and predict their cost. If wave 1 raises a clear winner we go straight to synthesis; if two or three approaches look comparable we run a focused wave 2 to break the tie (likely pressure-testing on bundling cost, auth model, and the actual `/migrate` UX).

## Findings log

### wave-1-dla-inventory (complete)

DLA is a Node/TypeScript toolkit (`Automattic/data-liberation-agent`, private, no npm publish, no tags, ~17.6 K LOC, 67 .ts/.tsx files) that extracts content from eight closed platforms into a WXR + media + redirect-map + (optional) WooCommerce CSV. The repo ships **five parallel surfaces from the same `src/`**: a Claude Code plugin (`.claude-plugin/plugin.json` declaring an MCP server), a Codex plugin, a Gemini extension, a generic stdio MCP server (`src/mcp-server.ts`, 13 tools, `npx tsx` at runtime), and a thin Ink-based CLI (`src/cli.ts` + `cli.js` interactive bootstrap + `start.sh`). All five point at the same MCP server. **Crucial fact for our integration:** the MCP server's `liberate_setup` and `liberate_import` tools have a `delegate: true` mode that returns a structured manifest (`{ wxrFile, outputDir, mediaDir, productsCsv, redirectMap, importAuthors }`) explicitly designed for "local dev tools with direct database/CLI access" — i.e. for a host like Studio Code. DLA already invokes the `studio` CLI directly via `execFile` (`src/lib/preview/studio.ts`), uses the `importWxr` blueprint step inlined into `blueprint.studio.json` during `studio site create` (to dodge the 120s WP-CLI IPC timeout), and ships its own `@wp-playground/cli` + Playwright (Chromium ~150 MB postinstall). **Risks for us:** private repo (no npm); `tsx` at runtime (no `dist/`); Playwright Chromium download mandatory; vendored PHP scripts loaded by absolute path; pinned at 0.1.0 with no version contract (every consumer eats main).

### wave-1-studio-skill-plumbing (complete)

Studio Code already has a clean two-flow slash-command surface in `apps/cli/commands/ai/index.ts:684-705`: **handler-based** commands (e.g. `/preview`) where `cmd.handler(prompt, ctx)` runs deterministic Node and the agent is never invoked, and **skill-based** commands (e.g. `/need-for-speed`) where `runAgentTurn(buildSkillInvocationPrompt(name))` produces the literal prompt "Run the /<name> skill using the Skill tool." and the SDK does the rest. Skills are discovered from a single local plugin tree at `apps/cli/ai/plugin/` (manifest `apps/cli/ai/plugin/.claude-plugin/plugin.json` — `name: "studio"`), wired in `apps/cli/ai/agent.ts:130-149` via `plugins: [{ type: 'local', path: <agent.ts dir>/plugin }]` plus `mcpServers: { studio: createStudioTools(...) | createRemoteSiteTools(...) }` (in-process SDK MCP). Slash registration happens in `tools/common/ai/slash-commands.ts:8-13` (`AI_SKILL_COMMANDS`). **Three concrete plug-in points for `/migrate`** are: (a) drop `apps/cli/ai/plugin/skills/migrate/SKILL.md` + add an entry to `AI_SKILL_COMMANDS`; (b) add a second MCP server entry under `mcpServers` in `agent.ts:80-84` (in-process SDK or stdio child-process — SDK type signature accepts both); (c) add a handler-only command — but handler-only would NOT be picked up by Electron's IPC dispatcher (`apps/studio/src/ipc-handlers.ts:295-306` only re-routes `AI_SKILL_COMMANDS`). Existing skill `taxonomist` is the closest-shape precedent — it ships sibling PHP under `skills/taxonomist/scripts/*.php` and the agent calls `wp_cli eval-file` on them. There is **no precedent** in this repo for consuming a third-party stdio MCP server, but the SDK type system supports it.

### wave-1-claude-plugin-mechanics (complete)

The `@anthropic-ai/claude-agent-sdk@0.2.117` is a thin TypeScript wrapper that **forks a 207 MB native `claude` Mach-O/PE binary** (Claude Code 2.1.117) where plugin/skill/MCP loading actually happens. **`type: 'local'` is the only `query()`-time plugin variant** — marketplace/npm/git plugins flow through user `settings.json#enabledPlugins`, not through `Options.plugins`. The plugin layout contract (extracted from binary strings) is `<root>/.claude-plugin/plugin.json` (required) plus optional `skills/<name>/SKILL.md`, `commands/`, `agents/`, `hooks/`, `prompts/`, `output-styles/`, `.mcp.json`. **Key compatibility findings:** (i) the SDK supports four MCP transports — in-process `sdk`, stdio child-process (no `type` field needed), `sse`, and `http`; (ii) `mcpServers: Record<string, McpServerConfig>` accepts multiple keys, so adding `mcpServers: { studio: ..., dla: { command: 'npx', args: [...] } }` is a one-line addition in `agent.ts`; (iii) the SDK's skill frontmatter parser reads **`user-invocable`** (with C) but Studio's existing skills use **`user-invokable`** (with K) — invisible because default is `true`, but flag-worthy; (iv) `permissionMode: 'auto'` (Studio's mode) classifies *every* tool call across plugins — there is **no per-plugin permission scope**, so loading DLA grants its skills/MCP tools the same auto-approval. (v) plugin reload is opt-in (`Query.reloadPlugins()`); Studio doesn't call it, so DLA updates require a `studio code` restart.

### wave-1-bundling-distribution (complete)

Studio CLI ships through **two pipelines from one source tree**: npm publish (`wp-studio`, weekly cadence — 1.7.7→1.8.0 in ~6 weeks; `vite.config.npm.ts`) and Electron bundle (`vite.config.prod.ts`, packaged into `extraResource`). The plugin tree at `apps/cli/ai/plugin/` is copied to `dist/cli/plugin/` via `viteStaticCopy` in `vite.config.dev.ts` and `vite.config.npm.ts` (any new file/sub-folder picked up automatically — no allowlist), but **`vite.config.prod.ts` is missing the same target** — flag, possible bug, would mean Electron-packaged CLI may load no plugin tree. CLI already ships a 207 MB platform-specific Claude binary via `optionalDependencies`, materializes node_modules via `--install-links` for the Electron path, prunes per-platform binaries at packaging, and has a postinstall pattern (`scripts/download-agent-skills.ts`) that fetches third-party AI skills from a public repo at install time — directly relevant precedent for DLA. **Three delivery-model options sized:** (a) vendor — best offline story, stale 0–6 weeks, lowest complexity if DLA is markdown-only, much higher if compiled JS; (b) npm dependency — semver-controlled, requires DLA to publish; (c) runtime install/fetch — best decoupling, breaks "works offline once installed" posture. **Auth handoff is trivial** for in-process plugins (env inherited by SDK child) and explicit for stdio MCP (`mcpServers.dla.env`). Sessions recorder/replay (`apps/cli/ai/sessions/{recorder,replay}.ts`) treats third-party tool calls verbatim — no schema changes needed.

### Evaluation against "research complete" criteria

- **Sub-question 1 (what DLA is):** Fully answered by wave-1-dla-inventory with file-level evidence.
- **Sub-question 2 (DLA's integration surfaces):** Fully answered — five surfaces enumerated with manifest contents verbatim.
- **Sub-question 3 (Studio Code skill plumbing):** Fully answered with line-numbered references to `agent.ts`, `slash-commands.ts`, dispatcher in `commands/ai/index.ts`.
- **Sub-question 4 (viable integration patterns):** Five concrete plug-in points enumerated with line-level pin points and SDK type signatures verified.
- **Sub-question 5 (cost to ship):** Bundling matrix produced with disk sizes, cadence data, auth handoff sketched per option, Electron-side pitfalls flagged.

**Decision: research is complete.** Findings collectively name a clear winning integration shape (vendor DLA's `.claude-plugin/`-rooted tree as a second local plugin alongside Studio's existing one, surface `/migrate` via `AI_SKILL_COMMANDS`, route the model to DLA's MCP server which runs as a stdio child-process with `delegate: true` import handoff back to Studio's `wp_cli` tool). Wave 2 is not needed; remaining unknowns (the `vite.config.prod.ts` plugin-copy gap, marketplace plugin-name collision rules, DLA private-repo distribution mechanic) are operational items for the implementation phase, not research blockers. They go in "Open Questions" of the synthesis.

