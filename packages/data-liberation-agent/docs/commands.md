# Commands

Commands are single-action operations available when using data-liberation-agent as an AI plugin. Unlike skills (which are multi-step workflows), commands perform one focused task.

Command definitions live in `commands/<name>.md`.

## /inspect

Inspect a website before extraction. Reports:
- Platform detection (GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix) with confidence level
- URL inventory from sitemap with counts by type (pages, posts, products, galleries, events)
- Sample page probes to test extractability
- Platform feature flags (stores, bookings, forms, members, scheduling, forums, events) with transfer status and WordPress plugin recommendations

MCP tool: `liberate_inspect` | CLI: `data-liberation inspect <url>`

## /import

Import a WXR file to WordPress via the REST API. Imports in order: media, categories, tags, pages, posts, comments, menus. All content is imported as drafts. Supports dry-run, resume, filtering by type, and WooCommerce product import.

MCP tool: `liberate_import` | CLI: `data-liberation import <wxr-file> --site <domain> --username <user> --token <password>`

## /qa

Compare extracted WXR content against the original source site page by page. Reports text similarity, missing headings, images, and links. Grades each page (pass/warn/fail). Optionally patches fixable issues like missing alt text with `--fix`.

MCP tool: `liberate_qa` | CLI: `data-liberation qa <wxr-file> [--fix]`

## /verify

Verify a completed extraction before importing. Checks:
- WXR file integrity and item counts (pages, posts, media)
- Stale CDN URLs still in content (GoDaddy `img1.wsimg.com`, Shopify, Squarespace, Webflow, Wix domains)
- Failed page extractions and failed media downloads
- Quality score breakdown (high/medium/low)
- Media files on disk vs attachments in the WXR
- Redirect map completeness

MCP tool: `liberate_verify` | CLI: `data-liberation verify <output-dir>`

## /setup

Validate a WordPress connection before importing. Tests site reachability, REST API availability, and authentication. Returns step-by-step guidance when something fails (how to create Application Passwords, common mistakes, self-hosted vs WordPress.com differences).

MCP tool: `liberate_setup` | CLI: `data-liberation setup --site <domain> --username <user> --token <password>`
