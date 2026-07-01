---
name: adapt
description: Build a new platform adapter to extract content from an unsupported platform (Blogger, Ghost, Tumblr, etc.)
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
  - WebSearch
---

# Adapt — Build a New Platform Adapter

Guide the process of adding extraction support for a new platform. The result is a working adapter that plugs into the existing extraction pipeline.

## Before You Start

1. **Check if the platform is already supported.** Read `src/adapters/` — if an adapter exists, this skill isn't needed.
2. **Ask the user for a live site URL** on the target platform. You need a real site to reverse-engineer against.

## Phase 1: Reconnaissance

Understand how the target platform works before writing any code.

### 1a. Platform Detection

Figure out how to identify sites on this platform. Check:

1. **URL patterns** — does the domain contain platform-specific strings? (e.g. `.squarespace.com`, `.webflow.io`, `.wixsite.com`)
2. **HTTP headers** — fetch the site and look for platform-specific response headers (e.g. `X-Squarespace-Version`, `X-Wix-Request-Id`)
3. **HTML markers** — look for platform-specific tags, classes, scripts, or meta tags in the page source
4. **DNS** — check CNAME records that point to platform infrastructure

Add detection signals to `src/lib/extraction/detect-platform.ts`:
- URL patterns go in `URL_PATTERNS`
- HTTP/HTML signals go in `detectFromHttp()`

### 1b. Content Discovery

Figure out how to find all pages on the site:

1. **Sitemap** — try `sitemap.xml`, `sitemap_index.xml`. Most platforms generate these.
2. **Navigation crawl** — the shared `extractNavLinks()` in `src/adapters/shared.ts` handles this generically.
3. **Platform API** — some platforms have public APIs that list pages/posts (like Squarespace's `?format=json` or Shopify's `/products.json`).
4. **Structured data** — check JSON-LD, Open Graph, and meta tags for content type hints.

### 1c. Content Extraction

Figure out how to get the actual content from each page:

1. **API-first** — does the platform expose content via API/JSON? This is always preferred.
2. **HTML parsing** — if no API, parse the server-rendered HTML. Look for semantic containers (`.post-body`, `article`, `.content`, `main`).
3. **Browser rendering** — if content is JavaScript-rendered, use Playwright via `launchBrowser()` from `src/adapters/shared.ts`.

### 1d. API Mapping (recommended for complex platforms)

If the platform has an admin dashboard or uses client-side API calls, use `liberate_map_apis` to automatically discover all API endpoints:

1. Ask the user to launch Chrome with `--remote-debugging-port=9222` and log in to their account on the target platform
2. Call `liberate_map_apis` with the CDP port, the site URL, and optionally a list of admin dashboard URLs to crawl
3. The tool navigates each URL, captures all JSON API traffic via CDP, and produces:
   - A categorized endpoint catalog (Content, Site Config, Auth, Commerce, Analytics, Media)
   - Sample request headers and response previews for each endpoint
   - Auth header patterns (X-*, Authorization, cookies) used by the platform
   - Query parameters observed on each endpoint

This is the fastest way to reverse-engineer a platform's API surface. The output tells you exactly which endpoints return content data, what auth is needed, and what the response shapes look like — everything you need to write the adapter's `extractPage` function.

You can also call `liberate_probe` to inspect window globals, localStorage, cookies, and platform identity fields on any page — useful for understanding what data the platform exposes client-side.

**Document everything you find.** This is research — take notes on endpoints, selectors, quirks.

## Phase 2: Build the Adapter

### 2a. Scaffold

An adapter is a **directory** `src/adapters/<platform>/`, never a single file. `index.ts` is a thin assembler; each concern lives in its own sibling. Read `src/adapters/webflow/` (the smallest — a 3-file split) and `src/adapters/shopify/` (a fuller split) as references.

**`index.ts` — thin assembler + public API.** It defines `detect` inline, imports `discover`/`extract` (and optional `capture`/`blocks`) from siblings, exports the `<platform>Adapter` object, and **re-exports the inventory/opts types** (plus any helpers other modules need) so external code only ever imports `<platform>/index.js`. Keep all real logic in siblings.

```typescript
// src/adapters/webflow/index.ts — the whole assembler
import type { PlatformAdapter } from '../../types.js';
import { discoverWebflow } from './discover.js';
import { extractWebflow } from './extract.js';

export type { WebflowInventory, WebflowAdapterOpts } from './discover.js';

function detect(url: string): boolean {
  return /webflow\.io|webflow\.com/i.test(url);
}

export const webflowAdapter: PlatformAdapter = {
  id: 'webflow',
  detect,
  discover: discoverWebflow,
  extract: extractWebflow,
};
```

**Sibling files** — add only what the platform needs (webflow uses 3; richer platforms split further):

| file | holds |
|------|-------|
| `types.ts` | `<Platform>AdapterOpts` + `<Platform>Inventory` (+ platform JSON shapes) |
| `discover.ts` | `discover()` — sitemap/nav crawl, URL classification → inventory |
| `extract.ts` | `extract()` — drives `runExtractionLoop()` with an `extractPage` fn |
| `content.ts` | HTML/content parsing + quality scoring |
| `media.ts` | media URL extraction |
| `products.ts` | product → `WooProduct` mapping (e-commerce only) |
| `capture.ts` | optional `AdapterCapture` (seam 1 — pre-capture DOM removals) |
| `blocks.ts` | optional `AdapterBlocks` (seam 2 — content→blocks recipe) |

Both seams are typed in `src/adapters/page-actions.ts`; examples are `shopify/capture.ts` and `squarespace/blocks.ts`. Add any platform-specific helpers as further siblings (wix has `runtime.ts`/`gallery.ts`/`page.ts`; hubspot has `url.ts`/`metadata.ts`). The tiny webflow adapter has no `types.ts` — it inlines its opts/inventory in `discover.ts` and re-exports from there; use a dedicated `types.ts` for anything non-trivial.

**The adapter contract** — `<platform>Adapter` implements `PlatformAdapter` (`src/types.ts`):
- **`id`** — lowercase platform name (e.g. `'ghost'`)
- **`detect(url)`** — `true` if the URL belongs to this platform (defined inline in `index.ts`)
- **`discover(url, opts)`** — fetch sitemap + navigation, classify URLs, return inventory
- **`extract(inventory, wxr, opts, context)`** — call `runExtractionLoop()` from `src/adapters/shared.ts` with an `extractPage` function
- optional **`probe`**, **`capture`**, **`blocks`**

Define in `types.ts`:
- `<Platform>AdapterOpts` extending `Record<string, unknown>` with: `delay?`, `resume?`, `dryRun?`, `verbose?`, `outputDir?`
- `<Platform>Inventory` with: `siteUrl`, `discoveredAt`, `siteMeta` (title, tagline, language), `navigation`, `counts`, `urls`

### 2b. The extractPage Function

This is where platform-specific extraction lives. For each URL:

1. Fetch the page (via API or HTTP)
2. Extract: title, slug, content (HTML), excerpt, date, seoTitle, seoDescription, mediaUrls
3. Score quality using your own signals
4. Return an `ExtractedPage` object (defined in `src/adapters/shared.ts`)

Use the shared helpers from `src/adapters/shared.ts`:
- `extractMeta(html, property)` — read meta tags
- `extractTitle(html)` — read `<title>` tag
- `extractHeading(html)` — read `<h1>` with title fallback
- `extractNavLinks(html, baseUrl)` — parse nav links
- `IMAGE_EXTENSIONS` — regex for image file detection

### 2c. Product Support

Check during reconnaissance whether the platform has e-commerce (product pages, a store, a shop section).

**Generic detection (automatic):** The shared extraction loop in `src/adapters/shared.ts` automatically detects products via JSON-LD `@type: Product` on any page classified as `product` type. This works out of the box if:
- The platform emits JSON-LD Product schema
- The sitemap or URL classifier marks product URLs correctly

**Platform-specific detection (optional but recommended):** If the platform has a richer product API or non-standard product markup, provide a custom `extractProduct` function to `runExtractionLoop()`:

```typescript
const result = await runExtractionLoop({
  // ...other opts
  csvBuilder,
  extractProduct: (url: string, html: string) => {
    // Try platform-specific product extraction first
    // Return WooProduct or null
  },
});
```

The custom extractor is called before the generic JSON-LD fallback, so it takes priority.

**What to extract for products** (see `WooProduct` type in `src/lib/import/woo-product-csv.ts`):
- `name` (required), `description`, `shortDescription`
- `regularPrice`, `salePrice`
- `sku`
- `images` — array of image URLs
- `categories`, `tags`
- `weight`, `length`, `width`, `height`
- `inStock`, `stock`
- `attributes` — array of `{ name, values[], visible, global }` for product options (size, color, etc.)
- `type` — `'simple'`, `'variable'`, `'grouped'`, `'external'`, or `'variation'`
- `parentSku` — for variations, the parent product's SKU

**Variable products:** If the platform supports product variants (sizes, colors), generate one `variable` parent row plus `variation` child rows with `parentSku` linking them. See `shopifyProductToWoo()` in `src/adapters/shopify/products.ts` for the pattern.

**CSV streaming:** The adapter should create a `WooProductCsvBuilder`, call `openStream(outputDir)` before extraction, and `closeStream()` after. The shared loop calls `csvBuilder.addProduct()` automatically when it detects products. See the Shopify or Wix adapters for the wiring pattern.

## Phase 3: Register

Always import the adapter from its barrel — `./adapters/<platform>/index.js` — never a sibling directly.

1. **`src/mcp-server.ts`** (required) — add the import under the `// Static adapter imports` comment and add the adapter to the `adapters: PlatformAdapter[]` array. Both are kept **alphabetical**.
2. **`src/ui/discover.tsx`** (CLI/Ink discovery UI) — add the top-level import and append to its `adapters` array. The default `data-liberation <url>` flow resolves adapters here, so the CLI path needs it.
3. **`src/ui/inspect.tsx`** (optional) — `liberate_inspect` lazy-`import()`s a small `allAdapters` list inside the component; add yours there for inspect coverage. This list is partial today and isn't required for extraction.

## Phase 4: Test

### 4a. Create Test Fixtures

Create fixture files in `test/fixtures/` with sample HTML and/or JSON from the platform. Sanitize any PII.

### 4b. Write Tests

Create `test/adapters/<platform>.test.ts`. Test:
- Detection (URL patterns, HTML markers)
- Page extraction (fixture HTML → ExtractedPage)
- Media URL extraction
- Content quality scoring
- Product extraction (if the platform has e-commerce) — fixture product HTML → WooProduct with name, price, images, variants

### 4c. Manual Verification

Run extraction against the user's live site:
```bash
npx tsx src/cli.ts <site-url> --dry-run --verbose
```

Check the output for quality: are titles correct? Is content complete? Are media URLs captured?

## Phase 5: Document

1. Add the platform to the supported platforms list in `README.md`
2. Add a discovery entry to `DISCOVERIES.md` documenting what you learned about the platform
3. Update `AGENTS.md` if any non-obvious details are worth noting

## Tips

- **Start with the simplest extraction path.** Get basic pages working first, then add blog posts, then products, then edge cases.
- **Check the existing adapters** for patterns you can reuse. Don't reinvent what shared.ts already provides.
- **Platform APIs change.** Document the version/date of any API you reverse-engineer.
- **Test with both small and large sites.** A 5-page portfolio and a 500-page blog exercise different code paths.
