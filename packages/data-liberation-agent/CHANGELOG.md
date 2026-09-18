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

## [0.3.0] - 2026-09-17

### Added
- declare the capability vocabulary as a join contract
- measure rendered source complexity
- declare responsive content counterparts
- add bounded source assessment
- gate rendered media, type, and motion parity
- open captured dialogs from a static click
- fail when a source dialog does not open in the copy
- fail when in-page or internal nav does not resolve
- publish a liberated site to Spacefast
- liberate a site from a bare URL

### Changed
- Decide responsive collapse before viewport peeling.
- detect scroll-driven header/logo toggles
- Collapse one-document captures that only differ by hydration attributes.
- Collapse equivalent responsive captures when only runtime ids differ.
- Skip discovered routes that return HTTP 404 or 410
- Preserve mobile-only linked styles during responsive export
- Detect Lovable sites and strip the Made with Lovable badge
- wait for visible menu ancestors during capture
- preserve captured dialog root display
- Add Homeboy-managed continuous release workflow
- raise HTML document fetch ceiling above 2 MB
- Detect Wix Events ticketing as a commerce capability
- Adopt Homeboy-managed releases for version-synced manifests
- Stop concurrent PRs conflicting on the generated dist bundles
- Stop treating cleanup mutation-budget exhaustion as a capture failure
- Stop liberated copies reaching the source CDN via leftover sourcemap/canonical/provenance references
- surface Spacefast's ignored-file count instead of discarding it
- reject unparseable first arguments before the fetch layer
- Capture ARIA disclosure/accordion panels a runtime unmounts while collapsed
- Expose inspect, capture, compare and publish to embedded consumers
- preserve localized CSS backgrounds
- Strip source attribution and ads with cleanup-aware comparison
- filter sitemap page origins
- Add bounded asset source evidence
- resolve the canonical origin before filtering Wix's linked-route crawl
- don't classify store/shop category pages as products
- Recover Squarespace blog routes through bounded archive discovery
- Discover Squarespace navigation from public homepage HTML
- Verify registry-owned platform detection and adapter routing
- Remove the WordPress destination
- document intentional media control-character validation
- Preserve source JSON-LD metadata
- Hoist repeated captured styles
- Settle Wix navigation before capture
- Capture bounded Wix slideshow states
- Parse captured srcsets safely
- Preserve Wix transform media URLs
- Preserve hydrated video sources
- Preserve narrow viewport source variants
- Preserve captured CDN image formats
- Add an extensible Platform API
- Align screenshots with serialized capture state
- Peel remaining capture fixes from Studio PR 3952
- Peel remaining capture fixes from #119
- Encode whitespace in portable srcsets
- Preserve complex URLs during capture export
- Keep apostrophes in rewritten media URLs
- Land capture fixes independently of reconstruction removal
- Capture automatic dialog dismissal
- Speed up portable capture resource settling
- Bound semantic capture evidence
- Prevent root media aliases from corrupting exports
- Rescan disclosures during capture hydration
- Preserve lazy disclosure content in captures
- Keep the comma when un-pausing an animation shorthand
- Keep completion gates on restored animations
- Remove the second CLI
- Preserve bounded visual iframes in captures
- Preserve fluid geometry above mobile breakpoints
- Drive script-gated entrance animations from the scroll timeline
- Make the gate measure the whole site, and let liberation exit
- Open the comparison to contributed checks
- Make image identity survive our own localization
- Keep the Wix StripShowcase host box so the slideshow matches live geometry
- Turn Wix StripShowcase into a CSS slideshow of real images
- Give a liberated copy real same-page anchor targets
- Stop srcset placeholders from blowing the layout to 2660px
- Collapse canonical duplicate routes instead of failing export
- Drop leftover remote asset requests from a liberated copy
- Compare a liberated copy to its source at unsampled widths
- Register publish targets through a public API
- Move platform CDN knowledge behind the adapter seam
- Learn how a source sizes itself instead of freezing one width
- Make the stated contract the liberated HTML site
- decouple core from MCP
- Remove stub commands that shadow skills
- Add portable website artifact handoff
- Sync standalone DLA with the Studio implementation
- adopt @automattic/blocks-engine as reconstruct core
- resolve conflicts

### Fixed
- keep unavailable capture resources observable instead of silently blank
- wait for DOM to quiesce before snapshotting deferred SPA content
- preserve CSSOM and constructed stylesheet styles in captures
- preserve encoded capture route paths
- keep an in-flow empty footer landmark in the website export
- settle scroll-reactive chrome before the freeze
- read pager slideshow states before layout measurement
- collect every state a thumbnail picker advertises
- run recovered entrance animations in the frozen document
- omit empty @font-face src sentinels so woff/ttf can load
- collect Wix slideshows on the DOM that is about to be frozen
- hydrate Wix slideshows into view before collecting states
- strip orphaned #id CSS rules when source cleanup removes an element
- collect Wix slideshow states in every viewport
- do not treat viewport-only iframes as a second document
- preserve localized media in captured stylesheets
- avoid polynomial evidence slug regex
- avoid navigating during disclosure expansion
- wait for Wix slideshow transitions before capturing states
- serialize observed Wix slideshow states even when nav over-declares them
- collapse equivalent responsive variants, keep structural ones
- keep disclosure hydration from losing the last panel's content
- name routes that never produced HTML instead of dropping them
- keep stylesheets shared by both viewports applying at every width
- Fix Wix anchor intent capture
- attribute host-injected surfaces to the host
- resolve relative canonical metadata
- discover rendered navigation routes
- Fix SPA route discovery from rendered navigation
- recover orphaned artifacts when resuming
- allow only safe navigation URL schemes
- capture every ARIA popup trigger, not only dialogs
- shard semantic evidence artifacts
- export destination-neutral capture sidecars
- recover malformed scoped CSS
- preserve source JSON-LD as standard inert HTML
- capture mobile pages as iPhone 17
- Fix dismissal for portable captured dialogs
- preserve static capture layout
- rewrite captured dialog route links
- reveal captured dialog roots
- default fluid learning on
- cook data-liberation-agent
- keep mobile CSS when responsive bodies match
- adopt blocks-engine 0.2.2 with structured strategy on the blocks path
- Fix npm ci command

## [0.2.2] - 2026-06-19

### Fixed

- Local-site conversion preserved nested styling, classless spans, list-item
  classes, and loose body-level siblings of `<main>` that were previously
  dropped during the block conversion.

## [0.2.1] - 2026-06-19

### Added

- Local-site conversion carries HTML `<img>`/SVG assets into the theme and
  hardens carried inline `<script>`/`<style>` handling.
