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
| `npm run screenshots` | Capture screenshots of the Studio app into `screenshots/images/` |
| `npm run demo-site:build` | Rebuild the demo site backup the screenshots open on, from `screenshots/demo-site/wren-and-barley/` |

## Screenshots

`npm run screenshots` drives the Studio Desktop app (2.0 or later) through a throwaway profile, so your own sites and settings are never touched. It is meant to give the same images on any machine: the window size, color scheme, locale and site content are fixed, and a shot is rewritten only when its pixels change beyond anti-aliasing noise, so unchanged shots leave git clean.

The shots are defined in `screenshots/shots/*.json`, one file per feature (a *suite*). Each suite says how Studio is launched and lists its shots in order: the steps that reach the screen, what to capture, optional annotations, and the docs pages and uploaded images the shot is for. `screenshots/images/index.md` lists every shot and which upload it replaces, plus the shots that need a WordPress.com login, which you capture by hand (`90-manual.json`).

- `10-first-run.json` launches with an empty profile: the welcome dialog, Add site, creating a site, the orientation guide.
- The other suites launch with the demo sites from `screenshots/demo-site/sites.json`, created through the Studio CLI before Studio opens: "Wren & Barley", running and selected, is loaded from the backup `wren-and-barley.zip`; "Bistro Lune" and "Ada Portfolio" are blank, stopped sites that fill out the sidebar. The sidebar keeps the order of the file.
- `60-signed-in.json` (`"signedIn": true`) runs on the demo sites signed in to WordPress.com: the account menu, Annotate, Share and publish, the model menu and the account settings. It uses the login of the Studio on your machine, copied into the throwaway profile, or `STUDIO_DOCS_AUTH_TOKEN` when set (the `authToken` object of a Studio `shared.json`, as JSON), and fails up front without one. The account's email is replaced by `you@example.com` on screen before every capture, and a shot fails rather than save if it reappears; the name, avatar and credits are the account's own, so review those shots before uploading. The WordPress.com and Pressable sites it lists are made up, from `screenshots/demo-site/wpcom-sites.json`: Studio's site list is answered from that file, and each site's thumbnail is the front page of the demo site its `preview` names. No step logs out, since that would revoke the token, and none publishes, pulls or buys anything.

The bakery is a small bakery-and-café site on Twenty Twenty-Five: a photo-first front page, Menu, Our story, Visit us and Order pages, three posts with featured images, and its own header, footer and journal templates. Its source is `screenshots/demo-site/wren-and-barley/`: `styles.json` is the site's global styles (palette, Literata type, flat square buttons), `images.json` lists the photos (all CC0, fetched from Wikimedia Commons, with the author for credits) and `content/` holds the block markup of the pages, posts, templates and template parts, with `{{url:name}}`, `{{id:name}}` and `{{alt:name}}` placeholders for the photos. After editing them, `npm run demo-site:build` creates the site in a throwaway profile, applies the styles, imports the photos and content, and exports the backup (database and uploads only; about 7 MB) over the old one. The build needs the internet for the photos the first time, then keeps them in `.cache/`.

A shot looks like this:

```json
{
  "name": "preview-destinations",
  "description": "Site preview address bar shortcuts",
  "pages": ["sites.md"],
  "replaces": ["2026/04/preview-destinations.png"],
  "steps": [
    { "click": { "role": "textbox", "name": "Address" } },
    { "waitFor": { "role": "dialog", "name": "Preview shortcuts" } }
  ],
  "annotate": [{ "outline": { "role": "dialog", "name": "Preview shortcuts" } }],
  "after": [{ "press": "Escape" }]
}
```

Elements are found by accessible role and name (`scripts/lib/locators.mjs` lists the forms, including `within`, `has`, `css` and `{{site.name}}`). The step verbs (`waitFor`, `click`, `hover`, `fill`, `press`, `toggle`, `scrollTo`, `waitForImages`, `setFiles`, `wait`, `helper`) and the named helpers for Studio's menus and settings are in `scripts/lib/steps.mjs`. `capture` takes `target` (a locator to crop to, or a list of locators framed together: a menu, the button that opened it, and anything else to keep whole in the frame; `pad` is the margin, 48 unless given, as a number or `[x, y]`; `aspect` the least width-to-height ratio, 1.5 unless given, since a tall crop sits badly on a docs page), `settle` (ms) and `keepMouse`. A suite's own `capture` is the default for its shots, so the Settings suites say the dialog once. A dialog or menu is cropped to itself with some of the window around it, and only shots of the whole workspace keep the full window. `annotate` takes `outline`, `badge` (numbered) and `arrow` (with `from`). A shot with annotations is saved twice, as `<name>.webp` and `<name>-annotated.webp`, so the plain image can be reused elsewhere, for example in a blog post. Shots are captured at 2× regardless of the display and saved as WebP, lossless when that is smaller (plain UI) and otherwise at quality 90, which keeps 2× text sharp at about a fifth of the PNG size. On macOS the window's close, minimize and zoom buttons are drawn into the image, because the system draws them outside what Electron captures.

Options: `--suite <name,…>` runs some suites, `--only <name,…>` saves only some shots (the steps before them still run), `--list` prints the suites and shots, `--out <dir>` changes the output folder, and `--keep-profile` keeps the throwaway profiles for inspection. A failed shot stops its suite, and the window at that moment is saved under `screenshots/images/failures/`.

The script uses the first Studio it finds:

1.  `STUDIO_APP`, if set, for example `STUDIO_APP=/Applications/Studio.app/Contents/MacOS/Studio`.
2.  A build of this repo, from `npm run package` at the repo root (`apps/studio/out/Studio-<platform>-<arch>/`).
3.  On macOS, the installed `/Applications/Studio.app`.

The first-run shots need the welcome dialog that came after Studio 2.0.4, so until the next release capture from a build of this branch. To do that without packaging it (on macOS, `npm run package` needs Xcode), build it and point `STUDIO_APP_DIR` at the app. The script runs it in a copy of the repo's Electron, with the CLI from `apps/cli/dist`:

```sh
# at the repo root
npm run cli:build
(cd apps/studio && npx electron-vite build --config ./electron.vite.config.ts --outDir=dist && node --experimental-strip-types ../../scripts/build-ui-renderer.ts)
# in docs/user
STUDIO_APP_DIR=apps/studio npm run screenshots
```

`STUDIO_APP_DIR` takes precedence over `STUDIO_APP`. If npm skipped Electron's install script, run `node node_modules/electron/install.js` at the repo root first. The demo sites are created with the CLI build in `apps/cli/dist`, so `npm run cli:build` is needed for every mode. WordPress and PHP come from your own Studio's caches in `~/.studio` when present, so the run works offline.
