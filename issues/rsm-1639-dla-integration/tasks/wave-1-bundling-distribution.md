---
id: wave-1-bundling-distribution
wave: 1
title: Studio CLI bundling & distribution constraints for adding DLA
---

# Goal

Map exactly what it takes to *ship* a DLA-powered `/migrate` to users. The synthesizer needs to know cost (binary size, install time, native deps), constraints (Node version, npm-publish layout, Electron resource layout), and feasibility of each delivery mechanism — bundle vendored, depend via npm, install at runtime, fetch on demand.

Scope is `apps/cli/`. The Electron desktop app (`apps/studio/`) is out of scope, but the CLI ships *both* as a standalone npm package (`wp-studio`) and bundled inside the desktop app's resources. Any constraint imposed by the desktop bundling that the CLI must respect should be flagged but not "fixed."

# Questions to answer

## Today's CLI build

1. What are the three Vite configs (`vite.config.dev.ts`, `vite.config.prod.ts`, `vite.config.npm.ts`) doing differently? Which one ships in npm `wp-studio`, which one ships inside the Electron app?
2. What's currently copied via `vite-plugin-static-copy`? List the source globs and destination paths. Does `apps/cli/ai/plugin/` get copied as-is, or are individual `SKILL.md` files copied?
3. What's the final layout under `apps/cli/dist/cli/` after a prod build (rough tree to two levels)? Approximate size, file count.
4. What does `apps/cli/package.json`'s `files` field publish to npm? What does `install:bundle` (the `--install-links` flag) do, and why? What does `postinstall-npm.mjs` do?
5. How does the Electron app pick up the built CLI? (Quick check of `apps/studio/electron.vite.config.ts` and `apps/studio/forge.config.ts` — just the path.) ASAR vs unpacked?

## Adding a dependency

6. What's the dependency policy looking at the existing `dependencies` list (Playwright, php-wasm, archiver — sizable already)? Are there any examples of a recent PR that added a dependency to `apps/cli/package.json`, and what did the size delta look like?
7. Does the CLI have a max install size or "must work offline" requirement? (Look at `README.md`, `docs/design-docs/cli.md`, and any size budgets in the repo.)
8. Can the CLI shell out to a runtime-installed Node binary (npx, npm exec) at user time? Are there precedents? What network/firewall assumptions do users have?

## Vendoring vs npm vs runtime install

9. For each of these three delivery models, what does it cost?
   - **Vendor**: copy DLA's compiled `dist/` (or its source) into `apps/cli/ai/plugin/dla/` at build time (manual sync or git submodule or npm tarball expansion in CI).
   - **npm dependency**: add `@automattic/data-liberation-agent` (or whatever the package name is) to `apps/cli/package.json` and let `install:bundle` pull it.
   - **Runtime install / fetch**: on first `/migrate`, `npm install` it into a user-data dir, or download a tarball, then load it lazily.

   For each, walk through (a) install impact, (b) update story, (c) version pinning, (d) offline behavior, (e) what breaks if DLA is mid-migration when CLI is reinstalled.

## Auth & secrets

10. Studio Code already brokers an Anthropic API key (`config.anthropicApiKey`) and a WordPress.com OAuth token (`readAuthToken`). If DLA needs an Anthropic API key, can we hand off Studio's? Same question for a WPCOM token. Where in the CLI is the cleanest hook to forward these as env vars to a child plugin/server?
11. Does anything in Studio Code's session-recording layer (`apps/cli/ai/sessions/`) need to know about a third-party plugin's tools so that resumed sessions replay correctly? (Skim only — flag, don't solve.)

## Update / staleness

12. CLI shipping cadence: how often does `wp-studio` cut npm releases? How often does the Electron app cut releases? (Look at recent commits, `apps/cli/package.json` version vs git history.) If DLA evolves fast, what does "stale DLA bundled inside Studio Code" look like for users — a week behind? A month?
13. What's the existing update-notifier (`setupUpdateNotifier` in `apps/cli/index.ts`) — does it cover plugin/skill updates or only the CLI itself?

# Suggested approach

- Read all three Vite configs, then `vite.config.base.ts`. Search for `staticCopy`/`viteStaticCopy`.
- `npm run cli:build` and inspect `apps/cli/dist/cli/` (dir listing, total size). The user has run builds before; just `du -sh` and `ls -la` are enough.
- Read `apps/cli/scripts/postinstall-npm.mjs` and `apps/cli/scripts/` generally.
- Read `docs/design-docs/cli.md` for the design-of-record on packaging.
- `git log --oneline --stat apps/cli/package.json | head -40` to see dependency changes.
- For (10), trace `prepareAiProvider` / `resolveAiEnvironment` / `readAuthToken` and note where env is shaped before `query()` is called — that's the natural injection point.

# Deliverable

A markdown report as your final message containing:

1. **Build pipeline** — three Vite configs, what each produces, what gets copied, current `dist/` size and shape.
2. **`apps/cli/ai/plugin/` bundling** — exact globs and rules; whether new files are picked up automatically.
3. **Delivery-model matrix** — vendor / npm dep / runtime install, scored on install size, update story, offline behavior, version pinning, complexity.
4. **Auth handoff** — cleanest place(s) to forward Anthropic & WPCOM credentials to a DLA-side process or plugin.
5. **Cadence + staleness** — how badly a bundled DLA goes stale between Studio releases.
6. **Anything Electron-side flagged** (no fixes proposed).

# Out of scope

- DLA repo internals (handled by `wave-1-dla-inventory`).
- SDK-level plugin/MCP semantics (handled by `wave-1-claude-plugin-mechanics`).
- Recommending a delivery model — synthesis will pick once all four wave-1 reports land.

