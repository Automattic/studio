# User Documentation

The WordPress Studio user documentation, kept here as a Markdown mirror of the Studio docs on developer.wordpress.com, plus the scripts that keep it up to date, and the scripts for its screenshots. The Markdown scripts are self-contained: this directory has its own `package.json` and `node_modules`, and is not part of the Studio npm workspaces. The screenshots are captured with the Studio capture harness in `tools/capture-harness`, which is, so run `npm install` at the repo root too.

```sh
cd docs/user
npm install
npx playwright install chromium   # first time only
```

| Command | Purpose |
| --- | --- |
| `npm run build-manifest` | Rebuild `manifest.json` from the site's docs index |
| `npm run fetch -- --section <slug>` | Fetch a section as Markdown into `docs/` |
| `npm run verify -- --section <slug>` | Compare local Markdown with the live site (reports in `reports/`) |
| `npm run screenshots` | Capture screenshots of the Studio app into `screenshots/images/` |
| `npm run screenshots -- --check` | Report which screenshots' pixels changed, without writing them |

## Screenshots

`npm run screenshots` runs the scripts in `screenshots/shots/*.json` through the Studio capture harness (`tools/capture-harness`; its README has the full reference) on its Wren & Barley scene, in the `docs` look, into `screenshots/images/`. The harness drives a built Studio in a throwaway profile, so your own sites and settings are never touched, and gives the same images on any machine: the window size, color scheme, locale and site content are fixed, and a shot is rewritten only when its pixels change beyond anti-aliasing noise, so unchanged shots leave git clean. After a full run, `screenshots/images/index.md` lists every shot and which upload it replaces, plus the shots captured by hand (`90-manual.json`).

Options: `--suite <name,…>` runs some suites, `--only <name,…>` saves only some shots (the steps before them still run), `--check` reports which shots changed without writing them, and `--keep-profile` keeps the throwaway profiles for inspection; the rest are the harness's `capture` options. A failed shot stops its suite, and the window at that moment is saved under `screenshots/images/failures/`.

Each suite is one feature's shots, in order. The harness README describes the steps, locators, crops and annotations they use; `npx studio-capture inspect` (from the repo root) prints the accessible names on screen to write new ones with.

- `10-first-run.json` launches with an empty profile: the welcome dialog, Add site, creating a site, the orientation guide.
- The other suites open on the scene's sites: "Wren & Barley", running and selected, then the blank "Bistro Lune" and "Ada Portfolio".
- `60-signed-in.json` (`"signedIn": true`) is signed in to WordPress.com: the account menu, Annotate, Share and publish, the model menu and the account settings. It uses `STUDIO_CAPTURE_AUTH_TOKEN` when set, else the login of the Studio on your machine. The account's email is masked; the name and avatar are the account's own, so review those shots before uploading. The AI credits, preview-site count and WordPress.com sites are the scene's made-up ones, and the harness blocks logging out, publishing, pulling and anything else that would change the account.
- `61-signed-in-previews.json` (`"previewSites": true`) shows the scene's made-up preview sites in the Share panel.
- `62-signed-in-connected.json` (`"connectedSites": true`) connects the demo site to the scene's made-up WordPress.com sites: the website switcher and the Pull changes and Publish changes review steps with Choose files…, never starting a pull or publish.
- `63-signed-in-agent.json` is signed in on an empty profile, so its shots tell the story from a new blank site; the `stubAgentRuns` and `playAgentTurn` helpers stand in for Studio Code, so no model runs: `design-looks` is the design picker with a pending "Which look should I build?".
- `64-signed-in-chat.json` (`"chats"`) opens on a recorded conversation, the bakery's home page being polished.
- `70-signed-in-blog.json` holds one-off images for blog posts and announcements, which no docs page uses, so the next post can recapture them. Frame them for a white page with the harness's `frame --look blog <image…>`.

The harness uses the first Studio it finds (`STUDIO_APP_DIR`, `STUDIO_APP`, a packaged build of this repo, a build of `apps/studio`, then `/Applications/Studio.app`). The first-run shots need the welcome dialog that came after Studio 2.0.4, so until the next release capture from a build of this branch: `npx studio-capture setup` at the repo root builds it (and the CLI), and `npx studio-capture doctor` says what is missing.
