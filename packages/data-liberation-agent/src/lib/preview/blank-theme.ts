// src/lib/preview/blank-theme.ts
//
// Generates a minimal "blank" WordPress theme that gets out of the way so the
// carried site.css fully controls the look. Enqueues site.css (front-end +
// editor), optionally site.js (footer) + an enforced CSP, re-links CDN fonts,
// and renders the_content() with a native WP block header (nav) + baked footer.
//
// Header strategy (WHY do_blocks + classic theme)
// ────────────────────────────────────────────────
// The site header is generated as WP block markup (wp:navigation with
// overlayMenu:"mobile") and rendered via PHP's `do_blocks()` inside the
// classic theme template. This is the choice that makes the hamburger
// ACTUALLY FUNCTIONAL:
//
//   - `do_blocks()` triggers the Navigation block's server-side render in WP 6.5+.
//   - Server-side render of wp:navigation causes `wp-block-navigation-view`
//     (the Interactivity API script) to be enqueued.
//   - `wp_head()` + `wp_footer()` then emit the enqueued assets so the hamburger
//     toggle JS loads at runtime.
//
// A full block theme was considered but rejected: it requires theme.json +
// templates/index.html + parts — more complexity for the same interactivity
// outcome. The classic + do_blocks approach is simpler and more robust.
//
// Footer strategy: the baked footer HTML (captured from the source, sanitized)
// is still emitted as a static <footer> element. No change from prior behavior.
//
import { LIBRARY_CDN_ALLOWLIST } from '../screenshot/js-aggregator.js';
import type { ReplicaFile } from './types.js';
import { buildThemeHeader } from '../replicate/theme-php.js';

export interface BlankThemeOpts {
  themeSlug: string;
  hasJs: boolean;
  headLinks: string[]; // CDN/cross-origin stylesheet hrefs to re-link (e.g. Google Fonts)
  /**
   * WP block markup for the header part (from buildBlockHeader).
   * When present, rendered via do_blocks() to enqueue the Navigation block's
   * Interactivity API view module (making the hamburger functional).
   * Also written to parts/header.html for theme-agent inspection/refinement.
   */
  headerBlockMarkup?: string;
  /** Sanitized site footer HTML to emit as a real theme chrome element. */
  footerHtml?: string;
  /**
   * Responsive chrome CSS (from generateChromeCss dual-viewport bake).
   * When present, chrome.css is written as a theme file and enqueued after
   * site.css so its @media rules override site.css for the chrome markers.
   */
  hasChromeCss?: boolean;
  /**
   * Whether design capture is active (nav/dual-viewport fragments present).
   * When true, the mobile scale CSS and fit script are emitted so the fixed-
   * width mobile canvas is scaled down to the viewport width on mobile devices.
   */
  hasDesignCapture?: boolean;
}

export function buildBlankTheme(opts: BlankThemeOpts): ReplicaFile[] {
  const { themeSlug, hasJs, headLinks, headerBlockMarkup, footerHtml, hasChromeCss, hasDesignCapture } = opts;

  const styleCss = buildThemeHeader([
    ['Theme Name', `DLA Replica (${themeSlug})`],
    ['Description', 'Blank companion theme for html-first design replication. Carried CSS lives in site.css.'],
    ['Version', '1.0.0'],
  ]);

  const fontEnqueues = headLinks
    .map((href, i) => `  wp_enqueue_style('dla-font-${i}', ${phpString(href)}, array(), null);`)
    .join('\n');

  const jsEnqueue = hasJs
    ? `  wp_enqueue_script('dla-site', get_stylesheet_directory_uri() . '/site.js', array(), null, true);`
    : '';

  const cspHosts = ["'self'", ...LIBRARY_CDN_ALLOWLIST].join(' ');
  const cspBlock = hasJs
    ? `
add_action('send_headers', function () {
  header("Content-Security-Policy: default-src 'self' data: https:; script-src ${cspHosts}; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:;");
});`
    : '';

  // chrome.css is enqueued AFTER site.css (depends on it) so its @media rules
  // override any responsive rules in site.css for .dla-fx-N marker selectors.
  const chromeCssEnqueue = hasChromeCss
    ? `  wp_enqueue_style('dla-chrome', get_stylesheet_directory_uri() . '/chrome.css', array('dla-site'), null);`
    : '';

  // Viewport-toggle CSS: show the desktop body fragment at ≥769px, mobile at ≤768px.
  // Both .dla-content-desktop and .dla-content-mobile divs are always present in the
  // post content when both viewport captures succeeded. The toggle hides the inactive
  // one. This is inlined in functions.php (not a separate file) because it is a fixed
  // rule that never varies per-site and is always needed when design capture is active.
  //
  // Content-top reset: the absolute-positioned header overlays the first content
  // section (the hero) so the page starts at top:0 — no theme margin/padding must
  // push the content down before the header covers it.  The <main> reset also
  // removes any block-start margin WP themes add to the content wrapper.
  const toggleCss = `
@media (max-width: 768px){ .dla-content-desktop{display:none !important} }
@media (min-width: 769px){ .dla-content-mobile{display:none !important} }
body .wp-site-blocks > main, body > main, main.wp-block-group, .dla-replica:first-child{ margin-top:0 !important; padding-top:0 !important; }
`;

  // Mobile scale CSS: clip the outer shell and set the transform origin on the inner
  // canvas. Applied only at ≤768px (desktop clears the transform via the fit script).
  // The fit script below sets the actual scale() transform at runtime so we don't
  // hardcode any canvas width here.
  const mobileScaleCss = `
@media (max-width: 768px){
  .dla-content-mobile{ overflow: hidden; }
  .dla-content-mobile-inner{ transform-origin: top left; }
}
`;

  // Fit script: measures the mobile inner canvas's natural scrollWidth at runtime
  // (robust to any source canvas size — no hardcoded 980px) and scales it to fill
  // the viewport width. Sets outer height to the scaled height so the page flow
  // is correct (CSS transform doesn't affect layout). Clears the transform above
  // 768px (desktop fragment shows instead). Runs on DOMContentLoaded, load, and
  // resize. This is a first-party layout helper — NOT tracking/analytics.
  const mobileScaleScript = `(function(){
  function fit(){
    var outer=document.querySelector('.dla-content-mobile');
    var inner=document.querySelector('.dla-content-mobile-inner');
    if(!outer||!inner) return;
    if(window.innerWidth>768){ inner.style.transform=''; inner.style.width=''; outer.style.height=''; return; }
    inner.style.transform='none'; inner.style.width='';
    var natural=inner.scrollWidth||980;
    var s=window.innerWidth/natural;
    inner.style.width=natural+'px';
    inner.style.transform='scale('+s+')';
    outer.style.height=(inner.scrollHeight*s)+'px';
  }
  if(document.readyState!=='loading') fit(); else document.addEventListener('DOMContentLoaded',fit);
  window.addEventListener('resize',fit);
  window.addEventListener('load',fit);
})();`;

  // The fit script attaches to its OWN registered+enqueued (src-less) handle, NOT
  // 'dla-site' — the 'dla-site' SCRIPT handle is only enqueued when first-party JS
  // is carried (hasJs), so attaching there silently drops the script on most runs.
  // A dedicated footer handle always prints the inline fit script.
  const designCaptureInline = hasDesignCapture
    ? `  wp_add_inline_style('dla-site', ${phpString(mobileScaleCss)});
  wp_register_script('dla-mobile-fit', false, array(), null, true);
  wp_enqueue_script('dla-mobile-fit');
  wp_add_inline_script('dla-mobile-fit', ${phpString(mobileScaleScript)});`
    : '';

  const functionsPhp = `<?php
// The carried fragment is raw HTML — prevent WordPress content filters from
// mangling it. wpautop inserts stray <p> tags; wptexturize alters quotes/dashes.
remove_filter('the_content', 'wpautop');
remove_filter('the_content', 'wptexturize');

add_action('wp_enqueue_scripts', function () {
  wp_enqueue_style('dla-site', get_stylesheet_directory_uri() . '/site.css', array(), null);
${chromeCssEnqueue}
${fontEnqueues}
${jsEnqueue}
  // Dual-viewport toggle: show desktop body fragment ≥769px, mobile ≤768px.
  wp_add_inline_style('dla-site', ${phpString(toggleCss)});
${designCaptureInline}
});
add_action('after_setup_theme', function () {
  add_editor_style('site.css');
});${cspBlock}
`;

  // ── Header block rendering ──────────────────────────────────────────────────
  // The block markup is stored in a PHP variable, then rendered via do_blocks().
  // do_blocks() triggers wp:navigation server-side render, which enqueues the
  // Navigation Interactivity API view module — making the hamburger functional.
  //
  // Security note: the block markup is generated by buildBlockHeader from
  // captured ExtractedNav (nav items, logo URL). It never contains raw user
  // HTML or unsanitized attributes — the generator escapes all text/href values.
  // We emit it as a PHP heredoc so no PHP escaping issues arise.
  const headerPhpBlock = headerBlockMarkup
    ? `<?php
// Render the WP block header via do_blocks() so the Navigation block's
// Interactivity API view script (hamburger toggle) is enqueued.
// Parts/header.html carries the same markup for theme-agent inspection.
$dla_header_markup = get_stylesheet_directory() . '/parts/header.html';
$dla_header_blocks = file_exists($dla_header_markup)
    ? file_get_contents($dla_header_markup)
    : '';
if ($dla_header_blocks) {
    echo do_blocks($dla_header_blocks);
}
?>`
    : '';

  // ── Footer (baked HTML, unchanged from prior behavior) ─────────────────────
  // Escape any literal </script> inside the baked chrome HTML so it cannot
  // break out of a surrounding <script> block (defense-in-depth; sanitize
  // already strips <script> tags, but fragment strings get baked inline here).
  const safeHtml = (html: string): string => html.replace(/<\/script/gi, '<\\/script');

  const footerBlock = footerHtml
    ? `\n<footer class="dla-site-footer">${safeHtml(footerHtml)}</footer>`
    : '';

  const chromeSafetyCss = footerHtml
    ? `\n<style>.dla-site-footer{position:relative;width:100%;}</style>`
    : '';

  const template = `<?php
/* Blank template — carried CSS owns the look; WP block header + baked footer. */
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>${chromeSafetyCss}
</head>
<body <?php body_class('dla-replica'); ?>>
${headerPhpBlock}<main><?php if (have_posts()) { while (have_posts()) { the_post(); the_content(); } } ?></main>${footerBlock}
<?php wp_footer(); ?>
</body>
</html>
`;

  const files: ReplicaFile[] = [
    { relativePath: 'style.css', content: styleCss },
    { relativePath: 'functions.php', content: functionsPhp },
    { relativePath: 'index.php', content: template },
    { relativePath: 'page.php', content: template },
    { relativePath: 'singular.php', content: template },
  ];

  // Write block header markup to parts/header.html for theme-agent inspection.
  if (headerBlockMarkup) {
    files.push({ relativePath: 'parts/header.html', content: headerBlockMarkup });
  }

  return files;
}

function phpString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
