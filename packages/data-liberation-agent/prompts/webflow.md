# Webflow to WordPress Migration Prompt

Copy everything below this line and paste it into your AI assistant (Claude, ChatGPT, Gemini, etc.).

---

I want to migrate my website from Webflow to WordPress. My Webflow site URL is: **[PASTE YOUR WEBFLOW URL HERE]**

I have (or will create) a WordPress site. Please help me migrate using the playbook at https://github.com/Automattic/data-liberation-agent — read AGENTS.md first for full instructions.

Here's what I need you to do:

## Step 1: Inspect my site

Run the inspection to see what we're working with:

```bash
npm run inspect -- [WEBFLOW URL]
```

This will:
- Detect the platform and confirm it's Webflow
- Scan the sitemap and categorize every URL (pages, blog posts, products, etc.)
- Detect platform-specific features (E-commerce, Forms) and flag which ones transfer automatically vs which need a WordPress plugin
- Probe sample pages to test extractability

Show me the full inspection results — especially the feature flags — and wait for my approval before proceeding.

## Step 2: Extract all content

Run the full extraction:

```bash
npm run liberate -- [WEBFLOW URL] --output ./output --verbose
```

This will:
- Fetch each page via HTTP and extract content from Webflow's `.w-richtext` containers
- Fall back to `<main>`, `<article>`, or common content selectors if no rich text container is found
- Parse JSON-LD structured data for metadata
- Download every image
- Extract products as WooCommerce-compatible CSV (if e-commerce detected)
- Preserve for each piece of content: title, URL slug, publish date, categories/tags, SEO title and description, featured image

**If extraction gets interrupted:**

```bash
npm run liberate -- [WEBFLOW URL] --output ./output --resume
```

## Step 3: Verify the extraction

Check the output before importing:

```bash
npm run verify -- ./output/[site-directory]
```

This reports:
- How many pages, posts, and media files were extracted
- Any stale Webflow CDN URLs still in content (assets-global.website-files.com)
- Failed pages or media downloads
- Quality score breakdown
- Items needing manual attention

Show me the verification report. If there are failures, offer to investigate with `--resume` or the `/diagnose` workflow.

## Step 4: Set up WordPress

I need to create/have a WordPress site. Help me:
- Recommend a theme that matches my current site's visual style
- Create all categories and tags from my Webflow site
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
1. Media files to the WordPress media library
2. Categories and tags
3. Pages with correct parent/child relationships
4. Blog posts with correct dates, categories, tags, and featured images
5. Navigation menus
6. If products were extracted: import `products.csv` via WooCommerce > Products > Import in WP admin

All content is imported as **drafts** — you review and publish manually.

## Step 6: Verify the import

After import:
- Show me a URL mapping table: old Webflow URL -> new WordPress URL (from `redirect-map.json`)
- Flag any posts/pages that are missing or had import errors
- Run verify again to check for any images still pointing to Webflow CDN URLs
- List everything that needs manual attention (forms, interactions, animations) with your recommendation for what WordPress plugin to use

Work methodically — do one step at a time, show me progress, and wait for my go-ahead before moving to the next step. If you hit something unexpected, tell me what you found rather than guessing.
