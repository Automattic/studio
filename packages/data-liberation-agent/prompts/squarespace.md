# Squarespace to WordPress Migration Prompt

Copy everything below this line and paste it into your AI assistant (Claude, ChatGPT, Gemini, etc.).

---

I want to migrate my website from Squarespace to WordPress. My Squarespace site URL is: **[PASTE YOUR SQUARESPACE URL HERE]**

I have (or will create) a WordPress site. Please help me migrate using the playbook at https://github.com/Automattic/data-liberation-agent — read AGENTS.md first for full instructions.

Here's what I need you to do:

## Step 1: Inspect my site

Run the inspection to see what we're working with:

```bash
npm run inspect -- [SQUARESPACE URL]
```

This will:
- Detect the platform and confirm it's Squarespace
- Scan the sitemap and categorize every URL (pages, blog posts, products, galleries, portfolios, etc.)
- Detect platform-specific features (Commerce, Memberships, Scheduling, Forms) and flag which ones transfer automatically vs which need a WordPress plugin
- Probe sample pages to test extractability

Show me the full inspection results — especially the feature flags — and wait for my approval before proceeding.

## Step 2: Set up admin extraction (recommended)

For the best results, I should extract via my Squarespace admin session. This gives access to **drafts, unlisted pages, and richer metadata** that aren't available publicly. Squarespace 7.1 sites using the fluid engine often return empty content from the public API — admin access fixes this.

Help me set this up:

1. **Launch Chrome with remote debugging:**
   ```bash
   # macOS:
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

   # Linux:
   google-chrome --remote-debugging-port=9222

   # Windows:
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
   ```

2. **In that Chrome window:** Navigate to my Squarespace site and **log in to my admin dashboard**

3. **Once logged in:** Confirm I'm ready and proceed to extraction

If I can't do admin extraction (e.g. I've already lost access), we can still extract public content — just skip the `--cdp-port` flag. The results will be less complete.

## Step 3: Extract all content

Run the full extraction with admin access:

```bash
npm run liberate -- [SQUARESPACE URL] --output ./output --cdp-port 9222 --verbose
```

Or without admin access (public only):

```bash
npm run liberate -- [SQUARESPACE URL] --output ./output --verbose
```

This will:
- Fetch each page's structured content via Squarespace's `?format=json` API
- With CDP: intercept admin API responses and `__NEXT_DATA__` hydration for richer content
- Fall back to Playwright DOM extraction for pages where JSON data is empty (common on 7.1 fluid engine sites)
- Download every image from Squarespace's CDN
- Extract the full blog archive (not limited to the 20-post RSS feed)
- Extract products as WooCommerce-compatible CSV (if commerce detected)
- Preserve for each piece of content: title, URL slug, publish date, categories/tags, SEO title and description, featured image

**If extraction gets interrupted:**

```bash
npm run liberate -- [SQUARESPACE URL] --output ./output --cdp-port 9222 --resume
```

## Step 4: Verify the extraction

Check the output before importing:

```bash
npm run verify -- ./output/[site-directory]
```

This reports:
- How many pages, posts, and media files were extracted
- Any stale Squarespace CDN URLs still in content
- Failed pages or media downloads
- Quality score breakdown
- Items needing manual attention

Show me the verification report. If there are failures, offer to investigate with `--resume` or the `/diagnose` workflow.

## Step 5: Set up WordPress

I need to create/have a WordPress site. Help me:
- Recommend a theme that matches my current site's visual style
- Create all categories and tags from my Squarespace site
- Configure basic settings: site title, tagline, permalink structure

Then validate the WordPress connection:

```bash
npm run setup -- --site [MY-WORDPRESS-SITE] --username [MY-USERNAME] --token [APP-PASSWORD]
```

This checks site reachability, REST API availability, and authentication. If anything fails, it shows step-by-step guidance (how to create an Application Password at WordPress Admin > Users > Profile > Application Passwords). Note: on WordPress.com and wpcomstaging.com sites, the password must be generated from the site's own wp-admin, not from wordpress.com/me/security/application-passwords (account-level passwords only work for the WordPress.com public API).

## Step 6: Import everything

```bash
npm run liberate -- import ./output/[site-directory]/output.wxr \
  --site [MY-WORDPRESS-SITE] --username [MY-USERNAME] --token [APP-PASSWORD]
```

This imports in order:
1. Media files to the WordPress media library (Squarespace CDN URLs are rewritten to WordPress URLs)
2. Categories and tags
3. Pages with correct parent/child relationships
4. Blog posts with correct dates, categories, tags, and featured images
5. Navigation menus
6. If products were extracted: import `products.csv` via WooCommerce > Products > Import in WP admin

All content is imported as **drafts** — you review and publish manually.

## Step 7: Verify the import

After import:
- Show me a URL mapping table: old Squarespace URL → new WordPress URL (from `redirect-map.json`)
- Flag any posts/pages that are missing or had import errors
- Run verify again to check for any images still pointing to Squarespace CDN URLs
- List everything that needs manual attention (forms, commerce, memberships, scheduling) with your recommendation for what WordPress plugin to use

Work methodically — do one step at a time, show me progress, and wait for my go-ahead before moving to the next step. If you hit something unexpected, tell me what you found rather than guessing.
