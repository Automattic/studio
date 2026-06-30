# data-liberation-agent

Extract content from closed web platforms into WordPress-compatible WXR files.

## The problem

Closed platforms make it hard to leave. Wix has no HTML export and caps RSS at 20 posts. JavaScript-rendered content and limited APIs leave your site data locked inside.

## The solution

This tool extracts all content from closed platforms — posts, pages, media, navigation, redirects, products — and produces a standard WordPress WXR file ready to import.

**Where to host WordPress**: If your current provider also offers WordPress, you can move to WordPress and stay with them. WordPress.com is another option: the $4/mo Personal plan now supports plugins and themes, and the [WordPress.com MCP integration](https://wordpress.com/blog/2026/03/20/ai-agent-manage-content/) gives AI agents direct write access.

## Supported platforms

| Platform | Status | Prompt |
|---|---|---|
| **GoDaddy Websites & Marketing** (pages/blog) | Ready | [`prompts/godaddy-wm.md`](./prompts/godaddy-wm.md) |
| **Hostinger Website Builder** (blog/pages/products) | Ready | — |
| **HubSpot** | Ready | — |
| **Shopify** (blog/pages/products) | Ready | [`prompts/shopify.md`](./prompts/shopify.md) |
| **Squarespace** | Ready | [`prompts/squarespace.md`](./prompts/squarespace.md) |
| **Webflow** | Ready | [`prompts/webflow.md`](./prompts/webflow.md) |
| **Weebly** (blog/pages/products) | Ready | — |
| **Wix** | Ready | [`prompts/wix.md`](./prompts/wix.md) |
| **Any other website** (generic fallback) | Best-effort | — |

All eight platforms have MCP adapters with full extraction support including products (exported as WooCommerce-compatible CSV). Sites matching none of them fall back to a generic `default` adapter that renders each page in a headless browser and extracts the main content, media, and any JSON-LD products — best-effort, since it can't key off platform-specific markup. GoDaddy Websites & Marketing is pages + blog only in v1; GoDaddy Online Store (OLS) product support is planned for v1.1.

## Getting started — agent-first

data-liberation-agent is built to be driven by an AI agent. The front door is the `liberate` skill: one command runs the full pipeline — detect the platform, inventory every page/post/product, extract content and media, capture screenshots and design tokens, then reconstruct the site as an editable WordPress block theme and import it into a local WordPress preview.

> **Studio required for preview/import.** Install [Automattic Studio](https://developer.wordpress.com/studio/) before running `/data-liberation:liberate`. Extraction itself needs no WordPress.

### Claude Code

Install from the marketplace:

```bash
claude plugin marketplace add Automattic/data-liberation-agent
claude plugin install data-liberation@data-liberation
```

Or from a local checkout (for development on the plugin itself):

```bash
cd data-liberation-agent
claude plugin marketplace add .
claude plugin install data-liberation@data-liberation
```

Then, in Claude Code:

```
/liberate https://your-site.com
```

What you'll see: the agent detects the platform, inventories all pages/posts/products, pauses to confirm scope and estimated time, then extracts content and media. It then drives the design phase — clustering page layouts, building a responsive block theme that mirrors your source site's structure and visual style, and importing everything into Automattic Studio. When it finishes you get a local preview URL and a `run-report.json` summarizing what was built, what's faithful, and any gaps.

The result is a responsive, editable WordPress block theme — not a static copy.

Note: the engine CLI / `siteToTheme` consumes static source directories; liberating an external dynamic site still starts with DLA's Playwright capture, which feeds captured SectionSpecs into the engine.

### Codex

```bash
cd data-liberation-agent
codex
```

The `.codex-plugin/plugin.json` and `.mcp.json` register the MCP server and skills automatically. The `liberate` flow runs sequentially on Codex (the builder fan-out step degrades to a sequential loop).

Then in Codex:

```
$liberate https://your-site.com
```

### Gemini CLI

```bash
cd data-liberation-agent
gemini extension link .
```

### Any MCP client

Run the MCP server over stdio:

```bash
npx tsx src/mcp-server.ts

# or

npm run mcp
```

It exposes **35 tools**. The ones you'll call directly for a deterministic extract → QA → import flow:

`liberate_detect`, `liberate_discover`, `liberate_inspect`, `liberate_extract`, `liberate_screenshot`, `liberate_status`, `liberate_qa`, `liberate_verify`, `liberate_setup`, and `liberate_import` — plus `liberate_paths` (resolve the output directory) and `liberate_probe` / `liberate_map_apis` (browser-based diagnostics). The remaining tools drive the design/reconstruction phase and are orchestrated by the skills rather than called by hand. Full reference with parameters: [docs/mcp.md](./docs/mcp.md).

## Output

A successful run produces, in `~/Studio/_liberations/<host>/` (the default for the `liberate` flow; set the `DLA_OUTPUT_DIR` environment variable to change it, or pass `outputDir` when calling the MCP tools — `liberate_paths` reports the resolved path):

- `~/Studio/_liberations/<host>/`
   - `output.wxr` — WordPress eXtended RSS file, ready to import via WordPress Admin > Tools > Import
   - `media/` — downloaded images and attachments with local paths rewritten in the WXR
   - `redirect-map.json` — old platform paths mapped to new WordPress slugs
   - `extraction-log.jsonl` — per-URL extraction log (atomic dedupe for resume)
   - `session.json` — pipeline stage, captured opts, per-entity progress counters, and adapter pagination cursors
   - `media-stubs.json` — per-asset download status so permanently-broken URLs stop retrying across resume runs
   - `products.csv` — WooCommerce-compatible product CSV (if the site has e-commerce)
   - `products.jsonl` — raw product data streamed during extraction

## Screenshots & design tokens

The `liberate` flow captures, for every URL, full-page + scrolled-state screenshots (desktop 1440×900 and mobile 390×844), the rendered HTML, and site-wide design tokens — used by the reconstruction phase and handy for feeding AI design-system tools. Via raw MCP this is the `liberate_screenshot` tool (or `screenshots: true` on `liberate_extract`).

Artifacts land under the output directory:

- `screenshots/{desktop,mobile}/<slug>.png` (plus `.scrolled.png` post-scroll variants)
- `html/<slug>.html` — rendered HTML per URL
- `screenshots/manifest.json` — the URL → files join table
- `palette.json`, `typography.json`, `breakpoints.json` — aggregated per-site design tokens

The join back to `output.wxr` and `products.jsonl` happens on the filesystem via `manifest.json`, keyed by URL — nothing is written into WordPress postmeta.

## Additional documentation

* [How it works](/docs/how-it-works.md)
* [AI agent commands](/docs/commands.md)
* [AI skills](/docs/skills.md)
* [MCP server tools](/docs/mcp.md)
* [Wix authenticated content endpoints](/docs/wix-content-endpoints.md) — reference of the ten load-bearing content endpoints behind Wix's editor / dashboard auth

## Related

- [WordPress Data Liberation project](https://wordpress.org/data-liberation/) — the official effort
- [WordPress.com MCP](https://wordpress.com/blog/2026/03/20/ai-agent-manage-content/) — AI agent write access to WordPress.com

## Troubleshooting the preview

Preview and import require [Automattic Studio](https://developer.wordpress.com/studio/) — install the app first (the `studio` CLI ships with it). Studio sites are persistent and named after the output directory's domain slug (`example-com`, `example-com-2` on collision).

**"Studio not found"** — the `studio` CLI is not on PATH. Install Studio from https://developer.wordpress.com/studio/ and relaunch the terminal so the PATH update takes effect.

**"Studio create-site fails"** — out of disk, port conflict, or Studio config corruption. The error message includes the underlying CLI output. If it's a port conflict, retry. If the Studio config is corrupt, reinstalling Studio fixes it.

**Preview is not a secure environment.** Studio sites auto-log in as `admin`/`password` and bind to `localhost`. Do not paste secrets into them.
