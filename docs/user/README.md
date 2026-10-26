# WordPress.com developer docs (Studio)

Local Markdown mirror of the WordPress Studio docs on developer.wordpress.com, plus the scripts that keep it up to date and generate screenshots. This directory is self-contained: it has its own `package.json` and `node_modules`, and is not part of the Studio npm workspaces.

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

`plans/` holds the update plans for past doc releases.
