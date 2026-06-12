---
task: wave-1-pi-extensibility-surface
wave: 1
status: complete
---

# Wave 1 — pi-coding-agent extensibility surface

## TL;DR

- Studio's `createAgentSession({ customTools, tools, sessionStartEvent, resourceLoader, … })` call exposes the **full** session creation contract; `createAgentSessionFromServices`/`createAgentSessionRuntime` add **no new tool/extension hooks** — they are runtime/cwd-rebinding helpers that ultimately delegate to `createAgentSession`.
- pi has a real, programmatic **inline extension API** reachable from `createAgentSession`: `new DefaultResourceLoader({ extensionFactories: [...] })`. This is the *only* documented seam that gives Studio access to `tool_call` (block/mutate args), `tool_result` (override content/details/isError), `before_agent_start` (rewrite system prompt for one turn), `pi.registerCommand` (named slash commands routed through `session.prompt('/name …')`), `pi.registerTool` (dynamic LLM-callable tools), and the rest of the `ExtensionAPI` event family.
- `beforeToolCall`/`afterToolCall` on `AgentLoopConfig` exist on agent-core — but pi's `AgentSession` **already claims them in its constructor** (`_installAgentToolHooks`) and proxies them into the extension runner's `tool_call`/`tool_result` handlers. The hooks are not exposed independently on `createAgentSession` and are not on the `Agent` instance anywhere a Studio host can reach. The realistic Studio permission-gate seam is therefore an **inline extension factory** that registers a `tool_call` handler returning `{ block: true, reason }`.
- pi 0.70.2 has **zero MCP support** — no client, no server, no transport, no roadmap entry in the bundled CHANGELOG. Concretely: `grep -rn "[Mm]cp\b\|MCP\b\|ModelContextProtocol\|modelcontextprotocol"` against `node_modules/@mariozechner/pi-coding-agent/dist/` and `node_modules/@mariozechner/pi-agent-core/dist/` matches **nothing** outside vendored syntax-highlight tables (`export-html/vendor/highlight.min.js`).
- The five `noExtensions / noSkills / noPromptTemplates / noThemes / noContextFiles` flags on `DefaultResourceLoader` only suppress **filesystem discovery**. `extensionFactories: []` is *always* loaded — `noExtensions: true` does not gate inline factories. Studio is free to inject inline extensions today without flipping any of these toggles.
- 0.70.2 is **three minor versions behind** npm latest (0.73.1). Every minor release in 2026 ships a "Breaking Changes" section. The extension API is comparatively settled (last reshape was the `beforeToolCall`/`afterToolCall` migration at 0.59.0-ish per CHANGELOG line 873), but anything Studio leans on should be treated as semver-loose.

---

## 1. Extensibility map (public API)

`createAgentSession(options: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>` — declared in `node_modules/@mariozechner/pi-coding-agent/dist/core/sdk.d.ts:11-106`, implemented in `node_modules/@mariozechner/pi-coding-agent/dist/core/sdk.js:75-270`.

| Option | Type (verbatim from `sdk.d.ts`) | What it accepts / what it gives you |
|---|---|---|
| `cwd` | `string` | Project root for project-local discovery (skills, AGENTS.md). Studio passes `STUDIO_SITES_ROOT`. |
| `agentDir` | `string` | Global config dir. Studio also points this at `STUDIO_SITES_ROOT`. |
| `authStorage` | `AuthStorage` | Stores per-provider OAuth/API-key credentials. Studio uses `AuthStorage.inMemory()` (`apps/cli/ai/runtimes/pi/index.ts:327`). |
| `modelRegistry` | `ModelRegistry` | Lets you register providers (with `streamSimple`, OAuth, custom models). Studio registers a synthetic wpcom provider on this (`apps/cli/ai/runtimes/pi/index.ts:330-334`). |
| `model` | `Model<any>` | The active model for the session. |
| `thinkingLevel` | `ThinkingLevel` | `"off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh"`. |
| `scopedModels` | `Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>` | Cycle list for Ctrl+P. Studio passes nothing — only relevant in interactive mode. |
| `noTools` | `"all" \| "builtin"` | `"all"`: start with empty allowlist; `"builtin"`: drop pi's `read/bash/edit/write` but keep extension/custom tools. Per CHANGELOG 0.70.0, this option's semantics changed; the version Studio ships is post-fix. |
| `tools` | `string[]` | Explicit allowlist of tool names. Anything not in this set is hidden from the model. Studio passes `toolDefinitions.map(t => t.name)`. |
| `customTools` | `ToolDefinition[]` | The primary tool-injection seam. Each `ToolDefinition` declares `name`, `label`, `description`, `parameters` (TypeBox), optional `promptSnippet`/`promptGuidelines`, `prepareArguments`, `executionMode` (`"sequential" \| "parallel"`), and `execute(toolCallId, params, signal, onUpdate, ctx)`. Full shape in `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:323-354`. |
| `resourceLoader` | `ResourceLoader` | Optional override. When omitted, pi uses `new DefaultResourceLoader({ cwd, agentDir, settingsManager })` (`sdk.js:87`). Studio constructs its own `DefaultResourceLoader` with `noExtensions/noSkills/noPromptTemplates/noThemes/noContextFiles: true` and a precomputed `systemPrompt` string (`apps/cli/ai/runtimes/pi/index.ts:256-267`). |
| `sessionManager` | `SessionManager` | Persistence layer for messages/branch summaries. Studio passes its own `SessionManager` from `cli/ai/types`. |
| `settingsManager` | `SettingsManager` | Reads `defaultThinkingLevel`, compaction settings, image policies, transport, etc. Studio uses `SettingsManager.inMemory({ defaultThinkingLevel: 'high', compaction: { … } })`. |
| `sessionStartEvent` | `SessionStartEvent` | `{ type: "session_start"; reason: "startup" \| "reload" \| "new" \| "resume" \| "fork"; previousSessionFile?: string }`. Forwarded to extensions on bind. Studio sends `{ type: 'session_start', reason: 'startup' }`. |

**Hooks NOT surfaced on `createAgentSession`:**

- No `beforeToolCall`/`afterToolCall` parameter. (Pi's own `AgentSession._installAgentToolHooks` at `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:171-216` claims those agent-core hooks for itself.)
- No `plugins` / `mcpServers` / `canUseTool` parameter (these existed on `claude-agent-sdk` but **do not exist** in pi).
- No `extensions: ExtensionFactory[]` parameter directly on `CreateAgentSessionOptions`. The seam is one level deeper: `resourceLoader: new DefaultResourceLoader({ extensionFactories: [...] })`. See section 2.
- No `streamFn`/`convertToLlm`/`onPayload`/`transformContext` parameter. These exist on the `Agent` constructor but `createAgentSession` constructs the `Agent` itself with a fixed wiring (`sdk.js:179-235`). Replacing them would require not using `createAgentSession` at all (i.e., constructing `Agent` + `AgentSession` directly, which means owning their stability contract).

**`CreateAgentSessionResult`** (`sdk.d.ts:57-64`):

```ts
export interface CreateAgentSessionResult {
    session: AgentSession;
    extensionsResult: LoadExtensionsResult;
    modelFallbackMessage?: string;
}
```

Studio currently discards `extensionsResult`. That's the handle to `runtime.flagValues`, `errors`, and the loaded `Extension[]` — useful for diagnostics if Studio starts injecting extensions.

---

## 2. Extensibility map (lower-level)

### `createAgentSessionRuntime` / `AgentSessionRuntime`

Declared in `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session-runtime.d.ts:43-115`.

```ts
export declare function createAgentSessionRuntime(
    createRuntime: CreateAgentSessionRuntimeFactory,
    options: { cwd: string; agentDir: string; sessionManager: SessionManager; sessionStartEvent?: SessionStartEvent; }
): Promise<AgentSessionRuntime>;
```

`AgentSessionRuntime` wraps a session and exposes `switchSession()`, `newSession()`, `fork()`, `importFromJsonl()`, plus `setRebindSession()` and `setBeforeSessionInvalidate()` hooks. **None of these add tool-extension or permission-hook surfaces**; they are concerned with rebinding services when the user switches/forks a session in interactive mode. The factory callback gets to recreate cwd-bound services on each switch, and that's the only added power.

Studio runs one-shot RPC turns and recreates the session each turn (`apps/cli/ai/runtimes/pi/index.ts:204-227`), so `AgentSessionRuntime` is not buying anything we need.

### `createAgentSessionFromServices` / `createAgentSessionServices`

Declared in `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session-services.d.ts:28-85`. The split decouples "build services" from "create session".

- `createAgentSessionServices(options: CreateAgentSessionServicesOptions): Promise<AgentSessionServices>` — builds `{ cwd, agentDir, authStorage, settingsManager, modelRegistry, resourceLoader, diagnostics }`. Accepts `resourceLoaderOptions: Omit<DefaultResourceLoaderOptions, "cwd" | "agentDir" | "settingsManager">` — so you reach `extensionFactories`, the `*Override` callbacks, and the `no*` toggles here.
- `createAgentSessionFromServices(options: CreateAgentSessionFromServicesOptions): Promise<CreateAgentSessionResult>` — implementation (`agent-session-services.js:99-116`) just delegates to `createAgentSession(...)` and forwards the prepared services. **No additional hooks.**

```ts
// agent-session-services.js:99-116 (verbatim)
export async function createAgentSessionFromServices(options) {
    return createAgentSession({
        cwd: options.services.cwd,
        agentDir: options.services.agentDir,
        authStorage: options.services.authStorage,
        settingsManager: options.services.settingsManager,
        modelRegistry: options.services.modelRegistry,
        resourceLoader: options.services.resourceLoader,
        sessionManager: options.sessionManager,
        model: options.model,
        thinkingLevel: options.thinkingLevel,
        scopedModels: options.scopedModels,
        tools: options.tools,
        noTools: options.noTools,
        customTools: options.customTools,
        sessionStartEvent: options.sessionStartEvent,
    });
}
```

**Verdict:** the lower-level entry points add **session-switching** mechanics, not tool/extension power. The only Studio-relevant route to deeper hooks is through `DefaultResourceLoader` and its `extensionFactories` option — and that's already reachable from the public `createAgentSession({ resourceLoader: new DefaultResourceLoader({ extensionFactories: […] }) })` path Studio uses today.

### `DefaultResourceLoader` (the actual lower-level seam)

Declared in `node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.d.ts:56-108`. The options matter:

| Option | Type | Studio currently | What it does |
|---|---|---|---|
| `additionalExtensionPaths` | `string[]` | unset | Append filesystem extension paths to the discovered set. |
| `additionalSkillPaths` | `string[]` | unset | Append filesystem skill dirs. |
| `additionalPromptTemplatePaths` | `string[]` | unset | Same for prompt templates. |
| `additionalThemePaths` | `string[]` | unset | Same for themes. |
| **`extensionFactories`** | **`ExtensionFactory[]`** | **unset** | **Inline extension factories that are loaded unconditionally, even when `noExtensions: true`.** Each factory is `(pi: ExtensionAPI) => void \| Promise<void>` and gets the full ExtensionAPI surface (Section 3). See `resource-loader.js:272-278`. |
| `noExtensions` | `boolean` | `true` | Suppress filesystem-discovered extensions — NOT inline factories. |
| `noSkills` | `boolean` | `true` | Suppress filesystem skill discovery (`apps/cli/ai/skills/...` is Studio's own; pi's loader is bypassed). |
| `noPromptTemplates` | `boolean` | `true` | Suppress `.pi/prompts/` discovery. |
| `noThemes` | `boolean` | `true` | Suppress theme discovery (Studio renders its own UI). |
| `noContextFiles` | `boolean` | `true` | Suppress AGENTS.md/CLAUDE.md discovery. Filenames hard-coded at `resource-loader.js:31`: `const candidates = ["AGENTS.md", "CLAUDE.md"];` — `GEMINI.md` is **not** discovered automatically. |
| `systemPrompt` | `string` | preassembled Studio prompt | Replaces pi's default system prompt entirely. See `system-prompt.js:19-41` for the `customPrompt`-branch behavior. |
| `appendSystemPrompt` | `string[]` | unset | Joined with `\n\n` and appended to the (custom or default) prompt. |
| `extensionsOverride` / `skillsOverride` / `promptsOverride` / `themesOverride` / `agentsFilesOverride` / `systemPromptOverride` / `appendSystemPromptOverride` | callbacks | unset | Post-load transforms. `agentsFilesOverride` is a clean seam for synthesizing AGENTS.md content into the prompt without writing files. |

**`extensionFactories` is the load-bearing finding.** It's the programmatic way to register `tool_call`/`tool_result`/`before_agent_start`/`registerTool`/`registerCommand` from inside Studio's process — no filesystem extension required.

---

## 3. Hook inventory

`AgentLoopConfig` on agent-core (`node_modules/@mariozechner/pi-agent-core/dist/types.d.ts:84-197`) declares the low-level hooks:

```ts
beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
```

with `BeforeToolCallResult = { block?: boolean; reason?: string }` (line 32-35) and `AfterToolCallResult = { content?, details?, isError?, terminate? }` (line 48-57).

The block path is wired in `node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js:333-347`:

```js
if (config.beforeToolCall) {
    const beforeResult = await config.beforeToolCall({ assistantMessage, toolCall, args: validatedArgs, context: currentContext }, signal);
    if (beforeResult?.block) {
        return { kind: "immediate", result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"), isError: true };
    }
}
```

These are **claimed by pi's `AgentSession` in its constructor**, verbatim from `agent-session.js:171-216`:

```js
_installAgentToolHooks() {
    this.agent.beforeToolCall = async ({ toolCall, args }) => {
        const runner = this._extensionRunner;
        if (!runner.hasHandlers("tool_call")) { return undefined; }
        await this._agentEventQueue;
        try {
            return await runner.emitToolCall({ type: "tool_call", toolName: toolCall.name, toolCallId: toolCall.id, input: args });
        } catch (err) { … }
    };
    this.agent.afterToolCall = async ({ toolCall, args, result, isError }) => {
        const runner = this._extensionRunner;
        if (!runner.hasHandlers("tool_result")) { return undefined; }
        const hookResult = await runner.emitToolResult({ type: "tool_result", toolName: toolCall.name, toolCallId: toolCall.id, input: args, content: result.content, details: result.details, isError });
        if (!hookResult) { return undefined; }
        return { content: hookResult.content, details: hookResult.details, isError: hookResult.isError ?? isError };
    };
}
```

So `beforeToolCall`/`afterToolCall` are **structurally unreachable** as direct parameters on `createAgentSession` or anywhere else in the public API. The pi-blessed substitute is the extension event surface, which `AgentSession` proxies through `_installAgentToolHooks`.

### Reachable hooks via inline `extensionFactories`

The `ExtensionAPI` (`node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:768-921`) exposes:

| Event / API | Signature | Permission-gate? |
|---|---|---|
| `pi.on("tool_call", handler)` | `ExtensionHandler<ToolCallEvent, ToolCallEventResult>` — return `{ block: true, reason }` to refuse; mutate `event.input` to patch args (no re-validation). | **Yes — primary permission gate.** Goes through `runner.emitToolCall` → `AgentSession.beforeToolCall` → agent-core `block`. |
| `pi.on("tool_result", handler)` | `ExtensionHandler<ToolResultEvent, ToolResultEventResult>` — replace `content` / `details` / `isError`. | Post-execution mutation. Useful for redaction. |
| `pi.on("before_agent_start", handler)` | Returns `{ message?, systemPrompt? }` — `systemPrompt` chains across handlers and is applied for this turn only. | Per-turn prompt rewrite. Closest pi has to dynamic prompt injection. |
| `pi.on("agent_start" / "agent_end" / "turn_start" / "turn_end" / "message_start" / "message_update" / "message_end")` | Read-only telemetry events. | Observability. |
| `pi.on("tool_execution_start" / "_update" / "_end")` | Read-only; emitted by `Agent`, not by the extension `tool_call` proxy. | Observability — separate stream from `tool_call`/`tool_result`. |
| `pi.on("session_start" / "session_shutdown" / "session_before_*")` | Lifecycle events. `session_before_switch/fork/compact/tree` accept a `{ cancel: true }` return to veto. | Session lifecycle, not relevant to per-tool gating. |
| `pi.on("input", handler)` | Returns `{ action: "continue" \| "transform" \| "handled" }`. Intercepts user prompt before agent processing. | **Reachable** when `source` is `"interactive"`, `"rpc"`, or `"extension"`. Studio sets `source: 'rpc'` (`apps/cli/ai/runtimes/pi/index.ts:217`). |
| `pi.on("resources_discover", handler)` | Returns `{ skillPaths?, promptPaths?, themePaths? }`. Lets an extension inject paths into the loader at session start. | Resource injection at runtime. |
| `pi.registerTool(tool: ToolDefinition)` | Registers an LLM-callable tool with full `ToolDefinition` shape (same as `customTools`). | **Alternative tool-injection seam.** Equivalent power to `customTools` but lives inside the extension. |
| `pi.registerCommand(name, options)` | Registers a slash command. Routed by `AgentSession.prompt()` when `text.startsWith('/')` and the name matches (`agent-session.js:681-688`). | **Reachable from RPC** because `prompt('/migrate …', { source: 'rpc' })` still flows through `_tryExecuteExtensionCommand`. Studio's CLI loop currently consumes slashes *before* calling `runAgentTurn`, so the pi-side `/migrate` would never fire unless Studio's slash dispatcher forwards to `agent.prompt('/migrate …')` instead of intercepting. See section 4. |
| `pi.registerProvider(name, config: ProviderConfig)` / `pi.unregisterProvider(name)` | Add/replace LLM providers (incl. OAuth, custom `streamSimple`). | Studio already does this via `ModelRegistry.registerProvider` directly — alternative path. |
| `pi.registerMessageRenderer(customType, renderer)` | Interactive-mode TUI hook. | Irrelevant — Studio renders its own UI. |
| `pi.registerShortcut(keyId, options)` / `pi.registerFlag(name, options)` | Interactive-only. | Irrelevant for headless. |
| `pi.sendMessage` / `pi.sendUserMessage` / `pi.appendEntry` | Push messages/entries into the session from inside the extension. | Useful for the migrate tool to emit progress as `CustomMessage`s. |
| `pi.exec(command, args, options)` | Run shell commands with abort support. | Useful for the bridge if it spawns DLA. |
| `pi.events` | `EventBus` for inter-extension messaging. | Irrelevant for single-tenant Studio extension. |

**Verdict on permission policy:** Studio can implement per-tool permission buckets today by registering one inline extension factory that subscribes to `tool_call` and returns `{ block: true, reason }` from a Studio-side policy function. No fork, no upstream PR, no agent-core direct access required. Mechanically equivalent to what `canUseTool` was in `claude-agent-sdk`.

---

## 4. Slash-commands & skills mechanism

### What pi ships natively

- `BUILTIN_SLASH_COMMANDS` (`node_modules/@mariozechner/pi-coding-agent/dist/core/slash-commands.js:1-25`): `/settings`, `/model`, `/scoped-models`, `/export`, `/import`, `/share`, `/copy`, `/name`, `/session`, `/changelog`, `/hotkeys`, `/fork`, `/clone`, `/tree`, `/login`, `/logout`, `/new`, `/compact`, `/resume`, `/reload`, `/quit`. **Interactive mode only** — handled by `InteractiveMode`, not `AgentSession`.
- `pi.registerCommand(name, { handler, description, getArgumentCompletions })` lets extensions add commands. These are routed by `AgentSession.prompt()` at `agent-session.js:679-688`: if `text` starts with `/` and matches a registered command, the handler runs immediately and the prompt is consumed — no LLM call.
- File-based prompt templates (`.pi/prompts/<name>.md`) expand via `expandPromptTemplate()` in `prompt()` at `agent-session.js:706-707` when `expandPromptTemplates: true`. Studio explicitly passes `expandPromptTemplates: false` (`apps/cli/ai/runtimes/pi/index.ts:217`), so template expansion is off.
- Skill expansion (`/skill:name args`) handled by `_expandSkillCommand` (`agent-session.js:706`). Skills come from `resourceLoader.getSkills()`. With `noSkills: true` Studio receives an empty list and pi's skill expansion never fires.

### What Studio currently overrides

- **Slash commands**: Studio's REPL dispatches slashes in `apps/cli/commands/ai/index.ts:602-625` by matching against `getActiveSlashCommands()` from `apps/cli/ai/slash-commands.ts:71`. Built-in commands (`/browser`, `/clear`, `/model`, `/provider`, `/login`, `/preview`, `/remote-session`, `/swag`, `/exit`, `/api-key`, `/logout`) have handlers; skill commands from `tools/common/ai/slash-commands.ts` are handler-less and the loop falls through to `runAgentTurn(buildSkillInvocationPrompt(cmd.name))` (`apps/cli/commands/ai/index.ts:619`), which produces the literal prompt `Run the /${name} skill using the Skill tool.`. Slashes pi doesn't know about never reach `agent.prompt()`.
- **Skills**: Studio loads `apps/cli/ai/skills/<name>/SKILL.md` files in `apps/cli/ai/skills.ts:27-51` and surfaces them through a Studio-owned `Skill` tool (`apps/cli/ai/tools/skill.ts:9-32`). The tool's parameters list every discovered skill name as a `Type.Enum` and returns the SKILL body as a text content block. **Pi's own skill loader is bypassed** via `noSkills: true`.

### Why Studio overrode pi's surfaces

Three reasons, gleaned from the runtime wiring and prior-art:

1. **Skill UX**: Studio's skills are AI-callable workflows (e.g. `annotate`, `taxonomist`, `need-for-speed`, `rank-me-up`). They run via a tool call, not a slash expansion, so the agent can decide *when* to load them mid-turn. Pi's `_expandSkillCommand` only fires when the user types `/skill:name`, which doesn't fit the "Run the /X skill using the Skill tool" pattern.
2. **Slash UI control**: Studio renders its own UI (`AiChatUI`), so it needs slashes to flow through *its* dispatcher (for `askUser`, browser opens, daemon control, error formatting). Letting pi handle `/login` would route around `runLoginCommand` and Studio's auth model.
3. **Bundled skills**: Skill content ships inside Studio's bundle (`apps/cli/ai/skills/**`), not the user's home dir. Pi's loader expects `.pi/skills/` and similar — Studio's bundled paths don't fit pi's discovery model.

### Integration seams for `/migrate`

The smallest change that lights up `/migrate` follows the existing `AI_SKILL_COMMANDS` registry pattern:

1. **Add the command** to `tools/common/ai/slash-commands.ts:8-13` — `{ name: 'migrate', description: __('Migrate a site into Studio') }`.
2. **Ship the wrapper-skill body** at `apps/cli/ai/skills/migrate-site/SKILL.md` so `loadSkills()` discovers it and the existing `Skill` tool exposes `migrate-site` as a valid `name` enum value. The wrapper-skill body from `prior-art/rsm-3139-spec.md` is reusable as-is — `buildSkillInvocationPrompt` produces `Run the /migrate skill using the Skill tool.` and the LLM resolves that to a `Skill({ name: 'migrate-site' })` call.
3. **Inject DLA tools** as `customTools` on `createAgentSession` (the same array Studio passes today for `Read`/`Write`/`Edit`/etc). Each `ToolDefinition` would wrap the DLA-side handler (MCP bridge, vendored function, or subprocess — wave-1 briefs 2-4 settle the bridge mechanics).
4. **Permission gating** (per RSM-3139's policy buckets) lands as an inline `extensionFactories: [createPolicyExtension()]` on the same `DefaultResourceLoader` instance, using `pi.on('tool_call', ...)` to return `{ block: true, reason }` from a Studio-side policy.

Notably, `pi.registerCommand('migrate', { handler })` is **also** reachable from an inline extension, but it would not fire because Studio's REPL intercepts `/migrate` before calling `agent.prompt('/migrate')`. To use pi's native command routing instead, Studio would have to forward unmatched slashes to `agent.prompt(text, { source: 'rpc' })`. The existing `AI_SKILL_COMMANDS` registry route is mechanically smaller and keeps slash-command UX consistent with the rest of Studio's commands.

---

## 5. MCP support

**Confirmed: no MCP surface in pi 0.70.2.** Search command:

```bash
grep -rn "[Mm]cp\b\|MCP\b\|ModelContextProtocol\|modelcontextprotocol" \
    node_modules/@mariozechner/pi-coding-agent/dist/ \
    node_modules/@mariozechner/pi-agent-core/dist/ \
    node_modules/@mariozechner/pi-ai/dist/ \
    node_modules/@mariozechner/pi-tui/dist/ \
  | grep -v "export-html/vendor\|highlight\|.js.map\|.d.ts.map"
```

returns **zero matches**. The only superficial hits on a broader pattern (`[mM][cC][pP]`) come from `dist/core/export-html/vendor/highlight.min.js:444,483` — these are vendored C++ syntax-highlight token tables that include `make_pair`/`memcpy`/etc., not MCP code.

The bundled `CHANGELOG.md` (1700+ lines, covering 0.49 → 0.70.2) contains **no MCP mentions**. pi-coding-agent has no `mcpServers` option, no `McpServer` type, no MCP transport, no MCP client/server. There is no roadmap signal in the changelog either way — the absence is total.

Implication: any MCP-stdio-to-`AgentTool` bridge is **Studio-owned plumbing** and must live entirely in `apps/cli/`. There is no upstream slot to fit it into.

Note also that `apps/cli/ai/mcp-server.ts` is Studio **exposing** its tools as an MCP server (for external clients to call), not Studio **consuming** an MCP server. It's unrelated.

---

## 6. Suppressed surfaces

`DefaultResourceLoader` flags Studio currently sets to `true` (`apps/cli/ai/runtimes/pi/index.ts:260-264`) and what each suppresses:

| Flag | Currently | Suppresses | Effect on prompt / runtime | Toggle if we want… |
|---|---|---|---|---|
| `noExtensions` | `true` | Filesystem extension discovery (CLI `--extension` paths, `additionalExtensionPaths`, package-manager extensions, project `.pi/extensions/`). **Does not suppress `extensionFactories`.** | No third-party extensions get loaded from disk. | Stay `true`. Inline factories load regardless and that's all we want. |
| `noSkills` | `true` | Filesystem skill discovery from `~/.pi/skills/`, project `.pi/skills/`, and (when `noExtensions: false`) extension-bundled skills. | Pi's `_expandSkillCommand` finds nothing; the system prompt's skill section (`formatSkillsForPrompt`) is empty. | Stay `true`. Studio's skill model uses its own loader + `Skill` tool. Flipping this would surface pi's skills section in the prompt and `/skill:name` expansion — both redundant with Studio's wiring. |
| `noPromptTemplates` | `true` | `.pi/prompts/*.md` template discovery for `/template-name` expansion. | `expandPromptTemplate()` is a no-op. | Stay `true`. Studio passes `expandPromptTemplates: false` anyway. |
| `noThemes` | `true` | Theme discovery for the interactive TUI. | None — Studio doesn't use pi's TUI. | Stay `true`. Cosmetic only. |
| `noContextFiles` | `true` | Auto-discovery of `AGENTS.md` / `CLAUDE.md` walking up from `cwd` and from `agentDir`. Filenames hard-coded at `resource-loader.js:31`. | `loadProjectContextFiles` returns `[]`; pi's `buildSystemPrompt` skips the `# Project Context` section. | **Flip to `false`** if Studio wants pi to auto-discover an `AGENTS.md` placed at `STUDIO_SITES_ROOT/<site>/AGENTS.md`. Caveat: `GEMINI.md` is *not* in the candidate list, and DLA's `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` all carry the same wrapper content (per DLA inventory). The cleanest route to inject DLA's wrapper into the prompt is either (a) `systemPrompt` rewrite in Studio's `buildSystemPrompt`, or (b) `agentsFilesOverride: base => ([...base, { path: '<synthetic>', content: WRAPPER_SKILL_BODY }])`. |

**Where DLA content should land**:

- **Wrapper-skill body** (`migrate-site/SKILL.md` per `prior-art/rsm-3139-spec.md`): goes into Studio's bundled skills (`apps/cli/ai/skills/migrate-site/SKILL.md`) and reaches the LLM via the `Skill` tool — *not* via pi's system prompt. This is the established pattern.
- **AGENTS.md-style guidance** that should always be present: rewrite `buildSystemPrompt` in `apps/cli/ai/system-prompt.ts` to include a `## DLA / migration guidance` section. This is more reliable than `agentsFilesOverride` — it doesn't depend on a synthetic filename being acceptable to pi's prompt builder.
- **DLA tool-specific descriptions**: each migrate tool's `ToolDefinition.description` already feeds the model. Optionally add `promptSnippet` so the tool name appears in pi's "Available tools" list — but since Studio's `customPrompt` replaces pi's default prompt entirely (`system-prompt.js:19-41`), the snippet is currently unused. Adding it would require Studio's `buildSystemPrompt` to render an "Available tools" section itself if we want the snippets visible.

---

## 7. Versioning & churn risk

**Installed version:** `@mariozechner/pi-coding-agent@0.70.2` (`package.json`). Pinned via Studio's `package.json`.

**npm latest:** `0.73.1` (verified via `npm view @mariozechner/pi-coding-agent dist-tags`). 0.70.2 is **three minor versions behind** as of 2026-04-29.

**Stability signals:**

- Only one `@internal` marker in the `*.d.ts` files (`core/model-resolver.d.ts:37` — exported for testing). **No `@deprecated`, `@experimental`, `@beta`, `@alpha`, or `@unstable` annotations** anywhere we'd lean on.
- Every minor release in 2026 (0.65 → 0.70) ships a `Breaking Changes` section. From the bundled `CHANGELOG.md`:
  - **0.70.0** (2026-04-23): Disabled OSC 9;4 terminal progress by default; `--no-builtin-tools` / `createAgentSession({ noTools: "builtin" })` semantics were corrected.
  - **0.67.2** (2026-04-14): Added `extensionFactories` to `main()` (the seam we'd rely on). This is **recent** — anyone on < 0.67.2 doesn't have it.
  - Around 0.59-0.60-ish: extension tool interception migrated from wrapper-based to `beforeToolCall`/`afterToolCall` on agent-core (CHANGELOG line 873). The current `_installAgentToolHooks` model is the result of that migration; this is the relevant subsystem for Studio's permission gating.
  - 0.70.1: Added `retry.provider.{timeoutMs,maxRetries,maxRetryDelayMs}`.
  - 0.70.2: Bugfix for provider retry undefined-value forwarding (CHANGELOG.md lines 3-9).
- Repo: `git+https://github.com/badlogic/pi-mono.git` directory `packages/coding-agent` (verified via `npm view @mariozechner/pi-coding-agent@0.73.1 repository`).

**Load-bearing surfaces for Studio if we proceed with the inline-extension approach:**

| Surface | First introduced | Risk |
|---|---|---|
| `createAgentSession({ resourceLoader, customTools, tools, sessionStartEvent })` | 0.49.x onward | Low. Public SDK surface, kept stable across many minor releases. |
| `DefaultResourceLoader({ extensionFactories, systemPrompt, no* })` | `extensionFactories` at 0.67.2 (2026-04-14); `no*` flags older. | Low-medium. Recent addition; semantics could be tightened in future releases. |
| `ExtensionAPI.on("tool_call", h)` block/mutate | Post the wrapper→hook migration (~0.59-0.60). | Medium. The CHANGELOG documents two related fixes (0.70.x for `isError` forwarding, earlier for stale `sessionManager` state). Treat the contract as still maturing. |
| `ExtensionAPI.on("tool_result", h)` content/details/isError override | Same era. | Medium — recent regression fixed in 0.70.x (CHANGELOG.md:216). |
| `ExtensionAPI.registerTool(...)` | 0.49.x (predates split). | Low — stable. |
| `ExtensionAPI.registerCommand(...)` | 0.49.x. | Low. |
| `AgentSession.prompt(text, { expandPromptTemplates, source })` | Public from 0.49.x. | Low. |
| `AgentSession.subscribe / .abort / .dispose / .prompt` | Public. | Low. |

**Migration cost between 0.70.2 → 0.73.1**: not investigated here (out of scope — that's wave-1 brief 5's territory). Worth bookmarking: if Studio commits to `extensionFactories` + `tool_call` policy, the version-jump survey should validate those two surfaces specifically.

---

## Appendix — files audited

Primary:

- `apps/cli/ai/runtimes/pi/index.ts:1-488` — Studio's pi runtime; every imported pi symbol traced.
- `apps/cli/ai/slash-commands.ts:1-543` — Studio's slash-command dispatcher.
- `apps/cli/commands/ai/index.ts:600-633` — REPL dispatch loop showing `/skill` → `buildSkillInvocationPrompt` → `runAgentTurn`.
- `apps/cli/ai/skills.ts:1-56` — Studio skill loader.
- `apps/cli/ai/tools/skill.ts:1-32` — Studio `Skill` tool.
- `apps/cli/ai/tools/define-tool.ts:1-56` — `defineTool` adapter Studio wraps each AgentTool with.
- `apps/cli/ai/system-prompt.ts:1-50` — Studio's `buildSystemPrompt`.
- `tools/common/ai/slash-commands.ts:1-17` — `AI_SKILL_COMMANDS` + `buildSkillInvocationPrompt`.

Pi packages (every `.d.ts` audited):

- `node_modules/@mariozechner/pi-coding-agent/dist/index.d.ts:1-28` (top-level re-exports)
- `node_modules/@mariozechner/pi-coding-agent/dist/core/sdk.d.ts:1-107` (`createAgentSession`)
- `node_modules/@mariozechner/pi-coding-agent/dist/core/sdk.js:1-270` (implementation)
- `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.d.ts:1-592`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:160-216,625-660,1783-1912` (hook install, tool registry, runtime build)
- `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session-runtime.d.ts:1-117`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session-services.d.ts:1-86`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session-services.js:1-117`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/index.d.ts:1-12`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:1-1151` (full `ExtensionAPI`, all event types, `ToolDefinition`)
- `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.d.ts:1-25`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js:1-352`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/runner.d.ts:1-157`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/wrapper.d.ts:1-20`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.d.ts:1-194`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js:25-76,250-330,595-610`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/slash-commands.d.ts:1-14`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/slash-commands.js:1-25`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/source-info.d.ts:1-18`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/system-prompt.d.ts:1-28`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/system-prompt.js:1-120`
- `node_modules/@mariozechner/pi-agent-core/dist/index.d.ts:1-5`
- `node_modules/@mariozechner/pi-agent-core/dist/types.d.ts:1-347` (`AgentLoopConfig`, `beforeToolCall`/`afterToolCall`, `AgentTool`)
- `node_modules/@mariozechner/pi-agent-core/dist/agent.d.ts:1-117`
- `node_modules/@mariozechner/pi-agent-core/dist/agent-loop.d.ts:1-24`
- `node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js:328-362` (block path)
- `node_modules/@mariozechner/pi-coding-agent/CHANGELOG.md` (full file, ~1700 lines)

Commands run:

- `grep -rn "[Mm]cp\b\|MCP\b\|ModelContextProtocol\|modelcontextprotocol" node_modules/@mariozechner/pi-coding-agent/dist/ node_modules/@mariozechner/pi-agent-core/dist/ node_modules/@mariozechner/pi-ai/dist/ node_modules/@mariozechner/pi-tui/dist/` — zero matches outside vendored highlight tables.
- `grep -rn "@deprecated\|@experimental\|@internal\|@unstable\|@alpha\|@beta" node_modules/@mariozechner/pi-*/dist/` — one `@internal` in `core/model-resolver.d.ts:37`.
- `npm view @mariozechner/pi-coding-agent dist-tags --json` → `{ latest: '0.73.1' }`.
- `npm view @mariozechner/pi-coding-agent versions --json` → 0.70.2 is three minors behind (0.71.0, 0.71.1, 0.72.0, 0.72.1, 0.73.0, 0.73.1 released since).
