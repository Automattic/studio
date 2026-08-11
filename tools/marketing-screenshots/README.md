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
	--output artifacts/marketing-screenshots/review
```

Run `npm run screenshots:marketing -- --list` to see all accepted values and `--help` for the full
CLI. When `--output` is omitted, results are written to
`artifacts/marketing-screenshots/<commit>/`.

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
`2026-08-11T12:00:00.000Z`; argument-based dates plus `Date.parse()` and `Date.UTC()` retain their
native behavior. The browser timezone is fixed to UTC. The manifest records the clock, locale,
timezone, and reduced-motion setting.

Each run produces exact-dimension PNGs, `manifest.json`, and a standalone `contact-sheet.html`.
Manifest entries label these outputs as synthetic, simulated browser renderer captures so they are
not mistaken for genuine native operating-system windows.

## Focused checks

```sh
npx eslint --fix tools/marketing-screenshots/*.ts
npx tsc -p tools/marketing-screenshots/tsconfig.json
npx vitest run --config tools/marketing-screenshots/vitest.config.ts
```
