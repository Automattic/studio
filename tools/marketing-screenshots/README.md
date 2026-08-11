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

## Focused checks

```sh
npx eslint --fix tools/marketing-screenshots/*.ts
npx tsc -p tools/marketing-screenshots/tsconfig.json
npx vitest run --config tools/marketing-screenshots/vitest.config.ts
```
