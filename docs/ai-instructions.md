# AI Instructions

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Building and Running
- `npm start` - Start Electron app in dev mode (opens automatically with DevTools)
- `npm run cli:build` - Build CLI once (outputs to `dist/cli/main.js`)
- `npm run cli:watch` - Build CLI in watch mode
- `node dist/cli/main.js` - Run the built CLI

### Testing
- `npm test` - Run unit tests (Jest)
- `npm run test:watch` - Run tests in watch mode
- `npm run e2e` - Run end-to-end tests (Playwright)
- `npm run test:metrics` - Run performance metrics tests

### Code Quality
- `npm run lint` - Lint TypeScript/JavaScript files
- `npm run format` - Format code with Prettier
- **IMPORTANT**: When formatting code, ONLY format the files you've modified. Use `npx prettier --write <file1> <file2>` instead of `npm run format` to avoid formatting the entire codebase

### Building Installers
- `npm run package` - Package the app (no installer)
- `npm run make` - Build installers for current platform
- `npm run make:macos-x64` - Build macOS Intel installer
- `npm run make:macos-arm64` - Build macOS Apple Silicon installer
- `npm run make:windows-x64` - Build Windows x64 installer
- `npm run make:windows-arm64` - Build Windows ARM64 installer

### Process Considerations
When editing code, hot reload behavior differs by process:
- **Renderer Process** (React/UI): Reloads automatically
- **Main Process** (Node.js/backend): Requires restart - either restart the app or type `rs` in the terminal

### Running a Single Test
```bash
npm test -- path/to/test.test.ts
npm test -- --testNamePattern="test name pattern"
```

## CLI Commands

The Studio CLI provides commands for managing authentication, preview sites, and local sites (beta). All CLI commands follow this pattern:

```bash
npm run cli:build && node dist/cli/main.js <command>
```

### Authentication Commands

#### `studio auth login`
Log in to WordPress.com using OAuth2 authentication.

**Usage:**
```bash
node dist/cli/main.js auth login
```

**Description:**
This command initiates the WordPress.com OAuth2 authentication flow:
1. Opens your default browser to the WordPress.com authorization page
2. After authorization, you'll be redirected to a page with your access token
3. Copy the token and paste it back into the terminal
4. The token is stored in your app data and shared with the Studio desktop app

**Options:**
- None required

**Example:**
```bash
npm run cli:build
node dist/cli/main.js auth login
# Browser opens for authentication
# Copy token from browser and paste when prompted
```

**Notes:**
- The access token is valid for 2 weeks
- If already authenticated, the command will notify you
- Authentication is shared between the CLI and the Studio desktop app
- If the browser fails to open, the URL will be displayed for manual opening

#### `studio auth logout`
Log out from WordPress.com and revoke the access token.

**Usage:**
```bash
node dist/cli/main.js auth logout
```

**Description:**
This command logs you out from WordPress.com by:
1. Revoking the access token on the WordPress.com server
2. Removing the token from your local app data
3. Syncing the logout state with the Studio desktop app

**Options:**
- None required

**Example:**
```bash
npm run cli:build
node dist/cli/main.js auth logout
# Output: ✓ Successfully logged out
```

**Notes:**
- If already logged out, the command will notify you without error
- Logout is shared between the CLI and the Studio desktop app
- The token is revoked on WordPress.com, invalidating all sessions using that token

#### `studio auth status`
Check authentication status and display the current WordPress.com username.

**Usage:**
```bash
node dist/cli/main.js auth status
```

**Description:**
This command checks if you are currently authenticated with WordPress.com by:
1. Reading the authentication token from your local app data
2. Verifying the token's validity by making an API request to WordPress.com
3. Displaying your WordPress.com username if authenticated

**Options:**
- None required

**Example:**
```bash
npm run cli:build
node dist/cli/main.js auth status
# Output when authenticated: ✓ Authenticated with WordPress.com as `username`
# Output when not authenticated: ✗ Authentication token is invalid or expired
```

**Notes:**
- The command will check both token existence and validity
- If the token has expired (older than 2 weeks), you'll need to log in again
- Authentication state is shared between the CLI and the Studio desktop app
- No authentication token will be created; use `auth login` if not authenticated

### Preview Site Commands

See the existing preview site commands (create, list, delete, update) in `cli/commands/preview/`.

### Local Site Commands

See the site management commands (create, list, start, etc) in `cli/commands/site/`.

## WordPress Studio - Architecture Overview

WordPress Studio is a desktop application for creating, managing, and testing WordPress sites locally. It's built as an Electron desktop application with a React renderer, powered by WordPress Playground and PHP WASM.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│           ELECTRON MAIN PROCESS (Node.js)           │
├─────────────────────────────────────────────────────┤
│ • IPC Handler Layer (ipc-handlers.ts)               │
│ • Site Server Management (site-server.ts)           │
│ • WordPress Provider Abstraction                    │
│ • Storage & User Data Management                    │
│ • OAuth / Authentication                            │
│ • Sync Operations (WordPress.com / Pressable)      │
│ • File Operations & Migrations                      │
└──────────────┬──────────────────┬───────────────────┘
               │                  │
      ┌────────▼─────────┐   ┌────▼──────────┐
      │ RENDERER PROCESS │   │ PRELOAD SCRIPT│
      │   (React App)    │   │ (IPC Bridge)  │
      └────────────────┬─┘   └───────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│        WORDPRESS PROVIDERS                  │
├──────────────────────────────────────────────┤
│ • Playground-CLI Provider (with Blueprints) │
│ • WP-Now Provider (fallback)                │
│ • PHP WASM Runtime                          │
│ • Server Process Management                 │
└─────────────────────────────────────────────┘
```

## Directory Structure

### `/src` - Main Electron Application (Renderer + Main Process)
- **`index.ts`** - Electron main process entry point, app lifecycle management
- **`renderer.ts`** - React renderer initialization
- **`preload.ts`** - Preload script defining IPC API bridge (contextBridge)
- **`ipc-handlers.ts`** - All IPC handler implementations (communication between main and renderer)
- **`ipc-utils.ts`** - IPC utility functions for sending events to renderer
- **`main-window.ts`** - BrowserWindow creation and management
- **`menu.ts`** - Application menu setup
- **`site-server.ts`** - SiteServer class managing individual WordPress site instances
- **`storage/`** - User data persistence and app state storage
- **`stores/`** - Redux RTK stores (centralized state management)
- **`lib/`** - Utility libraries and business logic
  - `wordpress-provider/` - Abstraction layer for WordPress runtime (Playground vs WP-Now)
  - `import-export/` - Site backup/restore functionality
  - `sync/` - WordPress.com sync operations
  - `certificate-manager.ts` - HTTPS certificate generation for custom domains
  - `proxy-server.ts` - Local HTTP proxy for custom domain routing
  - `wp-cli-process.ts` - WP-CLI command execution wrapper
- **`components/`** - React UI components
  - `root.tsx` - Root component with all context providers
  - `app.tsx` - Main app layout
  - `main-sidebar.tsx` - Site list and navigation
  - `site-content-tabs.tsx` - Tabbed interface (Overview, Settings, etc.)
- **`hooks/`** - Custom React hooks for data fetching and state management
- **`modules/`** - Feature-specific modules with their own UI and logic
  - `sync/` - WordPress.com sync UI and logic
  - `cli/` - CLI command handling
  - `user-settings/` - Settings UI
  - `preview-site/` - Preview sites functionality
- **`migrations/`** - Database/storage migrations for app updates

### `/cli` - Command-Line Interface
- **`index.ts`** - CLI entry point using yargs
- **`commands/`** - Command implementations
  - `auth/` - Authentication commands (login to WordPress.com)
  - `preview/` - Preview site management commands
  - `site/` - Local site management commands (beta)
- **`lib/`** - CLI-specific utilities and helpers
  - `appdata.ts` - Reading app configuration
  - `i18n.ts` - Locale loading for CLI
  - `browser.ts` - Cross-platform browser opening utility

### `/common` - Shared Code (Both Main and Renderer)
- **`lib/`** - Shared utility libraries
  - `fs-utils.ts` - File system operations
  - `port-finder.ts` - Port management and availability checking
  - `locale.ts` - Localization/i18n utilities
  - `oauth.ts` - OAuth URL construction
- **`types/`** - TypeScript type definitions used across the app
  - `snapshot.ts` - Site snapshot types
  - `stats.ts` - Analytics/telemetry types
  - `site.ts` - Core site data types
- **`translations/`** - i18n translation strings in multiple languages

### `/packages` - Monorepo Packages
- **`eslint-plugin-studio`** - Custom ESLint rules for the project

## Key Architecture Patterns

### 1. Electron Process Architecture
- **Main Process** (`src/index.ts`): Handles app lifecycle, creates windows, file operations, server management
- **Renderer Process** (React app): UI layer, communicates with main via IPC
- **Preload Script** (`src/preload.ts`): Sandboxed bridge between renderer and main process via `contextBridge`

### 2. IPC Communication Pattern
```typescript
// Preload (src/preload.ts) exposes:
window.ipcApi.startServer(siteId) // Invoke (request-response)
window.ipcApi.openSiteURL(id)     // Send (one-way)

// Main (src/ipc-handlers.ts) handles:
ipcMain.handle('startServer', async (event, siteId) => { ... })
ipcMain.on('openSiteURL', (event, id) => { ... })

// CLI Installation API (delegated to src/modules/cli/lib/installation):
window.ipcApi.isStudioCliInstalled() // Check CLI installation status
window.ipcApi.installStudioCli()     // Install the CLI
window.ipcApi.uninstallStudioCli()   // Uninstall the CLI
```

### 3. WordPress Provider Pattern (Strategy Pattern)
Two implementations for running WordPress:
- **PlaygroundCliProvider**: Uses `@wp-playground/cli` with Blueprint support (feature-gated)
- **WpNowProvider**: Fallback provider with core functionality

Both implement the `WordPressProvider` interface with methods:
- `startServer()` - Start a WordPress site
- `setupWordPressSite()` - Initialize WordPress installation
- `createServerProcess()` - Create server child process

### 4. Redux Store Architecture (RTK)
```typescript
// src/stores/index.ts
- chat: Chat/AI Assistant messages
- sync: WordPress.com sync state
- connectedSites: Connected WordPress.com sites
- snapshot: Site snapshots/backups
- onboarding: First-run experience state
- provider constants: WordPress/PHP versions
- RTK Query APIs for data fetching:
  - wpcomApi: WordPress.com API calls
  - installedAppsApi: System apps detection, CLI installation status
  - wordpressVersionsApi: Available WP versions

// installedAppsApi endpoints (src/stores/installed-apps-api.ts):
- getStudioCliIsInstalled: Query CLI installation status
- getInstalledApps: Query installed editors and terminals
- getUserEditor: Get user's preferred editor
- getUserTerminal: Get user's preferred terminal
- saveStudioCliIsInstalled: Mutation to install/uninstall CLI
- saveUserEditor: Mutation to save preferred editor
- saveUserTerminal: Mutation to save preferred terminal
```

### 5. Site Management
**SiteServer Class** (`src/site-server.ts`):
- Manages individual WordPress site instances
- Handles server start/stop
- Manages SSL certificates for custom domains
- Integrates with port finder and host file management
- Metadata: WordPress version, blueprint configuration

### 6. Data Flow
```
User Action (React) 
  ↓
IPC Call to Main Process (via contextBridge)
  ↓
IPC Handler Logic (src/ipc-handlers.ts)
  ↓
Business Logic (lib/*, modules/*)
  ↓
WordPress Provider / SiteServer
  ↓
Response back to Renderer
  ↓
Redux State Update / Re-render
```

## Core Technologies & Dependencies

### Frontend (Renderer)
- **React 18** - UI library
- **Redux Toolkit** - State management
- **RTK Query** - Data fetching and caching
- **@wordpress/components** - WordPress UI component library
- **TailwindCSS** - Utility-first CSS
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server

### Main Process
- **Electron 38** - Desktop framework
- **@php-wasm/node** - PHP runtime in Node.js
- **@php-wasm/universal** - Universal PHP WASM
- **@wp-playground/blueprints** - Blueprint compilation
- **@wp-playground/cli** - Playground CLI integration
- **express** - Lightweight HTTP server for sites

### Development
- **electron-vite** - Electron build orchestration
- **electron-forge** - Electron packaging and distribution
- **jest** - Unit testing
- **Playwright** - E2E testing
- **ESLint / Prettier** - Code quality

### Other Key Libraries
- **Sentry** - Error tracking and monitoring
- **wpcom** - WordPress.com API client
- **zod** - Schema validation
- **yargs** - CLI argument parsing

## Build & Distribution

### Build Process
1. **CLI Build** (`vite build --config vite.cli.config.ts`) - Build standalone CLI
2. **Electron Build** (`electron-vite build`) - Compiles main, preload, and renderer
3. **Package** (`electron-forge make`) - Creates platform-specific installers

### Supported Platforms
- **macOS** (Intel x64, Apple Silicon ARM64) - DMG installers
- **Windows** (x64, ARM64) - MSIX/Squirrel.Windows
- **Linux** - DEB packages

### Bundling
- Main process: Rollup bundles to single file with multiple entry points
- Renderer: Vite with React plugin, CSS code splitting, chunk optimization
- Resources: wp-files, assets, bin scripts, CLI executable included in ASAR archive

## Important Conventions

### File Naming
- React components: PascalCase (e.g., `MainSidebar.tsx`)
- Utilities/helpers: camelCase (e.g., `get-site-url.ts`)
- Types/interfaces: Define in separate files or within usage files
- Tests: `.test.ts` or `.test.tsx` suffix

### IPC Handler Pattern
```typescript
// In src/ipc-handlers.ts - always follows this pattern:
export async function handlerName(
  event: IpcMainInvokeEvent,
  ...args: Parameters
): Promise<ReturnType> {
  // Implementation
}

// Define handler names in src/constants.ts
export const IPC_VOID_HANDLERS = ['openSiteURL', ...] // Fire-and-forget
```

### Storage Pattern
User data stored at:
- **macOS**: `~/Library/Application Support/WordPress Studio/appdata-v1.json`
- **Windows**: `%APPDATA%/WordPress Studio/appdata-v1.json`
- **Linux**: `~/.config/WordPress Studio/appdata-v1.json`

Storage is protected by file locking (`lockAppdata()` / `unlockAppdata()`).

### Localization
- Strings use `@wordpress/i18n` (`__()` function)
- Locales loaded from `common/translations/`
- Renderer uses `<I18nProvider>` context
- CLI translates via `loadTranslations()` in CLI bootstrap

## WordPress Playground Integration

### Blueprints
- Complex site configurations declaratively defined
- Compiled to runtime executable by `@wp-playground/blueprints`
- Feature detection/filtering: `filterUnsupportedBlueprintFeatures()` in `src/lib/blueprint-features.ts`
- Passed to server startup for automatic setup

### PHP WASM Runtime
- `@php-wasm/node` provides PHP runtime in Node.js
- Runs in child processes via `WorkerThreads`
- WP-CLI integration: `WpCliProcess` class wraps CLI commands
- Server process: Handles PHP execution and WordPress HTTP requests

## Sync & WordPress.com Integration

### Authentication
- OAuth flow via `common/lib/oauth.ts`
- Token stored securely in app storage
- Integrated with `wpcom` library for API calls

### Sync Operations
- Modeled as async operations with progress tracking
- Stored in Redux state (`sync` slice)
- Can be canceled by user
- Persist state across app restarts

### Supported Sync Features
- Pull: Download WordPress.com site to local
- Push: Upload local site to WordPress.com
- Selective sync: Choose what content to transfer (plugins, themes, database, etc.)

## Key Entry Points

- **App Start**: `npm start` → electron-vite dev server
- **CLI**: `npm run cli:build` → builds `/dist/cli/index.js`
- **Tests**: `npm test` → Jest test runner
- **E2E Tests**: `npm run e2e` → Playwright
- **Packaging**: `npm run make` → electron-forge make (creates installers)

## State Management Strategy

Redux is used for UI state that needs to be preserved:
- Chat message history (localStorage persisted)
- Sync operations in progress
- Connected WordPress.com sites
- Snapshots/backups
- Onboarding completion status

Local component state used for temporary UI interactions.

## Security Considerations

1. **Renderer Sandbox**: All renderers run sandboxed (enforced with `app.enableSandbox()`)
2. **IPC Validation**: All IPC senders validated against expected origin
3. **Content Security Policy**: Strict CSP header set for main window
4. **No Node Integration**: Renderer cannot access Node.js APIs directly
5. **HTTPS Support**: Optional HTTPS for custom domains with self-signed certificates
6. **Password Encoding**: Admin passwords encoded/decoded for storage

## Performance Optimizations

- **Code Splitting**: Vendor and Sentry chunks extracted separately
- **CSS Code Split**: Separate CSS files for better caching
- **WASM Bundling**: WASM files included as external assets
- **Port Finder**: Efficient port availability checking with caching
- **Snapshot System**: Browser-like snapshots for fast site restoration

---

Last Updated: 2025-11-10
Repository: https://github.com/Automattic/studio
License: GPLv2 or later
