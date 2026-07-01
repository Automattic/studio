# GoDaddy Websites & Marketing to WordPress Migration Prompt

Copy everything below this line and paste it into your AI assistant (Claude, ChatGPT, Gemini, etc.).

---

I want to migrate my website from GoDaddy's legacy **Websites & Marketing** (W+M) platform to WordPress. My site URL is: **[PASTE YOUR SITE URL HERE]**

> **Note:** W+M is the older GoDaddy website builder (also called "Go Daddy Website Builder" in page sources), *not* the newer Airo AI Builder. GoDaddy offers no data export from W+M, so this adapter rescues your content by crawling the public site.

I have (or will create) a WordPress site. Please help me migrate using the playbook at https://github.com/Automattic/data-liberation-agent — read AGENTS.md first for full instructions.

Here's what I need you to do:

## Step 1: Inspect my site

Run the inspection to see what we're working with:

```bash
npm run inspect -- [SITE URL]
```

This will:
- Detect the platform and confirm it's GoDaddy Websites & Marketing (look for the `Go Daddy Website Builder` generator tag and `img1.wsimg.com/isteam` CDN)
- Fetch the three W+M sub-sitemaps (`sitemap.website.xml`, `sitemap.blog.xml`, `sitemap.ols.xml`) and categorize every URL
- Probe sample pages to test extractability

Show me the full inspection results and wait for my approval before proceeding.

## Step 2: Extract all content

Run the full extraction:

```bash
npm run liberate -- [SITE URL] --output ./output --verbose
```

This will:
- Fetch each page via HTTP
- For **blog posts**: parse the `window._BLOG_DATA` hydration blob and convert the Draft.js content structure (blocks + entityMap) into HTML, preserving paragraphs, headings, lists, links, and images
- For **pages**: strip the W+M header (`data-aid="HEADER_SECTION"`) and footer (`[data-aid^="FOOTER_"]`) and keep the remaining body content
- Download every image referenced from `img1.wsimg.com/isteam/...`
- Preserve for each piece of content: title, URL slug, publish date, categories, SEO title and description, featured image, author

**If extraction gets interrupted:**

```bash
npm run liberate -- [SITE URL] --output ./output --resume
```

## Step 3: Verify the extraction

```bash
npm run verify -- ./output/[site-directory]
```

This reports how many pages, posts, and media files were extracted; flags any failed pages or media; and summarizes quality scores. Show me the verification report.

## Step 4: Set up WordPress

I need to create/have a WordPress site. Help me:
- Recommend a theme that matches my current site's visual style
- Create any categories my W+M blog used
- Configure basic settings: site title, tagline, permalink structure

Then validate the WordPress connection:

```bash
npm run setup -- --site [MY-WORDPRESS-SITE] --username [MY-USERNAME] --token [APP-PASSWORD]
```

## Step 5: Import everything

```bash
npm run liberate -- import ./output/[site-directory]/output.wxr \
  --site [MY-WORDPRESS-SITE] --username [MY-USERNAME] --token [APP-PASSWORD]
```

Imports in order: media files, categories, pages, blog posts (with dates, categories, featured images), and navigation menus. All content is imported as **drafts** — you review and publish manually.

## Step 6: Verify the import

After import:
- Show me a URL mapping table: old W+M URL -> new WordPress URL (from `redirect-map.json`)
- Flag any posts/pages that are missing or had import errors
- Run verify again to check for any images still pointing to `img1.wsimg.com`
- List everything that needs manual attention

## Known limitations of v1

- **No GoDaddy Online Store (OLS) product extraction yet.** If your W+M site has a store, products will not be migrated in v1. Let the team know — OLS support is planned for v1.1 once a real store URL is available for testing.
- **Thin-content pages** (e.g. domain-alias landing pages) may extract little more than their title and featured image, since W+M only surfaces the minimal DOM for those.

Work methodically — do one step at a time, show me progress, and wait for my go-ahead before moving to the next step.
