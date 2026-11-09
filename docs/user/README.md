# WordPress Studio user docs

This folder is the source of the WordPress Studio documentation published at [wordpress.studio/docs](https://wordpress.studio/docs/), along with the tooling that captures its screenshots.

It's self-contained, with its own `package.json` and `node_modules`, and isn't part of the repo's npm workspaces.

**On this page**

- [What's in this folder](#whats-in-this-folder)
- [How the docs get published](#how-the-docs-get-published)
- [Editing the docs](#editing-the-docs)
- [Commands](#commands)
- [Screenshots](#screenshots)
  - [Capture screenshots](#capture-screenshots)
  - [Choose which build to capture from](#choose-which-build-to-capture-from)
  - [Suites](#suites)
  - [Signed-in safety](#signed-in-safety)
  - [Demo site](#demo-site)
  - [Write a shot](#write-a-shot)
  - [How images are saved](#how-images-are-saved)

## What's in this folder

| Path | What it holds |
| --- | --- |
| `docs/` | The Markdown pages |
| `screenshots/images/` | The images the pages use, and `index.md`, which lists them |
| `screenshots/shots/` | The script for each group of screenshots |
| `screenshots/demo-site/` | The sites and made-up data the screenshots show |
| `scripts/` | The capture and build tooling |
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

**Images:** keep the upload-style URL, `https://developer.wordpress.com/wp-content/uploads/YYYY/MM/<name>.webp`, or use a relative path into `screenshots/images/`. The site build only looks at the file name and uses the copy in `screenshots/images/`, so those upload URLs are expected and shouldn't be replaced.

**Headings:** new headings can be plain Markdown. Existing `## [Heading](#anchor)` lines also work; the site build generates the anchor from the heading text either way.

**New pages:** add the page to the `PAGES` list in [`scripts/build-docs-manifest.mjs`](https://github.com/Automattic/studio-website/blob/main/scripts/build-docs-manifest.mjs) in `studio-website`, or it won't appear on the site.

## Commands

First-time setup:

```sh
cd docs/user
npm install
npx playwright install chromium
```

| Command | Purpose |
| --- | --- |
| `npm run screenshots` | Capture screenshots of the app into `screenshots/images/` |
| `npm run screenshots:frame -- <image…>` | Put images on a framed background for blog posts |
| `npm run demo-site:build` | Rebuild the demo site backup from `screenshots/demo-site/wren-and-barley/` |
| `npm run design-looks:build` | Redraw the design boards for the design picker |

## Screenshots

`npm run screenshots` drives the WordPress Studio desktop app (2.0 or later) through a throwaway profile, so your own sites and settings are never touched.

It gives the same images on any machine. The window size, color scheme, locale and site content are fixed, and a shot is rewritten only when its pixels change beyond anti-aliasing noise, so unchanged shots leave git clean.

### Capture screenshots

| Option | What it does |
| --- | --- |
| `--suite <name,…>` | Runs only some suites |
| `--only <name,…>` | Saves only some shots (the steps before them still run) |
| `--list` | Prints the suites and shots |
| `--out <dir>` | Changes the output folder |
| `--keep-profile` | Keeps the throwaway profiles for inspection |

A failed shot stops its suite, and the window at that moment is saved under `screenshots/images/failures/`.

[`screenshots/images/index.md`](screenshots/images/index.md) lists every shot and the upload it replaces. It has two groups of images you handle by hand:

- **Capture manually:** shots that need a WordPress.com login or similar (`90-manual.json`).
- **Kept by hand:** images no suite can capture, such as a browser or Keychain dialog, a terminal, or an old release in the changelog.

### Choose which build to capture from

The script uses the first of these it finds:

1. `STUDIO_APP_DIR`, pointing at an unpackaged build of this repo (see below).
2. `STUDIO_APP`, for example `STUDIO_APP=/Applications/Studio.app/Contents/MacOS/Studio`.
3. A packaged build of this repo, from `npm run package` at the repo root (`apps/studio/out/Studio-<platform>-<arch>/`).
4. On macOS, the installed `/Applications/Studio.app`.

The first-run shots need the welcome dialog added after WordPress Studio 2.0.4, so capture those from a build of this branch until the next release. To do that without packaging (on macOS, `npm run package` needs Xcode):

```sh
# at the repo root
npm run cli:build
(cd apps/studio && npx electron-vite build --config ./electron.vite.config.ts --outDir=dist && node --experimental-strip-types ../../scripts/build-ui-renderer.ts)

# in docs/user
STUDIO_APP_DIR=apps/studio npm run screenshots
```

Good to know:

- `npm run cli:build` is needed in every mode, because the demo sites are created with the CLI build in `apps/cli/dist`.
- If npm skipped Electron's install script, run `node node_modules/electron/install.js` at the repo root first.
- WordPress and PHP come from your own WordPress Studio caches in `~/.studio` when present, so runs work offline.

### Suites

Shots live in `screenshots/shots/*.json`, one file per feature (a *suite*). Each suite says how the app is launched and lists its shots in order.

| Suite | Launches with | Shows |
| --- | --- | --- |
| `10-first-run.json` | An empty profile | The welcome dialog, Add site, creating a site, the orientation guide |
| `20`–`50` | The demo sites | The workspace, site menu, site settings and app settings |
| `60-signed-in.json` | Demo sites, signed in (`"signedIn": true`) | The account menu, Annotate, Share and publish, the model menu, account settings |
| `61-signed-in-previews.json` | Signed in, with made-up preview sites (`"previewSites": true`) | The Share panel |
| `62-signed-in-connected.json` | Signed in, with a connected site (`"connectedSites": true`) | The website switcher, and the Pull changes and Publish changes steps |
| `63-signed-in-agent.json` | Signed in, empty profile (`"firstRun": true`) | A conversation told from a new blank site, without running a model |
| `64-signed-in-chat.json` | Signed in, with saved chats (`"chats"`) | A conversation that already happened |
| `70-signed-in-blog.json` | Signed in | One-off images for blog posts, which no docs page uses |
| `90-manual.json` | Not automated | Shots you capture by hand |

The demo sites come from `screenshots/demo-site/sites.json` and are created through the CLI before the app opens. "Wren & Barley" is running and selected, loaded from `wren-and-barley.zip`. "Bistro Lune" and "Ada Portfolio" are blank, stopped sites that fill out the sidebar, in the order they appear in the file.

#### Signed-in login

Signed-in suites use the login of the WordPress Studio on your machine, copied into the throwaway profile. Set `STUDIO_DOCS_AUTH_TOKEN` to override it, using the `authToken` object from a `shared.json`, as JSON. Suites fail up front without a login.

#### Made-up data

| File in `screenshots/demo-site/` | What it provides |
| --- | --- |
| `ai-quota.json` | AI credits: a free account partway through its allowance |
| `wpcom-sites.json` | The WordPress.com and Pressable sites listed. Each thumbnail is the front page of the demo site its `preview` names. Sites name their local site in `connectedTo` |
| `preview-sites.json` | Preview sites: each names its demo site, age in days, and the demo site used as its thumbnail. Also sets the preview-site count |
| `agent-turns/<name>.json` | Agent events played into a conversation |
| `chats/<name>.json` | Finished chats, written into the profile before launch |
| `design-looks/` | The four looks in the design picker (`looks.json` lists each one's label, description, `DESIGN.md` draft and photo) |

For the connected suite, the harness also answers the hosting PHP version, the latest backup and the backup's files. The files are the demo site's own `wp-content`, without the SQLite files.

#### Agent conversations

`63-signed-in-agent.json` stands in for WordPress Studio Code. The `stubAgentRuns` helper replaces the main process's `continueAiSession` handler, so sending a prompt from the real composer returns a made-up run. `playAgentTurn` then sends that run's events to the window over `ai-agent-event`, as the CLI would.

Everything on screen is the real renderer. For example, `design-looks` is the design picker with a pending "Which look should I build?".

To show another conversation, write its events (`message`, `chat.artifact`, `question.asked` and the rest of `AgentEvent`) in a new file in `agent-turns/` and play it the same way. A `demo-site:<path>` string in an event is copied into the profile's sessions folder, since the app only shows local media from there or a site.

`npm run design-looks:build` draws the looks as design boards with the agent's own `renderDesignBoard`, as `present_design_options` does.

#### Saved chats

For `64-signed-in-chat.json`, each chat named in `chats` is written to the profile before launch, placed under its site in `app.json` with its `title` in `shared.json`, and removed after the suite.

A chat file names its `site`, how many `minutesAgo` it started, and its `turns`. Each turn has a `prompt` and the agent's `replies`, and each reply is a message of text and tool calls (`{ name, args, result, details? }`, with `details.diff` for an edit).

#### Blog images

Keep one-off blog images in `70-signed-in-blog.json` rather than a throwaway suite, so the next post can recapture them.

For a post, `npm run screenshots:frame -- <image…>` puts images on a light gray margin with rounded corners, a hairline and a soft shadow, so the app's white edges don't wash out on a white page. It writes to `screenshots/framed/` (ignored), or to `--out <dir>`.

### Signed-in safety

- **Email:** the account's email is replaced by `you@example.com` on screen before every capture, and a shot fails rather than save if it reappears.
- **Name and avatar:** these are the account's own, so review those shots before uploading.
- **No real changes:** no step logs out (that would revoke the token), publishes, pulls or buys anything.
- **Guards:** signed-in launches also block a step that tries. Logging out, publishing, pulling, connecting sites, changing preview sites and starting an agent run throw instead (`BLOCKED_SIGNED_IN_HANDLERS` in `scripts/lib/studio-app.mjs`), and the window's requests to WordPress.com other than reads are aborted.

### Demo site

"Wren & Barley" is a small bakery-and-café site on a Twenty Twenty-Five child theme. It has a photo-first front page, Menu, Our story, Visit us and Order pages, three posts with featured images, and its own header, footer and journal templates.

Its source is in `screenshots/demo-site/wren-and-barley/`:

| Path | What it holds |
| --- | --- |
| `theme/` | The child theme. `theme.json` holds the palette, Literata type and flat square buttons |
| `DESIGN.md` | The design system WordPress Studio Code would have written, so the site preview's **Design system** view has something to show |
| `images.json` | The photos (all CC0, from Wikimedia Commons, with the author for credits) |
| `content/` | Block markup for pages, posts, templates and template parts, with `{{url:name}}`, `{{id:name}}` and `{{alt:name}}` placeholders for the photos |

**After editing it:** keep `DESIGN.md` and `theme/theme.json` in step, because the Design system view lists every color, font and font size where they differ. Then run `npm run demo-site:build`.

The build creates the site in a throwaway profile, installs the theme, imports the photos and content, and exports the backup over the old one (database, uploads and child theme; about 7 MB). It needs the internet for the photos the first time, then keeps them in `.cache/`.

`DESIGN.md` isn't in the backup. The screenshot script copies it into the site's folder after importing (`design` in `sites.json`).

### Write a shot

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

**Finding elements:** elements are found by accessible role and name. `scripts/lib/locators.mjs` lists the forms, including `within`, `has`, `css` and `{{site.name}}`.

**Steps:** the verbs are `waitFor`, `click`, `hover`, `fill`, `press`, `toggle`, `scrollTo`, `waitForImages`, `setFiles`, `wait` and `helper`. The verbs and the named helpers for menus and settings are in `scripts/lib/steps.mjs`.

**`capture` options:**

| Option | What it does |
| --- | --- |
| `target` | A locator to crop to, or a list of locators framed together, such as a menu and the button that opened it |
| `pad` | The margin, as a number or `[x, y]`. Defaults to 48 |
| `aspect` | The least width-to-height ratio. Defaults to 1.5, since a tall crop sits badly on a docs page |
| `settle` | Milliseconds to wait before capturing |
| `keepMouse` | Leaves the pointer where it is |

A suite's own `capture` is the default for its shots, so the Settings suites only describe the dialog once. A dialog or menu is cropped to itself with some of the window around it, and only shots of the whole workspace keep the full window.

**`annotate` options:** `outline`, `badge` (numbered) and `arrow` (with `from`).

### How images are saved

- A shot with annotations is saved twice, as `<name>.webp` and `<name>-annotated.webp`, so the plain image can be reused elsewhere.
- Shots are captured at 2× regardless of the display.
- Images are WebP: lossless when that's smaller (plain UI), otherwise quality 90, which keeps 2× text sharp at about a fifth of the PNG size.
- On macOS, the window's close, minimize and zoom buttons are drawn into the image, because the system draws them outside what Electron captures.
