---
task: wave-1-studio-skill-plumbing
wave: 1
status: complete
---

# Wave 1 — Studio Code Skill / MCP / Slash-Command Plumbing

## 1. Lifecycle diagrams (slash command → execution)

User input dispatch in `apps/cli/commands/ai/index.ts:684-705`. Two execution paths.

### Flow A — Handler-based slash command (e.g. `/preview`, `/login`, `/model`)

```
user types "/preview"
  └─> apps/cli/commands/ai/index.ts:688  AI_CHAT_SLASH_COMMANDS.find(name === "preview")
      └─> apps/cli/commands/ai/index.ts:691  await cmd.handler(prompt, ctx)
          └─> apps/cli/ai/slash-commands.ts:232-291  preview handler body
              ├─ reads token via @studio/common/lib/shared-config.readAuthToken
              ├─ calls captureCommandOutput(...) — apps/cli/ai/tools.ts:225
              │  (in-process console.log capture, NOT a child-process spawn)
              └─ calls runCreatePreviewCommand / runUpdatePreviewCommand
                   (imported from cli/commands/preview/{create,update})
                   — these are normal yargs handlers run as plain function calls
              [returns 'continue' or 'break' to the chat loop]
   the agent (Claude) is never invoked for this command
```

### Flow B — Skill-based slash command (e.g. `/annotate`, `/need-for-speed`)

```
user types "/need-for-speed"
  └─> apps/cli/commands/ai/index.ts:688  match in AI_CHAT_SLASH_COMMANDS
      (entry comes from spreading AI_SKILL_COMMANDS at line 297 of
       apps/cli/ai/slash-commands.ts; it has no `handler`)
  └─> apps/cli/commands/ai/index.ts:699
      runAgentTurn( buildSkillInvocationPrompt('need-for-speed') )
      └─> tools/common/ai/slash-commands.ts:15-17 returns the literal string:
          "Run the /need-for-speed skill using the Skill tool."
  └─> apps/cli/commands/ai/index.ts:464  startAiAgent({ prompt, ... })
      └─> apps/cli/ai/agent.ts:130  query({ prompt, options: {
              tools: { type: 'preset', preset: 'claude_code' },   // line 142
              plugins: [{ type: 'local', path: <agent.ts dir>/plugin }],  // line 149
              mcpServers: { studio: createStudioTools(...) },     // line 80-84
              ...
          }})
  └─> @anthropic-ai/claude-agent-sdk forks the bundled `claude` native binary
      (per-platform vendor binaries, e.g. darwin-arm64 ~206 MB)
  └─> claude binary discovers the local plugin at `<dist>/plugin/`,
      reads `.claude-plugin/plugin.json` (apps/cli/ai/plugin/.claude-plugin/plugin.json)
      and enumerates `skills/<name>/SKILL.md` files
  └─> Skill tool (a built-in tool from the `claude_code` preset) consumes the
      "/need-for-speed" hint and inlines the body of
      apps/cli/ai/plugin/skills/need-for-speed/SKILL.md into the agent's context
  └─> the model follows SKILL.md, e.g. calls `mcp__studio__need_for_speed` —
      that tool is the SDK MCP tool registered in apps/cli/ai/tools.ts:852-890,
      backed by apps/cli/ai/performance-audit.ts.auditPerformance()
```

The "Skill tool" is part of the `claude_code` preset (`tools: { type: 'preset', preset: 'claude_code' }`); Studio code only registers `plugins: [{ type: 'local', path }]` — the SDK does plugin discovery itself.

## 2. Inventory of existing skills

Plugin manifest: `apps/cli/ai/plugin/.claude-plugin/plugin.json` — `{ "name": "studio", "description": "WordPress Studio AI skills", "version": "1.0.0" }`.

| Skill dir | Frontmatter | Listed in `AI_SKILL_COMMANDS`? | Tooling dependencies |
|---|---|---|---|
| `annotate/SKILL.md` | `name: annotate` / `user-invokable: true` | yes (`tools/common/ai/slash-commands.ts:9`) | MCP tools: `open_annotation_browser`, `wait_for_annotations` (`tools.ts:1100-1156`); aux code in `apps/cli/ai/inspector/` (Playwright-driven) |
| `need-for-speed/SKILL.md` | `name: need-for-speed` / `user-invokable: true` | yes (line 11) | MCP tool: `need_for_speed` (`tools.ts:852-890`); aux code in `apps/cli/ai/performance-audit.ts` |
| `rank-me-up/SKILL.md` | `name: rank-me-up` / `user-invokable: true` | yes (line 12) | MCP tool: `rank_me_up`; aux code in `apps/cli/ai/seo-audit.ts`. Skill body also instructs the model to call the built-in `wp_cli` tool. |
| `site-spec/SKILL.md` | `name: site-spec` / `user-invokable: true` | **NO** — referenced by the system prompt (`apps/cli/ai/system-prompt.ts:138`), triggered indirectly during site creation. **Orphan-ish.** | No dedicated MCP tool; calls `site_create` (`tools.ts:295`) and uses the SDK's built-in `AskUserQuestion` (intercepted by `PreToolUse` hook in `agent.ts:106-128`). |
| `taxonomist/SKILL.md` | `name: taxonomist` / `user-invokable: true` | yes (line 10) | MCP tool: `install_taxonomy_scripts` (`tools.ts:824-850`) which copies `apps/cli/ai/plugin/skills/taxonomist/scripts/{apply-changes.php, backup.php, export-posts.php, restore.php}` into the target site. The skill body then drives the agent to call `wp_cli eval-file <those PHP scripts>`. **WP-CLI-invocable PHP, packaged inside the skill directory.** |

**Orphans / mismatches:** `site-spec` is on disk but absent from `AI_SKILL_COMMANDS`. Skills reach into auxiliary code via SDK MCP tool calls (dominant pattern), via SDK built-in tools (`wp_cli`, `Bash`, `Read`/`Edit`/`Write`), or via packaged sibling files (taxonomist's PHP scripts).

## 3. MCP plumbing

### 3a. Wiring (`apps/cli/ai/agent.ts:80-84`)

```ts
const mcpServers = {
    studio: isRemoteSite
        ? createRemoteSiteTools( wpcomAccessToken, activeSite.wpcomSiteId! )
        : createStudioTools( { enablePreviewSteering: isForkedByDesktop } ),
};
```

Both factories use `createSdkMcpServer({ name: 'studio', version: '1.0.0', tools })`. Tools surface to the model as `mcp__studio__<tool_name>`.

### 3b. SDK type signatures (from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`)

```ts
// line 1386
mcpServers?: Record<string, McpServerConfig>;

// line 920
McpServerConfig =
    McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfigWithInstance;

// 1005
type McpStdioServerConfig = { type?: 'stdio'; command: string; args?: string[]; env?: Record<string,string> };
// 998
type McpSSEServerConfig = { type: 'sse'; url: string; headers?: Record<string,string>; tools?: McpServerToolPolicy[] };
// 897
type McpHttpServerConfig = { type: 'http'; url: string; headers?: Record<string,string>; tools?: McpServerToolPolicy[] };
// 904 / 913
type McpSdkServerConfigWithInstance = { type: 'sdk'; name: string; instance: McpServer };
```

JSDoc on `mcpServers` (line 1376) shows the canonical stdio child-process example.

### 3c. Stdio child-process MCP — supported

**Yes.** `mcpServers` accepts `{ command: string, args?: string[], env?: Record<string,string>, type?: 'stdio' }`. **No precedent in this repo of consuming a third-party stdio MCP server** today — the only `mcpServers` entry is the in-process `studio` SDK MCP server.

### 3d. The MCP stdio server in `apps/cli/ai/mcp-server.ts` and `apps/cli/commands/mcp.ts`

These exist for the **inverse** direction — they expose Studio's tools to *external* MCP clients (Claude Desktop, Claude Code CLI, Codex, Cursor). Studio Code does not consume any external MCP server today.

## 4. Bundling story

### 4a. CLI build matrix

| Config | Command | Defines | Copies `ai/plugin`? |
|---|---|---|---|
| `apps/cli/vite.config.dev.ts` | `npm run cli:build` | `__IS_PACKAGED_FOR_NPM__: false`, `__ENABLE_CLI_TELEMETRY__: false` | **Yes** — `viteStaticCopy({ targets: [{ src: 'ai/plugin', dest: '.' }] })` (lines 9-17) |
| `apps/cli/vite.config.npm.ts` | `npm run cli:build:npm` (also `prepublishOnly`) | `__IS_PACKAGED_FOR_NPM__: true`, `__ENABLE_CLI_TELEMETRY__: true` | **Yes** — same `viteStaticCopy` (lines 8-17) |
| `apps/cli/vite.config.prod.ts` | `npm run cli:build:prod` (used by `cli:package` for desktop build, `forge.config.ts:174`) | `__ENABLE_CLI_TELEMETRY__: true` | **No** — only copies `node_modules/`. **`ai/plugin` is NOT copied** in the prod build path. |

History: plugin tree was added to `vite.config.dev.ts` in `853b913c` (2026-03-18); to `vite.config.npm.ts` in `882f27e9` (2026-04-20, "include ai/plugin folder in npm build output"). `vite.config.prod.ts` was not updated. **Possibly a bug.**

### 4b. Plugin path resolution at runtime

`apps/cli/ai/agent.ts:149`: `path.resolve(import.meta.dirname, 'plugin')`. The Vite build inlines all CLI sources into `dist/cli/main.mjs`. `import.meta.dirname` is `dist/cli/`. Combined with `viteStaticCopy({ src: 'ai/plugin', dest: '.' })` putting the tree at `dist/cli/plugin/`, the SDK loads `dist/cli/plugin/.claude-plugin/plugin.json` and `dist/cli/plugin/skills/*/SKILL.md` at runtime.

### 4c. Files shipped with the npm CLI

`apps/cli/package.json:12-17` `files` array: `assets/`, `dist/cli/`, `patches/`, `scripts/`. With `vite.config.npm.ts` that includes:
- `dist/cli/main.mjs` (+ side-bundles from `vite.config.base.ts:60-67`)
- `dist/cli/package.json` (`{ "type": "module" }`, written by `write-dist-extras` plugin in base)
- `dist/cli/plugin/.claude-plugin/plugin.json`
- `dist/cli/plugin/skills/<each skill>/SKILL.md` (and any sibling files like `scripts/*.php`)
- `dist/cli/php/`, `dist/cli/wp-files/`, `dist/cli/reprint.phar` (from base)

**No build-config change needed for new files under `ai/plugin/...`** in dev/npm paths — `viteStaticCopy` recursively copies the entire tree.

### 4d. Electron / desktop runtime layout

`apps/studio/forge.config.ts:18-22` adds `apps/cli/dist/cli/` as `extraResource`. CLI is forked by `apps/studio/src/modules/ai-agent/run-manager.ts:53-65` (`fork(cliPath, ['code', 'sessions', 'resume', sessionId, prompt, '--json', ...], { execPath: getBundledNodeBinaryPath() })`).

Because `vite.config.prod.ts` does not copy `ai/plugin`, **the desktop-bundled CLI's `dist/cli/plugin/` directory may be missing unless a separate copy step is added**. (Flag, see section 6.)

## 5. `/migrate` plug-in points (exhaustive enumeration, no recommendation)

### 5a. Skill-based slash command (drop a SKILL.md plus optional MCP tool)

- **Slash registration** — `tools/common/ai/slash-commands.ts:8-13` `AI_SKILL_COMMANDS`. Append `{ name: 'migrate', description: __('…') }`.
- **On-disk skill** — `apps/cli/ai/plugin/skills/migrate/SKILL.md` with YAML frontmatter (`name`, `description`, `user-invokable: true`).
- **No build-config change required** for dev/npm paths. **Build-config change IS required for the prod path** (section 6 item 3).
- The plugin manifest doesn't need to change — directory-based discovery.

### 5b. New MCP server entry (in-process SDK MCP)

- **Tool factory** — alongside `createStudioTools`/`createRemoteSiteTools` in `apps/cli/ai/tools.ts:1203-1222`, add e.g. `createMigrateTools()` calling `createSdkMcpServer({ name: 'migrate', tools: [...] })`.
- **Wire in** — `apps/cli/ai/agent.ts:80-84` extend `mcpServers = { studio: ..., migrate: createMigrateTools(...) }`. SDK type at `sdk.d.ts:1386` is `Record<string, McpServerConfig>`.
- Tools surface as `mcp__migrate__<tool_name>`.

### 5c. New MCP server entry (stdio child-process MCP)

- Add entry at `apps/cli/ai/agent.ts:80-84`:
  ```ts
  mcpServers = {
      studio: ...,
      migrate: { command: 'node', args: ['/path/to/dla/cli.js', '--mcp'] },
  };
  ```
- **No precedent in this repo.** Bundling/locating the child-process binary is the caller's responsibility.

### 5d. Handler-based slash command (no LLM in the loop, like `/preview`)

- Add handler entry to `AI_CHAT_SLASH_COMMANDS` in `apps/cli/ai/slash-commands.ts:49-298`. Pattern from `/preview`:
  ```ts
  { name: 'migrate', description: __('…'), handler: async (_prompt, ctx) => { … return 'continue'; } },
  ```
- Handler context (`SlashCommandContext` at lines 16-29) provides `ui`, `currentModel`, `currentProvider`, `switchProvider`, `prepareProviderSelection`, `clearSession`, `persistSessionContext`.
- Auth available via `readAuthToken` (already imported at line 2); `prepareAiProvider` / `resolveAiEnvironment` from `cli/ai/auth`.
- **Critical:** A handler-only command will **not** be picked up by Electron's IPC dispatcher (`apps/studio/src/ipc-handlers.ts:295-306` only re-routes commands listed in `AI_SKILL_COMMANDS`). It works in CLI; in the desktop app, the command would route to the agent and the Skill tool would fail. (See section 6 item 1.)

### 5e. Child-process invocation pattern (for spawning DLA's CLI from a slash command)

- **No precedent for slash commands spawning a child process** today. Closest precedents:
  - `apps/cli/ai/browser-utils.ts:50-56` uses `execFile(process.execPath, [cliPath, 'install', 'chromium'], ...)` — Playwright install only.
  - `apps/cli/lib/daemon-client.ts:156-164` uses `spawn(process.execPath, [daemonScriptPath], { detached: true, stdio: 'ignore' })` for the process-manager daemon.
- Where it would slot in: inside a handler under `AI_CHAT_SLASH_COMMANDS` (5d) or inside an MCP tool function (5b).

### 5f. Discoverability cross-reference

- `apps/cli/ai/ui.ts:566` — autocomplete (`new CombinedAutocompleteProvider(AI_CHAT_SLASH_COMMANDS)`).
- `apps/cli/commands/ai/index.ts:688` — chat-loop dispatcher (Flow A vs B selector).
- `apps/studio/src/ipc-handlers.ts:295-306` — Electron IPC handler that expands `/<name>` only for `AI_SKILL_COMMANDS` entries.
- `apps/ui/src/components/session-view/composer/index.tsx:2,126` — Studio renderer reads `AI_SKILL_COMMANDS` for slash hints.

## 6. Anything Electron-side — flagged, not investigated

1. **Electron IPC slash dispatcher reads `AI_SKILL_COMMANDS`** — `apps/studio/src/ipc-handlers.ts:30, 295-306`. Skill entries auto-pick-up; handler-based commands (5d) would NOT be picked up here.
2. **Renderer composer slash hints** — `apps/ui/src/components/session-view/composer/index.tsx:2, 126` reads `AI_SKILL_COMMANDS` to render slash autocomplete. New skill entries appear automatically.
3. **`vite.config.prod.ts` does NOT copy `ai/plugin`** — gap (or compensating step elsewhere I didn't trace). Would mean desktop `studio code` runs without the SDK plugin tree. Needs verification.
4. **CLI is forked from Electron** — `apps/studio/src/modules/ai-agent/run-manager.ts:53-65`. Anything DLA needs at runtime inherits this process model.
5. **MCP install-instructions output** — `apps/cli/commands/mcp.ts:36-58` and `tools/common/lib/mcp-config.ts` only emit `wordpress-studio` install instructions. If `/migrate` adds a separate MCP server other AI hosts should consume, this surface needs extending — but lives in `tools/common/`, not `apps/studio/`.

## 7. Caveats / unverified

- Did NOT verify SDK behavior with malformed/missing skill frontmatter; the validation logic lives in the vendored `claude` native binary.
- The Electron-prod-build gap for `ai/plugin` (section 6 item 3) needs cross-check with someone who has a packaged Studio.app to confirm whether plugin loading actually works in production today.
