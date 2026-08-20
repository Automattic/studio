# AI Instructions

WordPress Studio - Electron desktop app for managing local WordPress sites. Built with React + TypeScript, uses WordPress Playground (PHP WASM) for running sites.

## Essential Commands

**Dev/Build**: `npm start` | `npm run cli:build` | `node apps/cli/dist/cli/main.mjs`
**Test**: `npm test [-- path/to/test.test.ts]` | `npm run e2e`
**Quality**: `npx eslint --fix <files>` (lint and format ONLY modified files)
**IMPORTANT - Post-Change Verification**: After applying code changes, always run the linter and format modified files (`npx eslint --fix <files>`), the type checker (`npm run typecheck`) and run relevant tests (`npm test [-- path/to/test]`) before considering the work complete. For any UI/CSS change, also verify the result in **both light and dark** color schemes.
**Package**: `npm run make` (builds installers for current platform)

**IMPORTANT - Hot Reload**: Renderer auto-reloads, Main process needs restart (or `rs` in terminal). Changes to Main process IPC handlers require full restart.

## CLI Commands

**MUST** build CLI before testing: `npm run cli:build && node apps/cli/dist/cli/main.mjs <command>`
- **Auth**: `auth login|logout|status` - WordPress.com OAuth (tokens valid 2 weeks)
- **Preview Sites**: See `apps/cli/commands/preview/`
- **Local Sites**: See `apps/cli/commands/site/`
- **Agentic UI (`apps/ui`)**: To verify UI changes, run `npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui --no-open`, then open http://localhost:8081 with a browser tool (Playwright/Chrome MCP) and check both light and dark themes. Note: plain `cli:build` does NOT rebuild `apps/ui` — use `cli:build:ui`. Default port 8081 (`--port` to override).

## Architecture

**Electron 3-Process**: Main (Node.js) → Preload (IPC bridge) → Renderer (React)
**Main Process** (`apps/studio/src/`): IPC handlers, site servers, storage, OAuth, sync, migrations
**Renderer** (`apps/studio/src/components`, `apps/studio/src/hooks`): React UI, Redux stores, TailwindCSS
**CLI** (`apps/cli/`): WordPress Playground (PHP WASM), yargs commands, child process of desktop app
**Browser UI** (second front end, alongside Electron): `studio ui` starts `@studio/local` (Express + SSE), which serves the `apps/ui` React app and forks the CLI for site and agent operations. `@studio/hosted` is the experimental remote backend for that same UI.

## Directory Structure

**`/apps/studio/src`**: Main (index.ts, ipc-handlers.ts, site-server.ts, storage/, lib/) | Renderer (components/, hooks/, stores/) | modules/ (sync, cli, user-settings, preview-site)
**`/apps/cli`**: index.ts, commands/ (auth, preview, site), lib/ (appdata, i18n, browser)
**`/apps/ui`**: Agentic browser UI (`@studio/ui`). app/ (providers, router), components/, data/, hooks/, lib/. **Different stack from `apps/studio`** — React 19, TanStack Query + Router, `@wordpress/ui` + `ThemeProvider`; no Redux, no Tailwind. Built per target: `build:local` / `build:hosted`.
**`/apps/local`**, **`/apps/hosted`**: HTTP/SSE backends for `apps/ui`. `local` is bundled into the CLI; `hosted` is experimental.
**`/packages/common`**: Shared lib/ (fs-utils, port-finder, oauth), types/, translations/
**`/tools/eslint-plugin-studio`**: eslint-plugin-studio

## Key Patterns

**IPC**: Renderer → `window.ipcApi.*` → Preload (contextBridge) → Main `ipc-handlers.ts` → Business logic
**CliServerProcess**: Desktop spawns CLI as child process (`apps/studio/src/modules/cli/lib/cli-server-process.ts`)
**Redux Stores**: chat, sync, connectedSites, snapshot, onboarding | RTK Query APIs: wpcomApi, installedAppsApi, wordpressVersionsApi
**SiteServer** (`apps/studio/src/site-server.ts`): Manages site instances, server start/stop, SSL certs, ports

## Tech Stack

**Frontend**: React 18, Redux Toolkit + RTK Query, @wordpress/components, TailwindCSS, TypeScript, Vite
**Main**: Electron
**CLI**: @wp-playground/cli, @php-wasm/node, @wp-playground/blueprints
**Dev**: electron-vite, electron-forge, Vitest, Playwright
**Other**: Sentry, wpcom, zod, yargs

## Build & Distribution

**Build**: CLI (`vite build --config apps/cli/vite.config.dev.ts`) → Electron (`electron-vite build --config apps/studio/electron.vite.config.ts`) → Package (`electron-forge make --config apps/studio/forge.config.ts`)
**Platforms**: macOS (x64/ARM64 DMG), Windows (x64/ARM64 MSIX), Linux (DEB)
**Bundling**: Rollup (main), Vite (renderer with code splitting), ASAR (resources)

## Conventions

**Files**: React components (PascalCase), utils (camelCase), tests (.test.ts/.tsx)
**Class names (`cx`)**: Use `cx()` (`apps/studio/src/lib/cx.ts`) only to join classes with conditions (e.g. `cx( 'base', isActive && 'active' )`). For a single static string, pass the bare string instead of wrapping it — `className="h-full"`, not `className={ cx( 'h-full' ) }`. Enforced (and auto-fixed) by the `studio/no-redundant-cx` ESLint rule (`tools/eslint-plugin-studio`).
**Theming / colors (renderer CSS)**: Each app in `apps/` has its own dark-mode strategy — identify which app a file belongs to before picking color tokens:
- **`apps/studio` (legacy renderer)**: supports light + dark via `@media (prefers-color-scheme: dark)`. For any **color** (text, background, border, fill, brand/theme, error/running states) **MUST** use Studio's dark-aware `--color-frame-*` tokens defined in `apps/studio/src/index.css` (e.g. `--color-frame-text`, `--color-frame-bg`, `--color-frame-surface`, `--color-frame-border`, `--color-frame-theme`, `--color-frame-error`). **NEVER** use `--wpds-color-*` tokens for color here — no app-wide color `ThemeProvider` wraps this app (only density-scoped ones inside Studio Code), so they fall back to light-only values from `@wordpress/ui` and render broken (invisible text, wrong borders) in dark mode. When a needed color has no `--color-frame-*` token, add one (with both light and dark values) rather than reaching for `--wpds-color-*`. As of June 2026 there is no plan to refactor `apps/studio` onto `ThemeProvider` — it may be replaced entirely.
- **`apps/ui` (agentic UI)**: the whole canvas is wrapped in `ThemeProvider` (`apps/ui/src/app/app-providers.tsx`), so the rule is the **opposite** — always use `--wpds-color-*` variables for color; they adapt to the active theme. Do not use `--color-frame-*` tokens here.
- Non-color `--wpds-*` tokens (`--wpds-dimension-*`, `--wpds-typography-*`, `--wpds-border-width-*`, `--wpds-elevation-*`, `--wpds-cursor-*`) are theme-independent and fine to use in any app.

**IPC Handlers** (`apps/studio/src/ipc-handlers.ts`): **MUST** `export async function handlerName(event, ...args): Promise<ReturnType>` | Handler names in `apps/studio/src/constants.ts` | All handlers MUST be async and return Promises
**Storage**: **CRITICAL** - Always use file locking when writing config. Each config file has its own lockfile and helpers: `lockAppdata()` / `unlockAppdata()` for `app.json` (`apps/studio/src/storage/user-data.ts`), `lockCliConfig()` / `unlockCliConfig()` for `cli.json` (`apps/cli/lib/cli-config/core.ts`), and `lockSharedConfig()` / `unlockSharedConfig()` for `shared.json` (`packages/common/lib/shared-config.ts`).
**i18n**: `@wordpress/i18n` (`__()` function), `packages/common/translations/`, `<I18nProvider>` (renderer), `loadTranslations()` (CLI)
**i18n - Never translate at module level**: **CRITICAL** - Do NOT call translation functions (`__()`, `_x()`, `_n()`, `_nx()`) in module-level constants, object literals, or arrays. They run when the module is first imported — before the locale data loads — so the string is captured once and never updates. This matters for the **legacy `apps/studio` renderer**, which is long-lived and swaps locale data live when the user switches language, so a string evaluated at import time stays stale in the old language until restart. Always wrap them in a function so they are re-evaluated at render/call time: use `const getLabel = () => __( 'Label' )` instead of `const LABEL = __( 'Label' )`. `apps/cli` and `apps/ui` are excluded from the rule: the CLI is a one-shot process that loads the locale before importing modules, and the agentic UI reloads the window on language change, so neither can hold a stale string. Enforced by the `studio/no-module-level-translations` ESLint rule (`tools/eslint-plugin-studio`).

## WordPress Studio Paths

**App Data:** All platforms use `~/.studio/` (user's home directory). Resolve paths via the helpers in `packages/common/lib/well-known-paths.ts` (`getConfigDirectory`, `getSharedConfigPath`, `getAppConfigPath`, `getCliConfigPath`) rather than hardcoding.
- `~/.studio/shared.json` — state shared between Desktop and CLI (e.g. locale)
- `~/.studio/cli.json` — sites + snapshots (CLI-owned)
- `~/.studio/app.json` — Desktop-only state (UI prefs, sync, per-site metadata, etc.)
- Deprecated: pre-split builds used a single `appdata-v1.json` under the Electron platform path (macOS: `~/Library/Application Support/Studio/`, Windows: `%APPDATA%\Studio\`). On first launch the migration at `apps/studio/src/migrations/02-migrate-to-split-config.ts` splits it into the three files above and renames the original to `appdata-v1.deprecated.json`.

**Logs:**
- macOS: `~/Library/Logs/Studio/`
- Windows: `%APPDATA%\Studio\logs\`

**Sites:**
- All platforms: `~/Studio/` (user's home directory)

## Git & PR Conventions

**Branches**: Create from `trunk` using dash-separated lowercase names. Include a verb for clarity. Examples: `new-dark-mode`, `improve-agent-instructions`, `fix-login-bug`, `add-logout-button`. For Linear issues: `stu-123-update-sync-feature`.
**Commits**: Single-line messages. Clear and descriptive. Focus on "what" and "why", not "how"
**Code comments**: Before pushing the changes, remove any verbose code comments that narrate what the change does or why it was made (e.g. `// Added this to fix X`, `// Changed from Y to Z`, restating the code in prose). Such explanation belongs in the PR description, not the source. Only keep comments that a future reader genuinely needs — non-obvious rationale, gotchas, links to context — and match the comment density and style of the surrounding code.
**PRs**: Create PR against `trunk` branch. Use the template from `.github/PULL_REQUEST_TEMPLATE.md` (include Related issues, How AI was used in this PR, Proposed Changes, Testing Instructions, Pre-merge Checklist). In **Proposed Changes**, focus on the intent of the change and the user impact (the "why" and how the user experiences it) — do not list modified files or describe implementation mechanics; the diff already shows that. MUST pass all CI checks before merge.
**IMPORTANT**: Prefer merging `trunk` into your branch over rebasing. Avoid force pushes to trunk/main branches. Avoid force pushes to already-pushed branches - add new commits instead.

## Autonomous Agent (Agent Sandbox) Runs

Studio issues on the **Studio App & CLI** Linear team (`STU-*`) can be picked up by the Agent Sandbox. The pipeline triages the assigned issue and invokes the agent, which opens a PR autonomously, headless, in a sandbox. If you are that agent:

- **Stay in scope.** Touch only the files the issue requires. Prefer the smallest change that resolves it; avoid unrelated refactors.
- **Verify before claiming done.** Run `npx eslint --fix` on modified files, `npm run typecheck`, and `npm test -- <path>` for affected tests. e2e (`npm run e2e`) usually isn't runnable in the sandbox — rely on unit tests; if it is available, run it last, after everything else passes. If the toolchain or a dependency install is unavailable in the sandbox, say so explicitly — never assert a change is verified when it isn't.
- **You cannot see the Desktop Classic UI.** Visual and dark-mode correctness of `apps/studio` can't be confirmed headless. For UI/CSS changes there, use the `--color-frame-*` tokens (never `--wpds-color-*`) and flag the PR for human visual review. Add this line to the PR description so reviewers don't miss it: `> ⚠️ Visual change: needs human review in light + dark mode.` Exception: `apps/ui` (Agentic UI) IS verifiable — serve it via `npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui --no-open` (http://localhost:8081) and inspect with a browser tool if available.
- **Open a draft PoC for big or speculative work.** If the change adds a new dependency, spans a new architectural boundary (e.g. a new IPC handler + Redux slice + UI), or touches many files, open it as a draft Proof of Concept (see below) instead of merge-ready.

## Large & Exploratory Contributions (Vibe-Coded Features)

If you've built a substantial new feature — especially one generated with AI assistance or built rapidly without prior team alignment — treat your PR as a **Proof of Concept** rather than a merge-ready change:

- **Open the PR as a draft** and add the `Proof of Concept` label. This signals the team that the PR is intended as directional guidance rather than production-ready code.
- **Open a companion issue first** (or reference an existing one). The CONTRIBUTING.md recommends this for new features — it lets the team review the plan before implementation work begins.
- **Describe intent clearly in the PR body**: What problem does this solve? What tradeoffs were made? What would need to change before this could be merged into core?
- **Don't expect a fast merge path**: Proof of Concept PRs are valuable as starting points and discussion anchors, but the team will likely want to revisit architecture, tests, and polish before landing them.
- **Keep scope visible**: If the change touches many files or crosses architectural boundaries (e.g., new IPC handlers + new Redux slices + new UI), call that out explicitly so reviewers know what they're evaluating.

## Common Pitfalls

**CRITICAL - Dark Mode Color Tokens**: The right color tokens depend on the app. In `apps/studio`, use `--color-frame-*` tokens for all colors, never `--wpds-color-*` — without a `ThemeProvider`, the wpds color tokens keep their hardcoded light fallbacks and do not respond to dark mode, so components look correct in light mode but break in dark (regression fixed in "Fix Dark theme for Studio Code"). In `apps/ui`, do the opposite: use `--wpds-color-*` tokens — the app-wide `ThemeProvider` makes them adapt to the active theme. In all apps, always test new/changed UI in BOTH color schemes before declaring done — macOS: System Settings → Appearance → Dark.

**IMPORTANT - Two Front Ends, One Feature**: `apps/ui` runs in both the Desktop app and the `studio ui` browser app, reaching the same data through different connectors (`apps/ui/src/data/core/connectors/`): `ipc` talks to the Electron main process, `local` talks to the `apps/local` HTTP server. Implementing a `Connector` method for only one target leaves a gap in the other, and it fails **silently** — the `local` connector tends to fall back to browser-local defaults rather than error, so the browser UI quietly shows stale or empty values. When you add or change a `Connector` method, do both sides: the main-process IPC handler AND an `apps/local` route. Desktop-owned state in `app.json` is readable from the server via `readAppConfig`/`updateAppConfig` (`packages/common/lib/app-config.ts`) — prefer that over keeping a separate copy in the browser, and put the fallback for an unset value in `packages/common` so the two can't drift. Verify in both: the Desktop app, and `npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui --no-open`.

**CRITICAL - WordPress Core Files**: Do NOT edit WordPress core files within site directories. Studio uses WordPress Playground (PHP WASM), and core modifications won't persist or function correctly.

**CRITICAL - Config File Locking**: Each config file has its own lockfile and helper pair — ensure that any write operation uses the correct pair for that specific file. Use `lockAppdata()` / `unlockAppdata()` for `app.json`, `lockCliConfig()` / `unlockCliConfig()` for `cli.json`, and `lockSharedConfig()` / `unlockSharedConfig()` for `shared.json`. Concurrent unlocked writes will corrupt the file.

**IMPORTANT - CLI Build Required**: Running CLI commands without first running `npm run cli:build` will execute stale/outdated code. Always build before testing CLI changes.

**IMPORTANT - Main Process Restarts**: Hot reload (`rs` or auto-restart) does NOT pick up new IPC handlers or changes to Main process initialization. Full app restart required for Main process changes.

**Async IPC Handlers**: All IPC handlers MUST return Promises. Synchronous handlers will break the IPC communication pattern.

**Context Isolation**: Renderer is sandboxed - direct Node.js API access not available. MUST use IPC (`window.ipcApi.*`) for all Main process operations.

**Port Conflicts**: Site servers dynamically allocate ports. Don't hardcode port numbers; use the port-finder utility.

**CRITICAL - Playground/PHP-WASM Package Versions**: Always pin `@wp-playground/*` and `@php-wasm/*` packages to **exact versions** (no `^` or `~` ranges) in all `package.json` files. A caret range causes `install:bundle` to resolve a newer version when one publishes, creating a version conflict. npm then installs duplicate copies of all PHP WASM packages nested under the conflicting package's `node_modules/`. The `prune-php-wasm` vite plugin only removes top-level asyncify directories and misses nested copies, resulting in ~450 MB of bloat in the app bundle. More critically, different parts of Studio end up running mismatched Playground/PHP-WASM versions, which can cause subtle and hard-to-diagnose runtime failures in core site operations.

## Detailed Documentation

For in-depth information, see these docs:
- **CLI Design**: `docs/design-docs/cli.md` - CLI architecture, installation, IPC communication, data flow
- **Custom Domains/SSL**: `docs/design-docs/custom-domains-and-ssl.md` - Proxy server, certificates, hosts file
- **Analytics (Tracks)**: `docs/design-docs/analytics-tracks.md` - Tracks vs MC Stats, anonymous identity, opt-out, event catalog
- **Localization**: `docs/localization.md` - GlotPress workflow, translation process
- **wp-lsp Agent Integration**: `docs/design-docs/wp-lsp-agent.md` - WordPress language server in Studio Code, Lsp tool, post-edit diagnostics, impact measurement
- **Release Process**: `docs/release-process.md` - ReleasesV2 + Fastlane lifecycle, running lanes locally
- **Overview**: `README.md` - Features, download links, contribution guidelines

## Quick Reference

**WP Playground**: CLI runs WordPress via PHP WASM, Blueprints for config, `validateBlueprintData()` for schema validation
**Sync**: OAuth via `packages/common/lib/oauth.ts`, Redux `sync` slice, pull/push WordPress.com sites
**Security**: Renderer sandboxed, IPC validation, strict CSP, no Node integration, self-signed HTTPS certs

---

Repo: https://github.com/Automattic/studio | GPLv2+
