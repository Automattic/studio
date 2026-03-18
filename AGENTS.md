# AI Instructions

WordPress Studio - Electron desktop app for managing local WordPress sites. Built with React + TypeScript, uses WordPress Playground (PHP WASM) for running sites.

## Essential Commands

**Dev/Build**: `npm start` | `npm run cli:build` | `node apps/cli/dist/cli/main.js`
**Test**: `npm test [-- path/to/test.test.ts]` | `npm run e2e`
**Quality**: `npx eslint --fix <files>` (lint and format ONLY modified files)
**IMPORTANT - Post-Change Verification**: After applying code changes, always run the linter and format modified files (`npx eslint --fix <files>`), the type checker (`npm run typecheck`) and run relevant tests (`npm test [-- path/to/test]`) before considering the work complete.
**Package**: `npm run make` (builds installers for current platform)

**IMPORTANT - Hot Reload**: Renderer auto-reloads, Main process needs restart (or `rs` in terminal). Changes to Main process IPC handlers require full restart.

## CLI Commands

**MUST** build CLI before testing: `npm run cli:build && node apps/cli/dist/cli/main.js <command>`
- **Auth**: `auth login|logout|status` - WordPress.com OAuth (tokens valid 2 weeks)
- **Preview Sites**: See `apps/cli/commands/preview/`
- **Local Sites**: See `apps/cli/commands/site/`

## Architecture

**Electron 3-Process**: Main (Node.js) → Preload (IPC bridge) → Renderer (React)
**Main Process** (`apps/studio/src/`): IPC handlers, site servers, storage, OAuth, sync, migrations
**Renderer** (`apps/studio/src/components`, `apps/studio/src/hooks`): React UI, Redux stores, TailwindCSS
**CLI** (`apps/cli/`): WordPress Playground (PHP WASM), yargs commands, child process of desktop app

## Directory Structure

**`/apps/studio/src`**: Main (index.ts, ipc-handlers.ts, site-server.ts, storage/, lib/) | Renderer (components/, hooks/, stores/) | modules/ (sync, cli, user-settings, preview-site)
**`/apps/cli`**: index.ts, commands/ (auth, preview, site), lib/ (appdata, i18n, browser)
**`/tools/common`**: Shared lib/ (fs-utils, port-finder, oauth), types/, translations/
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
**IPC Handlers** (`apps/studio/src/ipc-handlers.ts`): **MUST** `export async function handlerName(event, ...args): Promise<ReturnType>` | Handler names in `apps/studio/src/constants.ts` | All handlers MUST be async and return Promises
**Storage**: **CRITICAL** - Always use file locking: `lockAppdata()` / `unlockAppdata()` to prevent data corruption
**i18n**: `@wordpress/i18n` (`__()` function), `tools/common/translations/`, `<I18nProvider>` (renderer), `loadTranslations()` (CLI)

## WordPress Studio Paths

**App Data:**
- macOS: `~/Library/Application Support/Studio/appdata-v1.json`
- Windows: `%APPDATA%\Studio\appdata-v1.json` (expands to `C:\Users\<username>\AppData\Roaming\Studio\appdata-v1.json`)

**Logs:**
- macOS: `~/Library/Logs/Studio/`
- Windows: `%APPDATA%\Studio\logs\`

**Sites:**
- All platforms: `~/Studio/` (user's home directory)

## Git & PR Conventions

**Branches**: Create from `trunk` using dash-separated lowercase names. Include a verb for clarity. Examples: `new-dark-mode`, `improve-agent-instructions`, `fix-login-bug`, `add-logout-button`. For Linear issues: `stu-123-update-sync-feature`.
**Commits**: Single-line messages. Clear and descriptive. Focus on "what" and "why", not "how"
**PRs**: Create PR against `trunk` branch. Use the template from `.github/PULL_REQUEST_TEMPLATE.md` (include Related issues, Proposed Changes, Testing Instructions, Pre-merge Checklist). MUST pass all CI checks before merge.
**IMPORTANT**: Prefer merging `trunk` into your branch over rebasing. Avoid force pushes to trunk/main branches. Avoid force pushes to already-pushed branches - add new commits instead.

## Large & Exploratory Contributions (Vibe-Coded Features)

If you've built a substantial new feature — especially one generated with AI assistance or built rapidly without prior team alignment — treat your PR as a **Proof of Concept** rather than a merge-ready change:

- **Open the PR as a draft** and add the `Proof of Concept` label. This signals the team that the PR is intended as directional guidance rather than production-ready code.
- **Open a companion issue first** (or reference an existing one). The CONTRIBUTING.md recommends this for new features — it lets the team review the plan before implementation work begins.
- **Describe intent clearly in the PR body**: What problem does this solve? What tradeoffs were made? What would need to change before this could be merged into core?
- **Don't expect a fast merge path**: Proof of Concept PRs are valuable as starting points and discussion anchors, but the team will likely want to revisit architecture, tests, and polish before landing them.
- **Keep scope visible**: If the change touches many files or crosses architectural boundaries (e.g., new IPC handlers + new Redux slices + new UI), call that out explicitly so reviewers know what they're evaluating.

## Common Pitfalls

**CRITICAL - WordPress Core Files**: Do NOT edit WordPress core files within site directories. Studio uses WordPress Playground (PHP WASM), and core modifications won't persist or function correctly.

**CRITICAL - Appdata Locking**: Always wrap appdata file operations with `lockAppdata()` / `unlockAppdata()`. Concurrent writes will corrupt the database file.

**IMPORTANT - CLI Build Required**: Running CLI commands without first running `npm run cli:build` will execute stale/outdated code. Always build before testing CLI changes.

**IMPORTANT - Main Process Restarts**: Hot reload (`rs` or auto-restart) does NOT pick up new IPC handlers or changes to Main process initialization. Full app restart required for Main process changes.

**Async IPC Handlers**: All IPC handlers MUST return Promises. Synchronous handlers will break the IPC communication pattern.

**Context Isolation**: Renderer is sandboxed - direct Node.js API access not available. MUST use IPC (`window.ipcApi.*`) for all Main process operations.

**Port Conflicts**: Site servers dynamically allocate ports. Don't hardcode port numbers; use the port-finder utility.

## Detailed Documentation

For in-depth information, see these docs:
- **CLI Design**: `docs/design-docs/cli.md` - CLI architecture, installation, IPC communication, data flow
- **Custom Domains/SSL**: `docs/design-docs/custom-domains-and-ssl.md` - Proxy server, certificates, hosts file
- **Localization**: `docs/localization.md` - GlotPress workflow, translation process
- **Release Process**: `docs/release-process.md` - ReleasesV2 + Fastlane lifecycle, running lanes locally
- **Overview**: `README.md` - Features, download links, contribution guidelines

## Quick Reference

**WP Playground**: CLI runs WordPress via PHP WASM, Blueprints for config, `filterUnsupportedBlueprintFeatures()` for compatibility
**Sync**: OAuth via `tools/common/lib/oauth.ts`, Redux `sync` slice, pull/push WordPress.com sites
**Security**: Renderer sandboxed, IPC validation, strict CSP, no Node integration, self-signed HTTPS certs

---

Repo: https://github.com/Automattic/studio | GPLv2+
