# Wix to WordPress Migration Prompt

Copy everything below this line and paste it into your AI assistant (Claude, ChatGPT, Gemini, etc.).

---

I want to migrate my website from Wix to WordPress. My Wix site URL is: **[PASTE YOUR WIX URL HERE]**

I have (or will create) a WordPress site. Please help me migrate using the playbook at https://github.com/Automattic/data-liberation-agent — read AGENTS.md first for full instructions.

Here's what I need you to do:

## Step 1: Inspect my site

Run the inspection to see what we're working with:

```bash
npm run inspect -- [WIX URL]
```

This will:
- Detect the platform and confirm it's Wix
- Scan the sitemap and categorize every URL (pages, blog posts, products, galleries, events, etc.)
- Detect platform-specific features (Wix Stores, Bookings, Forms, Members Area, Events, Forum) and flag which ones transfer automatically vs which need a WordPress plugin
- Probe sample pages to test extractability

Show me the full inspection results — especially the feature flags — and wait for my approval before proceeding.

## Step 2: Extract all content

Run the full extraction:

```bash
npm run liberate -- [WIX URL] --output ./output --verbose
```

This uses a headless browser to:
- Load every page and intercept Wix's internal API calls (the `/_api/` and `wixapis.com` responses contain the real content)
- Extract window globals (`__WIX_DATA__`, `__SITE_DATA__`, etc.) and JSON-LD structured data
- Fall back to DOM extraction and accessibility tree if API data is sparse
- Download every image from Wix's CDN (wixstatic.com/wixmp.com)
- Extract products as WooCommerce-compatible CSV (if store detected)
- Preserve for each piece of content: title, URL slug, publish date, categories/tags, SEO title and description, featured image

**For large sites:** Extraction may take several minutes. If it gets interrupted, resume with:

```bash
npm run liberate -- [WIX URL] --output ./output --resume
```

## Step 3: Verify the extraction

Check the output before importing:

```bash
npm run verify -- ./output/[site-directory]
```

This reports:
- How many pages, posts, and media files were extracted
- Any stale Wix CDN URLs still in content (these will break if Wix changes anything)
- Failed pages or media downloads
- Quality score breakdown
- Items needing manual attention

Show me the verification report. If there are failures, offer to investigate with `--resume` or the `/diagnose` workflow.

## Step 4: Set up WordPress

I need to create/have a WordPress site. Help me:
- Recommend a theme that matches my current site's visual style
- Create all categories and tags from my Wix site
- Configure basic settings: site title, tagline, permalink structure

Then validate the WordPress connection:

```bash
npm run setup -- --site [MY-WORDPRESS-SITE] --username [MY-USERNAME] --token [APP-PASSWORD]
```

This checks site reachability, REST API availability, and authentication. If anything fails, it shows step-by-step guidance (how to create an Application Password at WordPress Admin > Users > Profile > Application Passwords). Note: on WordPress.com and wpcomstaging.com sites, the password must be generated from the site's own wp-admin, not from wordpress.com/me/security/application-passwords (account-level passwords only work for the WordPress.com public API).

## Step 5: Import everything

```bash
npm run liberate -- import ./output/[site-directory]/output.wxr \
  --site [MY-WORDPRESS-SITE] --username [MY-USERNAME] --token [APP-PASSWORD]
```

This imports in order:
1. Media files to the WordPress media library (Wix CDN URLs are rewritten to WordPress URLs)
2. Categories and tags
3. Pages with correct parent/child relationships
4. Blog posts with correct dates, categories, tags, and featured images
5. Navigation menus
6. If products were extracted: import `products.csv` via WooCommerce > Products > Import in WP admin

All content is imported as **drafts** — you review and publish manually.

## Step 6: Verify the import

After import:
- Show me a URL mapping table: old Wix URL → new WordPress URL (from `redirect-map.json`)
- Flag any posts/pages that are missing or had import errors
- Run verify again to check for any images still pointing to Wix CDN URLs
- List everything that needs manual attention (bookings, forms, members area, events) with your recommendation for what WordPress plugin to use

Work methodically — do one step at a time, show me progress, and wait for my go-ahead before moving to the next step. If you hit something unexpected, tell me what you found rather than guessing.
