# RSM-1675 Implementation Plan — DLA integration into `studio code`

This plan turns the recommendation in `issues/rsm-1639-dla-integration/research-report.md` (Approach A) into atomic, ordered tasks. All work lands in the existing PR #3277 on branch `rsm-1639-dla-integration`. Scope is `apps/cli/` only (plus the root `package.json` postinstall chain and `scripts/` for the build-time fetch script — same precedent as `scripts/download-agent-skills.ts`). No `apps/studio/` (Electron) changes.

## Ordering and dependencies

```
T1 (vite.config.prod.ts gap fix, no DLA yet)
  └── T2 (download-data-liberation-agent.ts build-time fetch script)
        └── T3 (wire fetch script into root postinstall + add deps)
              └── T4 (vite static-copy targets for ai/dla in dev/npm/prod)
                    └── T5 (agent.ts: register DLA as second local plugin + stdio MCP)
                          └── T6 (slash-command registration: /migrate)
                                └── T7 (Studio-side wrapper skill at apps/cli/ai/plugin/skills/migrate/SKILL.md)
                                      └── T8 (canUseTool callback for DLA permission scoping — optional, in scope for first PR)
                                            └── T9 [docs] (CLI README: document /migrate)
                                                  └── T10 [docs] (docs/design-docs/cli.md: DLA architecture section)
```

T1 is independent of DLA and is genuinely a pre-existing bug (research-report Open Question 1) — landing it first makes T5 verifiable. Tasks T2–T8 are all `[code]`. T9–T10 are `[docs]` and gate on the implementation being settled. Tests live inside their owning `[code]` task.

---

## T1 [code] — Fix `vite.config.prod.ts` static-copy gap for `ai/plugin`

**What.** The Electron-bundled `vite.config.prod.ts` is missing the `viteStaticCopy` target that `vite.config.dev.ts:9-17` and `vite.config.npm.ts:8-17` already have for `ai/plugin`. This is an existing latent bug (research-report Open Question 1, `wave-1-bundling-distribution.md` §1, `wave-1-studio-skill-plumbing.md` §6 item 3): desktop-bundled `studio code` may be loading the SDK plugin tree only by accident or not at all. Add the same `{ src: 'ai/plugin', dest: '.' }` target to `vite.config.prod.ts` so `dist/cli/plugin/` ships in the Electron extra-resource bundle. This is a no-op for the CLI npm path and unblocks T4 (which extends the same target list with `ai/dla`).

**Acceptance criteria.**
- `apps/cli/vite.config.prod.ts` adds `viteStaticCopy({ targets: [{ src: 'ai/plugin', dest: '.' }] })` to its plugin list (alongside the existing `node_modules` copy block).
- `npm run cli:build:prod` from the repo root completes without errors.
- A spot-check confirms `apps/cli/dist/cli/plugin/.claude-plugin/plugin.json` exists after `cli:build:prod` (verify with `ls`, do not commit the dist).
- A code comment on the new block notes that this fix is independent of DLA — landed together but reviewable on its own.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/vite.config.prod.ts`

---

## T2 [code] — Add `scripts/download-data-liberation-agent.ts` build-time fetch script

**What.** Mirror `scripts/download-agent-skills.ts` to vendor DLA at a pinned git SHA into `apps/cli/ai/dla/`. The script:

1. Reads a pinned SHA from a constant at the top of the file (`const DLA_PINNED_SHA = '...'`). Use the latest known-good SHA at PR time; document in a comment that bumping is a one-line change.
2. Authenticates against the private GitHub repo using a `GH_PAT` (or `GH_TOKEN`) environment variable. If the env var is missing, log a clear warning ("Skipping DLA download — set GH_PAT to enable. /migrate will not work until DLA is vendored.") and exit 0 (do **not** fail the install). This keeps installs working for contributors who don't have access to the private repo. Document this limitation in a `// TODO` referencing research-report Open Question 6 (push for tagged public DLA releases).
3. Downloads a tarball at the pinned SHA via `https://api.github.com/repos/Automattic/data-liberation-agent/tarball/<sha>` with `Authorization: Bearer ${GH_PAT}` and `Accept: application/vnd.github+json` headers, into `os.tmpdir()`.
4. Extracts the tarball to a temp dir, locates the single top-level extracted dir.
5. Pre-compiles DLA's TypeScript sources to JS using `tsc` so we don't need `tsx` at runtime (research-report §6.6, Open Question 3). Run `tsc -p tsconfig.json --outDir dist-vendored` in the extracted tree. Skip if `tsc` is missing; emit a clear error.
6. Copies a curated list of paths into `apps/cli/ai/dla/`, preserving directory layout: `.claude-plugin/`, `skills/`, `commands/`, `prompts/`, `dist-vendored/` (renamed to `src/` so runtime paths stay stable), and `src/lib/preview/scripts/` (the vendored PHP files referenced via `import.meta.url` per `wave-1-dla-inventory.md` risk #5). Also write a small `apps/cli/ai/dla/.dla-pinned-sha` provenance file containing the SHA.
7. Skips DLA's own `node_modules` install — DLA's runtime deps overlap Studio's hoisted root (`@modelcontextprotocol/sdk`, `@wp-playground/cli`, `playwright`, `cheerio`, etc.). The fetch script does **not** run `npm install` inside the vendored tree.
8. Provides an `--update` / `STUDIO_REFRESH_DLA=1` opt-in that re-runs the fetch even when `apps/cli/ai/dla/` exists (research-report cons mitigation).

Add a top-of-file comment block linking to the canonical spec (`issues/rsm-1639-dla-integration/research-report.md`) so future maintainers can find context.

Tests in the same task: `scripts/__tests__/download-data-liberation-agent.test.ts` (vitest) covering: (a) skip-when-missing-token branch returns 0, (b) target paths copied through verbatim from a fixture tarball, (c) the rename of `dist-vendored/` → `src/` happens, (d) the `.dla-pinned-sha` file is written. Mock the `fetch` and the tarball extract; do not hit the network in tests.

**Acceptance criteria.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/scripts/download-data-liberation-agent.ts` exists, modeled on `download-agent-skills.ts`.
- Running `GH_PAT=<valid> ts-node scripts/download-data-liberation-agent.ts` populates `apps/cli/ai/dla/` with the manifest, skills, commands, prompts, compiled `src/`, and vendored PHP scripts.
- Running with no `GH_PAT` exits 0 with a clear warning.
- `apps/cli/ai/dla/` is added to `.gitignore` (the vendored tree is reproducible from the SHA pin and should not be committed; mirror `wp-files/skills/` precedent).
- New tests pass: `npx vitest run scripts/__tests__/download-data-liberation-agent.test.ts`.
- `npx eslint --fix scripts/download-data-liberation-agent.ts` is clean.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/scripts/download-data-liberation-agent.ts` (new)
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/scripts/__tests__/download-data-liberation-agent.test.ts` (new)
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/.gitignore` (add `apps/cli/ai/dla/`)
- Reference: `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/scripts/download-agent-skills.ts` (precedent)
- Reference: `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/tools/common/lib/extract-zip.ts` (for tarball extract — may need a sibling `extract-tar` helper or use `tar` package already in `apps/cli/package.json`)

---

## T3 [code] — Wire DLA fetch into root postinstall and add missing runtime deps

**What.** Hook `download-data-liberation-agent.ts` into the existing root `postinstall` chain in `package.json:33`, after `download-agent-skills`. Confirm the deps DLA needs at runtime are available via the workspace hoist — research-report §6.1 calls out three potential gaps:

- `fast-xml-parser` — not in `apps/cli/package.json` or root deps; add to `apps/cli/package.json` dependencies.
- `papaparse` — same; add.
- `ink` — only used by DLA's `src/ui/*.tsx` Ink screens, which are CLI-only and not invoked when DLA runs as an MCP server. Verify by `grep -l 'from .ink' apps/cli/ai/dla/src/mcp-server.*` after T2 lands; if mcp-server doesn't transitively import `ink`, **do not** add it. (DLA's MCP server path uses `sendLoggingMessage` from `@modelcontextprotocol/sdk`, not Ink — see `wave-1-dla-inventory.md` §4.)

DLA's `cheerio`, `@modelcontextprotocol/sdk`, `@wp-playground/cli`, `playwright` are already in `apps/cli/package.json`. Verify versions are compatible with what DLA pins (DLA's `@modelcontextprotocol/sdk@^1.27.0` matches `apps/cli/package.json` at `^1.27.1`; `playwright^1.44.0` matches `^1.52.0`; `@wp-playground/cli^3.1.20` matches `3.1.21`).

Tests in the same task: extend the existing `apps/cli/ai/tests/agent.test.ts` to assert that no error is thrown when `apps/cli/ai/dla/` does not exist (the absence of the vendored tree, e.g. on a contributor without `GH_PAT`, must not break the agent — if the dir is missing, agent.ts should detect that and skip the second plugin + the data-liberation MCP server, with a one-line `logger.warn`).

**Acceptance criteria.**
- `package.json:33` postinstall line gains a `&& ts-node ./scripts/download-data-liberation-agent.ts` segment after `download-agent-skills.ts`.
- `apps/cli/package.json` dependencies include `fast-xml-parser` and `papaparse` (pinned versions matching DLA's pins; check `apps/cli/ai/dla/package.json` after T2 lands — research will need to inspect that DLA package.json contents).
- A fresh `npm install` from the repo root succeeds and produces `apps/cli/ai/dla/` (when `GH_PAT` is set) or skips cleanly (when not).
- `npm test -- apps/cli/ai/tests/agent.test.ts` passes, including the new "missing DLA dir is non-fatal" test.
- `npm run typecheck` passes from the repo root.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/package.json` (postinstall line)
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/package.json` (dependencies)
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/ai/tests/agent.test.ts` (extend for missing-dir branch — implementation lives in T5)

---

## T4 [code] — Add `ai/dla` static-copy targets to all three Vite configs

**What.** Extend `viteStaticCopy` in each Vite config to copy `apps/cli/ai/dla/` into `dist/cli/dla/`:

- `vite.config.dev.ts`: add `{ src: 'ai/dla', dest: '.' }` to existing targets.
- `vite.config.npm.ts`: same.
- `vite.config.prod.ts`: same — and this is now possible because T1 introduced the `viteStaticCopy` block here.

The recursive copy preserves DLA's directory layout, including the vendored PHP under `src/lib/preview/scripts/` (research-report §6.6). All three configs gain symmetry. Wrap each `viteStaticCopy` target conditionally (`existsSync(resolve(__dirname, 'ai/dla'))`) so a build still works on contributors without a vendored DLA tree (graceful skip, mirrors `vite.config.prod.ts`'s existing `existsSync(cliNodeModulesPath)` pattern).

Tests in the same task: a small unit test in `apps/cli/tests/vite-config.test.ts` (new file) that imports each config and asserts the static-copy targets array includes `ai/dla` when the source dir exists. If existing test scaffolding doesn't make this easy to write, fall back to a snapshot-style assertion against the resolved config object.

**Acceptance criteria.**
- All three configs include the `ai/dla` target.
- `npm run cli:build`, `npm run cli:build:npm`, and `npm run cli:build:prod` each produce `apps/cli/dist/cli/dla/` (when DLA is vendored).
- `npx eslint --fix apps/cli/vite.config.dev.ts apps/cli/vite.config.npm.ts apps/cli/vite.config.prod.ts` is clean.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/vite.config.dev.ts`
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/vite.config.npm.ts`
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/vite.config.prod.ts`
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/tests/vite-config.test.ts` (new, optional)

---

## T5 [code] — Wire DLA as second local plugin + stdio MCP server in `agent.ts`

**What.** In `apps/cli/ai/agent.ts`:

1. Detect whether the DLA tree is present (`fs.existsSync(path.resolve(import.meta.dirname, 'dla'))`). Cache as `const dlaAvailable = ...` near the top of `startAiAgent`.
2. Extend `mcpServers` (`agent.ts:80-84`) to a second branch:
   ```ts
   const mcpServers: Record<string, McpServerConfig> = {
       studio: isRemoteSite ? createRemoteSiteTools(...) : createStudioTools(...),
   };
   if (dlaAvailable) {
       mcpServers['data-liberation'] = {
           command: process.execPath,
           args: [path.resolve(import.meta.dirname, 'dla/src/mcp-server.js')],
           cwd: path.resolve(import.meta.dirname, 'dla'),
           env: {
               ...resolvedEnv,
               STUDIO_WPCOM_TOKEN: wpcomAccessToken ?? '',
               // LIBERATION_TOKEN / SHOPIFY_ADMIN_TOKEN are forwarded from process.env
               // automatically via `...resolvedEnv` if the user has set them.
           },
       };
   }
   ```
   Use `process.execPath` rather than `'node'` so the bundled Node binary in the Electron path is used (matches `apps/cli/ai/browser-utils.ts:50-56` and `apps/cli/lib/daemon-client.ts:156-164` precedent). `wpcomAccessToken` is the same value already passed in via `AiAgentConfig`.
3. Extend `plugins` (`agent.ts:149`) to a two-element array, conditional on `dlaAvailable`:
   ```ts
   plugins: [
       { type: 'local' as const, path: path.resolve(import.meta.dirname, 'plugin') },
       ...(dlaAvailable ? [{ type: 'local' as const, path: path.resolve(import.meta.dirname, 'dla') }] : []),
   ],
   ```
4. Note `wpcomAccessToken` is currently only set when `site?.remote` is true (`apps/cli/commands/ai/index.ts:447-452`). For DLA we want the token regardless of site type, so the implementer should split the token-read from the site-type guard at the call site (`commands/ai/index.ts`) — read the token always when DLA is available, gate the `isRemoteSite` calculation separately. Document this in code comments.

Tests in the same task: extend `apps/cli/ai/tests/agent.test.ts`:
- "registers data-liberation MCP server when dla/ dir exists" — mock `fs.existsSync` to return true for the dla path; assert `query()` was called with `mcpServers['data-liberation']` set with the right `command`, `args`, and `STUDIO_WPCOM_TOKEN` env.
- "does not register data-liberation MCP server when dla/ dir is missing" — assert the `'data-liberation'` key is absent and `plugins` has length 1.
- "passes wpcomAccessToken into data-liberation env when provided".

**Acceptance criteria.**
- `apps/cli/ai/agent.ts` registers DLA conditionally on `dlaAvailable`.
- `MCP tools surface as `mcp__data-liberation__*`. (Verifiable manually post-merge; research-report Open Question 4 calls this out as worth a 10-minute test during implementation — flag in a `// TODO` if not verified in this PR.)
- All `apps/cli/ai/tests/agent.test.ts` tests pass.
- `npm run typecheck` passes.
- `npx eslint --fix apps/cli/ai/agent.ts` is clean.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/ai/agent.ts`
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/commands/ai/index.ts` (move `readAuthToken()` call out of the `site?.remote` guard)
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/ai/tests/agent.test.ts`

---

## T6 [code] — Register `/migrate` slash command

**What.** In `tools/common/ai/slash-commands.ts:8-13`, append a new entry to `AI_SKILL_COMMANDS`:
```ts
{ name: 'migrate', description: __('Migrate a site from a closed platform into Studio') },
```
This auto-wires:
- The chat-loop dispatcher in `apps/cli/commands/ai/index.ts:684-705` (Flow B → `runAgentTurn(buildSkillInvocationPrompt('migrate'))`).
- The autocomplete provider in `apps/cli/ai/ui.ts`.
- Electron's IPC dispatcher in `apps/studio/src/ipc-handlers.ts:295-306` (research-report scope guidance: this is auto-included via the shared list; **no Electron-side change is required**).
- The renderer composer slash hints in `apps/ui/src/components/session-view/composer/index.tsx:2,126`.

Tests in the same task: extend `tools/common/ai/__tests__/slash-commands.test.ts` (or create it if missing) to assert that `AI_SKILL_COMMANDS` includes `{ name: 'migrate', ... }` and that `buildSkillInvocationPrompt('migrate') === 'Run the /migrate skill using the Skill tool.'`.

**Acceptance criteria.**
- `tools/common/ai/slash-commands.ts` lists `migrate` in `AI_SKILL_COMMANDS`.
- `studio code` shows `/migrate` in autocomplete (verify manually).
- New tests pass.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/tools/common/ai/slash-commands.ts`
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/tools/common/ai/__tests__/` (new test file if needed)

---

## T7 [code] — Studio-side wrapper skill at `apps/cli/ai/plugin/skills/migrate/SKILL.md`

**What.** Create a thin Studio-side skill that drives the migration workflow by orchestrating DLA's MCP tools and the existing Studio MCP tools (`mcp__studio__site_create`, `mcp__studio__wp_cli`). This is in **Studio's** plugin (not DLA's), so it scopes `allowed-tools` precisely and keeps the Skill body short.

Key spec details (from research-report §6 and the End-to-end UX walk):

- Frontmatter: use **`user-invocable: true`** with **C** (research-report §6 + research-report Open Question 5 — the SDK reads `user-invocable`; existing Studio skills mistakenly use `user-invokable` with K, which works only because the default is `true`; explicitly do not propagate the typo). Add `name: migrate`, `description: ...`, and `argument-hint: "<source-url>"` so the user can do `/migrate https://example.wixsite.com/foo`.
- `allowed-tools`: list precisely — `mcp__data-liberation__liberate_inspect`, `mcp__data-liberation__liberate_extract`, `mcp__data-liberation__liberate_verify`, `mcp__data-liberation__liberate_setup`, `mcp__data-liberation__liberate_import`, `mcp__studio__site_create`, `mcp__studio__site_list`, `mcp__studio__site_info`, `mcp__studio__wp_cli`, `AskUserQuestion`. Do **not** allow `liberate_preview` / `liberate_preview_stop` — Studio creates the site itself, not via DLA's preview path.
- Body (sections, in order):
  1. **On Startup** — short greeting in the same voice as the existing taxonomist skill ("Welcome to Migrate! I'll move your site from Wix/Squarespace/Shopify/etc. into a fresh Studio site.").
  2. **Step 1: Identify the source.** Read the `argument-hint` URL if present; otherwise call `AskUserQuestion` to ask for the source URL.
  3. **Step 2: Inspect.** Call `mcp__data-liberation__liberate_inspect` with the URL. Narrate the detected platform and content counts.
  4. **Step 3: Confirm.** Use `AskUserQuestion` to confirm the user wants to proceed; if Webflow/Shopify is detected, also ask for `LIBERATION_TOKEN` / `SHOPIFY_ADMIN_TOKEN` if not already in the environment.
  5. **Step 4: Extract.** Call `mcp__data-liberation__liberate_extract` and stream `sendLoggingMessage` events as agent narration.
  6. **Step 5: Verify.** Call `mcp__data-liberation__liberate_verify`. Surface any quality issues; offer to retry or proceed.
  7. **Step 6: Setup (delegate).** Call `mcp__data-liberation__liberate_setup` with `delegate: true`. Receive the manifest of requirements.
  8. **Step 7: Create the Studio site.** Derive a slug from the source domain (e.g. `example-wixsite-com-migrated`). Call `mcp__studio__site_create` with a blueprint that inlines the WXR via `importWxr` (per research-report §7 + `wave-1-dla-inventory.md` §9 — this is the path DLA itself uses to dodge the WP-CLI 120s IPC timeout). The skill must explain in markdown the importWxr blueprint shape so the model can construct it.
  9. **Step 8: Import (delegate).** Call `mcp__data-liberation__liberate_import` with `delegate: true`. The model receives a manifest `{ wxrFile, outputDir, mediaDir, productsCsv?, redirectMap, importAuthors }`. For products CSV (Shopify only), call `mcp__studio__wp_cli` with `wc product_importer ...` (the same flow `wave-1-dla-inventory.md` §9 describes).
  10. **Step 9: Wrap up.** Use `AskUserQuestion` to ask whether to open the site in the browser. Show URL.
- Cross-reference: skill includes a "What this skill does NOT do" footer documenting the explicit deferral of Approach E (`/migrate --headless`) per research-report scope.

Tests in the same task: a small Vitest case in `apps/cli/ai/tests/plugin-skills.test.ts` (new file or extend an existing one) that reads `apps/cli/ai/plugin/skills/migrate/SKILL.md`, parses the YAML frontmatter, and asserts `name === 'migrate'`, `user-invocable === true` (with C), and `allowed-tools` contains the expected tool list. Use a minimal frontmatter parser (e.g. `js-yaml`) — `apps/cli/package.json` does not currently have one, so bring in a small helper or regex parse.

**Acceptance criteria.**
- `apps/cli/ai/plugin/skills/migrate/SKILL.md` exists with the frontmatter and body described above.
- `npx eslint --fix` has nothing to do (markdown).
- Skill loads at runtime (verify by typing `/migrate` in `studio code` and observing the agent's introduction — manual verification, can be flagged as a TODO).
- New test passes.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/ai/plugin/skills/migrate/SKILL.md` (new)
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/ai/tests/plugin-skills.test.ts` (new or extension)
- Reference: `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/ai/plugin/skills/taxonomist/SKILL.md` (style precedent)

---

## T8 [code] — `canUseTool` callback for DLA permission scoping (Open Question 2)

**What.** Research-report Open Question 2 recommends a per-tool default permissions policy for DLA's MCP tools, since `permissionMode: 'auto'` would otherwise auto-approve write-to-disk and remote-write tools. Implement a `canUseTool` callback in `apps/cli/ai/agent.ts` (signature: `sdk.d.ts:1142-1145`) that:

- Auto-approves `mcp__data-liberation__liberate_detect`, `_discover`, `_inspect`, `_status`, `_verify` (read-only).
- For `mcp__data-liberation__liberate_extract`, ask once per session via the existing `AskUserQuestion` UI hook (use a Set in module scope keyed by session id to remember the answer for the rest of the turn).
- For `mcp__data-liberation__liberate_import`, always ask **unless** the call's `delegate: true` flag is set in `tool_input` — `delegate: true` is safe (no remote write); the import goes through Studio's own `wp_cli`. Inspect `tool_input.delegate` directly.
- For `mcp__data-liberation__liberate_setup`, mirror `_extract` (ask once).
- For `mcp__data-liberation__liberate_map_apis` and `_probe`, ask once (CDP-based; user may not have a Chromium open).
- Default-passthrough for all non-DLA tools (return `behavior: 'allow'` with a sentinel that lets the auto classifier handle it — check the SDK type for the right shape; the callback returns `{ behavior: 'allow' | 'deny' | 'ask', ... }`).

Wire the callback through to `query()`'s `options.canUseTool`. Reuse the existing `onAskUser`/`AskUserQuestion` plumbing where possible so the prompt is consistent with how Studio already asks for confirmation.

If the implementer judges this scope too large for a single task, they may flag it for a follow-up. **Default: in scope for this PR** (the spec recommends a per-tool default and provides the policy).

Tests in the same task: extend `apps/cli/ai/tests/agent.test.ts`:
- "auto-approves DLA read-only tools".
- "asks for `_extract` and remembers answer for the session".
- "auto-approves `_import` when `delegate: true`".
- "asks for `_import` when `delegate: false`".

**Acceptance criteria.**
- `apps/cli/ai/agent.ts` exports a `buildCanUseToolCallback()` (or inline) and wires it to `query()`.
- New tests pass.
- `npm run typecheck` passes (the SDK callback signature is non-trivial; see `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1142-1145`).
- Manual verification of the `delegate: true` short-circuit for `_import`.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/ai/agent.ts`
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/ai/tests/agent.test.ts`

---

## T9 [docs] — Document `/migrate` in `apps/cli/README.md`

**What.** Add a new section to `apps/cli/README.md` (after "Studio Code", before "Import and export") titled "Migrate from a closed platform" describing:

- Supported platforms (the eight DLA covers): GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix.
- Usage: `/migrate` inside `studio code`, or `/migrate https://my-site.example/`.
- That the agent walks the user through detect → extract → verify → site-create → import.
- Auth requirements (Webflow/Shopify tokens via env vars).
- That the migrated site lands as a fresh Studio site under `~/Studio/`.

Keep it short — three or four paragraphs and a code block. Add a brief "Powered by [Data Liberation Agent](https://github.com/Automattic/data-liberation-agent)" credit line.

Update the table of contents at `apps/cli/README.md:32` to include the new anchor.

**Acceptance criteria.**
- `apps/cli/README.md` has a new "Migrate from a closed platform" section.
- ToC updated.
- Markdown lints cleanly.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/apps/cli/README.md`

---

## T10 [docs] — Update `docs/design-docs/cli.md` with DLA architecture section

**What.** Add a new architecture section to `docs/design-docs/cli.md` titled "Data Liberation Agent integration" describing:

- That DLA is vendored at a pinned SHA into `apps/cli/ai/dla/` via `scripts/download-data-liberation-agent.ts` (postinstall step).
- That it loads as a second local SDK plugin alongside `apps/cli/ai/plugin/`, registered via `agent.ts:130-149`.
- That its MCP server runs as a stdio child process spawned with `process.execPath` against the pre-compiled `apps/cli/ai/dla/src/mcp-server.js`.
- The `delegate: true` handoff contract — DLA returns a manifest of artifact paths; Studio handles `site_create` and `wp_cli`-driven import.
- Permission scoping — `canUseTool` callback applies per-tool defaults (see T8).
- Update cadence — DLA is pinned by SHA; bumping is a one-line change in the fetch script.
- Reference the canonical research report (`issues/rsm-1639-dla-integration/research-report.md`) for trade-off rationale.

This task gates on T2–T8 being settled because it documents what was actually built.

**Acceptance criteria.**
- `docs/design-docs/cli.md` has a new "Data Liberation Agent integration" section.
- All paths and code references in the section verified accurate against the as-merged code.

**Files likely involved.**
- `/Users/iamposti/Automattic/repos/studio/.claude/worktrees/rsm-1639-dla-integration/docs/design-docs/cli.md`

---

## Notes for the orchestrator

- **Out of band per the prompt:** the doc-reviewer at PR completion will rewrite the PR description to cover both research and implementation; no separate task plans for that. PR title is not changed.
- **Research-report Open Questions resolved during planning:**
  - OQ1 (vite.config.prod.ts plugin gap): T1 fixes it as part of this PR.
  - OQ2 (permission scoping): T8 implements the recommended per-tool defaults.
  - OQ3 (tsx-at-runtime): T2 pre-compiles, eliminating the runtime tsx dependency.
  - OQ5 (`user-invocable` spelling): T7 uses the correct spelling. The pre-existing Studio skills are not migrated as part of this PR (orthogonal cleanup).
  - OQ6 (private-repo distribution): the fetch script uses a `GH_PAT` env var with a graceful skip-when-missing; documented as a known limitation in T2.
- **Open questions deferred upstream:** OQ4 (multi-plugin name namespacing) and OQ7 (DLA orphan-cleanup behavior) are flagged in code comments; they require a real `cli:package` run with DLA vendored to verify and are not blocking the first PR. OQ8 (update notifier) is acceptable as-is.
- **Out-of-scope items confirmed:** Approach E (`/migrate --headless`), Approach C (npm dep), and any `apps/studio/` changes — none planned.
