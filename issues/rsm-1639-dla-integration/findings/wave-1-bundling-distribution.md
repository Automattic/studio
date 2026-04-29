---
task: wave-1-bundling-distribution
wave: 1
status: complete
---

# Wave 1 — Studio CLI bundling and distribution constraints for adding DLA

## TL;DR

Studio CLI ships through **two distinct pipelines** from the same source tree:

1. **npm publish (`wp-studio`)** — a thin tarball containing only the bundled `dist/cli/` (no `node_modules`); deps are installed by user's `npm install`. `viteStaticCopy` plugin copies `apps/cli/ai/plugin/` verbatim into `dist/cli/plugin/`.
2. **Electron desktop bundle** — a fat `dist/cli/` containing `node_modules/` materialized by `npm install --install-links`, used by Electron via `extraResource`. Same `apps/cli/ai/plugin/` static copy applies in dev/npm configs but **not** in `vite.config.prod.ts` (possible bug).

Both pipelines load the SDK plugin tree from a hardcoded path (`apps/cli/ai/plugin/`) at runtime. The CLI already ships a 200+ MB platform-specific Claude binary via `optionalDependencies`, an in-process MCP server, a postinstall script that fetches third-party AI skills (`scripts/download-agent-skills.ts`), and per-platform binary pruning at packaging. **No documented size budget.** `wp-studio` cadence is **roughly weekly** (1.7.7 → 1.7.11 → 1.8.0 across ~6 weeks); Electron releases ride the same release branches.

---

## 1. Build pipeline — three Vite configs

All three configs extend `vite.config.base.ts`, which:
- Six entry points: `main`, `process-manager-daemon`, `proxy-daemon`, `playground-server-child`, `php-server-child`, `reprint-child` — all output as ESM `[name].mjs` into `dist/cli/` (`vite.config.base.ts:60-77`).
- Externalizes Node builtins and every key in `package.json` `dependencies` (lines 79-91).
- Aliases `cli` → `apps/cli` and `@studio/common` → `tools/common` (lines 100-107).
- `write-dist-extras` plugin writes `dist/cli/package.json = { "type": "module" }` and copies `apps/cli/php/`, `wp-files/` (from repo root), `apps/cli/lib/pull/reprint.phar` into `dist/cli/` (lines 36-55).

| Config | Used by | `__IS_PACKAGED_FOR_NPM__` | Adds entry | Static-copies | Notes |
|---|---|---|---|---|---|
| `vite.config.dev.ts` | `npm run cli:build`, `cli:watch`. Used by Electron dev (`npm start`) and tests | `false` | `eval-runner.ts` (promptfoo) | `ai/plugin` → `dist/cli/plugin` | None |
| `vite.config.prod.ts` | `npm run cli:package` (called by Electron Forge `prePackage` hook) | inherits base default `false` | base entries only | `node_modules` → `dist/cli/node_modules` (only if `apps/cli/node_modules` exists), then `prune-php-wasm` plugin removes `@php-wasm/node-*/asyncify/` (~250 MB) | **Electron-bundled build**. Does NOT static-copy `ai/plugin/`. |
| `vite.config.npm.ts` | `npm run prepublishOnly` → published to npm as `wp-studio` | `true` | base entries only | `ai/plugin` → `dist/cli/plugin` | Adds `#!/usr/bin/env node` shebang to `main.mjs` |

**Possible bug (flag, don't fix):** `vite.config.prod.ts` is missing a static-copy target for `ai/plugin`. Either Electron-bundled `studio code` skills don't work in production, or the plugin gets copied via a path I haven't traced. **Worth a 5-minute verification with a real `cli:package` run.**

### `dist/cli/` layout estimate (configs, not measured here)

I could not run `cli:build` (sandbox denied). Disk inspection of the hoisted root `node_modules/` and `wp-files/` gives the ~floor.

**npm-pack layout (`vite.config.npm.ts` output)** — small, no node_modules:
```
dist/cli/
├── package.json                      ({ "type": "module" })
├── main.mjs                          (with #! shebang)
├── *.mjs                             (Vite chunks + side bundles)
├── reprint.phar
├── php/                              (apps/cli/php/)
├── wp-files/                         (~144 MB on disk)
│   ├── latest/                       (~81 MB — WordPress + plugins)
│   ├── phpmyadmin/                   (~52 MB)
│   ├── sqlite-command/               (~2.8 MB)
│   ├── sqlite-database-integration/  (~868 KB)
│   ├── wp-cli/                       (~6.8 MB)
│   └── skills/                       (~212 KB — downloaded from agent-skills repo)
└── plugin/                           (~68 KB — from apps/cli/ai/plugin/)
    ├── .claude-plugin/plugin.json
    └── skills/{annotate,need-for-speed,rank-me-up,site-spec,taxonomist}/SKILL.md
```

**Electron-bundled layout (`vite.config.prod.ts` output)** — large, includes node_modules:
```
dist/cli/
├── (everything above) +
└── node_modules/                     (materialized via --install-links)
    ├── @anthropic-ai/
    │   ├── claude-agent-sdk/         (~3.8 MB)
    │   └── claude-agent-sdk-{platform}-{arch}/  (~200+ MB; the `claude` binary alone is 207 MB)
    ├── @php-wasm/                    (~460 MB total; -250 MB after asyncify prune)
    ├── @wp-playground/               (~24 MB)
    ├── playwright/, playwright-core/ (~14 MB)
    └── ...other deps
```

After packaging, `forge.config.ts:182-218` further prunes per-platform binaries from `claude-agent-sdk/vendor/` and `koffi/build/koffi/` to keep the final installer smaller.

**Sizes verified from `du -sh` against hoisted root `node_modules/`:**
- `claude-agent-sdk-darwin-arm64/claude` = **206,534,320 bytes** (exact)
- `node_modules/@anthropic-ai/`: 211 MB
- `node_modules/@php-wasm/`: 460 MB (across all versions; reduced by prune in prod)
- `node_modules/@wp-playground/`: 24 MB
- `node_modules/playwright + playwright-core`: ~14 MB
- repo `wp-files/`: 144 MB

So bundled CLI inside Electron resources is roughly **~500 MB on disk before prune, ~250 MB after asyncify prune, plus 144 MB of `wp-files/`** — call it **~400 MB total bundled CLI**.

## 2. `apps/cli/ai/plugin/` bundling rules

**Source tree** (`apps/cli/ai/plugin/`):
- `.claude-plugin/plugin.json` — Claude Agent SDK plugin manifest
- `skills/<name>/SKILL.md` — frontmatter-based skill definition
- `skills/<name>/scripts/*.php` — referenced by skill (e.g. taxonomist)

**Copy rule:** Both `vite.config.dev.ts` (line 11-15) and `vite.config.npm.ts` (line 11-15):
```ts
viteStaticCopy({ targets: [ { src: 'ai/plugin', dest: '.' } ] })
```
Copies recursively into `dist/cli/plugin/`. Whole directory is the unit. **Any new file (skill, script, sub-folder) is picked up automatically — no allowlist.**

**Runtime load:** `apps/cli/ai/agent.ts:149` → `path.resolve(import.meta.dirname, 'plugin')`. At runtime in `dist/cli/`, that's `dist/cli/plugin`. SDK reads the directory and registers all skills under `skills/`.

**Slash-command coupling:** New `SKILL.md` files are auto-loaded by the SDK, but they only appear as user-typed `/foo` commands if also added to `tools/common/ai/slash-commands.ts:8-13` `AI_SKILL_COMMANDS`. Evidence: `site-spec` is in the plugin tree but **not** in `AI_SKILL_COMMANDS` (only `annotate`, `taxonomist`, `need-for-speed`, `rank-me-up` are).

## 3. Delivery-model matrix

| Aspect | Vendor (copy DLA into `apps/cli/ai/plugin/dla/`) | npm dependency | Runtime install / fetch |
|---|---|---|---|
| **Install size impact (npm `wp-studio`)** | DLA's tree added to npm tarball verbatim. ~10s of KB to a few MB if "Claude plugin + markdown skills + small Node helpers"; several MB to hundreds of MB if MCP server bundles its own node_modules. | Adds DLA as external dep. End-user `npm install -g wp-studio` pulls DLA + transitive deps. | Zero impact on tarball. First-run penalty: must `npm install` or download tarball. |
| **Install size impact (Electron bundle)** | DLA tree included in `apps/cli/dist/cli/plugin/dla/`, ASAR-unpacked. Linear add. | DLA's `node_modules` materialized by `install:bundle --install-links`. Per-platform binary pruning rules apply. | Zero impact on installer. First-run requires network — **regression** for Studio's "just works offline once installed" posture. |
| **Update story** | Updates only when Studio CLI cuts a release. **Stale by 0–6 weeks.** Manual sync or a `download-dla.ts` postinstall script (mirrors `scripts/download-agent-skills.ts`). | Semver-controlled. Ride next CLI release. | DLA can be updated independently — runtime fetches latest on demand or with TTL. **Best decoupling, worst trust/security story.** |
| **Version pinning** | Pinned by SHA/tag in vendoring script. Reproducible. | Pinned by `package.json` semver. **Lockfile not used for npm install path** (`apps/cli/package.json:63` uses `--no-package-lock`), so tilde/caret can drift. | Whatever the runtime decides. |
| **Offline behavior** | Works fully offline. Same posture as `wp-files/latest/` (WordPress is bundled). | Works offline once installed. | Breaks offline first-run. |
| **Mid-migration on reinstall** | User `npm install -g wp-studio@x` mid-migration replaces DLA's bundled tree. Migration runtime state in user-data dirs persists or doesn't depending on layout. | Same as vendor. | Worst risk: aborted partial download. Needs explicit "atomic install + verify" logic. |
| **Complexity** | Lowest if DLA is a static plugin (markdown + scripts). Highest if DLA has compiled JS — needs vendoring/build pipeline mirroring `download-agent-skills.ts`. | Medium. Requires DLA published to a registry. Fits cleanly into `install:bundle`. | High. Network code, retry/cache, version negotiation, security review. |
| **Auth / secrets handoff** | Inherits Studio's resolved env directly (DLA loaded as plugin in same process). | Same. | Subprocess: must pass env explicitly. |
| **Precedents in this repo** | `apps/cli/ai/plugin/skills/*` (existing skills are vendored). | `@anthropic-ai/claude-agent-sdk` itself (~206 MB binary via optionalDependencies). | `scripts/download-agent-skills.ts` fetches `WordPress/agent-skills` repo zip into `wp-files/skills/` at root postinstall; `scripts/download-php-binary.ts`, `download-wp-server-files.ts`, `download-language-packs.ts` — team is comfortable with build-time fetches. |

## 4. Auth handoff

**Relevant flow:**
1. `apps/cli/commands/ai/index.ts:429-431` → `resolveAiEnvironment(currentProvider, { sessionId })` returns env shaped for `ANTHROPIC_*` vars.
2. Same env passed to `startAiAgent({ env, ... })` (lines 464-472), forwarded to `query({ options: { env: resolvedEnv, ... } })` (`agent.ts:67, 130-153`). SDK spawns the `claude` binary with this env.
3. Two providers (`apps/cli/ai/providers.ts:99-163`) shape env differently:
   - `wpcom`: `ANTHROPIC_BASE_URL=<wpcom proxy>`, `ANTHROPIC_AUTH_TOKEN=<wpcom OAuth>`, custom headers, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`, `CLAUDE_CODE_MAX_RETRIES=0`.
   - `anthropic-api-key`: `ANTHROPIC_API_KEY=<saved key>`.
4. WPCOM token from `readAuthToken()` (`@studio/common/lib/shared-config`).

**Cleanest hooks for forwarding to a DLA child plugin/server:**

| DLA delivery | Anthropic creds | WPCOM creds |
|---|---|---|
| In-process Claude plugin | Inherited by SDK child process automatically | Add `env.STUDIO_WPCOM_TOKEN = (await readAuthToken())?.accessToken` in `providers.ts` `createBaseEnvironment` or per-provider `resolveEnv` |
| Stdio MCP server | Pass `env.ANTHROPIC_*` in `mcpServers.dla.env` (constructed from `resolveAiEnvironment`) | Pass via `mcpServers.dla.env.STUDIO_WPCOM_TOKEN` |
| Child-process CLI | Pass via `child_process.spawn`'s `env` argument | Same |

**Cross-cutting note (sessions, q11):** `apps/cli/ai/sessions/recorder.ts:112-118` records the raw `SDKMessage` with no per-tool awareness; `apps/cli/ai/sessions/replay.ts:50-53` re-emits via `ui.handleMessage`. Third-party plugin tool calls and results are persisted and replayed verbatim — **no schema changes needed**. The only place tool names are normalized is `apps/cli/ai/eval-runner.ts:27-29` (strips `mcp__studio__` prefix for cleaner eval output). Flag (don't solve): UI's tool-name rendering may need a tweak so unknown plugin tools render gracefully.

## 5. Cadence and staleness

**npm `wp-studio` cadence:**

- 1.7.4 → 2026-02-17
- 1.7.5 → 2026-02-26 / 2026-03-06
- 1.7.6 → 2026-03-12 to 2026-03-16
- 1.7.7 → 2026-03-24 to 2026-03-27
- 1.7.8 → 2026-04-09 to 2026-04-13
- 1.7.9 npm → 2026-04-17
- 1.7.10 npm → 2026-04-21
- 1.7.11 npm → 2026-04-23
- 1.8.0 → 2026-04-23 to 2026-04-27 (current `package.json` version)

**Roughly weekly** for `wp-studio` npm in steady state. 167 commits to `apps/cli/` in the last 6 weeks.

**Electron Studio cadence:** `release/1.x.y` branch pattern is shared between npm CLI and Electron Studio. Electron picks up the bundled CLI from `apps/cli/dist/cli/` at make-time. Electron shipping speed = CLI shipping speed in worst case.

**What "stale DLA bundled inside Studio" looks like:**
- **Vendor / npm dep**: typically **1–2 weeks behind** in steady state; up to **6 weeks** if a major release is pending.
- **Runtime install / fetch**: DLA can be at HEAD whenever the user runs `/migrate`.

**`setupUpdateNotifier` covers plugin/skill updates?** **No.** Per `apps/cli/lib/update-notifier.ts:11` (`NPM_REGISTRY_URL = 'https://registry.npmjs.org/wp-studio/latest'`), the notifier only checks `wp-studio`'s own version. It does not introspect bundled plugins, MCP servers, or skills.

## 6. Electron-side flags (do not fix; just record)

1. **Per-platform native binaries must prune cleanly.** `forge.config.ts:182-218` already prunes `@anthropic-ai/claude-agent-sdk/vendor/<tool>/<arch-platform>/` and `koffi/build/koffi/<platform_arch>/`. If DLA brings a new package with platform-specific natives, prune logic needs updating.
2. **Code-signing on Windows refuses non-PE `.node` files.** `scripts/remove-fs-ext-other-platform-binaries.mjs` documents this.
3. **macOS `osxSign` entitlements** configured for `bin/node` only.
4. **ASAR unpacking.** CLI ships via `extraResource` (out of ASAR) at `forge.config.ts:18-22`. Read-write at runtime.
5. **`AutoUnpackNativesPlugin`** handles native-modules-in-ASAR for Electron app, not extraResource.
6. **Linux DEB / Windows MSIX / macOS DMG** all ship the same `extraResource`. Runtime-fetch approach behaves the same on all three but firewall posture varies.
7. **`cli:package` mutates `apps/cli/node_modules/`.** Per `forge.config.ts:172-174`: "may need to rerun `npm ci` from the repo root to reset the dependency tree after packaging." Adding DLA via `install:bundle` participates in this destructive flow.

## Notes on what I could not verify

- **`npm run cli:build` denied** by sandbox — no fresh `du -sh apps/cli/dist/cli/` numbers.
- **Published `wp-studio` tarball size** (`dist.unpackedSize`, `dist.fileCount`) — WebFetch denied.
- **`vite.config.prod.ts` not copying `ai/plugin/`** — flagged in section 1; needs a real prod build to confirm.

## Files referenced

- `apps/cli/package.json` (lines 12-17 files, 60-67 build scripts, 4 version)
- `apps/cli/vite.config.{base,dev,prod,npm}.ts`
- `apps/cli/scripts/postinstall-npm.mjs`
- `apps/cli/index.ts`, `apps/cli/ai/{agent,providers,auth,eval-runner,slash-commands}.ts`
- `apps/cli/ai/sessions/{recorder,replay}.ts`
- `apps/cli/ai/plugin/.claude-plugin/plugin.json`
- `apps/cli/commands/ai/index.ts:429-472`
- `apps/cli/lib/update-notifier.ts`
- `apps/cli/lib/dependency-management/paths.ts`
- `apps/studio/forge.config.ts:18-22, 25-36, 143, 171-227`, `electron.vite.config.ts`
- `tools/common/ai/slash-commands.ts:8-13`
- `scripts/{download-agent-skills.ts, remove-fs-ext-other-platform-binaries.mjs}`
- `package.json:33`
- `docs/design-docs/cli.md`
- `node_modules/@anthropic-ai/claude-agent-sdk/package.json:57-66`
