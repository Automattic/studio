---
name: verify
description: Verify a completed extraction — check for stale CDN URLs, failed pages, missing media, and items needing manual attention
---

Run the verify command after extraction to check the output before importing.

## What it checks

- **WXR integrity** — file exists, item counts (pages, posts, media attachments)
- **Stale CDN URLs** — platform CDN domains (GoDaddy `img1.wsimg.com`, Shopify, Squarespace, Webflow, Wix) still embedded in content that may break after the source site changes
- **Failed extractions** — pages that errored during extraction
- **Failed media** — images that couldn't be downloaded
- **Quality scores** — breakdown of high/medium/low quality pages
- **Media reconciliation** — media files on disk vs media attachments in the WXR
- **Redirect map** — count of URL redirects generated

## Usage

Via MCP: `liberate_verify` with an `outputDir` parameter.

Via CLI: `data-liberation verify <output-dir>`

## When to use

- After every extraction, before importing
- After resuming a partial extraction
- When the user reports missing content after import (compare verify output to what was imported)
