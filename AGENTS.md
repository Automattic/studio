# AI Instructions

WordPress Studio - Electron desktop app for managing local WordPress sites. Built with React + TypeScript, runs sites with a bundled native PHP binary.

## Essential Commands

**Dev/Build**: `npm start` | `npm run cli:build` | `node apps/cli/dist/cli/main.mjs` | `npm -w @studio/ui run playground` (real `apps/ui` components with sample data and no backend, light and dark: chat transcript, preview animation; see `apps/ui/src/dev/README.md`)
**Test**: `npm test [-- path/to/test.test.ts]` | `npm run e2e`
**Quality**: `npx eslint --fix <files>` (lint and format ONLY modified files) | `npm run knip` (unused files, exports and dependencies across the repo; runs in CI)
**IMPORTANT - Post-Change Verification**: After applying code changes, always run the linter and format modified files (`npx eslint --fix <files>`), the type checker (`npm run typecheck`) and run relevant tests (`npm test [-- path/to/test]`) before considering the work complete. For any UI/CSS change, also verify the result in **both light and dark** color schemes.
**Package**: `npm run make` (builds installers for current platform)

**IMPORTANT - Hot Reload**: Renderer auto-reloads, Main process needs restart (or `rs` in terminal). Changes to Main process IPC handlers require full restart.

## CLI Commands

**MUST** build CLI before testing: `npm run cli:build && node apps/cli/dist/cli/main.mjs <command>`
- **Auth**: `auth login|logout|status` - WordPress.com OAuth (tokens valid 2 weeks)
- **Preview Sites**: See `apps/cli/commands/preview/`
- **Local Sites**: See `apps/cli/commands/site/`
- **Agentic UI (`apps/ui`)**: To verify UI changes, run `npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui --no-open`, then open http://localhost:8081 with a browser tool (Playwright/Chrome MCP) and check both light and dark themes. Note: plain `cli:build` does NOT rebuild `apps/ui` — use `cli:build:ui`. Default port 8081 (`--port` to override).
- **MCP Apps (`apps/mcp-ui`)**: `npm run cli:build:mcp-ui` builds the page into the CLI; plain `cli:build` does NOT rebuild it. Verify it in an agent app that renders MCP Apps, in light and dark; the WordPress library opens from the ChatGPT app's sidebar once the Studio plugin is installed.

## Agent Evals (Studio Code)

`scripts/eval/` holds a promptfoo suite that runs the real Studio Code agent end-to-end (`npm run eval`, view results with `npm run eval:view`; requires `studio auth login`). See `scripts/eval/README.md` for the case list and how to add tests.

**IMPORTANT — run the affected evals whenever you change agent-facing behavior**: the agent's system prompt, tool definitions/descriptions, tool result shapes, or agent skills/instructions. This cuts both ways: run the evals to catch behavior regressions, and check whether eval assertions need updating alongside your change — a tool result format change silently breaks assertions even when the agent behaves correctly.

Prefer targeted runs: `npm run eval -- --filter-pattern "<case>"`. The full suite takes ~25 minutes, consumes AI credits, and creates/deletes real local sites (it runs sequentially for that reason) — reserve it for system-prompt changes, which affect every case.

## Architecture

**Electron 3-Process**: Main (Node.js) → Preload (IPC bridge) → Renderer (React)
**Main Process** (`apps/studio/src/`): IPC handlers, windows and menus, updates, storage, the `wp-studio://` protocol, migrations. Site operations run in the CLI; logic shared with `studio ui` lives in `@studio/common`
**Renderer**: the `apps/ui` React app (see Directory Structure), built into the Desktop app and loaded by the main process
**CLI** (`apps/cli/`): native PHP site servers, yargs commands, child process of desktop app
**Browser UI** (second front end, alongside Electron): `studio ui` starts `@studio/local` (Express + SSE), which serves the `apps/ui` React app and forks the CLI for site and agent operations.

## Directory Structure

**`/apps/studio/src`**: Main (index.ts, ipc-handlers.ts, storage/, lib/), preload.ts | modules/<feature>/lib/ (sync, cli, user-settings, import-export, …)
**`/apps/cli`**: index.ts, commands/ (auth, preview, site), lib/ (appdata, i18n, browser)
**`/apps/ui`**: Agentic UI (`@studio/ui`), the renderer of both the Desktop app and the `studio ui` browser app. lib/ (internal packages: ui, theme, icons, hooks, keyboard, pending-slot), features/ (product areas), data/ (connectors, queries), router/, app/ (providers); boundaries in its README, lint-enforced. `build:local` builds it for `studio ui`; the Desktop build comes from `scripts/build-ui-renderer.ts`.
**`/apps/local`**: HTTP/SSE backend for `apps/ui` in the browser, bundled into the CLI.
**`/apps/mcp-ui`**: MCP Apps pages that agent apps show for `studio mcp` (`@studio/mcp-ui`), currently the WordPress library. React + TanStack Query and plain CSS, built into one HTML document that `studio mcp` serves; the data layer talks to the host through one bridge, with no connectors. Not a target of `apps/ui`: see `docs/design-docs/studio-apps-and-surfaces.md`.
**`/packages/agent`**: The Studio Code agent (`@studio/agent`). protocol/ is its contract with the apps (events, session types, chat artifacts, models), browser-safe and the only part `apps/ui` imports. node/ holds the sessions store and run-manager.
**`/packages/common`**: Electron-free code shared by the Desktop app, `studio ui` and the CLI: sites/ (site operations over the CLI), lib/, types/, translations/
**`/tools/eslint-plugin-studio`**: eslint-plugin-studio

## Key Patterns

**IPC**: `apps/ui` `ipc` connector → `window.ipcApi.*` → Preload (contextBridge) → Main `ipc-handlers.ts` → `@studio/common` or the CLI
**Sites** (`apps/studio/src/lib/sites.ts`): Main keeps no copy of the site list. It asks the CLI (`site list`, or `cli.json` via `@studio/common/sites/site-path` when only a path or name is needed) and merges Studio's per-site fields from `app.json` via `@studio/common/sites/metadata`, shared with `apps/local`

## Tech Stack

**Frontend** (`apps/ui`): React 19, TanStack Query + Router, Base UI with the app's own primitives (`src/lib/ui/`) and theme (`src/lib/theme/`: tokens, base styles and the appearance logic), `lucide-react` plus custom icons in `src/lib/icons/`, TypeScript, Vite
**Main**: Electron
**CLI**: native PHP binaries, WP-CLI, @wp-playground/blueprints (Blueprint types and schema validation)
**Dev**: electron-vite, electron-forge, Vitest, Playwright
**Other**: Sentry, wpcom, zod, yargs

## Build & Distribution

**Build**: CLI (`vite build --config apps/cli/vite.config.dev.ts`) → Electron (`electron-vite build --config apps/studio/electron.vite.config.ts`) → Package (`electron-forge make --config apps/studio/forge.config.ts`)
**Platforms**: macOS (x64/ARM64 DMG), Windows (x64/ARM64 MSIX), Linux (DEB)
**Bundling**: Rollup (main), Vite (renderer with code splitting), ASAR (resources)

## Conventions

**Files**: React components (PascalCase), utils (camelCase), tests (.test.ts/.tsx)
**Theming / colors (CSS)**: Always use the theme tokens in `apps/ui/src/lib/theme/tokens.css` (`--foreground`, `--muted-foreground`, `--border`, `--muted`, `--accent`, …) for color; they follow the color scheme and the Appearance settings. Type, radius, motion and shell metrics have tokens there too (`--text-*`, `--font-weight-*`, `--radius-*`, `--motion-*`, `--control-size`). See the `apps/ui` README.

**UI tests** (`apps/ui`): behavior tests render the real providers over the in-memory fake connector (`src/test/`), query by role and don't `vi.mock` app modules; `apps/ui/e2e` stays a small set of critical flows run on every platform. See the Testing section of `apps/ui/README.md`.
**UI primitives** (`apps/ui/src/lib/ui/`, imported from `@/lib/ui`): Button, IconButton, Dialog, Menu, Select, Field, Tooltip… built on Base UI and styled with the theme tokens. Feature code uses these rather than Base UI directly wherever a primitive exists; `@wordpress/ui`, `@wordpress/components`, `@wordpress/dataviews` and `@wordpress/theme` are not used (lint-enforced). Primitives sit in the `ui` cascade layer, so a feature's CSS module overrides them without specificity tricks; change a button's resting fill with `--button-background`, not `background-color`. Primitives import nothing from app code (`data/`, `features/`, the router; lint-enforced). The `lib/ui` README says which primitive fits a need and how to restyle one.
**IPC Handlers** (`apps/studio/src/ipc-handlers.ts`): every export is registered as a handler under its name, as `handlerName(event, ...args)` | Fire-and-forget handlers (called with `ipcRenderer.send`) are listed in `IPC_VOID_HANDLERS` in `apps/studio/src/constants.ts`
**Storage**: **CRITICAL** - Always use file locking when writing config. Each config file has its own lockfile and helpers: `lockAppdata()` / `unlockAppdata()` for `app.json` (`apps/studio/src/storage/user-data.ts`), `lockCliConfig()` / `unlockCliConfig()` for `cli.json` (`apps/cli/lib/cli-config/core.ts`), and `lockSharedConfig()` / `unlockSharedConfig()` for `shared.json` (`packages/common/lib/shared-config.ts`).
**i18n**: `@wordpress/i18n` (`__()` function), `packages/common/translations/`, `<I18nProvider>` (renderer), `loadTranslations()` (CLI)
**i18n - Never translate at module level**: **CRITICAL** - Do NOT call translation functions (`__()`, `_x()`, `_n()`, `_nx()`) in module-level constants, object literals, or arrays. They run when the module is first imported — before the locale data loads — so the string is captured once and never updates. In the **Desktop main process** (`apps/studio`), which swaps locale data live when the user switches language, such a string stays in the old language until restart; in `apps/ui`, whose modules are imported before the user's locale loads, it is always English. Always wrap them in a function so they are re-evaluated at call time: use `const getLabel = () => __( 'Label' )` instead of `const LABEL = __( 'Label' )`. Only `apps/cli` is excluded from the rule: it is a one-shot process that loads the locale before importing modules. Enforced by the `studio/no-module-level-translations` ESLint rule (`tools/eslint-plugin-studio`).

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
- **Verify UI changes in the browser.** `apps/ui` (Agentic UI) is verifiable headless — serve it via `npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui --no-open` (http://localhost:8081) and inspect it with a browser tool, in light and dark. When no browser tool is available, add this line to the PR description so reviewers don't miss it: `> ⚠️ Visual change: needs human review in light + dark mode.`
- **Agent-behavior changes need evals.** If you touch the Studio Code system prompt, tools (including their result formats), or agent skills, update the affected assertions in `scripts/eval/promptfoo.config.yaml` and run them (`npm run eval -- --filter-pattern "<case>"`). Evals need `studio auth login`; when auth is unavailable in the sandbox, say so in the PR and flag it for a human eval run instead of skipping silently.
- **Open a draft PoC for big or speculative work.** If the change adds a new dependency, spans a new architectural boundary (e.g. a new IPC handler + connector method + UI), or touches many files, open it as a draft Proof of Concept (see below) instead of merge-ready.

## Large & Exploratory Contributions (Vibe-Coded Features)

If you've built a substantial new feature — especially one generated with AI assistance or built rapidly without prior team alignment — treat your PR as a **Proof of Concept** rather than a merge-ready change:

- **Open the PR as a draft** and add the `Proof of Concept` label. This signals the team that the PR is intended as directional guidance rather than production-ready code.
- **Open a companion issue first** (or reference an existing one). The CONTRIBUTING.md recommends this for new features — it lets the team review the plan before implementation work begins.
- **Describe intent clearly in the PR body**: What problem does this solve? What tradeoffs were made? What would need to change before this could be merged into core?
- **Don't expect a fast merge path**: Proof of Concept PRs are valuable as starting points and discussion anchors, but the team will likely want to revisit architecture, tests, and polish before landing them.
- **Keep scope visible**: If the change touches many files or crosses architectural boundaries (e.g., new IPC handlers + new connector methods + new UI), call that out explicitly so reviewers know what they're evaluating.

## Common Pitfalls

**CRITICAL - Dark Mode Color Tokens**: Use the theme's color tokens (`apps/ui/src/lib/theme/tokens.css`), never literal colors — they adapt to the active scheme. Always test new/changed UI in BOTH color schemes before declaring done — macOS: System Settings → Appearance → Dark.

**IMPORTANT - Two Front Ends, One Feature**: `apps/ui` runs in both the Desktop app and the `studio ui` browser app, through two connectors (`apps/ui/src/data/core/connectors/`): `ipc` talks to the Electron main process, `local` talks to the `apps/local` HTTP server. A `Connector` method implemented for only one target fails **silently** in the other — the `local` connector tends to fall back to browser-local defaults, so the browser UI quietly shows stale or empty values. Write the operation once in `@studio/common`, taking the CLI runner and anything else that differs as parameters, and make the main-process IPC handler and the `apps/local` route thin wrappers around it (e.g. `lib/user-settings/user-preferences.ts`, `sites/sync.ts`, `lib/local-media.ts`). Desktop-owned state in `app.json` goes through `@studio/common/lib/app-config.ts` rather than a copy in the browser, with the fallback for an unset value in the shared module. Verify in both: the Desktop app, and `npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui --no-open`.

**IMPORTANT - One Implementation Per Site Operation**: Site operations the CLI owns (push, pull, preview, import, export, start/stop…) must run through their CLI command from every surface — the Desktop main process, `apps/local`, and the agent tools alike. When a UI needs something the command lacks (structured progress, a non-interactive flag, cancellation), extend the command rather than rebuilding the operation from shared primitives in a host process. Parallel implementations drift: push was once reimplemented as `pushSite` because CLI `push` lacked structured output, after which selective sync, cancel and the remote-import wait each had to be fixed twice, and the agent's push never drove the UI. Commands also run without a terminal (the agent calls `runCommand` in-process, hosts fork the CLI with no stdin), so `runCommand` must never prompt or call `process.exit()`. Behaving differently in a terminal is fine: the yargs handler may prompt when `process.stdin.isTTY` and pass the answer in, and without a terminal the command falls back to a sensible default. See `docs/design-docs/cli-host-communication.md`.

**IMPORTANT - Avoid Mirroring State in Host Processes**: Sites belong to the CLI and Studio's per-site fields to `app.json`. Avoid keeping copies in the Desktop main process or `apps/local`; read what you need when you need it, and leave caching to the UI's TanStack Query cache. Prefer reading cheap derived data on demand over persisting it. Mirrors drift: main once kept the site list in memory and needed reconciliation passes to undo it.

**IMPORTANT - Gate App-Specific Agent Tools**: The Studio Code agent tools (`apps/cli/ai/tools/`) run in several contexts: forked by the Desktop app or the `studio ui` server (a Studio UI is attached), standalone terminal `studio code` sessions, and the MCP server. A tool or prompt instruction that only makes sense in one of them (e.g. a tool that opens the in-app preview, which needs a UI attached) **leaks into the other contexts unless explicitly gated** — the model gets told to call a tool that does nothing there. When adding an app- or context-specific tool or behavior, gate BOTH sides on the right flag in `resolveStudioToolDefinitions` (`apps/cli/ai/tools/index.ts`) — `emitChatArtifacts` = UI attached (derived from `process.send`) — AND its mentions in the system prompt (`buildSystemPrompt` in `apps/cli/ai/system-prompt.ts`, which receives the same flags). The prompt's tool list itself is generated from the registered tools (each tool's `promptSnippet`, see `define-tool.ts`), so it never needs gating; only behavioral mentions elsewhere in the prompt do. Add tests for both branches (present when flagged, absent by default); the MCP server never passes `emitChatArtifacts` to `resolveStudioToolDefinitions()`, so correct gating covers it automatically.

**IMPORTANT - Where Agent Guidance Goes**: The system prompt (`apps/cli/ai/system-prompt.ts`) holds only what is always true, plus skill routing. Procedures go in skills (`apps/cli/ai/skills/`), and facts about a single tool go in that tool's description. Studio Code and `studio mcp` share this split, so guidance reaches every agent.

**CRITICAL - WordPress Core Files**: Do NOT edit WordPress core files within site directories. WordPress core updates replace those files, so modifications are lost.

**CRITICAL - Config File Locking**: Each config file has its own lockfile and helper pair — ensure that any write operation uses the correct pair for that specific file. Use `lockAppdata()` / `unlockAppdata()` for `app.json`, `lockCliConfig()` / `unlockCliConfig()` for `cli.json`, and `lockSharedConfig()` / `unlockSharedConfig()` for `shared.json`. Concurrent unlocked writes will corrupt the file.

**IMPORTANT - CLI Build Required**: Running CLI commands without first running `npm run cli:build` will execute stale/outdated code. Always build before testing CLI changes.

**IMPORTANT - Main Process Restarts**: Hot reload (`rs` or auto-restart) does NOT pick up new IPC handlers or changes to Main process initialization. Full app restart required for Main process changes.

**Context Isolation**: Renderer is sandboxed - direct Node.js API access not available. `apps/ui` reaches Main through its `ipc` connector (`window.ipcApi.*`).

**Port Conflicts**: Site servers dynamically allocate ports. Don't hardcode port numbers; use the port-finder utility.

**CRITICAL - Playground Package Versions**: Always pin `@wp-playground/*` packages (and any `@php-wasm/*` they pull in) to **exact versions** (no `^` or `~` ranges) in all `package.json` files, and bump them in lockstep. A caret range causes `install:bundle` to resolve a newer version when one publishes, creating a version conflict, and npm then installs duplicate nested copies of the shared Playground packages. Studio no longer runs sites on Playground; it only uses `@wp-playground/blueprints` for Blueprint types and schema validation, and `@wp-playground/tools` for the phpMyAdmin files. Keep `@wp-playground/blueprints` a devDependency everywhere: import only types from it (the schema validator is bundled by Vite, and `__isStepDefinition` lives in `packages/common/lib/blueprint-settings.ts`). A runtime import makes the CLI bundle ship it with ~100 MB of transitive dependencies (Octokit, isomorphic-git).

## Detailed Documentation

For in-depth information, see these docs:
- **CLI Design**: `docs/design-docs/cli.md` - CLI architecture, installation, IPC communication, data flow
- **CLI ↔ App Communication**: `docs/design-docs/cli-host-communication.md` - How operations publish their state and activity to every Studio app, and the principles behind it
- **Custom Domains/SSL**: `docs/design-docs/custom-domains-and-ssl.md` - Proxy server, certificates, hosts file
- **Analytics (Tracks)**: `docs/design-docs/analytics-tracks.md` - Tracks vs MC Stats, anonymous identity, opt-out, event catalog
- **Localization**: `docs/localization.md` - GlotPress workflow, translation process
- **Release Process**: `docs/release-process.md` - ReleasesV2 + Fastlane lifecycle, running lanes locally
- **Overview**: `README.md` - Features, download links, contribution guidelines

## Quick Reference

**Sites**: CLI runs WordPress with native PHP (`apps/cli/php-server-child.ts`), Blueprints applied via `blueprints.phar`, `validateBlueprintData()` for schema validation
**Sync**: OAuth via `packages/common/lib/oauth.ts`, pull/push WordPress.com sites through the CLI `push`/`pull` commands
**Security**: Renderer sandboxed, IPC validation, strict CSP, no Node integration, self-signed HTTPS certs

---

Repo: https://github.com/Automattic/studio | GPLv2+
