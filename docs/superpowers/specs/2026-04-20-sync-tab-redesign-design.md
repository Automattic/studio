# Sync Tab Redesign — Environment Triangle

**Date:** 2026-04-20
**Scope:** Per-local-site Sync tab only. Does not touch Add Site / Connect flows (owned by PR #3161).

## Problem

The current per-site Sync tab is a flat list of connected WordPress.com sites with push / pull controls. It exposes little about each site, treats every connection the same regardless of environment type, and leaves staging-site creation entirely outside Studio. Users can't see at a glance what each environment contains, how they differ, or how changes should flow between them.

## Goals

1. Make the local ↔ production ↔ staging relationship explicit and legible.
2. Surface meaningful data per environment (preview, WP version, plan, content counts, last activity) instead of just a site name and URL.
3. Enable one-click provisioning of a WordPress.com staging site from within Studio.
4. Reuse the existing sync engine, sync options model, and connected-site persistence. Reuse the metadata enrichment landing in PR #3161 (icon, plan, creation date, mshot).

## Non-goals

- The Add Site and Connect modals (PR #3161 scope).
- Per-post / CPT / row-level drift detection or merge. Sync remains file-level + database-level.
- A generalized "N environments" model. This redesign intentionally enforces the triangle.
- Touching the Overview tab. Sync remains its own tab.

## Primary workflows

- **Dev-release (primary).** Build locally → push to staging → review → promote to production.
- **Pull-to-work (secondary).** Pull production into local to fix or iterate, then push back up (optionally via staging).

## Design

### Layout — dynamic triangle

The tab is a three-column layout that grows as environments are added.

- **1 column:** Local only (brand-new site, no connections). To the right sits a single dashed placeholder card: **"Connect production site"** → opens the existing Add-site connect modal.
- **2 columns:** Local + Production. A dashed **"Create staging site"** card occupies the third slot.
- **3 columns:** Local + Production + Staging. All gutters active.

Local always occupies the leftmost column. Production occupies the middle. Staging occupies the right. The column order does not change once environments are connected.

### Column anatomy

Each populated column shows, top to bottom:

- Mshot thumbnail (remote) or local screenshot / fallback tile (Local).
- Environment label — `Local` · `Production` · `Staging` — with a status dot (running/offline for Local; reachable/unreachable for remotes).
- Site name and clickable URL.
- WP version and plan badge (for wpcom, from the data PR #3161 fetches).
- **Content counts block**: Posts, Pages, CPTs, Users, Plugins, Themes. Compact stat grid. Lazily fetched per environment and cached.
- **Last activity line**: "Pulled 2h ago" / "Pushed yesterday" / "—".

Columns are equal width with breathing room between them.

### Gutters — sync actions

Between adjacent columns is a vertical gutter containing directional actions. Each gutter has two arrows stacked (push and pull), each labeled and each showing a timestamp of the last time that direction ran.

Three gutters in the full triangle:

- **Local ↔ Production** — "Pull from Production" (common; B workflow). "Push to Production" (rare, guarded with an extra confirm naming the target URL).
- **Local ↔ Staging** — everyday dev-release flow. "Push to Staging" is the headline action; "Pull from Staging" available for symmetry.
- **Staging ↔ Production** — headline action is **"Promote to Production"** (staging → prod). Reverse direction is "Refresh staging from production" (pull prod over staging).

Clicking any action opens the existing sync-options sheet (database / uploads / plugins / themes / content) — the sync engine is reused unchanged. In-flight syncs show a progress bar overlaying the gutter.

**Destructive-direction guardrails:** any direction that overwrites production requires an extra confirm that names the target site by URL.

### Empty & partial states

- **No connections.** Local column at its own width, centered-left rather than stretched. Dashed placeholder card to its right.
- **Prod connected, no staging.** The "Create staging site" card is the **one-click provisioning slot**. Click → a small sheet opens with:
  - "Create a staging copy of *{site name}*"
  - Defaults: host = WordPress.com, clone from production, name auto-suggested.
  - Confirm → calls the WordPress.com staging-provisioning API → the third column begins rendering with a mshot placeholder and streaming status (`Provisioning…` → `Copying database…` → `Ready`).
  - **Fallback** if provisioning APIs don't pan out (see Open Questions): the card offers "Connect an existing staging site" and uses today's external flow.
- **Remote unreachable.** Column stays rendered but stat block shows "Couldn't reach site" with a retry link; sync actions in that gutter disable with an explanatory tooltip.

### Migration — enforcing the triangle for existing users

Today a local site can connect to N wpcom sites. The redesign enforces at most one production + one staging.

On first launch after the redesign, for each local site with more than two connections:

- Auto-promote the best prod-tagged site to the Production slot (most recent `lastPushTimestamp` wins ties).
- Auto-promote the best staging-tagged site to the Staging slot.
- Any leftovers move to a collapsed **"Archived connections"** disclosure below the triangle. They keep their sync history. Sync actions are hidden until the user either disconnects them or swaps one into a slot.

Each column carries a `⋯` menu with **Replace with another connected site** (picks from Archived) and **Disconnect.**

New connects after migration respect the one-per-slot rule; attempts to connect a third site of the same type block with a clear message explaining the slot is taken and offering "Replace current {Production|Staging}" as an action.

### Relationship to Overview

Sync remains its own tab. Overview is untouched. (Option B — merging Sync into Overview — was considered and rejected for scope.)

## Data model changes

- **No new connection persistence format.** The existing `getConnectedWpcomSites` / `connectWpcomSites` store continues to hold all connections. A connection's "slot" (Production / Staging / Archived) is derived at render time from `environmentType` + the migration rules above, not stored as a new field. Exception: if auto-promotion produces ambiguity, the *user's* explicit swap via the `⋯` menu must persist — that requires a new per-connection `slotOverride: 'production' | 'staging' | 'archived' | null` field on the connected-site record.
- **Content counts** are fetched via a new per-environment summary endpoint (likely `/sites/{site}/post-counts` + the existing site info) and cached in the renderer with a short TTL. Each column triggers its own fetch on mount; an explicit refresh is available from the `⋯` menu.
- **Staging provisioning** calls a new Main-process IPC handler that wraps the WordPress.com provisioning API and streams status events back to the renderer (see Open Questions).

## Architectural notes

- New module: `apps/studio/src/modules/sync/components/triangle/` housing `TriangleLayout`, `EnvironmentColumn`, `SyncGutter`, and the placeholder/provisioning cards.
- `sync-connected-sites.tsx` is replaced by the triangle layout; `sync-sites-modal-selector.tsx` (owned by PR #3161) is unchanged.
- A new `sync-triangle-slice` or selectors layered onto the existing `connected-sites` slice classify each connection into a slot. Slot overrides persist via a new IPC handler `updateConnectedSiteSlot`.
- A new RTK Query endpoint `useGetEnvironmentSummaryQuery(siteId)` returns the content-count block per remote environment. Local counts come from the already-running site via an in-process query (no new network).
- Staging provisioning: new Main-process module `apps/studio/src/modules/sync/lib/staging-provisioning.ts` exposes `provisionStagingSite(productionSiteId, options)` and emits progress events that the renderer subscribes to. The UI swaps the placeholder card for a streaming column during provisioning.

## API reference (verified against wpcom source)

All endpoints are under the `wpcom/v2` namespace. Source: `wp-content/rest-api-plugins/endpoints/site-staging.php`.

**Staging-site lifecycle:**
- `GET /sites/{production_site_id}/staging-site` — list staging sites for a production site. Empty array if none.
- `POST /sites/{production_site_id}/staging-site` — **creates a staging site.** One staging site per production site. Async: monitor via the Transfer Status endpoint. Returns the new site stub with its eventual URL (`https://staging-{id}-{slug}.wpcomstaging.com`).
- `POST /sites/{production_site_id}/staging-site/validate-quota` — preflight quota check before provisioning.
- `DELETE /sites/{production_site_id}/staging-site/{staging_site_id}` — delete the staging site.
- `GET /sites/{staging_site_id}/staging-site/production-site-details` — minimal info about the parent prod site, usable by users who only have access to staging.

**Native prod ↔ staging sync** (runs inside wpcom, triggered by our client call):
- `POST /sites/{production_site_id}/staging-site/push-to-staging/{staging_site_id}` — body: `{ options: ['sqls' | 'uploads' | 'plugins' | 'themes' | 'contents'] }`.
- `POST /sites/{production_site_id}/staging-site/pull-from-staging/{staging_site_id}` — body: `{ options: [...], allow_woo_sync: bool }`. WooCommerce db sync must be explicitly opted in.
- `GET /sites/{production_site_id}/staging-site/sync-state` — latest sync state for the production site. Returns 404 if no staging exists.

The `options` vocabulary matches Studio's existing `SyncOptions` type 1:1 (`sqls | paths | uploads | plugins | themes | contents`), so no translation layer is needed for the prod ↔ staging gutter.

**Content counts:**
- `GET /rest/v1.2/sites/{site}/post-counts/{post_type}` — returns counts grouped by status for a single post type. Implementation will call this once per visible post type (`post`, `page`, plus any CPTs discovered from the site info response).

**Pressable.** Out of scope for v1 — Pressable has its own platform APIs and its own staging model. Staging-provisioning UI will only offer to create a wpcom staging site. If the production site is on Pressable, the "Create staging site" card will show an explanatory message and link to Pressable's external staging-creation flow. Provisioning parity for Pressable is tracked as a follow-up.

**Fallback.** If the `POST /staging-site` call fails (quota, permissions, or API error), the provisioning UI surfaces the error message inline and offers a "Connect an existing staging site" action that opens today's external flow.

## Testing strategy

- Unit tests for the slot-assignment derivation (given N connections of mixed types, returns the right Production / Staging / Archived split, deterministically).
- Unit tests for the migration path (existing appdata with >2 connections produces the expected auto-promotions).
- Component tests for each state: zero / one-connection / two-connection / three-connection / provisioning-in-progress / remote-unreachable.
- Integration test: connect a prod site, provision staging (mocked API), run a full round of sync actions in each gutter, assert the existing sync engine receives the right parameters.
- Manual QA: migration on a real appdata with three+ connections; verify no data loss and archived section renders.
