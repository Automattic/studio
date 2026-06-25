# Query Loop in Templates and Patterns

Use `core/query` whenever you need to display a dynamic list of posts or custom post types.

## Nesting Rules (strict)

```
core/query  →  <div class="wp-block-query">
├── core/post-template              ← repeater, iterates each post
│   └── post blocks only: core/post-title, core/post-date,
│       core/post-featured-image, core/post-excerpt,
│       core/post-terms, core/post-author-name, core/post-content
├── core/query-pagination           ← sibling of post-template
│   ├── core/query-pagination-previous
│   ├── core/query-pagination-numbers
│   └── core/query-pagination-next
├── core/query-no-results           ← sibling of post-template
└── core/query-title                ← sibling of post-template
```

Post blocks go inside `core/post-template`, never directly inside `core/query`. Layout (grid/list) is set on `core/post-template`, not on `core/query`.

## `inherit` Attribute

- `true` → uses the main `$wp_query`, ignores all other query params. Use in archive/search/category templates. Only one per page.
- `false` → builds an independent `WP_Query` with explicit params. Use for curated sections (homepage, sidebars).

## Non-obvious Param Formats

- `taxQuery` uses `{"category":[1,5]}` — NOT the nested `tax_query` array from `WP_Query`
- `sticky` is a string: `""` (include), `"only"` (sticky only), `"exclude"` (hide sticky)
- `perPage` as `null` uses the site's "Blog pages show at most" setting
- `enhancedPagination: true` goes on `core/query` for AJAX page loads (WP 6.4+)

## Markup Example

```html
<!-- wp:query {"query":{"perPage":6,"postType":"post","order":"desc","orderBy":"date","inherit":false}} -->
<div class="wp-block-query">
    <!-- wp:post-template {"layout":{"type":"grid","columnCount":3}} -->
        <!-- wp:post-featured-image {"isLink":true,"aspectRatio":"16/9"} /-->
        <!-- wp:post-title {"isLink":true} /-->
        <!-- wp:post-date /-->
    <!-- /wp:post-template -->
    <!-- wp:query-pagination -->
        <!-- wp:query-pagination-previous /-->
        <!-- wp:query-pagination-numbers /-->
        <!-- wp:query-pagination-next /-->
    <!-- /wp:query-pagination -->
    <!-- wp:query-no-results -->
        <!-- wp:paragraph -->
        <p>No posts found.</p>
        <!-- /wp:paragraph -->
    <!-- /wp:query-no-results -->
</div>
<!-- /wp:query -->
```

## Inherited Query (for archive/search templates)

```html
<!-- wp:query {"query":{"inherit":true}} -->
<div class="wp-block-query">
    <!-- wp:post-template -->
        <!-- wp:post-featured-image {"isLink":true} /-->
        <!-- wp:post-title {"isLink":true} /-->
        <!-- wp:post-excerpt /-->
    <!-- /wp:post-template -->
    <!-- wp:query-pagination {"layout":{"type":"flex","justifyContent":"space-between"}} -->
        <!-- wp:query-pagination-previous /-->
        <!-- wp:query-pagination-numbers /-->
        <!-- wp:query-pagination-next /-->
    <!-- /wp:query-pagination -->
</div>
<!-- /wp:query -->
```
