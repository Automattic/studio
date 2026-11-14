---
name: studio-capture
description: Capture screenshots or videos of the WordPress Studio app (docs images, marketing stills, social cards, screen recordings) with the capture harness in tools/capture-harness. Use when asked to take, update, check or record pictures of Studio's UI, or to capture a site made from a Blueprint inside Studio.
---

# Capturing Studio with the capture harness

A capture is a **scene** (the sites and account data Studio opens on), a **script** (the shots: steps, crop, annotations) and a **look** (window, color scheme, frame, output sizes). Full reference: `tools/capture-harness/README.md`.

Run from the repo root. `SC` below means `npx studio-capture` (or `node --experimental-strip-types tools/capture-harness/cli.ts`).

## Before the first capture

1. On a fresh clone (or a cloud sandbox), `node --experimental-strip-types tools/capture-harness/cli.ts setup` installs and builds everything. Add `--driver browser` to skip Studio Desktop.
2. `SC doctor` says what is still missing and how to fix it.
3. Signed-in scripts need no account: they sign in as a made-up demo person (`--persona <name>`: `maya-okafor`, `daniel-ferreira`, `amira-haddad`, `owen-mercer`, `hana-watanabe`, `marcus-bennett`). Never copy or ask for a person's login.

Pick a driver, or take the default: the browser driver on Linux (a cloud machine, CI), Studio Desktop on macOS and Windows. `--driver browser` is `studio ui` in headless Chromium: lighter, no display needed, the same screens, without desktop-only features (those shots are skipped). `--driver electron` is Studio Desktop, with every feature; on Linux it starts a virtual display (Xvfb) automatically. The official docs images come from the browser driver on Linux.

## The loop

1. **Look before you write.** `SC inspect --scene moire` (or `--blueprint <file|url>`, `--first-run`, `--signed-in`) prints the window's accessibility tree. To see a later screen, add `--steps '[{"click":{"role":"button","name":"Settings","exact":true,"first":true}}]'`, or `--script <file> --until <shot>`. Use `--within '<locator>'` to print part of the tree and `--screenshot /tmp/x.png` to see it.
2. **Write locators from what inspect printed**: `{ "role": "<role>", "name": "<name>" }`, adding `exact`, `first` or `within` when several match. Prefer role and name over `text` and `css`.
3. **Start the file with `$schema`** (`tools/capture-harness/schemas/script.schema.json`, relative to it), then run `SC validate <files>`. Fix every error before capturing.
4. **Capture with `--json`**: `SC capture <script> --scene <scene> --look <look> --out <dir> --json`. Progress goes to stderr; stdout is the results. For each shot read `status`, `files[].status` and, if it failed, `error` and `failure` (a PNG of the window at that moment: look at it).
5. **Iterate** on one shot with `--only <shot>` (earlier shots' steps still run).

## Choosing inputs

- Docs images: the docs scripts in `docs/user/screenshots/shots/` on the `moire` scene and `docs` look (`npm run screenshots` in `docs/user`, which bakes Moire on a machine's first run). The docs look frames whole-window shots on the light dot field and leaves crops plain (`frame.mode: "window"`). Do not change a docs image's look.
- Someone's own site: `--blueprint <file|url>`; for reruns that must match, `SC bake --blueprint <file|url> --out <dir>` and capture from the baked scene.
- The demo scene, and the default: `moire` (Rich's slow-fashion journal Blueprint). Bake it once per machine (`SC bake --scene moire`, into its `.baked/`, used automatically after); without a bake, every capture builds the site from the Blueprint first. `examples/moire.json` and `examples/moire-design-looks.json` are its main set; scripts written for one scene's content (Annotate targets, chat titles) need adapting for another.
- Marketing or social: `--look marketing` (framed on Studio's dot field at full resolution, keeping the window's proportions) or `--look social` (1200×630, 1080×1080, 1600×900); `marketing-dark` and `social-dark` for the dark app on the dark dot field. `examples/workspace-tour.json` works on any scene with a site. Framing follows the crop: a whole window is centred, a crop at a corner or along one edge of the window runs off the image on its cut sides, and a crop cut on opposite sides (a dialog on its own) gets no frame unless the shot sets `capture.frame: "always"`. For a framed menu or panel, crop it from the window's corner rather than on its own: `capture.reach` (`["left", "bottom"]`) runs the crop from the `target` out to those window edges, so the real corner shows with a margin and the cut sides run off.

## Asking what the person wants

When the request doesn't say how the images will be used, ask once before capturing, and offer the choices rather than an open question:

1. **Where they go**: the docs (`docs`), a blog post (`blog`), a landing page or launch (`marketing`), social posts (`social`), or just plain stills (`plain`).
2. **Light or dark** (default light): the app's scheme picks the `-dark` look where there is one; the background can differ (`--background dots-dark` puts the light app on dark dots).
3. **Framed or plain**: framed looks save the plain still too (`keepRaw`), so this rarely needs asking; mention it.

Say they can give their own instructions instead (a size, more padding, no shadow, another background). Then write a look file for this request next to the output (copy the closest bundled look, change only what they asked, keep the `$schema` line, `SC validate` it) and pass it as `--look <file>`. Don't edit the bundled looks for one request: they are the shared design language, and the docs and every agent use them.
- Video: `SC record <script> --only <shot> --look marketing --out <dir>`. Steps play at a watchable pace with a drawn pointer. MP4 and WebM need ffmpeg; WebP and GIF don't.
- Did anything change? `SC check <scripts> --out <images dir> --diff-dir <dir> --json` leaves the images alone and exits 1 when pixels changed.

## Review every image

Look at each image yourself before handing it over (a downscaled copy is enough), and fix the script rather than ship one that fails any of these:

1. **No chat cut off at the top.** The chat panel holds about two short exchanges; in a longer conversation the first message starts above the panel and leaves a sliver of its bubble. Shorten the chat (shorter prompts, fewer turns, the closing question folded into the last reply) rather than scroll it.
2. **Crop the real UI, never cut an element out of its background.** Near a corner or edge of the window, use `capture.reach`. From the middle of the screen, keep about 48 points of the app around the crop: a crop tight to a rounded element leaves stray pixels in its corners.
3. **Keep a wide crop wide.** A fixed square output cuts the sides off a wide crop; use the natural size, or a crop that is square to begin with.
4. **Annotate shots go last** in a script: Annotate leaves its hover outline in the preview for every shot after it.
5. **A lived-in sidebar, an empty chat when the shot needs one.** Give the scene several chats; for a shot of an empty chat or a menu over the composer, start a new chat after they load (`openSiteMenu`, then **New chat**).
6. **The chat matches the preview and claims nothing it didn't do.** Whatever the agent says it changed must be what the preview shows, and it never takes credit for the design of someone else's theme: plain text and menu edits are safest.
7. **Default appearance**, unless the shot is about appearance: no accent color, intensity or contrast changes elsewhere.
8. **The app's scheme matches the background**: the dark app on dark dots, the light app on light dots, unless asked otherwise.
9. **Nothing broken on screen**: no error messages, empty or loading previews, spinners or stray tooltips. A shot that succeeded can still show one.

## Rules

- Scripts never log out, publish, pull, buy or start a real agent run. Signed-in launches block these, and a step that tries one fails. Use the `stubAgentRuns` and `playAgentTurn` helpers to show a conversation.
- Signed-in shots show a demo person's name and avatar. With a real account (`STUDIO_CAPTURE_AUTH_TOKEN`), review them before sharing: its email is masked, but its name and avatar are real.
- Don't edit WordPress core files or the user's own Studio profile. The harness works in a throwaway profile.
- Hand the images over before you finish: the harness uploads nothing, and a cloud machine is thrown away. Send the files from `--out` to the person, or commit them on a branch when they belong in the repo (see **Getting the images out** in the README).
