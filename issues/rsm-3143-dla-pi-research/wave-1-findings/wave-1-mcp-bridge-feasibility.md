---
task: wave-1-mcp-bridge-feasibility
wave: 1
status: complete
verdict: works-with-caveats
recommendation: acceptable
---

# Wave 1 — MCP-stdio-to-AgentTool bridge feasibility

## TL;DR

The bridge works mechanically. `@modelcontextprotocol/sdk@1.29.0` (Studio's installed version; brief mentioned 1.27.1) ships a fully-typed `Client` + `StdioClientTransport`, and pi's tool registration path accepts plain JSON Schema objects in `parameters` (no TypeBox metadata required) — so the JSON Schema → pi.AgentTool adapter is a thin wrapper, not a re-derivation. The integration touches a single splice point in `buildAgentTools` and a single new module tree under `apps/cli/ai/dla/`.

Three real caveats (not blockers): (1) DLA's MCP server does **not** honor `notifications/cancelled` — aborts orphan in-flight work server-side; (2) `npx tsx src/mcp-server.ts` adds a ~few-second cold start that Studio should swap for `node dist/mcp-server.js` (DLA already has a `build: tsc` script); (3) per-tool permission gating cannot be enforced via the public `createAgentSession()` API — it has no `beforeToolCall` hook (the hook exists at the lower `agent-loop.js` `config.beforeToolCall` layer; Brief 1 should confirm whether the lower-level `createAgentSessionFromServices` exposes it). Until that's resolved, gating is advisory: permission policy is encoded in the wrapper skill body + system prompt language, and the per-tool `execute` wrapper can do simple bucket-based throws-to-deny for the destructive ones.

One correction to the brief: it claims `liberate_inspect` and `liberate_diagnose` return `structuredContent`. They don't — DLA's `textResult()` helper at `src/mcp-server.ts:32-34` JSON-stringifies the entire structured payload into a single `{type:'text', text}` content block. `structuredContent` handling is not needed for the v1 bridge.

## 1. MCP SDK client API at installed version

**Version:** `@modelcontextprotocol/sdk@1.29.0` (`node_modules/@modelcontextprotocol/sdk/package.json:3`). The brief mentioned 1.27.1 from `package.json`'s `^1.27.1`, but the resolved lockfile picked up 1.29 — same client API (1.x semver compatibility), just newer minor.

**Imports:**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
```

Both are subpath exports (verified in `package.json`'s `"./client"` exports field).

**`StdioClientTransport`** (`dist/esm/client/stdio.d.ts:46-76`):

```ts
export type StdioServerParameters = {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    stderr?: IOType | Stream | number;  // default "inherit"
    cwd?: string;
};

export declare class StdioClientTransport implements Transport {
    constructor(server: StdioServerParameters);
    start(): Promise<void>;
    get stderr(): Stream | null;
    get pid(): number | null;
    close(): Promise<void>;
    send(message: JSONRPCMessage): Promise<void>;
}
```

The transport spawns the child process when `client.connect(transport)` is called (the `connect` method calls `transport.start()` internally — `dist/esm/client/index.d.ts:155`). `stderr` defaults to "inherit"; for an embedded bridge we want `stderr: 'pipe'` so we can capture warnings without polluting Studio's TUI.

**`Client`** (`dist/esm/client/index.d.ts:110-590`):

```ts
constructor(_clientInfo: Implementation, options?: ClientOptions);
connect(transport: Transport, options?: RequestOptions): Promise<void>;
listTools(params?: ListToolsRequest['params'], options?: RequestOptions): Promise<{
    tools: {
        inputSchema: { type: "object"; properties?: Record<string, object>; required?: string[]; [x: string]: unknown };
        name: string;
        description?: string;
        outputSchema?: { type: "object"; properties?: Record<string, object>; required?: string[]; [x: string]: unknown };
        annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
        // ... + execution, _meta, icons, title
    }[];
    nextCursor?: string;
}>;
callTool(params: CallToolRequest['params'], resultSchema?, options?: RequestOptions): Promise<{
    content: (TextContent | ImageContent | AudioContent | ResourceContent | ResourceLinkContent)[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    _meta?: { progressToken?, "io.modelcontextprotocol/related-task"? };
}>;
```

`CallToolRequest['params']` is `{name: string, arguments?: Record<string, unknown>}` — matches MCP `tools/call` spec.

**`RequestOptions`** (`dist/esm/shared/protocol.d.ts:61-98`):

```ts
export type RequestOptions = {
    onprogress?: ProgressCallback;
    signal?: AbortSignal;       // <-- this is the abort handle
    timeout?: number;           // default 60_000ms
    resetTimeoutOnProgress?: boolean;
    maxTotalTimeout?: number;
    task?: TaskCreationParams;
    relatedTask?: RelatedTaskMetadata;
} & TransportSendOptions;
```

When `signal` aborts, `Protocol.request` triggers a `notifications/cancelled` to the server and rejects the in-flight promise with an `AbortError`/`McpError` (`dist/esm/shared/protocol.js:709-710`: `options?.signal?.addEventListener('abort', () => cancel(...))`, and `notifications/cancelled` is sent at line 677). So forwarding pi's `AbortSignal` to `callTool` is the entire abort plumbing on the client side; whether the *server* honors it is a separate concern (see §4).

**Error semantics:**
- Transport-level failures (process crash, malformed JSON-RPC) reject the `callTool` promise with `McpError`.
- Tool-level errors set `isError: true` on the returned `CallToolResult` but resolve the promise normally — caller must check.
- Schema validation: with `jsonSchemaValidator` provided in `ClientOptions`, the SDK validates `structuredContent` against the tool's declared `outputSchema`. We don't need this for v1 (DLA doesn't declare `outputSchema`).

**No `request<T>` helper is required:** `client.callTool()` and `client.listTools()` are typed convenience wrappers; we don't need the lower-level `Protocol.request` API.

## 2. Tool wrapping shim

### Schema cast: JSON Schema → TSchema

This was the headline risk and it's safe. pi-ai's `validateToolArguments` (`node_modules/@mariozechner/pi-ai/dist/utils/validation.js:253-280`) explicitly handles plain JSON Schema:

```js
function hasTypeBoxMetadata(schema) {
    return isRecord(schema) && Object.getOwnPropertySymbols(schema).includes(TYPEBOX_KIND);
}

export function validateToolArguments(tool, toolCall) {
    const args = structuredClone(toolCall.arguments);
    Value.Convert(tool.parameters, args);
    const validator = getValidator(tool.parameters);   // Compile() from typebox/compile
    if (!hasTypeBoxMetadata(tool.parameters) && isJsonSchemaObject(tool.parameters)) {
        const coerced = coerceWithJsonSchema(args, tool.parameters);  // JSON-Schema-aware coercion path
        // ...
    }
    if (validator.Check(args)) return args;
    // throw with formatted errors
}
```

Two things matter:

1. `typebox`'s `Compile()` accepts plain JSON Schema objects (it doesn't require the `Symbol.for("TypeBox.Kind")` brand). The compiled validator runs against the raw schema.
2. There's an explicit `!hasTypeBoxMetadata(...) && isJsonSchemaObject(...)` branch that runs `coerceWithJsonSchema` — type coercion (string→number, etc.) tailored for plain JSON Schema, separate from `Value.Convert` (which is TypeBox's own coercer).

**Downstream pi-ai providers also take `tool.parameters` as JSON Schema, no transformation:**
- Anthropic (`anthropic.js:887-904`): pulls `schema.properties` and `schema.required` and passes them to Claude's `input_schema`.
- OpenAI Completions (`openai-completions.js:756`): `parameters: tool.parameters // TypeBox already generates JSON Schema`.
- Bedrock (`amazon-bedrock.js:599`): `inputSchema: { json: tool.parameters }`.
- Google (`google-shared.js:273-274`): two paths, both treat `tool.parameters` as JSON Schema.
- Mistral (`mistral.js:376`): `stripSymbolKeys(tool.parameters)`.

A remote MCP `inputSchema` (object with `type: 'object', properties, required`) **drops in unchanged** as pi's `parameters`. No conversion required.

The TypeScript cast is the only friction. `ToolDefinition.parameters` is typed `TParams extends TSchema` (`pi-coding-agent/dist/core/extensions/types.d.ts:323`), and a plain JSON-Schema object isn't a `TSchema`. We get away with the same pattern Studio's MCP *server* uses for the inverse direction (`apps/cli/ai/mcp-server.ts:27`):

```ts
inputSchema: tool.parameters as unknown as Record<string, unknown>
```

For the bridge, the cast is `inputSchema as unknown as TSchema`. Runtime behavior is correct (the compile/check/coerce path handles it); the cast just sidesteps TypeScript not knowing that.

### `prepareArguments`

We don't need it for remote tools. `prepareArguments` is for tools that want to massage raw model arguments **before** TypeBox validation (e.g. legacy aliases, splitting a combined field). MCP's `inputSchema` is the source of truth for what arguments look like; the model emits arguments shaped by that schema; we forward them as-is.

If a remote tool has known argument quirks we want to paper over, we can plug `prepareArguments` per-tool — but it's optional and we'll skip it in v1.

### Result adaptation: MCP `CallToolResult` → pi `AgentToolResult`

pi's `AgentToolResult<T>` (`pi-agent-core/dist/types.d.ts:259-269`):

```ts
export interface AgentToolResult<T> {
    content: (TextContent | ImageContent)[];
    details: T;
    terminate?: boolean;
}
```

MCP's `CallToolResult` (`mcp/sdk dist/esm/client/index.d.ts:431-512`):

```ts
{
    content: (TextContent | ImageContent | AudioContent | ResourceContent | ResourceLinkContent)[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    _meta?: {...};
}
```

Divergences:

| MCP | pi | Adaptation |
|---|---|---|
| `content` may include `audio`/`resource`/`resource_link` | only `text`/`image` | Filter: keep `text`/`image` as-is; flatten `resource` (text variant) into `text`; serialize `resource_link` to a `text` block with the URI/description; drop `audio` with a warning. |
| `isError: true` (resolved promise) | thrown error → pi's loop sets `isError: true` automatically | If `result.isError === true`, throw an `Error` with the first text content as the message. pi's `executePreparedToolCall` (`pi-agent-core/dist/agent-loop.js:378-384`) catches and produces the right `ToolResult`. |
| `structuredContent` | `details` | Map directly: `details = result.structuredContent ?? undefined`. (DLA doesn't actually emit `structuredContent` — see correction at top. But the adapter should still support it for forward-compat with other servers.) |
| `_meta` | — | Ignore for v1. Could surface `progressToken`/`task` later if we ever turn on long-running task support. |

The brief mentioned `structuredContent` as DLA's mechanism for `liberate_inspect`/`liberate_diagnose`. **This is incorrect.** DLA's `textResult()` (`data-liberation-agent/src/mcp-server.ts:32-34`) does:

```ts
function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
```

All DLA tool results are a single `text` content block containing JSON-stringified data. The MCP `structuredContent` field is unused. This simplifies the adapter — the model gets the JSON-as-text and parses it inline. If DLA ever migrates to `structuredContent`, the adapter handles it automatically via the `details` mapping.

### Concrete sketch — `liberate_detect` (simplest)

```ts
// apps/cli/ai/dla/agent-tool-adapter.ts
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { TSchema } from 'typebox';

interface RemoteMcpTool {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, object>; required?: string[]; [k: string]: unknown };
}

export function adaptRemoteTool(
  client: Client,
  remote: RemoteMcpTool,
  policy: PermissionPolicy,
): AgentTool {
  return {
    name: remote.name,
    label: remote.name,
    description: remote.description ?? '',
    parameters: remote.inputSchema as unknown as TSchema,  // see §2: safe at runtime
    execute: async (toolCallId, args, signal): Promise<AgentToolResult<Record<string, unknown> | undefined>> => {
      policy.assert(remote.name, args);  // throws on deny (see §5)
      const result = await client.callTool(
        { name: remote.name, arguments: args as Record<string, unknown> },
        undefined,  // default CallToolResultSchema
        { signal },
      );
      if (result.isError) {
        const errText = result.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text
          ?? `Remote tool ${remote.name} reported isError without a text payload`;
        throw new Error(errText);
      }
      return {
        content: result.content.flatMap(mcpContentToPiContent),
        details: result.structuredContent,  // undefined for DLA today
      };
    },
  };
}

function mcpContentToPiContent(c: { type: string; [k: string]: unknown }): ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] {
  if (c.type === 'text') return [{ type: 'text', text: c.text as string }];
  if (c.type === 'image') return [{ type: 'image', data: c.data as string, mimeType: c.mimeType as string }];
  if (c.type === 'resource' && (c as any).resource?.text) {
    return [{ type: 'text', text: `[resource ${(c as any).resource.uri}]\n${(c as any).resource.text}` }];
  }
  if (c.type === 'resource_link') {
    return [{ type: 'text', text: `[resource_link ${(c as any).uri}${(c as any).description ? ' — ' + (c as any).description : ''}]` }];
  }
  return [];  // drop audio + unknown types; could log a warning
}
```

**Round-trip for `liberate_detect`:**

1. ListTools returns `{name: 'liberate_detect', description: '...', inputSchema: {type: 'object', properties: {url: {type: 'string', description: 'The URL of the website to detect'}}, required: ['url']}}` (`data-liberation-agent/src/mcp-server.ts:50-60`).
2. Adapter wraps it. `parameters` is the JSON Schema object as-is.
3. Model emits `{tool_call: {name: 'liberate_detect', args: {url: 'https://example.com'}}}`.
4. pi's `validateToolArguments` calls `Compile(schema)` → validates → calls `execute`.
5. `execute` calls `client.callTool({name, arguments: {url}}, undefined, {signal})`.
6. Client sends MCP JSON-RPC `tools/call` over stdin to DLA child.
7. DLA returns `{content: [{type: 'text', text: '{"platform": "wix", "confidence": "high", ...}'}]}`.
8. Adapter returns `{content: [{type: 'text', text: '<JSON>'}], details: undefined}`.
9. pi delivers it to the model as a `toolResult` message.

### Concrete sketch — `liberate_inspect` (most "structured")

Same adapter; the only difference is that the JSON payload returned in the single text block is richer:

```jsonc
// DLA result (line 273-310 of data-liberation-agent/src/mcp-server.ts)
{
  content: [{
    type: 'text',
    text: `{
      "url": "...",
      "platform": "wix",
      "confidence": "high",
      "signals": [...],
      "sitemapFound": true,
      "urlCount": 142,
      "counts": {"page": 8, "post": 134},
      "probeResults": [...],
      "authRequired": false,
      "extractionFeasibility": "ready",
      "platformFeatures": {...}
    }`
  }]
}
```

The adapter is identical. The model parses the JSON-in-text and reasons about it. **No special-casing for `structuredContent` needed in v1**, because DLA doesn't emit it.

If DLA later moves to `structuredContent` (i.e. `return { content: [...], structuredContent: result }`), the adapter passes the structured object through `details` automatically. pi's `details` field is opaque from the model's perspective (used for UI rendering and post-call extensions) — the model still sees the `content` blocks. So a DLA migration to `structuredContent` would need them to *also* emit a useful text block, or pi-coding-agent would have to learn to surface `details` to the LLM. That's out of scope.

## 3. Lifecycle & startup latency

### Recommendation: per-CLI-process singleton, lazy-spawned, started during agent session setup, torn down on session dispose.

**Decision:** Spawn the DLA MCP child the **first time the agent session is constructed** (in `createStudioAgentSession`, after the tools are needed). Cache the spawned `{client, transport}` on the session lifetime. Tear down in the `finally` block that already calls `session.dispose()` at `apps/cli/ai/runtimes/pi/index.ts:222-225`.

```ts
// apps/cli/ai/runtimes/pi/index.ts (sketch of the diff)
async function runAgentSessionTurn(config, controller, setActiveSession) {
  // ...
  let session, unsubscribe, dlaBridge;
  try {
    dlaBridge = await maybeStartDlaBridge(config);   // <-- new; returns undefined if disabled
    session = await createStudioAgentSession(config, family, resolved.creds, dlaBridge);
    // ...
  } finally {
    unsubscribe?.();
    session?.dispose();
    await dlaBridge?.dispose();   // <-- new; closes MCP client + kills child
    setActiveSession(undefined);
  }
}
```

Why not per-CLI-process (long-lived across multiple turns)?

- Studio `code` runs in two modes: interactive (multiple turns) and one-shot. A per-process singleton would leak a Node child process for the duration of the CLI; for one-shot, it's wasted lifecycle; for interactive, gating by `/migrate` invocation is cleaner than spawning DLA on every CLI startup.
- Per-turn spawn is wasteful too (multiple DLA tool calls in one turn would re-pay the cold-start).
- Per-session is the middle ground — and the existing `dispose()` finally block makes teardown trivial.

Why not lazily-on-first-call (spawn DLA the first time the model invokes `liberate_*`)?

- The first call would block on `npx tsx`'s cold start (several seconds), looking like a model hang to the user.
- `ListTools` must run *before* we can register the tools with pi (we need their schemas to build `customTools`). So we have to spawn before session creation anyway.

If we want to make DLA opt-in (only spawn when `/migrate` is used), the cleanest gate is: register a placeholder `liberate_migrate` slash command that **first** spawns the bridge, **then** runs `buildSkillInvocationPrompt('migrate-site')`. That bumps the cold-start to the slash-command invocation rather than chat startup. See §7.

**`ListTools` failure / hang handling:**

- Wrap the bridge bring-up in `Promise.race` with a 10s timeout and `signal: AbortSignal.timeout(10_000)` to `listTools`.
- On failure: log a warning and start the session **without** DLA tools. The Skill body for `/migrate` already references DLA tools by name; if they're missing, the model should fail gracefully ("the migration tools didn't load — please check..."). The Skill could also include a `### Preflight` step that asks the model to check tool availability via `Skill` tool index introspection.
- Surfacing the warning into the TUI: easiest is a synthetic system message in the transcript before the session prompts. Alternatively, an extension event — but that's wave-2 territory.

### Startup latency

**Verdict: avoid `npx tsx` in production. Use `node dist/mcp-server.js`.**

DLA already has `"build": "tsc"` and points its `bin` at `./dist/cli.js` (`data-liberation-agent/package.json:6-23`). Studio's install path should:

1. Run `npm install` in DLA's directory (already covered by `package.json` dep resolution).
2. Run `npm run build` (or invoke `tsc` directly via the local `typescript` dep).
3. Spawn `node <dla>/dist/mcp-server.js` instead of `npx tsx src/mcp-server.ts`.

Numbers:
- The brief cites "few-second cold start" for `npx tsx`. I didn't re-time it — call this **needs re-verification** in Brief 5 (bundling) before locking in expectations.
- `node dist/mcp-server.js` cold start should be ~hundreds of ms (rough estimate from model knowledge of typical Node startup with a real MCP server's transitive import graph — not verified for DLA specifically; should be measured).

Distribution mechanics (subscribing the build step into Studio's `cli:build` pipeline) are Brief 5's problem. For this brief: **a built JS entry point is the right answer if it packages cleanly**; if not, `tsx` is acceptable with the latency hit documented.

### Lifecycle to tear down

`StdioClientTransport.close()` ([`stdio.d.ts:74`](node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.d.ts:74)) closes the streams; the child process exit follows from receiving EOF on stdin. Belt-and-braces: also send SIGTERM via the cached `pid` after a short grace period.

```ts
async dispose() {
  try {
    await this.client.close();  // calls transport.close()
  } finally {
    if (this.transport.pid) {
      setTimeout(() => { try { process.kill(this.transport.pid!, 'SIGKILL'); } catch {} }, 2000);
    }
  }
}
```

## 4. Abort propagation

**Wiring:** Forward pi's `AbortSignal` into `client.callTool`'s `RequestOptions.signal`. That's it on the client side.

```ts
execute: async (toolCallId, args, signal) =>
  client.callTool({ name: remote.name, arguments: args }, undefined, { signal })
```

Why this is sufficient on the **client** side:
- `Protocol.request` (`dist/esm/shared/protocol.js:677, 709-710`) registers `signal.addEventListener('abort', () => cancel(...))`.
- On abort, the SDK sends `notifications/cancelled` over JSON-RPC to the server with the in-flight request id.
- The promise rejects with `McpError(ConnectionClosed, 'Request was cancelled')` (line 334) or an `AbortError`-shaped error from the cleanup path.
- pi's `executePreparedToolCall` (`pi-agent-core/dist/agent-loop.js:378-384`) catches that and emits `isError: true` with the message.

**But:** DLA's MCP server does **not** wire `notifications/cancelled` into its tool handlers. A grep for `signal|aborted|cancelled` in `data-liberation-agent/src/mcp-server.ts` (line 279) returns only `detection.signals` (an unrelated field — platform-fingerprint signals like CSS classes). DLA's handlers run to completion regardless of the cancel notification.

**Implications:**
- The model sees a `cancelled` tool result promptly — good.
- The DLA child keeps working — bad. A cancelled `liberate_extract` will keep crawling. A cancelled `liberate_preview` will leave a `studio site create` running in a sub-spawn.
- Filesystem cleanup of half-finished extractions is DLA's resume-safe protocol (`extraction-log.jsonl`, `session.json` per `prior-art/wave-1-findings/wave-1-dla-inventory.md:195-198`). So restarting recovers.

**Mitigations to consider (not blocking):**
- Document: "Cancelling a DLA tool call surfaces the cancel to the model immediately but DLA continues server-side. If you Ctrl-C the session, the child is killed via `dispose()`."
- Wave-2 spike: upstream a fix to DLA to honor `signal`/`progressToken` in its handlers.

## 5. Permission gating without `canUseTool`

**Confirmed:** `CreateAgentSessionOptions` (`pi-coding-agent/dist/core/sdk.d.ts:11-55`) exposes no `beforeToolCall` hook. The hook **does exist** at the lower `agent-loop.js` layer (`pi-agent-core/dist/agent-loop.js:333-347`):

```js
if (config.beforeToolCall) {
    const beforeResult = await config.beforeToolCall({ assistantMessage, toolCall, args: validatedArgs, context: currentContext }, signal);
    if (beforeResult?.block) {
        return { kind: "immediate", result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"), isError: true };
    }
}
```

Whether `createAgentSessionFromServices` / `createAgentSessionRuntime` / the lower-level `AgentSessionServices` exposes a way to plumb a `beforeToolCall` config is **Brief 1's question**. This brief assumes no for purposes of recommendation; if Brief 1 finds a way through, the bridge should use it.

### Chosen approach: defense-in-depth, all three layers

1. **System-prompt language** (advisory). The system prompt should warn about destructive DLA tools (`liberate_extract` writes files; `liberate_import` writes to a live WP site).
2. **Wrapper-skill discipline** (advisory, primary). The `/migrate` skill body explicitly orders the tools and tells the model when to call `AskUserQuestion` before destructive steps. RSM-3139's skill body (per `prior-art/rsm-3139-spec.md`) already does this for `liberate_setup` / `liberate_import`.
3. **Adapter-layer policy check** (advisory, enforced). The adapter's `execute` runs `policy.assert(toolName, args)` first. For "destructive" buckets (`liberate_import`, `liberate_extract` with non-dry-run, `liberate_preview` writing to a Studio site) the policy can short-circuit to an `AskUserQuestion` invocation — but `AskUserQuestion` is itself a model-invoked tool, so the adapter can't *call* it. The cleanest in-adapter pattern is to throw with a deny-reason that includes the bucket name; the model will see the error and is instructed by the skill to ask the user.

The **cleanest** of these (single recommendation): keep gating in the **wrapper skill body** and have the **adapter throw on deny** for the worst tools. Skip "wrap each tool with an AskUserQuestion round-trip" — it bloats the adapter and the agent can call AskUserQuestion itself when instructed.

```ts
// apps/cli/ai/dla/policy.ts (sketch)
export type PermissionBucket = 'safe' | 'fs-write' | 'destructive';

export const DLA_TOOL_POLICY: Record<string, PermissionBucket> = {
  liberate_detect: 'safe',
  liberate_discover: 'safe',
  liberate_inspect: 'safe',
  liberate_status: 'safe',
  liberate_extract: 'fs-write',     // writes WXR + media
  liberate_qa: 'fs-write',          // may patch fixable issues
  liberate_verify: 'safe',
  liberate_setup: 'safe',           // delegate:true returns manifest only
  liberate_import: 'destructive',   // writes to WP — must be delegated to Studio
  liberate_preview: 'fs-write',     // spawns a Studio site
  liberate_preview_stop: 'safe',
  liberate_map_apis: 'safe',
  liberate_probe: 'safe',
};

export function createPolicy(opts: { allowDestructive: boolean }) {
  return {
    assert(name: string, args: unknown) {
      const bucket = DLA_TOOL_POLICY[name] ?? 'safe';
      if (bucket === 'destructive' && !opts.allowDestructive) {
        // RSM-3139 spec says: liberate_import MUST be invoked with delegate:true
        // when Studio drives. Enforce that.
        if (name === 'liberate_import' && (args as any)?.delegate !== true) {
          throw new Error(
            'Studio enforces delegate:true for liberate_import. Re-invoke with delegate:true to receive a manifest, then use Studio\'s wp-cli tool to do the actual import.'
          );
        }
      }
    },
  };
}
```

Per the brief: bucket *content* (which tool is destructive) is reused from `prior-art/rsm-3139-spec.md`. This sketch just shows the *mechanism* — runtime policy in adapter + skill-body discipline + system-prompt language. Wave-2 can tune buckets.

**Recommendation strength:** strong. Per-tool permissions become advisory-with-teeth: the skill body steers the model, and the adapter hard-stops the worst-case (forcing `delegate:true` on `liberate_import`).

## 6. File layout & integration seams

```
apps/cli/ai/dla/
├── index.ts              # Public entry: `buildDlaAgentTools(): Promise<AgentTool[]>` and `disposeDlaBridge()`
├── bridge.ts             # MCP client lifecycle: spawn child, connect, listTools, dispose
├── agent-tool-adapter.ts # JSON Schema → AgentTool shim (§2)
├── policy.ts             # Permission buckets (§5)
└── content-adapter.ts    # MCP content[] → pi content[] mapper (§2 sketch)
```

**Splice into `buildAgentTools` (`apps/cli/ai/runtimes/pi/index.ts:403-451`):** the existing `wpcom_request` tool is the structural analog — it's a runtime-dependent tool added to `buildAgentTools`'s return. DLA tools follow the same pattern, but they're async to construct (need `await client.listTools()`), so the seam moves slightly upstream:

```diff
 async function createStudioAgentSession(
   config: ResolvedStudioAgentTurnConfig,
   family: AiModelFamily,
   creds: ResolvedCredentials,
+  dlaBridge: DlaBridge | undefined,   // <-- new
 ): Promise<AgentSession> {
   // ...
-  const tools = buildAgentTools( config, isForkedByDesktop, remoteSession );
+  const tools = buildAgentTools( config, isForkedByDesktop, remoteSession, dlaBridge );
   const toolDefinitions = tools.map( toToolDefinition );
   // ...
 }

 function buildAgentTools(
   config: ResolvedStudioAgentTurnConfig,
   enablePreviewSteering: boolean,
   remoteSession: boolean,
+  dlaBridge: DlaBridge | undefined,
 ): AgentToolAny[] {
   // ...
+  const dlaTools = dlaBridge?.tools ?? [];
   return [
     ...resolveStudioToolDefinitions( { enablePreviewSteering, remoteSession } ),
+    ...dlaTools,
     ...askUserTool,
     ...skillTool,
     ...piTools,
   ];
 }
```

And `runAgentSessionTurn` gains a bridge bring-up/tear-down (sketched in §3).

`apps/cli/ai/dla/index.ts`:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { adaptRemoteTool } from './agent-tool-adapter';
import { createPolicy } from './policy';

export interface DlaBridge {
  tools: AgentTool[];
  dispose(): Promise<void>;
}

export async function startDlaBridge(opts: {
  dlaRoot: string;          // resolved path to data-liberation-agent install
  env?: Record<string, string>;
  allowDestructive?: boolean;
}): Promise<DlaBridge> {
  const transport = new StdioClientTransport({
    command: 'node',                                  // or 'npx tsx' fallback
    args: [`${opts.dlaRoot}/dist/mcp-server.js`],
    cwd: opts.dlaRoot,
    env: opts.env,
    stderr: 'pipe',
  });
  const client = new Client(
    { name: 'studio-cli', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  await client.connect(transport);
  const { tools: remoteTools } = await client.listTools(undefined, { signal: AbortSignal.timeout(10_000) });
  const policy = createPolicy({ allowDestructive: !!opts.allowDestructive });
  const tools = remoteTools.map(t => adaptRemoteTool(client, t, policy));
  return {
    tools,
    async dispose() {
      try { await client.close(); } finally {
        if (transport.pid) {
          setTimeout(() => { try { process.kill(transport.pid!, 'SIGKILL'); } catch {} }, 2000);
        }
      }
    },
  };
}
```

That's the **minimal seam**. The bridge is gated on a configuration flag (e.g. `STUDIO_DLA_ENABLED` env var, or detection of an installed DLA path) — when off, the bridge isn't started, `dlaTools` is `[]`, and nothing changes.

## 7. Slash-command + wrapper-skill plumbing

The pattern Studio already uses for `/annotate`, `/taxonomist`, `/need-for-speed`, `/rank-me-up` is exactly what `/migrate` needs:

1. **Drop the skill** at `apps/cli/ai/skills/migrate-site/SKILL.md`. The body is the runtime-agnostic content from `prior-art/rsm-3139-spec.md`'s `migrate-site.md`. The skill loader (`apps/cli/ai/skills.ts:27-51`) discovers it on startup, no other registration needed.
2. **Register the slash command** in `tools/common/ai/slash-commands.ts:8`:
   ```ts
   export const AI_SKILL_COMMANDS: SkillSlashCommand[] = [
     // ...
     { name: 'migrate', description: __( 'Migrate a website from another platform to WordPress' ) },
   ];
   ```
   Note: skill directory name must match the command name (`migrate-site/` vs `migrate`) — the `buildSkillInvocationPrompt` emits `"Run the /migrate skill using the Skill tool."` and `findSkill('migrate')` must match. So **either** rename the skill dir to `migrate/` **or** point the command at `migrate-site`. The first is cleaner.
3. **The rest is automatic.** `apps/cli/commands/ai/index.ts:619` routes any `AI_SKILL_COMMANDS` entry through `runAgentTurn(buildSkillInvocationPrompt(cmd.name))`. The agent then calls the `Skill` tool (`apps/cli/ai/tools/skill.ts`), which loads and returns the skill body.

**Optional refinement — gate the DLA bridge to `/migrate`:**

To avoid spawning DLA's child on every chat session, register a custom slash-command handler for `migrate` that starts the bridge before triggering the skill. This means demoting `migrate` from `AI_SKILL_COMMANDS` to its own entry in `slash-commands.ts` (a `handler` is provided, mirroring the `swag` example at line 528-535). Sketch:

```ts
{
  name: 'migrate',
  description: __( 'Migrate a website from another platform to WordPress' ),
  handler: async (prompt, ctx) => {
    await ensureDlaBridgeStarted();   // idempotent
    await ctx.runAgentTurn(buildSkillInvocationPrompt('migrate'));
    return 'continue';
  },
},
```

The downside is the agent restart pattern doesn't cleanly carry the bridge across sessions — for v1, **register `migrate` in `AI_SKILL_COMMANDS` and pay the bridge cost on every CLI startup**. Bridge gating is a wave-2 optimization.

**Gaps identified:**
- The skill body in `prior-art/rsm-3139-spec.md` references DLA tool names verbatim. If a remote tool isn't loaded (bridge failed to start), the model will get confused. Add a preflight line to the skill: "If `liberate_detect` is not available, stop and report that the migration tools failed to load."
- DLA's skill bodies (in DLA's `skills/liberate/SKILL.md`) declare `allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion`. Studio CLI exposes all of these (per `buildAgentTools` at lines 437-444). Compatible.

## 8. Gotchas & open questions

1. **`structuredContent` not used by DLA.** Brief assumption was wrong. v1 adapter handles it for forward-compat (`details = result.structuredContent`); no special handling needed today.
2. **Abort doesn't propagate to DLA's server-side work.** DLA doesn't honor `notifications/cancelled`. See §4. Mitigation: kill the child on session dispose; document the orphan-work behavior; consider upstream PR to DLA.
3. **`beforeToolCall` not on the public API.** Brief 1 must confirm whether `createAgentSessionRuntime`/`AgentSessionServices` expose a way to wire one. If yes, the bridge can replace the in-adapter `policy.assert` throws with a centralized hook. If no, advisory + adapter-throw is the recommendation (§5).
4. **Cold start of `npx tsx`.** Needs re-measurement against current DLA HEAD. Brief 5 should benchmark both `npx tsx src/mcp-server.ts` and `node dist/mcp-server.js` on a cold cache.
5. **DLA dependency on Playwright Chromium (~150 MB postinstall).** Not the bridge's problem per se, but if Studio bundles DLA the install footprint balloons. Brief 5.
6. **DLA spawns `studio` CLI itself** (`data-liberation-agent/src/lib/preview/studio.ts:71+` per the prior-art file). If Studio CLI is the host and DLA tries to spawn `studio site create`, we get a nested CLI invocation — works but ugly. The `delegate: true` path on `liberate_preview` should avoid this; verify the skill body uses it.
7. **TypeScript cast `inputSchema as unknown as TSchema`.** Safe at runtime (§2), but it's a `// eslint-disable-next-line @typescript-eslint/no-explicit-any`-shaped concession. Acceptable; same pattern Studio's MCP *server* uses.
8. **DLA's `outputSchema` (if any) goes unused.** SDK supports `jsonSchemaValidator` to validate `structuredContent`. We skip this in v1 since DLA doesn't emit `outputSchema`. Not a real concern.
9. **Multiple DLA tool calls in flight in one turn.** pi's `executionMode: 'parallel'` is the default. Each `callTool` is a separate JSON-RPC request; the MCP SDK handles concurrent requests fine. Should work; benchmark recommended.
10. **DLA's `_meta`/progress notifications.** DLA's mcp-server calls `sendLoggingMessage` for progress (per inventory). pi's `onUpdate` partial-result callback could surface these. Out of scope for v1; nice wave-2.
11. **Error messages from MCP errors are JSON-RPC-formatted.** When `client.callTool` rejects (transport error, server crash), the message includes JSON-RPC framing. Wrap it in a friendlier error before re-throwing from `execute`.

## 9. Verdict

**Verdict:** works with caveats.

**Recommendation strength:** acceptable — leans strong.

The bridge mechanically works:
- `@modelcontextprotocol/sdk@1.29.0` ships a typed `Client` + `StdioClientTransport`. The API for spawning a stdio-MCP child, calling `listTools`, and calling `callTool(name, args, {signal})` is exactly what we need (§1).
- pi accepts plain JSON Schema objects in `parameters` — confirmed by `validateToolArguments`'s explicit `!hasTypeBoxMetadata && isJsonSchemaObject` branch. No schema translation required (§2).
- The result shape adapts cleanly: filter audio/resource_link content; map `structuredContent` → `details`; throw on `isError: true` and let pi's loop handle it (§2).
- Lifecycle plugs into the existing `dispose()` finally block (§3).
- Abort propagation is one line on the client (§4); the server-side gap is a documented caveat, not a blocker.
- File layout slot is `apps/cli/ai/dla/`; integration is one new parameter to `buildAgentTools` and one bring-up/tear-down in `runAgentSessionTurn` (§6).
- Slash-command + skill plumbing is the existing `AI_SKILL_COMMANDS` pattern (§7).

The caveats are real but bounded:
- Permission gating becomes advisory unless Brief 1 surfaces a `beforeToolCall` hook through the lower-level API.
- Abort doesn't cancel DLA-side work; restartable extractions limit the damage.
- `npx tsx` cold start should be replaced with a built JS entry point — DLA already has the build script.

The bridge approach should win the synthesis unless Brief 3 (vendor-as-AgentTools) shows DLA's `src/lib/` is cleanly self-contained, or Brief 4 (subprocess) finds a way to give the agent enough visibility into DLA without 13 round-tripped tool definitions. Neither seems likely on first read — the MCP surface is the right abstraction, just embedded in-process via stdio.

## Sources

- `node_modules/@modelcontextprotocol/sdk/package.json` (version 1.29.0)
- `node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts` lines 22-590 — Client / ClientOptions / listTools / callTool signatures
- `node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.d.ts` lines 5-76 — StdioServerParameters / StdioClientTransport
- `node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.d.ts` lines 61-98 — RequestOptions (signal/timeout)
- `node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js` lines 677, 709-710 — signal-to-cancel wiring
- `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts` lines 2495-2520, 8089 — CallToolResultSchema
- `node_modules/@mariozechner/pi-agent-core/dist/types.d.ts` lines 259-291 — AgentToolResult / AgentTool / Tool
- `node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js` lines 308-401 — prepareToolCall / executePreparedToolCall / beforeToolCall hook
- `node_modules/@mariozechner/pi-ai/dist/types.d.ts` lines 153-168 — Tool / ToolResultMessage
- `node_modules/@mariozechner/pi-ai/dist/utils/validation.js` lines 1-280 — validateToolArguments, hasTypeBoxMetadata, coerceWithJsonSchema, getValidator (the load-bearing evidence that pi accepts plain JSON Schema)
- `node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js` lines 887-904 — convertTools (proof parameters → input_schema is shape-preserving)
- `node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js` line 756 (same, with comment "TypeBox already generates JSON Schema")
- `node_modules/@mariozechner/pi-ai/dist/providers/amazon-bedrock.js` line 599 (same)
- `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts` lines 323-354 — ToolDefinition
- `node_modules/@mariozechner/pi-coding-agent/dist/core/sdk.d.ts` lines 11-106 — CreateAgentSessionOptions (confirming no beforeToolCall)
- `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.d.ts` line 244 — `dispose()`
- `apps/cli/ai/mcp-server.ts` lines 1-58 — Studio's existing MCP *server* usage (the brief's structural analog)
- `apps/cli/ai/runtimes/pi/index.ts` lines 75-451 — buildAgentTools, toToolDefinition, createStudioAgentSession, runAgentSessionTurn (the splice point)
- `apps/cli/ai/tools/define-tool.ts` lines 1-57 — Studio's tool-defining convention
- `apps/cli/ai/tools/wpcom-request.ts` lines 1-143 — the brief-suggested structural analog
- `apps/cli/ai/tools/skill.ts` lines 1-32 — Skill tool that loads SKILL.md files
- `apps/cli/ai/skills.ts` lines 1-55 — skill loader (path resolution at line 30)
- `apps/cli/ai/tools/index.ts` lines 1-79 — resolveStudioToolDefinitions
- `apps/cli/ai/slash-commands.ts` lines 528-542 — slash-command registry, AI_SKILL_COMMANDS splat
- `apps/cli/commands/ai/index.ts` lines 600-633 — slash-command → skill invocation routing
- `tools/common/ai/slash-commands.ts` lines 1-17 — AI_SKILL_COMMANDS / buildSkillInvocationPrompt
- `/Users/iamposti/Automattic/repos/data-liberation-agent/src/mcp-server.ts` lines 32-310 — DLA tool list, inputSchemas, textResult helper (the key finding: structuredContent unused)
- `/Users/iamposti/Automattic/repos/data-liberation-agent/package.json` lines 1-23 — DLA has `"build": "tsc"`; `bin` points at `./dist/cli.js`
- `issues/rsm-3143-dla-pi-research/prior-art/wave-1-findings/wave-1-dla-inventory.md` — DLA tool count (13), surfaces, delegate:true semantics, skill bodies
- `issues/rsm-3143-dla-pi-research/tasks/wave-1-mcp-bridge-feasibility.md` — task brief
- `issues/rsm-3143-dla-pi-research/research-plan.md` — wave 1 plan
