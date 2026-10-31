# Studio capture harness

Screenshots and recordings of the Studio app, made reproducibly from three swappable inputs, for the docs, marketing, social posts and anything else that needs pictures of Studio. It drives a built Studio with Playwright in a throwaway profile, so your own sites and settings are never touched, and any agent (Claude Code, Studio Code, a bot) can run it from the command line.

| Input | What it holds | Bundled |
| --- | --- | --- |
| **Scene** | The sites Studio opens on (from a backup or a Blueprint), the made-up WordPress.com account data, recorded chats and agent turns | `scenes/wren-and-barley/` |
| **Script** | The shots: the steps that reach each screen, the crop, the annotations | `examples/`, and the docs' in `docs/user/screenshots/shots/` |
| **Look** | Window size, scale, color scheme, annotation colors, frame and output sizes, video settings | `looks/`: `docs`, `docs-dark`, `blog`, `marketing`, `social` |

Each is a JSON file with a schema in `schemas/`, so editors complete them and `validate` checks them. The harness core (the profile, the scene seeding, the signed-in guard and the step driver) is the same whatever runs it; the docs are one consumer (`docs/user`, `npm run screenshots` there).

## Setup

On a fresh clone, one command installs and builds everything, and checks the result:

```sh
node --experimental-strip-types tools/capture-harness/cli.ts setup   # at the repo root; Node 24
```

`setup` runs `npm install` at the repo root (which also downloads the WordPress server files and PHP), builds the CLI with its browser app (`npm run cli:build:ui`), downloads the Chromium build this Playwright launches (another build already on the machine doesn't count), and for Studio Desktop downloads Electron and builds `apps/studio`. On Linux as root it first installs xvfb, the libraries Electron and Chromium need, and fonts (`apt-get`). It skips what is already there, and runs `npm install` again if an earlier one stopped partway (PHP is its last download) and the CLI build again if it lacks some of the WordPress server files; `--rebuild` builds the CLI and app again, and `--driver browser` leaves Studio Desktop out. After it, run the harness as `npx studio-capture <command>` from the repo root (the workspace links its bin).

`npx studio-capture doctor` checks the same things without changing anything, and names the fix for each missing one (`--json` for agents). It exits non-zero when something a capture needs is missing.

The harness finds the rest itself:

- **Studio Desktop**: `STUDIO_APP_DIR` (an unpackaged build, run in a copy of the repo's Electron with the CLI linked in), `STUDIO_APP` (an executable), a packaged build (`npm run package`, `apps/studio/out/`), the `apps/studio` build `setup` makes, or on macOS `/Applications/Studio.app`.
- **The CLI**, which creates the scene's sites and serves `studio ui`: `STUDIO_CLI`, this repo's build, or the CLI inside the packaged or installed Studio. So on a Mac with Studio installed, `npm install` is the only step: no build at all.
- **WordPress and PHP**: your own Studio's caches in `~/.studio`, linked into each throwaway profile, so runs work offline once they are there.

### Drivers

The harness drives either front end of Studio; `--driver`, or a script's `driver`, picks one.

- **`electron`** (the default): Studio Desktop. Every feature, and the docs images. It needs a display: on Linux without one, the harness starts a virtual one (Xvfb) for the run, and passes Chromium's `--no-sandbox` when running as root, as in most containers.
- **`browser`**: `studio ui`, the browser app the CLI serves, in headless Chromium. The renderer is the same `apps/ui`, so most screens look the same, without the macOS window buttons; it needs no display, Electron or app build, so it is the lighter choice in a container. Desktop-only features (Annotate, opening sites in other apps, native dialogs) aren't there. Stubs and the signed-in guard answer the browser app's `/api` requests instead of IPC.

### In the cloud

The harness runs in a headless Linux sandbox, such as a Claude Code cloud session or another agent's cloud machine, from a fresh clone, as root or not: `setup`, then capture. Behind a proxy (`HTTPS_PROXY`, as in most sandboxes) the downloads go through it. The sandbox needs to reach:

| Host | For |
| --- | --- |
| `registry.npmjs.org` | the repo's dependencies |
| `wordpress.org`, `api.wordpress.org`, `downloads.wordpress.org` | WordPress, its translations and plugins (`npm install`) |
| `appscdn.wordpress.com` | Studio's PHP (`npm install`) |
| `public-api.wordpress.com` | the Blueprints in Add site, while capturing |
| `github.com`, `raw.githubusercontent.com`, `release-assets.githubusercontent.com` | Electron, WP-CLI, the SQLite files and the agent skills |
| `cdn.playwright.dev` | Playwright's Chromium |

Signed-in scripts need `STUDIO_CAPTURE_AUTH_TOKEN`, set as the sandbox's secret, since there is no local login. Linux captures show Linux keyboard shortcuts (`Ctrl+Alt+P`, not `⌥⌘P`) and scrollbars, so for the docs images, which should come from one fixed environment, capture on macOS with Studio Desktop.

## Commands

```sh
npx studio-capture help
studio-capture setup | doctor [--driver electron|browser]
studio-capture capture <script|dir>… [--scene <name|file> | --blueprint <file|url>] [--look <name|file>] [--out <dir>]
studio-capture check   <script|dir>… --out <dir> [--diff-dir <dir>]   # visual check: what changed, images left alone
studio-capture record  <script|dir>… --only <shot> [--look marketing] # video of a shot's steps
studio-capture inspect [--scene … | --blueprint …] [--script <file> --until <shot>] [--steps '<json>']
studio-capture validate <file|dir>…
studio-capture bake --scene <file> | --blueprint <file|url> [--out <dir>]
studio-capture frame --look blog <image>…
studio-capture list <script|dir>…
studio-capture schemas [--check]
```

Common options: `--driver electron|browser` picks the front end (see **Drivers**), `--suite <a,b>` runs only those scripts, `--only <a,b>` keeps only those shots (the steps of the shots before them still run), `--json` prints the results as JSON on stdout (progress goes to stderr), `--keep-profile` keeps the throwaway profiles to look at afterwards. A failed shot stops its script; the window at that moment is saved under `<out>/failures/`. A shot also fails when the window shows a could-not-load message (the Blueprints list without internet, say) instead of saving it. The exit code is non-zero when a shot fails, and in `check` when any shot changed.

A scene or look named without a path (`wren-and-barley`, `marketing`) is a bundled one; anything else is a file. Precedence: `--scene`/`--look` on the command line, then the script's own `scene`/`look`, then `wren-and-barley` and `docs`.

### Examples

```sh
# The docs screenshots (what `npm run screenshots` in docs/user runs)
studio-capture capture docs/user/screenshots/shots --look docs --out docs/user/screenshots/images

# Your own Blueprint, in the marketing look
studio-capture capture tools/capture-harness/examples/workspace-tour.json --blueprint ./my-blueprint.json --look marketing --out captures

# The same tour, Settings → Appearance recorded as video
studio-capture record tools/capture-harness/examples/workspace-tour.json --blueprint ./my-blueprint.json --only settings-appearance --look marketing --out captures

# In CI: which docs shots changed, with pictures of the differences
studio-capture check docs/user/screenshots/shots --out docs/user/screenshots/images --diff-dir diffs --json > results.json
```

## Scenes

```json
{
	"$schema": "../../schemas/scene.schema.json",
	"name": "my-shop",
	"sites": [
		{ "name": "Rich's Shop", "blueprint": "https://example.com/shop-blueprint.json" },
		{ "name": "Wren & Barley", "import": "../wren-and-barley/wren-and-barley.zip", "design": "../wren-and-barley/source/DESIGN.md" },
		{ "name": "Ada Portfolio" }
	],
	"account": { "aiQuota": "ai-quota.json" }
}
```

The sites are created through the Studio CLI before Studio opens, in sidebar order. A site takes an `import` (a Studio backup), a `blueprint` (a path or URL, applied by `studio site create --blueprint`), or neither (a blank site that fills out the sidebar). Sites with content start with Studio; scripts open on `open` (a slug), else the first site with content, and `{{site.name}}` in a script is its name. Without `id` and `slug`, each site gets stable ones from its name. `design` is copied in as the site's DESIGN.md, which a backup can't carry. Paths are relative to the scene file.

`--blueprint <file|url>` makes a one-site scene on the spot, named after the Blueprint's `meta.title`. A Blueprint downloads things and changes with them, so for reruns that must match, **bake** it: `studio-capture bake --scene my-shop/scene.json` creates each Blueprint site, exports it whole as `<slug>.zip`, and writes `scene.baked.json`, which imports those backups (and keeps the Blueprint as `bakedFrom`). Commit the baked scene and its backups, and capture from it.

The rest of a scene answers for a signed-in account and fills the app with history:

- `account.wpcomSites`: the WordPress.com and Pressable sites Studio lists instead of the account's own, each a `SyncSite` as `fetchSyncableWpcomSites` returns it, plus `preview` (the scene site whose front page stands in for its thumbnail) and `connectedTo` (the scene site it is connected to in `connectedSites` scripts, which then answer the Publish panel's questions with that site's own files).
- `account.previewSites`: the preview sites in the Share panel (`previewSites` scripts), each a `Snapshot` with `site` (a scene slug) in place of `localSiteId` and `ageDays` in place of `date`. The preview-site count matches.
- `account.aiQuota`: the AI credits, so no shot shows the real account's balance.
- `chats`: a folder of conversations (`<name>.json`) a script opens on with `"chats": ["<name>"]`, written into the profile as Studio Code records them. A chat names its `site`, how many `minutesAgo` it started, an optional `title`, and its `turns`: each a `prompt` and the agent's `replies`, one message each, of text and tool calls (`{ name, args, result, isError?, details? }`; `details.diff` for an edit).
- `agentTurns`: agent runs for the `playAgentTurn` helper (below), as the `AgentEvent`s the CLI would send. A string `scene:<path>` in an event is a file from the scene's folder, copied to where Studio shows local media from.
- `files`: files for `setFiles` steps.

### Wren & Barley

The bundled scene is a small bakery-and-café site on a Twenty Twenty-Five child theme: a photo-first front page, Menu, Our story, Visit us and Order pages, three posts with featured images, and its own header, footer and journal templates; then two blank sites, Bistro Lune and Ada Portfolio. Its source is `scenes/wren-and-barley/source/`: `theme/` is the child theme (its `theme.json` holds the palette, Literata type and flat square buttons), `DESIGN.md` is the design system Studio Code would have written for it (the site preview's **Design system** view shows it), `images.json` lists the photos (all CC0, from Wikimedia Commons, with their authors) and `content/` holds the block markup, with `{{url:name}}`, `{{id:name}}` and `{{alt:name}}` placeholders for the photos. Keep `DESIGN.md` and `theme/theme.json` in step: the Design system view lists every color, font and size where they differ.

After editing the source, `npm -w @studio/capture-harness run wren-and-barley:build` rebuilds `wren-and-barley.zip` (database, uploads and the child theme; about 7 MB) in a throwaway profile. It needs the internet for the photos the first time, then keeps them in `source/.cache/`. `wren-and-barley:looks` redraws the four design boards in `design-looks/` (listed in `looks.json`) with the agent's own `renderDesignBoard`, for the design picker that `agent-turns/design-looks.json` plays.

## Scripts

```json
{
	"$schema": "../schemas/script.schema.json",
	"name": "workspace",
	"description": "The workspace and its menus",
	"signedIn": false,
	"capture": { "target": { "role": "dialog", "name": "Settings", "exact": true } },
	"shots": [
		{
			"name": "preview-destinations",
			"description": "Site preview address bar shortcuts",
			"steps": [
				{ "click": { "role": "textbox", "name": "Address" } },
				{ "waitFor": { "role": "dialog", "name": "Preview shortcuts" } }
			],
			"capture": { "target": { "role": "dialog", "name": "Preview shortcuts" } },
			"annotate": [ { "outline": { "role": "dialog", "name": "Preview shortcuts" } } ],
			"after": [ { "press": "Escape" } ]
		}
	]
}
```

Each script launches Studio afresh, so its shots stand on their own; its shots run in order, each from where the last one's `after` left the window. A script says how Studio opens:

- `firstRun`: an empty profile, on the Welcome dialog.
- `signedIn`: signed in to WordPress.com (see below). With `previewSites` or `connectedSites`, the scene's made-up preview sites or connected sites.
- `chats`: conversations from the scene to open on.

**Locators** find elements by accessible role and name wherever possible: `{ "role": "button", "name": "Add site", "exact": true, "first": true }`, `{ "role": "alertdialog", "pattern": "^Overwrite" }`, `{ "text": "Add files" }`, `{ "css": "input[type=file]" }` (also sees what an open modal hides from role queries), `{ "role": "dialog", "has": { … } }`, `{ "within": { … }, "role": "switch", "name": "Xdebug" }`, and `{ "role": "menu", "all": true }` (every match, for a crop). Strings may use `{{site.name}}` and, signed in, `{{account.name}}`. `inspect` prints the roles and names on screen.

**Steps**, each keyed by its verb: `waitFor` (with `hidden`, `timeout`, `optional`), `click` (`button`), `hover`, `fill` (`value`, `blur`), `press`, `toggle` (a switch by name or locator, `on`), `scrollTo` (`offset`: near the top of its scroll area, clear of sticky headers), `waitForImages`, `setFiles` (`file` from the scene's `files`), `wait` (ms), and `helper` with `args`:

| Helper | Does |
| --- | --- |
| `openAddSite` | Opens Add site unless Studio already did |
| `openSiteMenu`, `openSubmenu(trigger, item)`, `closeMenus` | The site menu and its submenus |
| `clickInPreview(selector)`, `typeText(text)` | Click inside the site preview's `<webview>`, which locators can't reach, and type into whatever has focus |
| `dragSeparator(name, dx)` | Drags a resize handle, such as "Resize site preview" |
| `discardAnnotations`, `discardSettings` | Leave annotation mode or unsaved settings without saving |
| `stubAgentRuns`, `playAgentTurn(name)` | Stand in for Studio Code: sending a prompt answers with a made-up run, and `playAgentTurn` plays `agentTurns/<name>.json` to the real renderer. No model runs and no credits are used |

**Capture** (a script's `capture` is the default for its shots): `target` crops to a locator, or frames a list of them together (a menu and the button that opened it); without one the whole window is kept. `pad` is the margin (the look's `crop.pad`, 48 in docs, or `[x, y]`), `aspect` the least width-to-height ratio (the look's `crop.aspect`, 1.5 in docs, since a tall crop sits badly on a page), `settle` the wait before capturing (ms), `keepMouse` leaves the pointer and focus where they are. Before every capture, toasts are dismissed, the pointer parked, the preview scrolled to its top, and paths inside the throwaway profile rewritten to `/Users/username`.

**Annotations**: `outline`, `badge` (numbered in order) and `arrow` (with `from`, such as `top-right`), drawn over the real UI in the look's accent color. A shot with annotations is saved twice, `<name>` and `<name>-annotated`, so the plain image can be reused elsewhere.

`pages`, `replaces` and `meta` are passed through to the JSON results for the consumer (the docs index uses `pages` and `replaces`). A script with `"manual": true` lists shots captured by hand, by description only. A shot with `"desktopOnly": true` shows something only Studio Desktop has (the CLI installer in Settings, say): the browser driver skips it.

## Looks

A look sets how Studio is shown and what is made of each still. Every field has a default (the docs look's), so a look only says what it changes:

- `window` (`{ width, height }`, points) and `scale` (device scale factor, 2): the capture is `width × scale` pixels wide whatever the display.
- `appearance`: Studio's `colorScheme` (`light`, `dark`, `system`), `accentColor`, `tintIntensity` and `contrast`.
- `windowControls`: draws the macOS close, minimize and zoom buttons, which macOS draws outside what Electron captures.
- `annotations` (`accent`, `halo`) and `crop` (`pad`, `aspect`).
- `still`: `webp` (lossless when that is smaller, as plain UI is, else at `quality`, which at 90 keeps 2× text sharp at a fifth of the size) or `png`.
- `frame`: puts each still on a `background` (a color or a two-color diagonal gradient) with a `padding`, rounded corners (`radius`), a `shadow` with `blur`, and a `hairline`; sizes are shares of the image's width, so small crops and full windows look alike. `outputs` then fit the framed still into fixed canvases, each saved as `<name>-<suffix>` (a 1200×630 card, a square…); without outputs it is `<name>-framed`. `keepRaw: false` drops the unframed still.
- `video`: `formats` (`webp` and `gif` need nothing else; `webm` and `mp4` need ffmpeg: `FFMPEG_PATH`, one on `PATH`, or for WebM the one Playwright downloads), `fps`, output `width` in pixels, `hold` (ms on the last frame), `cursor` (a drawn pointer that glides to what is clicked) and `typingDelay`.

`frame --look <look> <image>…` frames existing images (into `./framed`, or `--out`), for a blog post's images: the `blog` look is the light gray frame the announcement posts use.

## Outputs

- **Stills**, `<name>[-annotated][-<variant>].webp`. A file is rewritten only when its pixels change beyond anti-aliasing noise (pixelmatch's threshold), so unchanged shots leave git clean.
- **Video**, `record`: each selected shot's steps play at a watchable pace (the pointer glides to each target, text is typed out, a pause after each step) and are recorded from Electron's own capture, then the last frame holds with the shot's annotations drawn. Earlier shots' steps run at full speed, unrecorded, to reach the start.
- **Visual check**, `check` (or `capture --check`): every shot is captured and compared with the file in `--out`, which is left alone (a failed shot's picture still goes to `<out>/failures/`). Each file is `new`, `changed` (with `diffPixels`, and a picture of the differences in `--diff-dir`) or `unchanged`; the exit code is 1 if any is new or changed.
- **Results**, `--json`: the mode, Studio version, scripts (scene, look, signed in), and per shot its status (`ok`, `failed`, or `skipped` for a desktop-only shot in the browser), files (`file`, `status`, `diffPixels`, `diff`), videos, error and failure picture, plus `pages`, `replaces` and `meta`; and a summary. Manual shots are listed under `manual`.

### Getting the images out

The harness writes to `--out` on the machine it runs on and uploads nothing. On a cloud machine that is thrown away after the session, move the images off it before it ends:

- **Images that live in the repo**, such as the docs images: capture into their folder (`--out docs/user/screenshots/images`), then commit and push them on a branch. A file is rewritten only when its pixels change, so the diff holds just the shots that moved.
- **Images for someone in a chat**, such as marketing stills or a recording: an agent sends the files from `--out` to the person, with its tool for sending files where it has one, or captures into the repo and pushes a branch where it doesn't.
- **Scheduled and CI runs**: upload `--out` and the `--json` results (`results.json`) as the job's artifacts (see **Running it as a job**).

`--out` outside the repo, such as `/tmp/captures`, keeps throwaway captures out of `git status`.

## Signed in

Signed-in scripts use `STUDIO_CAPTURE_AUTH_TOKEN` (the `authToken` object of a Studio `shared.json`, as JSON; `STUDIO_DOCS_AUTH_TOKEN` also works), else the login of the Studio on this machine. **Bots and CI use a dedicated demo account's token in that variable, never a person's login**: with `CI` set, the harness refuses to fall back to the local one. Only the throwaway profile gets a copy of the token.

Every signed-in launch is guarded, whatever script runs: logging out (which would revoke the token), publishing, pulling, connecting sites, changing preview sites and starting an agent run throw instead (`BLOCKED_SIGNED_IN_HANDLERS` in `src/guard.ts`), and the window's requests to WordPress.com other than reads are aborted. The account's email is replaced by `you@example.com` on screen before every capture (and kept replaced while recording), and a shot fails rather than save if it reappears. The name and avatar are the account's own, so review those shots before publishing them.

## For agents

The loop is: open the scene and read the screen, write a step, validate, capture, read the results.

1. `studio-capture inspect --scene <scene>` (or `--blueprint`, `--first-run`, `--signed-in`) prints the window's accessibility tree: each line a role and accessible name, which is what a locator matches. `--script <file> --until <shot>` first runs a script up to that shot; `--steps '[{"click": …}]'` runs more; `--within '<locator>'` prints part of the tree; `--screenshot <file.png>` saves what the window shows.
2. Write the script with the `$schema` line, so the steps, locators and fields are checked as you write.
3. `studio-capture validate <files>` checks the schema and what a schema can't: that the scene has the chats, agent turns and files the script uses, and that its placeholders exist.
4. `studio-capture capture … --json` and read the results: a failed shot names the step's error and saves the window to `failure`.

`SKILL.md` is this loop as an agent skill.

## Running it as a job

Any agent that can run commands can run the harness where it is (see **In the cloud**). For the official docs images, a follow-up is a Buildkite step on a pinned macOS agent that runs `capture --json` with the demo account's token as a secret and uploads the images and `results.json` as artifacts, so who triggers a run doesn't change the pixels. `results.json` records the Studio version each run captured.

## Sharing with `apps/studio/e2e`

The e2e tests set up the same isolated profile as `createProfile` (`E2ESession` in `apps/studio/e2e/e2e-helpers.ts`: the `E2E_*` paths, a per-session daemon directory, a fixed locale and the onboarding flags), and seed their own sites through the UI. They could share the harness's layer instead of keeping a copy: `createProfile` for the environment, `seedSites` to start tests on a scene (an imported backup is faster than creating sites through the UI, and a Blueprint scene can stand in for the `fixtures/blueprints`), and `guardSignedIn` for any test that signs in. The e2e suite would keep Playwright Test and its page objects; only the setup would move. Not migrated yet.
