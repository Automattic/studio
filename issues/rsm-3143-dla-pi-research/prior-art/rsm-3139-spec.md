# RSM-3139 spec — DLA integration via `github:` dep

## Goal

Make the Data Liberation Agent (DLA, `Automattic/data-liberation-agent`) available inside the `studio code` AI-agent CLI command as a v1 integration. When the user types `/migrate <url>` (or `/migrate` then provides a URL when asked), the agent walks through a phased workflow that calls DLA's MCP tools to inspect, extract, and verify content from a closed web platform, then hands artifacts off to Studio's `mcp__studio__site_create` and `mcp__studio__wp_cli` plumbing to produce a fresh local Studio site populated with the migrated content.

Scope is `apps/cli/` only. Anything Electron-side (`apps/studio/`) is out of scope — flag, don't fix.

The research, evidence, full tradeoff analysis, and end-to-end UX walk live in `research-report.md` (preserved from RSM-1639). This spec describes only **what changes in this PR** to make Approach C work.

## Why Approach C (npm dep) and not Approach A (vendor)

A previous attempt (RSM-1675, PR #3277) shipped Approach A — a build-time fetch script that cloned DLA into `apps/cli/ai/dla/`. That approach was correct given DLA was private at the time. DLA was made public on 2026-05-07, which makes Approach C (declared at research time as "blocked today") strictly simpler:

- **Deleted from Approach A:** the fetch script, root `postinstall` plumbing for it, `apps/cli/ai/dla/` `.gitignore` entry, Vite `viteStaticCopy` targets for `ai/dla` (in all three configs), the `existsSync(dlaPath)` conditional in `agent.ts` and its tests for the missing-dir branch, the `GH_PAT` warning UX, the `STUDIO_REFRESH_DLA=1` opt-in, and the `fast-xml-parser` + `papaparse` direct deps (npm pulls them as DLA's transitive deps).
- **Kept conceptually from Approach A** (re-derived against the new mechanism — code should be re-implemented from the spec, not copy-pasted from the closed PR): the wrapper `SKILL.md` at `apps/cli/ai/plugin/skills/migrate/SKILL.md`, the `canUseTool` per-tool permission policy in `apps/cli/ai/dla-permissions.ts`, the `/migrate` slash registration in `tools/common/ai/slash-commands.ts`, the README + design-doc additions.
- **Still independently valuable:** the `vite.config.prod.ts` plugin-copy gap fix. It's a pre-existing latent bug unrelated to DLA — Studio's Electron-bundled CLI doesn't ship `dist/cli/plugin/` because `prod` is missing the `viteStaticCopy({ src: 'ai/plugin' })` target that `dev.ts` and `npm.ts` have. Fix it as part of this PR.

## Concrete v1 design

### 1. Dependency declaration

Add to `apps/cli/package.json` `dependencies`:

```json
"data-liberation": "github:Automattic/data-liberation-agent#<sha>",
"tsx": "^4.19.0"
```

- `data-liberation` is DLA's package name (per its `package.json`, not `data-liberation-agent`).
- Pin to a concrete commit SHA, **not** `main` — Studio's npm install path uses `--no-package-lock`, so a tracking ref would drift between installs. The implementer picks the SHA at time of writing; this is a one-line bump later.
- `tsx` is needed because DLA ships TypeScript sources (`src/mcp-server.ts`) with no `prepare`/build step and `tsx` only in its `devDependencies`. We spawn its MCP server through `tsx` at runtime. ~5 MB cost; runtime perf is fine (tsx is esbuild-based JIT).
- DLA's `postinstall: playwright install chromium` runs (~150 MB Chromium download). Studio already ships Playwright via existing browser-MCP tools (`Auto-install Playwright Chromium for MCP tools` landed in the upstream tree), so for end users this is largely a sunk cost. Verify the install is idempotent and doesn't double-download.

### 2. Plugin + MCP wiring in `apps/cli/ai/agent.ts`

In `startAiAgent`:

- Resolve the DLA root: `const dlaRoot = path.dirname(createRequire(import.meta.url).resolve('data-liberation/package.json'))`. (Use `node:module`'s `createRequire` because the file is ESM and `require.resolve` isn't directly available.) No `existsSync` conditional — DLA is a hard dependency.
- Extend `mcpServers`:
  ```ts
  mcpServers: {
      studio: ...,
      'data-liberation': {
          type: 'stdio',
          command: process.execPath,
          args: [
              '--import',
              createRequire(import.meta.url).resolve('tsx'),
              path.join(dlaRoot, 'src/mcp-server.ts'),
          ],
          env: {
              ...resolvedEnv,
              STUDIO_WPCOM_TOKEN: wpcomAccessToken ?? '',
              // LIBERATION_TOKEN / SHOPIFY_ADMIN_TOKEN forwarded via ...resolvedEnv
          },
      },
  }
  ```
  Use `process.execPath` (matches `apps/cli/ai/browser-utils.ts` and `apps/cli/lib/daemon-client.ts` precedent — critical for the Electron-bundled path). Use absolute paths in `args` (the `McpStdioServerConfig` type has no `cwd` field; this was confirmed against `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` in the RSM-1675 attempt).
- Extend `plugins` to a two-element array:
  ```ts
  plugins: [
      { type: 'local', path: path.resolve(import.meta.dirname, 'plugin') },
      { type: 'local', path: dlaRoot },
  ],
  ```

### 3. `readAuthToken` call-site change in `apps/cli/commands/ai/index.ts`

The current code reads `readAuthToken()` only inside the `site?.remote` guard. DLA's MCP server may need the WPCOM token for tools targeting a remote WP site even when the active Studio site is local. Lift the `readAuthToken()` call outside the `site?.remote` guard so `wpcomAccessToken` is always populated when there's a logged-in user. Pass it into `startAiAgent` regardless of site type. Add a one-line code comment explaining why.

### 4. `/migrate` slash command

Append to `AI_SKILL_COMMANDS` in `tools/common/ai/slash-commands.ts`:
```ts
{ name: 'migrate', description: __('Migrate a site from a closed platform into Studio') },
```

The description goes through `__()` from `@wordpress/i18n` (existing pattern in that file). This single change auto-wires the dispatcher in `apps/cli/commands/ai/index.ts`, the autocomplete provider in `apps/cli/ai/ui.ts`, Electron's IPC dispatcher in `apps/studio/src/ipc-handlers.ts` (no app-side change required — the shared list is already consumed there), and the renderer composer.

### 5. Wrapper SKILL.md

Create `apps/cli/ai/plugin/skills/migrate/SKILL.md`. Frontmatter MUST use `user-invocable: true` with **C** — not the `user-invokable` (with K) typo that Studio's existing skills have. The SDK's parser reads `user-invocable`; the existing typos only work because the default is `true`.

Frontmatter fields:
- `name: migrate`
- `description: ...` (one line)
- `argument-hint: <source-url>` (lets `/migrate https://example.com/foo` accept inline arg)
- `allowed-tools:` — listed precisely:
  - `mcp__data-liberation__liberate_inspect`
  - `mcp__data-liberation__liberate_extract`
  - `mcp__data-liberation__liberate_verify`
  - `mcp__data-liberation__liberate_setup`
  - `mcp__data-liberation__liberate_import`
  - `mcp__studio__site_create`
  - `mcp__studio__site_list`
  - `mcp__studio__site_info`
  - `mcp__studio__wp_cli`
  - `AskUserQuestion`

  Do **not** include `liberate_preview` / `liberate_preview_stop` — Studio creates the site itself, not via DLA's preview path.

Body sections (in order):
1. **On Startup** — short greeting matching `apps/cli/ai/plugin/skills/taxonomist/SKILL.md`'s voice.
2. **Step 1: Identify the source.** Use `argument-hint` URL if present; otherwise `AskUserQuestion` for the source URL.
3. **Step 2: Inspect.** Call `mcp__data-liberation__liberate_inspect`. Narrate detected platform + content counts.
4. **Step 3: Confirm.** `AskUserQuestion` to confirm; for Webflow/Shopify, ask for `LIBERATION_TOKEN` / `SHOPIFY_ADMIN_TOKEN` if not already set.
5. **Step 4: Extract.** Call `mcp__data-liberation__liberate_extract`. Narrate `sendLoggingMessage` events as agent progress.
6. **Step 5: Verify.** Call `mcp__data-liberation__liberate_verify`. Surface quality issues; offer retry or proceed.
7. **Step 6: Setup (delegate).** Call `mcp__data-liberation__liberate_setup` with `delegate: true`. Receive a manifest of requirements.
8. **Step 7: Create the Studio site.** Derive a slug from the source domain. Call `mcp__studio__site_create` with a blueprint that inlines the WXR via `importWxr` (per `findings/wave-1-dla-inventory.md` §9 — DLA inlines WXR into `blueprint.studio.json` to dodge the WP-CLI 120s IPC timeout). Explain the `importWxr` blueprint shape so the model can construct it correctly.
9. **Step 8: Import (delegate).** Call `mcp__data-liberation__liberate_import` with `delegate: true`. Receive `{ wxrFile, outputDir, mediaDir, productsCsv?, redirectMap, importAuthors }`. For products CSV (Shopify only), call `mcp__studio__wp_cli` with `wc product_importer ...`.
10. **Step 9: Wrap up.** `AskUserQuestion`: open in browser? Show URL.

Footer: explicit deferral of Approach E (`/migrate --headless`) per research.

### 6. `canUseTool` callback for DLA permission scoping

Create `apps/cli/ai/dla-permissions.ts` exporting `buildDlaCanUseTool()`. Wire it into `query()` from `agent.ts`. Per-tool policy (research-report Open Question 2):

- **Auto-approve (read-only):** `mcp__data-liberation__liberate_detect`, `_discover`, `_inspect`, `_status`, `_verify`.
- **Ask once per session, remember:** `mcp__data-liberation__liberate_extract`, `_setup`, `_map_apis`, `_probe`. Use a Set keyed by tool name captured in a closure for this `startAiAgent` invocation.
- **Always ask UNLESS `tool_input.delegate === true`:** `mcp__data-liberation__liberate_import`. The `delegate: true` short-circuit is safe — DLA returns a manifest; Studio drives the actual import via `wp_cli`.
- **Pass through:** non-DLA tools (return `{ behavior: 'allow', updatedInput: input }`).
- **Default deny for unknown DLA tools** (defensive — if DLA ships a new tool we haven't reviewed, don't silently auto-approve).
- **If `onAskUser`-style plumbing isn't available** at the call site for ask-once tools, deny with an explicit message ("tool requires confirmation, not wired into auto classifier — set `permissionMode: 'default'` or pass `delegate: true` for `_import`"). Better than silent auto-approve.

### 7. `vite.config.prod.ts` plugin-copy gap fix (independent)

Add `viteStaticCopy({ targets: [{ src: 'ai/plugin', dest: '.' }] })` to `apps/cli/vite.config.prod.ts` — `dev.ts` and `npm.ts` already have this. Without it, the Electron-bundled `studio code` doesn't ship `dist/cli/plugin/`, which means SDK plugin skills don't load in the desktop app. Land as a separate atomic commit so it's reviewable independently of DLA.

### 8. Documentation

- `apps/cli/README.md`: new "Migrate from a closed platform" section between "Studio Code" and "Import and export". Mention the eight supported platforms, the inline-URL and prompted-URL invocations, the detect→extract→verify→site-create→import flow, the optional `LIBERATION_TOKEN` / `SHOPIFY_ADMIN_TOKEN` env vars. Brief "Powered by [Data Liberation Agent]" credit. Add ToC entry.
- `docs/design-docs/cli.md`: new "Data Liberation Agent integration" section describing the as-built architecture: `github:` dep declaration, plugin path resolution via `createRequire(...).resolve(...)`, MCP server invocation through `tsx` + `process.execPath`, the `delegate: true` handoff contract, the `canUseTool` permission policy, and DLA update mechanics (one-line SHA bump in `apps/cli/package.json`). Reference `research-report.md` for trade-off rationale.

## Tests

Each `[code]` task includes vitest coverage in the same task (no separate test tasks). Required coverage at minimum:

- `agent.ts`: DLA MCP server is registered with correct command/args/env; plugins has length 2; `wpcomAccessToken` flows into `STUDIO_WPCOM_TOKEN`.
- `dla-permissions.ts`: each policy bucket (read-only auto-approve, ask-once memoization, `delegate: true` short-circuit, `delegate: false` ask, non-DLA passthrough, unknown-DLA deny).
- `tools/common/ai/slash-commands.ts`: `AI_SKILL_COMMANDS` contains the `migrate` entry; `buildSkillInvocationPrompt('migrate')` returns the expected literal.
- `migrate/SKILL.md`: frontmatter parses; `name === 'migrate'`; `user-invocable === true` (with C); assertion that `user-invokable` (with K) is NOT present (locks in the spelling).

## Out of scope

- Anything in `apps/studio/` (Electron desktop).
- A `/migrate --headless` escape hatch (Approach E — explicitly deferred per research).
- Publishing DLA to npm or moving to a proper version-pinned dep (the user said "we can change that afterwards").
- Cleaning up the `user-invokable` typo in Studio's existing skills (orthogonal cleanup; harmless because default is `true`).
- An end-to-end verification of `/migrate` against a real migration target. The implementer should boot `studio code`, confirm `/migrate` appears in autocomplete and the SKILL.md loads, and call out (in the PR description) that real-migration testing is the human reviewer's job.

## Pre-merge gates (for the PR description)

1. Real `cli:package` build verifies that DLA's tree, `node_modules/data-liberation/`, and `node_modules/tsx/` are shipped into the Electron extraResource bundle (`dist/cli/node_modules/`).
2. Real boot of `studio code` confirms `mcp__data-liberation__*` tools surface exactly once (no double-prefixing, no missing tools) — verifies the Open Question 4 in the research report.
3. Bump the `data-liberation` SHA to the latest known-good before merge.
4. Optional: open a DLA-upstream PR adding a `prepare` script so we can drop `tsx` from Studio's runtime deps later.
