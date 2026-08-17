# Studio marketing screenshot runner

This tool captures deterministic screenshots from the marketing-only Agentic UI build. It serves
`apps/ui/dist-marketing` on a loopback-only dynamic port, launches Chromium, and creates a fresh
browser context for every scenario, theme, and preset combination.

The top-level command builds the marketing target and then captures it:

```sh
npm run screenshots:marketing
```

For iteration against an existing `apps/ui/dist-marketing` build, skip rebuilding with:

```sh
npm run screenshots:marketing:capture
```

The default run captures `add-site` and `site-overview`, in light and dark themes, with the `smoke`
preset. Larger targeted exports are selected with repeatable or comma-separated filters:

```sh
npm run screenshots:marketing -- \
	--scenario agent-complete-preview \
	--theme light,dark \
	--preset raw-wide-2x,store-4k \
	--preview-width-ratio 0.6 \
	--sidebar-width 320 \
	--output artifacts/marketing-screenshots/review
```

Conversation scenarios can be exported at both the wide 1440 × 900 logical viewport and a compact
900 × 600 desktop viewport in the same run. Both raw presets capture at 2× resolution:

```sh
npm run screenshots:marketing -- \
	--scenario agent-new-session,agent-working-preview,agent-complete-preview,agent-long-conversation \
	--theme light,dark \
	--preset raw-wide-2x,raw-compact-2x \
	--output artifacts/marketing-screenshots/conversations
```

Run `npm run screenshots:marketing -- --list` to see all accepted values and `--help` for the full
CLI. When `--output` is omitted, results are written to
`artifacts/marketing-screenshots/<commit>/`.

## Panel layout overrides

Scenarios own their default panel layout. A capture run can selectively override any part of that
layout without changing the fixture:

| Flag                        | Accepted values             | URL parameter       |
| --------------------------- | --------------------------- | ------------------- |
| `--preview-width-ratio <n>` | `0.2` through `0.8`         | `previewWidthRatio` |
| `--sidebar-width <px>`      | Integer `240` through `600` | `sidebarWidth`      |
| `--preview <state>`         | `open` or `closed`          | `preview`           |
| `--sidebar <state>`         | `expanded` or `collapsed`   | `sidebar`           |

Flags are optional and independent. When none are present, the runner sends no panel-layout query
parameters, preserving the scenario defaults. The manifest stores both the requested overrides and
the effective post-layout values reported by the UI, including panel states and logical-pixel
widths. This makes clamping visible—for example, a requested sidebar width may resolve narrower in a
small viewport.

## Composer and conversation presentation

The runner can prepare a marketing state after the scenario reports ready and before it captures.
These controls use the Agentic UI's semantic DOM attributes, not pointer coordinates:

| Flag                                  | Accepted values                                             |
| ------------------------------------- | ----------------------------------------------------------- |
| `--composer-text <text>`              | Any quoted draft text                                       |
| `--composer-focus <state>`            | `focused` or `blurred`                                      |
| `--conversation-anchor <anchor>`      | `start`, `end`, `first-message`, `last-message`, or `message:<text>` |
| `--conversation-align <alignment>`    | `start`, `center`, `end`, or `nearest` for message anchors  |
| `--conversation-occurrence <n>`       | `first` or `last` for a `message:<text>` anchor             |

For example, this captures a focused custom draft without changing the scenario fixture:

```sh
npm run screenshots:marketing -- \
	--scenario agent-new-session \
	--composer-text "Design a welcoming homepage for this coffee shop." \
	--composer-focus focused
```

And this positions a matching conversation message at the start of the visible transcript area:

```sh
npm run screenshots:marketing -- \
	--scenario agent-complete-preview \
	--conversation-anchor "message:ready to review" \
	--conversation-align start \
	--conversation-occurrence last
```

`message:<text>` is a case-sensitive substring match against `data-message-text`. The runner finds
the message's scrollable ancestor and accounts for its computed top and bottom padding, including
the overlaid header and composer; it does not depend on CSS-module class names or fixed offsets.
The scenario catalog supplies the normal framing defaults: `agent-new-session` uses the approved
focused draft, while `agent-working-preview`, `agent-complete-preview`, and
`agent-long-conversation` are pinned to the end of their conversations. Scenario-specific semantic
interactions also open the selective pull dialog and switch the responsive preview to its
full-screen Desktop + Mobile mode. Explicit CLI values override the composer and conversation
defaults. Requested and effective values, including completed interactions, the matched message,
and resulting scroll metrics, are stored in `manifest.json`.

## UI readiness contract

The marketing entry receives `scenario` and `theme` URL parameters. It must not report ready until
the requested route, fonts, images, frames, and deterministic scenario data have settled. It then
sets both of these signals:

```ts
document.documentElement.dataset.marketingScreenshotReady = 'true';
window.__STUDIO_MARKETING_SCREENSHOT_READY__ = true;
```

The DOM attribute is the primary contract; the window property is a diagnostic fallback. The runner
also waits for document fonts and images, disables motion, blocks all non-loopback network access,
and fails on console errors, page errors, failed requests, missing images, readiness timeouts, or
incorrect PNG dimensions.

Before navigation, the runner freezes `Date.now()`, `new Date()`, and `Date()` at
`2026-08-11T12:00:00.000Z` and replaces `Math.random()` with a seeded generator; argument-based
dates plus `Date.parse()` and `Date.UTC()` retain their native behavior. The browser timezone is
fixed to UTC. The manifest records the clock, random seed, locale, timezone, and reduced-motion
setting.

Each run produces exact-dimension PNGs, `manifest.json`, and a standalone `contact-sheet.html`.
Manifest entries label these outputs as synthetic, simulated browser renderer captures so they are
not mistaken for genuine native operating-system windows.

## Native preview and annotation captures

Use the isolated Electron runner when the screenshot needs the real `<webview>` preview surface,
WordPress and Database tabs, or preview annotations:

```sh
npm run screenshots:marketing:native -- \
	--theme light \
	--preset raw-wide-2x \
	--output artifacts/marketing-screenshots/native-annotation-review
```

This produces the complete annotation sequence—`annotation-ready.png`, `annotation-picking.png`,
`annotation-draft.png`, `annotation-saved.png`, and `annotation-submitted.png`—plus
`wordpress-tab.png`, `database-tab.png`, `manifest.json`, and `contact-sheet.html`. The command
builds the current CLI and marketing UI, provisions a temporary real WordPress site through the
Studio CLI, installs the Meridian Marketing block theme, and launches a capture-only BrowserWindow
at the preset's exact logical size.

For fast iteration after both builds are current, use:

```sh
npm run screenshots:marketing:native:capture -- \
	--theme dark \
	--preset raw-wide-2x \
	--output artifacts/marketing-screenshots/native-annotation-dark
```

`--site-url http://localhost:<port>` is an escape hatch for an already-running isolated Studio site.
Never point it at a personal site or use it for a publishable master without first confirming the
site is disposable and standardized.

The native examples use **Fit pane**. The runner verifies that the guest page's CSS viewport exactly
matches the preview panel's content box before it captures; it does not apply device emulation,
letterboxing, zoom, or a CSS transform. It also rejects a frontend or WP Admin capture when the
document is wider than its viewport or when a major page region extends outside the viewport.

The PNG must be written with Electron's `BrowserWindow.webContents.capturePage()`. Do not replace
this with Playwright `page.screenshot()`: Electron renders `<webview>` guests on a separate
compositor surface, and a host-page screenshot can save the guest at the wrong scale or crop even
when the visible window looks correct. Playwright drives and inspects the UI; Electron captures the
fully composed window pixels.

### Non-negotiable isolation rule

Never launch the normal Studio app or an installed `Studio.app` to create marketing screenshot
masters. A normal launch reads the developer's `~/.studio` data, real site list, running site ports,
saved window bounds, and saved preview geometry. Such a capture is diagnostic-only and must not be
published or added to a contact sheet.

Native marketing captures must use `npm run screenshots:marketing:native`. That command:

- loads `main.marketing.tsx` and `createMarketingConnector()`, so the sidebar can only contain the
  standardized Meridian Coffee, Juniper Journal, Atlas Creative, Lantern Books, Northstar Yoga,
  Harbor & Pine, Fieldwork Studio, and Common Table fixtures;
- creates a real WordPress + SQLite site with the built Studio CLI, so the preview, WP Admin, login,
  database, and phpMyAdmin routes are product behavior rather than replacement HTML;
- installs only the checked-in Meridian Marketing theme under `wp-content`; it never edits
  WordPress core;
- uses fresh temporary CLI config, app-data, site, Electron user-data, and process-manager daemon
  directories, then stops the daemon and removes all temporary data after the run;
- may reuse the read-only WordPress bundle under `~/.studio/server-files` to avoid a download, but
  never reads `~/.studio/cli.json`, `~/.studio/app.json`, `~/Studio`, saved sites, or authentication;
- uses a small capture-only Electron main process rather than launching the normal Studio app;
- sets the logical window size explicitly and verifies the native display scale factor without
  overriding it (overriding Electron's scale factor causes `<webview>` guest content to render at
  the wrong viewport size); and
- asserts that the WordPress tab contains the genuine `wp-admin` DOM, the Database tab contains the
  genuine phpMyAdmin DOM, and every PNG has the selected preset's exact dimensions.

There are no static wp-admin or database fixtures. The loopback static server used for renderer
captures deliberately returns 404 for those routes. If either native tab is not the real application,
the capture command must fail.

Before sharing native output, confirm that the sidebar contains the standardized portfolio and that
the preview address belongs to Meridian Coffee. If either is untrue, stop: the wrong capture path was
used.

## Focused checks

```sh
npx eslint --fix tools/marketing-screenshots/*.ts
npx tsc -p tools/marketing-screenshots/tsconfig.json
npx vitest run --config tools/marketing-screenshots/vitest.config.ts
```
