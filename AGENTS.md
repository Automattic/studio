# AI Instructions

WordPress Studio - Electron desktop app for managing local WordPress sites. Built with React + TypeScript, runs sites with a bundled native PHP binary.

## Essential Commands

**Dev/Build**: `npm start` | `npm run cli:build` | `node apps/cli/dist/cli/main.mjs` | `npm -w @studio/ui run playground` (real `apps/ui` components with sample data and no backend, light and dark: chat transcript, preview animation; see `apps/ui/src/dev/README.md`)
**Test**: `npm test [-- path/to/test.test.ts]` | `npm run e2e`
**Quality**: `npx oxlint --fix <files>` and `npx prettier --write <files>` (lint and format ONLY modified files; stylesheets: `npx eslint --fix <files>`) | `npm run knip` (unused files, exports and dependencies across the repo; runs in CI)
**IMPORTANT - Post-Change Verification**: After applying code changes, always run the linter and format modified files (`npx oxlint --fix <files>`, `npx prettier --write <files>`), the type checker (`npm run typecheck`) and run relevant tests (`npm test [-- path/to/test]`) before considering the work complete. For any UI/CSS change, also verify the result in **both light and dark** color schemes.
**Package**: `npm run make` (builds installers for current platform)

**IMPORTANT - Hot Reload**: Renderer auto-reloads, Main process needs restart (or `rs` in terminal). Changes to Main process IPC handlers require full restart.

## CLI Commands

**MUST** build CLI before testing: `npm run cli:build && node apps/cli/dist/cli/main.mjs <command>`
- **Auth**: `auth login|logout|status` - WordPress.com OAuth (tokens valid 2 weeks)
- **Preview Sites**: See `apps/cli/commands/preview/`
- **Local Sites**: See `apps/cli/commands/site/`
- **Agentic UI (`apps/ui`)**: To verify UI changes, run `npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui --no-open`, then open http://localhost:8081 with a browser tool (Playwright/Chrome MCP) and check both light and dark themes. Note: plain `cli:build` does NOT rebuild `apps/ui` — use `cli:build:ui`. Default port 8081 (`--port` to override). In Amp orbs 8081 is already in use, so pass another port (e.g. `--port 8099`).
- **MCP Apps (`apps/mcp-ui`)**: `npm run cli:build:mcp-ui` builds the page into the CLI; plain `cli:build` does NOT rebuild it. Verify it in an agent app that renders MCP Apps, in light and dark; the WordPress library opens from the ChatGPT app's sidebar once the Studio plugin is installed.

## Capturing Studio (screenshots and video)

`tools/capture-harness` (`@studio/capture-harness`) captures stills and recordings of the Studio app from a **scene** (sites, from a backup or a Blueprint, plus made-up account data), a **script** (steps, crop, annotations) and a **look** (window, color scheme, frame, output sizes), each a JSON file with a schema. Use it for docs images (`npm run screenshots` in `docs/user`), marketing and social stills, and screen recordings, rather than ad-hoc Playwright. The workflow for agents (`inspect` for locators, `validate`, `capture --json`) is in `tools/capture-harness/SKILL.md`. Signed-in captures sign in as a made-up demo person (`personas/`), so they need no account, never a person's login; the harness blocks anything that would change an account.

## Translating Missing Strings

At code freeze, the release author has an agent translate the UI strings GlotPress has no translation for yet, into every locale, as AI translations that GlotPress translations later replace. The workflow is in `scripts/ai-translations/SKILL.md`.

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
**`/apps/ui`**: Agentic UI (`@studio/ui`), the renderer of the Desktop app, the `studio ui` browser app and Studio Cloud. lib/ (internal packages: keyboard, pending-slot), features/ (product areas), data/ (connectors, queries), router/, app/ (providers); boundaries in its README, lint-enforced. `build:local` builds it for `studio ui`, `build:cloud` for Studio Cloud; the Desktop build comes from `scripts/build-ui-renderer.ts`.
**`/apps/local`**: HTTP/SSE backend for `apps/ui` in the browser, bundled into the CLI.
**`/apps/mcp-ui`**: MCP Apps pages that agent apps show for `studio mcp` (`@studio/mcp-ui`), currently the WordPress library. React + TanStack Query and plain CSS, built into one HTML document that `studio mcp` serves; the data layer talks to the host through one bridge, with no connectors. Not a target of `apps/ui`: see `docs/design-docs/studio-apps-and-surfaces.md`.
**`/packages/agent`**: The Studio Code agent (`@studio/agent`). protocol/ is its contract with the apps (events, session types, chat artifacts, models), browser-safe and the only part `apps/ui` imports. node/ is the agent: tools/, skills/, the system prompt, the host interface (`node/host.ts`), runtime/ with pi's file tools, the sessions store and run-manager. Apps run it with `createAgent( { host } )` from `@studio/agent/node`: the host (the CLI's is `apps/cli/ai/host.ts`) runs the site operations and reaches the user, so the package never imports `apps/cli`.
**`/packages/blueprints`**: WordPress Blueprints in Studio (`@studio/blueprints`), with no dependency on `@studio/common`. The root is browser-safe: `fetchLibraryBlueprints`, `validateBlueprint`, `inspectBlueprint`, `customizeBlueprint`. `@studio/blueprints/node` has `openBlueprint`, which opens a URL, file, folder, zip or Library slug and removes what it unpacks when disposed (`await using`).
**`/packages/providers`**: The services Studio holds an account with (`@studio/providers`), one folder per provider (`wpcom/`, `anthropic/`). The `.` entry is what surfaces read (descriptors, models, config schemas); `./services` holds the implementations (`getProvider( id )`), which run in Node; `./ui` holds the forms a provider shows, such as SSH's connect form. Providers own no storage and import no workspace package but `@studio/ds`, for those forms: Studio stores their config through `@studio/common/lib/provider-config.ts` and passes it into every call. See `docs/design-docs/providers.md`.
**`/packages/ds`**: Studio's design system (`@studio/ds`): the UI primitives (`.`), theme (`./theme`, with `tokens.css`, `base.css` and `recipes.module.css`), icons (`./icons`) and generic React hooks (`./hooks`). `apps/ui` builds on it, and any app or package can import it; it imports no other workspace package.
**`/packages/common`**: Electron-free code shared by the Desktop app, `studio ui` and the CLI: sites/ (site operations over the CLI), lib/, types/, translations/
**`/tools/eslint-plugin-studio`**: eslint-plugin-studio

## Key Patterns

**IPC**: `apps/ui` `ipc` connector → `window.ipcApi.*` → Preload (contextBridge) → Main `ipc-handlers.ts` → `@studio/common` or the CLI
**Sites** (`apps/studio/src/lib/sites.ts`): Main keeps no copy of the site list. It asks the CLI (`site list`, or the config file via `@studio/common/sites/site-path` when only a path or name is needed). A site's record holds Studio's own settings for it (sort order, auto-start) and its connections, so they go with it when it is deleted

## Tech Stack

**Frontend** (`apps/ui`): React 19, TanStack Query + Router, Base UI with Studio's own primitives and theme (`@studio/ds`: tokens, base styles and the appearance logic), `lucide-react` plus custom icons in `@studio/ds/icons`, TypeScript, Vite
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
**Theming / colors (CSS)**: Always use the theme tokens in `packages/ds/theme/tokens.css` (`--foreground`, `--muted-foreground`, `--border`, `--muted`, `--accent`, …) for color; they follow the color scheme and the Appearance settings. Type, radius, motion and shell metrics have tokens there too (`--text-*`, `--font-weight-*`, `--radius-*`, `--motion-*`, `--control-size`). See the `apps/ui` README.

**UI tests** (`apps/ui`): behavior tests render the real providers over the in-memory fake connector (`src/test/`), query by role and don't `vi.mock` app modules; `apps/ui/e2e` stays a small set of critical flows run on every platform. See the Testing section of `apps/ui/README.md`.
**UI primitives** (`packages/ds/primitives/`, imported from `@studio/ds`): Button, IconButton, Dialog, Menu, Select, Field, Tooltip… built on Base UI and styled with the theme tokens. Feature code uses these rather than Base UI directly wherever a primitive exists; `@wordpress/ui`, `@wordpress/components`, `@wordpress/dataviews` and `@wordpress/theme` are not used (lint-enforced). Primitives sit in the `ui` cascade layer, so a feature's CSS module overrides them without specificity tricks; change a button's resting fill with `--button-background`, not `background-color`. Primitives import nothing from app code (`data/`, `features/`, the router; lint-enforced). The primitives README (`packages/ds/primitives/README.md`) says which primitive fits a need and how to restyle one.
**IPC Handlers** (`apps/studio/src/ipc-handlers.ts`): every export is registered as a handler under its name, as `handlerName(event, ...args)` | Fire-and-forget handlers (called with `ipcRenderer.send`) are listed in `IPC_VOID_HANDLERS` in `apps/studio/src/constants.ts`
**Storage**: **CRITICAL** - Read and write `~/.studio/config.json` only through `packages/common/lib/config/store.ts`: `readConfig()` to read, `updateConfig( ( config ) => { … } )` to change it (it takes the lock, writes only the sections you changed, and can't be nested; keep the callback short and free of network requests). Its sections and the rules for changing their shape are in `packages/common/lib/config/README.md`.
**i18n**: `@wordpress/i18n` (`__()` function), `packages/common/translations/`, `<I18nProvider>` (renderer), `loadTranslations()` (CLI)
**i18n - Never translate at module level**: **CRITICAL** - Do NOT call translation functions (`__()`, `_x()`, `_n()`, `_nx()`) in module-level constants, object literals, or arrays. They run when the module is first imported — before the locale data loads — so the string is captured once and never updates. In the **Desktop main process** (`apps/studio`), which swaps locale data live when the user switches language, such a string stays in the old language until restart; in `apps/ui`, whose modules are imported before the user's locale loads, it is always English. Always wrap them in a function so they are re-evaluated at call time: use `const getLabel = () => __( 'Label' )` instead of `const LABEL = __( 'Label' )`. Only `apps/cli` is excluded from the rule: it is a one-shot process that loads the locale before importing modules. Enforced by the `studio/no-module-level-translations` lint rule (`tools/eslint-plugin-studio`).

## WordPress Studio Paths

**App Data:** All platforms use `~/.studio/` (user's home directory), or `DEV_CONFIG_DIR` when set. Resolve paths via the helpers in `packages/common/lib/well-known-paths.ts` (`getConfigDirectory`, …) rather than hardcoding.
- `~/.studio/config.json` — the one config file the Desktop app, `studio ui`, the CLI and `studio mcp` share: sites, previews, preferences, sign-ins, session metadata (see `packages/common/lib/config/README.md`)
- Deprecated: `shared.json`, `cli.json` and `app.json` (Studio up to 2.3), and `appdata-v1.json` under the Electron platform path before them. The first build with `config.json` imports them (`packages/common/lib/config/legacy-import.ts`), keeps a copy in `~/.studio/legacy-config/`, and leaves stubs that older builds refuse.

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
**Screenshots**: Every PR that changes what Studio shows (layout, styling, copy, icons, new or changed controls) includes screenshots in its **Testing Instructions**: before and after, in both light and dark color schemes, cropped to the changed area with enough of the app around it to place it. Capture them with `tools/capture-harness` (`npx studio-capture inspect --screenshot <file>`, or `capture` with a script; see **Capturing Studio** above), or a browser tool on `studio ui`. Keep them out of the repo (`--out /tmp/...`) and attach them to the PR description, not as committed files. A PR with no visible change needs none.
**IMPORTANT**: Prefer merging `trunk` into your branch over rebasing. Avoid force pushes to trunk/main branches. Avoid force pushes to already-pushed branches - add new commits instead.

## Autonomous Agent (Agent Sandbox) Runs

Studio issues on the **Studio App & CLI** Linear team (`STU-*`) can be picked up by the Agent Sandbox. The pipeline triages the assigned issue and invokes the agent, which opens a PR autonomously, headless, in a sandbox. If you are that agent:

- **Stay in scope.** Touch only the files the issue requires. Prefer the smallest change that resolves it; avoid unrelated refactors.
- **Verify before claiming done.** Run `npx oxlint --fix` and `npx prettier --write` on modified files, `npm run typecheck`, and `npm test -- <path>` for affected tests. e2e (`npm run e2e`) usually isn't runnable in the sandbox — rely on unit tests; if it is available, run it last, after everything else passes. If the toolchain or a dependency install is unavailable in the sandbox, say so explicitly — never assert a change is verified when it isn't.
- **Verify UI changes in the browser, and screenshot them.** `apps/ui` (Agentic UI) is verifiable headless — serve it via `npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui --no-open` (http://localhost:8081) and inspect it with a browser tool, in light and dark, or use the capture harness's browser driver (`tools/capture-harness/SKILL.md`). Include before/after screenshots in light and dark in the PR description, as **Screenshots** under Git & PR Conventions describes. When you can't capture them or attach them to the PR, say which are missing and why, and add this line to the PR description so reviewers don't miss it: `> ⚠️ Visual change: needs human review in light + dark mode.`
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

**CRITICAL - Dark Mode Color Tokens**: Use the theme's color tokens (`packages/ds/theme/tokens.css`), never literal colors — they adapt to the active scheme. Always test new/changed UI in BOTH color schemes before declaring done — macOS: System Settings → Appearance → Dark.

**IMPORTANT - Two Connectors, One Feature**: `apps/ui` runs in the Desktop app, the `studio ui` browser app and Studio Cloud, through two connectors (`apps/ui/src/data/core/connectors/`): `ipc` talks to the Electron main process, and `local` talks to the `apps/local` HTTP server, served by `studio ui` on the user's computer or by `studio serve` on a Studio Cloud machine (its `remote` option). A `Connector` method implemented for only one of them fails **silently** in the other — the `local` connector tends to fall back to browser-local defaults, so the browser UI quietly shows stale or empty values. Write the operation once in `@studio/common`, taking the CLI runner and anything else that differs as parameters, and make the main-process IPC handler and the `apps/local` route thin wrappers around it (e.g. `lib/user-settings/user-preferences.ts`, `sites/sync.ts`, `lib/local-media.ts`). Where a front end can't do something (a browser can't open a native folder picker, a Studio Cloud machine isn't the user's computer), hide its entry points with a capability in `ConnectorCapabilities` (`localMachine`, `nativeFolderPicker`, …) or an optional `Connector` method: never leave a reachable control whose method throws `UnsupportedError` or returns an empty stub. Desktop-owned state in `app.json` goes through `@studio/common/lib/app-config.ts` rather than a copy in the browser, with the fallback for an unset value in the shared module. Verify in the Desktop app and in `npm run cli:build:ui && node apps/cli/dist/cli/main.mjs ui --no-open`, and for anything a remote server changes, in Studio Cloud (`npm -w @studio/ui run dev:cloud`, see `docs/design-docs/studio-serve.md`).

**IMPORTANT - The `local` Connector Supports Older Servers**: Studio Cloud serves one UI build to every user's machine, and machines update only when idle, so the `local` connector talks to `studio serve` servers older than itself (`docs/design-docs/studio-serve.md`). Read new response fields as optional, gate a feature that needs a new route on the server's version (`/api/version`, read in the connector's `init()`) through `ConnectorCapabilities` rather than in feature code, and keep a route or field the UI used on the server until `MIN_SERVER_VERSION` (`connectors/local/server-version.ts`) has moved past the release that last needed it.

**IMPORTANT - The `local` Connector Supports Older Servers**: Studio Cloud serves one UI build to every user's machine, and machines update only when idle, so the `local` connector talks to `studio serve` servers older than itself (`docs/design-docs/studio-serve.md`). Read new response fields as optional, gate a feature that needs a new route on the server's version (`/api/version`, read in the connector's `init()`) through `ConnectorCapabilities` rather than in feature code, and keep a route or field the UI used on the server until `MIN_SERVER_VERSION` (`connectors/local/server-version.ts`) has moved past the release that last needed it.

**IMPORTANT - One Implementation Per Site Operation**: Site operations the CLI owns (push, pull, preview, import, export, start/stop…) must run through their CLI command from every surface — the Desktop main process, `apps/local`, and the agent tools alike. When a UI needs something the command lacks (structured progress, a non-interactive flag, cancellation), extend the command rather than rebuilding the operation from shared primitives in a host process. Parallel implementations drift: push was once reimplemented as `pushSite` because CLI `push` lacked structured output, after which selective sync, cancel and the remote-import wait each had to be fixed twice, and the agent's push never drove the UI. Commands also run without a terminal (the agent calls `runCommand` in-process, hosts fork the CLI with no stdin), so `runCommand` must never prompt or call `process.exit()`. Behaving differently in a terminal is fine: the yargs handler may prompt when `process.stdin.isTTY` and pass the answer in, and without a terminal the command falls back to a sensible default. See `docs/design-docs/cli-host-communication.md`.

**IMPORTANT - Avoid Mirroring State in Host Processes**: Sites and Studio's settings live in the config file. Avoid keeping copies in the Desktop main process or `apps/local`; read what you need when you need it, and leave caching to the UI's TanStack Query cache. Prefer reading cheap derived data on demand over persisting it. Mirrors drift: main once kept the site list in memory and needed reconciliation passes to undo it.

**IMPORTANT - Gate App-Specific Agent Tools**: The Studio Code agent tools (`packages/agent/node/tools/`) run in several contexts: forked by the Desktop app or the `studio ui` server (a Studio UI is attached), standalone terminal `studio code` sessions, and the MCP server. A tool or prompt instruction that only makes sense in one of them (e.g. a tool that opens the in-app preview, which needs a UI attached) **leaks into the other contexts unless explicitly gated** — the model gets told to call a tool that does nothing there. When adding an app- or context-specific tool or behavior, gate BOTH sides on what the host provides in `resolveStudioTools` (`packages/agent/node/tools/index.ts`) — `host.ui` = a Studio UI is attached (the CLI sets it when forked by an app) — AND its mentions in the system prompt (`buildSystemPrompt` in `packages/agent/node/system-prompt.ts`). The prompt's tool list itself is generated from the registered tools (each tool's `promptSnippet`, see `define-tool.ts`), so it never needs gating; only behavioral mentions elsewhere in the prompt do. Add tests for both branches (present with the capability, absent without); the MCP server's host has no `ui`, so correct gating covers it automatically.

**IMPORTANT - Where Agent Guidance Goes**: The system prompt (`packages/agent/node/system-prompt.ts`) holds only what is always true, plus skill routing. Procedures go in skills (`packages/agent/node/skills/`), and facts about a single tool go in that tool's description. Studio Code and `studio mcp` share this split, so guidance reaches every agent.

**CRITICAL - WordPress Core Files**: Do NOT edit WordPress core files within site directories. WordPress core updates replace those files, so modifications are lost.

**CRITICAL - Config File Writes**: Write the config file only with `updateConfig` (`packages/common/lib/config/store.ts`), never with `fs`: it is the only place that locks the file, migrates it, and keeps the sections other builds wrote. Changing the shape of stored data needs a `CONFIG_VERSION` bump and a migration step; adding an optional field doesn't.

**IMPORTANT - CLI Build Required**: Running CLI commands without first running `npm run cli:build` will execute stale/outdated code. Always build before testing CLI changes.

**IMPORTANT - Main Process Restarts**: Hot reload (`rs` or auto-restart) does NOT pick up new IPC handlers or changes to Main process initialization. Full app restart required for Main process changes.

**Context Isolation**: Renderer is sandboxed - direct Node.js API access not available. `apps/ui` reaches Main through its `ipc` connector (`window.ipcApi.*`).

**Port Conflicts**: Site servers dynamically allocate ports. Don't hardcode port numbers; use the port-finder utility.

**IMPORTANT - Bundled Workspace Packages**: The apps bundle the workspace packages (`@studio/common`, `@studio/agent`, …) together with their dependencies, except for what an app lists in its own `dependencies`: the CLI keeps those external and installs them with `install:bundle` (`apps/cli/vite.config.base.ts`). A package dependency that can't be bundled (native binaries or files read from its own folder, such as `playwright` and `pi-tui`) must also be listed in the app, with the **same range** as in the package; a dependency the app no longer imports or needs external comes out of its list. `scripts/dependency-ranges.test.mjs` fails when a package and an app list the same dependency with different ranges.

**CRITICAL - Playground Package Versions**: Always pin `@wp-playground/*` packages (and any `@php-wasm/*` they pull in) to **exact versions** (no `^` or `~` ranges) in all `package.json` files, and bump them in lockstep. A caret range causes `install:bundle` to resolve a newer version when one publishes, creating a version conflict, and npm then installs duplicate nested copies of the shared Playground packages. Studio no longer runs sites on Playground; it only uses `@wp-playground/blueprints` for Blueprint types and schema validation, and `@wp-playground/tools` for the phpMyAdmin files. Keep `@wp-playground/blueprints` a devDependency everywhere: import only types from it (the schema validator is bundled by Vite, and steps are narrowed in `packages/blueprints/details.ts`). A runtime import makes the CLI bundle ship it with ~100 MB of transitive dependencies (Octokit, isomorphic-git).

## Detailed Documentation

For in-depth information, see these docs:
- **CLI Design**: `docs/design-docs/cli.md` - CLI architecture, installation, IPC communication, data flow
- **CLI ↔ App Communication**: `docs/design-docs/cli-host-communication.md` - How operations publish their state and activity to every Studio app, and the principles behind it
- **Curate Admin**: `docs/design-docs/curate-admin.md` - Curating wp-admin for the people who run a site: the menu, post types, settings and dashboard, the manifest, runtime plugin, Staff admin and security model
- **Custom Domains/SSL**: `docs/design-docs/custom-domains-and-ssl.md` - Proxy server, certificates, hosts file
- **Analytics (Tracks)**: `docs/design-docs/analytics-tracks.md` - Tracks vs MC Stats, anonymous identity, opt-out, event catalog
- **Localization**: `docs/localization.md` - GlotPress workflow, translation process
- **Release Process**: `docs/release-process.md` - ReleasesV2 + Fastlane lifecycle, running lanes locally
- **Overview**: `README.md` - Features, download links, contribution guidelines

## Quick Reference

**Sites**: CLI runs WordPress with native PHP (`apps/cli/php-server-child.ts`), Blueprints opened with `openBlueprint()` and checked with `validateBlueprint()` from `@studio/blueprints`, applied via `blueprints.phar`
**Sync**: Studio sign-in through the WordPress.com provider (`packages/providers/wpcom/`), pull/push WordPress.com sites through the CLI `push`/`pull` commands
**Security**: Renderer sandboxed, IPC validation, strict CSP, no Node integration, self-signed HTTPS certs

---

Repo: https://github.com/Automattic/studio | GPLv2+
