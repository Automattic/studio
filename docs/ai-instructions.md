# AI Instructions

WordPress Studio - Electron desktop app for managing local WordPress sites. Built with React + TypeScript, uses WordPress Playground (PHP WASM) for running sites.

## Essential Commands

**Dev/Build**: `npm start` | `npm run cli:build` | `node dist/cli/main.js`
**Test**: `npm test [-- path/to/test.test.ts]` | `npm run e2e`
**Quality**: `npm run lint` | `npx prettier --write <files>` (format ONLY modified files)
**Package**: `npm run make` (builds installers for current platform)

**Hot Reload**: Renderer auto-reloads, Main process needs restart (or `rs` in terminal)

## CLI Commands

CLI pattern: `npm run cli:build && node dist/cli/main.js <command>`
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
**Main**: Electron 38, express
**CLI**: @wp-playground/cli, @php-wasm/node, @wp-playground/blueprints
**Dev**: electron-vite, electron-forge, Vitest, Playwright
**Other**: Sentry, wpcom, zod, yargs

## Build & Distribution

**Build**: CLI (`vite build --config apps/cli/vite.config.ts`) → Electron (`electron-vite build --config apps/studio/electron.vite.config.ts`) → Package (`electron-forge make --config apps/studio/forge.config.ts`)
**Platforms**: macOS (x64/ARM64 DMG), Windows (x64/ARM64 MSIX), Linux (DEB)
**Bundling**: Rollup (main), Vite (renderer with code splitting), ASAR (resources)

## Conventions

**Files**: React components (PascalCase), utils (camelCase), tests (.test.ts/.tsx)
**IPC Handlers** (`apps/studio/src/ipc-handlers.ts`): `export async function handlerName(event, ...args): Promise<ReturnType>` | Handler names in `apps/studio/src/constants.ts`
**Storage**: `~/Library/Application Support/WordPress Studio/appdata-v1.json` (macOS), `%APPDATA%/...` (Win), `~/.config/...` (Linux) | File locking: `lockAppdata()` / `unlockAppdata()`
**i18n**: `@wordpress/i18n` (`__()` function), `tools/common/translations/`, `<I18nProvider>` (renderer), `loadTranslations()` (CLI)

## Detailed Documentation

For in-depth information, see these docs:
- **CLI Design**: `docs/design-docs/cli.md` - CLI architecture, installation, IPC communication, data flow
- **Custom Domains/SSL**: `docs/design-docs/custom-domains-and-ssl.md` - Proxy server, certificates, hosts file
- **Localization**: `docs/localization.md` - GlotPress workflow, translation process
- **Release Process**: `docs/release-process.md` - Version tagging, Buildkite builds
- **Overview**: `README.md` - Features, download links, contribution guidelines

## Quick Reference

**WP Playground**: CLI runs WordPress via PHP WASM, Blueprints for config, `filterUnsupportedBlueprintFeatures()` for compatibility
**Sync**: OAuth via `tools/common/lib/oauth.ts`, Redux `sync` slice, pull/push WordPress.com sites
**Security**: Renderer sandboxed, IPC validation, strict CSP, no Node integration, self-signed HTTPS certs

---

Repo: https://github.com/Automattic/studio | GPLv2+
