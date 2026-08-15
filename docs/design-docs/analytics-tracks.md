# Analytics: Tracks

## About this doc

This document describes how WordPress Studio records usage analytics with Automattic **Tracks**, how it
relates to the existing **MC Stats** system, the anonymous identity and opt-out model, and the catalog
of events we send. Keep the event catalog at the bottom up to date whenever an event is added or
changed.

## Context

Historically Studio has only had **MC Stats** (`bumpStat`) — anonymous counters incremented per event,
with no user identity and no event properties beyond a group/stat pair (see
`packages/common/lib/bump-stat.ts`). That's fine for coarse headcounts but can't express funnels,
cohorts, or properties like "which importer was used".

**Tracks** is Automattic's structured event system (used by Calypso, Jetpack, WooCommerce, etc.).
Events have a name and an arbitrary property bag, tied to an anonymous or authenticated identity.

We are adopting Tracks **alongside** MC Stats, not as a replacement:

- Both systems run in parallel so we can validate that the numbers agree.
- Later, the MC Stats **site-operation** counters (create/import/export) may be removed once Tracks
  dashboards are established.
- The MC Stats **launch** counters stay permanently as a simple headcount ping.

> **Coupling to watch when removing MC Stats:** the `studio_app_launch` event derives `is_first_launch`
> from the MC Stats `lastBumpStats` field (a durable pre-existing marker, so it's accurate for both
> existing users and fresh installs today). If the MC Stats launch bumps are ever removed, in the same
> change migrate this signal to another durable per-install marker (e.g. `sentryUserId`) or a dedicated
> flag — and rename it to reflect the new source — otherwise `is_first_launch` will silently report
> `true` on every launch.

## High level approach

The pieces mirror the MC Stats layering:

| Layer | File | Responsibility                                                                                                                                              |
|---|---|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Shared core | `packages/common/lib/record-tracks-event.ts` | Pure, environment-agnostic URL builder + fire-and-forget pixel sender. No config/opt-out logic. No-ops in E2E/dev.                                          |
| Desktop wrapper | `apps/studio/src/lib/tracks.ts` | Single entry point for the desktop (Main process). Enforces the opt-out, attaches common props including `channel` and `ui_version` (derived from the active renderer).                                                             |
| CLI wrapper | `apps/cli/lib/tracks.ts` | Single entry point for the CLI **and** the `studio ui` server, which is bundled into it. Enforces the opt-out **and** the build-time `__ENABLE_CLI_TELEMETRY__` switch. Resolves origin from `STUDIO_TRACKS_ORIGIN`. |
| Identity + opt-out | `packages/common/lib/shared-config.ts` | `getOrCreateAnalyticsInstallId()`, `isAnalyticsOptedOut()`, `isAutomatticianFromToken()`. Persisted in `shared.json`.                                       |

Events are sent as a **pixel GET** to `https://pixel.wp.com/t.gif` with query params. The reserved
Tracks pixel params the core builder attaches are:

- `_en` — event name (snake_case, `studio_` prefix)
- `_ut=anon` + `_ui=<install-uuid>` — anonymous identity (see note below)
- `_ts` — timestamp (ms)
- one query param per event property (all values coerced to strings)

The reserved `_`-prefixed params are a fixed set owned by the Tracks libraries.

**Identity is anonymous-only in Phase 1.** We always send `_ut=anon` with the install UUID, even when
the user is authenticated with WordPress.com. Tracks also supports authenticated identity
(`_ut=wpcom:user_id`, `_ui=<wpcom user id>`), which would enable cross-product analytics — we can change
it in a later phase, but it carries stronger privacy implications.

Set the `STUDIO_DEBUG_TRACKS` env var to log the exact pixel URL for each event. Note this only helps
where the sender actually runs — see Testing below for what fires in which build.

## Identity and opt-out

- **Anonymous install UUID.** Generated on first event and stored as `analyticsInstallId` in
  `shared.json`. Because `shared.json` is read by both the desktop app and the CLI, both attribute
  events to the same install. No PII is attached; identity is always `_ut=anon`.
- **Opt-out.** `analyticsOptOut` in `shared.json` (absent/false = opted **in**; analytics default ON).
  Enforced in both wrappers before any send. The user controls it from several places, all writing the
  same shared flag through the `getAnalyticsEnabled` / `saveAnalyticsEnabled` IPC handlers →
  `updateSharedConfig`:
  - Legacy renderer Settings → General (`AnalyticsToggle` in `preferences-tab.tsx`).
  - Onboarding screen (`connect-to-wpcom.tsx`), persisted on skip/login.
  - Agentic renderer (`apps/ui`) Settings → Preferences — folded into `UserPreferences`
    (`analyticsEnabled`) so it rides the existing preferences query/mutation through the connector,
    which calls the same IPC handlers.
- **What opt-out does *not* affect.** MC Stats (aggregate headcount, not behavioral) and Sentry (crash
  reports, not analytics) keep sending. Only Tracks stops.
- **`--avoid-telemetry`.** This existing CLI flag is unrelated to the Tracks opt-out. It prevents the
  MC-Stats launch counters from being double-counted when the desktop spawns the CLI. Tracks
  `studio_site_start` is intentionally **not** suppressed by it: the only thing that stops it is the
  Tracks opt-out (`analyticsOptOut`). **For data consumers:** every site start is counted once, whether
  it originated in a UI (`channel=studio-ui`) or the standalone CLI (`channel=studio-cli`) — app-spawned
  CLI runs are *not* excluded despite carrying `--avoid-telemetry`. Filter by `channel` to separate UI
  from CLI starts.

## Data flow

```
                        (desktop) index.ts appBoot           (CLI) recordSiteRuntimeUsage funnel
                                 │                                        │
   renderer (apps/studio /       │ studio_app_launch                      │ studio_site_start
   apps/ui via Connector) ─IPC─▶ apps/studio/src/lib/tracks.ts   apps/cli/lib/tracks.ts
                                 │  (opt-out check)                       │  (opt-out + __ENABLE_CLI_TELEMETRY__)
                                 └──────────────┬─────────────────────────┘
                                                ▼
                          packages/common/lib/record-tracks-event.ts
                                  (build pixel URL, no-op in E2E/dev)
                                                ▼
                              GET https://pixel.wp.com/t.gif?...
```

### Which surface emits what

- **`studio_app_launch`** fires once per launch from the desktop Main process (`apps/studio/src/index.ts`
  `appBoot`), in parallel with the MC Stats launch bumps, and once per `studio ui` server start
  (`apps/cli/commands/ui.ts`). Only the desktop sends `is_first_launch`: the marker it derives that from
  lives in its own `app.json`, and the install id is shared with the CLI, so neither can tell a first
  browser launch from a first desktop one.
- **`studio_site_start`** is emitted **only** by the CLI, from the `recordSiteRuntimeUsage()` funnel in
  `apps/cli/lib/wordpress-server-manager.ts` — the single point every site start passes through. Every
  desktop site start delegates to the app-spawned CLI, so the CLI is the sole emitter and a start is
  counted exactly once whether it originated in a UI or standalone. The desktop passes its origin to the
  spawned CLI via the `STUDIO_TRACKS_ORIGIN` env var (`studio-ui:v1` / `studio-ui:v2`), injected in
  `apps/studio/src/modules/cli/lib/execute-command.ts`.
- **`studio_site_created`** is likewise emitted **only** by the CLI, from the `site create` command
  (`apps/cli/commands/site/create.ts`) on successful creation. Every path a site comes into existence
  routes through it — new/blueprint (`createSite`), import and sync-pull (a blank site created via
  `createSite`, then populated), and duplicate (`copySite` copies the files, then also creates via the
  CLI). The CLI infers `flow_type=blueprint` from the blueprint arg; the callers thread the other
  non-`new` values down as a `--flow-type` hint (built into the CLI args by `buildSiteCreateArgs` in
  `packages/common/sites/create.ts`). `channel`/`ui_version` resolve from `STUDIO_TRACKS_ORIGIN` exactly
  as for `studio_site_start`.
- **`studio_preview_site_create`/`_update`/`_delete`/`_delete_all`** are emitted **only** by the CLI,
  from the `preview` commands (`apps/cli/commands/preview/{create,update,delete}.ts`). Every desktop
  Previews-tab action (create/update/delete/delete-all) delegates to the app-spawned CLI (via the
  `SnapshotManager` fork in `packages/common/sites/snapshots.ts` and the direct `preview delete --all`
  fork), so the CLI is the sole emitter and each action is counted once whether it originated in a UI or
  standalone — `channel`/`ui_version` resolve from `STUDIO_TRACKS_ORIGIN` exactly as for
  `studio_site_start`. The **`studio_preview_site_open`** event is the exception: opening a preview URL is
  a renderer-only affordance with no CLI equivalent, so it fires from the renderer.
- **`studio_site_imported`/`studio_site_exported`** are emitted **only** by the CLI, from the `import`
  and `export` commands (`apps/cli/commands/import.ts`, `apps/cli/commands/export.ts`). The desktop
  Import/Export tab, the agentic UI's export buttons, and standalone-CLI runs all funnel there —
  `channel`/`ui_version` resolve from `STUDIO_TRACKS_ORIGIN` exactly as for `studio_site_start`. The
  events deliberately mean **a user imported/exported a backup**: paths that reuse the same CLI
  commands as an implementation detail — add-site-flow imports (Classic add-site, agentic onboarding
  import, browser-UI import route), sync-pull imports, and sync-push exports — pass a hidden
  `--suppress-tracks-event` flag and emit nothing. An aborted sync export also emits nothing (the CLI
  process is SIGTERM'd before it can record). Runs in parallel with the MC Stats import/export
  counters for now.
- **`studio_code_message_sent`/`studio_code_turn_completed`** are emitted **only** by the CLI, from
  `runAgentTurn` (`apps/cli/commands/ai/index.ts`). Every chat surface forks the CLI to run a turn —
  both desktop renderers via `packages/common/ai/run-manager.ts`, the `studio ui` server via the same
  module, and a standalone `studio code` directly — and that function is the one place holding the
  provider, model, resolved session id and turn outcome together. The desktop passes its origin to
  the fork via `STUDIO_TRACKS_ORIGIN` (the run-manager's injected `getTracksOrigin`, resolved per run
  because the user can switch renderer mid-session), exactly as for `studio_site_start`. `studio ui`
  supplies no origin — see below.
- **`studio_code_session_created`** is the exception to the above: sessions are created *in-process*
  via `createOrReuseAiSession` rather than by forking the CLI, so it fires from desktop Main
  (`createAiSession`). `createOrReuseAiSession` reuses an existing empty draft instead of piling up
  orphans, and returns a `created` flag so a reuse isn't counted as a creation.
- **`studio_onboarding_complete`** fires from desktop Main (`saveOnboarding`), the single funnel both
  front-ends reach — Studio Classic when the user skips or logs in, the agentic UI when the welcome tour
  ends (`connector.setOnboardingCompleted`). It is emitted only on a genuine `false → true` transition, so
  a re-save can't look like a second user finishing. Its `authenticated` prop is resolved in Main from the
  stored token, which is what makes it the funnel's denominator (see the caveat below).
- **`studio_wpcom_auth`** fires from desktop Main's **auth deep-link handler** — the one place every
  desktop login outcome lands, from either renderer — and separately from the **CLI** `auth login`.
  `source` and `account_type` are known only when auth *starts* (which affordance was clicked, and whether
  we opened the login or the signup URL), but the outcome arrives later in a deep link carrying only a
  token. `apps/studio/src/lib/auth-tracks-context.ts` bridges the two with a Main-process pending context,
  consumed once by the deep-link handler and expiring after 15 minutes. When that link can't be made — the
  app restarted mid-flow, a cold-start deep link, an expired context, or a second deep link after one
  initiation — the event still fires, reporting `source: unknown` rather than guessing. Concurrent
  attempts are last-write-wins: the tab a user finishes is almost always the last one they opened.
  Both emitters record **after** the token is written, because the wrappers derive `is_a11n` from it.
- **⚠️ `studio_wpcom_auth` counts outcomes that reached the app, not attempts.** If the user closes the
  browser tab, or the WordPress.com page errors before redirecting, no deep link fires and **no event is
  recorded at all**. So `success=false` captures only failures that made it back (a denied authorization,
  a broken token exchange) — never silent abandonment. Computing conversion as
  `success / (success + failure)` therefore reads optimistically high. For the onboarding funnel, use
  `studio_onboarding_complete`'s `authenticated` prop as the denominator instead: it is the only signal
  that counts users who walked away.
- **`studio ui`** (the browser UI served by `apps/local`) sets `STUDIO_TRACKS_ORIGIN=studio-web:v2` on
  its own process, so everything it forks — site operations and agent runs alike — inherits it and
  lands in `channel=studio-web` rather than being mistaken for standalone-CLI usage. The server has no
  Tracks wrapper of its own: `studio ui` injects the CLI's `recordTracksEvent` as the
  `recordTracksEvent` option of `startLocalServer`, which is what the events it records in-process
  (settings changes, session creation) and the ones the browser posts to it go through.
- **Renderer-originated events** go through the `recordAnalyticsEvent` IPC handler
  (`apps/studio/src/ipc-handlers.ts`). Both renderers share the same Main single entry point, and the
  desktop wrapper's `commonProps()` attaches `channel`/`ui_version` centrally — the `ui_version` is
  derived from the active renderer via `getPreferredUiVersion()`, so callers pass only event-specific
  props. The agentic `apps/ui` renderer routes through its `Connector.trackEvent`: the IPC connector
  reaches Main directly, while the `local` connector posts to `POST /api/analytics/event`, the
  browser's equivalent choke point. That route drops unknown event names and strips client-supplied
  `channel`/`ui_version`, so the server stays the only thing that labels an event's origin. The
  `hosted` connector still no-ops — a multi-user deployment needs an identity and consent model first.

## Property vocabulary

Studio adopts the data team's standardized shared property names so events aggregate cleanly across
other products. Prefer a standard name over a bespoke one; only introduce a custom property when
none fits, and flag it for registration.

| Property | Meaning | Studio values |
|---|---|---|
| `channel` | Entry platform / application | `studio-ui` (Electron app), `studio-web` (browser UI served by `studio ui`), `studio-cli` (bare terminal invocation) |
| `is_a11n` | Automattician flag (shared across products) | `true` / `false` (derived from the auth token email domain) |
| `platform` | OS | `darwin`, `win32`, `linux` |
| `arch` | CPU architecture | `arm64`, `x64`, … |
| `app_version` | Product version | e.g. `1.15.0` |
| `ui_version` | **Custom (Studio-only):** which renderer chrome is running | `v1` (legacy), `v2` (agentic). Orthogonal to `channel`: it does **not** encode Electron-vs-browser, so the browser UI is `studio-web` + `v2` — it serves the same `apps/ui` bundle the desktop reports as `v2`. Absent for `studio-cli`. No standard slot — must be registered as a Studio-custom property. |
| `appearance` | **Custom (Studio-only):** selected database presentation | `studio`, `phpmyadmin` |

Common props (`platform`, `arch`, `app_version`, `is_a11n`, and `channel`/`ui_version`) are attached by the
wrappers — pass only event-specific props. On the desktop the wrapper's `commonProps()` attaches
`channel: studio-ui` and `ui_version` (derived from the active renderer via `getPreferredUiVersion()`); the
CLI wrapper resolves `channel`/`ui_version` from `STUDIO_TRACKS_ORIGIN`.

`surface` (in-app area, e.g. `onboarding`/`settings`) is live on `studio_setting_telemetry_change`; the renderer
supplies it per change (Main can't infer it) and it is meant to generalize to other settings-change
events. Reserved for later phases (documented so future events conform): `outcome` (`success`/`error`).

`source` plays the same role for `studio_wpcom_auth` — which login affordance the attempt started from —
with a wider value set than `surface`, since logins are offered from far more places than settings
changes. Like `surface`, the renderer supplies it (Main can't infer it) and it is threaded from the
initiating call. `account_type` (`new`/`existing`) and `authenticated` (boolean) are Studio-custom props
introduced with those events; register them alongside the events.

**AI / assistant events.** Studio Code assistant events use the data team's AI-event vocabulary so
they aggregate with other Automattic AI products. The shared identity props are built once by
`getAiTracksIdentity()` (`packages/common/ai/tracks-identity.ts`) — it lives in `common` because the
events are emitted from two places (the CLI for chat, Main for session creation) and the values must
not drift.

| Property | Meaning | Studio values |
|---|---|---|
| `ai_session_id` | The chat session | The session's `crypto.randomUUID()`. Always the **resolved** id — the IPC/HTTP boundary also accepts an id prefix or `latest`. |
| `agent_name` | Agent runtime | `pi` |
| `client` | AI product | `studio-code` — `channel` still records the surface |
| `ability_name` | Predefined skill invoked | `annotate`/`taxonomist`/`need-for-speed`/`rank-me-up`/`liberate`; absent for an ordinary message |
| `outcome` | How a turn ended | `success`/`error`/`interrupted`/`max_turns` (mirrors the session log's `TurnStatus`) |

`is_test` and `agent_version` are not sent: test runs are suppressed at the source rather than
tagged, and pi is pinned per Studio release so `app_version` already determines it.

**Privacy.** These events never carry prompts, replies, raw error text (`errorMessage` can embed
filesystem paths and site names), site names or paths, or the instructions content. `ability_name` is
resolved against the skill catalog by `resolveSkillFromPrompt`, so arbitrary slash text a user typed
can never reach an event prop.

## Event catalog

Every event also carries the common props `channel`, `ui_version`, `is_a11n`, `platform`, `arch`,
`app_version` (attached by the wrappers; `ui_version` is absent for pure-CLI `channel=studio-cli`
events). The tables below list the event-specific props, grouped by kind.

#### Lifecycle events

App and site lifecycle. The two site events are emitted by the CLI (the sole emitter for each), so a
start / creation is counted once whether it originated in a UI or the standalone CLI — filter by
`channel` to separate them.

| Event | Emitted from | Event-specific props |
|---|---|---|
| `studio_app_launch` | Desktop Main (`appBoot`); `studio ui` server start | `is_first_launch` (desktop only) |
| `studio_site_start` | CLI site-start funnel | `success` (boolean), `time_ms` (start duration). On success also `running_site_count` (running Studio sites after this one comes up). On failure instead `failure_reason` (coarse, low-cardinality: `timeout`/`port_unavailable`/`php_error`/`process_exited`/`unknown` — the raw error is never sent). |
| `studio_site_created` | CLI site-create funnel | `flow_type` (`new`/`blueprint`/`import`/`sync`/`duplicate`), `php_version`, `wp_version` (resolved from disk; `-` if unknown), `custom_domain` (boolean — the domain string is **never** sent), `ssl_enabled` (boolean), `time_ms` (creation duration). Emitted once per **successful** creation. |

#### Site operation events

Day-to-day site actions. **Stop and delete are emitted by the CLI** (the sole funnel — the desktop
delegates both to the CLI, so standalone-CLI usage is counted too; filter by `channel`). The **open**
actions are emitted from the renderer (both Classic and agentic). `open_in_terminal` is the exception:
it fires from Desktop Main (`openTerminalAtPath`) — a single funnel that also covers the agentic UI,
whose connector routes through it. `open_in_editor` is *not* emitted in Main's `openAppAtPath`, because
that handler is shared with single-file opens (AI skills, "Open <file>"); it fires at the three "open
site in editor" affordances instead (Classic overview button + site-menu, and the agentic UI's
`openSiteInEditor` connector method).

The site-content open events (`open_in_browser`, `open_wp_admin`, `open_customize`,
`open_phpmyadmin`) carry a **`browser`** prop recording where the content opened: `external` (the OS
browser) or `internal` (the agentic UI's in-app preview panel). Studio Classic always opens the OS
browser, so it always sends `external`. The agentic UI sends `internal` when it opens content in the
preview panel — the overview Customize buttons, and switching the preview's realm tabs (front end →
`open_in_browser`, WP Admin → `open_wp_admin`, database → `open_phpmyadmin`; re-selecting the active
tab is a no-op and emits nothing) — and `external` when the affordance leaves Studio: the site-list
"Open phpMyAdmin"/"Open WP admin" menu items, the site header's "open in your browser" link, and the
preview's "Open in… → Browser" button. That last button fires the event matching whatever realm the
preview is currently showing, so opening a WP Admin preview externally is an `open_wp_admin`
(`external`), not an `open_in_browser`. Free-form navigation *within* the preview panel (typing in the
address bar) is out of scope here and tracked separately. `studio_panel_opened` fires in **both**
front-ends: Classic from its tab strip, and the agentic UI from its route navigations (the
overview/settings/debugging tab switches, the site-list gear → overview, a site-name click → assistant
or, when chat is unavailable, overview, and the context-menu "Site settings" → settings). The agentic
UI's General settings tab reports `panel: settings` so it lines up with Classic's Settings panel; its
Debugging tab reports `panel: debugging`. No site names, paths, or URLs are ever sent — only the
enumerated prop values below.

| Event | Emitted from | Event-specific props |
|---|---|---|
| `studio_site_stop` | CLI site-stop funnel | `running_site_count` (running Studio sites remaining after this stop). A "stop all" emits one event per stopped site, counting down to 0. |
| `studio_site_delete` | CLI site-delete funnel | `delete_files` (boolean — whether the site's files were moved to trash). Emitted once per **successful** delete. |
| `studio_site_open_in_browser` | Renderer (Classic + agentic) | `browser` (`external`/`internal`) |
| `studio_site_open_in_editor` | Renderer (Classic + agentic) | `editor` (the resolved editor, e.g. `vscode`/`phpstorm`). Emitted at the "open site in editor" affordances, not in Main's `openAppAtPath` — that handler is shared with single-file opens (AI skills, "Open <file>"), which must not count as opening the site. |
| `studio_site_open_in_terminal` | Desktop Main (`openTerminalAtPath`) | `terminal` (the resolved terminal, e.g. `terminal`/`iterm`/`ghostty`/`warp`) |
| `studio_site_open_wp_admin` | Renderer (Classic + agentic) | `browser` (`external`/`internal`) |
| `studio_site_open_customize` | Renderer (Classic + agentic) | `entry_point` — the affordance clicked: `editor`, `editor_styles`, `editor_patterns`, `editor_navigation`, `editor_templates`, `editor_pages`, `media_library` (block themes) or `customizer`, `menus`, `widgets` (classic themes). Plus `browser` (`external`/`internal`). |
| `studio_site_open_phpmyadmin` | Renderer (Classic + agentic) | `browser` (`external`/`internal`); agentic UI entry points also send `appearance` (`studio`/`phpmyadmin`) |
| `studio_site_open_folder` | Renderer (Classic + agentic) | (none — opens the OS file manager) |
| `studio_panel_opened` | Renderer (Classic tab strip + agentic route navigation) | `panel` — the panel opened. Classic: `overview`/`sync`/`settings`/`assistant`/`import-export`/`previews` (only on a genuine user tab switch, not programmatic changes or re-selecting the current tab). Agentic: `overview`/`settings`/`debugging`/`assistant` (`sync`/`import-export`/`previews` are Classic-only). |

#### Import/export events

Backup import/export, emitted by the **CLI** `import`/`export` commands (the sole funnel — the desktop
and agentic UI delegate to the CLI, so standalone-CLI usage is counted too; filter by `channel`). Both
events mean a **user-initiated** backup operation: add-site-flow imports, sync-pull imports, and
sync-push exports suppress the event via a hidden `--suppress-tracks-event` flag (see "Which surface
emits what"). No file names or paths are ever sent. `failure_reason` is coarse and low-cardinality:
the known failure points throw `LoggerError`s tagged with a machine-readable `code`, which the
classifier returns directly — the raw, `__()`-translated error message is never sent or matched on
(it can carry filesystem paths, and its text varies by locale).

| Event | Emitted from | Event-specific props |
|---|---|---|
| `studio_site_imported` | CLI `import` | `success` (boolean), `importer_type` (`jetpack`/`local`/`playground`/`sql`/`wpress`/`xml`, or `unknown` when the failure occurred before an importer started), `time_ms` (total command duration, incl. the server restart). On failure also `failure_reason` (`disk_full`/`file_not_found`/`no_backup_handler`/`no_importer_found`/`invalid_zip`/`extract`/`database_import`/`wxr_import`/`bundled_wp_missing`/`unknown`). |
| `studio_site_exported` | CLI `export` | `success` (boolean), `export_type` (`full`/`content`/`db` — the `--mode` flag; sync pushes are suppressed, so in practice `content` appears only from standalone `studio export --mode content` runs), `time_ms` (export duration). On failure also `failure_reason` (`disk_full`/`no_exporter_found`/`database_export`/`site_meta`/`unknown`). |

#### Preview site events

Preview-site sharing (WordPress.com hosted previews, "snapshots" in code). Create/update/delete/delete-all
are emitted by the **CLI** (the sole funnel — the desktop Previews tab delegates all four to the CLI, so
standalone-CLI usage is counted too; filter by `channel`). **Open** fires from the **renderer** when the
user clicks a preview's URL to visit it. No site names, paths, or URLs are ever sent. `failure_reason` is
coarse and low-cardinality (the raw error is never sent).

| Event | Emitted from | Event-specific props |
|---|---|---|
| `studio_preview_site_create` | CLI `preview create` | `success` (boolean), `time_ms` (creation duration). On failure also `failure_reason` (`auth_required`/`size_limit`/`expired`/`not_found`/`timeout`/`upload`/`unknown`). |
| `studio_preview_site_update` | CLI `preview update` | `success` (boolean), `time_ms` (update duration). On failure also `failure_reason` (same vocabulary as create). |
| `studio_preview_site_delete` | CLI `preview delete` (single) | (none). Emitted once per **successful** single delete. |
| `studio_preview_site_delete_all` | CLI `preview delete --all` | `count` (number of the user's preview sites removed). Emitted once per **successful** delete-all (a single bulk server operation, not per site). |
| `studio_preview_site_open` | Renderer (Classic Previews list) | (none — opens the preview URL in the OS browser) |

#### Settings-change events

All fire **only on a real change** (the handler compares against the persisted value first), and all
carry a `surface` prop identifying where the change was made — `settings` unless noted. Most are
emitted by Desktop Main; settings also available in `studio ui` are emitted by its local server.
Sensitive values are never sent as strings (see `is_default` and the directory note below).

| Event | Emitted from | Event-specific props |
|---|---|---|
| `studio_setting_telemetry_change` | `saveAnalyticsEnabled` | `status` (`on`/`off`), `surface` (`onboarding`/`settings`) — recorded while analytics is still ON (before the write when turning off, after it when turning on) so the opt-out gate never self-suppresses it. |
| `studio_setting_appearance_change` | `saveColorScheme` | `mode` (`light`/`dark`/`system`), `surface` (`settings`) |
| `studio_setting_database_appearance_change` | Desktop `saveDatabaseAppearance` / `studio ui` local server | `appearance` (`studio`/`phpmyadmin`), `surface` (`settings`) |
| `studio_setting_language_change` | `saveUserLocale` | `locale`, `surface` (`settings`) |
| `studio_setting_code_editor_change` | `saveUserEditor` | `editor`, `surface` (`settings`) |
| `studio_setting_terminal_change` | `saveUserTerminal` | `terminal`, `surface` (`settings`) |
| `studio_setting_default_directory_change` | `saveDefaultSiteDirectory` | `is_default` (boolean), `surface` (`settings`) — the directory path is **never** sent (it contains the user's home path). |
| `studio_setting_quit_action_change` | `saveQuitSitesBehavior` | `behavior` (`stop`/`stop-and-auto-start`/`leave-running`), `surface` (`settings`) |
| `studio_setting_cli_change` | `installStudioCli`/`uninstallStudioCli` | `installed` (boolean), `surface` (`settings`) |
| `studio_setting_agentic_features_change` | `saveAgenticFeaturesEnabled` | `enabled` (boolean), `surface` (`settings`) |
| `studio_setting_ui_change` | `updateBetaFeature` (`enableAgenticUi` key) | `type` (`classic`/`agentic`), `surface` (`settings`/`banner`/`menu`) — the switch has several entry points; the caller supplies the surface. Not emitted for the boot-time seeding migration (no surface). |
| `studio_setting_instructions_change` | `saveGlobalAgentInstructions` | `has_content` (boolean), `length_bucket` (`empty`/`short` ≤200/`medium` ≤1000/`long`), `surface` (`settings`) — the instructions text is **never** sent. See the edit-session note below. |
| `studio_setting_ai_provider_change` | `saveAnthropicApiKey`/`setAiProvider` | `provider` (`wpcom`/`anthropic-api-key`), `has_anthropic_api_key` (boolean), `surface` (`settings`) — the API key is **never** sent. One event covers both handlers, since clearing the key also falls the provider back to WordPress.com. `studio ui` emits the same event from its own `/ai-settings` routes. |

`studio_setting_instructions_change` is the one settings event Main cannot detect on its own. Classic
saves on an explicit button press, but the agentic UI autosaves on an 800 ms debounce, so by the time
the user leaves the tab the file already holds the new text and there is nothing left to compare
against — and a naive per-save event would report one edit as many changes. The renderer therefore
owns the edit-session boundary: it passes `editSession.previousContent` (the value the visit to the
tab started from) on the save that ends the session, and omits the option entirely on intermediate
autosaves, which write without recording. Main emits only when that comparison shows a real change.

#### Studio Code events

Studio Code (AI assistant) usage. The chat events are emitted by the **CLI** (the sole funnel — every
surface forks it to run a turn), `session_created` from whichever host created the session in-process
— **desktop Main**, or the **`studio ui` server** via its own `/sessions` route. All carry the shared
AI identity props described under "Property vocabulary" above. Filter by `channel` to tell desktop
(`studio-ui`) and browser (`studio-web`) chat apart.

| Event | Emitted from | Event-specific props |
|---|---|---|
| `studio_code_message_sent` | CLI `runAgentTurn` | `provider` (`wpcom`/`anthropic-api-key` — the gateway serving the request, not the model vendor), `model` (e.g. `claude-sonnet-5`), `model_family` (`anthropic`/`openai`), `ability_name` (predefined skill, absent for an ordinary message), `has_images`, `has_files` (booleans). One per user turn dispatched. |
| `studio_code_turn_completed` | CLI `runAgentTurn` | `outcome` (`success`/`error`/`interrupted`/`max_turns`), `duration_ms`, plus the same `provider`/`model`/`model_family`. One per turn finishing. Partially overlaps the MC Stats `recordAgentRun` bump (`packages/common/ai/agent-stats.ts`), which is a bare counter with no model or duration breakdown. |
| `studio_code_session_created` | Desktop Main (`createAiSession`) | `has_site` (boolean — whether the session is bound to a site; the site name and path are **never** sent). Emitted only when a session is actually created, not when an empty draft is reused. |

Both events carry `ai_session_id`, so turn position is a funnel rather than a prop: the first
`studio_code_message_sent` after a `studio_code_session_created` with the same id is a conversation's
opening turn, and counting them per id gives messages-per-session. (An `is_resumed` boolean was
dropped for this reason — every UI turn resumes a session the desktop just created, so it was always
`true` outside the standalone CLI.)

**Reading `studio_code_session_created`:** it counts sessions that got *used*, not "new chat" clicks.
`createOrReuseAiSession` hands back the newest un-prompted, un-archived draft instead of piling up
orphans, so opening a new chat and leaving it empty emits nothing — however many times it is
repeated. A session is only created once the previous one has a prompt in it. That makes the event a
sound denominator for messages-per-session, but it will read lower than any UI-level count of the new
chat affordance.

#### Onboarding & authentication events

First-run onboarding and WordPress.com login. `studio_onboarding_complete` and the desktop half of
`studio_wpcom_auth` are emitted from **desktop Main** (the `saveOnboarding` handler and the auth deep-link
handler respectively — each the single funnel both front-ends converge on); the CLI emits
`studio_wpcom_auth` for its own `auth login` flow. No email addresses, user ids, tokens, or raw error text
are ever sent.

| Event | Emitted from | Event-specific props |
|---|---|---|
| `studio_onboarding_complete` | Desktop Main (`saveOnboarding`) | `authenticated` (boolean — whether the user holds a WordPress.com token at the moment onboarding completes). Emitted once, only on a genuine `false → true` transition. |
| `studio_wpcom_auth` | Desktop Main (auth deep-link handler) + CLI `auth login` | `success` (boolean), `source` (`onboarding`/`sync_tab`/`previews_tab`/`assistant_tab`/`overview_tab`/`settings`/`top_bar`/`site_header`/`add_site`/`cli`/`unknown`), `account_type` (`new`/`existing`). On failure also `failure_reason` (`access_denied`/`token_error`/`profile_fetch_failed`/`unknown`). |

**Reading these events.** Onboarding conversion is `AVG(authenticated)` over
`studio_onboarding_complete` — a single event, no join and no dedupe needed, and it counts users who
arrive already signed in (Classic completes onboarding for them automatically). Drop-off decomposes by
joining the two events on the install id: a completion with `authenticated=false` and **no**
`studio_wpcom_auth` row means the user never tried (a messaging problem), while one with a
`success=false` row means they tried and it broke (an auth-flow problem). Per-attempt conversion is
`studio_wpcom_auth WHERE source='onboarding'` — but read the abandonment caveat under "Which surface
emits what" before treating it as a rate.

**Reading `source`.** It records the affordance the login started from, not the app: `ui_version` already
separates Classic from the agentic UI. `unknown` is structural, not an error — see the caveat above for
when the initiation context can't be carried to the result. The two Settings surfaces in the agentic UI
(Account and Usage) both report `settings`, and the site dropdown reports `site_header` for both its
Preview and Live prompts.

`onboarding` means **first-run** onboarding only — the agentic UI's welcome and tour. Its add-site flow
also lives under an `/onboarding/*` route namespace (`/onboarding/connect` and friends), but a login
started there is `add_site`, matching Studio Classic's add-site prompt. Watch for this when adding a
`source`: the route path is not the surface.

**CLI semantics differ.** `channel=studio-cli` rows never carry `account_type` (the CLI has no signup
path) and can't produce `failure_reason=access_denied` (there is no in-app deny step — the user pastes a
token). Account for this before aggregating across channels. The CLI's "already authenticated" early
return emits nothing, since no authentication took place.

Each `failure_reason` does mean the same thing in both channels, so the values themselves aggregate
cleanly: `profile_fetch_failed` is always the `/me` lookup (the request or its schema), and `unknown` is
always a failure neither emitter anticipated — in practice the config write. Only the availability of a
reason differs, per above.

### How to add a new event

1. Add the event name to `TRACKS_EVENTS` in `packages/common/lib/record-tracks-event.ts`.
2. Emit it via the appropriate wrapper (`apps/studio/src/lib/tracks.ts`,
   `apps/cli/lib/tracks.ts`, or the `recordAnalyticsEvent` IPC handler / `Connector.trackEvent` from a
   renderer). Prefer a standardized property name from the vocabulary above; only add a custom prop when
   none fits, and flag it.
3. **Name it per the Tracks convention** — `<source>_<context>_<optional subcontext>_<action>`, at least
   three underscore-separated segments, matching `^[a-z_][a-z0-9_]*$` (lowercase, digits, underscores). A
   name that violates this is silently routed to the `tracks_rejects` table and never appears in the normal
   Live View — check the "Filter for only rejected events" box to spot it. This is separate from
   registration below: it is a hard ingestion gate, not documentation. (`studio_telemetry` — source +
   context with no action — was rejected this way until renamed to `studio_setting_telemetry_change`.) The
   `TRACKS_EVENTS` naming guard test in `record-tracks-event.test.ts` enforces this at CI time.
4. **Register the event and all its eventprops** via the Tracks Registration tool. Registration adds
   documentation and CI integrity checks — it does not gate collection or queryability (a validly-named
   event is already queryable in Superset without it). Register every prop the event carries, including the
   wrapper-attached common props (`channel`, `is_a11n`, `platform`, `arch`, `app_version`, `ui_version`);
   only the reserved Tracks defaults (timestamp, etc.) come for free.
5. Add a row to the event catalog above.

## Testing

What fires depends on the build, so pick the right method:

- **Unit tests (primary).** The wrapper logic — opt-out gating, common props, `is_a11n` resolution,
  origin/`channel` resolution, and the `__ENABLE_CLI_TELEMETRY__` gate — is covered by
  `packages/common/lib/tests/record-tracks-event.test.ts`, `apps/studio/src/lib/tests/tracks.test.ts`,
  and `apps/cli/lib/tests/tracks.test.ts`. These stub the build flag, so they verify the behavior
  without any build. Run: `npm test -- <path>`.
- **Studio Code events in a dev run.** These fire from the CLI child the agent run-manager forks.
  That fork normally discards the child's stdout (agent events travel over IPC), so its logging would
  be invisible; in a dev run it inherits stdout instead, and the `Would have recorded…` lines appear
  in the **Main-process terminal** — not the renderer console, and not the browser devtools.
- **`studio_app_launch` in a dev run.** Fires from the desktop Main process, which has no
  `__ENABLE_CLI_TELEMETRY__` gate, so a plain `npm start` logs `Would have recorded… studio_app_launch`
  in the **Main-process terminal** (the shared core no-ops the network send in dev/E2E). Add
  `enableAgenticUi` to see `ui_version: v2`.
- **`studio_site_start` in a dev run.** It fires from the CLI, whose build-time
  `__ENABLE_CLI_TELEMETRY__` gate is compiled to `false` in dev builds. The CLI wrapper treats
  `NODE_ENV === 'development'` as an escape hatch, though, so during a plain `npm start` a UI-triggered
  site start logs `Would have recorded… studio_site_start` in the **`npm start` terminal** (echoed as
  `[CLI - <siteId>] …`), the same way the desktop logs `studio_app_launch` — the shared core still
  no-ops the network send. To exercise it against a dev build **outside** a dev run (e.g. a standalone
  CLI invocation) **without** rebuilding, set the runtime override `STUDIO_FORCE_CLI_TELEMETRY=1`, and
  run the CLI directly in a terminal:

  ```
  # pick a site that is OFFLINE in `studio list` — `start` no-ops on an already-running site
  # ("WordPress server is already running") and never reaches the event.
  node apps/cli/dist/cli/main.mjs stop --path <site>   # ensure it's stopped
  STUDIO_FORCE_CLI_TELEMETRY=1 STUDIO_DEBUG_TRACKS=1 \
    node apps/cli/dist/cli/main.mjs start --path <site>
  ```

  Look for `Tracks event URL: https://pixel.wp.com/t.gif?_en=studio_site_start…` in the terminal.
  (Add `NODE_ENV=development` to also print the `Would have recorded… studio_site_start` line.)

  Gotchas, each of which silently produces no output:
  - **Watch the terminal, not a log file.** The line is `console` output from the CLI child; it goes to
    the terminal that ran it — for the desktop path, that's the `npm start` terminal, not
    `~/Library/Logs/Studio/`.
  - **`channel`** is `studio-cli` standalone, or the value in `STUDIO_TRACKS_ORIGIN` (with
    `ui_version`) when the host sets one — `studio-ui:v2` as the desktop injects when it spawns the
    CLI, `studio-web:v2` under `studio ui`.
- **The browser UI (`studio ui`).** Build the UI first (plain `cli:build` does not rebuild `apps/ui`):

  ```
  npm run cli:build:ui
  STUDIO_FORCE_CLI_TELEMETRY=1 STUDIO_DEBUG_TRACKS=1 NODE_ENV=development \
    node apps/cli/dist/cli/main.mjs ui --no-open
  ```

  `studio_app_launch` logs as the server comes up; drive the UI at `http://localhost:8081` for the
  rest. Everything prints in the terminal that ran `studio ui`, with `channel: studio-web`,
  `ui_version: v2`:
  - Events the server records itself (the launch event, renderer events posted to
    `/api/analytics/event`, settings changes, session creation) log directly.
  - Events from forked CLI children (site start/stop, import/export, preview CRUD) log because
    `createCliRunner` inherits the child's stdio in a dev run — `NODE_ENV=development` or
    `STUDIO_DEBUG_TRACKS` — and echoes Tracks lines from commands that capture output.
- **Live pixel to `pixel.wp.com`.** Only a shipped npm/prod build sends the real request (dev/E2E always
  no-ops). Confirm server-side by querying `tracks.prod_events` in Superset.

## Privacy / GDPR

The install UUID is a persistent pseudonymous identifier; events are anonymous (`_ut=anon`) and carry
no PII (no site names, paths, or WordPress.com user id). Analytics defaults ON with an opt-out in
Settings and onboarding, plus a Privacy Policy reference. `is_a11n` is a boolean flag, not an
identifier.
