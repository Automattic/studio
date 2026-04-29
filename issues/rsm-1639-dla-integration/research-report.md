# RSM-1639: Bringing the Data Liberation Agent into Studio Code

**Status:** research, no code changes
**Scope:** Studio CLI (`apps/cli/`) only. Electron-side touches are flagged, never proposed.
**Deliverable framing:** What happens when a user types `/migrate` inside `studio code`?

---

## Executive Summary

The Data Liberation Agent (DLA, `Automattic/data-liberation-agent`) is not an LLM agent — it is a deterministic Node/TypeScript extraction toolkit for eight closed web platforms (GoDaddy WM, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix) that ships pre-wired as a Claude Code plugin, a Codex plugin, a Gemini extension, a generic stdio MCP server, and a thin CLI — *all driven by the same `src/mcp-server.ts` (13 tools) plus a `skills/` markdown tree*. The Claude Agent SDK that Studio Code already uses (`@anthropic-ai/claude-agent-sdk@0.2.117`) accepts both `plugins: [{ type: 'local', path }]` and `mcpServers: { <name>: stdio | sse | http | sdk }`, and DLA is shaped exactly to be consumed through both — a `.claude-plugin/plugin.json` that declares an `mcp` block plus a `skills/` directory with phased workflow markdown.

**Recommended path:** vendor DLA's plugin tree (its `.claude-plugin/`, `skills/`, `commands/`, `prompts/`, plus the `src/` it needs at runtime and any vendored PHP) under `apps/cli/ai/dla/` at a pinned git SHA via a build-time fetch script (modeled on the existing `scripts/download-agent-skills.ts`), load it as a *second* local plugin in `apps/cli/ai/agent.ts:130-149` (`plugins: [studioPluginPath, dlaPluginPath]`), boot DLA's MCP server as a stdio child-process entry alongside Studio's in-process MCP (`mcpServers: { studio: ..., 'data-liberation': { command, args, env } }`), and surface `/migrate` as a skill-based slash command that wraps DLA's `liberate` skill plus a Studio-side post-extract handoff. The user types `/migrate <url>`, the agent walks DLA's `skills/liberate/SKILL.md` workflow, calls DLA's `liberate_*` MCP tools, then on import calls `liberate_setup` / `liberate_import` with `delegate: true` — DLA returns a manifest of artifact paths, Studio's `site_create` MCP tool (already in `apps/cli/ai/tools.ts`) creates the Studio site, and Studio's existing `wp_cli` Bash plumbing imports the WXR. This shape preserves Studio's "works offline once installed" posture, gives DLA a clean version-pin point per Studio CLI release, and avoids any Electron-side change beyond fixing the (already-suspected) `vite.config.prod.ts` plugin-copy gap.

The big trade-offs we accept: DLA goes 0–6 weeks stale per Studio CLI release window (mitigated by a `/migrate --update` opt-in that re-runs the fetch script), Studio inherits DLA's ~150 MB Playwright Chromium postinstall (currently mandatory in DLA), and `permissionMode: 'auto'` extends to DLA's MCP tools by default (mitigated via `McpServerToolPolicy` allowlists per tool). Two facts are non-negotiable for picking *this* shape over alternatives: (a) DLA's `liberate_setup` / `liberate_import` already expose a `delegate: true` mode that returns a structured manifest specifically for "local dev tools with direct database/CLI access" — Studio Code is the canonical caller; (b) DLA already speaks Studio (`src/lib/preview/studio.ts`) for previews and inlines WXR via the `importWxr` blueprint step into `blueprint.studio.json` to dodge the WP-CLI 120s IPC timeout, so the integration is not greenfield.

---

## Approaches Investigated

We evaluate five integration shapes. Each names *exactly* where it plugs into the Studio CLI, what flows at `/migrate` time, and what we ship.

### A. Vendor DLA as a second local plugin + stdio MCP (recommended)

**How it works.** A build-time fetch script (sibling of `scripts/download-agent-skills.ts`) clones DLA at a pinned git SHA into `apps/cli/ai/dla/`. The directory tree is preserved verbatim — `.claude-plugin/plugin.json`, `skills/`, `commands/`, `prompts/`, `src/`, vendored PHP under `src/lib/preview/scripts/`. Vite's `viteStaticCopy` already copies `apps/cli/ai/plugin/` → `dist/cli/plugin/`; we add a second target for `apps/cli/ai/dla/` → `dist/cli/dla/` (mirror it across `vite.config.dev.ts`, `vite.config.npm.ts`, and the currently-incomplete `vite.config.prod.ts`). At runtime, `apps/cli/ai/agent.ts:130-149` becomes:

```ts
plugins: [
    { type: 'local', path: path.resolve(import.meta.dirname, 'plugin') },
    { type: 'local', path: path.resolve(import.meta.dirname, 'dla') },
],
mcpServers: {
    studio: isRemoteSite ? createRemoteSiteTools(...) : createStudioTools(...),
    'data-liberation': {
        command: 'npx',
        args: ['tsx', path.resolve(import.meta.dirname, 'dla/src/mcp-server.ts')],
        cwd: path.resolve(import.meta.dirname, 'dla'),
        env: {
            // pass through Studio's resolved Anthropic env (irrelevant for DLA itself)
            // and the WPCOM auth token for any future DLA tools that need it
            STUDIO_WPCOM_TOKEN: (await readAuthToken())?.accessToken ?? '',
        },
    },
},
```

`/migrate` is registered in `tools/common/ai/slash-commands.ts:8-13` as a skill-based command pointing at DLA's `liberate` skill (so the slash hint reads, e.g., "Migrate a site from a closed platform into Studio"). On invoke, `runAgentTurn(buildSkillInvocationPrompt('liberate'))` produces "Run the /liberate skill using the Skill tool." The SDK loads DLA's `skills/liberate/SKILL.md`, the model walks its workflow, and tool calls flow as `mcp__data-liberation__liberate_detect`, `..._discover`, `..._extract`, `..._verify`, `..._setup` (with `delegate: true`), `..._import` (with `delegate: true`). On `delegate: true` the model receives a JSON manifest (`{ wxrFile, outputDir, mediaDir, productsCsv, redirectMap, importAuthors }`) and is instructed by the skill to hand off to the host — i.e. to call Studio's `mcp__studio__site_create` with the right blueprint, then run the post-create import via Studio's existing `wp_cli` tool (which is already in the `claude_code` preset Studio enables).

**Evidence.**
- DLA's plugin manifest, MCP-tool list (13 tools, including `_preview` which auto-detects `studio` on PATH), and `delegate: true` design: `wave-1-dla-inventory.md` §3-4, §9.
- Studio's plugin path resolution and `mcpServers` extension point: `apps/cli/ai/agent.ts:80-84, 130-149` (`wave-1-studio-skill-plumbing.md` §3a, §5b/5c).
- SDK accepts `plugins: SdkPluginConfig[]` (an array — multiple `type: 'local'` plugins supported) and `mcpServers: Record<string, McpServerConfig>` with stdio child-process variant: `wave-1-claude-plugin-mechanics.md` §1, §5.
- Vendoring precedent: `scripts/download-agent-skills.ts` already fetches third-party skills at build time (`wave-1-bundling-distribution.md` §3, §5).

**Pros.**
- **No Electron-side proposal needed** beyond the `vite.config.prod.ts` plugin-copy fix (which is independently flagged as a probable existing bug).
- **Offline-correct.** Same posture as `wp-files/latest/`: DLA is bundled, no first-run network requirement.
- **Auth and credentials inherited.** DLA's MCP server doesn't need an Anthropic key (none of its tools call an LLM); WPCOM token can be passed via `mcpServers.<name>.env`.
- **Sessions / replay work without changes.** `apps/cli/ai/sessions/{recorder,replay}.ts` are tool-name-agnostic.
- **Single integration touch-point per release.** DLA is pinned by SHA; bumping it is a one-line change in the fetch script.
- **`delegate: true` is exactly the contract we want.** The manifest is small, structured, and *already exists* — we don't need DLA to change.

**Cons / costs.**
- **DLA goes stale.** 0–6 weeks behind upstream (1–2 weeks typical given `wp-studio` weekly cadence). Mitigation: a `/migrate --refresh` opt-in that re-runs the fetch script outside the npm install path, or a postinstall environment override.
- **Playwright Chromium download (~150 MB).** DLA's `postinstall: playwright install chromium` is unconditional. Adopting DLA via vendoring runs *DLA's own* postinstall when its `node_modules` are installed for the bundled CLI path. Mitigation: run DLA without its `node_modules` (DLA imports come through Studio's hoisted root `node_modules` via the workspace) — Playwright is already in the root tree (`node_modules/playwright + playwright-core` ~14 MB per `wave-1-bundling-distribution.md` §1), and Chromium auto-downloads on first use only if the adapter hits a Wix/Squarespace path. Verify before shipping.
- **`tsx` at runtime.** DLA's `.mcp.json` uses `npx tsx src/mcp-server.ts`. We must either pre-compile DLA to JS in the fetch script (TypeScript compilation pass against a pinned `tsconfig.json`) or include `tsx` as a Studio CLI runtime dep. Pre-compile is cleaner because it avoids `npx` warm-up latency at every `/migrate`.
- **Vendored PHP scripts at absolute paths.** DLA's preview path resolves `import-wxr.php` and `import-products.php` from `import.meta.url`. The fetch script must preserve `src/lib/preview/scripts/` next to the JS — which is already how `viteStaticCopy` recursively copies trees, so this is "do nothing" if we keep the directory layout.
- **Permission mode bleed.** `permissionMode: 'auto'` (Studio's mode) classifies *every* tool call across plugins; DLA's MCP tools inherit auto-approval. Mitigation: declare `tools` policies in the stdio MCP config — but `McpServerToolPolicy` per `wave-1-claude-plugin-mechanics.md` §4 only applies to `sse`/`http`/`sdk` variants, not stdio. So we either (a) restrict via skill `allowed-tools` frontmatter (we control the slash entry, so we ship our own thin "migrate" skill that calls DLA's), (b) use the `canUseTool` callback (`sdk.d.ts:1142-1145`), or (c) accept the auto-approval.

### B. Vendor DLA as a second local plugin + in-process SDK MCP

Same shape as A, but instead of spawning DLA's MCP server as a stdio child, we re-implement DLA's tool surface in-process using `createSdkMcpServer({ name: 'data-liberation', tools: [...] })` and bind directly to DLA's `src/lib/*` modules.

**Pros.** No subprocess; no `tsx`/compile step; faster invocation; cleaner permission policies via tool annotations.
**Cons.** Massive duplication — every DLA MCP tool would need a Studio-side adapter; we'd be re-deriving DLA's manifest layer instead of consuming it. Drift risk is high: the moment DLA adds a 14th tool we lose it. Also: DLA's MCP server is ~620 LOC including stateful extraction-log management; reproducing that in Studio is a fork. **Rejected** as primary path.

### C. DLA as an npm dependency

Wait for DLA to publish to npm (`name: "data-liberation"`, currently `0.1.0` and unpublished). Add to `apps/cli/package.json` dependencies and reference its plugin tree via `node_modules/data-liberation/.claude-plugin/`.

**Pros.** Semver discipline (when DLA adopts it). No vendoring scripts. Update by `npm update data-liberation`. Clean separation.
**Cons.** **Blocked today** — DLA repo has no tags, no releases, no published artifact (`wave-1-dla-inventory.md` §10). DLA being a private repo means even `git+ssh:` deps require a deploy key. Even if DLA published, Studio's npm install path uses `--no-package-lock` (`apps/cli/package.json:63`) — semver caret can drift unobserved. Future-good but **not viable now**.

### D. DLA as a runtime fetch / install

`/migrate` checks for `~/.studio/dla/` and lazy-installs DLA at first use (e.g. `git clone` or tarball fetch + `npm install`).

**Pros.** Smallest Studio CLI footprint. DLA always at HEAD.
**Cons.** **Breaks Studio's "works offline once installed" posture.** First-run network requirement. Mid-migration `npm install -g wp-studio@x` could clobber DLA's working files. Adds retry/cache/version-negotiation/security-review surface. `wave-1-bundling-distribution.md` §3 calls this "best decoupling, worst trust/security story." **Rejected.**

### E. Spawn `data-liberation` CLI as a child process from a handler-only slash command

Skip the MCP/skill route entirely. Make `/migrate` a handler-based slash (like `/preview`) that spawns DLA's `cli.js` and pipes output back via `captureCommandOutput` (precedent: `apps/cli/ai/tools.ts:225`). The agent is never invoked.

**Pros.** Simplest mental model. No SDK plugin/MCP plumbing. DLA's Ink UI shows up as terminal output.
**Cons.** **Loses the agent.** The deliverable's framing ("`/migrate` slash command in `studio code`, the AI-agent CLI") implies the agent does the orchestration: ask the user for a URL, decide platform, narrate progress, ask for credentials. A handler-only command doesn't get the model in the loop. Also: handler-only commands are NOT picked up by Electron's IPC dispatcher (`apps/studio/src/ipc-handlers.ts:295-306`) — they'd work in CLI but not in the desktop slash list. Also: DLA's Ink UI conflicts visually with `studio code`'s own TUI. **Rejected** as primary; possibly useful as an *escape hatch* (`/migrate --headless`).

---

## Comparison

| Dimension | A. Vendor + stdio MCP (rec.) | B. Vendor + in-process MCP | C. npm dep | D. Runtime fetch | E. Handler + CLI spawn |
|---|---|---|---|---|---|
| Viable today | yes | yes (lots of code) | **no** (DLA unpublished) | yes (with caveats) | yes |
| Agent in the loop | yes | yes | yes | yes | **no** |
| Offline after install | yes | yes | yes | **no** | yes (after fetch) |
| Electron-side change | none beyond `vite.config.prod.ts` fix | none beyond `vite.config.prod.ts` fix | minor | network-policy review | dispatcher gap (`/migrate` won't appear in desktop slash menu) |
| DLA staleness | 0–6 weeks (typical 1–2) | same | semver-driven (best) | none (always HEAD) | depends on bundling choice |
| Implementation cost | low–medium (fetch script + 2 lines in `agent.ts` + 1 in `slash-commands.ts`) | high (re-implement 13 tools) | low (when unblocked) | medium-high (runtime install plumbing) | low (handler), but loses agent UX |
| Auth handoff | trivial (env on `mcpServers` entry) | trivial (in-process) | trivial | env on spawn | env on spawn |
| Permission scoping | weak (auto-approve, mitigations exist) | strong (per-tool annotations) | depends | weak | n/a |
| Drift risk | low (one pin point) | **high** (re-derive every change) | low | medium | medium |
| Bundling cost | DLA tree + `node_modules` subset | DLA tree only (no MCP server bin) | DLA tree | none in installer | DLA tree |
| Precedent in repo | `download-agent-skills.ts`, plugin tree | in-process `studio` MCP | none | postinstall fetches (build-time, not runtime) | `/preview` handler |

---

## Recommendation

**Adopt Approach A: vendor DLA as a second local plugin under `apps/cli/ai/dla/` and load its MCP server as a stdio child-process entry alongside Studio's in-process MCP.** Surface `/migrate` as a skill-based slash command in `tools/common/ai/slash-commands.ts:8-13`.

### Concrete changes (CLI-only, named precisely)

1. **Build-time fetch.** Add `scripts/download-data-liberation-agent.ts` modeled on `scripts/download-agent-skills.ts`. Pins DLA by git SHA, clones a shallow checkout, runs `tsc` against DLA's tsconfig to produce `dist-vendored/`, copies the resulting tree (compiled JS + the `skills/`, `commands/`, `prompts/`, `.claude-plugin/`, vendored PHP at `src/lib/preview/scripts/`) into `apps/cli/ai/dla/`. Skip DLA's own `node_modules` install — DLA's runtime deps already overlap with Studio's hoisted root (`@modelcontextprotocol/sdk`, `@wp-playground/cli`, `playwright`, `cheerio`, etc.). Where DLA needs deps Studio doesn't have (`fast-xml-parser`, `papaparse`, `ink`), add them to the root or to `apps/cli/package.json` so the workspace hoist resolves them.
2. **Static-copy.** Add `viteStaticCopy({ targets: [{ src: 'ai/dla', dest: '.' }] })` to `vite.config.dev.ts` and `vite.config.npm.ts`. **Also fix the existing gap in `vite.config.prod.ts`:** add the same target *and* the missing `ai/plugin` target so Electron-bundled `studio code` actually loads the SDK plugin tree (this is independent of DLA but blocks the integration).
3. **Plugin wiring.** In `apps/cli/ai/agent.ts:130-149`, extend `plugins` to a two-element array with both local plugin paths.
4. **MCP wiring.** In `apps/cli/ai/agent.ts:80-84`, extend `mcpServers` to add a `'data-liberation'` stdio entry with `command: process.execPath`, `args: [path.resolve(import.meta.dirname, 'dla/src/mcp-server.js')]` (post-compile; falls back to `npx tsx ...src/mcp-server.ts` only if we keep TS-at-runtime), and `env` carrying `STUDIO_WPCOM_TOKEN` from `readAuthToken()` plus `LIBERATION_TOKEN` / `SHOPIFY_ADMIN_TOKEN` from the user's resolved Studio config.
5. **Slash command.** Add `{ name: 'migrate', description: __('Migrate a site from a closed platform into Studio') }` to `AI_SKILL_COMMANDS` in `tools/common/ai/slash-commands.ts:8-13`. The agent's slash dispatcher (`apps/cli/commands/ai/index.ts:684-705`) automatically picks this up via the existing skill flow (Flow B, `wave-1-studio-skill-plumbing.md` §1).
6. **A thin "migrate" skill in Studio's plugin** (not DLA's). Drop `apps/cli/ai/plugin/skills/migrate/SKILL.md`. Frontmatter uses `user-invocable: true` (with C — note: existing Studio skills use the kebab-K typo `user-invokable`; this is a free chance to fix it but check before changing en masse). Body: instruct the model to (a) ask for the source URL if not provided, (b) call `mcp__data-liberation__liberate_inspect`, (c) confirm platform with the user, (d) call `mcp__data-liberation__liberate_extract` with progress narration, (e) call `liberate_verify`, (f) call `liberate_setup` and `liberate_import` with `delegate: true`, (g) on the returned manifest call `mcp__studio__site_create` with the appropriate blueprint and let Studio's existing `wp_cli`-driven import paths handle the WXR. Setting `allowed-tools` to the precise list keeps the auto-permission classifier scoped.
7. **End-to-end UX (`/migrate` deliverable framing).**
   - User types `/migrate` in `studio code`.
   - Skill prompt: "What's the URL of the site you want to migrate?" (or `/migrate https://example.wixsite.com/foo` accepts inline arg via `argument-hint` frontmatter).
   - Agent calls `liberate_inspect` → narrates "Detected Wix. Found 47 pages and 12 blog posts."
   - Agent asks the user to confirm; on confirm, runs `liberate_extract`, streaming progress messages from MCP `sendLoggingMessage` (DLA already emits these per `wave-1-dla-inventory.md` §4).
   - Agent runs `liberate_verify`, surfaces any quality issues.
   - Agent calls `liberate_setup` (`delegate: true`), receives the manifest, calls `site_create` with a Studio-friendly blueprint (slug derived from the source domain), then drives the WXR import via `wp_cli import` (or via the `importWxr` blueprint step inlined into `blueprint.studio.json` if the artifact size threshold is exceeded — this is the path DLA already uses to dodge the 120s WP-CLI IPC timeout).
   - Agent ends with: "Migration complete. Your new Studio site is at http://example-migrated.localhost:8881/. Open in browser? (y/n)"

### Why this trade-off set

We are picking a path that **maximizes integration leverage from DLA's existing shape** and **minimizes blast radius in Studio CLI**. DLA already has: a Claude plugin manifest, a Skill that walks a phased migration workflow, an MCP server with a `delegate` mode designed exactly for hosts like us, working `studio` CLI integration for previews, and a 0-API-key runtime. Asking DLA to change is unnecessary; what we add to Studio is one fetch script, three lines in `agent.ts`, one line in `slash-commands.ts`, one new SKILL.md, and a missing build-config target. Approach B trades that for a fork. Approach C requires DLA to publish (it has no tags or releases yet). Approach D breaks our offline posture. Approach E loses the agent. The only material things we accept: 0–6-week DLA staleness, ~150 MB Playwright Chromium (a sunk cost the moment any user migrates from Wix/Squarespace anyway), and weak permission scoping for DLA's MCP tools (mitigable via `allowed-tools` in the wrapper skill or `canUseTool`).

---

## Open Questions

1. **`vite.config.prod.ts` plugin-copy gap** (`wave-1-bundling-distribution.md` §1, `wave-1-studio-skill-plumbing.md` §6 item 3). The Electron-bundled CLI may already be missing the existing `ai/plugin` static-copy target. Needs a 5-minute verification with a real `npm run cli:package` run before this integration ships, since DLA piggybacks on the same target. Owner: implementation phase.
2. **Permission scoping rigor.** With `permissionMode: 'auto'`, do we want DLA's MCP tools (`liberate_extract` writes to disk; `liberate_import` writes to a remote WP) to auto-approve, or do we wrap them in `canUseTool`? Recommended default: auto-approve `_detect`/`_discover`/`_inspect`/`_status`/`_verify` (read-only); ask once for `_extract` (the heavy step); always ask for `_import` if not in `delegate: true` mode. Implementation in `apps/cli/ai/agent.ts` via `canUseTool` callback (`sdk.d.ts:1142-1145`).
3. **DLA's `tsx`-at-runtime decision.** Pre-compile in the fetch script (cleaner) vs. keep `tsx` for parity with DLA's other distribution channels (lower drift). Recommend pre-compile; revisit if DLA evolves to depend on `tsx`-only behaviors (it doesn't today).
4. **Plugin name namespacing across multiple plugins.** `wave-1-claude-plugin-mechanics.md` §5 flags as unverified whether MCP tool names from a plugin-bundled MCP server collide with the same-named server passed at `query()` time. We pass `'data-liberation'` from `query()`; DLA's `.claude-plugin/plugin.json#mcp` declares the same. Worth a 10-minute test during implementation to confirm tools surface as `mcp__data-liberation__*` exactly once.
5. **Skill frontmatter spelling.** Studio's existing skills use `user-invokable` (with K) but the SDK reads `user-invocable` (with C). DLA's skills also need to use `user-invocable`. Quick `grep` check in DLA's `skills/*/SKILL.md` during implementation (orthogonal to research).
6. **Distribution mechanic for a private DLA repo.** The fetch script needs auth. Options: GitHub App token (most robust), per-user PAT (worst), public-mirror-of-tagged-releases (asks DLA team to establish a release process — which addresses Approach C blockers as a side effect). Recommend pushing DLA team for tagged public releases so Approach C unblocks long-term and we don't carry a fetch script forever.
7. **DLA's auto-cleanup of orphan Studio sites.** `src/lib/preview/studio.ts:266-279` `rmSync`s a Studio site dir under `defaultStudioRoot()` if it isn't listed by `studio site list`. With Studio Code orchestrating site creation directly, this code path may never fire — but worth confirming we don't end up double-managing the site dir.
8. **Update notifier coverage.** `apps/cli/lib/update-notifier.ts:11` only checks `wp-studio` itself. Bumping DLA bundles a new CLI version, so the notifier's existing nudge ("update to wp-studio@1.x.y") implicitly covers DLA updates — acceptable.

---

## Sources

- `issues/rsm-1639-dla-integration/findings/wave-1-dla-inventory.md`
- `issues/rsm-1639-dla-integration/findings/wave-1-studio-skill-plumbing.md`
- `issues/rsm-1639-dla-integration/findings/wave-1-claude-plugin-mechanics.md`
- `issues/rsm-1639-dla-integration/findings/wave-1-bundling-distribution.md`
- `issues/rsm-1639-dla-integration/research-plan.md` (running findings log)
