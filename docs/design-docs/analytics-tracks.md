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
| CLI wrapper | `apps/cli/lib/tracks.ts` | Single entry point for the CLI. Enforces the opt-out **and** the build-time `__ENABLE_CLI_TELEMETRY__` switch. Resolves origin from `STUDIO_TRACKS_ORIGIN`. |
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
  `appBoot`), in parallel with the MC Stats launch bumps.
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
- **Renderer-originated events** (future) go through the `recordAnalyticsEvent` IPC handler
  (`apps/studio/src/ipc-handlers.ts`). Both renderers share the same Main single entry point, and the
  desktop wrapper's `commonProps()` attaches `channel`/`ui_version` centrally — the `ui_version` is
  derived from the active renderer via `getPreferredUiVersion()`, so callers pass only event-specific
  props. The agentic `apps/ui` renderer routes through its `Connector.trackEvent` (IPC connector); the
  `apps/ui` browser (`local`/`hosted`) connectors have no Main process and currently no-op `trackEvent`.

## Property vocabulary

Studio adopts the data team's standardized shared property names so events aggregate cleanly across
other products. Prefer a standard name over a bespoke one; only introduce a custom property when
none fits, and flag it for registration.

| Property | Meaning | Studio values |
|---|---|---|
| `channel` | Entry platform / application | `studio-ui`, `studio-cli` |
| `is_a11n` | Automattician flag (shared across products) | `true` / `false` (derived from the auth token email domain) |
| `platform` | OS | `darwin`, `win32`, `linux` |
| `arch` | CPU architecture | `arm64`, `x64`, … |
| `app_version` | Product version | e.g. `1.15.0` |
| `ui_version` | **Custom (Studio-only):** which desktop renderer | `v1` (legacy), `v2` (agentic). No standard slot — must be registered as a Studio-custom property. |

Common props (`platform`, `arch`, `app_version`, `is_a11n`, and `channel`/`ui_version`) are attached by the
wrappers — pass only event-specific props. On the desktop the wrapper's `commonProps()` attaches
`channel: studio-ui` and `ui_version` (derived from the active renderer via `getPreferredUiVersion()`); the
CLI wrapper resolves `channel`/`ui_version` from `STUDIO_TRACKS_ORIGIN`.

`surface` (in-app area, e.g. `onboarding`/`settings`) is live on `studio_setting_telemetry_change`; the renderer
supplies it per change (Main can't infer it) and it is meant to generalize to other settings-change
events. Reserved for later phases (documented so future events conform): `outcome` (`success`/`error`).

**AI / assistant events (Phase 2+).** Studio Code assistant usage events must use the data team's
AI-event vocabulary: `ai_session_id`, `agent_name`, `agent_version`, `ability_name`, `outcome`,
`client`, `is_test`.

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
| `studio_app_launch` | Desktop Main (`appBoot`) | `is_first_launch` |
| `studio_site_start` | CLI site-start funnel | `success` (boolean), `time_ms` (start duration). On success also `running_site_count` (running Studio sites after this one comes up). On failure instead `failure_reason` (coarse, low-cardinality: `timeout`/`port_unavailable`/`php_error`/`process_exited`/`unknown` — the raw error is never sent). |
| `studio_site_created` | CLI site-create funnel | `flow_type` (`new`/`blueprint`/`import`/`sync`/`duplicate`), `php_version`, `wp_version` (resolved from disk; `-` if unknown), `custom_domain` (boolean — the domain string is **never** sent), `ssl_enabled` (boolean), `time_ms` (creation duration). Emitted once per **successful** creation. |

#### Site operation events

Day-to-day site actions. **Stop and delete are emitted by the CLI** (the sole funnel — the desktop
delegates both to the CLI, so standalone-CLI usage is counted too; filter by `channel`). The **open**
actions are emitted from the renderer (both Classic and agentic), except `open_in_editor` /
`open_in_terminal`, which fire from Desktop Main (`openAppAtPath` / `openTerminalAtPath`) — a single
funnel that also covers the agentic UI, whose connector routes through the same handlers.

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
address bar) is out of scope here and tracked separately. `studio_panel_opened` is Desktop-Classic-only
— the agentic UI navigates via routes, not a tab strip. No site names, paths, or URLs are ever sent —
only the enumerated prop values below.

| Event | Emitted from | Event-specific props |
|---|---|---|
| `studio_site_stop` | CLI site-stop funnel | `running_site_count` (running Studio sites remaining after this stop). A "stop all" emits one event per stopped site, counting down to 0. |
| `studio_site_delete` | CLI site-delete funnel | `delete_files` (boolean — whether the site's files were moved to trash). Emitted once per **successful** delete. |
| `studio_site_open_in_browser` | Renderer (Classic + agentic) | `browser` (`external`/`internal`) |
| `studio_site_open_in_editor` | Desktop Main (`openAppAtPath`) | `editor` (the resolved editor, e.g. `vscode`/`phpstorm`) |
| `studio_site_open_in_terminal` | Desktop Main (`openTerminalAtPath`) | `terminal` (the resolved terminal, e.g. `terminal`/`iterm`/`ghostty`/`warp`) |
| `studio_site_open_wp_admin` | Renderer (Classic + agentic) | `browser` (`external`/`internal`) |
| `studio_site_open_customize` | Renderer (Classic + agentic) | `entry_point` — the affordance clicked: `editor`, `editor_styles`, `editor_patterns`, `editor_navigation`, `editor_templates`, `editor_pages`, `media_library` (block themes) or `customizer`, `menus`, `widgets` (classic themes). Plus `browser` (`external`/`internal`). |
| `studio_site_open_phpmyadmin` | Renderer (Classic + agentic) | `browser` (`external`/`internal`) |
| `studio_site_open_folder` | Renderer (Classic + agentic) | (none — opens the OS file manager) |
| `studio_panel_opened` | Renderer (Classic tab strip) | `panel` — the tab opened: `overview`/`sync`/`settings`/`assistant`/`import-export`/`previews`. Emitted only on a genuine user tab switch (not programmatic changes or re-selecting the current tab). |

#### Settings-change events

All fire from Desktop Main **only on a real change** (the handler compares against the persisted value
first), and all carry a `surface` prop identifying where the change was made — `settings` unless noted.
Sensitive values are never sent as strings (see `is_default` and the directory note below).

| Event | Emitted from | Event-specific props |
|---|---|---|
| `studio_setting_telemetry_change` | `saveAnalyticsEnabled` | `status` (`on`/`off`), `surface` (`onboarding`/`settings`) — recorded while analytics is still ON (before the write when turning off, after it when turning on) so the opt-out gate never self-suppresses it. |
| `studio_setting_appearance_change` | `saveColorScheme` | `mode` (`light`/`dark`/`system`), `surface` (`settings`) |
| `studio_setting_language_change` | `saveUserLocale` | `locale`, `surface` (`settings`) |
| `studio_setting_code_editor_change` | `saveUserEditor` | `editor`, `surface` (`settings`) |
| `studio_setting_terminal_change` | `saveUserTerminal` | `terminal`, `surface` (`settings`) |
| `studio_setting_default_directory_change` | `saveDefaultSiteDirectory` | `is_default` (boolean), `surface` (`settings`) — the directory path is **never** sent (it contains the user's home path). |
| `studio_setting_quit_action_change` | `saveQuitSitesBehavior` | `behavior` (`stop`/`stop-and-auto-start`/`leave-running`), `surface` (`settings`) |
| `studio_setting_cli_change` | `installStudioCli`/`uninstallStudioCli` | `installed` (boolean), `surface` (`settings`) |
| `studio_setting_agentic_features_change` | `saveAgenticFeaturesEnabled` | `enabled` (boolean), `surface` (`settings`) |
| `studio_setting_ui_change` | `updateBetaFeature` (`enableAgenticUi` key) | `type` (`classic`/`agentic`), `surface` (`settings`/`banner`/`menu`) — the switch has several entry points; the caller supplies the surface. Not emitted for the boot-time seeding migration (no surface). |

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
  - **`channel`** is `studio-cli` standalone, or `studio-ui` (with `ui_version`) when
    `STUDIO_TRACKS_ORIGIN` is set — as the desktop injects when it spawns the CLI (e.g.
    `STUDIO_TRACKS_ORIGIN=studio-ui:v2`).
- **Live pixel to `pixel.wp.com`.** Only a shipped npm/prod build sends the real request (dev/E2E always
  no-ops). Confirm server-side by querying `tracks.prod_events` in Superset.

## Privacy / GDPR

The install UUID is a persistent pseudonymous identifier; events are anonymous (`_ut=anon`) and carry
no PII (no site names, paths, or WordPress.com user id). Analytics defaults ON with an opt-out in
Settings and onboarding, plus a Privacy Policy reference. `is_a11n` is a boolean flag, not an
identifier.
