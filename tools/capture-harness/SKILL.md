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
3. Signed-in scripts need `STUDIO_CAPTURE_AUTH_TOKEN` set to the **demo account's** token. Never copy or ask for a person's login; in CI the harness refuses one.

Pick a driver: `--driver electron` (default) is Studio Desktop, with every feature; on Linux it starts a virtual display (Xvfb) automatically. `--driver browser` is `studio ui` in headless Chromium: lighter, no display needed, no desktop-only features and no macOS window buttons. Docs images use Studio Desktop.

## The loop

1. **Look before you write.** `SC inspect --scene wren-and-barley` (or `--blueprint <file|url>`, `--first-run`, `--signed-in`) prints the window's accessibility tree. To see a later screen, add `--steps '[{"click":{"role":"button","name":"Settings","exact":true,"first":true}}]'`, or `--script <file> --until <shot>`. Use `--within '<locator>'` to print part of the tree and `--screenshot /tmp/x.png` to see it.
2. **Write locators from what inspect printed**: `{ "role": "<role>", "name": "<name>" }`, adding `exact`, `first` or `within` when several match. Prefer role and name over `text` and `css`.
3. **Start the file with `$schema`** (`tools/capture-harness/schemas/script.schema.json`, relative to it), then run `SC validate <files>`. Fix every error before capturing.
4. **Capture with `--json`**: `SC capture <script> --scene <scene> --look <look> --out <dir> --json`. Progress goes to stderr; stdout is the results. For each shot read `status`, `files[].status` and, if it failed, `error` and `failure` (a PNG of the window at that moment: look at it).
5. **Iterate** on one shot with `--only <shot>` (earlier shots' steps still run).

## Choosing inputs

- Docs images: the docs scripts in `docs/user/screenshots/shots/` on the default scene and `docs` look (`npm run screenshots` in `docs/user`). Do not change a docs image's look.
- Someone's own site: `--blueprint <file|url>`; for reruns that must match, `SC bake --blueprint <file|url> --out <dir>` and capture from the baked scene.
- Marketing or social: `--look marketing` (framed, plus a 2400×1500 hero) or `--look social` (1200×630, 1080×1080, 1600×900). `examples/workspace-tour.json` works on any scene with a site.
- Video: `SC record <script> --only <shot> --look marketing --out <dir>`. Steps play at a watchable pace with a drawn pointer. MP4 and WebM need ffmpeg; WebP and GIF don't.
- Did anything change? `SC check <scripts> --out <images dir> --diff-dir <dir> --json` leaves the images alone and exits 1 when pixels changed.

## Rules

- Scripts never log out, publish, pull, buy or start a real agent run. Signed-in launches block these, and a step that tries one fails. Use the `stubAgentRuns` and `playAgentTurn` helpers to show a conversation.
- Review signed-in shots before sharing them: the email is masked, but the account's name and avatar are real.
- Don't edit WordPress core files or the user's own Studio profile. The harness works in a throwaway profile.
