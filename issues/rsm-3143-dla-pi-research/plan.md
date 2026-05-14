# RSM-3164 Implementation Plan

> **Note:** The command was renamed from `/migrate` to `/liberate` (and `studio migrate` to `studio liberate`) post-implementation per owner direction (see latest rename commit on this branch). This plan preserves the original `/migrate` task descriptions as evidence of the implementation conversation.

Spec: `issues/rsm-3143-dla-pi-research/research-report.md` ("Recommendation" → 9 concrete next steps).

Scope: `apps/cli/` and `tools/dla/` (new workspace package). No changes to `apps/studio/`.

Branch / PR: lands on `rsm-3143-dla-pi-research`, same PR (#3478).

## Ordering & dependencies

T1 (workspace scaffolding) is the foundation — it unblocks T3 (bridge), T4 (policy extension), and T6 (`studio code` wiring). T2 (deps) is parallelizable with T1. T5 (skill) and T7 (slash-command) are independent and can land in any order after T1. T8 (`studio migrate`) only needs T2. T9 (Playwright env) is independent. T10 and T11 are docs and depend on T2-T8 being merged.

Suggested order: T1 → T2 → T3 → T4 → T6 → T5 → T7 → T8 → T9 → T10 → T11.

## Ambiguities resolved while planning

1. **`tsconfig.base.json` path-alias plan from the spec is stale.** The repo's root `tsconfig.base.json` has no `paths` block — path aliases live in `apps/cli/tsconfig.json` (`"@studio/common/*": [ "tools/common/*" ]`). T1 adds the `@studio/dla/*` entry in `apps/cli/tsconfig.json` (not `tsconfig.base.json`).
2. **`@studio/common` is consumed as a `devDependencies` entry with the `file:` protocol** (`apps/cli/package.json:75`: `"@studio/common": "file:../../tools/common"`). T2 mirrors that for `@studio/dla`.
3. **`vite.config.prod.ts` is missing the `ai/skills` static-copy target** — confirmed by reading all three configs. `dev.ts` and `npm.ts` both have it; `prod.ts` doesn't. T5 fixes it as part of skill landing (instead of a standalone task — the gap blocks the prod build of the new skill).
4. **The DLA SHA `17219c42b0420267302b138bf402930508006e0e` still points to HEAD of `Automattic/data-liberation-agent`** (verified via `git ls-remote`), so the spec's pin is current — no need to bump.
5. **Bridge file layout uses `tools/dla/` (workspace package), not `apps/cli/ai/dla/`** (owner direction; sketch in `wave-1-mcp-bridge-feasibility` §6 used the old path).
6. **Owner files the upstream DLA `signal`/`progressToken` issue manually** (step 9 in spec) — planner only ensures the orphan-work caveat is documented in the design doc (T11). No task created for filing the upstream issue.
7. **`@modelcontextprotocol/sdk` is already in `apps/cli/package.json` as `^1.27.1`** (resolved to 1.29.0 per wave-1 findings) — no new MCP-SDK dep needed.
8. **`tsconfig.json` for `tools/dla/`** mirrors `tools/common/tsconfig.json` exactly (`composite: true`, `emitDeclarationOnly: true`).
9. **`runAgentSessionTurn` finally block teardown** lives at `apps/cli/ai/runtimes/pi/index.ts:222-225`; bridge dispose hooks in there. `createStudioAgentSession`'s `DefaultResourceLoader` construction is at lines 256-267 — that's where `extensionFactories` plugs in.
10. **No separate test tasks** — tests live in the same task as implementation per the orchestrator instructions.

---

## Tasks

### T1 — [code] Scaffold `tools/dla/` workspace package

**What:** Create `tools/dla/` as a sibling workspace package to `tools/common/`. Add:

- `tools/dla/package.json` with `name: "@studio/dla"`, `private: true`, `version: "1.0.0"`, `type: "module"`. List dependencies that the bridge code will import (`@modelcontextprotocol/sdk`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent` — confirm whether dev- or runtime-dep based on how `tools/common` does it; the pi packages are devDeps in `tools/common`). Scripts mirror `tools/common`: `build`, `lint`, `typecheck`.
- `tools/dla/tsconfig.json` mirroring `tools/common/tsconfig.json` (composite, declaration-only).
- Empty `tools/dla/index.ts` placeholder exporting an empty object (will be filled in T3).
- Add `@studio/dla` path alias to `apps/cli/tsconfig.json` `paths`: `"@studio/dla/*": [ "tools/dla/*" ]`.
- Add `@studio/dla` resolve alias to `apps/cli/vite.config.base.ts` mirroring the `@studio/common` entry.
- Add `"@studio/dla": "file:../../tools/dla"` to `apps/cli/package.json` `devDependencies`.

**Acceptance criteria:**
- `npm install` succeeds.
- `npm run typecheck` in `apps/cli/` resolves `import {} from '@studio/dla'` (no module-not-found).
- `npm run cli:build` (dev config) succeeds.
- A simple vitest in `apps/cli/tests/` importing `@studio/dla` resolves without error.

**Files likely involved:**
- `tools/dla/package.json` (new)
- `tools/dla/tsconfig.json` (new)
- `tools/dla/index.ts` (new, placeholder)
- `apps/cli/tsconfig.json`
- `apps/cli/vite.config.base.ts`
- `apps/cli/package.json`

---

### T2 — [code] Add `data-liberation` + `tsx` to `apps/cli/` dependencies

**What:**
- Add to `apps/cli/package.json` `dependencies`:
  - `"data-liberation": "github:Automattic/data-liberation-agent#17219c42b0420267302b138bf402930508006e0e"`
  - `"tsx": "^4.19.0"` (or whatever current major)
- Run `npm install`. Verify lockfile updates cleanly.
- Verify `node_modules/data-liberation/src/mcp-server.ts` is present after install.
- Verify `node_modules/.bin/tsx` exists.

**Acceptance criteria:**
- `npm install` succeeds without flagging missing peerDeps or hash mismatches.
- `node node_modules/data-liberation/src/cli.ts --help` (run through tsx) prints a usage banner.
- Lockfile diff is reviewable (no unrelated bumps).

**Files likely involved:**
- `apps/cli/package.json`
- `package-lock.json` (root)

---

### T3 — [code] Implement the MCP-stdio bridge in `tools/dla/`

**What:** Implement the bridge per `wave-1-mcp-bridge-feasibility` §6 (now living at `tools/dla/` instead of `apps/cli/ai/dla/`).

Files (all under `tools/dla/`):

- `bridge.ts` — `DlaBridge` class wrapping `Client` + `StdioClientTransport`. Spawns `process.execPath` with `[ tsxImport, mcpServerEntry ]` (use `createRequire(import.meta.url).resolve('tsx')` and `createRequire(...).resolve('data-liberation/src/mcp-server.ts')`). `connect()` calls `client.connect(transport)` then `client.listTools(undefined, { signal: AbortSignal.timeout(10_000) })`. Caches the raw tool list. `dispose()` calls `client.close()`; belt-and-braces `process.kill(pid, 'SIGKILL')` after a 2s grace period.
- `agent-tool-adapter.ts` — `adaptRemoteTool(client, remoteTool, policy)` → returns an `AgentTool`. Schema cast is `inputSchema as unknown as TSchema`. `execute` forwards `signal` into `client.callTool(_, _, { signal })`. On `result.isError`, throws with the first text content; otherwise maps `result.content` via `content-adapter.ts` and surfaces `result.structuredContent` as `details`.
- `content-adapter.ts` — `mcpContentToPiContent()` mapper: keep `text`/`image`; flatten `resource` text-variant; serialize `resource_link` into a `text` block; drop `audio` with a console.warn.
- `policy.ts` — `createDlaPolicyFactory(buckets)` returns an `ExtensionFactory` that subscribes to `pi.on('tool_call', ...)`. Buckets per RSM-3139 (`liberate_detect/discover/inspect/status/verify/setup/preview_stop/map_apis/probe` = safe; `liberate_extract/qa/preview` = fs-write; `liberate_import` = destructive). Defense-in-depth: hard-block `liberate_import` when `args.delegate !== true`. (This file is the policy extension factory only; the wiring to `DefaultResourceLoader` lives in T4.)
- `index.ts` — exports `startDlaBridge(opts): Promise<DlaBridge>`, the `DlaBridge` type, and `createDlaPolicyFactory(buckets)`.

Tests (in `tools/dla/__tests__/` or wherever `tools/common` puts its tests):
- Schema cast: pass a hand-rolled MCP-style `{ type: 'object', properties, required }` through `adaptRemoteTool` and assert the returned `AgentTool.parameters` is the same object reference (or shape-equivalent) and that `pi-ai`'s `validateToolArguments` (mocked or real) accepts a valid arg payload.
- Content adapter: text passthrough, image passthrough, resource text-flattening, resource_link serialization, audio drops with warning.
- Policy: each bucket → expected verdict (`safe` → undefined return, `destructive` → `{ block: true, reason }`, `liberate_import` with `delegate: true` → no block, `liberate_import` without `delegate` → block).
- Bridge lifecycle: mock `Client.connect` / `listTools` / `close`; assert `startDlaBridge` returns expected `tools` array and `dispose()` calls `client.close()`.

**Acceptance criteria:**
- `tools/dla/__tests__/*.test.ts` all pass via `npm test`.
- `npm run typecheck` in `apps/cli/` passes (importing `@studio/dla` resolves all exports).
- No `any` casts beyond the `inputSchema as unknown as TSchema` line (which gets an eslint-disable comment with a link to wave-1 findings §2).

**Files likely involved:**
- `tools/dla/bridge.ts` (new)
- `tools/dla/agent-tool-adapter.ts` (new)
- `tools/dla/content-adapter.ts` (new)
- `tools/dla/policy.ts` (new)
- `tools/dla/index.ts` (filled in from T1 placeholder)
- `tools/dla/__tests__/*.test.ts` (new)

---

### T4 — [code] Wire the DLA policy extension factory into the pi runtime

**What:** In `apps/cli/ai/runtimes/pi/index.ts`:

- Import `createDlaPolicyFactory` from `@studio/dla`.
- At the `DefaultResourceLoader` construction site (lines 256-267), add `extensionFactories: [ createDlaPolicyFactory(DLA_PERMISSION_BUCKETS) ]` (or whatever the canonical bucket constant exports as from `@studio/dla`).
- Verify `noExtensions: true` does NOT suppress inline `extensionFactories` (per wave-1 findings — confirmed at `resource-loader.js:272-278`). No other DefaultResourceLoader flag changes.

Tests:
- Unit test in `apps/cli/ai/tests/`: assert that constructing the runtime with `customTools` containing a `liberate_import` tool, and prompting with an arg `{ delegate: false }`, results in a blocked tool call (mock the `pi.on('tool_call', ...)` event chain).
- Snapshot/assertion test that `extensionFactories` is populated when DLA is enabled.

**Acceptance criteria:**
- New unit tests pass.
- `npm test` for `apps/cli/` green.
- Manual smoke check: `npm run cli:build && node apps/cli/dist/cli/main.mjs code` starts without crashing (no extensions runtime error).

**Files likely involved:**
- `apps/cli/ai/runtimes/pi/index.ts`
- `apps/cli/ai/tests/runtime-dla-policy.test.ts` (new)

---

### T5 — [code] Ship the `/migrate` skill + fix `vite.config.prod.ts` skills-copy gap

**What:**
- Create `apps/cli/ai/skills/migrate/SKILL.md` reusing RSM-3139's skill body conceptually (`prior-art/rsm-3139-spec.md` §5). Verify the tool list at the top of the SKILL matches the actual DLA tool surface at HEAD (13 tools per `wave-1-dla-inventory.md`). The body is runtime-agnostic but the bridged tool names are bare (`liberate_inspect`, not `mcp__data-liberation__liberate_inspect`) because the bridge adapter forwards them as customTools, not as MCP-prefixed tools. Frontmatter must use `name: migrate`, `description: ...`, `user-invocable: true` (with C — not the existing typo in other skills; per RSM-3139 §5).
- Fix `apps/cli/vite.config.prod.ts`: add the `viteStaticCopy({ targets: [{ src: 'ai/skills', dest: '.' }] })` plugin to match `vite.config.dev.ts` and `vite.config.npm.ts`. Without this, the prod-bundled CLI ships without the new skill (and any existing skills) and `loadSkills()` falls back to the empty list with a warning.

Tests:
- Snapshot/parser test in `apps/cli/ai/tests/` that loads the `migrate` skill via `loadSkills()`/`findSkill('migrate')` and asserts `name`, `description`, and a known string from the body are present.
- Assert that the SKILL.md frontmatter contains `user-invocable: true` (not `user-invokable`).

**Acceptance criteria:**
- `findSkill('migrate')` returns the skill body.
- `npm run cli:build` (prod config) emits `dist/cli/ai/skills/migrate/SKILL.md`.
- Skill body references real DLA tool names (no `mcp__data-liberation__` prefix, no stale `liberate_preview` if the skill says Studio drives site creation).

**Files likely involved:**
- `apps/cli/ai/skills/migrate/SKILL.md` (new)
- `apps/cli/vite.config.prod.ts`
- `apps/cli/ai/tests/skills.test.ts` (new or extended)

---

### T6 — [code] Wire DLA bridge bring-up + teardown into `studio code` session

**What:** In `apps/cli/ai/runtimes/pi/index.ts`:

- Extend `runAgentSessionTurn` to call `startDlaBridge(...)` before `createStudioAgentSession`; cache the returned `DlaBridge` in scope. Use a feature-flag env var (e.g. `STUDIO_DLA_ENABLED`) to make it opt-in for v1.
- Thread the `DlaBridge` (or `undefined`) into `createStudioAgentSession` as a new parameter.
- In `createStudioAgentSession`, pass `dlaBridge` into `buildAgentTools`.
- Extend `buildAgentTools(config, isForkedByDesktop, remoteSession, dlaBridge?)` to spread `dlaBridge?.tools ?? []` into the returned `customTools` array. Keep the existing structural analog (`wpcom_request` tool ordering) in mind — the DLA tools belong in the local-site branch (not the remote-site branch, per spec § Cons / recursion-into-Studio hazard).
- In the `finally` block at lines 222-225, add `await dlaBridge?.dispose()` after `session?.dispose()`.
- On bridge bring-up failure (timeout, spawn error), log a warning via the existing `Logger` and continue without DLA tools (graceful degradation — skill body handles "tools missing" preflight).

Tests:
- Mock `startDlaBridge` to return a stub with `tools: [<fake AgentTool>]` and assert that `buildAgentTools(..., bridge)` includes the fake tool in the customTools array.
- Mock bridge bring-up failure and assert the runtime still constructs successfully with `dlaTools = []`.
- Assert `dispose()` is called in `finally` when an error throws mid-session.

**Acceptance criteria:**
- `npm test` for `apps/cli/` green.
- Manual smoke check with `STUDIO_DLA_ENABLED=1`: `studio code` starts; `liberate_detect` shows up in the tool list. With env unset: existing behavior unchanged.
- No DLA child spawned when `STUDIO_DLA_ENABLED` is unset (idle-cost protection).

**Files likely involved:**
- `apps/cli/ai/runtimes/pi/index.ts`
- `apps/cli/ai/tests/runtime-dla-bridge.test.ts` (new)

---

### T7 — [code] Register `/migrate` slash command

**What:** Append a `{ name: 'migrate', description: __('Migrate a site from a closed web platform to WordPress') }` entry to `AI_SKILL_COMMANDS` in `tools/common/ai/slash-commands.ts`. The existing dispatcher (`apps/cli/commands/ai/index.ts:600-633`) auto-routes handler-less skill commands through `runAgentTurn(buildSkillInvocationPrompt('migrate'))`.

Tests:
- Extend `tools/common/__tests__/` (or wherever `AI_SKILL_COMMANDS` is currently tested) to assert the `migrate` entry exists.
- Assert that `buildSkillInvocationPrompt('migrate')` returns the literal `"Run the /migrate skill using the Skill tool."`.

**Acceptance criteria:**
- `/migrate` appears in the autocomplete list when running `studio code` interactively.
- Tests for `AI_SKILL_COMMANDS` membership pass.

**Files likely involved:**
- `tools/common/ai/slash-commands.ts`
- `tools/common/__tests__/slash-commands.test.ts` (new or extended)

---

### T8 — [code] Ship `studio migrate <url>` standalone CLI command (Subprocess approach)

**What:** Add a new yargs command at `apps/cli/commands/migrate/` (and register it in `apps/cli/commands/index.ts` or wherever the command registry lives). The command spawns DLA's CLI as a child process (~60 LOC, per `wave-1-subprocess-revisit` §6). Reference shape:

- `studio migrate <url>` → `<bundled-node> apps/cli/node_modules/.bin/tsx node_modules/data-liberation/src/cli.ts <url> --non-interactive [...flags]`.
- Pass through `--output`, `--limit`, `--token`, `--admin-token`, `--shop-domain`, `--non-interactive`, `--dry-run`.
- Forward stdio (stream child stdout/stderr to user's terminal — no ANSI stripping needed when we own the terminal).
- Set `NO_COLOR=1` only if not a TTY.
- Exit with the child's exit code.

Tests:
- Mock `child_process.spawn`; assert correct argv, env, cwd.
- Assert `studio migrate --help` prints usage including pass-through flags.
- Assert exit code propagation.

**Acceptance criteria:**
- `studio migrate --help` prints usage.
- `studio migrate http://example.com --dry-run` invokes DLA's CLI with the right argv (verified via test mock).
- `npm test` for `apps/cli/` green.

**Files likely involved:**
- `apps/cli/commands/migrate/index.ts` (new)
- `apps/cli/commands/migrate/__tests__/index.test.ts` (new)
- `apps/cli/index.ts` or `apps/cli/commands/index.ts` (registry update)

---

### T9 — [code] Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in build pipelines

**What:** Add `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` as an env var in:

- `.buildkite/pipeline.yml` (the agent block(s) that run `npm install` / `cli:build`).
- `.buildkite/release-build-and-distribute.yml` (release pipeline `install` steps).
- Any GitHub Actions workflow that runs `npm install` (`.github/workflows/publish-npm-package.yml` is the obvious one; check others).
- `apps/cli/package.json` `install:bundle` script — prefix with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (or restructure to a `cross-env` invocation if cross-platform is needed).

End-user `npm install -g wp-studio` pays the 150 MB Chromium download on first install (intentional — Wix/Squarespace adapters need it at runtime).

**Acceptance criteria:**
- All three CI/build config files set the env var.
- `apps/cli/install:bundle` script skips Chromium download (verify by dry-running or by checking the env var is exported before `npm install`).
- A note in `apps/cli/README.md` (covered in T10) mentions the end-user install cost.

**Files likely involved:**
- `.buildkite/pipeline.yml`
- `.buildkite/release-build-and-distribute.yml`
- `.github/workflows/publish-npm-package.yml`
- `.github/workflows/build-php-cli-binaries.yml` (if it touches `npm install`)
- `apps/cli/package.json` (`scripts.install:bundle`)

---

### T10 — [docs] Add "Migrate from a closed platform" section to `apps/cli/README.md`

**What:** Add a new top-level section between "Studio Code" and "Import and export" in `apps/cli/README.md`. Update the table of contents.

Content (cover):
- What DLA is (one paragraph) and which 8 platforms it supports (GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix).
- Two invocation modes:
  - **Inside `studio code` (agent mode):** `/migrate <url>` (mention behind feature flag `STUDIO_DLA_ENABLED=1` if still gated). Walks through inspect → extract → verify → site-create → import.
  - **Standalone:** `studio migrate <url>` for the non-agent headless flow.
- Optional `LIBERATION_TOKEN` (Webflow) / `SHOPIFY_ADMIN_TOKEN` (Shopify) env vars.
- Note about Playwright Chromium download (~150 MB on first install for end users).
- Brief "Powered by [Data Liberation Agent](https://github.com/Automattic/data-liberation-agent)" credit.

**Acceptance criteria:**
- README ToC has a "Migrate from a closed platform" entry pointing to the new section.
- The section reads end-to-end without referring to internals (no MCP, no `tools/dla/`, no extension factories).
- Both invocation paths (`/migrate` and `studio migrate`) are documented.

**Files likely involved:**
- `apps/cli/README.md`

---

### T11 — [docs] Add "Data Liberation Agent integration" section to `docs/design-docs/cli.md`

**What:** Append a new "Data Liberation Agent integration" section to `docs/design-docs/cli.md`. Cover the architecture as built:

- Dep declaration: `github:Automattic/data-liberation-agent#<sha>` pin model; one-line bump cadence.
- Bridge layout in `tools/dla/` (`bridge.ts`, `agent-tool-adapter.ts`, `content-adapter.ts`, `policy.ts`, `index.ts`).
- Runtime spawn shape: `process.execPath` + `tsx` + DLA's `src/mcp-server.ts`.
- Per-session lifecycle: bridge spawned at `runAgentSessionTurn` startup, torn down in the `finally` block alongside `session.dispose()`.
- Permission gating via `extensionFactories` on `DefaultResourceLoader` (`pi.on('tool_call', ...)`); per-tool buckets reused from RSM-3139.
- `delegate: true` contract for `liberate_import` (returns manifest; Studio drives import via `wp_cli` / `site_create`).
- **Orphan-work caveat:** DLA does not honor `notifications/cancelled`. Cancelled `liberate_extract` keeps crawling server-side; filesystem cleanup is bounded by DLA's resume-safe protocol (`extraction-log.jsonl`, `session.json`). Note the upstream issue will be filed manually by the team lead.
- Subprocess path (`studio migrate <url>`): separate yargs command, child-process spawn of DLA's CLI, non-agent headless flow.
- Build pipeline note: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in CI to avoid the 150 MB Chromium pull at build time.
- Reference `issues/rsm-3143-dla-pi-research/research-report.md` for trade-off rationale.

**Acceptance criteria:**
- Section reads as the canonical architecture reference for the integration.
- Explicitly documents the orphan-work caveat and the `delegate: true` contract.
- Cross-links to the research report.

**Files likely involved:**
- `docs/design-docs/cli.md`
