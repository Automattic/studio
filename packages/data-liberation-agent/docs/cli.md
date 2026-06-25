# CLI Reference

> **Headless / extraction path.** The CLI handles detection, extraction, screenshots, and import — the deterministic stages of the pipeline. The full design and replica flow (extraction + block-theme reconstruction → local preview URL) runs via the `/liberate` skill inside an AI agent (Claude Code, Codex). See [AI skills](./skills.md) and the [README](../README.md) for the agent-first getting-started path.

The `data-liberation` CLI extracts content from closed web platforms and imports it into WordPress.

```bash
npm run liberate -- <command> [options]
```

Individual commands also have shortcuts: `npm run inspect`, `npm run verify`, `npm run setup`.

## Commands

### Extract (default)

```bash
data-liberation <url> [options]
```

The main workflow. Detects the platform, inventories the site, extracts all content, and offers to import to WordPress. Produces a WXR file, media directory, redirect map, and products CSV (if applicable).

After extraction completes, the CLI prompts:
1. "Ready to import to WordPress?" — skip with `--non-interactive`
2. "Do you already have a WordPress site?" — if no, shows setup guidance
3. Collects credentials and validates the connection before importing

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--output <dir>` | Output directory (base; a `<host>` subdirectory is created under it) | `~/Studio/_liberations` |
| `--dry-run` | Extract 2-3 pages and report without writing WXR | off |
| `--resume` | Resume a previous extraction, skipping already-processed URLs | off |
| `--token <token>` | API token for platforms requiring auth (e.g. Webflow) | `LIBERATION_TOKEN` env var |
| `--delay <ms>` | Delay between requests | 500 |
| `--verbose` | Detailed per-page extraction logging | off |
| `--cdp-port <port>` | Chrome DevTools Protocol port for browser-based extraction | none |
| `--admin-token <tok>` | **Shopify only** — Admin API access token. Unlocks GraphQL product extraction with richer fields (sale pricing, stock policy, cost of goods, variant media, collections, SEO metafields). Falls back to public JSON API on failure. | `SHOPIFY_ADMIN_TOKEN` env var |
| `--shop-domain <host>` | **Shopify only** — `*.myshopify.com` hostname used for Admin API calls. Usually auto-detected from the storefront HTML during discovery; only pass manually if detection fails. | auto-detected |
| `--non-interactive` | Skip the post-extraction import prompt | off |
| `--no-screenshots` | Skip screenshots. Screenshots run by default — capturing desktop + mobile fullpage and scrolled-state screenshots plus rendered HTML for every URL. Results go to `<outputDir>/screenshots/` with a `manifest.json` keyed by URL; any cross-reference against `output.wxr` / `products.jsonl` happens on the filesystem. See the `screenshot` subcommand below for the underlying flags. | on (use `--no-screenshots` to opt out) |
| `--screenshots-concurrency <N>` | Parallel screenshot captures when screenshots are enabled. | 6 |

**Output directory structure:**

```
output/<site-hostname>/
  output.wxr              WordPress eXtended RSS file
  media/                  Downloaded images and attachments
  redirect-map.json       Old paths -> new WordPress slugs
  extraction-log.jsonl    Per-URL extraction log (atomic URL dedupe)
  session.json            Pipeline stage, captured CLI opts, progress, pagination cursors
  media-stubs.json        Per-asset download status (retry cap + user-ignored URLs)
  products.csv            WooCommerce product CSV (if e-commerce detected)
  products.jsonl          Raw product data stream
  .discovery-complete     Marker file (extraction finished successfully)
```

**Resume state is split across four files:**

- `extraction-log.jsonl` — append-only per-URL log; `--resume` skips any URL that already has a `processed` entry.
- `session.json` — higher-level state: stage (`discovering` → `extracting` → `finalizing` → `complete`), the original CLI opts, per-entity `{discovered, extracted, failed}` counts, and adapter pagination cursors. Crash-safe via atomic rename; a corrupt file is preserved as `session.json.corrupt.<ts>` rather than deleted.
- `media-stubs.json` — status per media URL (`awaiting` / `success` / `error` / `ignored`) with an attempt counter. After 3 consecutive failures the URL is treated as permanently broken and resume runs skip it. The `ignored` status is terminal; adapters or a future CLI can mark URLs to skip forever.
- `products.jsonl` — streaming JSONL of mapped WooCommerce products; on `--resume` the file is appended to rather than truncated so mid-catalog crashes don't re-emit duplicates.

**Resume:** When `--resume` is used, the CLI reads `extraction-log.jsonl` to skip already-processed URLs and rebuilds the media dedup hash map from existing files. `session.json` is loaded to restore stage and cursors. Progress counters reflect the full total (e.g. `[21/50]` not `[1/30]`). A `.liberation-lock` file prevents concurrent `data-liberation` runs against the same output directory — if the lock is present and the holding PID is still alive, a second run refuses to start.

### inspect

```bash
data-liberation inspect <url> [--token <token>]
```

Pre-extraction site assessment. Reports:
- Platform detection with confidence level and signals
- Sitemap URL count with breakdown by type (pages, posts, products, galleries, events)
- Sample page probes testing extractability (if the platform adapter supports probing)
- Platform feature flags — stores, bookings, forms, members, scheduling, forums, events — with transfer status and WordPress plugin recommendations

### qa

```bash
data-liberation qa <wxr-file> [--fix]
```

Compare WXR content against the original source site page by page. For each page with a `_source_url`, fetches the origin and compares text, headings, images, and links.

Reports a grade for each page:
- **pass** (>90% match) — content faithfully extracted
- **warn** (70-90%) — minor gaps
- **fail** (<70%) — significant content missing
- **error** — source page unreachable

With `--fix`: patches fixable issues (e.g. missing alt text on images) directly in the WXR file. Logs all comparisons and fixes to `qa-log.jsonl`.

### verify

```bash
data-liberation verify <output-dir>
```

Post-extraction health check. Scans the output directory and reports:
- WXR file presence and item counts (pages, posts, media attachments)
- Stale CDN URLs still embedded in content (GoDaddy `img1.wsimg.com`, Shopify, Squarespace, Webflow, Wix CDN domains)
- Failed page extractions and failed media downloads from the extraction log
- Quality score breakdown (high/medium/low)
- Media files on disk vs media attachments in the WXR
- Redirect map entry count
- Summary of items needing manual attention

### setup

```bash
data-liberation setup [--site <domain>] [--username <user>] [--token <password>]
```

Validate a WordPress connection. Prompts interactively for any missing parameters. Tests three things in order:

1. **Site reachable** — can we connect at all?
2. **REST API available** — does `/wp-json` respond?
3. **Authentication** — do the credentials work?

If any step fails, shows specific guidance (how to create Application Passwords, WordPress.com vs self-hosted differences, common mistakes).

### import

```bash
data-liberation import <wxr-file> --site <domain> --username <user> --token <password> [options]
```

Import a WXR file into WordPress via the REST API. Imports in this order: media, categories, tags, pages, posts, comments, menus. All content is imported as drafts.

**Required flags:**

| Flag | Description |
|------|-------------|
| `--site <domain>` | WordPress site domain (e.g. `mysite.com` or `localhost:8881`) |
| `--username <user>` | WordPress username |
| `--token <password>` | Application password (or `WP_APP_PASSWORD` env var) |

**Optional flags:**

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Preview what would be imported without making changes | off |
| `--delay <ms>` | Delay between API requests | 500 |
| `--verbose` | Detailed per-item logging | off |
| `--only <type>` | Only import a specific type: categories, tags, media, pages, posts, comments, menus | all |
| `--resume` | Retry only previously failed items | off |
| `--import-authors` | Create WordPress users for each author in the WXR (default: all content owned by you) | off |

### mcp

```bash
data-liberation mcp
```

Start the MCP server on stdio transport. Used by AI tools (Claude Code, Codex, Gemini CLI) to access the 8 `liberate_*` tools programmatically. See [docs/mcp.md](./mcp.md) for tool documentation.

## Environment variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `LIBERATION_TOKEN` | extract | API token for platforms requiring auth (alternative to `--token`) |
| `WP_APP_PASSWORD` | import, setup | WordPress application password (alternative to `--token`) |

## Examples

```bash
# Inspect a site before extracting
data-liberation inspect https://www.example.com

# Extract with a dry run first
data-liberation https://www.example.com --dry-run --verbose

# Full extraction
data-liberation https://www.example.com --output ./migrations

# Resume an interrupted extraction
data-liberation https://www.example.com --resume

# Verify the output
data-liberation verify ./migrations/www.example.com

# Validate WordPress credentials
data-liberation setup --site myblog.wordpress.com --username admin --token "xxxx xxxx xxxx"

# Import to WordPress
data-liberation import ./migrations/www.example.com/output.wxr \
  --site myblog.wordpress.com --username admin --token "xxxx xxxx xxxx"

# Import only media first, then posts
data-liberation import ./output.wxr --site myblog.wordpress.com --username admin --token "$WP_APP_PASSWORD" --only media
data-liberation import ./output.wxr --site myblog.wordpress.com --username admin --token "$WP_APP_PASSWORD" --only posts

# Squarespace: extract with admin access via CDP (gets drafts, unlisted pages, richer content)
# 1. Launch Chrome: google-chrome --remote-debugging-port=9222
# 2. Log in to your Squarespace admin in that Chrome window
# 3. Extract:
data-liberation https://www.example.squarespace.com --cdp-port 9222
```

### `liberate preview <outputDir>`

Preview a completed extraction in a local WordPress site using Automattic
Studio (required — install at https://developer.wordpress.com/studio/ if
it's not already installed). A persistent Studio site is created named
after the output directory's domain slug — `example-com`, `example-com-2`,
etc. Extraction itself needs no WordPress.
Auto-runs after every `liberate <url>` extraction; the standalone
`preview` subcommand is for re-opening a prior extraction.

**Flags:**
- `--open` — focus the Studio app after the site is ready.
- `--non-interactive` — skip the post-preview import nudge; still provisions the site and prints the URL for scripts to capture.

**Artifacts written to `<outputDir>/blueprint/`:**
- `blueprint.json` — the blueprint used for this run (regenerated each start).

**Lifecycle:** Provisions the Studio site, imports content, and returns the local URL. Studio sites persist after the command exits — remove them with `studio site remove <name>` when done.

### screenshot

```bash
data-liberation screenshot <url> [options]
```

Capture full-page + scrolled-state screenshots (desktop 1440×900 + mobile 390×844) plus rendered HTML for every URL on a site. Runs independently from extraction — useful for pre-liberation analysis or downstream design-system synthesis. Also produces three per-site aggregated design-token files (`palette.json`, `typography.json`, `breakpoints.json`) sampled from every captured URL.

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--output <dir>` | Output directory | `~/Studio/_liberations/<hostname>` |
| `--types <list>` | Comma-separated URL types to capture: `page`, `post`, `product`, `homepage`, `gallery`, `event` | all |
| `--limit <N>` | Cap to first N URLs | no cap |
| `--concurrency <N>` | Parallel captures | 3 (max 10) |
| `--browser-restart-every <N>` | Close + relaunch the browser every N URLs (memory bound) | 100 |
| `--cdp-port <n>` | Connect to an existing Chrome session via CDP — use for authenticated sites | none |
| `--force` | Re-capture even if output files already exist | off |
| `--urls-file <path>` | Read URLs from a file (one per line), bypassing sitemap discovery | none |
| `--non-interactive` | Skip the >500-URL preflight confirmation prompt | off |
| `--verbose` | Per-URL progress logging | off |

**Output layout:**

```
output/<site-hostname>/
  screenshots/
    manifest.json                       URL → files join table
    desktop/
      <slug>.png                        full-page desktop capture
      <slug>.scrolled.png               post-scroll viewport capture (long pages only)
    mobile/
      <slug>.png                        full-page mobile capture
      <slug>.scrolled.png               post-scroll viewport capture (long pages only)
  html/
    <slug>.html                         rendered HTML (post-hydration)
  palette.json                          dominant colors, ranked by urls-desc (top 24)
  typography.json                       font metrics per selector (h1/h2/h3/body/button),
                                          deduplicated tuples ranked by urls-desc
  breakpoints.json                      union of @media min-width / max-width integer px
                                          values from same-origin stylesheets
```

Scrolled-state screenshots are silently skipped on short pages (where `scrollHeight < viewport.height * 2.5`).

Same-origin enforcement: every URL must share origin with the `url` argument (or with the first entry of `--urls-file` if no bare URL is given). Mismatches throw `SameOriginViolation` and halt the run.

**Preflight:** For sites with >500 URLs and no `--limit`, the CLI prints an estimated time + disk usage and prompts `Continue? [y/N]`. Skip with `--non-interactive`, or set `--limit N` to sidestep the prompt entirely.

**Example — authenticated Webflow site via CDP:**

```bash
# 1. Launch Chrome with CDP and log in:
google-chrome --remote-debugging-port=9222
# 2. Capture:
data-liberation screenshot https://staging.example.com --cdp-port 9222 --types page,post --concurrency 5
```

### Screenshots on the default extract command

`data-liberation <url>` runs screenshot capture by default after the extraction phase finishes. Captured files are written under `<outputDir>/screenshots/{desktop,mobile}/<slug>.png` (plus `.scrolled.png` variants) and `<outputDir>/html/<slug>.html`, with a `manifest.json` at `<outputDir>/screenshots/manifest.json` that maps every captured URL to its file paths. The WXR and products CSV are not touched — cross-referencing screenshots with extracted content happens on the filesystem via the manifest.

Pass `--no-screenshots` to skip screenshot capture entirely. Pass `--screenshots-concurrency N` to tune parallelism (default 6, max 10).

This adds one `ImportSession` stage — `screenshotting` — after the normal extraction pipeline, and it's resumable via `--resume`.
