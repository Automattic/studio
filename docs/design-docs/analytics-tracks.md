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
- Later, the MC Stats **site-operation** counters (create/import/export) will be removed once Tracks
  dashboards are established.
- The MC Stats **launch** counters stay permanently as a simple headcount ping.

> **Coupling to watch when removing MC Stats:** the `studio_app_launch` event derives `is_first_launch`
> from the MC Stats `lastBumpStats` field (a durable pre-existing marker, so it's accurate for both
> existing users and fresh installs today). If the MC Stats launch bumps are ever removed, migrate this
> signal to another durable per-install marker (e.g. `sentryUserId`) or a dedicated flag in the same
> change — otherwise `is_first_launch` will silently report `true` on every launch.

## High level approach

The pieces mirror the MC Stats layering:

| Layer | File | Responsibility |
|---|---|---|
| Shared core | `packages/common/lib/record-tracks-event.ts` | Pure, environment-agnostic URL builder + fire-and-forget pixel sender. No config/opt-out logic. No-ops in E2E/dev. |
| Desktop wrapper | `apps/studio/src/lib/tracks.ts` | Choke point for the desktop (Main process). Enforces the opt-out, attaches common props. |
| CLI wrapper | `apps/cli/lib/tracks.ts` | Choke point for the CLI. Enforces the opt-out **and** the build-time `__ENABLE_CLI_TELEMETRY__` switch. Resolves origin from `STUDIO_TRACKS_ORIGIN`. |
| Identity + opt-out | `packages/common/lib/shared-config.ts` | `getOrCreateAnalyticsInstallId()`, `isAnalyticsOptedOut()`, `isAutomatticianFromToken()`. Persisted in `shared.json`. |

Events are sent as a **pixel GET** to `https://pixel.wp.com/t.gif` with query params. The reserved
Tracks pixel params the core builder attaches are:

- `_en` — event name (snake_case, `studio_` prefix)
- `_ut=anon` + `_ui=<install-uuid>` — anonymous identity (see note below)
- `_ts` — timestamp (ms)
- one query param per event property (all values coerced to strings)

The reserved `_`-prefixed params are a fixed set owned by the Tracks libraries — do not invent new ones
(a made-up `_foo` is ignored server-side). Origin/context is a normal event property (`channel`), not a
reserved param.

**Identity is anonymous-only in Phase 1.** We always send `_ut=anon` with the install UUID, even when
the user is authenticated with WordPress.com. Tracks also supports authenticated identity
(`_ut=wpcom:user_id`, `_ui=<wpcom user id>`), which would enable cross-product analytics — deferred to a
later phase per the proposal, as it carries stronger privacy implications.

Set the `STUDIO_DEBUG_TRACKS` env var to log the exact pixel URL for each event (useful for manual
verification).

## Identity and opt-out

- **Anonymous install UUID.** Minted lazily on first event and stored as `analyticsInstallId` in
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
  MC-Stats launch counters from being double-counted when the desktop spawns the CLI. Tracks site-start
  is intentionally **not** suppressed by it (see below).

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
  (`apps/studio/src/ipc-handlers.ts`). Both renderers share the same Main choke point: the legacy
  `apps/studio` renderer tags `ui_version: v1`; the agentic `apps/ui` renderer routes through its
  `Connector.trackEvent` (IPC connector), tagging `ui_version: v2`. The `apps/ui` browser
  (`local`/`hosted`) connectors have no Main process and currently no-op `trackEvent`.

## Property vocabulary

Studio adopts the data team's standardized shared property names so events aggregate cleanly across
Automattic products. Prefer a standard name over a bespoke one; only introduce a custom property when
none fits, and flag it for registration.

| Property | Meaning | Studio values |
|---|---|---|
| `channel` | Entry platform / application | `studio-ui`, `studio-cli` |
| `is_a11n` | Automattician flag (shared across products) | `true` / `false` (derived from the auth token email domain) |
| `platform` | OS | `darwin`, `win32`, `linux` |
| `arch` | CPU architecture | `arm64`, `x64`, … |
| `app_version` | Product version | e.g. `1.15.0` |
| `ui_version` | **Custom (Studio-only):** which desktop renderer | `v1` (legacy), `v2` (agentic). No standard slot — must be registered as a Studio-custom property. |

Reserved for later phases (documented so future events conform): `surface` (in-app area, e.g.
`onboarding`/`settings`), `outcome` (`success`/`error`), `site_type` (`simple`/`atomic`/`jetpack`/
`none`).

**AI / assistant events (Phase 2+).** Studio Code assistant usage events must use the data team's
AI-event vocabulary: `ai_session_id`, `agent_name`, `agent_version`, `ability_name`, `outcome`,
`client`, `is_test`.

## Event catalog

Every event also carries the common props `channel`, `is_a11n`, `platform`, `arch`, `app_version`
(attached by the wrappers). The table lists the event-specific props.

| Event | Emitted from | Event-specific props |
|---|---|---|
| `studio_app_launch` | Desktop Main (`appBoot`) | `ui_version`, `is_first_launch` |
| `studio_site_start` | CLI site-start funnel | `ui_version` (only when `channel=studio-ui`) |

### How to add a new event

1. Add the event name to `TRACKS_EVENTS` in `packages/common/lib/record-tracks-event.ts`.
2. Emit it via the appropriate wrapper (`apps/studio/src/lib/tracks.ts`,
   `apps/cli/lib/tracks.ts`, or the `recordAnalyticsEvent` IPC handler / `Connector.trackEvent` from a
   renderer). Prefer a standardized property name from the vocabulary above; only add a custom prop when
   none fits, and flag it.
3. **Register the event and its properties server-side** in the Tracks event schema. Events still flow
   without this, but registration is what makes them and their props formally defined and reliably
   queryable in the dashboards.
4. Add a row to the event catalog above.

## Privacy / GDPR

The install UUID is a persistent pseudonymous identifier; events are anonymous (`_ut=anon`) and carry
no PII (no site names, paths, or WordPress.com user id). Analytics defaults ON with an opt-out in
Settings and onboarding, plus a Privacy Policy reference. `is_a11n` is a boolean flag, not an
identifier. Confirm the anonymous-pixel + opt-out model with Legal for the exact Studio case before
broad rollout.

## Open items / prerequisites

- **Pixel params verified.** `_en`, `_ut`, `_ui`, `_ts` are the canonical reserved Tracks pixel params.
  A nonce is not required — `t.gif` is a plain unauthenticated GET (a nonce only applies to the
  authenticated `/rest/v1.1/tracks/record` route, a different mechanism we don't use). The builder in
  `record-tracks-event.ts` is isolated so any future param correction is a one-file change.
- **Register the events server-side** in the Tracks event schema. Unregistered events are still
  ingested (they are not dropped), but registration is required to have the events and their properties
  formally defined and reliably queryable in the dashboards. Do this before relying on the data.
- **Register or re-encode `ui_version`** with the data team (custom property).
