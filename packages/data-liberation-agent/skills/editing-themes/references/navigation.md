# Navigation Block Reference

## wp:navigation block

The `core/navigation` block renders site navigation in header template parts. It supports responsive overlay (hamburger menu) behavior natively via the WordPress Interactivity API — no custom JavaScript is needed.

## Key attributes

| Attribute | Type | Default | Description |
|---|---|---|---|
| `overlayMenu` | `string` | `"mobile"` | When overlay shows: `"mobile"` (responsive), `"always"` (always hamburger), `"never"` (no overlay) |
| `icon` | `string` | `"handle"` | Hamburger icon style |
| `hasIcon` | `boolean` | `true` | Show hamburger icon in overlay mode |
| `overlayBackgroundColor` | `string` | — | Overlay background color (palette slug) |
| `customOverlayBackgroundColor` | `string` | — | Overlay background color (custom hex) |
| `overlayTextColor` | `string` | — | Overlay text/link color (palette slug) |
| `customOverlayTextColor` | `string` | — | Overlay text/link color (custom hex) |
| `textColor` | `string` | — | Desktop nav link color (palette slug) |
| `backgroundColor` | `string` | — | Desktop nav background color (palette slug) |
| `showSubmenuIcon` | `boolean` | `true` | Show dropdown arrow on items with submenus |
| `maxNestingLevel` | `number` | `5` | Maximum submenu depth |
| `layout` | `object` | — | Flex layout config (`type`, `justifyContent`, `orientation`) |

### overlayMenu values

- **`"mobile"`** (recommended) — Full nav on desktop, hamburger on mobile. WordPress handles the breakpoint automatically (uses `break-small`, ~600px).
- **`"always"`** — Always shows the hamburger icon, even on desktop. Good for minimal or overlay-first designs.
- **`"never"`** — Never collapses. Links always visible. Only use when the nav has very few items.

### Allowed inner blocks

`core/navigation-link`, `core/navigation-submenu`, `core/home-link`, `core/page-list`, `core/search`, `core/social-links`, `core/site-title`, `core/site-logo`, `core/loginout`, `core/buttons`, `core/spacer`, `core/icon`

## Overlay HTML structure (rendered by WordPress)

When `overlayMenu` is not `"never"`, WordPress renders this structure automatically:

```
<nav class="wp-block-navigation">
  <!-- Desktop links (visible above breakpoint) -->
  <ul class="wp-block-navigation__container">...</ul>

  <!-- Hamburger button (visible below breakpoint) -->
  <button class="wp-block-navigation__responsive-container-open">
    <svg>...</svg>  <!-- hamburger icon -->
  </button>

  <!-- Overlay (hidden until opened) -->
  <div class="wp-block-navigation__responsive-container">
    <div class="wp-block-navigation__responsive-close">
      <div class="wp-block-navigation__responsive-dialog" role="dialog" aria-modal="true">
        <button class="wp-block-navigation__responsive-container-close">
          <svg>...</svg>  <!-- close icon -->
        </button>
        <div class="wp-block-navigation__responsive-container-content">
          <!-- Same nav links, rendered for overlay -->
        </div>
      </div>
    </div>
  </div>
</nav>
```

The overlay is fully managed by WordPress via the Interactivity API store (`core/navigation`). It handles open/close, focus trapping, keyboard navigation (Tab cycling, Escape to close), and `aria-modal` attributes. **Never add custom JavaScript for overlay behavior.**

## Overlay state classes

| Class | Applied to | Meaning |
|---|---|---|
| `is-menu-open` | `.wp-block-navigation__responsive-container` | Overlay is currently open |
| `has-modal-open` | `<html>` element | Scroll lock — prevents body scroll when overlay is open |
| `hidden-by-default` | `.wp-block-navigation__responsive-container` | Set when `overlayMenu` is `"always"` |
| `always-shown` | open button | Hamburger visible at all screen sizes |

## Header template part examples

### Standard header (site title left, nav right)

Based on the Twenty Twenty-Five default header pattern:

```html
<!-- wp:group {"align":"full","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull">
  <!-- wp:group {"align":"wide","style":{"spacing":{"padding":{"top":"var:preset|spacing|30","bottom":"var:preset|spacing|30"}}},"layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"space-between"}} -->
  <div class="wp-block-group alignwide" style="padding-top:var(--wp--preset--spacing--30);padding-bottom:var(--wp--preset--spacing--30)">

    <!-- wp:site-title {"level":0} /-->

    <!-- wp:navigation {"overlayBackgroundColor":"base","overlayTextColor":"contrast","layout":{"type":"flex","justifyContent":"right"}} /-->

  </div>
  <!-- /wp:group -->
</div>
<!-- /wp:group -->
```

### Centered header (site title above, nav centered below)

```html
<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group">
  <!-- wp:group {"align":"wide","style":{"spacing":{"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|30"}}},"layout":{"type":"constrained"}} -->
  <div class="wp-block-group alignwide" style="padding-top:var(--wp--preset--spacing--60);padding-bottom:var(--wp--preset--spacing--30)">

    <!-- wp:site-title {"level":0,"textAlign":"center","align":"wide","fontSize":"x-large"} /-->

    <!-- wp:navigation {"overlayBackgroundColor":"base","overlayTextColor":"contrast","layout":{"type":"flex","justifyContent":"center"}} /-->

  </div>
  <!-- /wp:group -->
</div>
<!-- /wp:group -->
```

### Vertical navigation (large title left, nav stacked right)

```html
<!-- wp:group {"align":"wide","style":{"spacing":{"padding":{"top":"var:preset|spacing|30","bottom":"var:preset|spacing|30"}}},"layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"space-between","verticalAlignment":"center"}} -->
<div class="wp-block-group alignwide" style="padding-top:var(--wp--preset--spacing--30);padding-bottom:var(--wp--preset--spacing--30)">

  <!-- wp:site-title {"level":0,"style":{"typography":{"fontSize":"100px","lineHeight":"1.2"}}} /-->

  <!-- wp:navigation {"overlayBackgroundColor":"base","overlayTextColor":"contrast","style":{"spacing":{"blockGap":"0"}},"layout":{"type":"flex","justifyContent":"right","orientation":"vertical"}} /-->

</div>
<!-- /wp:group -->
```

### Landing page header with explicit anchor links

For landing pages where navigation points to page sections instead of WordPress pages:

```html
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"1.5rem","bottom":"1.5rem","left":"2rem","right":"2rem"}}},"layout":{"type":"flex","justifyContent":"space-between","flexWrap":"nowrap"}} -->
<div class="wp-block-group alignfull" style="padding-top:1.5rem;padding-bottom:1.5rem;padding-left:2rem;padding-right:2rem">

  <!-- wp:site-title {"level":0} /-->

  <!-- wp:navigation {"overlayMenu":"mobile","overlayBackgroundColor":"contrast","overlayTextColor":"base","layout":{"type":"flex","justifyContent":"right"},"style":{"spacing":{"blockGap":"2rem"}}} -->
  <!-- wp:navigation-link {"label":"Features","url":"#features"} /-->
  <!-- wp:navigation-link {"label":"Pricing","url":"#pricing"} /-->
  <!-- wp:navigation-link {"label":"About","url":"#about"} /-->
  <!-- wp:navigation-link {"label":"Contact","url":"#contact"} /-->
  <!-- /wp:navigation -->

</div>
<!-- /wp:group -->
```

## Overlay color guidelines

Always set **both** `overlayBackgroundColor` and `overlayTextColor` together. If only one is set, the overlay may have invisible text against a same-colored background.

Use theme palette slugs (not hex values) so overlay colors stay consistent with the theme:

```html
<!-- wp:navigation {"overlayBackgroundColor":"contrast","overlayTextColor":"base"} /-->
```

Common patterns:
- Dark overlay: `overlayBackgroundColor="contrast"` + `overlayTextColor="base"`
- Light overlay: `overlayBackgroundColor="base"` + `overlayTextColor="contrast"`
- Accent overlay: `overlayBackgroundColor="accent"` + `overlayTextColor="base"`

## Sticky header with navigation

For a sticky header, wrap the header content in a Group with sticky positioning via CSS class. The overlay renders at `z-index: 100000` so it always appears above other content.

```css
.sticky-header {
    position: sticky;
    top: 0;
    z-index: 100;
}
```

```html
<!-- wp:group {"align":"full","className":"sticky-header","backgroundColor":"base","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull sticky-header has-base-background-color has-background">
  <!-- header content with wp:navigation here -->
</div>
<!-- /wp:group -->
```

## Common pitfalls

1. **Overlay not appearing on mobile**: The default `overlayMenu` is `"mobile"`, so if you omit the attribute entirely the overlay works. But if you explicitly set `"overlayMenu":"never"`, the nav will never collapse. Check this attribute first.
2. **Overlay text invisible**: Always set both `overlayBackgroundColor` and `overlayTextColor`. Missing one causes contrast issues.
3. **Navigation renders empty**: Normal for new themes with no published pages — WordPress auto-populates from published pages. For landing pages or demos, use explicit `wp:navigation-link` blocks.
4. **Custom JS conflicts**: WordPress manages overlay open/close, focus trapping, and keyboard navigation via the Interactivity API. Never add custom JavaScript for these behaviors — it will conflict.
5. **Hamburger icon not visible**: The hamburger icon inherits the navigation `textColor`. Ensure it contrasts with the header background.
6. **Overlay behind other elements**: The overlay uses `z-index: 100000`. If something covers it, that element has a problematically high z-index that should be reduced.
7. **Body scrolls when overlay is open**: WordPress automatically adds `has-modal-open` to `<html>` with `overflow: hidden`. If scrolling persists, check for CSS that overrides `html.has-modal-open`.