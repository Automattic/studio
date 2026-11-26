# WordPress Studio user docs

This folder is the source of the WordPress Studio documentation published at [wordpress.studio/docs](https://wordpress.studio/docs/), along with the script that captures its screenshots.

It has its own `package.json`, with no dependencies of its own, and isn't part of the repo's npm workspaces. Screenshots are captured with the capture harness in [`tools/capture-harness`](../../tools/capture-harness/README.md), which is part of the workspaces.

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
  - [Docs shots and extras](#docs-shots-and-extras)

## What's in this folder

| Path | What it holds |
| --- | --- |
| `docs/` | The Markdown pages |
| `screenshots/images/` | The images the pages use, and `index.md`, which lists them |
| `screenshots/extras/` | Shots no page uses, captured on demand (not committed) |
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
node --experimental-strip-types tools/capture-harness/cli.ts setup   # at the repo root: installs and builds what captures need
```

| Command | Purpose |
| --- | --- |
| `npm run screenshots` | Capture the screenshots the docs pages show into `screenshots/images/` |
| `npm run screenshots -- --check` | Report which of them changed, without writing them |
| `npm run screenshots -- --extras` | Capture the shots no page shows into `screenshots/extras/`, which git ignores |

## Screenshots

`npm run screenshots` runs the scripts in `screenshots/shots/*.json` through the capture harness, on its Moire scene (Rich's Moire Blueprint, baked the first time you run it on a machine), in the `docs` look. It saves only the shots a page in `docs/` shows; see [Docs shots and extras](#docs-shots-and-extras).

The harness drives a built WordPress Studio in a throwaway profile, so your own sites and settings are never touched.

It gives the same images on any machine. The window size, color scheme, locale and site content are fixed, and a shot is rewritten only when at least 1% of its pixels change, so unchanged shots leave git clean and a restyled icon or border doesn't rewrite every image. The run reports those smaller changes as `minor` and keeps the committed image.

Whole-window shots are framed on the app's light dot field. Cropped shots keep the app around them, with no frame.

### Capture screenshots

| Option | What it does |
| --- | --- |
| `--extras` | Captures the shots no page shows, into `screenshots/extras/` |
| `--suite <name,…>` | Runs only some suites |
| `--only <name,…>` | Saves only these shots, whether or not a page shows them yet (the steps before them still run) |
| `--check` | Reports which shots changed without writing them |
| `--keep-profile` | Keeps the throwaway profiles for inspection |
| `--min-change <percent>` | Rewrites an image only when at least this share of its pixels changed (default `1`; `0` writes every change). Shots named with `--only` are written whatever changed |

Other options are passed to the harness's `capture` command. A failed shot stops its suite, and the window at that moment is saved under `screenshots/images/failures/`.

After a full run, [`screenshots/images/index.md`](screenshots/images/index.md) lists every docs shot and the upload it replaces, and the extras. It has two groups of images you handle by hand:

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
| `60-signed-in.json` | Signed in (`"signedIn": true`) | The account menu, Annotate, the Publish panel, the model menu, account settings and providers |
| `61-signed-in-previews.json` | Signed in, with made-up preview sites (`"previewSites": true`) | The Publish panel’s previews, a preview’s details and actions |
| `62-signed-in-connected.json` | Signed in, connected to made-up WordPress.com sites (`"connectedSites": true`) | The Publish panel’s connected sites, a site’s details, and the pull and publish dialogs with their file choices |
| `63-signed-in-agent.json` | Signed in, on an empty profile | A story from a new blank site. The `stubAgentRuns` and `playAgentTurn` helpers stand in for WordPress Studio Code, so no model runs. `design-looks` is the design picker with a pending "Which look should I build?" |
| `64-signed-in-chat.json` | Signed in, with a recorded conversation (`"chats"`) | The Moire home page's text being updated |
| `70-signed-in-blog.json` | Signed in | One-off images for blog posts, captured as [extras](#docs-shots-and-extras) |
| `90-manual.json` | Not automated | Shots you capture by hand |

### Signed-in suites

- **Login:** suites sign in as a made-up demo person from the harness's `personas/`, so they need no account and never use the login of the WordPress Studio on your machine.
- **Name, avatar and email:** these are the demo person's.
- **Made-up data:** the AI credits, preview-site count and WordPress.com sites come from the scene.
- **No real changes:** the harness blocks logging out, publishing, pulling and anything else that would change the account. The connected suite never starts a pull or publish.

### Write a shot

Each suite is one feature's shots, in order. The [capture harness README](../../tools/capture-harness/README.md) describes the steps, locators, crops and annotations they use.

To find the accessible names to use in a new shot, run this from the repo root:

```sh
npx studio-capture inspect
```

#### Shots change with the app

The shot scripts follow the UI of the WordPress Studio in the same checkout, so expect to repair some of them with each release: a renamed button or a regrouped menu makes a step time out. A few habits keep that to a minimum, and let one script run against both a release and `trunk`:

- **Wait for the container, not one of its items.** Wait for the menu, dialog or tab panel a step opens (`{ "role": "menu", "name": "Site menu" }`), not for an item inside it that may be renamed.
- **Match a label that is changing with `pattern`.** `{ "role": "menuitem", "pattern": "^Delete( site)?$" }` finds the item under either name.
- **Open things the way both drivers can.** A keyboard shortcut that Studio Desktop handles from its application menu (such as ⌘, for Settings) does nothing when a script presses it there; click through the UI instead (the account menu, then **Settings**).
- **Leave the app as the next shot expects it.** Use `after` to close what a shot opened and to remove what it left behind, such as notes staged in the chat box, so a failure in one shot doesn't cascade.
- **Run the Desktop-only shots too.** The browser driver skips shots marked `desktopOnly`, so they go stale unnoticed. Capture them with `--driver electron`, which also runs on Linux under a virtual display.
- **Recapture only what a reader would notice.** A change smaller than 1% of an image's pixels is reported as `minor` and keeps the committed image, since most are restyled icons, borders or spacing and each rewritten image grows the repo. A label the page quotes or a new control can be that small too, so read the `minor` list (`--check --diff-dir <dir>` draws each difference) and recapture those shots with `--only <names>`.
- **Repair as you go.** When a run fails, or a shot shows something that's broken or no longer matches its page, fix the script in the same change rather than leaving it for the next release: a failed shot stops the rest of its suite, so one stale step hides every shot after it. Check the whole set (`npm run screenshots -- --check`, then the Desktop-only shots with `--driver electron`) until nothing fails or is "not run", and update the shot's `description` when its screen changes.

### Docs shots and extras

The shot scripts hold two kinds of shots, and only one kind is committed:

- **Docs shots** are the ones a page shows: its Markdown links `screenshots/images/<name>.webp` (or `<name>-annotated.webp`). Every release refreshes them with `npm run screenshots`, and only their images live in `screenshots/images/`. A plain or annotated copy that no page shows is deleted after a full run.
- **Extras** are every other shot: blog posts, marketing, social, or a screen a page may show later. They keep their scripts, since later shots often build on their steps and the next post can reuse them, but a docs run only plays their steps and saves no image. Capture them when you need them with `npm run screenshots -- --extras` (all of them) or `--extras --only <name,…>`, into `screenshots/extras/`, which git ignores. Keep one-off blog images in `70-signed-in-blog.json` rather than a throwaway suite. To frame one for a white page, use the harness's `frame --look blog <image…>`.

**Adding a docs shot for a new feature:** add the shot to the suite it belongs to, link its image from the page, then run `npm run screenshots -- --only <name>`. A shot becomes a docs shot when a page links it and an extra when no page does any more, so delete its image from `screenshots/images/` when you take it out of the last page that shows it.
