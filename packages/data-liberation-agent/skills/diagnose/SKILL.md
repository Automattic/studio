---
name: diagnose
description: Debug failed or low-quality extractions by analyzing logs, probing the source site, and identifying root causes
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

# Diagnose — Debug Extraction Failures

Systematically investigate why an extraction failed or produced poor results. Identify root causes and fix them.

## When to Use

- Extraction completed but many pages failed
- Extraction completed but content quality is low
- Extraction hung or crashed mid-way
- The user reports missing content after import

## Setup

Ask for or detect:

| Parameter | How to find it |
|-----------|---------------|
| Output directory | Call `liberate_paths({ url })` to resolve `siteDir`; default base is `~/Studio/_liberations/<host>` |
| WXR file | `output.wxr` in the output directory |
| Extraction log | `extraction-log.jsonl` in the output directory |
| Source URL | From the WXR's `<link>` element or ask the user |

## Phase 1: Triage — What Happened?

**Start with `liberate_verify`** — it gives you a structured overview in one call:
- WXR item counts (pages, posts, media)
- Failed URLs and failed media downloads
- Stale CDN URLs still in content
- Quality score breakdown (high/medium/low)
- A "needs attention" summary

This replaces manual log grepping for the initial assessment. If you need more detail, then dig into the raw log:

```bash
# Count successes vs failures
grep -c '"type":"processed"' <outputDir>/extraction-log.jsonl
grep -c '"type":"failed"' <outputDir>/extraction-log.jsonl
grep -c '"type":"media_failed"' <outputDir>/extraction-log.jsonl
```

### Classify the problem:

**A. High failure rate (>30% failed)**
Something systematic is wrong — the site is blocking requests, the adapter can't parse the platform, or there's an auth issue.

**B. Low failure rate (<30%) with specific pages failing**
Individual page issues — timeouts, unusual page structures, dynamic content.

**C. No failures but low quality content**
The adapter extracted something but it's the wrong content — nav bars, footers, cookie banners instead of the actual page body.

**D. Crash / incomplete extraction**
The process died mid-way. Check for the lock file, partial WXR, and the last log entry.

**E. Missing or incorrect products**
Products were expected but `products.csv` is missing, empty, or has wrong data.

## Phase 2: Investigate

### For high failure rate (Type A):

1. **Read the error messages** from failed entries:
   ```bash
   grep '"type":"failed"' extraction-log.jsonl | head -5
   ```

2. **Common causes and fixes:**

   | Error pattern | Cause | Fix |
   |--------------|-------|-----|
   | `timeout` / `AbortError` | Site is slow or blocking | Increase `--delay`, try with browser via `--cdp-port` |
   | `403 Forbidden` | Rate limiting or bot detection | Increase delay, use CDP with a real browser session |
   | `404 Not Found` | Stale sitemap, pages moved | Re-run discovery, check if site restructured |
   | `TypeError: fetch failed` | Network issue, wrong protocol | Check if site uses http vs https, check DNS |
   | `Navigation failed` | Playwright can't load the page | Check if site requires JavaScript, cookies, or auth |

3. **Probe a failed URL manually:**
   ```bash
   curl -sI <failed-url> | head -20
   ```
   Check: status code, redirects, `Content-Type`, security headers.

4. **Deep browser probe (if the user has Chrome with CDP running):**
   Call `liberate_probe` with the CDP port and site URL. This connects to the browser and reports:
   - **Window globals** — platform-specific data objects (GoDaddy W+M: `_BLOG_DATA`, Shopify: `Shopify.*`, Squarespace: `__NEXT_DATA__`, Wix: `__WIX_DATA__`)
   - **Cookies** — names, domains, flags (helps diagnose auth/session issues)
   - **localStorage** — cached config and state
   - **Performance API network entries** — what API calls the page made (useful when extraction misses data)
   - **Platform identity** — site IDs, visitor IDs, view mode (helps identify auth context)

   This is especially useful for:
   - Verifying the user is actually logged in (check for session cookies)
   - Finding alternate data sources when API interception fails
   - Understanding why content is empty (check if globals are populated)

5. **Check if the platform is detected correctly:**
   ```bash
   npx tsx src/cli.ts inspect <site-url>
   ```
   If detection is wrong, the wrong adapter is running.

### For individual page failures (Type B):

1. **Group failures by error type:**
   ```bash
   grep '"type":"failed"' extraction-log.jsonl | jq -r .error | sort | uniq -c | sort -rn
   ```

2. **Spot-check the worst offenders** — fetch the URL manually and compare against what the adapter tried to do.

3. **Check for pattern:** Are all failures the same URL type (e.g. all blog posts fail but pages succeed)? This points to a type-specific extraction bug.

### For low quality content (Type C):

1. **Run `/qa`** to compare WXR content against the origin site. This gives per-page quality grades.

2. **Read a few low-scoring pages** from the WXR:
   - Is the content just navigation/footer/boilerplate?
   - Is the main content area missing?
   - Are images referenced but missing?

3. **Check the adapter's content selector.** Each adapter targets specific HTML containers:
   - Wix: extracts from DOM via Playwright
   - Squarespace: `?format=json` API or admin API via CDP
   - Webflow: `.w-richtext` containers
   - Shopify: `article` or `.rte` containers
   - GoDaddy W+M: blog posts parse `window._BLOG_DATA` and convert Draft.js `post.fullContent` to HTML; pages strip `HEADER_SECTION` / `FOOTER_*` / section-title / hero-image widgets from the DOM

   If the site uses a non-standard template, the selector may miss the content.

4. **Fetch the origin page and inspect its structure:**
   ```bash
   curl -s <page-url> | grep -o '<main\|<article\|class="content\|class="post-body\|class="entry-content' | head -10
   ```

### For crashes (Type D):

1. **Check for lock file:** `.liberation-lock` in the output directory means the process didn't clean up.
2. **Check the last log entry** — this is the page that was being processed when it crashed.
3. **Check WXR integrity** — if streaming was active, the WXR may be truncated (missing `</channel></rss>`).
4. **Fix and resume:** Delete the lock file, then re-run with `--resume`.

### For product issues (Type E):

1. **Check if products.csv and products.jsonl exist:**
   ```bash
   ls -la <outputDir>/products.csv <outputDir>/products.jsonl
   ```

2. **If both are missing** — no products were detected during extraction. Investigate:
   - Were product pages in the sitemap? Check the extraction log for product URLs.
   - Does the site use JSON-LD `@type: Product`? Fetch a product page and check:
     ```bash
     curl -s <product-url> | grep -o 'application/ld+json' | head -3
     curl -s <product-url> | grep -o '"@type":"Product"'
     ```
   - If no JSON-LD, the platform may need a custom `extractProduct` function in its adapter.
   - Were the URLs classified as `product` type? Check `classifyUrl` in `src/lib/extraction/sitemap.ts` for the URL patterns it recognizes.

3. **If products.jsonl exists but products.csv is missing or empty** — the JSONL→CSV conversion failed. Read products.jsonl to check data quality:
   ```bash
   head -3 <outputDir>/products.jsonl | jq .
   ```
   Check: do products have names? Prices? Are fields malformed?

4. **If products.csv exists but data is wrong:**
   - **Missing prices** — the JSON-LD `offers` array may be structured differently than expected. Fetch a product page and inspect the JSON-LD.
   - **Missing images** — check if images are in `ld.image` as strings, objects with `.url`, or in a different field.
   - **Missing variants** — the generic JSON-LD extractor only produces simple products. Variants require platform-specific extraction (Shopify and Wix have this; other platforms may need it added via `/adapt`).
   - **Duplicate products** — if both the adapter's custom extractor and the shared JSON-LD extractor fire for the same page, products may be doubled. Check if `extractProduct` is passed to `runExtractionLoop` alongside the generic fallback.

5. **Check product count vs expectations:**
   ```bash
   wc -l <outputDir>/products.jsonl
   grep -c '"type":"product"' <outputDir>/extraction-log.jsonl || echo "no product type in log"
   ```

## Phase 3: Fix

Based on the diagnosis:

### Adapter-level fixes

If the content selector is wrong for this site's template:
1. Read the adapter's `extractPage` function
2. Identify the correct content container
3. Add a fallback selector or adjust the existing one
4. Re-extract affected pages with `--resume`

### Configuration fixes

If the issue is rate limiting, timeouts, or auth:
1. Suggest the right `--delay` value
2. Suggest using `--cdp-port` with an authenticated browser session
3. Suggest providing a `--token` if the platform supports API keys

### Data fixes

If the WXR has issues but re-extraction isn't needed:
1. Use `/qa` to identify and patch specific content gaps
2. Manually fix truncated WXR (add closing tags)

## Phase 4: Verify

After applying fixes:

1. **Re-extract** with `--resume` (only re-processes failed URLs)
2. **Run `/qa`** to check content quality
3. **Compare failure counts** before and after

## Phase 5: Document

If you discovered a platform-specific issue or workaround:
1. Add a `DISCOVERIES.md` entry
2. If the fix is adapter code, commit it with a descriptive message

## Common Diagnostic Commands

```bash
# Overview of extraction results
wc -l <outputDir>/extraction-log.jsonl
grep -c '"processed"' <outputDir>/extraction-log.jsonl
grep -c '"failed"' <outputDir>/extraction-log.jsonl

# Most common errors
grep '"failed"' <outputDir>/extraction-log.jsonl | grep -o '"error":"[^"]*"' | sort | uniq -c | sort -rn

# Slowest pages
grep '"processed"' <outputDir>/extraction-log.jsonl | grep -o '"durationMs":[0-9]*' | sort -t: -k2 -rn | head -10

# Check WXR size and item count
wc -c <outputDir>/output.wxr
grep -c '<item>' <outputDir>/output.wxr

# Check media downloads
ls <outputDir>/media/ | wc -l
grep -c '"media_failed"' <outputDir>/extraction-log.jsonl

# Check if extraction is complete
test -f <outputDir>/.discovery-complete && echo "Complete" || echo "Incomplete"

# Product diagnostics
wc -l <outputDir>/products.jsonl 2>/dev/null || echo "No products.jsonl"
wc -l <outputDir>/products.csv 2>/dev/null || echo "No products.csv"
head -3 <outputDir>/products.jsonl 2>/dev/null | python3 -m json.tool 2>/dev/null || true
```

## Important Rules

1. **Read the logs first.** The extraction log tells you exactly what happened — don't guess.
2. **Probe before fixing.** Understand the root cause before changing code.
3. **One fix at a time.** Change one thing, re-test, confirm it helped.
4. **Don't mask failures.** If a page genuinely can't be extracted, that's information — don't silence the error.
5. **Document what you find.** Platform quirks discovered during diagnosis are valuable for DISCOVERIES.md.
