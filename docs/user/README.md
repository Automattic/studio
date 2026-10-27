# User Documentation

The WordPress Studio user documentation, kept here as a Markdown mirror of the Studio docs on developer.wordpress.com, plus the scripts that keep it up to date and generate screenshots. This directory is self-contained: it has its own `package.json` and `node_modules`, and is not part of the Studio npm workspaces.

```sh
cd docs/user
npm install
npx playwright install chromium   # first time only, for screenshots
```

| Command | Purpose |
| --- | --- |
| `npm run build-manifest` | Rebuild `manifest.json` from the site's docs index |
| `npm run fetch -- --section <slug>` | Fetch a section as Markdown into `docs/` |
| `npm run verify -- --section <slug>` | Compare local Markdown with the live site (reports in `reports/`) |
| `npm run screenshots` | Capture screenshots of the Studio app into `screenshots/out/<date>/` (git-ignored) |

## Screenshots

`npm run screenshots` drives the Studio Desktop app (2.0 or later) through a first run, signed out, with a throwaway profile, so your own sites and settings are never touched. Each shot is defined in `scripts/lib/studio-shots.mjs`, with the docs pages that use it and the uploaded images it replaces. `screenshots/out/<date>/index.md` lists what was captured, and the shots that need a WordPress.com login, which you capture by hand.

The script uses the first Studio it finds:

1.  `STUDIO_APP`, if set, for example `STUDIO_APP=/Applications/Studio.app/Contents/MacOS/Studio`.
2.  A build of this repo, from `npm run package` at the repo root (`apps/studio/out/Studio-<platform>-<arch>/`).
3.  On macOS, the installed `/Applications/Studio.app`.

To capture from this branch without packaging it (on macOS, `npm run package` needs Xcode), build it and point `STUDIO_APP_DIR` at the app. The script runs it in a copy of the repo's Electron, with the CLI from `apps/cli/dist`:

```sh
# at the repo root
npm run cli:build
(cd apps/studio && npx electron-vite build --config ./electron.vite.config.ts --outDir=dist && node --experimental-strip-types ../../scripts/build-ui-renderer.ts)
# in docs/user
STUDIO_APP_DIR=apps/studio npm run screenshots
```

`STUDIO_APP_DIR` takes precedence over `STUDIO_APP`. If npm skipped Electron's install script, run `node node_modules/electron/install.js` at the repo root first.

Use `--only <name,…>` to save only some shots (every step still runs, because each builds on the one before), and `--keep-profile` to keep the throwaway profile for inspection.
