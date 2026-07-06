---
name: inspect
description: Inspect a website before extraction — detect platform, scan sitemap, assess extractability, flag platform-specific features
---

Run the inspect skill to check a site before extracting content. Shows platform detection, URL inventory, extraction feasibility, and platform feature flags.

## What it reports

- **Platform detection** — GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix, or unknown (with confidence level and detection signals)
- **URL inventory** — sitemap scan with counts by type (pages, posts, products, galleries, events, etc.)
- **Sample page probes** — tests extractability on 2-3 sample pages (if the adapter supports probing)
- **Platform features** — detects stores, bookings, forms, members areas, scheduling, forums, and events. Each feature includes whether it transfers automatically and a WordPress plugin recommendation if it doesn't.

## Usage

Via MCP: `liberate_inspect` with a `url` parameter.

Via CLI: `data-liberation inspect <url>`
