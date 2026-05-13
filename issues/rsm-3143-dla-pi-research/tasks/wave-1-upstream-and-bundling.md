---
id: wave-1-upstream-and-bundling
wave: 1
title: Upstream-pi feasibility + DLA bundling/distribution against pi
---

# Wave 1 — Upstream-pi feasibility + DLA bundling/distribution

## Goal

Two compact sub-investigations:

- **Upstream-pi:** Can we plausibly land MCP support in `@mariozechner/pi-coding-agent` upstream, on a timeline RSM-3143 cares about? If yes, this becomes a fifth approach (and dominates Bridge by removing the Studio-owned shim). If no, kill it explicitly.
- **Bundling & distribution:** Given Bridge and Vendor each have different DLA install/distribution profiles (DLA-as-runtime-dependency-with-`npx tsx` for Bridge; DLA-as-npm-dep-imported-at-build-time for Vendor), what survives Studio's `cli:build` + electron-forge packaging? RSM-1639's `wave-1-bundling-distribution.md` covers the pipeline; this brief confirms or refutes specifically for DLA.

## Questions — upstream-pi

1. **Maintainer & release cadence.** Who maintains `@mariozechner/pi-coding-agent`? Is it a one-person open-source project, an Automattic-internal package vendored under a personal scope, something else? What's the release cadence (from npm `versions` timestamps)?
2. **Issue tracker.** Is there a public repo / issue tracker? Have MCP-support requests been filed? If yes, what's the maintainer's response — accepted, deferred, rejected?
3. **Reasonable contribution shape.** If we contributed MCP support upstream, what would the API look like — a new `mcpServers` slot on `CreateAgentSessionOptions` that pi internally resolves to `customTools`? An extension factory pi already supports (depends on Brief 1's findings)? Sketch the upstream API at a coarse level.
4. **Timeline plausibility.** Order-of-magnitude estimate: how long would landing this upstream realistically take, and how does that compare with shipping Bridge or Vendor in-tree? (If upstream is 6+ months on the optimistic end, it's not on the RSM-3143 timeline regardless of merit.)
5. **Risk of going alone.** If we land Bridge as Studio-owned, what's the cost of *not* upstreaming — vendor lock-in to pi 0.70.x, brittleness against pi releases, divergence from how other pi-based agents handle MCP if upstream lands it independently?

## Questions — bundling & distribution

1. **Install path for Bridge.** Bridge runs DLA's stdio MCP server via `npx tsx src/mcp-server.ts` at runtime. For that to work in a packaged Studio CLI:
   - DLA must be installed somewhere reachable from the packaged binary.
   - `npx` and `tsx` must be available at runtime, or we use a built JS entry.
   - Confirm whether Studio's electron-forge packaging includes `node_modules` for the CLI (ASAR layout per `wave-1-bundling-distribution.md`) and whether `npx tsx` is resolvable from a packaged install.
2. **Install path for Vendor.** Vendor imports `data-liberation/src/lib/...` at Studio's build time. For that to work:
   - DLA must be in Studio's `package.json` dependencies (probably `apps/cli/package.json`).
   - Studio's Vite build must transpile or pre-build DLA's TS sources, or DLA must ship `dist/` we can import.
   - Confirm whether Vite picks DLA up transparently (and what tarball-vs-`github:` does to the lockfile).
3. **`github:` deps post-public-DLA.** RSM-1639 rejected this when DLA was private. Now that DLA is public, confirm `"data-liberation": "github:Automattic/data-liberation-agent#<sha>"` works in `npm install` against Studio's CI/dev/install pipelines (CI has GitHub access; users running `npm install` to dev Studio will need GitHub access too — verify that's already an assumption Studio makes).
4. **Pinning strategy.** Commit SHA vs. semver tag vs. branch — recommendation, given DLA does not publish to npm and may not tag releases reliably (per `wave-1-dla-inventory.md` sec 2).
5. **Lockfile impact.** `npm install` against a `github:` dep populates the lockfile with a SHA. What does this do to bot-driven `npm update`, dependabot, Renovate, etc.? Anything Studio-specific to worry about?
6. **DLA's own dependencies.** DLA pulls in `@modelcontextprotocol/sdk`, `tsx`, Ink, etc. For Vendor, those leak into Studio's node_modules. Quantify (rough byte count, license check) — anything that would make legal/distribution nervous?
7. **Native deps / postinstall scripts.** Does DLA have any native deps (browser drivers, headless chromium, etc.) that would complicate Studio's packaging? Check `package.json` and `postinstall` scripts.

## Suggested approach

- For upstream-pi:
  - `npm view @mariozechner/pi-coding-agent` for maintainer + recent versions.
  - Look at the package's repository URL (in `package.json`) — if a public GitHub repo, scan issues for "mcp".
  - Estimate timeline qualitatively. Don't pretend to know what you don't.
- For bundling & distribution:
  - Reuse `prior-art/wave-1-findings/wave-1-bundling-distribution.md` for the pipeline-level facts.
  - Read `apps/cli/package.json`, `apps/cli/vite.config.dev.ts` (or wherever the CLI build config lives), `apps/studio/forge.config.ts` for the packaging shape.
  - Check DLA's `package.json` for `dependencies`, `scripts.postinstall`, and any binaries.
  - For Bridge specifically: trace whether `node_modules/data-liberation` would be packaged or stripped by Studio's bundler — `cli:build` config will tell you.

## Deliverable

A markdown file at `issues/rsm-3143-dla-pi-research/wave-1-findings/wave-1-upstream-and-bundling.md` with frontmatter and two top-level sections:

### Upstream-pi
1. Maintainer & release cadence.
2. Issue-tracker scan (MCP requests).
3. Plausible upstream API shape.
4. Timeline estimate.
5. Risk of *not* upstreaming.
6. Verdict.

### Bundling & distribution
1. Bridge install path — works in packaged CLI? `npx tsx` available? Pinning?
2. Vendor install path — Vite transpilation? `dist/` vs. source?
3. `github:` dep mechanics & lockfile.
4. DLA's transitive deps — byte/license check.
5. Postinstall / native-dep hazards.
6. Verdict per approach.

## Out of scope

- Implementing anything.
- Re-investigating DLA's surfaces or pi's extensibility (those are Briefs 1–4).
- Permission policy bucket content.
- Detailed runtime perf benchmarking — back-of-envelope is fine.
