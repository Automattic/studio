# RSM-3143: Re-research DLA integration into `studio code` against pi-coding-agent

**Status:** research, no code changes
**Scope:** Studio CLI (`apps/cli/`) only. Electron-side touches are flagged, never proposed.
**Supersedes:** RSM-1639 (research, Done), RSM-1675 (impl Approach A, Cancelled), RSM-3139 (impl Approach C, Cancelled), PR #3277 (closed).
**Deliverable framing:** What happens when a user types `/migrate` inside `studio code`, now that the host runtime is `@mariozechner/pi-coding-agent@0.70.2` and DLA is a public Automattic repo?

---

## Executive Summary

RSM-1639 produced a working recommendation against `@anthropic-ai/claude-agent-sdk`. Two upstream changes invalidate the host-side half of that report:

1. DLA went public on 2026-05-07 (`Automattic/data-liberation-agent`). The "private repo → no `github:` deps" constraint that killed Approach C in RSM-1639 is gone — `github:Automattic/data-liberation-agent#<sha>` installs cleanly via `npm install --omit=dev` and survives `npm ci` on Studio's CI/Buildkite pipeline (`wave-1-upstream-and-bundling` §2.3).
2. Studio CLI migrated to `@mariozechner/pi-coding-agent@0.70.2` on the same day (PR #3360, commit `406b7494`). The wiring surfaces RSM-1639 leaned on — `Options.mcpServers`, `Options.plugins`, `canUseTool`, `apps/cli/ai/agent.ts` — no longer exist on trunk. Pi exposes a flat `customTools: ToolDefinition[]` slot, a `tools` allowlist, and **zero MCP support in core** (grep across `node_modules/@mariozechner/pi-*` returns zero `mcp`/`MCP` matches outside vendored syntax-highlight tables; pi's maintainer publicly closed issue #563 with "we don't need to add an MCP example anymore" and pointed users at the third-party `pi-mcp-adapter`).

The DLA-side findings from RSM-1639 — its 13 MCP tools, `delegate: true` contract, skill content, manifests, runtime expectations — **remain authoritative**. The wrapper-skill body and per-tool permission-policy buckets from RSM-3139's spec are runtime-agnostic and reusable as-is.

**Recommended path:** A Studio-owned MCP-client bridge under `tools/dla/` that spawns DLA's stdio MCP server as a child process, calls `ListTools` at session bring-up, and wraps each remote tool as a pi `ToolDefinition` in the existing `customTools` array. This is **mechanically equivalent to RSM-1639's Approach A**, just one level lower: where the Claude SDK accepted `mcpServers: { 'data-liberation': { command, args } }` natively, we re-derive that wiring against pi's `customTools` slot using `@modelcontextprotocol/sdk@1.29.0` (already in Studio's deps). The bridge is ~250 LOC in `tools/dla/` (a sibling workspace package alongside `tools/common/`), one new parameter to `buildAgentTools` (`apps/cli/ai/runtimes/pi/index.ts:403-451`), and a dispose hook in the existing `finally` block that already calls `session.dispose()` (`runtimes/pi/index.ts:222-225`). Per-tool permission gating — the headline open concern at the start of this round — lands via an inline extension factory (`new DefaultResourceLoader({ extensionFactories: [createPolicyExtension()] })` on the same loader Studio passes today) using `pi.on('tool_call', handler)` returning `{block: true, reason}`. Inline extension factories load even when `noExtensions: true` (verified at `resource-loader.js:272-278`), so flipping no other settings is required.

DLA is bundled as a `github:Automattic/data-liberation-agent#<sha>` dependency in `apps/cli/package.json` and consumed via a `node <bundled-node> apps/cli/node_modules/.bin/tsx node_modules/data-liberation/src/mcp-server.ts` spawn. The fix to make `tsx` reachable in a packaged CLI is one line: add `tsx` to `apps/cli/package.json` `dependencies` (it currently sits in DLA's `devDependencies` and is dropped by `--omit=dev`). Cold start of the DLA MCP child is paid once at session creation, not per tool call. Per-tool permission policy comes verbatim from RSM-3139's bucket table. `/migrate` lands via the existing `AI_SKILL_COMMANDS` registry pattern (`tools/common/ai/slash-commands.ts:8-13`) plus a bundled `apps/cli/ai/skills/migrate/SKILL.md` wrapping RSM-3139's skill body — no new slash-dispatcher logic, no Studio TUI changes.

The trade-offs we accept: DLA's MCP server does not honor `notifications/cancelled` (aborts surface to the model but orphan in-flight work upstream — filesystem-bounded by DLA's resume-safe protocol), Studio inherits DLA's ~150 MB Playwright Chromium postinstall (mitigated at build time with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`; end-user `npm install -g wp-studio` pays the cost), and Studio carries the integration layer rather than waiting for pi-coding-agent to grow first-party MCP support (the maintainer has publicly rejected this direction). The fallback path if Bridge runs into an unforeseen blocker is **Vendor-as-AgentTools** — also mechanically possible, slightly cleaner at runtime, and gated on either an upstream `prepare: tsc` PR or a Studio-owned vendor copy via git submodule.

---

## Approaches Investigated

We re-evaluate four shapes against pi. Each names *exactly* where it plugs into the Studio CLI, what flows at `/migrate` time, and what we ship.

### A. MCP-stdio bridge to pi `customTools` (recommended)

**How it works.** Studio adds a `data-liberation` dep as `github:Automattic/data-liberation-agent#<sha>` (commit SHA pin — DLA has zero git tags and no releases per `wave-1-upstream-and-bundling` §2.4). A new workspace package under `tools/dla/` (sibling of `tools/common/`) wires the bridge:

```
tools/dla/
├── package.json          # `name: "@studio/dla"`, declared as a workspace package
├── index.ts              # `startDlaBridge()` / `DlaBridge.dispose()`
├── bridge.ts             # MCP client lifecycle: spawn child, connect, listTools, dispose
├── agent-tool-adapter.ts # JSON Schema → pi ToolDefinition shim
├── policy.ts             # Permission buckets (reuses RSM-3139)
└── content-adapter.ts    # MCP content[] → pi content[] mapper
```

Imported from `apps/cli/` as `@studio/dla` (matching the existing `@studio/common` aliasing pattern in `apps/cli/vite.config.base.ts:100-107`).

At session bring-up (`apps/cli/ai/runtimes/pi/index.ts`, inside `runAgentSessionTurn`), the bridge spawns `node <bundled-node-binary> apps/cli/node_modules/.bin/tsx node_modules/data-liberation/src/mcp-server.ts` (or `node node_modules/data-liberation/dist/mcp-server.js` if we run DLA's `tsc` at build time — see distribution section), calls `client.listTools()` with a 10 s timeout, and adapts each remote tool through `agent-tool-adapter.ts` into a pi `ToolDefinition`. The adapted tools join Studio's existing tool array passed to `createAgentSession({ customTools, tools })` (`apps/cli/ai/runtimes/pi/index.ts:282-285`). Teardown plugs into the existing `finally` block at `runtimes/pi/index.ts:222-225`.

Per-tool permission gating lands as an inline extension factory on the same `DefaultResourceLoader` Studio already constructs (`apps/cli/ai/runtimes/pi/index.ts:256-267`). The factory subscribes to `pi.on('tool_call', handler)` and returns `{block: true, reason}` for tools in the "destructive" bucket (per `prior-art/rsm-3139-spec.md`'s policy table) — mechanically equivalent to what `canUseTool` was in the Claude SDK. Inline extension factories load even when `noExtensions: true` (`resource-loader.js:272-278`), so no other `DefaultResourceLoader` flag changes.

`/migrate` registers via the existing `AI_SKILL_COMMANDS` registry in `tools/common/ai/slash-commands.ts:8-13`. A bundled `apps/cli/ai/skills/migrate/SKILL.md` carries the wrapper-skill body verbatim from `prior-art/rsm-3139-spec.md` — runtime-agnostic content, reused as-is. When the user types `/migrate <url>`, Studio's existing slash dispatcher (`apps/cli/commands/ai/index.ts:600-633`) routes through `runAgentTurn(buildSkillInvocationPrompt('migrate'))`, which produces the prompt "Run the /migrate skill using the Skill tool." The model invokes Studio's `Skill` tool (`apps/cli/ai/tools/skill.ts`), which loads the SKILL.md body. The model then walks the workflow, calling `liberate_detect` / `liberate_discover` / `liberate_inspect` / `liberate_extract` / `liberate_qa` / `liberate_verify`, and finally `liberate_setup` and `liberate_import` with `delegate: true`. DLA returns the import manifest as a single text content block (JSON-stringified — DLA's `textResult()` helper at `src/mcp-server.ts:32-34` does not emit `structuredContent`). The skill body instructs the model to hand off to Studio's existing `site_create` / `wp_cli` tools using the manifest paths.

**Evidence.**
- DLA's MCP tool inventory (13 tools), input schemas, and `delegate: true` contract: `prior-art/wave-1-findings/wave-1-dla-inventory.md` §4 — DLA-side facts unchanged from RSM-1639.
- Pi accepts plain JSON Schema in `ToolDefinition.parameters` — explicit `!hasTypeBoxMetadata && isJsonSchemaObject` branch in `node_modules/@mariozechner/pi-ai/dist/utils/validation.js:253-280`. Each provider downstream (`anthropic.js:887-904`, `openai-completions.js:756`, `amazon-bedrock.js:599`, `google-shared.js:273-274`) treats `tool.parameters` as JSON Schema and shape-preservingly hands it to its provider-native input-schema slot. Verified by `wave-1-mcp-bridge-feasibility` §2.
- `@modelcontextprotocol/sdk@1.29.0` (the version actually resolved in Studio's lockfile, not the `^1.27.1` floor) ships typed `Client` + `StdioClientTransport` with `signal`-aware `RequestOptions`. Abort propagation is a one-liner: forward pi's `AbortSignal` to `client.callTool(_, _, {signal})` and the SDK emits `notifications/cancelled` to the server. Verified at `dist/esm/shared/protocol.js:677,709-710`.
- Per-tool permission gating reachable via `extensionFactories` on `DefaultResourceLoader`. The hook is `pi.on('tool_call', handler)` returning `{block: true, reason}`. AgentSession's `_installAgentToolHooks` proxies this through agent-core's `beforeToolCall` (`node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:171-216`). Verified by `wave-1-pi-extensibility-surface` §3.
- Slash-command path: existing `AI_SKILL_COMMANDS` registry + Studio's bundled `Skill` tool. Identical to the existing `/annotate`, `/taxonomist`, `/need-for-speed`, `/rank-me-up` shape. Verified at `apps/cli/commands/ai/index.ts:619`.

**Pros.**
- **No upstream blockers.** Every load-bearing surface (`Client`, `StdioClientTransport`, pi `customTools`, `DefaultResourceLoader.extensionFactories`, `AI_SKILL_COMMANDS`, `Skill` tool) is already shipped in installed dependencies. No PRs to pi, no PRs to DLA.
- **Permission policy is mechanically equivalent to `canUseTool`.** Brief 1's `tool_call` extension hook resolves the headline gap. Per-tool deny with a reason; the model receives an error message and the skill body instructs it to ask the user.
- **`delegate: true` flows naturally.** DLA's manifest comes back as a text content block; the skill body parses it; Studio's existing `site_create` / `wp_cli` tools consume the paths.
- **Sessions / replay / abort wiring carry over.** No tool-name-specific machinery in pi's session manager; aborts plumb through `AbortSignal` end-to-end (with the caveat below about server-side cancellation).
- **Schema cast is safe at runtime.** pi-ai's validation pipeline explicitly handles plain JSON Schema. The TypeScript cast `inputSchema as unknown as TSchema` is the same pattern Studio's own MCP *server* uses for the inverse direction (`apps/cli/ai/mcp-server.ts:27`).
- **Single integration touch-point per release.** DLA is pinned by SHA; bumping is a one-line `package.json` edit.

**Cons / costs.**
- **DLA does not honor `notifications/cancelled`.** A cancelled `liberate_extract` will keep crawling server-side until the child process exits at session dispose. Filesystem cleanup is bounded by DLA's resume-safe protocol (`extraction-log.jsonl`, `session.json` per `wave-1-dla-inventory.md` §5). Mitigation: document the orphan behavior; consider upstreaming a `signal`-honoring patch to DLA.
- **`tsx` is in DLA's `devDependencies`, not `dependencies`.** Bridge's runtime spawn of `npx tsx src/mcp-server.ts` (DLA's documented `.mcp.json`) breaks under `npm install --omit=dev` plus packaged Electron CLI's missing `npx`. Fix: add `tsx` to `apps/cli/package.json` `dependencies` (~10 MB; pulls esbuild transitive) **or** run DLA's `tsc` at Studio build time and spawn `node dist/mcp-server.js`. Option A is the smallest landable change; Option B is faster at runtime (~hundreds-of-ms vs `tsx` startup) but adds a build step we don't otherwise need.
- **Playwright Chromium postinstall.** DLA's `postinstall: playwright install chromium` downloads ~150 MB per architecture into Playwright's user cache. Studio already has the JS `playwright` dep (`apps/cli/package.json:53`) so the browser binary may be cache-shared, but the postinstall *will* run and re-check. Mitigation: set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in Studio's build pipeline (Buildkite + GitHub Actions + `apps/cli/install:bundle`); accept the cost at end-user install.
- **0.70.2 is three minor versions behind pi's npm latest (0.73.1) and behind the scope rename to `@earendil-works/pi-coding-agent` (0.74.0).** The two load-bearing surfaces are `extensionFactories` (added 0.67.2) and `tool_call`/`tool_result` extension hooks (post-0.59-0.60 migration). Pi's release cadence is 3-7 patch releases per week; expect to rebase periodically. Treat as semver-loose.
- **Pi has zero MCP support in core; the maintainer has declined to add it.** This is a permanent fixture, not a wait-and-see. Studio carries the integration layer for the life of the dependency.
- **DLA's `liberate_preview` has a recursion-into-Studio hazard.** `lib/preview/playground-server.ts:160` calls `isStudioAvailable()` → `studio site create`. When Studio CLI hosts the bridge, this means `studio code` spawning `studio site create` as a child. Mitigation lives in the wrapper skill body, which should call `liberate_setup` / `liberate_import` with `delegate: true` (the canonical Studio integration shape per `wave-1-dla-inventory.md` §4) and let Studio drive site creation directly via its own `site_create` tool.

### B. Vendor DLA's `src/lib/` as Studio-owned pi `ToolDefinition`s

**How it works.** Import `data-liberation/lib/extraction/detect-platform.js`, `data-liberation/lib/preview/playground-server.js`, `data-liberation/adapters/*.js` directly from Studio's process. Each of DLA's 13 MCP tools becomes a Studio-authored pi `ToolDefinition` (via `defineTool`) whose `execute` calls the underlying lib function. Schemas are transcribed from `data-liberation/src/mcp-server.ts:48-234`'s inline JSON-Schema literals into typebox. The `delegate: true` manifest objects (literal constructions in DLA's mcp-server handler) are copied verbatim into Studio's wrappers — `wave-1-vendor-as-agenttools` §2 traces all 13 tool-handler bodies to clean lib entry points, with 7 pass-throughs and 6 requiring 15-50 LOC of handler-mirroring per tool.

**Evidence.**
- DLA's `src/lib/` and `src/adapters/` are self-contained: no Ink/UI imports, no cwd dependence, MCP `Server` is type-only + optional at runtime (defensive `?.` usage at `adapters/shared.ts:368-374` and `adapters/shopify.ts:1028-1031`). Verified by `wave-1-vendor-as-agenttools` §1.
- All 13 MCP tools have clean lib entry points. Schema and response-shape duplication is bounded: 13 tools, ~30 schema fields total, 14+ days of stability in DLA's `src/mcp-server.ts`. Verified by `wave-1-vendor-as-agenttools` §2-4.
- `delegate: true` is implemented entirely in `src/mcp-server.ts` (lines 472-496 for setup, 498-520 for import) and is not visible to `src/lib/`. Vendored wrappers re-implement the manifest as ~15 lines of literal-object construction with `existsSync` probes — **easier** in this path than via MCP wire-format. Verified by `wave-1-vendor-as-agenttools` §5.
- Build-time integration is the blocker: DLA ships TS only — `dist/` is gitignored, `package.json` has no `main`/`exports`/`module`, no `prepare` script. Studio's `vite.config.base.ts:79-91` externalizes anything listed in `apps/cli/package.json` `dependencies`, so the bundled CLI would crash at runtime importing `.ts` files. Three unblockers in `wave-1-vendor-as-agenttools` §7.

**Pros.**
- **No child process, no IPC, no `tsx` runtime dep.** In-process module loads, direct TS exceptions, native abort via in-process `AbortSignal` passing.
- **`delegate: true` is easier than in Bridge.** No wire-format hop; Studio's wrappers construct the manifest as a JS object directly.
- **Schema and behavior are Studio's contract.** No surprise output shape changes when DLA's mcp-server.ts handler reshape happens — Studio's wrappers stay stable until Studio updates them.
- **Lower per-call overhead.** No JSON-RPC framing, no stdio buffering, no JSON serialize/deserialize per tool call.

**Cons / costs.**
- **Build-time integration is real work, with three unblock options:**
  1. **Upstream `prepare: tsc` + `exports` PR to DLA** — 5-line PR but requires maintainer cooperation. If accepted, this is the cleanest unblocker.
  2. **Studio's `postinstall-npm.mjs` runs `tsc` against DLA** — brittle because DLA's `typescript` is a devDep skipped by `--omit=dev`. Workable but needs careful sequencing.
  3. **Vendor copy via `git submodule add` under `apps/cli/vendor/data-liberation/`** — Studio-owned, sidesteps `npm` mechanics entirely, lets Vite transpile the TS source. Loses SHA-pin convenience but plays to Studio's existing build pipeline. Preferred unblocker if (1) isn't immediately landable.
- **Schema / response-shape transcription is manual.** ~30 schema fields and 6 response-assembly bodies to mirror. Drift risk is medium-low (stable 14+ days, small surface) but real on every DLA release. Mitigation: integration tests that pin a DLA SHA in a fixture and assert response shapes against `JSON.parse(await dlaTool.callTool(args))` for each tool.
- **DLA's `src/lib/*` and `src/adapters/*` are not declared a public API.** `wave-1-dla-inventory.md` §2: "Nothing in `package.json` exposes them as a public API." Vendor takes on maintenance cost of tracking DLA's internal API drift — 17 commits to `src/lib/` in the last 60 days, mostly additive but the contract is informal.
- **Same recursion-into-Studio hazard as Bridge.** `lib/preview/playground-server.ts:160` checks `isStudioAvailable()`. Studio wrappers must pass a `_noStudio: true` flag (`playground-server.ts:160` exposes it as an internal option) or call `startStudioPreview` directly via a Studio-owned path. The fix is mechanically smaller in this path because Studio controls the wrapper code, not DLA's mcp-server.
- **Vendored PHP scripts (`lib/preview/scripts/import-wxr.php`, `import-products.php`) must ship alongside compiled JS.** DLA resolves them via `fileURLToPath(import.meta.url)`. Studio's existing `viteStaticCopy` machinery handles this fine, but the bundling target must include the `scripts/` dir.

**Verdict (B vs A):** Vendor is the lighter ongoing path after the one-time build-integration cost — no child-process lifecycle, no stdio parsing, faster invocations. Bridge wins on time-to-first-PR because there's no upstream PR to wait for and no schema transcription. We recommend **Bridge** as the canonical path with **Vendor** as the fallback if the bridge mechanics turn up an unforeseen blocker. The implementation-phase planner should hold the door open for switching: both approaches share the same wrapper-skill body, the same permission-policy buckets, the same `AI_SKILL_COMMANDS` slash-command registration, and the same `tools/dla/` directory shape. Migrating from Bridge to Vendor later would touch only `agent-tool-adapter.ts` and add a `tsc` step; the rest stays.

### C. Subprocess (single `dla_run` tool, escape-hatch / fallback)

**How it works.** Studio wraps DLA's CLI as a single pi `AgentTool` `dla_run({subcommand, target, outputDir?, extraArgs?})`. The tool spawns `<bundled-node> apps/cli/node_modules/.bin/tsx node_modules/data-liberation/src/cli.ts <subcommand> <target> ...` with `NO_COLOR=1 CI=1` to suppress Ink redraws, strips ANSI from stdout/stderr, and returns the text payload as a tool result. Abort and streaming use pi's `signal` and `onUpdate` parameters (which `defineTool` drops, so the wrapper must use a raw `AgentTool` shape — see `wave-1-subprocess-revisit` §6). `--non-interactive` is forced on the two subcommands that block (`extract`, `preview`).

**Evidence.**
- DLA's CLI has 7 useful subcommands (`inspect`, `qa`, `verify`, `setup`, `preview`, `import`, bare-URL extract) — verified at `data-liberation/src/cli.ts:1-176`. Verified by `wave-1-subprocess-revisit` §1.
- No `--json` mode — verified via `grep -rn "JSON\.stringify\|--json" src/cli.ts src/ui/` returning zero matches. The model consumes ANSI-stripped terminal text.
- `--non-interactive` honored on `extract` and `preview`; `setup` requires creds up-front.
- Latency: `npx tsx src/cli.ts --version` warm ~100 ms; `inspect http://example.invalid` ~690 ms (network-bound). Real work dominates startup. `wave-1-subprocess-revisit` §5.

**Pros.**
- **Minimum Studio LOC.** ~60 LOC for a single-tool wrapper; ~350 LOC fan-out.
- **DLA upgrades land instantly via SHA pin.** No schema sync, no response-shape mirroring.
- **Black-box delegation: DLA's CLI grammar is the contract.** Stable enough to depend on.
- **No long-lived child to manage.** Each spawn is short-lived; the agent's `dispose` already exits the CLI process at the end of every `/migrate` flow.

**Cons / costs.**
- **`delegate: true` is structurally unreachable from CLI.** DLA's CLI `import` always REST-imports; `src/cli.ts:138-149` mandates `--site`/`--username`/`--token` and `process.exit(1)` on missing. Studio's wrapper must reconstruct the import manifest from the on-disk output directory — duplicating DLA's manifest contract on the Studio side. This defeats most of the "DLA is a black box" simplicity argument and is the single biggest reason this approach loses to Bridge.
- **6 of 13 MCP tools are unreachable.** `liberate_detect`, `liberate_discover`, `liberate_map_apis`, `liberate_probe`, `liberate_status`, `liberate_preview_stop` have no CLI subcommand equivalents. The bare-URL `<url>` extract bundles `_detect` + `_discover` + `_extract` + `_autoPreview` into one Ink run; the agent cannot observe the phases.
- **Output is messy.** Terminal text with ASCII-art headers, Unicode glyphs, possibly multi-megabyte progress logs for large extracts. ANSI stripping helps; structure cannot be recovered. Brittle against any DLA UI refactor.
- **No phase observability.** The model decides "run extract" then waits for an opaque Ink session to complete.

**Verdict:** Works with caveats. Not the canonical path — Bridge or Vendor are dominantly better on every UX axis. Subprocess earns its keep as **(i)** a standalone `studio migrate <url>` non-agent CLI command (full DLA UI fidelity, no agent overhead, useful for users who want the headless path), or **(ii)** a fast MVP / proof-of-concept to land `/migrate` behind a feature flag before committing engineering time to Bridge wiring, or **(iii)** a graceful-degradation fallback if Bridge's child spawn fails at runtime (DLA binary missing, sandbox restriction).

### D. Wait for pi-coding-agent to grow first-party MCP support (killed)

**How it works.** Land an `mcpServers: { name: { command, args, env } }` slot upstream in `pi-coding-agent`'s `CreateAgentSessionOptions`. Studio's wiring then mirrors the RSM-1639 Approach A shape — one config object per MCP server, no Studio-side bridge.

**Evidence.**
- Maintainer publicly rejected this. Issue #563 (`feat(coding-agent): Add MCP extension example`) closed Jan 2026 with: *"Alright, [@nicobailon](https://github.com/nicobailon) made this, so we don't need to add an MCP example anymore. https://www.npmjs.com/package/pi-mcp-adapter"*. The blessed answer is the third-party `pi-mcp-adapter`, built on pi's already-public extension API. `wave-1-upstream-and-bundling` §1.2.
- Maintainer philosophy (`CONTRIBUTING.md`): *"pi's core is minimal. If your feature does not belong in the core, it should be an extension. PRs that bloat the core will likely be rejected."* `wave-1-upstream-and-bundling` §1.3.
- Drive-by PRs are auto-closed under a Contribution Gate (PR #3774 was auto-closed within seconds, 2026-04-26). New contributors require an `lgtm` from a maintainer to even submit.
- Repo is mid-scope-rename (`badlogic/pi-mono` → `earendil-works/pi`, `@mariozechner/*` → `@earendil-works/*`) as of 0.74.0 (2026-05-07). Project velocity is 3-7 patch releases per week, with frequent breaking changes. Studio's pin lags by 3+ minor versions already.

**Pros.** None mechanically relevant under current maintainer signals.

**Cons.**
- Timeline 8-16 weeks realistic, "never" non-negligible.
- Even an accepted PR has to wait through the scope-rename refactor to settle.
- Slower than in-tree in every scenario.

**Verdict:** Killed. Studio carries the integration layer. The one open thread is whether `pi-mcp-adapter` itself is a viable Studio dep (it's MIT-licensed, 663 stars, recent activity, built on pi's public `ExtensionFactory` API). We chose not to evaluate it for this round — see Open Questions.

---

## Comparison

| Dimension | A. Bridge (recommended) | B. Vendor | C. Subprocess (escape-hatch) | D. Upstream pi (killed) |
|---|---|---|---|---|
| Mechanical verdict | works with caveats | works with caveats | works with caveats | blocked |
| Time to first PR | 2-4 weeks | 1-3 weeks after upstream PR or vendor copy | 1 week | 8-16 weeks |
| Studio-owned LOC | ~250 | ~600+ | ~60 | ~10 (config only, if it landed) |
| Tool coverage | 13/13 | 13/13 | 7/13 | 13/13 |
| `delegate: true` available | yes | yes (easier than Bridge) | **no** (structural) | yes |
| Permission gating | `pi.on('tool_call', …)` extension hook | per-tool wrapper handler | per-`subcommand` string parser | `canUseTool`-equivalent (would-be) |
| Per-call latency | JSON-RPC + stdio (~10 ms) | in-process function call | `tsx` spawn ~100-300 ms | in-process |
| Per-session latency | one DLA child spawn at bring-up | zero | per-tool-call spawn | zero |
| Agent phase observability | high (13 discrete tools) | high (13 discrete tools) | low (bare-URL extract bundles 4 phases) | high |
| Output shape | structured MCP `content[]` | Studio-defined JS objects | ANSI-stripped terminal text | structured MCP `content[]` |
| Abort propagation (client → tool) | `signal` → `notifications/cancelled` (sent but ignored server-side) | native `AbortSignal` passthrough | `killProcessTree` from `pi-coding-agent/dist/utils/shell.js` | same as A |
| Schema drift risk | low (auto-synced via `ListTools` at startup) | medium-low (13 tools manually transcribed) | low (no schema sync; uses CLI grammar) | n/a |
| Bundling blocker | `tsx` in DLA devDeps; `npx` not in packaged CLI (fix: add `tsx` to Studio deps) | no `dist/`, no `exports`, no `prepare` script (fix: upstream PR or vendor copy) | same as A | n/a |
| Recursion-into-Studio hazard (`liberate_preview`) | mitigate in skill body (`delegate: true` route) | mitigate in wrapper (`_noStudio` flag) | bypassed (CLI `preview` is its own subcommand) | mitigate in skill body |
| Playwright Chromium postinstall | inherits ~150 MB | inherits ~150 MB (unless vendor-copy + lazy import) | inherits ~150 MB | inherits ~150 MB |
| External maintainer dependency | DLA (Automattic), pi (single maintainer) | DLA internal `src/lib/` API (informal contract) | DLA CLI grammar (documented) | pi maintainer cooperation |
| Survives pi 0.71+ breaking changes | low risk (uses `customTools` + `extensionFactories`, both stable surfaces) | same | same | n/a |
| Migration cost to swap in B later | low (only `agent-tool-adapter.ts` changes; rest of `tools/dla/` shape stays) | n/a | high (different wrapper shape) | n/a |

---

## Recommendation

**Land Bridge (Approach A) for the canonical `/migrate` UX, behind a feature flag, with Subprocess (Approach C) as a `studio migrate <url>` standalone CLI command for the non-agent / headless flow.** Defer Vendor (Approach B) as a documented fallback if Bridge runs into an unforeseen blocker during implementation. Kill Upstream pi (Approach D) — the maintainer has publicly rejected this direction and the timeline is worse than in-tree.

**Concrete next steps for the implementation phase:**

1. **Add DLA as a `github:` dep** at `apps/cli/package.json` `dependencies` (SHA pin; recommend `17219c42b0420267302b138bf402930508006e0e`, the HEAD audited by `wave-1-vendor-as-agenttools`). Bump cadence: weekly to start (matches DLA's commit velocity), monthly once stable.
2. **Add `tsx` to `apps/cli/package.json` `dependencies`** so it survives `--omit=dev`. Spawn via `<bundled-node> apps/cli/node_modules/.bin/tsx ...` rather than `npx tsx`. Trade-off: ~10 MB plus esbuild transitives. Faster alternative (replace post-MVP): run DLA's `tsc` at Studio build time and spawn `node dist/mcp-server.js` — needs DLA tsconfig adjustments because DLA's TS source assumes loose ESM resolution.
3. **Scaffold `tools/dla/` as a workspace package** (sibling of `tools/common/`) with `name: "@studio/dla"` and consume it from `apps/cli/` as `@studio/dla`. The file layout (sketched in `wave-1-mcp-bridge-feasibility` §6 under the now-superseded `apps/cli/ai/dla/` path) carries over verbatim. One new param to `buildAgentTools(config, isForkedByDesktop, remoteSession, dlaBridge?)`. Bridge bring-up in `runAgentSessionTurn`; teardown in the existing `finally` block at `runtimes/pi/index.ts:222-225`. `signal` plumbing forwards pi's `AbortSignal` to `client.callTool(_, _, {signal})`. Add `@studio/dla` to `tsconfig.base.json` path aliases and `apps/cli/vite.config.base.ts` resolve aliases (mirror the existing `@studio/common` entry).
4. **Wire the permission extension factory.** Construct `new DefaultResourceLoader({ ...currentOptions, extensionFactories: [createDlaPolicyFactory(buckets)] })` at the same construction site (`apps/cli/ai/runtimes/pi/index.ts:256-267`). The factory subscribes to `pi.on('tool_call', ...)` and returns `{block: true, reason}` for `destructive`-bucket tools. **Reuse RSM-3139's bucket table verbatim** (`prior-art/rsm-3139-spec.md`'s policy section is runtime-agnostic). The "advisory + adapter-throw" defense-in-depth pattern from `wave-1-mcp-bridge-feasibility` §5 is the recommended layering: system-prompt language → skill-body discipline → adapter-layer hard-stop on `delegate:true` for `liberate_import`.
5. **Ship the `/migrate` skill** at `apps/cli/ai/skills/migrate/SKILL.md`. **Reuse RSM-3139's `migrate-site.md` body verbatim** (`prior-art/rsm-3139-spec.md`'s skill content is runtime-agnostic). Skill loader (`apps/cli/ai/skills.ts:27-51`) discovers it on startup. Note that `apps/cli/ai/skills` is not currently copied by `vite.config.prod.ts` (the same gap RSM-1639 flagged for the old `ai/plugin` path) — confirm or fix as part of this work.
6. **Register the slash command** in `tools/common/ai/slash-commands.ts:8-13`: `{ name: 'migrate', description: __('Migrate a site from a closed web platform to WordPress') }`. The existing `AI_SKILL_COMMANDS` dispatcher routes through `runAgentTurn(buildSkillInvocationPrompt('migrate'))`; the model calls the `Skill` tool.
7. **Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`** in Studio's Buildkite + GitHub Actions + `apps/cli/install:bundle` to skip Chromium download at build time. End-user `npm install -g wp-studio` pays the 150 MB cost on first install; Wix/Squarespace adapters that need Chromium will fail at runtime without it (the right place to fail; DLA's `cli.js:9-12,65-120` already bootstraps a Chromium check).
8. **Ship Subprocess as a separate `studio migrate <url>` CLI command** (not a `studio code` slash) per `wave-1-subprocess-revisit` §8. ~60 LOC; gives users a non-agent headless path. Zero conflict with the agent-side `/migrate`.
9. **Document the orphan-work behavior** for cancelled tool calls (DLA doesn't honor `notifications/cancelled`). File an upstream issue on DLA to wire `signal` / `progressToken` into its tool handlers.

**Why Bridge over Vendor for the canonical path:** Bridge ships sooner (no upstream PR or vendor-copy decision needed before code can land), its schema/output contract auto-syncs via `ListTools` at session bring-up (no schema transcription), and the migration cost from Bridge → Vendor later is small (only `agent-tool-adapter.ts` changes; the rest of `tools/dla/` shape stays). The trade — child-process lifecycle plus stdio framing — is bounded by the existing `session.dispose()` plumbing and one line of `signal`-forwarding.

**What's reusable from prior art (do not re-derive):**
- **Wrapper-skill body** for `/migrate` — `prior-art/rsm-3139-spec.md`'s `migrate-site.md` content. Runtime-agnostic.
- **Per-tool permission-policy buckets** — `prior-art/rsm-3139-spec.md`'s policy table. Runtime-agnostic. Reuse the bucket assignments (`liberate_import` = destructive, `liberate_extract` with non-dry-run = fs-write, etc.) verbatim.
- **DLA tool inventory, surfaces, `delegate: true` contract, runtime expectations** — `prior-art/wave-1-findings/wave-1-dla-inventory.md`. DLA-side facts unchanged from RSM-1639.
- **Studio build pipeline overview** — `prior-art/wave-1-findings/wave-1-bundling-distribution.md`. The SDK-specific bits are stale (re-derived in `wave-1-upstream-and-bundling`), but the pipeline shape (Vite → ASAR → electron-forge → `extraResource`) is unchanged.

---

## Open Questions

1. **Is `pi-mcp-adapter` viable as a Studio dependency?** The upstream-pi finding surfaced `pi-mcp-adapter` (npmjs.com/package/pi-mcp-adapter, 663 stars, MIT, author Nico Bailon, deps on `@earendil-works/pi-ai`) — pi's maintainer-blessed answer for MCP support. It's built on pi's public `ExtensionFactory` API, which Brief 1 confirmed Studio can reach via `DefaultResourceLoader({ extensionFactories })`. If adopted, it could turn Bridge into a thin "configure pi-mcp-adapter + register DLA's server" rather than a Studio-owned MCP-client wrapper. We chose not to investigate it for this round because (a) the Studio-owned Bridge sketch is already small (~250 LOC) using primitives already in Studio's deps, (b) adopting a single-maintainer npm dep with known bugs (issue #4326 — TUI crash on non-string tool descriptions) trades ~100 LOC for non-trivial supply-chain risk, and (c) Bridge lives in pi's `customTools` slot rather than the extension API, so migrating to pi-mcp-adapter later is a Studio-internal refactor, not a stop-energy redo. Worth a 30-minute spike before the implementation phase commits to Studio-owned wiring — if pi-mcp-adapter's design is materially nicer than the wave-1 sketch, the implementation phase can pivot.

2. **`tsx` runtime overhead vs. `dist/mcp-server.js` build step.** Both unblockers work; nobody has timed them on a packaged Studio install. Time `npx tsx src/mcp-server.ts` startup and `node dist/mcp-server.js` startup against current DLA HEAD on a cold cache (macOS + Windows + Linux); if `tsx` is < 500 ms warm, accept the ~10 MB dep cost. If it's > 1 s, run DLA's `tsc` at Studio build time.

3. **Should DLA wire `signal` / `progressToken` into its MCP tool handlers?** Currently it doesn't, so cancelled `liberate_*` calls orphan in-flight work upstream. Filesystem-bounded by DLA's resume-safe protocol, but worth fixing. Upstream issue + PR to DLA — out of RSM-3143's scope; file before implementation lands.

4. **Will `apps/cli/ai/skills` be copied by `vite.config.prod.ts`?** RSM-1639 flagged the same gap for the old `ai/plugin` directory. `wave-1-upstream-and-bundling` §3.1 confirms: prod build does not copy `ai/skills/`; runtime degrades silently to "no skills" via the `console.warn` at `apps/cli/ai/skills.ts:33-39`. Confirm whether this is a real prod-build gap or an `import.meta.dirname` resolution quirk; fix as part of the `/migrate` skill landing. **Out-of-scope flag for the Electron-side owner if the fix touches `apps/studio/`.**

5. **DLA's `liberate_preview` recursion-into-Studio.** When DLA detects `studio` on PATH it shells out to `studio site create`. The wrapper skill body should drive this via `liberate_setup` / `liberate_import` `delegate: true` (returns the manifest, Studio's `site_create` tool does the work). But the agent might call `liberate_preview` directly — Studio must either (a) override `_noStudio: true` for all `liberate_preview` calls from the bridge, or (b) trust the skill body to never invoke `liberate_preview` when Studio is host. Option (a) is safer; (b) is mechanically smaller.

6. **Permission policy: `extensionFactories` is recent (0.67.2, 2026-04-14).** Brief 1 rated the `tool_call` extension hook as medium-risk — recent regression fixes in 0.70.x. If pi 0.71+ tightens semantics, Studio's `createDlaPolicyFactory` may need touch-up. Bookmarked for the pi version-bump cycle; not a blocker.

---

## Appendix: Wave 1 brief outcomes

| Brief | Verdict | Confidence | Key finding |
|---|---|---|---|
| `wave-1-pi-extensibility-surface` | Resolves permission-gate ambiguity | High | `extensionFactories` reachable, `tool_call` hook = `canUseTool` equivalent |
| `wave-1-mcp-bridge-feasibility` | works-with-caveats | High | ~250 LOC sketch, JSON Schema cast safe, abort-server-side caveat documented |
| `wave-1-vendor-as-agenttools` | works-with-caveats | Medium-high | Build integration is real blocker; 3 unblockers spelled out |
| `wave-1-subprocess-revisit` | works-with-caveats / escape-hatch only | Medium | `delegate:true` unreachable; 6/13 tools unreachable; right shape for `studio migrate <url>` standalone |
| `wave-1-upstream-and-bundling` | upstream killed; bundling works with caveats | High | Maintainer rejected MCP-in-core; `tsx` install path needs fixing; ~200-300 MB marginal disk after prune |

All five briefs returned clean mechanical verdicts. No wave 2 required. Implementation-phase planner has enough evidence to write a spec.

---

## Sources

This report synthesizes evidence from five wave-1 research briefs in `issues/rsm-3143-dla-pi-research/wave-1-findings/`, plus preserved prior art under `issues/rsm-3143-dla-pi-research/prior-art/`. All primary evidence is sourced in the wave-1 findings themselves — see their "Sources" sections for verbatim file paths, line ranges, and command outputs.

Cross-cutting references:

- `prior-art/rsm-1639-research-report.md` — original DLA-integration research (Done). DLA-side sections still authoritative. Host-side (Approach A/B/C wired against `claude-agent-sdk`) is stale.
- `prior-art/wave-1-findings/wave-1-dla-inventory.md` — DLA inventory (MCP tools, surfaces, `delegate: true`, skill bodies). Still authoritative.
- `prior-art/rsm-3139-spec.md` — cancelled Approach C spec. The wrapper-skill body and permission-policy buckets are runtime-agnostic and reused as-is in this report's recommendation.
- `prior-art/rsm-3139-plan.md` — cancelled Approach C plan. Useful for the "Ambiguities" section which discovered the pi-coding-agent migration mid-flight.
