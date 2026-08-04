# Reprint pull engine

## About this doc

This document covers how Studio adopts the Reprint pull engine (STU-1815) behind a
beta feature, and records the compatibility testing that shaped the design. No
implementation has landed yet — this is the agreed plan.

## Context

Studio has two independent pull implementations:

- The **legacy renderer** (`apps/studio`) pulls over the WordPress.com REST API
  directly from the renderer: `pullSiteThunk` initiates a Jetpack backup, polls it,
  downloads the archive, and hands it to the `importSite` IPC handler. It never
  invokes the CLI.
- The **agentic UI** (`apps/ui`) pulls through the CLI: `pullSiteFromLive` IPC →
  `pullSite()` in `packages/common/sites/sync.ts` → `studio pull`.

Only the second path goes through the CLI, so only that path can swap engines by
changing the command it runs. The legacy renderer is out of scope.

The CLI already ships `pull-reprint`, which pulls via the streaming site-migration
protocol instead of Jetpack backups.

## High level approach

### Engine selection

The engine is chosen per invocation by a new `--engine` option on `pull`
(`jetpack` | `reprint`, defaulting to `jetpack`). Existing invocations are
unchanged, so the public CLI API is preserved.

`--engine=reprint` makes `pull` a thin adapter onto `pull-reprint`'s `runCommand`:
`--remote-site <id|url>` resolves to a source site and `--options all` maps to
"pull everything". `pull-reprint` itself is unchanged and stays registered for
direct use; `resolveSourceSite()` gains internal support for a numeric site id, but
no new public flag.

A flag was chosen over an environment variable because the engine is a property of
the invocation, not of the machine. A flag also keeps `pull --help` deterministic,
is asserted directly by the existing argv tests in `packages/common/sites/sync.test.ts`,
and does not leak into the reprint/PHP grandchild processes.

`pull-reprint` is registered unconditionally; the `STUDIO_ENABLE_PULL_REPRINT`
environment gate is removed.

### Studio-side gating

A `reprintPull` beta feature (persisted in `app.json`, toggled from the native
Beta Features menu, following `remoteSession`) decides the engine in
`pullSiteFromLive`, which appends `--engine=reprint` to the argv. The decision is
made per pull, so the toggle takes effect on the next pull without a renderer
reload. `apps/local` (the `studio ui` browser server) keeps the default engine.

### Engine selection is sticky per site

The beta flag alone does not decide the engine. A Reprint pull rewrites the site
into a flattened layout where every top-level entry is a symlink into
`~/.studio/pulls/<siteId>/raw/`, and the Jetpack engine cannot pull into that
layout (see Compatibility testing). The site record already carries `reprintOrigin`,
so the engine is derived:

| Site state | Flag | Engine |
| --- | --- | --- |
| `reprintOrigin` set | either | `reprint` |
| not Reprint-shaped | on | `reprint` |
| not Reprint-shaped | off | `jetpack` |

`pull --engine=jetpack` additionally refuses to run against a Reprint-shaped site
rather than failing deep inside the importer. This guard also protects people
running `studio pull` by hand.

### Progress reporting

`pull` embeds `(N%)` in its messages and `pullSite()` scrapes it with
`/\((\d+)%\)/`. Reprint emits lines like
`Downloading files · 42/1337 files · 12.3 MB · 3m 12s` with no percentage, so the
agentic UI progress bar would never move.

Reprint's phases are weighted into one monotonic 0–100 figure, and `(N%)` is
appended so the existing parser works unchanged:

| Step | Band |
| --- | --- |
| Load site, resolve source, rotate secret | 0–3 |
| Preflight | 3–5 |
| `pull-files` (essential) | 5–55 |
| `pull-db` | 55–75 |
| `flat-docroot` | 75–82 |
| `apply-runtime` | 82–86 |
| Link runtime to site | 86–88 |
| Start server | 88–92 |
| `fetch-skipped` (remaining files) | 92–100 |

Within a step the fraction comes from reprint's own JSON-L counters, which
`migration-client.ts` already parses into a snapshot; `onProgress` gains a numeric
fraction alongside the formatted string. Values are clamped monotonic because
reprint restarts partial transfers. Skipped steps jump to their band end so the bar
never stalls.

### Selective sync

Out of scope. `pullSite()` has no selection parameter on trunk; #4377 adds one.
Mapping a selection onto `--only` / `--skip-database` / `--skip-uploads` is a
follow-up. Until then `--engine=reprint` rejects `--options` values other than
`all` rather than silently pulling everything.

## Compatibility testing

Two throwaway local sites were pulled from the same remote (a ~66k file, ~1.4 GB
Atomic staging site) to test switching engines on an existing site.

**Legacy → Reprint: works.** The site started conventionally laid out and came out
correctly Reprint-shaped. This is the designed path.

**Reprint → legacy: fails, after contaminating the Reprint scratch.**

1. `importWpContent` merges the Jetpack backup *through* the `wp-content` symlink
   into `~/.studio/pulls/<siteId>/raw/srv/htdocs/wp-content`.
2. `createEmptyDatabase` writes a fresh `.ht.sqlite` into the same scratch.
3. `importDatabase` fails with "Could not locate the SQLite integration plugin" —
   a Reprint-pulled `wp-content` comes from a live Atomic site running MySQL, so it
   has neither `mu-plugins/sqlite-database-integration` nor `db.php`.
4. The failure then repeats indefinitely without advancing past the first of 30
   database files.

Note that `JetpackImporter` sets `shouldCleanUpBeforeImport = false`, so
`moveExistingWpContentToTrash` is never reached by `studio pull` and no mass
deletion occurs. The damage is cross-engine contamination plus a hang, not data
loss.

"Just overwrite everything with a Jetpack pull" does not work as a remedy: the
Jetpack importer merges rather than replaces, and it never lays down WordPress
core. On a Reprint-shaped site core *is* symlinks into the scratch, so an overwrite
wide enough to delete the scratch would leave the site with no core. Making the
engines interchangeable would need an explicit reset step — unlink the symlinks,
re-materialise bundled core, re-apply the SQLite integration, drop the scratch, and
clear the Reprint fields on the site record. That is a separate feature.

## Related bugs found

Both are independent of this work and want their own issues:

- A failed database import retries forever instead of exiting.
- The importer follows symlinks out of `site.path`. `moveExistingWpContentToTrash`
  would `rm -rf` through them; that path is unreachable via `studio pull` but is
  live for the Playground, Local, SQL, WXR, and Wpress importers, so importing one
  of those archives into a Reprint-pulled site would delete scratch contents.

## Testing

- `apps/cli/lib/pull/pull-progress.test.ts` — band maths, monotonic clamping,
  skipped-step jumps.
- `apps/cli/commands/tests/pull.test.ts` — `--engine=reprint` adapter mapping;
  refusal on a Reprint-shaped site; non-`all` `--options` rejected.
- `apps/cli/commands/tests/pull-reprint.test.ts` — `resolveSourceSite()` with a
  numeric id.
- `packages/common/sites/sync.test.ts` — argv for both engines.
- `apps/studio/src/tests/` — `pullSiteFromLive` engine selection from the beta
  feature and from `reprintOrigin`.
