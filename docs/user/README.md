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
- `60-signed-in.json` (`"signedIn": true`) runs on the demo sites signed in to WordPress.com: the account menu, Annotate, Share and publish, the model menu and the account settings. It uses the login of the Studio on your machine, copied into the throwaway profile, or `STUDIO_DOCS_AUTH_TOKEN` when set (the `authToken` object of a Studio `shared.json`, as JSON), and fails up front without one. The account's email is replaced by `you@example.com` on screen before every capture, and a shot fails rather than save if it reappears; the name and avatar are the account's own, so review those shots before uploading. The AI credits are made up, from `screenshots/demo-site/ai-quota.json` (a free account partway through its allowance), and so is the preview-site count, which matches `preview-sites.json`. The WordPress.com and Pressable sites it lists are made up, from `screenshots/demo-site/wpcom-sites.json`: Studio's site list is answered from that file, and each site's thumbnail is the front page of the demo site its `preview` names. No step logs out, since that would revoke the token, and none publishes, pulls or buys anything.
- `61-signed-in-previews.json` (`"previewSites": true`) is signed in the same way, with made-up preview sites from `screenshots/demo-site/preview-sites.json` in the Share panel: Studio's preview list is answered from that file (each entry names its demo site, how many days old it is, and the demo site whose front page is its thumbnail). Nothing is created on WordPress.com.
- `62-signed-in-connected.json` (`"connectedSites": true`) is signed in the same way, with the demo site connected to the made-up sites in `wpcom-sites.json` that name it in `connectedTo`: Studio's connected-site list, the hosting PHP version, the latest backup and the backup's files are answered by the harness, the files being the demo site's own `wp-content` without Studio's SQLite files. It opens the website switcher and the Pull changes and Publish changes review steps with Choose files…, and never starts a pull or publish.
- `63-signed-in-agent.json` is signed in on an empty profile (`"firstRun": true`), so its shots tell the story from a new blank site, created through Add site, before the bakery exists. It stands in for Studio Code, for shots of a conversation without running a model or using credits. The `stubAgentRuns` helper replaces the main process's `continueAiSession` handler, so sending a prompt from the real composer answers with a made-up run instead of starting the agent; `playAgentTurn` then sends that run's events to the window over `ai-agent-event`, as the CLI would, from `screenshots/demo-site/agent-turns/<name>.json` (a `demo-site:<path>` string in an event is a file copied into the profile's sessions folder, since Studio only shows local media from there or a site). Everything on screen is the real renderer: `design-looks` is the design picker with a pending "Which look should I build?". Its four looks are in `screenshots/demo-site/design-looks/`: `looks.json` lists each one's label, description, DESIGN.md draft (Wren & Barley's own is one of them) and photo, and `npm run design-looks:build` draws them as design boards with the agent's own `renderDesignBoard`, as `present_design_options` does. To show another conversation, write its events (`message`, `chat.artifact`, `question.asked` and the rest of `AgentEvent`) in a new file in `agent-turns/` and play it the same way.
- `64-signed-in-chat.json` (`"chats"`) opens on a conversation that already happened: before Studio launches, each chat named in `chats` is written from `screenshots/demo-site/chats/<name>.json` into the profile's sessions folder as Studio Code records one, placed under its site in `app.json`, with its `title` in `shared.json`, and removed again after the suite. A chat file names its `site`, how many `minutesAgo` it started and its `turns`: a `prompt` and the agent's `replies`, each a message of text and tool calls (`{ name, args, result, details? }`, with `details.diff` for an edit). `wren-and-barley-homepage` is the bakery's home page being polished, every change one the preview shows.
- `70-signed-in-blog.json` holds one-off images for blog posts and announcements, which no docs page uses: keep them here rather than in a throwaway suite, so the next post can recapture them. For a post, `npm run screenshots:frame -- <image…>` puts images on a light gray margin with rounded corners, a hairline and a soft shadow, so the app's white edges don't wash out on a white page; it writes `screenshots/framed/` (ignored), or `--out <dir>`.

The bakery is a small bakery-and-café site on a Twenty Twenty-Five child theme: a photo-first front page, Menu, Our story, Visit us and Order pages, three posts with featured images, and its own header, footer and journal templates. Its source is `screenshots/demo-site/wren-and-barley/`: `theme/` is the child theme (its `theme.json` holds the palette, Literata type and flat square buttons), `DESIGN.md` is the design system Studio Code would have written for it, so the site preview's **Design system** view has something to show, `images.json` lists the photos (all CC0, fetched from Wikimedia Commons, with the author for credits) and `content/` holds the block markup of the pages, posts, templates and template parts, with `{{url:name}}`, `{{id:name}}` and `{{alt:name}}` placeholders for the photos. Keep `DESIGN.md` and `theme/theme.json` in step: the Design system view lists every color, font and font size where they differ. After editing them, `npm run demo-site:build` creates the site in a throwaway profile, installs the theme, imports the photos and content, and exports the backup (database, uploads and the child theme; about 7 MB) over the old one. `DESIGN.md` isn't in the backup: the screenshot script copies it into the site's folder after importing (`design` in `sites.json`). The build needs the internet for the photos the first time, then keeps them in `.cache/`.

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
