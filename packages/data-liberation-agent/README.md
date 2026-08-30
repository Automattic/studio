# data-liberation-agent

Liberate any website into a complete, portable HTML site.

## The problem

Closed platforms make it hard to leave. Wix has no HTML export and caps RSS at 20 posts. JavaScript-rendered content and limited APIs leave your site locked inside.

## The solution

Point it at a URL and get your site back as plain files:

```bash
data-liberation https://example.com/
```

Every retained route becomes a directory of HTML, CSS, media, and fonts, with references rewritten so navigation works locally. It runs on its own, anywhere that can serve a folder.

**HTML is the contract.** The liberated site is the deliverable — not an intermediate format on the way to somewhere else, and not tied to any destination.

## Three commands

```bash
data-liberation <url>                        # liberate a site
data-liberation compare <run-dir>            # verify the copy against its source
data-liberation publish <run-dir> --to spacefast   # put it on a live URL
```

That is the whole surface. Liberation writes the site and exits; add `--serve` to keep a local server running so you can click through it.

### Liberate

| Flag | |
|---|---|
| `--output <dir>` | Output base. Default `~/data-liberation`, or `DLA_OUTPUT_DIR` |
| `--resume` | Reuse what is already on disk instead of recapturing |
| `--screenshots` | Also write full-page desktop and mobile PNGs |
| `--serve` | Keep a local server running until interrupted |
| `--no-learn-fluid` | Freeze the layout at one width instead of learning how it reflows |

Fluid learning is on by default. The capture sweeps widths with the source's own runtime alive, fits how each element is sized, and emits that as ordinary CSS — so the copy keeps reflowing after the runtime is stripped, instead of being pinned to the width it was captured at.

### Compare

Verification runs in two tiers, and the report says which found what.

- **Self-consistency**, across every route, offline: anchors resolving to exactly one target, internal links landing on a real file, no asset still pointing at the origin. Milliseconds.
- **Source fidelity**, across a sample, in a browser: text, geometry and reflow at widths the capture never sampled, and dialogs opening as the source opens them. Roughly 25 seconds per route, so it samples rather than walking everything.

Exit code 0 means both passed. `--screenshots` writes source, copy, and diff PNGs; the pixel score is evidence for a human and never decides pass or fail.

### Publish

```bash
data-liberation publish <run-dir> --to spacefast
```

Publishing reads what is on disk, so a repaired copy or a different target can ship without touching the source site again. Without a token the publish is anonymous and returns a one-time claim link — the space stays private until it is claimed, so the live URL answers 403 to everyone until then. `--token`, or `SPACEFAST_TOKEN`, publishes into an account you own.

Naming an unknown target lists the registered ones.

## Supported platforms

| Platform | Status |
|---|---|
| GoDaddy Websites & Marketing | Ready |
| Hostinger Website Builder | Ready |
| HubSpot | Ready |
| Shopify | Ready |
| Squarespace | Ready |
| Webflow | Ready |
| Weebly | Ready |
| Wix | Ready |
| Any other website | Best-effort generic fallback |

Adapters contribute platform knowledge to discovery and capture — how a platform lists its routes, what its CDN URLs look like, how its runtime resolves anchors. Sites matching none of them fall back to a generic adapter that renders each page in a headless browser.

## Output

A run produces, under `~/data-liberation/<host>/`:

| Path | |
|---|---|
| `website/` | **The deliverable.** Serve this directory anywhere |
| `capture-receipt.json` | Source URL, the route table mapping each page to the URL it came from, assets |
| `diagnostics.json` | Everything the source withheld or the capture could not resolve |
| `source-profile.json` | Measured behaviour: one document or per-device, declarative or runtime-written geometry, switch width |

## Using it from an agent

The `liberate` skill drives the CLI. It is the only skill: a URL becomes a verified, portable site, and optionally a live URL.

### Claude Code

```bash
claude plugin marketplace add Automattic/data-liberation-agent
claude plugin install data-liberation@data-liberation
```

Then `/liberate https://your-site.com`.

### Codex

```bash
cd data-liberation-agent && codex
```

`.codex-plugin/plugin.json` and `.mcp.codex.json` register the server and skill automatically, since Codex does not expand `${CLAUDE_PLUGIN_ROOT}`. Then `$liberate https://your-site.com`.

### Gemini CLI

```bash
cd data-liberation-agent && gemini extension link .
```

### Any MCP client

```bash
npm run mcp     # or: npx tsx src/mcp-server.ts
```

The server exposes the same three verbs as tools — `liberate`, `compare`, `publish` — calling the same entry points the CLI calls. MCP is a transport here, not the architecture: nothing requires it, and it deliberately does not expose internal pipeline phases.

> **First-time browser setup.** Capture uses Playwright's Chromium, which is not installed automatically:
>
> ```bash
> npm run setup:browser
> ```

## Additional documentation

- [Wix authenticated content endpoints](/docs/wix-content-endpoints.md) — the load-bearing content endpoints behind Wix's editor and dashboard auth
- [Discoveries](./DISCOVERIES.md) — findings from real runs

## Related

- [WordPress Data Liberation project](https://wordpress.org/data-liberation/) — the official effort
- [Spacefast](https://spacefast.com/) — agent-first static hosting, the default publish target
