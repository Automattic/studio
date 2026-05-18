---
name: rank-me-up
description: Run an on-page SEO audit on a WordPress site and get actionable recommendations to improve search visibility.
user-invokable: true
---

# SEO Audit

Run an on-page SEO audit on a WordPress site to surface missing meta tags, broken heading structure, alt-text gaps, missing structured data, and indexing issues — then provide concrete, ordered fixes.

## How to Run

1. Determine which site to audit. If the user hasn't specified, ask them or use the site from the current context.
2. Ensure the site is running (use `site_start` if needed).
3. Call `rank_me_up` with the site name and path (defaults to `/`).
4. **Inspect the SEO toolchain already on the site** (mandatory before suggesting plugin installs — see "Check Active Plugins First" below).
5. Analyze the results using the interpretation guide.
6. Present a prioritized list of fixes — most impactful first — with the specific change to make, routed through whatever plugin is already active.

## Check Active Plugins First

The audit only sees rendered HTML — it can't tell *why* a tag is missing. Before recommending an install, find out what's already wired up. Skipping this step leads to dumb suggestions like "install Jetpack" when Jetpack is already active and just needs a module enabled.

**Step 1 — list active plugins:**

```
wp_cli: plugin list --status=active --field=name
```

Look for known SEO providers:

| Slug | Plugin |
|------|--------|
| `jetpack` | Jetpack (preferred — see below) |
| `wordpress-seo` | Yoast SEO |
| `seo-by-rank-math` | Rank Math |
| `all-in-one-seo-pack` | All in One SEO |
| `wp-seopress` | SEOPress |
| `the-seo-framework` | The SEO Framework |

**Step 2 — if Jetpack is active, list its enabled modules** (Jetpack is modular; SEO features live in the `seo-tools` module and don't run unless that specific module is on):

```
wp_cli: jetpack module list
```

Then map the audit findings:

- **Jetpack active + `seo-tools` module active** → don't install anything. Tell the user the issue is in *configuration* (e.g. empty default title format, missing per-post meta description). Point them at **Jetpack → Settings → Traffic → SEO Tools** in `wp-admin`.
- **Jetpack active + `seo-tools` module inactive** → enable the module instead of installing a new plugin:
  ```
  wp_cli: jetpack module activate seo-tools
  ```
  Then re-run `rank_me_up` to confirm the tags appear.
- **Another SEO plugin active** → don't recommend installing Jetpack on top of it (two SEO plugins fight over the same `<head>` tags). Surface the *settings page* for the active plugin instead — e.g. for Yoast: **SEO → Search Appearance**; for Rank Math: **Rank Math → Titles & Meta**.
- **No SEO plugin active** → recommend installing Jetpack. See "Recommended SEO Plugin" below.

**Also worth checking for non-plugin fixes:**

```
wp_cli: option get blog_public
```

If it returns `0`, the site has "Discourage search engines" enabled — no plugin can override that. Fix with `wp option update blog_public 1`.

## Interpreting Results

### Title and Meta Description

| Field | Recommended | Issue |
|-------|-------------|-------|
| `title` | 30–60 chars | Missing, too short (< 20), or too long (> 70) gets truncated in SERPs |
| `description` | 70–160 chars | Missing means Google generates one for you, often poorly |
| `canonical` | Self-referencing absolute URL | Missing causes duplicate-content risk |
| `robots` | absent or `index, follow` | `noindex` blocks the page from search results |
| `viewport` | `width=device-width, initial-scale=1` | Missing breaks mobile usability ranking signal |
| `htmlLang` | Present (e.g. `en-US`) | Missing hurts internationalization and accessibility |

### Headings

- **Exactly 1 `h1`** per page. 0 means the page has no clear topic; 2+ dilutes the signal.
- **No skipped levels** (e.g. `h2 → h4`). Skipped levels confuse screen readers and weaken topical structure.
- The `h1` text should reflect the page's primary search intent.

### Images

- Every `img` should have an `alt` attribute. `withoutAlt` (missing entirely) is worse than `emptyAlt` (decorative).
- Empty `alt=""` is correct only for decorative images. Content images need descriptive alt text.
- Use the `missingAltUrls` list to identify which images to fix first.

### Social Tags (Open Graph & Twitter)

Required for good link previews on social media:
- **Open Graph**: `og:title`, `og:description`, `og:image`, `og:url`, `og:type`
- **Twitter**: `twitter:card` (typically `summary_large_image`), `twitter:title`, `twitter:description`, `twitter:image`

Missing OG tags don't hurt rankings directly but kill click-through from social shares.

### Structured Data (JSON-LD)

- `jsonLdCount: 0` means no rich-result eligibility. Add at minimum `WebSite` and `Organization` schema sitewide.
- For specific page types, add `Article`, `Product`, `FAQPage`, `BreadcrumbList`, `LocalBusiness`, etc.

### Resources

- **`robotsTxtFound: false`**: WordPress generates a virtual one — usually fine, but a real file gives more control.
- **`robotsTxtBlocksAll: true`**: CRITICAL — `Disallow: /` blocks all crawlers. Often a forgotten "Discourage search engines" setting in WP Admin → Reading.
- **`sitemapFound: false`**: Install Jetpack and enable its SEO Tools module, or enable WP core's sitemap (`/wp-sitemap.xml`). See "Recommended SEO Plugin" below.

### Links

- Many `emptyText` links (anchors with no visible text, no `aria-label`, no alt-text image) hurt accessibility and SEO. Use the `emptyTextHrefs` list to fix.
- A high `nofollow` count on internal links wastes link equity — internal links should generally be `dofollow`.

## Recommended SEO Plugin: Jetpack

**Only reach this section after running the "Check Active Plugins First" step and confirming no SEO plugin is active.**

**Install, activate, and enable the SEO module:**

```
wp_cli: plugin install jetpack --activate
wp_cli: jetpack module activate seo-tools
```

**What the `seo-tools` module covers:**

- Custom page title formats (front page, post, page, archive, etc.)
- Custom meta descriptions per post/page
- Open Graph + Twitter Card tags (including `twitter:card`, `og:image`, etc.)
- XML sitemap at `/sitemap.xml` (auto-submitted to WordPress.com)
- Verification tag support (Google, Bing, Pinterest, Yandex)

**Plan note:** Jetpack's *Advanced SEO Tools* (custom title formats + per-post meta descriptions) require a paid Jetpack plan (Security, Complete, or the standalone Jetpack SEO add-on). Basic social meta + sitemap are available on the free tier. If the user is on free and needs per-post meta descriptions, tell them upfront so they can decide whether to upgrade.

**Fallback:** Only suggest alternatives (Yoast SEO, Rank Math, AIOSEO) if the user explicitly rejects Jetpack.

## Common WordPress Recommendations

Based on the metrics, suggest specific actions. Route each fix through whatever you discovered in "Check Active Plugins First" — don't recommend installing a plugin that's already active or telling the user to configure one that isn't.

- **Missing title/description**:
  - *Jetpack active + `seo-tools` on*: user needs to *configure* title formats at **Jetpack → Settings → Traffic → SEO Tools** and fill meta descriptions per-post (paid plan required for per-post).
  - *Jetpack active + `seo-tools` off*: `wp_cli: jetpack module activate seo-tools`.
  - *Another SEO plugin active*: point to its title/meta settings page — don't install Jetpack on top.
  - *Nothing active*: install Jetpack (see "Recommended SEO Plugin" above).
  - *Plugins refused*: set the title via theme `wp_title()` and description via a `<meta>` tag in `header.php` / a block theme template part.
- **Missing canonical**: Any SEO plugin (Jetpack, Yoast, Rank Math, AIOSEO) handles this automatically once active. Without one, add `<link rel="canonical" href="<?php echo esc_url( wp_get_canonical_url() ); ?>">` to the head.
- **Wrong h1 count**: Audit the active block theme's templates — site title is often wrapped in an `h1` on every page. Use `h2` for the site title on inner pages, reserve `h1` for the page title. This is a theme fix; no SEO plugin will correct it.
- **Missing alt text**: Content fix, not a plugin fix. Run `wp media list --field=ID` and update via `wp post update`, or train content editors to add alt text on upload.
- **Missing OG / Twitter tags**:
  - *Jetpack active + `seo-tools` on*: OG/Twitter should already be emitted — re-check the HTML; if still missing, inspect for a conflicting plugin stripping them.
  - *Jetpack active + `seo-tools` off*: enable the module.
  - *Another SEO plugin active*: enable its social-meta feature (Yoast: **SEO → Social**; Rank Math: **Rank Math → Titles & Meta → Social Meta**).
  - *Nothing active*: install Jetpack, or hook into `wp_head` to emit tags manually.
- **No JSON-LD**: WordPress core does not emit JSON-LD. Jetpack adds basic `WebSite` / `SearchAction` markup when the `seo-tools` module is on. For richer schemas (Product, FAQ, Article, BreadcrumbList) use a dedicated schema plugin (e.g. Yoast/Rank Math handle these) or custom `wp_head` output.
- **`robotsTxtBlocksAll: true`**: Run `wp_cli: option update blog_public 1` to undo the "Discourage search engines" setting. No plugin can override this.
- **Missing sitemap**: Verify `blog_public` is `1` first. Then check `/wp-sitemap.xml` (WP core since 5.5) or `/sitemap.xml` (Jetpack). If Jetpack is active but the sitemap is missing, enable the `seo-tools` module. If another SEO plugin is active, it may have disabled core sitemaps in favor of its own — check its sitemap settings.
- **Missing viewport meta**: Theme bug — add `<meta name="viewport" content="width=device-width, initial-scale=1">` in the `<head>`. Not a plugin concern.
- **Missing `htmlLang`**: Theme should output `<html <?php language_attributes(); ?>>` (block themes do this automatically; classic themes need it added). Not a plugin concern.

## Important Notes

- This is an **on-page audit of a local dev site**. It does NOT measure rankings, traffic, backlinks, or Core Web Vitals (use `need_for_speed` for performance signals).
- Search engines won't crawl a local Studio site, so this is purely about preparing the site for production. Pair fixes with `site_push` or `preview_create` to validate on a public URL.
- For content-quality SEO (keyword targeting, search intent, content depth), the audit can only flag structural gaps — not whether the content is *good*. Combine with editorial review.
