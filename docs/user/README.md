# WordPress Studio user docs

This folder is the source of the WordPress Studio documentation published at [wordpress.studio/docs](https://wordpress.studio/docs/), along with the script that captures its screenshots.

It has its own `package.json` and `node_modules`, and isn't part of the repo's npm workspaces. Screenshots are captured with the capture harness in [`tools/capture-harness`](../../tools/capture-harness/README.md), which is part of the workspaces.

**On this page**

- [What's in this folder](#whats-in-this-folder)
- [How the docs get published](#how-the-docs-get-published)
- [Editing the docs](#editing-the-docs)
- [Commands](#commands)
- [Screenshots](#screenshots)
  - [Capture screenshots](#capture-screenshots)
  - [Choose which build to capture from](#choose-which-build-to-capture-from)
  - [Suites](#suites)
  - [Signed-in suites](#signed-in-suites)
  - [Write a shot](#write-a-shot)
  - [Blog images](#blog-images)

## What's in this folder

| Path | What it holds |
| --- | --- |
| `docs/` | The Markdown pages |
| `screenshots/images/` | The images the pages use, and `index.md`, which lists them |
| `screenshots/shots/` | The script for each group of screenshots |
| `scripts/` | The script behind `npm run screenshots` |
| `plans/` | Working notes from past docs projects |

## How the docs get published

1. A docs change merges to `trunk` here.
2. [`Automattic/studio-website`](https://github.com/Automattic/studio-website) checks out `docs/user/docs` and `docs/user/screenshots/images` from `trunk` and imports them as WordPress pages.
3. Someone builds and publishes the site. **Nothing publishes on its own.**

From a checkout of `studio-website`:

```sh
npm run docs:check      # is the live site behind trunk?
npm run deploy          # build and publish to production
```

See the [`studio-website` README](https://github.com/Automattic/studio-website#publishing) for the full process.

## Editing the docs

**Links to other docs pages:** use the page's full URL, such as `https://wordpress.studio/docs/sync/#exclude-files-with-deployignore`. The site build turns these into links between pages.

**Images:** use a relative path into `screenshots/images/`, such as `../../../screenshots/images/site-menu.webp` from a page in `docs/developer-tools/studio/`. They display on GitHub, and the site build imports the same file.

**Headings:** new headings can be plain Markdown. Existing `## [Heading](#anchor)` lines also work; the site build generates the anchor from the heading text either way.

**New pages:** add the page to the `PAGES` list in [`scripts/build-docs-manifest.mjs`](https://github.com/Automattic/studio-website/blob/main/scripts/build-docs-manifest.mjs) in `studio-website`, or it won't appear on the site.

## Commands

First-time setup:

```sh
npm install                       # at the repo root, for the capture harness
cd docs/user
npm install
npx playwright install chromium
```

| Command | Purpose |
| --- | --- |
| `npm run screenshots` | Capture screenshots of the app into `screenshots/images/` |
| `npm run screenshots -- --check` | Report which screenshots changed, without writing them |

## Screenshots

`npm run screenshots` runs the scripts in `screenshots/shots/*.json` through the capture harness, on its Moire scene (Rich's Moire Blueprint, baked the first time you run it on a machine), in the `docs` look.

The harness drives a built WordPress Studio in a throwaway profile, so your own sites and settings are never touched.

It gives the same images on any machine. The window size, color scheme, locale and site content are fixed, and a shot is rewritten only when its pixels change beyond anti-aliasing noise, so unchanged shots leave git clean.

Whole-window shots are framed on the app's light dot field. Cropped shots keep the app around them, with no frame.

### Capture screenshots

| Option | What it does |
| --- | --- |
| `--suite <name,…>` | Runs only some suites |
| `--only <name,…>` | Saves only some shots (the steps before them still run) |
| `--check` | Reports which shots changed without writing them |
| `--keep-profile` | Keeps the throwaway profiles for inspection |

Other options are passed to the harness's `capture` command. A failed shot stops its suite, and the window at that moment is saved under `screenshots/images/failures/`.

After a full run, [`screenshots/images/index.md`](screenshots/images/index.md) lists every shot and the upload it replaces. It has two groups of images you handle by hand:

- **Capture manually:** shots listed in `90-manual.json`.
- **Kept by hand:** images no suite can capture, such as a browser or Keychain dialog, a terminal, or an old release in the changelog. A full run keeps this section as it is.

### Choose which build to capture from

The harness uses the first of these it finds:

1. `STUDIO_APP_DIR`
2. `STUDIO_APP`
3. A packaged build of this repo
4. A build of `apps/studio`
5. `/Applications/Studio.app`

The first-run shots need the welcome dialog added after WordPress Studio 2.0.4, so capture those from a build of this branch until the next release. From the repo root:

```sh
npx studio-capture setup     # builds the app and the CLI
npx studio-capture doctor    # says what's missing
```

### Suites

Shots live in `screenshots/shots/*.json`, one file per feature (a *suite*), with each suite's shots in order.

| Suite | Launches with | Shows |
| --- | --- | --- |
| `10-first-run.json` | An empty profile | The welcome dialog, Add site, creating a site, the orientation guide |
| `20`–`50` | The scene's sites: "Moire", running and selected, then the blank "Bistro Lune" and "Ada Portfolio" | The workspace, site menu, site settings and app settings |
| `60-signed-in.json` | Signed in (`"signedIn": true`) | The account menu, Annotate, Share and publish, the model menu, account settings |
| `61-signed-in-previews.json` | Signed in, with made-up preview sites (`"previewSites": true`) | The Share panel |
| `62-signed-in-connected.json` | Signed in, connected to made-up WordPress.com sites (`"connectedSites": true`) | The website switcher, and the Pull changes and Publish changes review steps with Choose files… |
| `63-signed-in-agent.json` | Signed in, on an empty profile | A story from a new blank site. The `stubAgentRuns` and `playAgentTurn` helpers stand in for WordPress Studio Code, so no model runs. `design-looks` is the design picker with a pending "Which look should I build?" |
| `64-signed-in-chat.json` | Signed in, with a recorded conversation (`"chats"`) | The Moire home page's text being updated |
| `70-signed-in-blog.json` | Signed in | One-off images for blog posts, which no docs page uses |
| `90-manual.json` | Not automated | Shots you capture by hand |

### Signed-in suites

- **Login:** suites use `STUDIO_CAPTURE_AUTH_TOKEN` when set, otherwise the login of the WordPress Studio on your machine.
- **Email:** the account's email is masked.
- **Name and avatar:** these are the account's own, so review those shots before uploading.
- **Made-up data:** the AI credits, preview-site count and WordPress.com sites come from the scene.
- **No real changes:** the harness blocks logging out, publishing, pulling and anything else that would change the account. The connected suite never starts a pull or publish.

### Write a shot

Each suite is one feature's shots, in order. The [capture harness README](../../tools/capture-harness/README.md) describes the steps, locators, crops and annotations they use.

To find the accessible names to use in a new shot, run this from the repo root:

```sh
npx studio-capture inspect
```

### Blog images

Keep one-off blog images in `70-signed-in-blog.json` rather than a throwaway suite, so the next post can recapture them. To frame them for a white page, use the harness's `frame --look blog <image…>`.
