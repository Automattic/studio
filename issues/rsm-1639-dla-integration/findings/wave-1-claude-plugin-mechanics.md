---
task: wave-1-claude-plugin-mechanics
wave: 1
status: complete
---

# Wave 1 — Claude Agent SDK plugin / MCP / skill loading semantics

Investigation scope: `@anthropic-ai/claude-agent-sdk@0.2.117` as installed in this worktree's `node_modules`. The wrapper bundles a native Claude Code 2.1.117 binary where the actual plugin/skill/MCP loaders live.

## 0. Architecture sanity check

`@anthropic-ai/claude-agent-sdk` is a thin TypeScript IPC wrapper that **spawns the bundled `claude` Mach-O/PE binary as a child process** and exchanges JSON-RPC over stdio. Plugins, skills, MCP, and slash-commands are loaded *inside that subprocess*.

- `version: "0.2.117"`, `claudeCodeVersion: "2.1.117"` — SDK pin and Claude Code engine pin move in lockstep (`package.json:4,81`).
- Binary lives under platform-specific `optionalDependencies` like `@anthropic-ai/claude-agent-sdk-darwin-arm64@0.2.117` (`package.json:57-66`). On this machine: 197 MB Mach-O arm64 executable.
- **Implication: upgrading the SDK upgrades the embedded Claude Code engine.**

## 1. Type signatures (verbatim)

### `Options.plugins`
```ts
plugins?: SdkPluginConfig[];   // sdk.d.ts:1442
```

### `SdkPluginConfig`
```ts
// sdk.d.ts:2870-2882
export declare type SdkPluginConfig = {
    type: 'local';   // ← the only variant supported at query() time
    path: string;
};
```

**`type: 'local'` is the only `query()`-time plugin variant.** Marketplace, npm, github, git, pip, and url-source plugins exist (settings schema below) but they're loaded out-of-band via `enabledPlugins` in user/project `settings.json`, not via the `plugins` array passed to `query()`.

### `Options.mcpServers`
```ts
mcpServers?: Record<string, McpServerConfig>;   // sdk.d.ts:1386
```

### `McpServerConfig` and variants
```ts
// sdk.d.ts:917-922
export declare type McpServerConfig = McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfigWithInstance;

// sdk.d.ts:1005-1010
export declare type McpStdioServerConfig = {
    type?: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
};

// sdk.d.ts:998-1003
export declare type McpSSEServerConfig = {
    type: 'sse';
    url: string;
    headers?: Record<string, string>;
    tools?: McpServerToolPolicy[];
};

// sdk.d.ts:897-902
export declare type McpHttpServerConfig = {
    type: 'http';
    url: string;
    headers?: Record<string, string>;
    tools?: McpServerToolPolicy[];
};

// sdk.d.ts:904-915
export declare type McpSdkServerConfigWithInstance = {
    type: 'sdk';
    name: string;
    instance: McpServer;
};
```

`McpStdioServerConfig.type` is **optional** (so omitting it is valid). Studio's `mcpServers: { studio: createStudioTools(...) }` works because the in-process variant uses `type: 'sdk'` internally.

### `createSdkMcpServer` and `tool` helper
```ts
// sdk.d.ts:418-424
export declare function createSdkMcpServer(_options: CreateSdkMcpServerOptions): McpSdkServerConfigWithInstance;

declare type CreateSdkMcpServerOptions = {
    name: string;
    version?: string;
    tools?: Array<SdkMcpToolDefinition<any>>;
};

// sdk.d.ts:5036-5040
export declare function tool<Schema>(_name: string, _description: string, _inputSchema: Schema, _handler, _extras?: { annotations?, searchHint?, alwaysLoad? }): SdkMcpToolDefinition<Schema>;
```

### `Options.permissionMode`
```ts
// sdk.d.ts:1697
export declare type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
```
Inline doc (`sdk.d.ts:1694-1697`): `'auto'` — Use a model classifier to approve/deny permission prompts.

## 2. Plugin layout contract

The SDK type system doesn't describe the on-disk layout — that's enforced by the bundled `claude` binary. Evidence comes from grepping the binary's strings.

**Required:**
- `<plugin-root>/.claude-plugin/plugin.json` — the plugin manifest.

**Optional surfaces** (from binary strings):
- `skills/<name>/SKILL.md`
- `commands/`
- `agents/`
- `hooks/`
- `prompts/`
- `output-styles/`
- `.mcp.json` — sibling MCP-server config

A bare `skills/` directory **without `plugin.json` is not enough** at the `query({ plugins: ... })` layer. Studio's plugin ships `apps/cli/ai/plugin/.claude-plugin/plugin.json` containing only `name`, `description`, `version` — those three fields are sufficient in practice.

**Reload behavior:** `Query.reloadPlugins()` exists (`sdk.d.ts:1977-1983`) — plugin file changes are NOT auto-watched but the host can trigger a reload programmatically. **Studio Code does NOT call `reloadPlugins()`** (`agent.ts:130-153`), so a live DLA update would require either a host-side change or a CLI restart.

## 3. Skill contract

### Frontmatter fields (decoded from binary)

The bundled `claude` binary's skill-frontmatter parser was extracted. Recognized SKILL.md frontmatter keys:

| Field | Type | Notes |
|---|---|---|
| `name` | string | falls back to directory name |
| `description` | string | **required-ish** — binary error: `is missing required 'description' in frontmatter`; loads with empty metadata if missing |
| `user-invocable` | boolean | default `true` (note kebab spelling, with **C**) |
| `allowed-tools` | string \| string[] | filter |
| `argument-hint` | string | shown in autocomplete |
| `arguments` | parsed list | argument names |
| `when_to_use` | string | natural-language trigger description |
| `version` | string | semver-ish |
| `model` | string | model alias or `'inherit'` |
| `disable-model-invocation` | boolean | hides skill from model but keeps it user-callable |
| `hooks` | object | validated against zod hook schema |
| `context` | `'fork'` | run in forked subagent |
| `agent` | string | agent type |
| `effort` | enum or int | reasoning effort |
| `shell` | string | bash/powershell |
| `paths` | string \| string[] | glob(s) for path-based auto-trigger |
| `created_by` / `improved_by` | string | provenance tag |

**⚠️ Studio gotcha:** Studio's existing skills use `user-invokable: true` (with **K**). The SDK reads `user-invocable` (with **C**). Default is `true` so the typo is invisible — but if any Studio skill ever needs `user-invocable: false`, it would silently fail.

### Skill invocation mechanism

- Skills appear in the system prompt as a listing.
- "Skill" is a **built-in tool of the Claude Code preset**, not something a plugin injects. Implicit when `tools: { type: 'preset', preset: 'claude_code' }` (Studio's setup, `agent.ts:142`).
- Invoked with `{ skill: '<name>' }` argument. Studio's `buildSkillInvocationPrompt(name)` returns the literal text "Run the /<name> skill using the Skill tool." — nudges the model in plain English.
- Skills can also be force-loaded via `Options.agents[<name>].skills: string[]` or `SDKControlInitializeRequest.skills: string[]`.

### Skill bundling its own MCP / commands

A skill is just a markdown file in a plugin's `skills/<name>/` directory; it can ship sibling assets (e.g. taxonomist's `scripts/*.php`). Skills do NOT have their own MCP-server slot — MCP servers live one level up at the plugin level (`.claude-plugin/plugin.json#mcpServers` or `.mcp.json`). Skills can refer to their own scripts via the runtime-exposed `Base directory for this skill: <skillRoot>` and use `allowed-tools` to whitelist `mcp__<server>__*` patterns.

## 4. MCP transport variants

| Variant | Type | Discriminator | Example |
|---|---|---|---|
| In-process SDK server | `McpSdkServerConfigWithInstance` | `type: 'sdk'` | `mcpServers: { studio: createSdkMcpServer({ name: 'studio', tools }) }` |
| Local stdio child process | `McpStdioServerConfig` | `type: 'stdio'` (optional) | `mcpServers: { fs: { command: 'node', args: ['./mcp-fs.js'], env: {...} } }` |
| Server-Sent Events | `McpSSEServerConfig` | `type: 'sse'` | `mcpServers: { remote: { type: 'sse', url: '...', headers, tools } }` |
| HTTP | `McpHttpServerConfig` | `type: 'http'` | `mcpServers: { api: { type: 'http', url: '...', headers, tools } }` |

(A fifth variant `McpClaudeAIProxyServerConfig` exists but is reserved for managed config.) `McpServerToolPolicy` (`sdk.d.ts:975-978`) lets remote-server configs declare per-tool default permissions.

## 5. Multi-plugin behavior

### Tool-name namespacing

MCP tools are exposed as **`mcp__<server-name>__<tool-name>`** (binary regex `"name":"mcp__([^"]+?)__([^"]+)"`; concrete examples: `mcp__playwright__*`, `mcp__slack__slack_read_thread`).

For plugin-bundled MCP servers: server name is namespaced at MCP-load time. **Exact rule (e.g. `<plugin>/<server>` vs `<server>`) is unverified** — the SDK Settings type uses `plugin-id@marketplace-id` as plugin identity (`sdk.d.ts:3884`); error messages reference `plugin@marketplace format`. Worth confirming during integration.

### Multiple plugins

`Options.plugins: SdkPluginConfig[]` accepts an array — multiple `type: 'local'` plugins can be loaded. Binary string evidence shows the SDK detects cross-source collisions (`has both plugin.json and marketplace manifest entries for ...`). Plugin-vs-plugin name collision behavior is not explicitly documented; needs verification.

### Merge order for MCP servers

Top-level config layering (from `PermissionUpdateDestination` at `sdk.d.ts:1767`):
- `userSettings` → `projectSettings` → `localSettings` → `policySettings` → `plugin` → `flagSettings` (passed to `query()`).

For MCP specifically: `enabledMcpjsonServers` / `disabledMcpjsonServers` (`sdk.d.ts:3617-3623`) gate `.mcp.json` (project) servers by name; `allowedMcpServers` / `deniedMcpServers` (`sdk.d.ts:3633-3667`) are an enterprise allowlist/denylist where **denylist wins**. In `query()`, `mcpServers` is the "flagSettings" layer and shallow-merges over file sources. **Conflict on the same key**: safe assumption based on shallow-merge is "host's `mcpServers` argument wins over plugin-declared servers of the same name" — but flag this as unverified.

## 6. Permissions interaction with `permissionMode: 'auto'`

Studio runs `permissionMode: 'auto'` (`agent.ts:143`). Each tool call builds an `SDKControlPermissionRequest` (`sdk.d.ts:2503-2523`); a small classifier model gives a per-call yes/no based on tool name/input. Can escalate (require confirmation) on `safetyCheck` (e.g. dangerous `rm`, sensitive paths). Compound bash commands evaluate each sub-command.

**Implication for a third-party plugin:** A plugin's tools (built-in `Bash`/`Read`/`Write`/`Edit` it inherits, or its own `mcp__<server>__<tool>` entries) go through the same auto classifier. **There is no per-plugin permission scope: loading a plugin grants its skills/agents access to whatever tool list is in effect for the session.** Plugins can self-restrict via:
- Skill-level `allowed-tools` frontmatter
- `AgentDefinition.tools` / `disallowedTools` if the plugin ships a sub-agent (`sdk.d.ts:44-50`)
- `McpServerToolPolicy.permission_policy: 'always_allow' | 'always_ask' | 'always_deny'` for HTTP/SSE entries

There is **no host-side mechanism to restrict a plugin to "only its own tools"** other than baking `disallowedTools` into the plugin's agents, or using `canUseTool` callback (`sdk.d.ts:1142-1145`). Studio currently uses neither.

Auxiliary settings:
- `disableSkillShellExecution` (`sdk.d.ts:3833-3835`) — managed setting that replaces inline `!`-shell blocks.
- `strictPluginOnlyCustomization` (`sdk.d.ts:3863`) — managed setting that *blocks* user/project skills/hooks/MCP and forces customizations to come only from approved plugins.

## 7. Compatibility risks against Studio's pinned 0.2.117

Studio pins `@anthropic-ai/claude-agent-sdk@^0.2.117` (caret = `0.2.x` minor range).

1. **`type: 'local'` is the only `Options.plugins` variant.** If DLA expects to be loaded by name (`{ type: 'npm', package: '...' }`) at the SDK API layer, won't work. Marketplace/npm/git plugins flow through user/project `settings.json#enabledPlugins`, not the SDK options.

2. **`PermissionMode: 'auto'` exists in 0.2.117** but DLA's plugin or skills can't override the host's session `permissionMode` from inside; only `acceptEdits`/`plan` etc. can be set per-subagent (`AgentDefinition.permissionMode`).

3. **Manifest cross-source conflict gate** — binary string: `has both plugin.json and marketplace manifest entries for commands/agents/skills/hooks/outputStyles. This is a conflict.` If DLA ships with both `plugin.json#skills` (declarative listing) and a `skills/` directory, behavior depends on `strict: true` flag.

4. **Skill frontmatter spelling:** parser reads `user-invocable`. Studio's skills use `user-invokable`. DLA should use `user-invocable` to be safe.

5. **In-process MCP (`type: 'sdk'`)** requires the host to construct the server with `createSdkMcpServer` from the *same* SDK version. `McpSdkServerConfigWithInstance.instance` is a live object referencing `@modelcontextprotocol/sdk/server/mcp.js`. **If DLA depends on a different SDK version and exports a pre-built `McpSdkServerConfigWithInstance`, DO NOT pass it to Studio's `query()`.** Stdio/HTTP/SSE transports are immune to this because they don't share an in-process object graph.

6. **Plugin reload is opt-in, not file-watched** — Studio doesn't call `reloadPlugins()`. A user who installs/updates DLA mid-session won't see changes until next `studio code` invocation.

## Sources

- `node_modules/@anthropic-ai/claude-agent-sdk/package.json` (lines 4, 30-32, 50-66, 81)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (lines as cited inline)
- `node_modules/@anthropic-ai/claude-agent-sdk/bridge.d.ts`, `manifest.json`
- `node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude` (Mach-O binary; relevant strings extracted)
- `apps/cli/ai/agent.ts:3, 80-84, 130-153`
- `apps/cli/ai/plugin/.claude-plugin/plugin.json` (full)
- `apps/cli/ai/plugin/skills/annotate/SKILL.md:1-5` (production frontmatter with `user-invokable` typo)
- `tools/common/ai/slash-commands.ts:1-17`

**Not consulted (denied in sandbox):** `docs.claude.com/en/docs/claude-code/{plugins-reference,skills,skills-reference,sdk/sdk-mcp}` and the SDK GitHub repo's CHANGELOG. Items marked "needs verification" should be confirmed there before relying on them.
