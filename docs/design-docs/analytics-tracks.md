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
events). The table lists the event-specific props.

| Event | Emitted from | Event-specific props |
|---|---|---|
| `studio_app_launch` | Desktop Main (`appBoot`) | `is_first_launch` |
| `studio_site_start` | CLI site-start funnel | (none — `ui_version` comes from the wrapper via `STUDIO_TRACKS_ORIGIN`, only when `channel=studio-ui`) |
| `studio_setting_telemetry_change` | Desktop Main (`saveAnalyticsEnabled`) | `status` (`on`/`off`), `surface` (`onboarding`/`settings`) — recorded while analytics is still ON (before the write when turning off, after it when turning on) so the opt-out gate never self-suppresses it. |
| `studio_setting_appearance_change` | Desktop Main (`saveColorScheme`) | `mode` (`light`/`dark`/`system`), `surface` (`settings`) |
| `studio_setting_language_change` | Desktop Main (`saveUserLocale`) | `locale`, `surface` (`settings`) |
| `studio_setting_code_editor_change` | Desktop Main (`saveUserEditor`) | `editor`, `surface` (`settings`) |
| `studio_setting_terminal_change` | Desktop Main (`saveUserTerminal`) | `terminal`, `surface` (`settings`) |
| `studio_setting_default_directory_change` | Desktop Main (`saveDefaultSiteDirectory`) | `is_default` (boolean), `surface` (`settings`) — the directory path is **never** sent (it contains the user's home path). |
| `studio_setting_quit_action_change` | Desktop Main (`saveQuitSitesBehavior`) | `behavior` (`stop`/`stop-and-auto-start`/`leave-running`), `surface` (`settings`) |
| `studio_setting_cli_change` | Desktop Main (`installStudioCli`/`uninstallStudioCli`) | `installed` (boolean), `surface` (`settings`) |
| `studio_setting_agentic_features_change` | Desktop Main (`saveAgenticFeaturesEnabled`) | `enabled` (boolean), `surface` (`settings`) |
| `studio_setting_ui_change` | Desktop Main (`updateBetaFeature`, `enableAgenticUi` key) | `type` (`classic`/`agentic`), `surface` (`settings`) |

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
