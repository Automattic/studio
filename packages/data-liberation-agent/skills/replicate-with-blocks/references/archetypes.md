# Archetype → Template & Pattern Mapping

This reference defines what each `classifyUrl` archetype needs in the replica theme. The numbers in `liberate_replicate_inventory.archetypes.<type>.count` tell you how much investment is justified.

## Decision shorthand

| Count | Treatment |
|---|---|
| `0` | Skip silently. No template. |
| `1-4` | Minor. One simple template, no dedicated patterns. Generic core blocks. |
| `5+` | Primary. Dedicated template, 2-4 dedicated patterns, run verification on a representative. |

The verification pass should hit at least one URL per primary archetype.

## homepage (always create, even at count 0)

The homepage is the agent-facing landing template. It composes the most patterns and is the most visible artifact. Always invest here.

**Template:** `templates/index.html`

**Section patterns to consider** (pick what the source actually uses — match the screenshot):

- Hero with primary CTA — required.
- Logo strip / social proof — only if visible in source.
- Feature grid — common on SaaS, agency, product sites.
- Content with media — alternating left/right text+image blocks.
- Testimonials or case studies — only if visible.
- FAQ — only if visible.
- Final CTA — required at the bottom.

**Wrap each section in a top-level `wp:group`** with `align: full` and zero top margin (per `creating-themes` instructions). This gives users editor-level control.

**Hero rule:** the hero must use the design foundation's `accent.primary` for the primary CTA and `surface.inverse` for any dark hero variant. Do not emit raw hex.

## page (treat as primary if count >= 3)

Pages are the catch-all for "About," "Contact," "Pricing," "FAQ," etc. They vary widely. Use the rendered HTML to identify section structure.

**Template:** `templates/page.html`

Minimal template:

```
Header (template part)
Group (align: wide)
  └── Title (h1)
  └── Post Content
Footer (template part)
```

If the source pages have hero sections that differ from the homepage hero, add a `pattern: page-hero` and reference it from `page.html`. If the source pages are mostly long-form text, default to a constrained-width content area (`contentSize` from theme.json).

**Common Wix/Squarespace/Webflow trap:** marketing pages on these platforms are often the same layout shape as the homepage (hero + sections + CTA). When the rendered HTML structure looks identical to the homepage, reuse the homepage section patterns instead of creating duplicates.

## post (treat as primary if count >= 5)

Blog posts. Have title, date, author, content, optional featured image, optional related posts.

**Templates:**

- `templates/single.html` — single post page.
- `templates/home.html` or `templates/archive.html` — post listing page (build only if there's a blog index URL in the source).

**single.html structure:**

```
Header
Group (align: wide)
  └── Cover (featured image, if source has them)
  └── Title (h1)
  └── Group (post meta — author, date)
  └── Post Content
  └── Group (related posts — Query Loop, optional)
Footer
```

Use `wp:post-title`, `wp:post-content`, `wp:post-featured-image`, `wp:post-author`, `wp:post-date` — these are the FSE blocks. Read `creating-themes/references/query-loop.md` for the listing patterns.

## product (treat as primary if count >= 5; activates Woo path)

Product pages. Have a name, price, images, description, variants, CTA.

**If `products.jsonl` is present, Woo is required.** The `liberate_replicate_install` call should ensure WooCommerce is installed in the target.

**Templates (Woo):**

- `templates/single-product.html` — single product page. Use `wp:woocommerce/product-image-gallery`, `wp:woocommerce/product-title`, `wp:woocommerce/product-price`, `wp:woocommerce/add-to-cart-form`, `wp:woocommerce/product-meta`, `wp:woocommerce/product-tabs`.
- `templates/archive-product.html` — shop page. Use `wp:woocommerce/product-collection` (the Woo block-theme native list block), styled to match the source's grid.
- Optional: `templates/taxonomy-product_cat.html` — only if the source has category pages.

**Templates (no Woo, count < 5):**

- Treat product pages as `page.html` with a custom pattern. Don't activate Woo for a 1-2 product site — too much overhead.

**Pattern: `product-card`** — one card layout used in `product-collection`. Include image, name, price, "Add to cart" button. Match the source's spacing and typography ratios from the screenshot.

**Pattern: `product-hero`** — used on `single-product.html`. Two-column: gallery left, info right. Or stacked, depending on what the source does.

**Verification gotcha:** Woo block themes can render very differently from a custom HTML/JS Shopify product page. The `paletteScore` and `typographyScore` should still hit threshold — those are about tokens, not layout — but `structuralScore` will be lower for product templates than for homepage/page templates. Adjust the threshold to ~0.65 for product templates if needed.

## gallery (treat as primary if count >= 3)

Image-heavy pages. Common on photography, agency, restaurant sites.

**Template:** `templates/page-gallery.html` (or repurpose `page.html` with a gallery pattern).

**Pattern: `gallery-masonry`** — Use `wp:gallery` with `columns: 3` (or whatever the source uses) and `imageCrop: false` for variable heights. Set generous gap.

If the source gallery uses lightbox behavior, set `wp:gallery` `lightbox` attribute to `enabled: true`. WordPress core supports this without a plugin.

## event (treat as primary if count >= 3)

Event listings. Have date, location, description, RSVP CTA.

**Template:** `templates/single-event.html` — only if a custom post type was created for events. Otherwise treat as `page.html` with an `event-detail` pattern.

The replica may need a small companion plugin to register a CPT and a few meta fields if the WXR contains custom post types. Generate this only if the WXR includes `<wp:post_type>` values other than `post`, `page`, `attachment`, `product`. Otherwise skip.

## Cross-archetype rules

- **Header and footer are template parts (`parts/header.html`, `parts/footer.html`)**, registered in `theme.json`'s `templateParts`. Every template uses the same header/footer.
- **Navigation** uses `wp:navigation`. Read `creating-themes/references/navigation.md` for the markup. Pull menu items from the WXR's `<wp:wp_nav_menu>` entries if present; otherwise infer from the source's header HTML.
- **Templates only define structure.** Real content comes from the imported WXR/products. Do NOT inline source content into the template — that's a one-page site, not a theme.
- **Use template part inheritance.** When a template needs a hero specific to its archetype but the rest is shared, prefer a pattern reference inside the template over duplicating header/footer markup.
