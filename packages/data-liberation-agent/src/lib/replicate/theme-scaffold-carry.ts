//
// Carry theme scaffold (carry-and-scope path)
// ==========================================
// Emits the minimal file set for a WordPress block theme whose sole job is
// to stay out of the way and let carried source HTML + scoped source CSS
// render faithfully.
//
// Intentionally minimal — no patterns, no archetypes beyond header/footer
// parts and per-page templates.  No agent involvement required; pure
// deterministic mapping of CarryThemeInput → ThemeFile[].
//
// Body-class scoping strategy:
//   - `lib-carry-site` — applied site-wide via body_class filter
//   - `lib-carry-page-<slug>` — applied per page via body_class filter
//
// CSS loading strategy:
//   - assets/css/site.css — enqueued globally
//   - assets/css/page-<slug>.css — enqueued conditionally via wp_enqueue_scripts
//

import type { CarryScaffold } from './page-reconstruct-carry.js';
import { GALLERY_MOBILE_GRID_CSS } from './gallery-mobile-grid.js';
import { mobileFrame } from './page-reconstruct-carry.js';

export interface CarryPage {
  /** URL-safe slug (kebab-case, produced by slugify — no quotes or special chars). */
  slug: string;
  /** True for the site front page — maps template to front-page.html and uses is_front_page(). */
  isHome?: boolean;
  /**
   * Which distinct chrome variant ([[ChromeVariant.key]]) this page renders. Pages
   * with identical header+footer DOM share a key (and thus one part pair), so a
   * site with a transparent-overlay home header and a solid interior header emits
   * exactly two header parts, not one-per-page.
   */
  chromeKey: string;
  /**
   * WP object type the slug resolves to. `'post'` scopes via `is_single()` and
   * renders through a shared `single.html` (posts share one template); anything
   * else (default `'page'`) scopes via `is_page()` and gets its own
   * `page-<slug>.html`. Front page (`isHome`) ignores this and uses
   * `is_front_page()` + `front-page.html`.
   */
  postType?: 'page' | 'post';
  /** Scoped CSS for this page (already scoped under `body.lib-carry-page-<slug>`). */
  pageCss: string;
  /**
   * Per-page wrapper-scaffold chunks. When present, the page template carries the
   * scaffold + chrome parts and renders `post_content` (content sections only)
   * between them — the editable-content architecture. Absent → legacy template.
   */
  scaffold?: CarryScaffold;
  /**
   * Classic/adaptive Wix dual-viewport mobile-DOM carry. When present (and the page
   * has a `scaffold`), the template wraps `wp:post-content` in `.lib-carry-vp-desktop`
   * and appends a `.lib-carry-vp-mobile` iframe of the captured 320px mobile DOM — so
   * the desktop content stays as editable per-section blocks in post_content while the
   * viewport toggle (`VP_TOGGLE_CSS`) still swaps to the mobile iframe below 750px.
   * Only consumed by the scaffolded template; the legacy path inlines the wrapper itself.
   */
  mobile?: { docUrl: string; height: number };
}

/** body_class / enqueue conditional for a page (front page → single → page). */
function pageCondition(p: CarryPage): string {
  if (p.isHome) return 'is_front_page()';
  if (p.postType === 'post') return `is_single( '${p.slug}' )`;
  return `is_page( '${p.slug}' )`;
}

/**
 * A distinct header+footer pair. The assembler dedupes pages by chrome content,
 * so one variant covers every page whose chrome DOM is identical. The variant
 * order matters: the FIRST variant (conventionally the home page's) becomes the
 * canonical `header`/`footer` parts; subsequent variants get `-2`, `-3`, … slugs.
 */
export interface ChromeVariant {
  /** Stable key referenced by [[CarryPage.chromeKey]]. */
  key: string;
  /** Block markup for this variant's header template part. */
  headerIsland: string;
  /** Block markup for this variant's footer template part. */
  footerIsland: string;
}

export interface CarryThemeInput {
  /** Display name that appears in WP's theme list (required by WordPress). */
  themeName: string;
  /** Distinct chrome variants (home first). Each emits its own header/footer parts. */
  chromeVariants: ChromeVariant[];
  /**
   * Site-wide CSS (already scoped under `body.lib-carry-site`). Holds EVERY variant's
   * chrome CSS concatenated — safe because each variant's rules key off the source's
   * per-header comp-ids, so a variant's rules match nothing on a page using another.
   */
  siteCss: string;
  /**
   * Classes from the source `<body>` to replicate on the WP body (via body_class).
   * Carried CSS folds the source's `body` selector onto the scope, so rules keyed
   * on body state — e.g. Wix's `body.responsive` / `body:not(.responsive)` that
   * gate the entire responsive (mobile-reflow) layout — only behave correctly when
   * the WP body carries the same classes. Without this the alt is stuck in the
   * desktop layout on mobile.
   */
  bodyClasses?: string[];
  /** One entry per page that needs a template + per-page CSS file. */
  pages: CarryPage[];
  /**
   * Hybrid carry: posts are excluded from the carry set and render NATIVE (a normal
   * blog feed), so the theme needs working `single.html` / `home.html` / `archive.html`.
   * Defaults to "no POST is carried" (`!pages.some(postType==='post')`) — correct for the
   * hybrid case and harmless on a posts-free site (the templates simply go unused).
   */
  nativeBlog?: boolean;
  /**
   * When the run has a store, the carried header to use for the WooCommerce store
   * templates (single-product / archive-product). Product + shop/archive pages have
   * NO carried island of their own, and the content-page `header` parts are usually
   * empty (the header rides inline in each page island), so store pages need their
   * own populated header. Already a complete `parts/*.html` body (a core/html block).
   * Emitted as `parts/header-store.html` only when `hasProducts` is also true.
   */
  storeHeaderIsland?: string;
  /** True when the run produced WooCommerce products — gates the store templates. */
  hasProducts?: boolean;
  /**
   * Captured design tokens registered in theme.json (`settings.color.palette` /
   * `settings.typography.fontFamilies`) so the product-marketing core blocks resolve
   * their color/font token references. Same slugs the reconstruction maps to — built by
   * `loadCarryDesignTokens` ([[product_shopify_liberate_findings]] follow-up). Absent →
   * no tokens registered (core blocks fall back to theme defaults).
   */
  themeJsonPalette?: Array<{ slug: string; name: string; color: string }>;
  themeJsonFontFamilies?: Array<{ slug: string; name: string; fontFamily: string }>;
}

/** Header/footer template-part slugs for a chrome variant by its position. */
interface ChromeSlugs {
  header: string;
  footer: string;
}

/** Variant 0 → canonical `header`/`footer`; later variants → `header-2`, … */
function chromeSlugsForIndex(index: number): ChromeSlugs {
  const suffix = index === 0 ? '' : `-${index + 1}`;
  return { header: `header${suffix}`, footer: `footer${suffix}` };
}

export interface ThemeFile {
  /** Theme-relative path, e.g. "templates/index.html". */
  path: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function styleCssHeader(name: string): string {
  const textDomain = name.toLowerCase().replace(/\s+/g, '-');
  return `/*\nTheme Name: ${name}\nVersion: 1.0.0\nText Domain: ${textDomain}\n*/\n`;
}

/**
 * Standard page template: header part → main post-content island → footer part.
 * Used for every page template including the required index.html fallback.
 */
function pageTemplate(slugs: ChromeSlugs): string {
  return [
    `<!-- wp:template-part {"slug":"${slugs.header}","tagName":"header"} /-->`,
    '<!-- wp:group {"tagName":"main"} -->',
    '<main class="wp-block-group"><!-- wp:post-content /--></main>',
    '<!-- /wp:group -->',
    `<!-- wp:template-part {"slug":"${slugs.footer}","tagName":"footer"} /-->`,
    '',
  ].join('\n');
}

/** Wrap raw HTML in a core/html block, or '' when empty. */
function htmlBlock(html: string): string {
  return html ? `<!-- wp:html -->\n${html}\n<!-- /wp:html -->` : '';
}

/**
 * Slug of the dedicated header part used by the WooCommerce store templates. The
 * content-page `header` parts stay empty when the splitter can't isolate a header
 * (Shopify/Squarespace headers ride inline in each page island), so store pages —
 * which have NO carried island — get their own populated header here instead.
 */
const STORE_HEADER_SLUG = 'header-store';

/**
 * WooCommerce ARCHIVE (shop / category) template: store header → constrained `<main>`
 * with breadcrumbs + the classic WC archive block (shop grid + sorting + pagination)
 * → canonical footer. The legacy block keeps full archive functionality; the carried
 * chrome gives it the site framing WooCommerce's bare default template lacks.
 */
function wooArchiveTemplate(): string {
  return [
    `<!-- wp:template-part {"slug":"${STORE_HEADER_SLUG}","tagName":"header"} /-->`,
    '',
    '<!-- wp:group {"tagName":"main","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"40px","bottom":"64px"}}}} -->',
    '<main class="wp-block-group" style="padding-top:40px;padding-bottom:64px">',
    '<!-- wp:woocommerce/breadcrumbs /-->',
    '',
    '<!-- wp:woocommerce/legacy-template {"template":"archive-product"} /-->',
    '</main>',
    '<!-- /wp:group -->',
    '',
    '<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->',
    '',
  ].join('\n');
}

/**
 * Single-PRODUCT template: store header → a constrained buy box composed from MODERN
 * WooCommerce product blocks (gallery + title + rating + price + summary + add-to-cart
 * + meta) → the product's rich source marketing FULL-WIDTH below via `core/post-content`
 * (reconstructed into core blocks by enrich-product-marketing) → canonical footer.
 *
 * Modern blocks (not `legacy-template`) are used so we control the order: buy box first,
 * then marketing, with the source's "you may also like" landing at the end of the
 * marketing (the standalone `woocommerce/related-products` block does not render here).
 * `core/post-title` renders the product name reliably (the `woocommerce/product-title`
 * block came up empty on this template).
 */
function wooSingleProductTemplate(): string {
  return [
    `<!-- wp:template-part {"slug":"${STORE_HEADER_SLUG}","tagName":"header"} /-->`,
    '',
    // The carry theme's contentSize is 100% (full-width carried islands), so the buy box
    // needs an explicit centered max-width or the gallery + summary sprawl edge-to-edge.
    '<!-- wp:group {"tagName":"main","layout":{"type":"constrained","contentSize":"1200px"},"style":{"spacing":{"padding":{"top":"32px","bottom":"24px","left":"24px","right":"24px"}}}} -->',
    '<main class="wp-block-group" style="padding-top:32px;padding-bottom:24px;padding-left:24px;padding-right:24px">',
    '<!-- wp:woocommerce/breadcrumbs /-->',
    '',
    '<!-- wp:columns {"style":{"spacing":{"blockGap":{"left":"48px"}}}} -->',
    '<div class="wp-block-columns">',
    '<!-- wp:column {"width":"52%"} -->',
    '<div class="wp-block-column" style="flex-basis:52%">',
    '<!-- wp:woocommerce/product-image-gallery /-->',
    '</div>',
    '<!-- /wp:column -->',
    '',
    '<!-- wp:column {"width":"48%"} -->',
    '<div class="wp-block-column" style="flex-basis:48%">',
    '<!-- wp:post-title {"level":1} /-->',
    '',
    '<!-- wp:woocommerce/product-rating /-->',
    '',
    '<!-- wp:woocommerce/product-price /-->',
    '',
    '<!-- wp:woocommerce/product-summary /-->',
    '',
    '<!-- wp:woocommerce/add-to-cart-form /-->',
    '',
    '<!-- wp:woocommerce/product-meta /-->',
    '</div>',
    '<!-- /wp:column -->',
    '</div>',
    '<!-- /wp:columns -->',
    '</main>',
    '<!-- /wp:group -->',
    '',
    '<!-- wp:group {"tagName":"section","align":"full","style":{"spacing":{"padding":{"bottom":"64px"}}},"layout":{"type":"constrained","contentSize":"1100px"}} -->',
    '<section class="wp-block-group alignfull" style="padding-bottom:64px">',
    '<!-- wp:post-content /-->',
    '</section>',
    '<!-- /wp:group -->',
    '',
    '<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->',
    '',
  ].join('\n');
}

/**
 * Scaffolded template for the editable-content architecture: the wrapper chunks
 * ride in the template as core/html, the chrome as template parts (rendered with
 * a `tagName:div` wrapper that `display:contents` makes box-less so the carried
 * chrome lands in its exact DOM position), and `post_content` (content sections
 * only) sits between them. Concatenated, the stream rebuilds the source DOM.
 */
function scaffoldedTemplate(
  s: CarryScaffold,
  slugs: ChromeSlugs,
  mobile?: { docUrl: string; height: number },
): string {
  // Under dual-viewport mobile carry, the template (not post_content) hosts the
  // wrapper: `.lib-carry-vp-desktop` wraps the editable section blocks, and a
  // `.lib-carry-vp-mobile` iframe of the captured mobile DOM follows. VP_TOGGLE_CSS
  // swaps between them below 750px. Without mobile, post-content stands alone.
  const postContentSlot = mobile
    ? [
        htmlBlock('<div class="lib-carry-vp-desktop">'),
        '<!-- wp:post-content /-->',
        htmlBlock(`</div>\n<div class="lib-carry-vp-mobile">${mobileFrame(mobile)}</div>`),
      ].join('\n')
    : '<!-- wp:post-content /-->';
  return [
    htmlBlock(s.openWrap),
    `<!-- wp:template-part {"slug":"${slugs.header}","tagName":"div"} /-->`,
    htmlBlock(s.midBefore),
    postContentSlot,
    htmlBlock(s.midAfter),
    `<!-- wp:template-part {"slug":"${slugs.footer}","tagName":"div"} /-->`,
    htmlBlock(s.closeWrap),
  ]
    .filter(Boolean)
    .join('\n');
}

/** The right template body for a page: scaffolded when it has a scaffold, else legacy. */
function templateFor(p: CarryPage, slugs: ChromeSlugs): string {
  return p.scaffold ? scaffoldedTemplate(p.scaffold, slugs, p.mobile) : pageTemplate(slugs);
}

// --- Native blog templates (hybrid carry — posts render native, not carried) -------
// Built from the home page's CarryScaffold (chrome parts + Wix wrapper) with a CLEAN
// block middle and NO dual-viewport wrapper (native posts have no captured mobile DOM).
// The scaffold gives the chrome its DOM anchor; the middle is normal core blocks the
// editor renders + edits like any block (the carried islands' raw-HTML limitation
// applies only to the carried marketing pages).

/** Single-post body: a constrained white card with title, date, featured image, content, prev/next. */
const NATIVE_SINGLE_MIDDLE = [
  '<!-- wp:group {"tagName":"div","layout":{"type":"constrained","contentSize":"760px"},"style":{"spacing":{"padding":{"top":"48px","bottom":"72px","left":"20px","right":"20px"}}}} -->',
  '<div class="wp-block-group" style="padding:48px 20px 72px">',
  '<!-- wp:group {"style":{"color":{"background":"#ffffff"},"spacing":{"padding":{"top":"44px","bottom":"56px","left":"clamp(20px,4vw,56px)","right":"clamp(20px,4vw,56px)"}},"border":{"radius":"10px"}},"layout":{"type":"constrained"}} -->',
  '<div class="wp-block-group has-background" style="border-radius:10px;background-color:#ffffff;padding:44px clamp(20px,4vw,56px) 56px">',
  '<!-- wp:post-title {"level":1} /-->',
  '<!-- wp:post-date /-->',
  '<!-- wp:spacer {"height":"24px"} --><div style="height:24px" aria-hidden="true" class="wp-block-spacer"></div><!-- /wp:spacer -->',
  '<!-- wp:post-featured-image {"isLink":false,"style":{"border":{"radius":"8px"}}} /-->',
  '<!-- wp:spacer {"height":"24px"} --><div style="height:24px" aria-hidden="true" class="wp-block-spacer"></div><!-- /wp:spacer -->',
  '<!-- wp:post-content {"layout":{"type":"constrained"}} /-->',
  '</div>',
  '<!-- /wp:group -->',
  '<!-- wp:spacer {"height":"40px"} --><div style="height:40px" aria-hidden="true" class="wp-block-spacer"></div><!-- /wp:spacer -->',
  '<!-- wp:post-navigation-link {"type":"previous","label":"Previous post","showTitle":true} /-->',
  '<!-- wp:post-navigation-link {"label":"Next post","showTitle":true} /-->',
  '</div>',
  '<!-- /wp:group -->',
].join('\n');

const NATIVE_HOME_TITLE = '<!-- wp:heading {"level":1} -->\n<h1 class="wp-block-heading">Blog</h1>\n<!-- /wp:heading -->';
const NATIVE_ARCHIVE_TITLE = '<!-- wp:query-title {"type":"archive"} /-->';

/** A post-listing body: an optional title block above a `core/query` inherit loop. */
function nativeQueryLoop(titleBlock: string): string {
  return [
    '<!-- wp:group {"tagName":"div","layout":{"type":"constrained","contentSize":"880px"},"style":{"spacing":{"padding":{"top":"48px","bottom":"72px","left":"20px","right":"20px"}}}} -->',
    '<div class="wp-block-group" style="padding:48px 20px 72px">',
    titleBlock,
    '<!-- wp:query {"queryId":0,"query":{"perPage":10,"pages":0,"offset":0,"postType":"post","order":"desc","orderBy":"date","inherit":true},"layout":{"type":"default"}} -->',
    '<div class="wp-block-query">',
    '<!-- wp:post-template {"style":{"spacing":{"blockGap":"40px"}},"layout":{"type":"default"}} -->',
    '<!-- wp:group {"style":{"color":{"background":"#ffffff"},"spacing":{"padding":{"top":"30px","bottom":"30px","left":"32px","right":"32px"}},"border":{"radius":"10px"}},"layout":{"type":"constrained"}} -->',
    '<div class="wp-block-group has-background" style="border-radius:10px;background-color:#ffffff;padding:30px 32px">',
    '<!-- wp:post-title {"isLink":true,"level":2} /-->',
    '<!-- wp:post-date /-->',
    '<!-- wp:post-excerpt {"moreText":"Read more →"} /-->',
    '</div>',
    '<!-- /wp:group -->',
    '<!-- /wp:post-template -->',
    '<!-- wp:query-pagination {"layout":{"type":"flex","justifyContent":"space-between"}} -->',
    '<!-- wp:query-pagination-previous /--><!-- wp:query-pagination-numbers /--><!-- wp:query-pagination-next /-->',
    '<!-- /wp:query-pagination -->',
    '<!-- wp:query-no-results --><!-- wp:paragraph --><p>No posts yet.</p><!-- /wp:paragraph --><!-- /wp:query-no-results -->',
    '</div>',
    '<!-- /wp:query -->',
    '</div>',
    '<!-- /wp:group -->',
  ].join('\n');
}

/** Wrap a native block middle in the home page's chrome scaffold (no dual-viewport wrapper). */
function nativeBlogTemplate(middle: string, slugs: ChromeSlugs, scaffold?: CarryScaffold): string {
  if (scaffold) {
    return [
      htmlBlock(scaffold.openWrap),
      `<!-- wp:template-part {"slug":"${slugs.header}","tagName":"div"} /-->`,
      htmlBlock(scaffold.midBefore),
      middle,
      htmlBlock(scaffold.midAfter),
      `<!-- wp:template-part {"slug":"${slugs.footer}","tagName":"div"} /-->`,
      htmlBlock(scaffold.closeWrap),
    ]
      .filter(Boolean)
      .join('\n');
  }
  // No deep-chrome scaffold (legacy): header part → constrained main → footer part.
  return [
    `<!-- wp:template-part {"slug":"${slugs.header}","tagName":"header"} /-->`,
    '<!-- wp:group {"tagName":"main"} -->',
    `<main class="wp-block-group">${middle}</main>`,
    '<!-- /wp:group -->',
    `<!-- wp:template-part {"slug":"${slugs.footer}","tagName":"footer"} /-->`,
  ].join('\n');
}

/** Valid, safe CSS class token (no quotes/spaces); excludes WP-reserved-ish noise. */
function sanitizeBodyClass(cls: string): string | null {
  return /^[a-zA-Z][\w-]{0,60}$/.test(cls) ? cls : null;
}

/**
 * Strip any carried `<meta name="viewport">` — a `<head>` element wrongly carried into the
 * page BODY via the scaffold's openWrap. Left in, a later in-body viewport meta overrides
 * the theme's own head viewport (browsers apply the last one), defeating the mobile-canvas
 * viewport swap. Only applied to mobile-canvas carries (see buildCarryThemeFiles).
 */
function stripViewportMeta(html: string): string {
  return html.replace(/<meta\b[^>]*\bname=["']viewport["'][^>]*>\s*/gi, '');
}

/**
 * Neutralize the carry CSS scope (`body.lib-carry-site` / `body.lib-carry-page-<slug>`)
 * down to a bare `body` so the stylesheet can be loaded into the BLOCK-EDITOR canvas.
 *
 * The front-end carry CSS is zero-specificity scoped under `:where(body.lib-carry-site)`
 * (and per-page `body.lib-carry-page-<slug>`) to preserve the source cascade and prevent
 * cross-page bleed. The editor canvas iframe body carries NEITHER class — WordPress's
 * `add_editor_style` / `block_editor_settings_all` pipeline scopes editor CSS to
 * `.editor-styles-wrapper` by rewriting the leading `body` selector. Mapping the carry
 * scope back to `body` lets that rewrite land the rules on the canvas. Editor-only: the
 * emitted front-end `site.css` / `page-<slug>.css` are left untouched, so this can never
 * change front-end fidelity.
 */
export function editorScopeCss(css: string): string {
  return css
    .replace(/:where\(\s*body\.lib-carry-site\s*\)/g, 'body')
    .replace(/:where\(\s*body\.lib-carry-page-[\w-]+\s*\)/g, 'body')
    .replace(/body\.lib-carry-site\b/g, 'body')
    .replace(/body\.lib-carry-page-[\w-]+/g, 'body');
}

function functionsPhp(pages: CarryPage[], bodyClasses: string[], mobileViewport: boolean): string {
  // body_class filter: always add lib-carry-site; replicate the source body classes
  // (so body-state-gated carried rules behave like the source); add per-page class.
  const sourceBodyCases = bodyClasses
    .map(sanitizeBodyClass)
    .filter((c): c is string => c !== null)
    .map((c) => `    $classes[] = '${c}';`)
    .join('\n');
  const bodyCases = pages
    .map((p) => `    if ( ${pageCondition(p)} ) { $classes[] = 'lib-carry-page-${p.slug}'; }`)
    .join('\n');

  // wp_enqueue_scripts: enqueue site.css globally; page CSS conditionally.
  const enqueue = pages
    .map(
      (p) =>
        `    if ( ${pageCondition(p)} ) { wp_enqueue_style( 'lib-carry-page-${p.slug}', get_stylesheet_directory_uri() . '/assets/css/page-${p.slug}.css', array( 'lib-carry-site' ), '1.0.0' ); }`,
    )
    .join('\n');

  // Non-responsive (classic/adaptive) source mobile layout is a FIXED-width canvas (carried
  // as the .lib-carry-vp-mobile iframe). The source scales it to fill via a width=320 viewport
  // on mobile user-agents; WordPress's default width=device-width leaves it un-scaled (gap on
  // wide phones). Mirror the source — but SCOPE width=320 to the mobile-canvas pages (those
  // with a captured mobile DOM), so native blog contexts (is_single/is_home/is_archive) and
  // non-canvas pages stay device-width, matching VP_TOGGLE_CSS's :has(.lib-carry-vp-mobile)
  // scope. Core registers _block_template_viewport_meta_tag during template-canvas setup (AFTER
  // this file loads), so a top-level remove_action misses it — remove it from inside wp_head at
  // priority -1 (before core's 0), then emit ours.
  const mobileCanvasCond = pages
    .filter((p) => p.mobile)
    .map(pageCondition)
    .join(' || ');
  const mobileViewportBlock = mobileViewport
    ? `
add_action( 'wp_head', function () {
    remove_action( 'wp_head', '_block_template_viewport_meta_tag', 0 );
}, -1 );
add_action( 'wp_head', function () {
    echo ( wp_is_mobile() && ( ${mobileCanvasCond} ) )
        ? '<meta name="viewport" content="width=320, user-scalable=yes" id="libCarryMobileViewport">' . "\\n"
        : '<meta name="viewport" content="width=device-width, initial-scale=1">' . "\\n";
}, 1 );
`
    : '';

  // Editor parity: load the carried design into the block-editor canvas iframe so
  // the core/html islands render styled in the editor (not as unstyled defaults).
  // The GLOBAL editor-site.css (scope-neutralized site.css) rides add_editor_style
  // for every editor (post + Site Editor). Each page's island styling is injected
  // per-edited-post via block_editor_settings_all, keyed by post_name → slug, so a
  // post editor only ever loads ITS page's CSS (no cross-page bleed, matching the
  // front-end's per-page enqueue). editorPageMap is the slug→file lookup.
  const editorPageMap = pages
    .map((p) => `        '${p.slug}' => 'assets/css/editor-page-${p.slug}.css',`)
    .join('\n');
  const editorStyleBlock = `
add_action( 'after_setup_theme', function () {
    add_theme_support( 'editor-styles' );
    if ( file_exists( get_theme_file_path( 'assets/css/editor-site.css' ) ) ) {
        add_editor_style( 'assets/css/editor-site.css' );
    }
} );

add_filter( 'block_editor_settings_all', function( $settings, $context ) {
    $map = array(
${editorPageMap}
    );
    if ( empty( $context->post ) || ! isset( $map[ $context->post->post_name ] ) ) {
        return $settings;
    }
    $path = get_theme_file_path( $map[ $context->post->post_name ] );
    if ( ! file_exists( $path ) ) {
        return $settings;
    }
    $css = file_get_contents( $path );
    if ( false === $css ) {
        return $settings;
    }
    if ( ! isset( $settings['styles'] ) || ! is_array( $settings['styles'] ) ) {
        $settings['styles'] = array();
    }
    $settings['styles'][] = array( 'css' => $css );
    return $settings;
}, 10, 2 );
`;

  return `<?php
add_filter( 'body_class', function( $classes ) {
    $classes[] = 'lib-carry-site';
${sourceBodyCases ? sourceBodyCases + '\n' : ''}${bodyCases}
    return $classes;
} );

add_action( 'wp_enqueue_scripts', function() {
    wp_enqueue_style( 'lib-carry-site', get_stylesheet_directory_uri() . '/assets/css/site.css', array(), '1.0.0' );
${enqueue}
} );

// Allow the dual-viewport mobile-DOM <iframe> (carried mobile layout) through KSES
// so wp_update_post / the_content don't strip it from the page islands.
add_filter( 'wp_kses_allowed_html', function( $tags, $context ) {
    if ( $context === 'post' ) {
        $tags['iframe'] = array( 'src' => true, 'width' => true, 'height' => true, 'class' => true, 'style' => true, 'scrolling' => true, 'loading' => true, 'frameborder' => true, 'title' => true );
    }
    return $tags;
}, 10, 2 );
${editorStyleBlock}${mobileViewportBlock}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the complete file set for the alt (carry-and-scope) block theme.
 * Returns an array of `{path, content}` — the caller writes them to disk.
 */
export function buildCarryThemeFiles(input: CarryThemeInput): ThemeFile[] {
  // Non-responsive (classic/adaptive) Wix carries a FIXED-width mobile canvas as a
  // .lib-carry-vp-mobile iframe (CarryPage.mobile). Only such carries need the width=320
  // mobile-viewport swap + the carried-viewport-meta strip; a responsive or non-Wix carry
  // never sets `mobile`, so its theme stays byte-identical (the "only when necessary" gate).
  const hasMobileCanvas = input.pages.some((p) => p.mobile);
  const pages = hasMobileCanvas
    ? input.pages.map((p) =>
        p.scaffold ? { ...p, scaffold: { ...p.scaffold, openWrap: stripViewportMeta(p.scaffold.openWrap) } } : p,
      )
    : input.pages;

  // Block themes do NOT auto-enqueue style.css on the front end — it's only the
  // theme-header file. So the reset must ride the enqueued site.css instead, and
  // it goes FIRST so the carried source CSS overrides it (the reset must lose the
  // cascade to the source's own rules).
  //
  // `all:revert` reverts the body to the UA stylesheet, which REINTRODUCES the
  // default `<body>` margin (8px) — and the carried `body{margin:0}` reset is now
  // `:where(body.lib-carry-site){margin:0}` (zero specificity), so it can't override
  // it. That 8px shifts the whole carried layout down vs the source. Zero
  // margin/padding explicitly (same rule, after `all:revert`, so it wins).
  const RESET =
    'body.lib-carry-site{all:revert;margin:0;padding:0}\nbody.lib-carry-site *{box-sizing:border-box}\n';

  // When the page templates carry the wrapper scaffold + chrome parts, the
  // template-part wrapper element (`<div class="wp-block-template-part">`) would
  // otherwise become a grid/flex item of the source layout and displace the
  // carried chrome. `display:contents` makes that wrapper box-less so the real
  // <header>/<footer> stay where the source put them. (No-op when no parts.)
  const usesScaffold = pages.some((p) => p.scaffold);
  const CHROME_RESCUE = usesScaffold ? '.wp-block-template-part{display:contents}\n' : '';

  // Wix paints every section/page background as DECORATIVE layers — `[data-hook="bgLayers"]`
  // wrappers and their `[data-testid="colorUnderlay"]` color fill — positioned `absolute; inset:0`.
  // In the live Wix runtime these never catch clicks: they sit behind the content and the
  // section wrapper is a positioned containing block, so each layer fills only its own section.
  // The static carry loses that containment — the section wrapper computes to `position:static`,
  // so an absolute layer escapes its section and can blanket the whole page, floating ON TOP of
  // the carried content (with `pointer-events:auto`) and swallowing every click on the links
  // beneath it (Read More buttons, nav, CTAs). These layers are purely decorative and must never
  // be interactive, so force them transparent to pointer events. (`!important` to win regardless
  // of the carried source CSS — mirrors VP_TOGGLE_CSS's must-win overrides below.)
  const BG_LAYER_CLICK_FIX =
    'body.lib-carry-site [data-hook="bgLayers"],' +
    'body.lib-carry-site [data-testid="colorUnderlay"],' +
    'body.lib-carry-site [data-motion-part^="BG_LAYER"]{pointer-events:none!important}\n';

  // Wix pro-galleries freeze their items at JS-computed desktop ABSOLUTE
  // coordinates, so on mobile only the leftmost column is on screen. Rather than
  // fight the widget's deeply-nested frozen wrappers with CSS (every reset reveals
  // another inline-styled level), `appendGalleryMobileGrid` emits an ADDITIVE
  // single-column grid of the same images next to the widget; this CSS hides the
  // widget and shows that grid below 750px. Desktop (where the frozen grid IS
  // correct) is untouched. See gallery-mobile-grid.ts.
  const GALLERY_REFLOW = GALLERY_MOBILE_GRID_CSS;

  // Store-header rescue (Shopify Dawn-family). The carried chrome CSS is :where()-scoped
  // (zero specificity, to preserve the SOURCE cascade), so in the isolated store-header
  // part it LOSES key layout/style rules to resets+defaults that content pages win via
  // their own page CSS — the header collapses to block (logo/nav/icons stack), nav links
  // pick up the generic `.link` underline + the default 1rem size, and the announcement
  // arrow SVG (viewBox, no width attr) renders huge. These rules reassert the source
  // intent for the store header. All selectors key off Dawn's `header__*` / `header--*`
  // BEM classes (and `.announcement-bar`), so they are a NO-OP on themes that lack them.
  // The fully general fix (any theme) is a computed-style-inlined header snapshot; this is
  // the pragmatic rescue for the common Shopify-Dawn case. Scoped to two wrappers, neither of
  // which ever contains a content-page island (islands are post_content):
  //   - `.lib-carry-vp-desktop` — the store-header part's own wrapper
  //   - `.wp-block-template-part` — the PER-PAGE header parts. Page templates render these
  //     with `tagName:div` (box-less via display:contents), so the tag+class wrapper rescue
  //     below never fires for them; without this scope the carried Dawn
  //     `header/#shopify-section-header{display:none!important}` rules hide the whole lifted
  //     header on every content page + front page (getsnooz dogfood finding, 2026-06-09).
  const scopes = ['body.lib-carry-site .lib-carry-vp-desktop', 'body.lib-carry-site .wp-block-template-part'];
  /** Expand each selector under both rescue scopes: both('a','b') → 'S1 a,S2 a,S1 b,S2 b'. */
  const both = (...sels: string[]): string =>
    sels.flatMap((sel) => scopes.map((s) => `${s} ${sel}`)).join(',');
  const STORE_HEADER_RESCUE =
    // Header PART VISIBILITY (the actual blocker for lifting the header into global chrome). The
    // store/native header part renders as `<header class="wp-block-template-part">` (tagName:header).
    // Carried Dawn CSS includes a `header{display:none!important}` rule (a source no-JS / section-hide
    // pattern), scoped `:where(body.lib-carry-site)` — zero specificity but `!important` — which
    // MATCHES that injected wrapper `<header>` and hides the ENTIRE part (dragging everything to 0px,
    // even though the inner `.header` is force-gridded below). Force the part wrapper visible with a
    // tag+class selector (higher specificity than the bare `header`, so it wins among !important).
    `body.lib-carry-site header.wp-block-template-part{display:block!important}\n` +
    // Then keep the header GROUP CONTAINERS inside it visible (the same `:where()` zero-spec problem
    // can hit `<sticky-header>` and the section wrappers). NOT the interactive drawers
    // (header-drawer / menu-drawer / cart-drawer) — those must stay hidden when closed.
    `${both('sticky-header', '.header-wrapper', '.shopify-section-group-header-group')}{display:block!important}\n` +
    `${both('.announcement-bar svg', '.announcement-bar__message svg', '.announcement-bar__link svg')}{width:1.2rem;height:auto;display:inline-block;vertical-align:middle}\n` +
    // Restore the header grid (logo | nav | icons). Scoped to Dawn's header-layout
    // modifiers so it never forces grid on an unrelated `.header` element.
    `${both('.header.header--top-left', '.header.header--top-center', '.header.header--middle-left', '.header.header--middle-center', '.header.header--mobile-center', '.header.header--mobile-left')}{display:grid!important}\n` +
    `${both('.header__icons')}{display:flex!important;align-items:center}\n` +
    // Nav links: drop the generic `.link` underline and restore Dawn's nav size.
    `${both('.header__menu-item')}{font-size:1.4rem;text-decoration:none}\n` +
    `${both('.header__inline-menu .list-menu__item')}{text-decoration:none}\n`;

  // Dual-viewport toggle for classic/adaptive Wix mobile-DOM carry. When a page
  // emits a dual island (desktop content in `.lib-carry-vp-desktop` + a
  // `.lib-carry-vp-mobile` iframe of the captured 320px mobile DOM), this hides the
  // desktop island + chrome parts below 750px and shows the iframe, collapsing the
  // page to 320px and neutralizing the desktop scaffold containers (so the iframe
  // determines the width). The iframe is viewport-isolated, so `[id^=pageBackground]`
  // here only matches the DESKTOP scaffold — no leak into the mobile DOM. Harmless
  // on desktop-only pages (`.lib-carry-vp-*` simply don't exist). See
  // page-reconstruct-carry.ts (dualIsland) + project_liberate_alt_parity_ceiling.
  // Every aggressive rule is gated on `:has(.lib-carry-vp-mobile)` so it ONLY fires on
  // pages that actually emit a mobile island — a desktop-only page (no mobile capture)
  // keeps its normal mobile rendering.
  const VP_TOGGLE_CSS =
    '.lib-carry-vp-desktop{display:contents}\n' +
    '.lib-carry-vp-mobile{display:none}\n' +
    '.lib-carry-mobile-frame{border:0;display:block;width:320px;max-width:320px;margin:0}\n' +
    '@media screen and (max-width:750px){' +
    'html:has(.lib-carry-vp-mobile),body.lib-carry-site:has(.lib-carry-vp-mobile){width:320px!important;min-width:0!important;max-width:320px!important;overflow-x:hidden!important}' +
    'body.lib-carry-site:has(.lib-carry-vp-mobile) .lib-carry-vp-desktop{display:none!important}' +
    'body.lib-carry-site:has(.lib-carry-vp-mobile) .wp-block-template-part{display:none!important}' +
    'body.lib-carry-site:has(.lib-carry-vp-mobile) #masterPage,body.lib-carry-site:has(.lib-carry-vp-mobile) #SITE_CONTAINER,body.lib-carry-site:has(.lib-carry-vp-mobile) #site-root,' +
    'body.lib-carry-site:has(.lib-carry-vp-mobile) [id^="SITE_PAGES"],body.lib-carry-site:has(.lib-carry-vp-mobile) #pagesContainer,' +
    'body.lib-carry-site:has(.lib-carry-vp-mobile) [id^="pageBackground"],body.lib-carry-site:has(.lib-carry-vp-mobile) [id^="bgLayers_pageBackground"]{display:contents!important}' +
    'body.lib-carry-site .lib-carry-vp-mobile{display:block!important}' +
    '}\n';

  // Map each distinct chrome variant to its part slugs (variant 0 → header/footer).
  const slugsByKey = new Map<string, ChromeSlugs>();
  input.chromeVariants.forEach((v, i) => slugsByKey.set(v.key, chromeSlugsForIndex(i)));
  // Fallback for pages whose chromeKey somehow isn't in the variant list (defensive).
  const slugsFor = (key: string): ChromeSlugs =>
    slugsByKey.get(key) ?? chromeSlugsForIndex(0);

  const settings: Record<string, unknown> = { layout: { contentSize: '100%', wideSize: '100%' } };
  // Register the captured palette + fonts so product-marketing core blocks resolve their
  // token references (the carry theme is otherwise token-less — verbatim CSS islands).
  if (input.themeJsonPalette?.length) settings.color = { palette: input.themeJsonPalette };
  if (input.themeJsonFontFamilies?.length) settings.typography = { fontFamilies: input.themeJsonFontFamilies };
  const themeJson: Record<string, unknown> = {
    $schema: 'https://schemas.wp.org/trunk/theme.json',
    version: 3,
    settings,
  };
  // Declare every variant's chrome areas so the Site Editor treats each header/
  // footer as a first-class, synced region.
  const hasChrome = input.chromeVariants.some((v) => v.headerIsland || v.footerIsland);
  if (hasChrome) {
    themeJson.templateParts = input.chromeVariants.flatMap((v, i) => {
      const s = chromeSlugsForIndex(i);
      const suffix = i === 0 ? '' : ` ${i + 1}`;
      return [
        { name: s.header, title: `Header${suffix}`, area: 'header' },
        { name: s.footer, title: `Footer${suffix}`, area: 'footer' },
      ];
    });
  }
  // Declare the dedicated store header part so the Site Editor treats it as a
  // first-class header region too.
  if (input.hasProducts && input.storeHeaderIsland) {
    const tp = (themeJson.templateParts as Array<Record<string, string>> | undefined) ?? [];
    tp.push({ name: STORE_HEADER_SLUG, title: 'Header (Store)', area: 'header' });
    themeJson.templateParts = tp;
  }

  // Island-less templates (native blog single/home/archive + the index.html fallback) have NO
  // carried island; on Shopify-family carries the per-page header part is empty, so they would
  // render with no nav/logo. When a populated store header was carved, render IT on them — it is
  // styled by the GLOBAL chrome CSS (siteCss), since the header now splits into the chrome region
  // (see split-regions-deep), so no per-page donor CSS is needed.
  const homePage = pages.find((p) => p.isHome);
  const homeSlugs = slugsFor(homePage?.chromeKey ?? input.chromeVariants[0]?.key ?? '');
  const nativeBlog = input.nativeBlog ?? !pages.some((p) => p.postType === 'post');
  const useStoreHeader = (input.hasProducts ?? false) && !!input.storeHeaderIsland;
  const storeHeaderSlugs: ChromeSlugs = { header: STORE_HEADER_SLUG, footer: homeSlugs.footer };

  // index.html (required fallback — also serves 404 / search when those templates are absent).
  // With a carved store header, render real chrome + a recent-posts loop; else reuse the home
  // page's scaffold/shell (legacy behavior).
  const indexTemplate = useStoreHeader
    ? nativeBlogTemplate(nativeQueryLoop(NATIVE_HOME_TITLE), storeHeaderSlugs)
    : homePage?.scaffold
      ? scaffoldedTemplate(homePage.scaffold, homeSlugs, homePage.mobile)
      : pageTemplate(homeSlugs);

  // Site-wide CSS — reset first (so source rules win the cascade), then the
  // chrome-wrapper rescue, then EVERY variant's carried chrome CSS (concatenated
  // upstream into siteCss; comp-id-scoped so variants never collide).
  const siteCss =
    RESET +
    CHROME_RESCUE +
    BG_LAYER_CLICK_FIX +
    GALLERY_REFLOW +
    STORE_HEADER_RESCUE +
    VP_TOGGLE_CSS +
    input.siteCss +
    buildWooBuyboxRemRestore({
      hasProducts: input.hasProducts ?? false,
      rootFontSizeApplied: /:root\s*\{[^}]*font-size/i.test(input.siteCss),
    });

  const files: ThemeFile[] = [
    { path: 'style.css', content: styleCssHeader(input.themeName) },
    { path: 'theme.json', content: JSON.stringify(themeJson, null, 2) },
    { path: 'functions.php', content: functionsPhp(pages, input.bodyClasses ?? [], hasMobileCanvas) },
    { path: 'assets/css/site.css', content: siteCss },
    // Editor-only mirror of site.css: carry scope neutralized to `body` so the
    // block-editor canvas (scoped to .editor-styles-wrapper) renders the global
    // carried design. Loaded via add_editor_style; front-end site.css is untouched.
    { path: 'assets/css/editor-site.css', content: editorScopeCss(siteCss) },
    { path: 'templates/index.html', content: indexTemplate },
  ];

  // One header/footer part pair per DISTINCT chrome variant.
  input.chromeVariants.forEach((v, i) => {
    const s = chromeSlugsForIndex(i);
    files.push({ path: `parts/${s.header}.html`, content: v.headerIsland + '\n' });
    files.push({ path: `parts/${s.footer}.html`, content: v.footerIsland + '\n' });
  });

  // Per-page CSS + template files. Posts share ONE single.html; the per-post body
  // class + enqueued page-<slug>.css still scope each post's carried CSS.
  let emittedSingle = false;
  for (const p of pages) {
    files.push({ path: `assets/css/page-${p.slug}.css`, content: p.pageCss });
    // Editor-only mirror of the per-page CSS (scope neutralized to `body`).
    // block_editor_settings_all injects ONLY the edited page's file into the
    // canvas, so each post editor renders its island styled without cross-bleed.
    files.push({ path: `assets/css/editor-page-${p.slug}.css`, content: editorScopeCss(p.pageCss) });
    const slugs = slugsFor(p.chromeKey);
    if (p.isHome) {
      files.push({ path: 'templates/front-page.html', content: templateFor(p, slugs) });
    } else if (p.postType === 'post') {
      if (!emittedSingle) {
        files.push({ path: 'templates/single.html', content: templateFor(p, slugs) });
        emittedSingle = true;
      }
    } else {
      files.push({ path: `templates/page-${p.slug}.html`, content: templateFor(p, slugs) });
    }
  }

  // Hybrid blog: when no POST is carried, the per-page loop above never emits a
  // single.html, so native posts/archives would fall back to index.html (the homepage
  // shell). Emit clean native blog templates from the home page's scaffold so native
  // posts (single.html), the posts page (home.html) and date/term archives (archive.html)
  // render properly. index.html is left as the homepage fallback. The carried-post case
  // (posts in the carry set) keeps its own single.html via the loop above.
  if (nativeBlog) {
    // Island-less: with a carved store header, render it (clean header → main → footer, no home
    // scaffold) so blog pages get real chrome; else keep the home scaffold's (maybe empty) header.
    const nativeSlugs: ChromeSlugs = useStoreHeader ? storeHeaderSlugs : homeSlugs;
    const sc = useStoreHeader ? undefined : homePage?.scaffold;
    files.push({ path: 'templates/single.html', content: nativeBlogTemplate(NATIVE_SINGLE_MIDDLE, nativeSlugs, sc) });
    files.push({ path: 'templates/home.html', content: nativeBlogTemplate(nativeQueryLoop(NATIVE_HOME_TITLE), nativeSlugs, sc) });
    files.push({ path: 'templates/archive.html', content: nativeBlogTemplate(nativeQueryLoop(NATIVE_ARCHIVE_TITLE), nativeSlugs, sc) });
  }

  // WooCommerce store templates. Product + shop/category-archive pages have NO carried
  // island, so WordPress falls back to WooCommerce's bare default templates (no site
  // chrome). When the run has products and we isolated a header from a carried page,
  // emit single-product / archive-product templates that wrap the classic WC template
  // (full functionality) in the dedicated store header + canonical footer + a frame.
  if (input.hasProducts && input.storeHeaderIsland) {
    const sh = input.storeHeaderIsland.endsWith('\n') ? input.storeHeaderIsland : `${input.storeHeaderIsland}\n`;
    files.push({ path: `parts/${STORE_HEADER_SLUG}.html`, content: sh });
    files.push({ path: 'templates/single-product.html', content: wooSingleProductTemplate() });
    files.push({ path: 'templates/archive-product.html', content: wooArchiveTemplate() });
  }

  return files;
}

// ---------------------------------------------------------------------------
// WooCommerce buy-box rem restore
// ---------------------------------------------------------------------------

export interface WooRestoreOpts {
  hasProducts: boolean;
  rootFontSizeApplied: boolean;
}

/** WooCommerce buy-box blocks are WP additions designed for a 16px root; when the
 *  carry adopts the source's non-default root (e.g. 62.5%), restore them to legible
 *  rem sizes. Scoped to single-product so it never touches source content. */
export function buildWooBuyboxRemRestore(opts: WooRestoreOpts): string {
  if (!opts.hasProducts || !opts.rootFontSizeApplied) return '';
  return (
    '\n/* carry: keep WooCommerce buy-box legible under the source non-default root */\n' +
    'body.single-product .wp-block-woocommerce-product-price,\n' +
    'body.single-product .price{font-size:1.8rem!important}\n' +
    'body.single-product .wc-block-components-product-summary,\n' +
    'body.single-product .wc-block-components-product-summary p,\n' +
    'body.single-product .wp-block-woocommerce-product-summary{font-size:1.6rem!important}\n'
  );
}
