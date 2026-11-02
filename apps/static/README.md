# @studio/static

Studio as a static web app: its backend, which runs in the page. No Studio process is behind it, so sites run in WordPress Playground, everything Studio keeps stays in the browser, WordPress.com is reached directly with the user's token, and Studio Code runs in the page.

It plays the part `apps/local` plays for `studio ui`. The UI is `apps/ui`, which builds the static site and reaches this backend only through its `static` connector (`apps/ui/src/data/core/connectors/static/`).

## Running it

The UI builds and serves it; this package has no build of its own:

```bash
npm -w @studio/ui run dev:static     # http://localhost:3456
npm -w @studio/ui run build:static   # apps/ui/dist-static/, for any static host
```

The build serves `index.html` and `404.html` alike, so a static host resolves the app's routes. Sign-in needs the deployment's origin registered with WordPress.com (below).

Pulling a site needs a worker too: WordPress.com's backup download can't be read cross-origin, so the app reads it in chunks from `/wpcom-backup/<site>/<download>/data`. That route is `functions/wpcom-backup/`, which the build copies into `dist-static/functions/` and the dev and preview servers run themselves. A host needs to serve that route, so a plain static host can't pull.

On Spacefast, publish with the CLI, which compiles the worker (the API alone can't):

```bash
cd apps/ui/dist-static && npx spacefast publish --space studioweb
```

Spacefast's proxy rules aren't an alternative: they refuse responses over 1 MiB. A worker's stream can also end early with no error after about a minute, so keep each chunk well under that, and check its size.

## The backend

`createStaticBackend( { readAttachment, download } )` returns the services the connector maps the UI's calls onto:

- `sites` (`StaticSites`): sites and their Playground runtimes: create, start, stop, copy, delete, import, and site settings.
- `auth` (`WpcomAuth`): the WordPress.com account, signed in through WordPress.com's OAuth redirect.
- `wpcom` (`WpcomServices`): preview sites, connected sites, push and pull, the AI quota.
- `agent` (`StaticAgentRuns`): Studio Code. Each turn runs `createBrowserAgent` from `@studio/agent/browser` over the agent host in `src/agent/host.ts`; this keeps the conversations and the runs the UI follows.

The package also exports what the connector calls directly: the site origin, Blueprint bundles, site data (export, database dump, file sizes), site pages (`withSitePage`, `connectPreviewFrame`) and the key-value store.

## Layout

```
src/
  index.ts          createStaticBackend, and what the connector imports
  types.ts          the types it shares with the UI, from @studio/common and @studio/agent
  playground.ts     Playground runtimes, the site origin, and the bridge script every site page runs
  sites.ts          StaticSites: the site list and each site's lifecycle
  site-data.ts      backups, exports, file trees and wp-config settings inside a runtime
  site-page.ts      pages of a site, or documents of the agent's, in off-screen frames
  wpcom-auth.ts     WordPress.com sign-in
  wpcom-services.ts previews, sync and the AI quota
  backup-download.ts chunked backup downloads, through the host's worker
  store.ts          the key-value store
  agent/
    host.ts         the agent's host: files, WP-CLI, pages and WordPress.com, over the above
    index.ts        StaticAgentRuns: turns, their events, AI settings and instructions
    sessions.ts     conversations, stored as the entries the CLI writes
functions/          workers for the host
```

## Where things live

- **Site files**: each site's Playground runtime, saved to the origin-private file system (OPFS) under `studio/sites/<id>`. In the agent's paths, `/sites/<slug>/…` is `/wordpress/…` in that runtime.
- **Everything else**: one IndexedDB key-value store (`studio`): the site list, preferences, the WordPress.com token, conversations, AI settings.
- **Files the agent makes outside a site**, such as screenshots and request bodies, and the files the user attached: in memory, for as long as the page.

## Configuration

Build-time variables, all optional:

- `VITE_PLAYGROUND_REMOTE_URL`: the Playground runtime to load (default `https://playground.wordpress.net/remote.html`).
- `VITE_WPCOM_CLIENT_ID`, `VITE_WPCOM_REDIRECT_URI`: the WordPress.com OAuth app and its redirect. By default it uses Studio's app and `<origin>/auth/callback`, which must be registered on that app for the origin to sign in.

## What the web can't do yet

- **Push** depends on WordPress.com allowing uploads from the browser (CORS).
- **Studio Code** calls the WordPress.com AI proxy from the page, so the proxy must allow the deployment's origin.
- **Desktop features** are hidden through the connector's capabilities: site folders, phpMyAdmin, custom domains, Xdebug, site agent files, file access and version choice.

## Boundaries

Enforced by lint (`eslint.config.mjs`):

- This package never imports the UI (`@/*`, `@studio/ui`).
- In `apps/ui`, only the static connector imports `@studio/static`; features go through `useConnector()`.
