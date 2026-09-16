# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Releases are cut with [Homeboy](https://github.com/Automattic/homeboy),
configured in `homeboy.json`: it is the single source of truth for which
files carry a `version` field (`package.json`, `.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`, `gemini-extension.json`), bumps all of them
atomically from one release operation, generates this file's entries from
merged PRs, and its `post:release` hook regenerates the committed `dist/`
MCP bundles so a release can never ship manifests and bundles that disagree.

Homeboy does not backfill history: the `0.2.1` and `0.2.2` entries below
predate Homeboy adoption and were written by hand from their tag messages.
Everything from the next release onward is Homeboy-generated.

## [Unreleased]

## [0.2.2] - 2026-06-19

### Fixed

- Local-site conversion preserved nested styling, classless spans, list-item
  classes, and loose body-level siblings of `<main>` that were previously
  dropped during the block conversion.

## [0.2.1] - 2026-06-19

### Added

- Local-site conversion carries HTML `<img>`/SVG assets into the theme and
  hardens carried inline `<script>`/`<style>` handling.
