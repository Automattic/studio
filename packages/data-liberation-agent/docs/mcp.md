# MCP Tools

The data-liberation-agent MCP server exposes 12 tools via stdio transport. Start it with:

```bash
npx tsx src/mcp-server.ts
```

## Extraction workflow

These tools are typically called in order: detect -> discover -> extract -> verify -> setup -> import.

### liberate_detect

Detect the platform of a website.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | yes | The URL of the website to detect |

Returns: `platform` (godaddy-wm, hostinger, hubspot, shopify, squarespace, webflow, weebly, wix, or unknown), `confidence` (high/medium/low), `signals` (what was detected).

### liberate_discover

Inventory a website: fetch sitemap, categorize URLs, extract navigation structure, detect platform features.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | yes | The URL of the website to inventory |
| `token` | no | API token for platforms requiring auth |
| `cdpPort` | no | CDP port for browser-based extraction |
| `verbose` | no | Enable detailed logging |

Returns: `siteUrl`, `siteMeta` (title, tagline, language), `navigation` (nav links), `counts` (URLs by type), `urls` (full URL list with types), `platformFeatures` (detected features with transfer status and WP plugin recommendations). Shopify sites additionally return `shopDomain` — the `*.myshopify.com` hostname auto-detected from the storefront HTML, which `liberate_extract` will use if an `adminToken` is provided.

### liberate_inspect

Probe a site to assess extractability. Combines detection, sitemap scan, sample page probes, and feature detection into a single call.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | yes | The URL of the website to inspect |
| `token` | no | API token if needed |
| `cdpPort` | no | CDP port for browser-based inspection |

Returns: `platform`, `confidence`, `signals`, `sitemapFound`, `urlCount`, `counts` (by type), `probeResults` (sample page extractability), `platformFeatures`, `extractionFeasibility` (ready or limited).

### liberate_extract

Extract all content from a website. Produces a WXR file, media directory, redirect map, and optionally a products CSV.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | yes | The URL of the website to extract |
| `outputDir` | yes | Directory to write WXR, media, and logs |
| `token` | no | API token for platforms requiring auth |
| `cdpPort` | no | CDP port for browser-based extraction |
| `delay` | no | Delay between requests in ms (default: 500) |
| `resume` | no | Resume a previous extraction (skip already-processed URLs) |
| `dryRun` | no | Extract 2-3 pages and report without writing WXR |
| `verbose` | no | Enable detailed per-page logging |
| `shopDomain` | no | **Shopify only** — the `*.myshopify.com` hostname used for Admin API calls. Usually unnecessary: `liberate_discover` auto-detects it from the storefront HTML (the `Shopify.shop` JS global) and stores it as `inventory.shopDomain`, so `liberate_extract` picks it up automatically even when the site is served on a custom domain. Only pass explicitly if auto-detection failed (e.g. Cloudflare-protected storefront). |
| `adminToken` | no | **Shopify only** — Admin API access token. When present, products are fetched via the Admin GraphQL API (2025-04) instead of the public JSON API, yielding richer data: `compareAtPrice` sale semantics, `inventoryItem.tracked` + `inventoryPolicy` stock status, `unitCost` cost-of-goods, collections as categories, `measurement.weight` unit normalization, and global SEO metafields. |
| `screenshots` | no | When `true`, runs the screenshot capture loop after extraction. Results land under `<outputDir>/screenshots/` with a `manifest.json` keyed by URL; no postmeta or CSV columns are written — any cross-reference against the WXR / products CSV happens on the filesystem. Adds one `ImportSession` stage (`screenshotting`) that is resumable. |

Returns: `wxrPath`, `redirectMapPath`, `outputDir`, `summary` (counts, quality scores), `failures` (URLs and errors), `wxrValidation`.

**Resume semantics:** when `resume: true`, three state files are consulted:
- `extraction-log.jsonl` — skips URLs with a `processed` entry
- `session.json` — restores pipeline stage, original opts, and adapter pagination cursors (Shopify GraphQL resumes mid-catalog via persisted `endCursor` + emitted-handle set)
- `media-stubs.json` — permanently-failed and user-ignored media URLs are skipped

### liberate_status

Check progress of a running or completed extraction.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `outputDir` | yes | The output directory of the extraction |

Returns: `running` (boolean), `processed`, `failed` counts.

## Screenshots

### liberate_screenshot

Capture full-page + scrolled-state screenshots (desktop 1440×900 + mobile 390×844) plus rendered HTML for every URL on a site. Runs independently from extraction — useful for pre-liberation analysis or feeding downstream AI design-system tools. Also produces a site-analysis summary (palette, typography, metadata) sampled from representative pages.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | yes (unless `urls` is set) | The site URL. Used for sitemap discovery and as the same-origin anchor for all captures. |
| `urls` | no | Explicit list of URLs to capture, bypassing sitemap discovery. Every URL must share origin with `url` (or with `urls[0]` if no `url` is given). |
| `outputDir` | yes | Directory to write `screenshots/`, `html/`, `manifest.json`, and `site-analysis.json`. |
| `types` | no | Array of URL types to filter by: `page`, `post`, `product`, `homepage`, `gallery`, `event`. Defaults to all. Ignored when `urls` is passed. |
| `limit` | no | Cap to first N URLs after filtering. |
| `concurrency` | no | Parallel captures. Default 3, max 10. |
| `browserRestartEvery` | no | Close + relaunch Chromium every N URLs to bound memory. Default 100. Restarts happen at batch boundaries, never mid-batch. |
| `cdpPort` | no | Connect to an existing Chrome session via CDP (for authenticated sites). |
| `force` | no | Re-capture even if output files already exist. Default false. |

**Returns:** `outputDir`, `manifestPath`, `siteAnalysisPath`, `captured` (count), `skipped` (count), `failed` (array of `{ url, error }`), `stage` (`screenshotting` → `complete`).

**Output layout:**

```
<outputDir>/
  screenshots/
    manifest.json                       URL → files join table
    desktop/<slug>.png                  full-page desktop
    desktop/<slug>.scrolled.png         post-scroll viewport (long pages only)
    mobile/<slug>.png                   full-page mobile
    mobile/<slug>.scrolled.png          post-scroll viewport (long pages only)
  html/<slug>.html                      rendered HTML post-hydration
  site-analysis.json                    palette + typography + metadata
```

Scrolled-state screenshots are silently skipped on pages shorter than ~2.5 viewports — they don't have a distinct scrolled state worth capturing.

**Example:**

```json
{
  "url": "https://example.com",
  "outputDir": "./output/example.com",
  "types": ["page", "post"],
  "concurrency": 5,
  "browserRestartEvery": 50
}
```

To capture screenshots as part of a full extract run (rather than invoking this tool directly), use `liberate_extract` with `screenshots: true`. The manifest and source URLs on extracted content are enough to correlate screenshots with WXR items or CSV product rows on the filesystem.

## Debugging & Reconnaissance

### liberate_map_apis

Map all API endpoints used by a website by navigating pages via CDP and capturing JSON network traffic. Produces a categorized endpoint catalog with sample responses and auth headers. Use during `/adapt` reconnaissance to reverse-engineer a new platform.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `cdpPort` | yes | Chrome DevTools Protocol port (e.g. 9222) |
| `url` | yes | The URL of the site to map |
| `crawlUrls` | no | Additional URLs to navigate (e.g. admin dashboard sections) |
| `followLinks` | no | Follow same-origin links from the main page, up to 20 (default: false) |

Returns: `totalApiCalls`, `totalEndpoints`, `endpoints` (array sorted by call count, each with path, methods, statuses, sections, queryParams, sampleRequestHeaders, samplePostData, sampleResponsePreview), `categories` (endpoints grouped by type: Content, Site Config, Auth & Identity, Commerce, Analytics, Media & Assets, Other), `authHeaders` (custom headers observed on API calls).

### liberate_probe

Probe a browser page via CDP for extraction-relevant data. Requires a running Chrome with `--remote-debugging-port`. Use for debugging extraction failures — called by the `/diagnose` skill.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `cdpPort` | yes | Chrome DevTools Protocol port (e.g. 9222) |
| `url` | no | Only probe pages on this domain (probes all tabs if omitted) |

Returns an array of probe results (one per matching browser tab), each containing: `globals` (window objects with platform prefixes), `jsonLd` (structured data), `cookies` (names/domains/flags, not values), `localStorage` (key names/sizes/previews), `networkEntries` (API calls from Performance API), `identity` (platform-specific IDs — Shopify shop name, Squarespace websiteId, Wix metaSiteId).

## Post-extraction

### liberate_verify

Verify a completed extraction. Checks for stale CDN URLs, failed pages, missing media, and items needing manual attention.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `outputDir` | yes | The output directory of the extraction to verify |

Returns: `wxrFound`, `contentItems`, `pages`, `posts`, `mediaAttachments`, `mediaOnDisk`, `staleCdnUrls`, `failedUrls`, `failedMedia`, `redirectCount`, `qualityScores` (high/medium/low), `manualAttentionItems`.

## Quality assurance

### liberate_qa

Compare extracted WXR content against the original source site page by page. Reports text similarity, missing headings/images/links, and grades each page. Optionally patches fixable issues like missing alt text.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `wxrFile` | yes | Path to the WXR file to QA |
| `fix` | no | Patch fixable issues in the WXR (default: false) |

Returns: `pages` (array of per-page results with slug, sourceUrl, grade, diff details), `skipped` (count of pages without source URL), `summary` (pass/warn/fail/error/fixed counts).

## WordPress import

### liberate_setup

Validate WordPress connection before importing. Checks site reachability, REST API availability, and authentication. Returns step-by-step guidance if anything fails.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `site` | yes | WordPress site domain (e.g. mysite.com) |
| `username` | yes | WordPress username |
| `token` | yes | WordPress application password |

Returns: `siteUrl`, `siteReachable`, `restApiAvailable`, `authenticated`, `siteName`, `userName`, `errors`, `guidance`.

### liberate_import

Import a WXR file into a WordPress site via the REST API.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `wxrFile` | yes | Path to the WXR file to import |
| `site` | yes | WordPress site domain |
| `username` | yes | WordPress username |
| `token` | yes | WordPress application password |
| `dryRun` | no | Preview without importing |
| `delay` | no | Delay between requests in ms (default: 500) |
| `only` | no | Only import specific type (categories, tags, media, pages, posts, comments, menus) |
| `verbose` | no | Enable detailed logging |
| `resume` | no | Resume a previous import, retrying only failed items |
| `importAuthors` | no | Create WordPress users for each author in the WXR (default: false — all content owned by authenticated user) |
| `woocommerceKey` | no | WooCommerce consumer key for product import |
| `woocommerceSecret` | no | WooCommerce consumer secret for product import |

Returns: per-stage results (media, categories, tags, pages, posts, comments, menus, products) with total/created/failed counts, plus `redirectMap`.

### `liberate_preview`

Start a local WordPress site serving a completed extraction using Automattic Studio. Studio is required — if the `studio` CLI is not on PATH, the tool returns an error with a link to https://developer.wordpress.com/studio/. Extraction itself needs no WordPress.

**Arguments:**
- `outputDir` (string, required) — path to the extraction output directory.
- `open` (boolean, optional) — focus the Studio app after the site is ready.

**Returns:** `{ status: "ready" | "failed", url?, warnings?, error?, siteName? }`. `siteName` is the Studio site name (e.g. `example-com-2`).

Each call creates a fresh Studio site with a collision-incremented name; old sites persist until you remove them with `studio site remove`.

### `liberate_paths`

Resolve where liberation output lives for a given URL.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | no | The website URL. When provided, `siteDir` is populated. |

**Returns:** `{ base, siteDir? }`. `base` is the resolved output base (`~/Studio/_liberations` by default; overridable via the `DLA_OUTPUT_DIR` env var or `--output` on the CLI). `siteDir` is `base/<sanitized host+path>` when `url` is given.

Skills and agents MUST call this tool to locate liberation output instead of assuming `output/<site>/` relative to cwd. The default output base changed from `./output` (cwd-relative) to `~/Studio/_liberations` (user-owned, Studio-adjacent).
