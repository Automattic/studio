# Shopify to WordPress Migration Prompt

Copy everything below this line and paste it into your AI assistant (Claude, ChatGPT, Gemini, etc.).

---

I want to migrate my website from Shopify to WordPress. My Shopify site URL is: **[PASTE YOUR SHOPIFY URL HERE]**

I have (or will create) a WordPress site. Please help me migrate using the playbook at https://github.com/Automattic/data-liberation-agent — read AGENTS.md first for full instructions.

Here's what I need you to do:

## Step 1: Inspect my site

Run the inspection to see what we're working with:

```bash
npm run inspect -- [SHOPIFY URL]
```

This will:
- Detect the platform and confirm it's Shopify
- Scan the sitemap and categorize every URL (pages, blog posts, products, collections, etc.)
- Detect platform-specific features (Store/E-commerce) and confirm product extraction is supported
- Probe sample pages to test extractability

Show me the full inspection results and wait for my approval before proceeding.

## Step 2: Extract all content

Ask the AI about which of the two extraction tiers is right for you:

**Tier 1 — Public extraction (no credentials needed)**

```bash
npm run liberate -- [SHOPIFY URL] --output ./output --verbose
```

Uses Shopify's public JSON API (`/pages.json`, `/blogs.json`, `/products.json`) plus HTML fallback. Works on any public Shopify store without any login or token. Gets you the basics: pages, blog posts, products with prices and variants, images, categories, and tags.

**Tier 2 — Admin API extraction (richer product data)**

If you have admin access to your store, this gets you significantly more product detail: proper sale pricing, real stock policy, cost of goods, variant-level images, collection categories, and SEO metafields.

To enable it, create a custom app in Shopify Admin:
1. Go to **Settings → Apps and sales channels → Develop apps → Create an app**.
2. Name it anything (e.g. "Data Liberation").
3. Under **Configuration → Admin API access scopes**, enable: `read_products`, `read_inventory`, `read_content`, `read_online_store_pages`, and `read_online_store_navigation`.
4. Click **Install app** to generate an Admin API access token — copy it immediately, Shopify only shows it once.
5. Pass the token when running extraction:
   ```bash
   npm run liberate -- [SHOPIFY URL] --output ./output --admin-token shpat_xxx --verbose
   ```

You do **not** need to tell the tool your `myshopify.com` subdomain — it auto-detects that from your storefront HTML, even if you use a custom domain.

**Either tier will:**
- Use Shopify's public JSON API (`/pages.json`, `/blogs.json`, `/products.json`) for structured content when available
- Fall back to appending `.json` to individual page URLs for article/page data
- Fall back to HTML extraction if JSON API is unavailable
- Download every image from Shopify's CDN
- Extract **all products** with full detail: name, description, price, sale price, SKU, images, variants (sizes, colors), stock status, categories, and tags
- Products with multiple variants are exported as WooCommerce variable products with linked variations
- Preserve for each piece of content: title, URL slug, publish date, categories/tags, SEO title and description, featured image

**If extraction gets interrupted:**

```bash
npm run liberate -- [SHOPIFY URL] --output ./output --resume
```

## Step 3: Verify the extraction

Check the output before importing:

```bash
npm run verify -- ./output/[site-directory]
```

This reports:
- How many pages, posts, and media files were extracted
- Any stale Shopify CDN URLs still in content (cdn.shopify.com)
- Failed pages or media downloads
- Quality score breakdown
- Items needing manual attention

Show me the verification report. Pay special attention to the product count — compare it against what's visible on the Shopify store to make sure nothing was missed.

## Step 4: Set up WordPress

I need to create/have a WordPress site. Help me:
- Recommend a theme that matches my current site's visual style
- Create all categories and tags from my Shopify site
- Configure basic settings: site title, tagline, permalink structure
- **If migrating products:** install WooCommerce on the WordPress site

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
1. Media files to the WordPress media library (Shopify CDN URLs are rewritten to WordPress URLs)
2. Categories and tags
3. Pages with correct parent/child relationships
4. Blog posts with correct dates, categories, tags, and featured images
5. Navigation menus

**For products:** Import `products.csv` via WooCommerce > Products > Import in WP admin. The CSV includes:
- Simple products (single variant)
- Variable products with linked variations (sizes, colors, etc.)
- Sale prices, SKUs, stock status, images

## Step 6: Verify the import

After import:
- Show me a URL mapping table: old Shopify URL -> new WordPress URL (from `redirect-map.json`)
- Flag any posts/pages that are missing or had import errors
- Run verify again to check for any images still pointing to Shopify CDN URLs
- Compare the WooCommerce product count against the original Shopify store
- List everything that needs manual attention with your recommendation for what WordPress plugin to use

Work methodically — do one step at a time, show me progress, and wait for my go-ahead before moving to the next step. If you hit something unexpected, tell me what you found rather than guessing.
