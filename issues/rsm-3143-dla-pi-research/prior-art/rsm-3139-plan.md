# RSM-3139 implementation plan

## Context the planner had to resolve

The spec (`spec.md`) and the wave-1 findings were written against an older agent architecture: `@anthropic-ai/claude-agent-sdk` (with `mcpServers`, `plugins`, `canUseTool`, an `apps/cli/ai/agent.ts` entry, and an `apps/cli/ai/plugin/` directory). That stack has been **replaced on trunk** by `@mariozechner/pi-coding-agent` (commit `406b7494`, May 7 2026; see also `6bc92427` "Unify CLI agent on a single pi-based runtime"). On the worktree's `trunk`:

- `apps/cli/ai/agent.ts` does **not** exist; the SDK call site is `runStudioAgentTurn` in `apps/cli/ai/runtimes/pi/index.ts`.
- The pi-coding-agent `createAgentSession` API has **no `mcpServers`, no `plugins`, no `canUseTool`** — tools are registered as in-process `AgentTool` definitions via `customTools`.
- Skills live at `apps/cli/ai/skills/<name>/SKILL.md` (not `apps/cli/ai/plugin/skills/...`). The skill loader (`apps/cli/ai/skills.ts`) only parses `name` and `description` from frontmatter — `user-invocable` / `user-invokable` are both no-ops.
- The vite `viteStaticCopy` target the spec calls "ai/plugin" is actually `ai/skills` in `dev.ts` and `npm.ts`. The latent gap in `vite.config.prod.ts` is real and worth fixing.

This plan adapts the spec's **intent** (DLA reachable from `studio code` via `/migrate`, github dep, no vendor) to the current architecture. The specific implementation mechanics differ from the spec wherever the SDK API has changed — call-outs are in the affected task.

The planner did NOT redesign anything not strictly forced by the architectural drift. Anywhere a spec choice still applies verbatim (github dep + pinned SHA, tsx dep, the `delegate: true` handoff contract, the per-tool permission policy, the README and design-doc sections), it carries over unchanged.

## Ordering and dependencies

```
T1 (vite prod fix, independent)        T2 (deps) ──► T3 (DLA tool bridge + agent wiring + readAuthToken lift)
                                                              │
                                                              ├──► T4 (/migrate slash registration)
                                                              ├──► T5 (migrate SKILL.md)
                                                              ├──► T6 (permission policy)
                                                              └──► T7 (docs)
```

- **T1** is independent of DLA and lands first; reviewable on its own.
- **T2** (deps) precedes any code that imports DLA.
- **T3** is the heart of the integration. It cannot meaningfully split further without leaving half-wired changes (the agent wiring, the DLA tool wrappers, and the token-lift in `commands/ai/index.ts` form one coherent change). The spec's §1 + §2 + §3 collapse into T3 here because the bridge layer replaces what was previously a single `mcpServers` config line.
- **T4–T6** are parallel-safe after T3.
- **T7** runs last so it can describe the as-built code.

## Tasks

### T1 [code] Fix vite.config.prod.ts skills copy gap

**What.** `apps/cli/vite.config.prod.ts` is missing the `viteStaticCopy({ targets: [{ src: 'ai/skills', dest: '.' }] })` plugin that `vite.config.dev.ts` and `vite.config.npm.ts` already have. Without it, the Electron-bundled `studio code` does not ship `dist/cli/skills/`, so the Skill tool finds no skills at runtime. The spec describes this gap as "ai/plugin" — the current target name is `ai/skills`; the gap itself is unchanged. Add the copy target. Add a vitest covering the prod config exposes that copy target (or, if testing config is awkward, a small CI-friendly assertion test against the resolved plugins array).

**Acceptance criteria.**
- `vite.config.prod.ts` adds a `viteStaticCopy` plugin targeting `ai/skills` → `.`, sitting alongside the existing node_modules copy and prune-php-wasm plugins (still gated on `existsSync(cliNodeModulesPath)` if appropriate, or unconditional if skills must always copy).
- After `npm run cli:build` with the prod config, `dist/cli/skills/` exists and contains the four existing skills (`annotate`, `taxonomist`, `need-for-speed`, `rank-me-up`).
- New vitest passes; existing vitest unchanged.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/vite.config.prod.ts`
- A new test file under `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/tests/` (or alongside the config).

---

### T2 [code] Add data-liberation and tsx dependencies

**What.** Add to `apps/cli/package.json` `dependencies`:
- `"data-liberation": "github:Automattic/data-liberation-agent#<sha>"` — pinned to a concrete commit SHA, not `main` (Studio's install path uses `--no-package-lock` per spec). Implementer picks the SHA at write time from `Automattic/data-liberation-agent`'s default branch.
- `"tsx": "^4.19.0"` — DLA ships TypeScript sources (`src/mcp-server.ts`) with no `prepare`/build script; we spawn it through `tsx` at runtime.

Run `npm install` and commit the lockfile delta. Confirm `node_modules/data-liberation/` is populated, the postinstall (`playwright install chromium`) completes (or no-ops if Chromium is already present), and `node_modules/tsx/` resolves. No code uses these yet — wiring happens in T3.

**Acceptance criteria.**
- `apps/cli/package.json` `dependencies` has both entries, SHA is a concrete 40-char commit.
- `npm install` succeeds; `node_modules/data-liberation/package.json` exists; `require.resolve('tsx')` resolves.
- A simple smoke test (vitest) that imports nothing but asserts `createRequire(import.meta.url).resolve('data-liberation/package.json')` does not throw, locking in that DLA stays installable.
- No regressions to existing `npm test`.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/package.json`
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/package-lock.json`
- A new vitest under `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/ai/tests/`.

---

### T3 [code] Bridge DLA MCP tools into the pi runtime and lift readAuthToken

**What.** This task replaces what spec §2 described as a single `mcpServers: { 'data-liberation': { type: 'stdio', ... } }` config entry. pi-coding-agent has no `mcpServers` slot, so we wrap DLA's MCP server with an MCP **client** (using `@modelcontextprotocol/sdk`'s `Client` + `StdioClientTransport`) and surface each DLA tool as an in-process `AgentTool` whose `rawHandler` proxies a CallTool request to the client.

Add `apps/cli/ai/runtimes/pi/dla-tools.ts` (new file) exporting:

- `createDlaToolsBridge(opts: { wpcomAccessToken?: string; env: Record<string, string>; })` — opens a stdio child process running `process.execPath --import <tsx-path> <dla-root>/src/mcp-server.ts`. Use `process.execPath` (matches `apps/cli/ai/browser-utils.ts` and `apps/cli/lib/daemon-client.ts` precedent — critical for the Electron-bundled path). Resolve `dlaRoot` via `path.dirname(createRequire(import.meta.url).resolve('data-liberation/package.json'))`. Resolve the tsx loader via `createRequire(import.meta.url).resolve('tsx')`. Forward env: `STUDIO_WPCOM_TOKEN` (from `wpcomAccessToken`), plus `LIBERATION_TOKEN` / `SHOPIFY_ADMIN_TOKEN` etc. from `env`.
- The bridge does a `ListTools` once on startup and returns an `AgentTool[]` where each tool's `rawHandler` forwards to `CallTool` on the child. Name them `data-liberation__<original_name>` so they read symmetrically with Studio's `mcp__studio__*` references in the SKILL.md (spec frontmatter writes `mcp__data-liberation__liberate_inspect` etc. — pick a naming convention and apply it consistently in T5).
- Provide a `dispose()` returned alongside the tools so the runtime can shut down the child cleanly.

Wire the bridge into `runStudioAgentTurn` in `apps/cli/ai/runtimes/pi/index.ts`:

- Build the bridge before `createAgentSession`, prepend its tools to `buildAgentTools(...)`, and call `dispose()` in the existing `finally` cleanup in `runAgentSessionTurn`.
- Skip the bridge entirely when `isRemoteSite` is true — DLA is only meaningful for local-Studio workflows, and the remote-site branch already constrains the tool set.

Lift `readAuthToken` in `apps/cli/commands/ai/index.ts`:

- Move the existing `const token = await readAuthToken()` out of the `if (site?.remote)` guard so `wpcomAccessToken` is populated whenever the user is logged in, regardless of active-site type. Add an inline comment citing DLA's need for the WPCOM token even when the active site is local. Pass `wpcomAccessToken` into `runStudioAgentTurn(...)` unconditionally (current call is at `apps/cli/commands/ai/index.ts:453-460` per the worktree at planning time — recheck line numbers before editing).

Tests (in the same task, no separate test task):

- **DLA tools bridge unit test** — mock `@modelcontextprotocol/sdk/client` and `StdioClientTransport`, assert the spawned child uses `process.execPath`, the `--import <tsx-resolved-path>` argument, the absolute path to `src/mcp-server.ts`, and that `env` includes `STUDIO_WPCOM_TOKEN` when a token is passed. Assert each returned `AgentTool` proxies a `CallTool` with the correct name + arguments and surfaces errors as `isError: true`.
- **`pi-runtime.test.ts` extension** — assert the bridge is invoked once per turn, its tools are appended to the agent's tool list when `!isRemoteSite`, and `dispose()` runs on teardown even on error/abort paths.
- **`commands/ai/index.ts` token-lift test** — extend or add to the existing tests in `apps/cli/tests/commands-ai-index.test.ts` (if present) to assert `wpcomAccessToken` is passed into `runStudioAgentTurn` for both local and remote site shapes.

**Acceptance criteria.**
- New file `apps/cli/ai/runtimes/pi/dla-tools.ts` exists, exports `createDlaToolsBridge`, is fully typed, and passes lint.
- `runStudioAgentTurn` instantiates the bridge before `createAgentSession`, includes its tools in the agent's tool list for non-remote sites, and disposes the child in the `finally`.
- `readAuthToken` is called outside the `site?.remote` guard in `apps/cli/commands/ai/index.ts` with a clarifying comment; `wpcomAccessToken` is passed to `runStudioAgentTurn` regardless of site type.
- Vitest coverage exists for: bridge spawn args/env, tool name prefixing, error propagation, disposal on abort, token-lift behavior.
- `npm test` is green; `npm run typecheck` is green; modified files pass `npx eslint --fix`.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/ai/runtimes/pi/dla-tools.ts` (new)
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/ai/runtimes/pi/index.ts`
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/commands/ai/index.ts` (around lines 425–460 at planning time)
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/ai/tests/pi-runtime.test.ts`
- New tests under `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/ai/runtimes/pi/tests/` and `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/tests/`.

---

### T4 [code] Register the /migrate slash command

**What.** Append a new entry to `AI_SKILL_COMMANDS` in `tools/common/ai/slash-commands.ts`:

```ts
{ name: 'migrate', description: __( 'Migrate a site from a closed platform into Studio' ) },
```

The description goes through `__()` from `@wordpress/i18n` (matches existing entries). Because `AI_CHAT_SLASH_COMMANDS` in `apps/cli/ai/slash-commands.ts` spreads `AI_SKILL_COMMANDS` at line 541, this single change auto-wires the autocomplete provider, the CLI dispatcher, and (via the same shared module) the Electron renderer composer and IPC dispatcher.

Tests (same task):
- `tools/common/ai/slash-commands.test.ts` (or a new test if no file exists): assert `AI_SKILL_COMMANDS` includes a `migrate` entry with the expected name/description; assert `buildSkillInvocationPrompt('migrate')` returns the literal `Run the /migrate skill using the Skill tool.`.

**Acceptance criteria.**
- One added entry in `AI_SKILL_COMMANDS`, no other changes.
- New (or updated) vitest passes.
- `/migrate` is selectable in `studio code` autocomplete after `npm run cli:build` (manual smoke; mentioned in the PR description but not a unit-test requirement).

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/tools/common/ai/slash-commands.ts`
- A new or updated test under `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/tools/common/ai/` or `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/ai/tests/`.

---

### T5 [code] Create the migrate skill (apps/cli/ai/skills/migrate/SKILL.md)

**What.** Create `apps/cli/ai/skills/migrate/SKILL.md` (the actual skills directory; not `apps/cli/ai/plugin/skills/` as the spec describes). The file is a YAML-frontmatter Markdown file matching the loader at `apps/cli/ai/skills.ts:10-21`.

Frontmatter — the spec calls out `user-invocable: true` (with C) over the typo'd `user-invokable: true` (with K) found in existing Studio skills. The current loader **doesn't parse either field**, but the spec asks us to use the canonical `user-invocable` spelling. Honor that. Include:

- `name: migrate`
- `description: <one line — same string as the slash command description>`
- `argument-hint: <source-url>` (informational; the loader doesn't read this either, but include it to match the spec for forward-compat with any future SDK parser).
- `allowed-tools:` — informational at this loader version, but include the spec-listed allow-list verbatim so the model self-restricts (the body should also restate the contract in prose). Names should be:
  - `data-liberation__liberate_inspect`
  - `data-liberation__liberate_extract`
  - `data-liberation__liberate_verify`
  - `data-liberation__liberate_setup`
  - `data-liberation__liberate_import`
  - `mcp__studio__site_create`, `mcp__studio__site_list`, `mcp__studio__site_info`, `mcp__studio__wp_cli`
  - `AskUserQuestion`
  Use the prefix actually emitted by T3 — if T3 names them `data-liberation__*`, use that; if T3 chose `mcp__data-liberation__*`, use that. **The implementer must mirror T3's choice.**
- Do NOT include `liberate_preview` / `liberate_preview_stop` — Studio creates the site itself.

Body sections in order, matching spec §5:

1. **On Startup** — short greeting in `taxonomist/SKILL.md`'s voice.
2. **Step 1: Identify the source** — use `argument-hint` URL if present; else `AskUserQuestion`.
3. **Step 2: Inspect** — call `liberate_inspect`, narrate detected platform + counts.
4. **Step 3: Confirm** — `AskUserQuestion`; for Webflow/Shopify, ask for `LIBERATION_TOKEN` / `SHOPIFY_ADMIN_TOKEN` if not set.
5. **Step 4: Extract** — call `liberate_extract`; narrate logging events.
6. **Step 5: Verify** — call `liberate_verify`; surface quality issues; offer retry or proceed.
7. **Step 6: Setup (delegate)** — call `liberate_setup` with `delegate: true`; receive a manifest.
8. **Step 7: Create the Studio site** — derive a slug from the source domain; call `mcp__studio__site_create` with a blueprint inlining the WXR via `importWxr` (cite the DLA-inlines-WXR rationale from `findings/wave-1-dla-inventory.md` §9 — the 120s WP-CLI IPC timeout dodge).
9. **Step 8: Import (delegate)** — call `liberate_import` with `delegate: true`; receive `{ wxrFile, outputDir, mediaDir, productsCsv?, redirectMap, importAuthors }`. For products CSV, call `mcp__studio__wp_cli` with `wc product_importer ...`.
10. **Step 9: Wrap up** — `AskUserQuestion`: open in browser? Show URL.

Footer: explicit deferral of Approach E (`/migrate --headless`) per research.

Tests (same task):
- `apps/cli/ai/tests/migrate-skill.test.ts` (new): load the skill via `findSkill('migrate')`, assert `name === 'migrate'`, description is non-empty, body contains expected step headers. Assert the file content includes the literal `user-invocable:` (with C) and does NOT include `user-invokable:` (with K) — locks in the spelling per spec.

**Acceptance criteria.**
- File at `apps/cli/ai/skills/migrate/SKILL.md` parses via the existing loader.
- `loadSkills()` returns a `migrate` entry; the Skill tool registers it in the `Available skills:` index automatically.
- Frontmatter spells `user-invocable` with C; test enforces this.
- Tool name references inside the body match T3's emitted names exactly.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/ai/skills/migrate/SKILL.md` (new)
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/ai/tests/migrate-skill.test.ts` (new)

---

### T6 [code] DLA tool permission policy

**What.** Spec §6 calls for `buildDlaCanUseTool()` wired into the SDK's `query()`. pi-coding-agent has no `canUseTool` callback. The closest hook is each tool's own handler running before the agent sees a result. Implement the policy as a wrapper applied inside the DLA-tools bridge (T3) — the bridge already mediates every DLA tool call.

Add `apps/cli/ai/runtimes/pi/dla-permissions.ts` exporting `applyDlaPermissionPolicy(rawTools, opts: { askUser?: AskUserHandler })` that returns a new `AgentTool[]` whose `rawHandler`s implement:

- **Auto-approve (pass through):** `liberate_detect`, `_discover`, `_inspect`, `_status`, `_verify` (read-only).
- **Ask once per session, remember:** `_extract`, `_setup`, `_map_apis`, `_probe`. Use a `Set<string>` captured in the closure for the current `startAiAgent` invocation. If the user denies, the rawHandler returns an `isError: true` content explaining the denial; the agent surfaces it back to the model.
- **Always ask UNLESS `args.delegate === true`:** `_import`. The `delegate: true` short-circuit is safe — DLA returns a manifest; Studio drives the actual import via `wp_cli`.
- **Default deny for unknown DLA tools** (defensive): any DLA tool not on the auto/ask-once/import list returns `isError: true` with a clear "unknown DLA tool — review and add to permission policy" message.
- **If `askUser` plumbing is absent** (e.g. in JSON-mode runs without an interactive UI), the ask-once / always-ask buckets deny with an explicit message: "tool requires confirmation; not wired into the auto classifier. Re-run interactively or pass `delegate: true` for `liberate_import`."

Wire `applyDlaPermissionPolicy` between `createDlaToolsBridge` and the tool list returned to `buildAgentTools`. Pass `config.onAskUser` (already available — see `apps/cli/ai/runtimes/pi/index.ts:412-414`) into the policy.

Tests (same task):
- Cover each policy bucket: read-only auto-approve (rawHandler invokes underlying tool, no askUser call), ask-once memoization (second call to same `_extract` tool skips askUser), `delegate: true` short-circuit (no askUser, tool runs), `delegate: false` `_import` (askUser called; denial → isError), non-DLA passthrough (unaffected), unknown-DLA-tool defensive deny.

**Acceptance criteria.**
- `dla-permissions.ts` exports `applyDlaPermissionPolicy` with the policy buckets above.
- The bridge in `apps/cli/ai/runtimes/pi/index.ts` calls it before exposing tools to the agent.
- Vitest covers all six policy bucket cases.
- All existing tests still pass.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/ai/runtimes/pi/dla-permissions.ts` (new)
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/ai/runtimes/pi/index.ts`
- New test under `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/ai/runtimes/pi/tests/`.

---

### T7 [docs] Document DLA integration in README and design doc

**What.** Two docs additions, per spec §8:

**`apps/cli/README.md`** — new "Migrate from a closed platform" section between "Studio Code" (line 83) and "Import and export" (line 101). Cover:
- The eight supported platforms (per `findings/wave-1-dla-inventory.md` §1).
- Two invocation forms: `/migrate https://example.com/foo` (inline) and `/migrate` then prompt.
- The detect → extract → verify → site-create → import flow at a high level.
- Optional `LIBERATION_TOKEN` (Webflow) and `SHOPIFY_ADMIN_TOKEN` (Shopify) env vars.
- One-line "Powered by [Data Liberation Agent](https://github.com/Automattic/data-liberation-agent)" credit.
- Add the new section to the table of contents block at lines 29–30.

**`docs/design-docs/cli.md`** — new "Data Liberation Agent integration" section describing the as-built architecture:
- `github:` dep declaration with a pinned SHA, npm install path resolves the package as `data-liberation`.
- Plugin path resolution via `createRequire(import.meta.url).resolve('data-liberation/package.json')`.
- DLA's MCP server invoked through `process.execPath --import <tsx> <dla-root>/src/mcp-server.ts`, wrapped by an in-process MCP client (`@modelcontextprotocol/sdk`'s `Client`) and surfaced as pi-coding-agent `AgentTool` wrappers. Cite the pi-coding-agent migration that motivated the bridge (rather than the spec's `mcpServers` slot, which doesn't exist).
- The `delegate: true` handoff contract: DLA returns artifacts; Studio creates the site and runs the import via `wp_cli`.
- The DLA permission policy (link to `dla-permissions.ts`).
- DLA update mechanics: one-line SHA bump in `apps/cli/package.json`.
- Reference `issues/rsm-3139-dla-github-dep/research-report.md` for the trade-off rationale (Approach A vs C vs E).

No tests needed for a docs task.

**Acceptance criteria.**
- Both files updated; TOC in README updated.
- Code snippets compile / would compile against the actual file paths (no fictional paths).
- Cross-references resolve (no dead anchors).

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/apps/cli/README.md`
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-3139-dla-github-dep/docs/design-docs/cli.md`

---

## Out-of-scope reminders (carried from the spec / prompt)

- No changes to `apps/studio/` (Electron).
- No `/migrate --headless` escape hatch (Approach E — deferred).
- No clean-up of the `user-invokable` typo in existing Studio skills (orthogonal).
- No real-migration E2E test — the human reviewer covers that.
- No DLA-upstream PR to add a `prepare` script (follow-up; we may drop `tsx` once that lands).
