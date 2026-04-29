---
name: migrate
description: Migrate a site from a closed platform (Wix, Squarespace, Shopify, Webflow, Weebly, GoDaddy, Hostinger, HubSpot) into a fresh local Studio site. Walks the user through detect, extract, verify, create, import.
argument-hint: <source-url>
user-invocable: true
allowed-tools: mcp__data-liberation__liberate_inspect, mcp__data-liberation__liberate_extract, mcp__data-liberation__liberate_verify, mcp__data-liberation__liberate_setup, mcp__data-liberation__liberate_import, mcp__studio__site_create, mcp__studio__site_list, mcp__studio__site_info, mcp__studio__wp_cli, AskUserQuestion
---

# Migrate

Move a site from a closed platform into a fresh local Studio site. Powered by the [Data Liberation Agent](https://github.com/Automattic/data-liberation-agent), which extracts content into a WordPress eXtended RSS (WXR) file plus a media folder; this skill drives that pipeline and lands the result as a new Studio site.

Supported platforms: GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix.

## On Startup

When the user invokes this skill, introduce yourself:

> **Welcome to Migrate!** I'll move your site from Wix, Squarespace, Shopify, Webflow, Weebly, GoDaddy, Hostinger, or HubSpot into a fresh local Studio site.
>
> Here's the plan: I'll inspect the source, extract its content into a WordPress-compatible export, run a quality check, then create a brand-new Studio site and import everything. Nothing is uploaded anywhere — the new site lives locally under `~/Studio/`.

Then proceed to Step 1.

## Step 1: Identify the source

If the user invoked the skill with an inline URL (`/migrate https://example.wixsite.com/foo`), use that URL.

Otherwise, ask the user for the source URL in your text output. **Stop and wait for their reply** — do NOT call any tools yet. The user needs to type the URL into the prompt.

Normalize the URL: trim whitespace, ensure it starts with `http://` or `https://`, and strip a trailing slash.

## Step 2: Inspect

Call `mcp__data-liberation__liberate_inspect` with the URL. This combines platform fingerprinting, sitemap discovery, a sample probe, and platform feature flags into a single report.

Narrate the result back to the user in plain prose:

> Detected **Wix**. Found **47 pages** and **12 blog posts**. The site uses a custom Wix theme; images are served from `static.wixstatic.com`.

Pay attention to:

- **Platform** (`wix`, `squarespace`, `shopify`, `webflow`, `weebly`, `godaddy`, `hostinger`, `hubspot`) — drives later decisions.
- **Page / post / product counts** — sets user expectations for extraction time.
- **Platform features** — e.g. members-only content, a Shopify product catalogue, Squarespace Commerce.

If the inspect call fails or returns an unsupported platform, surface the error and stop. Do not guess.

## Step 3: Confirm

Use `AskUserQuestion` with options like:

- "Yes, extract this site"
- "No, cancel"

If the detected platform is **Webflow**, the extraction needs a `LIBERATION_TOKEN` environment variable. If the detected platform is **Shopify**, it needs `SHOPIFY_ADMIN_TOKEN`. Check whether either is already in the environment by referencing the inspection output (DLA's MCP server reports back whether the token was found). If not, **ask the user** to set it before continuing — do not try to inject the token yourself. Provide the exact shell line they need:

```
export LIBERATION_TOKEN=…
```

Stop the skill if the user does not have the token. They can re-run `/migrate` once it is set.

## Step 4: Extract

Call `mcp__data-liberation__liberate_extract` with the source URL. The extraction is resume-safe (it writes an extraction log, session state, media stub manifest, and product stream as it goes).

The MCP server emits `sendLoggingMessage` events during extraction — narrate them back to the user as they arrive, so they can see progress. Do not try to summarize the volume of events; surface meaningful checkpoints (e.g. "Downloaded 23 of 47 pages", "Pulled 12 media files", "Finished").

When extraction finishes, the response includes the output directory containing `output.wxr`, `media/`, `redirect-map.json`, and (for Shopify) `products.csv`.

## Step 5: Verify

Call `mcp__data-liberation__liberate_verify` against the same output dir. This produces a quality report covering:

- Pages and posts that failed to extract.
- Media that could not be downloaded.
- Stale CDN URLs still embedded in content.
- Per-stage quality scores.

Surface anything below acceptable quality to the user. Use `AskUserQuestion`:

- "Proceed with the import anyway"
- "Retry the extraction" (re-runs Step 4; DLA resumes from where it left off)
- "Cancel the migration"

## Step 6: Setup (delegate)

Call `mcp__data-liberation__liberate_setup` with `delegate: true`. In delegate mode, this returns a manifest of requirements (target WP URL, app password, etc.) **without** doing anything itself — Studio handles the actual site creation. We need delegate mode here because Studio is the runtime host: we own the local site lifecycle, not DLA.

Capture the manifest. The next step uses it to construct the Studio site.

## Step 7: Create the Studio site

Derive a slug from the source domain. Strip the protocol, replace dots and slashes with dashes, append `-migrated`. Examples:

- `https://example.wixsite.com/foo` → `example-wixsite-com-migrated`
- `https://my-shop.myshopify.com/` → `my-shop-myshopify-com-migrated`
- `https://practicum.squarespace.com/` → `practicum-squarespace-com-migrated`

Call `mcp__studio__site_create` with that slug as the site `name`. Studio will set up the directory under `~/Studio/`, install WordPress, register the site, and start the server. `site_create` returns the URL, admin credentials, and PHP version.

### The `importWxr` blueprint shape

For very large WXR exports, the standard `wp import` route runs into Studio's WP-CLI IPC bridge 120-second no-activity timeout. DLA solves this by inlining the WXR contents directly into the `blueprint.studio.json` that drives site creation, using the `importWxr` blueprint step:

```json
{
  "$schema": "https://playground.wordpress.net/blueprint-schema.json",
  "preferredVersions": { "php": "8.2", "wp": "latest" },
  "steps": [
    {
      "step": "importWxr",
      "file": {
        "resource": "literal",
        "name": "output.wxr",
        "contents": "<full WXR XML inlined here>"
      }
    }
  ]
}
```

When `site_create` accepts a blueprint, drop the WXR contents in via a `LiteralReference` (`resource: "literal"`) so the import runs as part of site bootstrap rather than after. This is the same path DLA uses internally (`wave-1-dla-inventory.md` §9).

If `site_create` does not yet expose a blueprint argument in this version of Studio, fall back to:

1. Create the site without a blueprint.
2. Use `mcp__studio__wp_cli` with `import /path/to/output.wxr --authors=create` after the site is up.

Both paths land at the same place. Prefer the inlined-blueprint path when available — it's faster and avoids the WP-CLI timeout for large exports.

## Step 8: Import (delegate)

Call `mcp__data-liberation__liberate_import` with `delegate: true`. This returns a structured manifest:

```
{
  wxrFile:        "<absolute path to output.wxr>",
  outputDir:      "<absolute path to the extraction dir>",
  mediaDir:       "<absolute path to media/ inside outputDir>",
  productsCsv:    "<absolute path to products.csv, if Shopify>",
  redirectMap:    "<absolute path to redirect-map.json>",
  importAuthors:  true | false
}
```

What to do with each piece:

1. **`wxrFile`** — already imported by Step 7 (via the inlined-blueprint path). If you took the fallback in Step 7, run `mcp__studio__wp_cli` with `import {wxrFile} --authors=create` now.
2. **`mediaDir`** — copy or symlink the media files into the new site's `wp-content/uploads/`. Use `mcp__studio__wp_cli` with `media import {mediaDir}/* --skip-copy` if available, otherwise advise the user to copy the directory manually.
3. **`productsCsv`** (Shopify only) — call `mcp__studio__wp_cli` with `wc product_importer {productsCsv}`. This requires WooCommerce to be active on the site; install it first via `wp_cli`: `plugin install woocommerce --activate`. Without this step Shopify products won't land.
4. **`redirectMap`** — log the path so the user knows where to wire 301s if they push the site to production. This skill does not auto-install a redirect plugin; flag it as a follow-up the user can do manually.
5. **`importAuthors`** — if `true`, the `--authors=create` flag is what you want; if `false`, use `--authors=skip` to avoid creating ghost user accounts.

## Step 9: Wrap up

Summarize what landed:

- Site name and local URL (`http://example-wixsite-com-migrated.localhost:8881/` or whatever Studio assigned).
- Counts of imported pages, posts, media, products.
- Any quality issues from Step 5 the user chose to ignore.
- The path to the extraction `outputDir` so they can re-run the import or inspect raw artifacts.
- A pointer to `redirect-map.json` for future 301 wiring.

Use `AskUserQuestion`:

- "Open the site in my browser"
- "Open `wp-admin`"
- "I'm done — close out"

If the user picks "Open the site in my browser", suggest the URL via `mcp__studio__site_info`. If they picked "Open `wp-admin`", append `/wp-admin` to that URL. The skill itself does not open a browser — Studio's `studio code` host handles that.

## What this skill does NOT do

- **No headless mode.** `/migrate --headless` (running the entire pipeline non-interactively against a list of URLs) is intentionally out of scope. The agent is meant to be in the loop — verifying quality, asking for confirmation, choosing fallbacks. A headless variant would be a separate command and is deferred.
- **No production deploys.** This skill only creates a local Studio site. Pushing it to WordPress.com is `studio site push` — separate command, separate flow.
- **No multi-site merging.** One source URL → one fresh Studio site, every time. If the user wants to merge several extractions into one site, that's a manual `wp_cli import` chain, not this skill.
- **No theme conversion.** The migrated site uses the Studio default theme. Visual fidelity to the source is not a goal; content fidelity is.
- **No DLA preview path.** DLA exposes `liberate_preview` for booting a Playground or Studio preview from an output dir. This skill does not use it — Studio creates the site itself, in the user's `~/Studio/` directory, so the user owns the result.
