# AGENTS.md — Instructions for AI Agents

## Overview

`data-liberation-agent` copies a website into a complete, portable HTML site. HTML is the contract: the liberated directory is the deliverable, and it runs on its own without this tool, a browser runtime, or any destination platform.

The product is three verbs, and everything else exists to serve them:

```
data-liberation <url>                 liberate
data-liberation compare <run-dir>     verify
data-liberation publish <run-dir>     publish
```

Three entry points share the same code: the CLI (`src/cli.ts`), the MCP server (`src/mcp-server.ts`), and the `liberate` skill, which drives the CLI. MCP exposes the same three verbs and calls the same functions — it is a transport, not the architecture. Adding pipeline phases to it recreates a surface that has to be maintained against every refactor and invites callers to reimplement the CLI.

## Pipeline

```
url → detect platform → discover routes → capture each route in a browser
    → learn how the source reflows → export → localize → self-contain → website/
```

- `src/lib/capture.ts` — orchestrates a run.
- `src/lib/screenshot/` — the browser work: rendering, settling, DOM capture, CSS aggregation, interaction capture, fluid learning.
- `src/lib/capture-export.ts` — turns captured routes into the portable `website/` tree: route paths, link rewriting, media localization, desktop/mobile document merging, diagnostics.
- `src/lib/self-contain.ts` — strips anything that would still reach the network.
- `src/lib/fidelity/` — the gate. See below.
- `src/lib/publish/` — the destination boundary.

## Adapters

An adapter contributes platform knowledge to discovery and capture. It never owns a destination.

```ts
interface PlatformAdapter {
  id: string;
  detect(url: string): boolean;
  discover(url: string, opts): Promise<unknown>;
  probe?(url, urls, opts): Promise<unknown[]>;
  capture?: AdapterCapture;
}
```

`AdapterCapture` (`src/adapters/page-actions.ts`) is the seam for behaviour that only a platform can know:

- `removeSelectors` — chrome removed from the live page before anything is captured, so one removal cleans every artifact.
- `prepare(page, ctx)` — imperative escape hatch, run after removals. Wix uses it to resolve same-page anchors, which its click runtime handles rather than authored targets: the page is observed settling, and a real target is left behind so the copy can scroll there once the runtime is gone.
- `responsiveImages(page, ctx)` — the per-viewport image variants a platform's runtime swapped in, as `{media id → url}`. The browser step stays generic and reads what the runtime settled on; recognising which URLs are that platform's CDN is adapter knowledge, and lives where it can be unit-tested.

All three are best-effort: a throw is swallowed and capture continues.

**Keep destination knowledge out of the adapter interface.** The barrel exports whole adapter objects, so anything declared on `PlatformAdapter` is statically wired to every platform. That is how WXR extraction, WooCommerce CSV, and WordPress block policy previously ended up on the liberation critical path.

To add a platform: create `src/adapters/<platform>/` with an `index.ts` that assembles `detect` + `discover` from focused siblings, register it in `src/adapters/index.ts`, and add it to the README table.

## The fidelity gate

`compare` is what makes the one-for-one claim defensible, and it runs in two tiers because they answer different questions at wildly different cost.

- **Self-consistency** (`src/lib/fidelity/self-consistency.ts`) — every route, offline, milliseconds. Anchors resolving to exactly one target, internal links landing on a real file, no asset still pointing at the origin. Links resolve through the same resolver the preview server uses, so a dangling link it reports is one a reader would hit.
- **Source fidelity** (`src/lib/fidelity/check.ts`) — a sample, in a browser, ~25s per route. Text, geometry and reflow at widths the capture never sampled, plus dialogs. Routes come from the receipt's route table and are spread across it, spanning both ends so whatever sorts last is still reachable.

Both must pass for exit 0. When adding a check, put it in the cheap tier if it can be answered from disk.

Two things the gate has been wrong about before, both worth remembering:

- Resolving is not the same as resolving correctly. `getElementById` returns the first match, so a fragment duplicated across the desktop and mobile documents reported success while sending the reader to the hidden one.
- A route is not a URL path. A site captured at a subpath serves its entrypoint as the copy's `/`, so resolving routes against the source origin asks the live site for a page that was never captured — and a 404 page then becomes the thing the copy is compared to.

## Fluid capture

A copy is only faithful at the width it was captured at, because platform runtimes write inline pixel geometry that survives serialization while the runtime that computed it does not. Rather than freezing one width, capture sweeps widths with the source's runtime alive, fits a model per element (constant, proportional, floored, or a genuine breakpoint), and emits the result as ordinary CSS that needs no runtime.

Elements that fit badly fall back to frozen values rather than adopting a confident wrong formula. `source-profile.json` records what was measured: one document or per-device, declarative or runtime-written geometry, the detected switch width, and how many elements were learned versus frozen.

## Resume state

- `extraction-log.jsonl` (`ExtractionLog`) — append-only per-URL dedupe. Source of truth for "did we process this URL".
- `session.json` (`ImportSession`) — stage, original opts, counters. Single-writer, atomic rename; corrupt files become `session.json.corrupt.<ts>` rather than being silently deleted.
- `media-stubs.json` (`MediaStubStore`) — per-asset status with a retry cap, so permanently-broken URLs stop retrying across resume runs.
- `sections/<slug>.json` (`SectionSpecsStore`) — per-URL capture-once cache, written atomically, self-describing via `SECTION_SPECS_SCHEMA`. Bump the schema whenever `SectionSpec` changes so stale caches invalidate instead of silently degrading fidelity.

Reuse is opt-in: a plain re-run recaptures, and `--resume` is what reports `reused`.

## Build and distribution

- `.mcp.json` starts the server through `scripts/mcp-launcher.mjs`: dev checkouts run `src/` via tsx, plugin installs run the committed bundle `dist/mcp-server.bundle.mjs`. The launcher only falls back to the bundle when dependencies do not resolve, so a dev environment never runs a stale dist.
- The bundles must be committed, because Codex plugin installs do not restore dependencies. Regenerate with `npm run build:mcp-bundle` after changing `src/` or dependencies; CI fails on drift.
- `playwright` and `single-file-cli` stay external to the bundle behind guarded dynamic imports that degrade with install guidance.
- Playwright's Chromium is not installed on `npm install`. Run `npm run setup:browser` once.

## Non-obvious details

- **The MCP server is one long-lived process — editing `src/` does not hot-reload it.** ESM modules are cached per process, so a re-called tool keeps running the code loaded at server start. Restart it after editing. Vitest always uses on-disk source.
- Liberation writes the site and exits. `--serve` opts into a server that holds the process until interrupted. Anything automated should not pass it.
- Guidance goes to stderr; stdout stays the machine-readable result.
- `validateOutputDir` rejects paths containing `..` or outside `process.cwd()`. Tests use a cwd-local `.tmp-test/` directory rather than `os.tmpdir()`.
- Same-origin enforcement: every captured URL must share an origin with the `url` argument, or throw `SameOriginViolation`.
- Media filename collisions use numeric suffixes (`-2`, `-3`), not hashes.
- `detect-platform` uses domain-level URL patterns and HTTP fingerprinting — no path-based detection. Sites detecting as `unknown` resolve to the `default` adapter via `resolveAdapter`, so "No adapter available" is unreachable.
- Scrolled-state screenshots are skipped silently when a page is too short to have a distinct scrolled state.
- Screenshot capture restarts the browser every 100 URLs at batch boundaries to bound memory.
- Cross-origin stylesheets are skipped when aggregating design tokens — their `.cssRules` throw.

## Verifying a change

Run the gate against a real site, not only the unit tests:

```bash
data-liberation https://example.com/ --output /tmp/check
data-liberation compare /tmp/check/example.com
```

Claims about behaviour should come from a command that was actually run. Documented behaviour in this repository has been wrong before — reuse was described as automatic when it needs `--resume`, and an anonymous publish was described as returning a live URL when the space is private until claimed.
