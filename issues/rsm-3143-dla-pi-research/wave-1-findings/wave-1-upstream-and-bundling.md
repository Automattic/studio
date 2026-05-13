---
task: wave-1-upstream-and-bundling
wave: 1
status: complete
---

# Wave 1 — Upstream-pi feasibility + DLA bundling/distribution against pi

## TL;DR

- **Upstream-pi: do not bet RSM-3143 on it.** The package is a single-maintainer side project (`Mario Zechner`, `badlogic`) shipping **3–7 patch releases per week**. The maintainer already declined to land a first-party MCP example in pi-coding-agent itself: issue #563 was closed Jan 2026 with "we don't need to add an MCP example anymore" — the blessed answer is the third-party `pi-mcp-adapter` (Nico Bailon), which is built on pi's **public extension API** (`ExtensionFactory`/`registerTool`/`session_start`). Studio's `apps/cli/ai/runtimes/pi/index.ts` explicitly *opts out* of that extension surface via `noExtensions: true` and goes through `createAgentSession({ customTools, tools })`. A separate upstream PR to add an `mcpServers` slot to `CreateAgentSessionOptions` is plausible in shape but very unlikely to land soon: (a) the project is in the middle of a public refactor + package-scope rename (`@mariozechner/*` → `@earendil-works/*`, in progress since 0.73.x), (b) contributions from new contributors are auto-closed by default, (c) the maintainer's stated philosophy is "if it doesn't belong in core it should be an extension." Treat Upstream-pi as **not on the critical path** — Studio still gets the same effect via Studio-owned wiring around `customTools`.
- **Bundling, Bridge profile (`npx tsx src/mcp-server.ts`):** **Blocked as written, fixable with work.** Studio's packaged Electron CLI bundles its own `node` binary (`scripts/download-node-binary.ts`) but does **not** ship `npm` or `npx`. DLA's `tsx` is in DLA's `devDependencies`, so Studio's `install:bundle` (`npm install --omit=dev …`) drops it. Spawning `npx tsx ...` at runtime in a packaged install would fail unless Studio either (a) adds `tsx` to `apps/cli/package.json` `dependencies`, (b) runs DLA's `tsc` at Studio build time and spawns the built `dist/mcp-server.js`, or (c) pre-bundles DLA's MCP server entry through Vite. All three are workable; none is free.
- **Bundling, Vendor profile (`import 'data-liberation/src/lib/...'` at build time):** **Blocked as written, harder to fix.** Studio CLI runs plain Node ESM at runtime (no `tsx`, no ts-node). DLA ships TypeScript source only — `dist/` is gitignored and `npm install` from `github:` does **not** trigger DLA's `build` script (it's not in `scripts.postinstall`; only `playwright install chromium` is). Vite's externalization rule keeps `data-liberation/...` imports external, so they hit `node_modules/data-liberation/...` at runtime — which is `.ts`. Vendor needs either (i) a Studio-build-time bundling step that pulls DLA's sources through Vite/rollup (gives up the "wrap DLA's `src/lib` directly" simplicity), or (ii) a Studio-owned `npm run build` step against DLA after install (a `tsc` invocation). Either is real work.
- **`github:` dep:** Mechanically works against current trunk. `npm install --omit=dev` against `data-liberation: github:Automattic/data-liberation-agent#<sha>` succeeded in a clean test (373 packages added). Lockfile resolves the SHA to `git+ssh://git@github.com/...#<sha>`; npm/git fall back to HTTPS for public repos, so CI runners without an SSH key are fine. **Pin by commit SHA**, not branch or tag — DLA has no tags or releases. Studio CI is `npm ci` + lockfile, dependabot is positive-allowlist, so a `github:` dep won't auto-update; explicit bumps required.
- **Marginal size cost for Vendor:** A fresh DLA install in isolation = **~633 MB / 260 packages / 373 nodes total**. Most overlaps with Studio's tree (226 of 260 top-level dep names already present in Studio's hoisted `node_modules`); the marginal cost during workspace install is much smaller, but during `apps/cli`'s standalone `install:bundle` (which uses `--no-workspaces`), DLA does duplicate `@php-wasm/*` and `@wp-playground/*` trees. Licenses are clean (241 MIT, 22 GPL-2.0-or-later — Studio-compatible).
- **Native deps / postinstall:** DLA's `postinstall: playwright install chromium` will download **~150 MB of headless Chromium** into Playwright's per-user cache on every `npm install` — even for users who only migrate from API-only platforms. Studio CLI already depends on `playwright@^1.52.0`, so the Chromium browser binary itself may already be on disk (Playwright shares cache by version), but the postinstall *will* still run and re-check.

---

## 1. Upstream-pi feasibility

### 1.1 Maintainer & release cadence

**Package identity.** `@mariozechner/pi-coding-agent` is the published name; Studio pins `0.70.2` (2026-04-24). Metadata from `npm view @mariozechner/pi-coding-agent`:

- `author: Mario Zechner`
- `maintainers: badlogic <mario@badlogicgames.com>, mitsuhiko <armin.ronacher@active-4.com>` (Armin Ronacher / mitsuhiko of Flask fame appears as co-maintainer).
- `repository.url: git+https://github.com/badlogic/pi-mono.git` — **this URL now 301-redirects** to `https://github.com/earendil-works/pi`. The repo was renamed/relocated as part of a package-scope migration (CHANGELOG: "0.74.0 — Updated repository links and package references for the move to `earendil-works/pi-mono` and `@earendil-works/*` package scopes").
- `license: MIT`.
- Discord-driven community at `discord.com/invite/3cU7Bz4UPx`.

**Repo signals (`earendil-works/pi`):** 49 000 stars, 5 828 forks, 36 open issues, 4 000+ closed issues — the project has explosive growth and active development.

**Release cadence** — extremely high. Last 25 versions span **2026-04-13 → 2026-05-07 (24 days)**, so roughly **one patch release per day** in steady state, with multiple same-day releases on busy days. Studio's pinned `0.70.2` is already **3+ minor versions behind** (`0.71`/`0.72`/`0.73`/`0.74` shipped in the 13 days after).

| Version | Released | Note |
|---|---|---|
| `0.70.2` | 2026-04-24 | Studio's pinned version |
| `0.70.6` | 2026-04-28 | |
| `0.71.0` | 2026-04-30 | |
| `0.72.0` | 2026-05-01 | |
| `0.73.0` | 2026-05-04 | |
| `0.73.1` | 2026-05-07 | Adds `pi update --self` rename support |
| `0.74.0` | 2026-05-07 | **Last `@mariozechner/*` release** — followed by first `@earendil-works/pi-coding-agent@0.74.0` (2026-05-07T15:15) |

**Bottom line:** one-/two-person open-source project, not Automattic-internal. Velocity is high; breaking-changes risk is non-trivial — Studio's `0.70.2` pin is already lagging by an entire scope-rename cycle.

### 1.2 Issue-tracker scan (MCP requests)

The public issue tracker is at `github.com/earendil-works/pi` (formerly `badlogic/pi-mono`). Two definitive data points:

**Issue #563 — `feat(coding-agent): Add MCP extension example`** (closed 2026-01-29, opened by the maintainer himself).
The maintainer's closing comment:

> "Alright, [@nicobailon](https://github.com/nicobailon) made this, so we don't need to add an MCP example anymore.
> https://www.npmjs.com/package/pi-mcp-adapter"

This is the blessed upstream answer: pi-coding-agent will *not* add an in-tree MCP example or built-in MCP slot. Pi's official position is "use the third-party `pi-mcp-adapter` extension."

**PR #3774 — `feat(mcp): add MCP extension with stdio/SSE transport support`** (auto-closed 2026-04-26, never merged).
A drive-by PR adding `.pi/extensions/mcp/` was auto-closed within seconds — the project's `CONTRIBUTING.md` documents an explicit "Contribution Gate" that auto-closes all PRs from new contributors, requiring an `lgtm` from a maintainer to even submit. The PR was AI-written ("🤖 Generated with Claude Code"), so it would have been rejected anyway.

**Other relevant tracker signals:**

- Issue #4326 (closed-because-refactor, 2026-05-08) — `pi-mcp-adapter` itself causes a TUI crash on non-string tool descriptions. Indicates the MCP adapter ecosystem is still finding edge cases.
- Issue #4085 (closed, 2026-05-02) — request to add `pi.unregisterTool` / `pi.replaceTools` for hot-swappable MCP tool catalogs. Also tied back to `pi-mcp-adapter`. **The maintainer's `closed-because-refactor` label dominates** mid-2026 issues — a "big refactor" is in progress.

**Conclusion:** the maintainer's position has been publicly stated and acted on. MCP support in pi-coding-agent core is **not coming** as a built-in `mcpServers` slot on `createAgentSession`. The blessed answer is the extension API, which is *already public* in pi-coding-agent (`ExtensionAPI`, `registerTool`, lifecycle hooks; see `node_modules/@mariozechner/pi-coding-agent/dist/index.d.ts` and `docs/extensions.md`).

### 1.3 Plausible upstream API shape — and why it's the wrong question

If we *did* contribute upstream, the realistic shapes are:

1. **`customMcpServers` slot on `CreateAgentSessionOptions`.** Internally, `createAgentSession` would resolve each `{ command, args, env }` to a stdio MCP client, call `ListTools`, wrap each as a pi `ToolDefinition` (mirroring the `customTools` path), and pass through to the underlying `AgentSessionRuntime`. This is the smallest, most-host-friendly shape. Mario has already rejected it once (#563), so getting it past review would require selling him on a use case beyond what `pi-mcp-adapter` provides.

2. **Bless a sanctioned "factory" pattern.** Pi already exports `createAgentSessionFromServices`, `createAgentSessionServices`, and `createAgentSessionRuntime` (see `index.d.ts` exports above), which Studio doesn't currently use. We could land a small `createMcpToolDefinitions(servers): Promise<ToolDefinition[]>` helper in `pi-coding-agent` proper that returns the same shape Studio's wrapper would build in-tree, then expose it from `index.ts`. Lower bar to acceptance because it's just a utility, not a runtime change.

3. **Promote the extension API as the contract.** The contribution would be docs + types only — recommend that hosts wanting MCP use the existing `registerTool` + `session_start` extension surface. This is the **shape Mario has effectively chosen**. Studio could adopt `pi-mcp-adapter` as a dependency or vendor its logic into a Studio-owned extension. Both still mean Studio owns the runtime wiring, just at a different layer.

**Reading the tea leaves:** option 3 is what Mario will accept. Options 1 and 2 are pipe dreams given the maintainer's stated philosophy ("pi's core is minimal. If your feature does not belong in the core, it should be an extension. PRs that bloat the core will likely be rejected." — `CONTRIBUTING.md`).

### 1.4 Timeline estimate

Order-of-magnitude only — single-maintainer projects are bursty.

- **Optimistic (PR accepted):** 4–8 weeks. Requires (a) a maintainer relationship (`lgtmi` → `lgtm` in pi's contribution gate; humans on Discord can shortcut this), (b) waiting through the in-progress `@earendil-works/*` migration to settle, (c) shaping the PR exactly as Mario wants (likely "extension API docs only" per §1.3.3). After merge, wait for a Studio-targeted release.
- **Realistic:** 8–16 weeks, accounting for back-and-forth on contract shape and the fact that pi's velocity will likely produce a fresh breaking change (e.g. another scope rename or refactor) mid-cycle that we have to chase.
- **Pessimistic / never:** Mario closes the PR with the same "use the extension API / pi-mcp-adapter" answer he already gave #563. Probability not negligible.

**Compare with shipping in-tree:** Bridge or Vendor inside Studio's repo is unblocked the moment we decide on a shape — call it 2–4 weeks of focused work for an MVP, plus the package/wiring it inherits from RSM-1639's wave-2 plan.

**Verdict on timeline:** Upstream-pi is **slower than in-tree** in every scenario and *much* slower in the realistic one. The cost-of-waiting on Studio's `/migrate` slash command isn't worth the upstream cleanliness.

### 1.5 Risk of *not* upstreaming

If we ship Bridge or Vendor as Studio-owned:

| Risk | Severity | Mitigation |
|---|---|---|
| **Pin to pi 0.70.x indefinitely.** Studio's wiring uses `customTools` + `tools` allowlist; pi's extension API is the maintainer's preferred direction. If pi changes either signature in 0.71+, Studio rebases. | Medium — pi's `createAgentSession` API has been the supported shape for the last 70+ minor versions, so it likely stays stable, but pi's velocity means churn is constant. | Track pi releases; budget 2–4 hrs of catch-up per Studio release. |
| **Divergence from `pi-mcp-adapter`.** If pi-mcp-adapter becomes the de-facto MCP-bridge layer and grows features Studio doesn't have (token-efficient proxy tool, lazy connections, hot-reload), Studio's hand-rolled bridge looks dated. | Low/Medium — Studio's bridge can mature in parallel; nothing forces feature parity. | Re-evaluate at RSM-3143's first post-ship checkpoint. |
| **Maintainer relationship debt.** If pi or pi-mcp-adapter introduces a breaking change in their wire contract and Studio is *not* in the conversation, we find out at user-install time. | Low — Studio pins versions; breakage is bounded by upgrade decisions. | Pin tightly; Renovate-style alerts on `@mariozechner/pi-coding-agent` (which dependabot doesn't watch today, so manual). |
| **Brittleness against pi releases.** `pi-tui` already needs a Studio-owned patch (`patches/@mariozechner+pi-tui+*.patch` per `apps/cli/scripts/postinstall-npm.mjs:23`). Bridge or Vendor could similarly accumulate patches. | Medium — Studio already accepts this cost for `pi-tui`. | Accept; the patch-package workflow is documented. |

**Conclusion:** the risk of going alone is **bounded and acceptable**. Pi's maintainer has signalled that upstream MCP support is not coming via `createAgentSession` — there's no future in which Studio doesn't own *some* host-side MCP plumbing.

### 1.6 Verdict (upstream-pi)

**Kill it as an approach.** Land MCP wiring Studio-owned (Bridge or Vendor). Optionally contribute documentation upstream once we know our shape — that's a goodwill gesture, not a critical-path item.

Concretely:
- Do not block RSM-3143 on a pi upstream PR.
- Treat `pi-mcp-adapter` as **prior art / library candidate** for the Bridge approach: it has 663 stars, recent activity (2026-05-13 push), an MIT license, and a stated design ("token-efficient MCP adapter") that aligns with Studio's "one proxy tool, not 13 tool descriptions" needs. Worth a 30-minute spike to see if it's reusable as-is or its design is adoptable; that lives in wave-2 not wave-1.

---

## 2. Bundling & distribution

This section confirms or refutes the pipeline-level facts from `prior-art/wave-1-findings/wave-1-bundling-distribution.md` against current trunk (commit `47be387a`, post-pi migration). The Studio CLI build/packaging shape is materially unchanged from RSM-1639's writeup; what changed is the static-copy target name (`ai/skills` not `ai/plugin`) and the fact that DLA is now public (so `github:` deps are an option).

### 2.1 Bridge install path

Bridge needs: a working `node_modules/data-liberation/` reachable from the packaged binary, plus a way to spawn DLA's MCP server.

**What works:**

- **`npm install --omit=dev` against `data-liberation: github:Automattic/data-liberation-agent#<sha>` succeeds.** Verified in a clean temp directory: 373 packages added, no error. The github tarball includes everything DLA tracks in git (no `.npmignore`, so `.gitignore` rules apply — `dist/` excluded but `src/`, `commands/`, `skills/`, `cli.js`, `start.sh` all present).
- **DLA's `src/mcp-server.ts` and the resolution-relative manifests (`.mcp.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `gemini-extension.json`) land in `node_modules/data-liberation/`.** No surprises.
- **Studio's `vite.config.prod.ts` viteStaticCopy plugin copies `apps/cli/node_modules/` → `apps/cli/dist/cli/node_modules/` recursively** (`apps/cli/vite.config.prod.ts:17-24`). DLA's tree would survive. `forge.config.ts:22` then picks the whole `apps/cli/dist/cli/` up via `extraResource`, so it lands at `Studio.app/Contents/Resources/cli/node_modules/data-liberation/` (macOS) or equivalent on Win/Linux. **No ASAR rewrite needed; the CLI ships out-of-ASAR.**

**What breaks:**

1. **`tsx` is in DLA's `devDependencies`, not `dependencies`.** `cat node_modules/data-liberation/package.json` after `npm install --omit=dev`: `tsx: ^4.19.0` is in `devDependencies`. `--omit=dev` drops it. `node_modules/.bin/tsx` is **absent**. Result: `npx tsx src/mcp-server.ts` would fail with "tsx: not found" on a packaged Studio install.

2. **`npx` is not on PATH in packaged Electron CLI.** Studio bundles its own `node` binary (`scripts/download-node-binary.ts:14` — `LTS_FALLBACK = 'v24.13.1'`) but not `npm`. The `studio` shim launches the bundled node directly against `dist/cli/main.mjs` (`bin/studio-cli-launcher.js:23-39`, `bin/studio-cli.sh`, `bin/studio-cli.bat`). `PATH` resolution falls back to user shell `npx`, which on a clean machine without Node installed system-wide is unreliable. **Bridge cannot assume `npx` works at runtime.**

3. **DLA's `package.json bin: "data-liberation": "./dist/cli.js"` points to a non-existent file.** DLA's `dist/` is gitignored; no postinstall builds it. `npm install` resolves `bin` symlinks pointing to nothing — most npm versions warn but proceed. Studio cannot use DLA's bin directly.

**What fixes Bridge:**

| Option | Effort | Cost |
|---|---|---|
| **A. Add `tsx` to `apps/cli/package.json` `dependencies`.** Then spawn `<bundled-node> apps/cli/node_modules/.bin/tsx node_modules/data-liberation/src/mcp-server.ts`. | Smallest — one-line dep. | `tsx` is ~10 MB; Studio doesn't otherwise need it. Brings in `esbuild` transitive deps. |
| **B. Run DLA's `tsc` at Studio build time.** Add a script that `cd apps/cli/node_modules/data-liberation && npx tsc` after `install:bundle`. Then spawn `<bundled-node> node_modules/data-liberation/dist/mcp-server.js`. | Medium — needs a Studio-owned wrapper script. Adds `typescript` to `apps/cli` devDeps if not already. | DLA's TS sources may rely on `tsx`'s loose ESM resolution (no `.js` extensions on imports). A real `tsc` build with `moduleResolution: NodeNext` is likely to fail on the unmodified DLA tree without `tsconfig` adjustments. **Pre-spike required.** |
| **C. Pre-bundle DLA's MCP server through Vite/rollup at Studio build.** Add a new Vite entry that imports DLA's MCP server and produces `dist/cli/dla-mcp-server.mjs`. | Largest — net-new build wiring. | Removes runtime dependency on `tsx` entirely. Best for size and reproducibility. But couples Studio's release to DLA's source compatibility. Same risk as Vendor with respect to DLA's import surface. |

**Recommendation for Bridge:** start with Option A. It's the least invasive and matches DLA's manifest contract (`.mcp.json` says `npx tsx src/mcp-server.ts` — Studio just substitutes "`<our-tsx>`" for `npx tsx`). If `tsx`'s overhead becomes a problem at Studio's size budget (no documented budget exists per prior-art §1), revisit Option C.

### 2.2 Vendor install path

Vendor needs: `import { extractToWxr, ... } from 'data-liberation/src/lib/extraction/...'` to resolve at Studio's build/runtime.

**Studio's externalization rule (`vite.config.base.ts:79-91`):**

```ts
external: ( id ) => {
    if ( id.includes( 'blueprint-schema-validator' ) ) return false;
    if ( nodeBuiltinExternals.some( ( pattern ) => pattern.test( id ) ) ) return true;
    return packageJsonDependencies.some( ( dep ) => id === dep || id.startsWith( dep + '/' ) );
},
```

If `data-liberation` is added to `apps/cli/package.json` `dependencies`, **Vite externalizes both `data-liberation` and `data-liberation/...` deep imports**. They survive bundling as-is; Node resolves them at runtime against `node_modules/data-liberation/`.

**What breaks:** at runtime, Node tries to resolve `data-liberation/src/lib/extraction/wxr-builder` and hits a `.ts` file. Studio CLI is plain Node ESM — no `tsx`, no `ts-node`, no `--experimental-loader`. The import fails.

**What fixes Vendor:**

| Option | Effort | Cost |
|---|---|---|
| **V1. Compile DLA at Studio build time.** Add a Studio script that runs `tsc` against DLA's `src/` after `install:bundle`, then imports the compiled `dist/`. Same as Bridge Option B but for build-time bundling. | Medium. | Same `tsconfig` risk as Bridge B. Compiled output goes to `node_modules/data-liberation/dist/`. Imports become `data-liberation/dist/lib/extraction/wxr-builder.js`. |
| **V2. Forcibly include DLA in Vite's bundle.** Override Vite's `external` rule for `data-liberation/...` ids and let rollup pull DLA's `.ts` sources through a TS plugin. | Large — new Vite plugin, new TS pipeline, gives up the externalization shape. | Brittle; pi-coding-agent and pi-agent-core would be the only deps not externalized — code smell. |
| **V3. Vendor the bytes.** Copy DLA's `src/lib/*` modules into `apps/cli/ai/` directly, transcribe imports, run Studio's existing tsc + vite. Same shape as current `apps/cli/ai/skills/`. | Per-file effort; the migration is manual. | Loses upstream-update story unless we automate the copy. RSM-1639 §3 "Vendor (copy DLA into apps/cli/...)" was rated lowest-complexity for static plugins (markdown), but DLA's modules are real TS with intra-package imports — vendoring requires fixing every import path. |

**RSM-1639 made the same call against the old SDK:** copying DLA in worked for skills/manifests but stumbled on compiled JS. Same story here. Option V1 is the cleanest for staying in sync with upstream DLA; Option V3 is the cleanest for stability.

**Note on the import-export contract:** DLA's `package.json` does **not** define an `exports` field. That means `data-liberation/src/lib/...` deep imports are *allowed* by Node's resolution (no encapsulation), but DLA's maintainers haven't signed up to keep them stable. Per `wave-1-dla-inventory.md` §2: "`src/lib/*` and `src/adapters/*` — TypeScript modules consumed only via `mcp-server.ts` and `cli.ts`. Nothing in `package.json` exposes them as a public API." Vendor takes on the maintenance cost of tracking DLA's internal API drift.

### 2.3 `github:` dep mechanics & lockfile

**`npm install` against `"data-liberation": "github:Automattic/data-liberation-agent#<sha>"` works against the public DLA repo.** Verified in clean dir: 373 packages added in 14s; no auth prompt, no error.

**Lockfile shape** (`package-lock.json` excerpt after install):

```json
"node_modules/data-liberation": {
    "version": "0.1.0",
    "resolved": "git+ssh://git@github.com/Automattic/data-liberation-agent.git#17219c42b0420267302b138bf402930508006e0e",
    "integrity": "sha512-FCZEig2n/...",
    "hasInstallScript": true,
    "dependencies": { ... }
},
```

Important details:

1. **`integrity` is computed against the tree, not the tarball.** npm rebuilds the integrity hash per install — `npm warn skipping integrity check for git dependency` is the visible signal. Lockfile reproducibility for `github:` deps is the SHA, not a cryptographic hash. Bumping the SHA is the only way to change the dep.
2. **`resolved` rewrites `github:` → `git+ssh://git@github.com/...`.** This is npm's default behavior even when the source spec was HTTPS. For public repos, npm/git fall back to HTTPS transparently — verified by `npm ci` in a clean directory completing successfully without any SSH key configured. For *private* repos this would need an SSH key or `url."https://...".insteadOf "ssh://..."` git config. DLA is public, so this is moot.
3. **CI compatibility.** Studio's `.buildkite/commands/install-node-dependencies.sh` runs `npm ci --unsafe-perm --prefer-offline --no-audit --no-progress`. Adding a `github:` dep with a SHA pin works inside `npm ci`. Studio's GitHub Actions (`publish-npm-package.yml:27` `npm ci`) similarly work.
4. **Dependabot impact.** Studio's `.github/dependabot.yml` uses a **positive allowlist** (`@automattic/*`, `@electron/*`, `@wordpress/*`, etc.). DLA is not on the allowlist. **Dependabot will not auto-bump the SHA.** Manual bumps required. This is probably the desired behavior given DLA's pre-1.0 / unstable status.

### 2.4 Pinning strategy

Three options:

- **Commit SHA** — `github:Automattic/data-liberation-agent#17219c42b0420267302b138bf402930508006e0e`. Pinpoint-reproducible. **Recommended.**
- **Tag** — DLA has **zero git tags** (`gh api repos/Automattic/data-liberation-agent/tags` returned `[]` per `wave-1-dla-inventory.md` §10). **Not an option** until DLA starts tagging.
- **Branch** — `github:Automattic/data-liberation-agent#main`. **Anti-pattern.** Every install/CI run would resolve to whatever HEAD is, eating reproducibility. Lockfile would freeze the SHA at install time, but the spec drifts.

**Recommendation: commit SHA.** Add a Studio-owned bump script (`scripts/bump-dla.ts`) that hits `gh api repos/Automattic/data-liberation-agent/branches/main` for the latest SHA and rewrites `apps/cli/package.json`. Cadence: weekly (matches DLA's commit cadence per `wave-1-dla-inventory.md` §10 — 5 commits/day on busy days, 10 in one day on 2026-04-16) or per-release.

### 2.5 DLA's transitive deps — byte & license check

**Size measurement** (clean `npm install --omit=dev --ignore-scripts` of `data-liberation: github:Automattic/data-liberation-agent#17219c42`):

| Subtree | Size |
|---|---|
| `node_modules/@php-wasm` (all PHP versions 5.2 → 8.5) | **459 MB** |
| `node_modules/@octokit` | 61 MB |
| `node_modules/@wp-playground` | 15 MB |
| `node_modules/playwright-core` | 12 MB |
| `node_modules/es-toolkit` | 12 MB |
| `node_modules/zod` | 6.3 MB |
| `node_modules/@modelcontextprotocol` | 5.8 MB |
| `node_modules/playwright` | 4.8 MB |
| `node_modules/isomorphic-git` | 4.7 MB |
| Total | **~633 MB / 260 top-level packages** |

**Crucially:** 226 of the 260 top-level dep names already exist in Studio's hoisted root `node_modules` (Studio depends on `@php-wasm/*`, `@wp-playground/*`, `playwright` directly). At workspace-install time the trees dedupe. **The marginal cost of adding DLA to Studio's root install is small** — most of it comes from version mismatches (DLA pins `@wp-playground/cli@^3.1.20`, Studio pins `3.1.28`, so a *new* `@wp-playground/cli@3.1.20` tree may install alongside Studio's `3.1.28`).

**`install:bundle` cost** (`npm install --no-workspaces --omit=dev --install-links`): inside `apps/cli/`, the dedupe doesn't apply — DLA's `@php-wasm/*` and `@wp-playground/*` trees materialize alongside Studio's own. The 459 MB of `@php-wasm` gets duplicated. This shows up in `apps/cli/dist/cli/node_modules` post-build; then `vite.config.prod.ts`'s `prune-php-wasm` plugin (lines 30-44) strips `@php-wasm/node-*/asyncify/` directories, reclaiming ~250 MB (the prior-art doc has the math). **Net post-prune additional disk footprint of bundling DLA: ~200-300 MB**, depending on overlap.

**Per-platform binary handling.** `forge.config.ts:212-277` already prunes platform-specific binaries from `koffi` and `fs-ext-extra-prebuilt`. DLA pulls in `playwright`/`playwright-core` which already exist in Studio's tree — no new prune target needed unless DLA's version brings native binaries Studio's doesn't.

**License survey** (260 top-level deps, sampling `package.json` `license` fields):

| License | Count |
|---|---|
| MIT | 241 |
| GPL-2.0-or-later | 22 |
| ISC | 19 |
| BSD-2-Clause | 10 |
| Apache-2.0 | 7 |
| BSD-3-Clause | 5 |
| Compound (e.g. `(MIT OR Apache-2.0)`) | 7 |
| BlueOak-1.0.0, CC0-1.0, Zlib | 3 |
| Unknown / missing | 3 |

Notable directly-imported licenses:
- `@modelcontextprotocol/sdk`: MIT
- `@wp-playground/cli`: GPL-2.0-or-later (matches Studio)
- `playwright`: Apache-2.0
- `ink`, `react`, `cheerio`, `papaparse`, `fast-xml-parser`, `undici`: MIT

**Compatibility:** Studio is `GPL-2.0-or-later`; MIT/ISC/BSD/Apache-2.0 are all compatible. **No legal-flag-raising licenses found.** The 3 "unknown" entries are typically internal `@types/*` packages or odd manifests; not a real risk.

### 2.6 Postinstall / native-dep hazards

**DLA's `package.json scripts`:**

```json
"postinstall": "playwright install chromium"
```

This is the dominant risk for the install pipeline:

1. **Downloads ~150 MB of headless Chromium** per architecture into Playwright's cache (`~/Library/Caches/ms-playwright/`, `%LOCALAPPDATA%\ms-playwright\`, etc.).
2. **Runs on every `npm install`** including CI and end-user `npm install -g wp-studio`. Studio's existing `playwright` dep does *not* postinstall Chromium — Studio uses Playwright for tests only (`npm run e2e: npx playwright install && npx playwright test`). DLA pulls Chromium in transparently.
3. **Honors `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` env var** — Studio's CI/build could set this to skip the download if Chromium isn't needed at build time. But at *user* install time (`npm install -g wp-studio`), the env var isn't set, and Chromium downloads.
4. **`forge.config.ts` doesn't prune Playwright browsers** — the Chromium binary lives in `~/Library/Caches/`, not under Studio's bundle, so packaging isn't affected. **But Studio's `install:bundle` in `cli:package`** does run DLA's postinstall (downloads Chromium into the build machine's user cache, not the bundle). One-time cost per build machine.
5. **`PLAYWRIGHT_BROWSERS_PATH=0` is the recommended override** to bundle the browser into `node_modules` rather than user cache, if Studio ever wants to ship Chromium. **It does not** today.

**Other hazards — none found:**

- **No other postinstall scripts.** Verified via DLA's `package.json scripts`.
- **No `gyp` / native modules.** DLA's deps don't include node-gyp builds (no `binding.gyp`, no `node-addon-api`).
- **No prebuilt binaries beyond Playwright's.** `koffi` and `fs-ext-extra-prebuilt` (which `forge.config.ts` already handles) aren't DLA dependencies.
- **`tsx`'s esbuild has its own platform-specific binaries**, but `tsx` is in DLA's devDependencies — `--omit=dev` skips them.

**Recommendation:** if Studio adds DLA, set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in the build pipeline (Buildkite + GitHub Actions + `apps/cli/install:bundle`). The Wix/Squarespace adapters that need Chromium will fail at *runtime* without it, which is the right place to fail (and DLA's CLI bootstraps `cli.js` already detects this — `cli.js:9-12,65-120`). For end users running `npm install -g wp-studio`, accept the 150 MB download; it's an acceptable cost for a migration tool that uses headless browsers when needed.

### 2.7 Verdict per approach

| Approach | Mechanically possible? | Effort to land | Critical blockers | Recommended? |
|---|---|---|---|---|
| **Bridge** (`npx tsx src/mcp-server.ts` at runtime via wrapped MCP client) | Yes, with caveats. Needs Studio-owned tsx-launch or pre-built JS. | 2-4 days for Option A (add `tsx` dep, hand-rolled spawn). 1-2 weeks for Option C (pre-bundle). | **`tsx` not present in `--omit=dev` install. `npx` not on PATH in packaged CLI.** Both fixable in-tree. | **Recommended path** for RSM-3143. Matches DLA's manifest contract. |
| **Vendor** (`import { … } from 'data-liberation/src/lib/...'` at Studio build time) | Yes, with significant work. Needs build-time `tsc` of DLA or manual vendoring. | 1-3 weeks for build-time tsc (V1). Comparable for vendoring (V3). | **DLA ships TS only, no `dist/`, no `exports` map.** Studio runs plain Node. Build-time compile required. | **Second choice.** Higher coupling to DLA internals (no public API contract). Worth comparing in wave-2 once Bridge has a spec. |
| **`github:` dep, SHA-pinned** | Yes, fully. | Minutes once chosen. | None. Mechanically works in `npm install`/`npm ci`/CI/Buildkite. | **Recommended pinning strategy** for either Bridge or Vendor. |
| **DLA via npm publish** | No — DLA is not published to npm and has no tags/releases. Not on the roadmap (per `wave-1-dla-inventory.md` §10). | N/A. | Out of Studio's control. | **Not available.** |
| **Runtime fetch** (download DLA on first `/migrate` invocation) | Yes, conceptually. Studio's `scripts/download-agent-skills.ts` is precedent. | 1-2 weeks of network-code, retry, cache, integrity-check work. | Breaks Studio's "works offline once installed" posture. Adds attack surface. Same security review as RSM-1639 dismissed. | **Not recommended** unless Bridge/Vendor both fail. |

---

## 3. Cross-cutting notes

### 3.1 Static-copy regression flag (cross-reference to prior-art § "Possible bug")

Prior-art's `wave-1-bundling-distribution.md` §1 flagged: "`vite.config.prod.ts` is missing a static-copy target for `ai/plugin`." Post-pi-migration, the directory is `apps/cli/ai/skills/` and **the same gap exists**: `vite.config.dev.ts` and `vite.config.npm.ts` both `viteStaticCopy({ src: 'ai/skills' })`, but `vite.config.prod.ts` only copies `node_modules` and applies the asyncify prune. **`ai/skills/` is not copied in prod builds.**

At runtime, `apps/cli/ai/skills.ts:30` resolves skills from `import.meta.dirname + '/skills'`. After Vite build that's `dist/cli/skills`. The `loadSkills()` function has a defensive `console.warn` when the directory is missing (lines 33-39), so it would degrade silently to "no skills" rather than crash.

**This is unchanged by adding DLA**; flagging here only because any DLA-as-skill strategy (versus DLA-as-MCP-server) inherits this latent issue. Bridge/Vendor are unaffected — they ship via `node_modules`, not `ai/skills/`.

### 3.2 Patch-package precedent

`patches/@mariozechner+pi-tui+*.patch` already exists per `apps/cli/scripts/postinstall-npm.mjs:23`. If Studio needs to patch DLA upstream (e.g. to make `src/mcp-server.ts` runnable without `tsx`, or to coerce DLA's `Server` to a Studio-provided stdio transport), the precedent is in place. Adds maintenance debt; manageable.

### 3.3 Studio CLI's existing MCP server

`apps/cli/ai/mcp-server.ts` already exists — Studio runs its own in-process MCP server for `studio code` tools. If Bridge proceeds, Studio would end up with **two MCP servers**: its own (in-process) and DLA's (child process). That's mechanically fine — MCP servers compose — but it's worth documenting in the eventual spec.

---

## Sources

- `npm view @mariozechner/pi-coding-agent` (full JSON dump, 270 versions, 2025-11-12 → 2026-05-07).
- `npm view @earendil-works/pi-coding-agent` (1 version, 2026-05-07, scope-rename target).
- `npm view pi-mcp-adapter` (31 versions, MIT, author Nico Bailon, deps include `@earendil-works/pi-ai`).
- `npm view wp-studio@1.8.0` (current published Studio CLI deps).
- GitHub API: `gh api repos/earendil-works/pi` (49 000 stars, 36 open issues, 4 000+ closed), `gh api repos/Automattic/data-liberation-agent` (public, 29 stars, 954 KB), `gh api repos/nicobailon/pi-mcp-adapter` (663 stars, MIT).
- `gh search issues "mcp" --repo=earendil-works/pi`: 31 closed issues + 13 closed PRs found.
- Issue #563 (`feat(coding-agent): Add MCP extension example`) full body + 7 comments — maintainer's verbatim "we don't need to add an MCP example anymore" closing.
- PR #3774, PR #1221, Issue #4326, Issue #4085 — extension-API + MCP-related closures, mostly auto-closed under `closed-because-bigrefactor`.
- `earendil-works/pi/README.md` (full) — confirms `@earendil-works/*` is the new scope; project description "AI agent toolkit: coding agent CLI, unified LLM API, TUI & web UI libraries, Slack bot, vLLM pods".
- `earendil-works/pi/CONTRIBUTING.md` (full) — documents Contribution Gate (auto-close from new contributors), maintainer philosophy ("pi's core is minimal").
- `earendil-works/pi/packages/coding-agent/CHANGELOG.md` 0.72–0.74 entries.
- Local: `apps/cli/package.json`, `apps/cli/vite.config.{base,dev,prod,npm}.ts`, `apps/cli/scripts/postinstall-npm.mjs`, `apps/cli/ai/runtimes/pi/index.ts:1-285`, `apps/cli/ai/skills.ts:1-60`, `apps/studio/forge.config.ts:1-310`, `apps/studio/bin/studio-cli-launcher.js`, `scripts/download-node-binary.ts`, `.github/workflows/publish-npm-package.yml`, `.github/dependabot.yml`, `.buildkite/commands/install-node-dependencies.sh`, root `package.json`.
- `node_modules/@mariozechner/pi-coding-agent@0.70.2/dist/index.d.ts` (extension/runtime exports), `docs/extensions.md` (full).
- DLA: `gh api repos/Automattic/data-liberation-agent/contents/package.json`, `gh api repos/Automattic/data-liberation-agent/contents/cli.js`, `gh api repos/Automattic/data-liberation-agent/branches/main` (HEAD SHA `17219c42b0420267302b138bf402930508006e0e`).
- Hands-on: clean `npm install --omit=dev --ignore-scripts data-liberation@github:Automattic/data-liberation-agent#17219c42…` in a temp directory — 373 packages added in 14s, 633 MB node_modules. Followed by `npm ci` against the generated lockfile in a second temp directory — also succeeded (5s, "skipping integrity check for git dependency" warning observed).
- License survey: parsed `package.json` `license` field from all 260 top-level installed deps.
- Prior art: `prior-art/wave-1-findings/wave-1-bundling-distribution.md` (RSM-1639), `prior-art/wave-1-findings/wave-1-dla-inventory.md` (DLA inventory, still valid).
