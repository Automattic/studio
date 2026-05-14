---
name: liberate
description: Liberate a site from a closed web platform (GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix) into a fresh local WordPress site via the Data Liberation Agent toolchain.
---

# Liberate

Move a site off a closed web platform and into a fresh local WordPress site. The skill orchestrates the Data Liberation Agent (DLA) tools to inspect the source, extract its content into a WXR archive plus media, then hands the artifacts off to Studio to create and populate the new site.

Based on the [Data Liberation Agent](https://github.com/Automattic/data-liberation-agent).

## On Startup

When the user invokes this skill, introduce yourself:

> **Welcome to Liberate!** I'll move your site off a closed platform (Wix, Squarespace, Shopify, Webflow, GoDaddy, HubSpot, Hostinger, or Weebly) into a fresh local WordPress site.
>
> I'll inspect the source, extract its content and media, verify the result, and then create a new Studio site populated with everything I find. You confirm at each step before I run the heavier extract and import phases.

Then move to Step 1.

## Step 1: Identify the source

If the user already gave a URL in their prompt (e.g. `/liberate https://example.com`), use it.

Otherwise, ask the user for the source URL of the site they want to liberate. Plain prose is fine — wait for their reply before continuing.

## Step 2: Inspect

Call `liberate_inspect` with the source URL. The tool fingerprints the platform, walks the sitemap, and samples a few pages to surface content counts and feature flags.

Tell the user what was detected:

- Detected platform (Wix, Shopify, etc.)
- Approximate page count, post count, and product count
- Any platform features that affect the migration (Shopify products, Wix dynamic pages, etc.)

## Step 3: Confirm

Use `AskUserQuestion` to confirm the user wants to proceed with the detected platform, with options like:

- "Yes, extract this site"
- "No, cancel"

**For Webflow:** if the detected platform is Webflow and `LIBERATION_TOKEN` is not set in the environment, tell the user they need to export a Webflow site token and set `LIBERATION_TOKEN=<token>` before re-running, then stop.

**For Shopify:** if the detected platform is Shopify and `SHOPIFY_ADMIN_TOKEN` is not set, tell the user they need a Shopify Admin API token with read access to products/orders and to set `SHOPIFY_ADMIN_TOKEN=<token>` before re-running, then stop.

If the platform is anything else, no extra credentials are required — proceed to Step 4.

## Step 4: Extract

Call `liberate_extract` with the source URL. The tool walks the discovered URLs, populates a WXR (WordPress eXtended RSS) archive, downloads media into the output directory, and writes a redirect map.

Narrate progress as the tool emits log events: which page is being fetched, media counts, and any retryable errors. Extraction can take several minutes for large sites; do not interrupt unless the user asks.

When extract completes, summarize what was produced: total pages and posts extracted, media files downloaded, output directory path, and any items that failed (these will be revisited in Step 5).

## Step 5: Verify

Call `liberate_verify` against the output directory. The verifier compares the WXR back against the source and reports a quality score plus actionable issues: stale CDN URLs, failed media downloads, parsing gaps, and the like.

Surface the report to the user:

- Quality score (good / needs improvement / poor)
- The top few issues that affect import fidelity
- Whether to proceed, retry extract, or cancel

If the score is poor and the user wants to retry, return to Step 4. Otherwise continue to Step 6.

## Step 6: Setup (delegate)

Call `liberate_setup` with `delegate: true`. In delegate mode the tool does not connect to a live WordPress REST endpoint — it returns a manifest describing the requirements Studio needs to satisfy on the destination side (WordPress version constraints, plugins to activate, media path mapping, etc.).

Read the manifest. The values you need from it for Step 7 and Step 8 flow through unchanged.

## Step 7: Create the Studio site

Derive a slug from the source domain — strip the scheme, drop `www.`, replace remaining dots and slashes with dashes, lowercase. E.g. `https://example.com/foo` becomes `example-com`. If the slug collides with an existing local site, append a numeric suffix (`example-com-2`).

Call Studio's `site_create` tool with that slug and a blueprint that inlines the WXR via `importWxr` (a `LiteralReference` to the WXR contents). This is the critical trick from DLA's preview path: importing the WXR **during** site creation routes through Playground and dodges Studio's WP-CLI IPC 120-second no-activity timeout. The post-creation `wp_cli` path is reserved for follow-up steps like products import.

Blueprint shape (sketch — fill the literal from the manifest's `wxrFile`):

```json
{
  "preferredVersions": { "php": "8.2", "wp": "latest" },
  "steps": [
    {
      "step": "importWxr",
      "file": {
        "resource": "literal",
        "name": "output.wxr",
        "contents": "<...WXR contents from manifest.wxrFile...>"
      }
    }
  ]
}
```

When `site_create` returns, capture the new site path and URL for Step 8 and Step 9.

## Step 8: Import (delegate)

Call `liberate_import` with `delegate: true`. The destructive mode is gated behind delegate — never call `liberate_import` without it from this skill. The tool returns a manifest:

```
{ wxrFile, outputDir, mediaDir, productsCsv?, redirectMap, importAuthors }
```

For each piece of the manifest:

- **`mediaDir`**: Copy media files from `mediaDir` into the newly created site's `wp-content/uploads/` using `Bash` or `Write` as appropriate.
- **`redirectMap`**: Hand the redirect map to the user (write it to disk inside the site directory) so they can wire it into a redirect plugin later.
- **`importAuthors`**: For each author entry, ensure the corresponding WP user exists. Use Studio's `wp_cli` tool with `user create` if needed.
- **`productsCsv`** (Shopify only): If present, run Studio's `wp_cli` tool with `wc product_importer <path>` to import the products. This requires WooCommerce to be active — verify with `wp_cli plugin list` and activate `woocommerce` first if it's not running.

The WXR import itself was already handled inside `site_create` via the `importWxr` blueprint step (Step 7), so do not re-import the WXR with `wp_cli import` here.

## Step 9: Wrap up

Summarize what landed: site name, URL, pages and posts imported, media count, products (if any).

Use `AskUserQuestion` to ask whether to open the site in the browser:

- "Open the site in my browser"
- "Stay in the CLI"

If the user picks open, call the appropriate site-open tool to launch the new URL. Otherwise, just print the URL.

## Important Notes

- **Use the Studio tools** (`site_create`, `wp_cli`, `site_info`, etc.) — not shell commands — for anything WordPress-side.
- **Never call `liberate_import` without `delegate: true`** — the non-delegate path mutates a remote WordPress site and Studio's policy blocks it.
- **Tool names here are bare** — call `liberate_inspect`, `liberate_extract`, etc. directly. DLA's tools surface as Studio's local `customTools`, not as MCP-prefixed remote tools, so no prefix is needed.
- **The `STUDIO_DLA_ENABLED` env var** must be set when `studio code` starts, or the DLA tools will not be present in the tool list. If you do not see `liberate_inspect` in your available tools, ask the user to restart `studio code` with `STUDIO_DLA_ENABLED=1`.

## Headless mode

Headless / non-interactive liberation is not handled by this skill. For a one-shot, non-agent run (CI scripts, bulk runs, etc.), point the user at the standalone `studio liberate <url>` CLI command instead — it spawns DLA's CLI directly and streams progress to the terminal without an agent in the loop.
