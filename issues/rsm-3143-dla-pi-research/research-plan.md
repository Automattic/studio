# RSM-3143 Research Plan — DLA integration into `studio code` (pi-coding-agent runtime)

**Status:** Wave 1 complete; synthesis written. No wave 2 needed.

## Context

The original DLA-integration research (RSM-1639) closed with a recommendation tuned to the `@anthropic-ai/claude-agent-sdk` host runtime. Two upstream changes invalidate the host-side portions of that report:

1. **DLA went public** (`Automattic/data-liberation-agent`, 2026-05-07). The "private repo → no `github:` deps" constraint that killed Approach C in RSM-1639 is gone.
2. **Studio CLI migrated to `@mariozechner/pi-coding-agent@0.70.2`** (PR #3360, commit `406b7494`, 2026-05-07). The wiring shapes the original report leaned on — `Options.mcpServers`, `Options.plugins`, `canUseTool`, `apps/cli/ai/agent.ts` — no longer exist on trunk. pi-coding-agent accepts a flat `customTools: ToolDefinition[]` and an opaque `tools: string[]` allowlist; **there is no MCP server slot, no plugin slot, and no `canUseTool` permission hook** in the public SDK.

The DLA-side findings (its MCP tools, the `delegate: true` contract, skill content, runtime needs) **are still valid** and must not be re-tasked. See `prior-art/wave-1-findings/wave-1-dla-inventory.md` and the DLA-side sections of `prior-art/rsm-1639-research-report.md`.

The wrapper-skill content and the per-tool permission-policy buckets from `prior-art/rsm-3139-spec.md` are **runtime-agnostic** and reusable — wave-2 researchers should not re-derive them.

## Revised research question

> Given the pi-coding-agent runtime currently shipping in `apps/cli/`, what is the cleanest mechanically-compatible way to land a `/migrate` (or equivalent) slash command driven by DLA's tools, and what does that wiring look like end-to-end?

## Sub-questions

1. **pi extensibility surface:** What does the public API of `pi-coding-agent@0.70.2` actually let us bolt on? `customTools` and `tools` allowlist are obvious; are there hooks (`beforeToolCall`/`afterToolCall`, extensions, source-info, session events) that aren't surfaced via `createAgentSession` but are reachable through the lower-level `AgentSessionRuntime`/`AgentSessionServices` builders? What's the realistic ceiling on permission gating, prompt injection, and slash-command registration without forking?
2. **MCP-bridge approach:** Mechanically, how does an MCP **client** wrapping DLA's stdio MCP server look against pi? Concretely: spawn the DLA child, `ListTools` at session start, wrap each remote tool as a pi `AgentTool` whose `execute` calls `CallTool`. What goes wrong (lifecycle, startup latency, ListTools failures, abort propagation, output adaptation to pi's `{content, details}` shape)? Is this mechanically equivalent to the RSM-1639 Approach A bridge, just one level lower?
3. **Vendor-as-AgentTools approach:** Could we import `data-liberation/src/lib/...` modules directly and write Studio-owned pi `AgentTool` definitions that call DLA internals? What's DLA's actual internal API shape — is `src/lib/` self-contained enough to vendor, or does it depend on the MCP server's session state, the CLI's UI layer, or other host plumbing? What does the maintenance contract look like (DLA does not expose `src/lib` as a public API)?
4. **Subprocess approach (revisit Approach E):** The original report rejected "spawn the DLA CLI from a slash command" because it took the agent out of the loop. Against pi, can we re-shape this as a single pi `AgentTool` that wraps the DLA CLI as a child process — agent in the loop, DLA as black box, output streamed back? Where does this fall down (interactive prompts, multi-step UX, sub-agent reasoning DLA's MCP path would have provided)?
5. **Upstream-pi approach:** What is the maintainer relationship and release cadence for `@mariozechner/pi-coding-agent`? Is "land MCP support upstream" realistic on the timeline RSM-3143 cares about, and if so what would the upstream contract look like? Is there a maintainer-blessed extension API we should be using instead of `customTools`?
6. **Distribution & bundling:** RSM-1639's `wave-1-bundling-distribution.md` enumerated Studio's CLI build pipeline; what changes given (a) DLA is now an installable public dep (`github:Automattic/data-liberation-agent#<sha>` or `npm`/tarball), and (b) DLA spawns via `npx tsx src/mcp-server.ts` at runtime — does this still pass through Studio's `vite build` + electron-forge packaging without surprise?
7. **Wrapper-skill + slash-command integration:** Given Studio's skill loader (`apps/cli/ai/skills.ts`) and the `AI_SKILL_COMMANDS` registry pattern, what is the smallest change that lights up `/migrate`? Reuse RSM-3139's wrapper-skill body (`migrate-site.md`) and per-tool permission policy buckets — confirm those are runtime-agnostic and identify the integration seams (skill load, slash-command registration, tool gating per the policy buckets when pi has no `canUseTool`).
8. **Synthesis & recommendation:** Side-by-side comparison of the surviving approaches against pi, with a recommended path forward.

## What's still valid from RSM-1639 (DO NOT re-investigate)

- DLA inventory: surfaces, MCP tools, skill content, manifests, runtime expectations, output shapes (`wave-1-dla-inventory.md`).
- DLA's `delegate: true` handoff contract (covered in `prior-art/rsm-1639-research-report.md`).
- DLA's end-to-end UX walk (liberate → inspect → adapt → import → verify; covered in `prior-art/rsm-1639-research-report.md`).
- Studio build pipeline at a coarse level (`wave-1-bundling-distribution.md`); SDK-specific bundling claims are stale and will be re-derived in sub-question 6.
- Wrapper-skill content + per-tool permission policy buckets (`rsm-3139-spec.md`), as runtime-agnostic reusable concepts.

## What's stale (and explicitly out of scope to investigate)

- `wave-1-studio-skill-plumbing.md` — describes the deleted `claude-agent-sdk` plumbing.
- `wave-1-claude-plugin-mechanics.md` — describes the deleted SDK contract.
- The Approach A/B/C tables in `rsm-1639-research-report.md` (host-side wiring sections only).

## Wave 1 task plan

Five parallel briefs cover sub-questions 1–6. Wrapper-skill + slash-command integration (sub-question 7) folds naturally into Brief 1's surface mapping plus Brief 4's vendoring exercise — it does not need a standalone task. Sub-question 8 (synthesis) is the research-lead's job in the final report.

| Brief | Sub-questions | Title |
|---|---|---|
| `wave-1-pi-extensibility-surface.md` | 1, 7 | Map pi-coding-agent's third-party extensibility ceiling |
| `wave-1-mcp-bridge-feasibility.md` | 2 | Prove out the MCP-stdio-to-AgentTool bridge against pi |
| `wave-1-vendor-as-agenttools.md` | 3 | Evaluate vendoring DLA's `src/lib/` as Studio-owned AgentTools |
| `wave-1-subprocess-revisit.md` | 4 | Re-evaluate the subprocess approach (Approach E) against pi |
| `wave-1-upstream-and-bundling.md` | 5, 6 | Upstream-pi feasibility + DLA bundling/distribution against pi |

Each brief is a self-contained markdown file under `issues/rsm-3143-dla-pi-research/tasks/`.

## Wave 1 findings log

| Brief | Status | Key takeaway |
|---|---|---|
| wave-1-pi-extensibility-surface | complete | `extensionFactories` via `DefaultResourceLoader` IS reachable from public `createAgentSession`. Inline factories load even when `noExtensions: true`. `pi.on('tool_call', handler)` returning `{block: true, reason}` provides clean per-tool permission gating — settles the open `canUseTool` gap. `pi.registerTool` and `pi.registerCommand` reachable too, but for `/migrate` the existing `AI_SKILL_COMMANDS` + Studio `Skill` tool pattern is structurally smaller. MCP confirmed absent in pi 0.70.2 (zero `mcp`/`MCP` matches outside vendored highlight-tables). 0.70.2 is three minors behind npm latest (0.73.1); `extensionFactories` was added in 0.67.2 — recent surface, treat as semver-loose. |
| wave-1-mcp-bridge-feasibility | complete | Bridge mechanically sound. `@modelcontextprotocol/sdk@1.29.0` (not 1.27.1) installed; `Client` + `StdioClientTransport` typed; pi-ai accepts plain JSON Schema in `parameters` (explicit `!hasTypeBoxMetadata && isJsonSchemaObject` branch at `validation.js:253-280`) — schema cast is safe at runtime. DLA emits text-only (no `structuredContent`), simplifying the adapter. Caveats: DLA doesn't honor `notifications/cancelled` (orphans server-side work on abort); permission gating via `canUseTool` is absent but resolved by Brief 1's `tool_call` extension hook; `npx tsx` cold start should be replaced with `node <dla>/dist/mcp-server.js` after a build step. End-to-end wiring sketched: ~250 LOC under `tools/dla/` (a sibling workspace package alongside `tools/common/`, consumed from `apps/cli/` as `@studio/dla`; the wave-1 sketch used `apps/cli/ai/dla/` for the same module shape — relocated to `tools/dla/` per owner direction), one new param to `buildAgentTools`, dispose hook in the existing `finally` block at `runtimes/pi/index.ts:222-225`. |
| wave-1-vendor-as-agenttools | complete | Vendoring is mechanically possible and cleaner at runtime (no IPC, no child, no `tsx`). `src/lib/` is genuinely vendor-able — MCP `Server` is a type-only optional import (defensive `?.` usage), no Ink/UI leaks. 7/13 tools are clean pass-throughs; 6/13 need 15-50 LOC of handler-mirroring re-derivation from `src/mcp-server.ts`. `delegate: true` is purely MCP-server-side — Studio wrappers re-implement it as ~15 lines of literal-object construction (**easier** than via bridge). Real blocker is build integration: DLA ships TS only — no `dist/`, no `main`/`exports`, no `prepare` script. Studio's Vite externalizes deps so the bundled CLI would crash importing `.ts`. Three unblockers: (1) upstream `prepare: tsc` PR, (2) Studio runs `tsc` against DLA after install, (3) vendor copy via git submodule. Vendor-via-submodule preferred. Schema/output drift risk is medium-low (13 tools, stable for 14+ days). `liberate_preview` has a recursion-into-Studio hazard via `isStudioAvailable()` requiring a `_noStudio: true` shim. Playwright Chromium ~150 MB postinstall is shared with Bridge. |
| wave-1-subprocess-revisit | complete | Works with caveats — viable as escape-hatch / `--headless` mode, not canonical. Wrapping subprocess spawn in an `AgentTool` keeps the agent in the loop (improving on Approach E's "no-agent" rejection). But: DLA's CLI has no `--json` mode (model consumes ANSI-stripped terminal text); 6 of 13 MCP-only tools (`liberate_detect`, `liberate_discover`, `liberate_map_apis`, `liberate_probe`, `liberate_status`, `liberate_preview_stop`) are unreachable from CLI; `delegate: true` is structurally absent (CLI `import` always REST-imports — defeats most of the value); bare-URL extract bundles detect+discover+extract into one Ink run, agent loses phase observability. Single-tool wrapper ~60 LOC (must use raw `AgentTool` not `defineTool` — Studio's `defineTool` drops `signal`/`onUpdate`). Latency: `tsx`-startup is ~100-300 ms warm — dominated by network for real work. Right shape for a `studio migrate <url>` non-agent CLI command or a fallback if Bridge fails. |
| wave-1-upstream-and-bundling | complete | Upstream-pi: killed. Maintainer publicly closed issue #563 (Jan 2026) with "we don't need to add an MCP example anymore" — blessed answer is third-party `pi-mcp-adapter`. Repo just renamed to `earendil-works/pi`, mid-refactor, drive-by PRs auto-closed. Realistic timeline 8-16 weeks; slower than in-tree. **Worth a wave-2 note:** `pi-mcp-adapter` itself (npm package, 663 stars, MIT, deps on `@earendil-works/pi-ai`) could potentially be used as a Studio dep to shortcut Bridge's wiring — but it's tied to pi's extension surface and has known bugs (issue #4326). Bundling: `github:Automattic/data-liberation-agent#<sha>` deps install cleanly in `npm install --omit=dev`; lockfile resolves to git+ssh URL with HTTPS fallback for public repos; CI/Buildkite/`npm ci` compatible. Bridge's `npx tsx` path BLOCKED as written — `tsx` is in DLA's `devDependencies` (dropped by `--omit=dev`), `npx` not on PATH in packaged Electron CLI. Three fixes: (A) add `tsx` to `apps/cli` deps and spawn `<bundled-node> node_modules/.bin/tsx ...`, (B) build-time `tsc` against DLA, (C) Vite pre-bundle DLA's MCP server. Option A preferred. Playwright Chromium ~150 MB postinstall — mitigate with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in build pipeline. Marginal disk: ~200-300 MB in `apps/cli` after Studio's existing prune steps. Licenses clean (MIT/GPL/ISC/BSD/Apache — all GPL-2.0-compatible). |

## Wave-2 decision

**No wave 2.** All five briefs returned clean mechanical verdicts. Bridge has a complete end-to-end sketch; Vendor has a complete end-to-end sketch with named unblockers; Subprocess and Upstream are rank-orderable against them with evidence. The "research-complete" criteria are met.

The one open question worth recording: **`pi-mcp-adapter` (npmjs.com/package/pi-mcp-adapter) was surfaced by the upstream-pi finding but not investigated**. It would route the Bridge through pi's extension API rather than through `customTools`, potentially shrinking Studio-owned code. We choose not to spin a wave-2 task on it because:

1. The Studio-owned Bridge sketch is already small (~250 LOC) and uses primitives Studio already has — adding an external single-maintainer dep with known bugs (#4326 TUI crash) to save ~100 LOC is a net loss.
2. Brief 1 already proved Studio can reach pi's extension API directly via `DefaultResourceLoader({ extensionFactories })`; if we ever want pi-mcp-adapter's mechanics, we can re-derive them in 1-2 days against pi's documented `ExtensionAPI`.
3. The Bridge sketch is independent of pi's extension API — it lives in `customTools`. Migrating from `customTools` to extension-API later would be a Studio-internal refactor, not a stop-energy redo.

Filed as an open question in the synthesis report.

## Research-complete vs wave-2 criteria

Wave 1 is **sufficient** if all five briefs return with:

- A clear mechanical verdict ("works" / "works with caveats X, Y" / "blocked by Z") rather than speculation.
- For Bridge and Vendor: an end-to-end wiring sketch concrete enough that a planner could turn it into a spec next turn.
- For Subprocess and Upstream: enough evidence to rank-order them against the leading approach (not necessarily an end-to-end sketch).
- For Bundling: a yes/no on whether the chosen approach packages cleanly through `cli:build` + electron-forge.

A **wave 2** is needed if any of:

- Bridge or Vendor turns up ambiguity that blocks a recommendation (e.g. an unresolved abort-signal or lifecycle pitfall that needs a small spike to settle).
- A new approach the prior research didn't surface emerges from Brief 1's API mapping (e.g. an extension hook that wasn't on the candidate list).
- DLA's `src/lib/` turns out to have non-obvious coupling that needs a follow-up vendoring sanity check.
- Permission-gating story for pi can't be settled in Brief 1 alone (e.g. requires testing a `beforeToolCall` hook via the lower-level runtime API).

The deliverable at the end is a **research report + PR description** (no code changes), per the RSM-1639 deliverable shape.
