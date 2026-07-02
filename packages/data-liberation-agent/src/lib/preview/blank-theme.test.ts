import { describe, it, expect } from 'vitest';
import { buildBlankTheme } from './blank-theme.js';

describe('buildBlankTheme', () => {
  it('emits a valid theme enqueuing site.css; site.js + CSP only when scripts present', () => {
    const noJs = buildBlankTheme({ themeSlug: 'dla-replica', hasJs: false, headLinks: ['https://fonts.googleapis.com/css?f=X'] });
    const paths = noJs.map((f) => f.relativePath);
    expect(paths).toContain('style.css');
    expect(paths).toContain('functions.php');
    expect(paths).toContain('index.php');
    const fns = noJs.find((f) => f.relativePath === 'functions.php')!.content;
    expect(fns).toContain('wp_enqueue_style');
    expect(fns).toContain('site.css');
    expect(fns).toContain('add_editor_style');
    expect(fns).toContain('fonts.googleapis.com');
    expect(fns).not.toContain('site.js');
    expect(fns).not.toContain('Content-Security-Policy');
    // wpautop / wptexturize must be removed so carried raw HTML is not mangled
    expect(fns).toContain("remove_filter('the_content', 'wpautop')");
    expect(fns).toContain("remove_filter('the_content', 'wptexturize')");

    const withJs = buildBlankTheme({ themeSlug: 'dla-replica', hasJs: true, headLinks: [] }).find((f) => f.relativePath === 'functions.php')!.content;
    expect(withJs).toContain('site.js');
    expect(withJs).toContain('Content-Security-Policy');
    expect(withJs).toContain("script-src 'self'");
    expect(withJs).toContain('cdn.jsdelivr.net');
  });

  it('index.php renders the_content with no get_header/get_footer/sidebar calls', () => {
    const idx = buildBlankTheme({ themeSlug: 'dla-replica', hasJs: false, headLinks: [] }).find((f) => f.relativePath === 'index.php')!.content;
    expect(idx).toContain('the_content()');
    expect(idx).not.toMatch(/get_header|get_footer|get_sidebar/);
  });

  it('index.php renders block header via do_blocks() when headerBlockMarkup is provided', () => {
    const BLOCK_MARKUP = '<!-- wp:navigation {"overlayMenu":"mobile"} --><!-- /wp:navigation -->';
    const files = buildBlankTheme({
      themeSlug: 'dla-replica',
      hasJs: false,
      headLinks: [],
      headerBlockMarkup: BLOCK_MARKUP,
      footerHtml: '<p>Footer text &copy; 2025</p>',
    });
    const idx = files.find((f) => f.relativePath === 'index.php')!.content;

    // Block header is rendered via do_blocks(), NOT a baked <header> element
    expect(idx).toContain('do_blocks');
    expect(idx).toContain('parts/header.html');
    // Old baked header class must NOT appear
    expect(idx).not.toContain('dla-site-header');

    // Footer still baked as usual
    expect(idx).toContain('<footer class="dla-site-footer">');
    expect(idx).toContain('<p>Footer text &copy; 2025</p>');
    expect(idx).toContain('<main>');
    expect(idx).toContain('the_content()');

    // parts/header.html written with block markup
    const headerPart = files.find((f) => f.relativePath === 'parts/header.html');
    expect(headerPart).toBeDefined();
    expect(headerPart!.content).toContain('wp:navigation');
  });

  it('index.php omits chrome when no header markup or footer HTML provided', () => {
    const files = buildBlankTheme({ themeSlug: 'dla-replica', hasJs: false, headLinks: [] });
    const idx = files.find((f) => f.relativePath === 'index.php')!.content;
    expect(idx).not.toContain('dla-site-header');
    expect(idx).not.toContain('dla-site-footer');
    expect(idx).not.toContain('do_blocks');
    expect(idx).toContain('the_content()');
    // No parts/header.html when no block markup provided
    expect(files.find((f) => f.relativePath === 'parts/header.html')).toBeUndefined();
  });

  it('index.php emits only block header when only headerBlockMarkup provided (no footer)', () => {
    const files = buildBlankTheme({
      themeSlug: 'dla-replica',
      hasJs: false,
      headLinks: [],
      headerBlockMarkup: '<!-- wp:navigation /-->',
    });
    const idx = files.find((f) => f.relativePath === 'index.php')!.content;
    expect(idx).toContain('do_blocks');
    expect(idx).not.toContain('<footer class="dla-site-footer">');
  });

  it('style.css has a valid theme header', () => {
    const style = buildBlankTheme({ themeSlug: 'dla-replica', hasJs: false, headLinks: [] }).find((f) => f.relativePath === 'style.css')!.content;
    expect(style).toMatch(/Theme Name:/);
  });

  it('functions.php emits dual-viewport toggle CSS via wp_add_inline_style', () => {
    const fns = buildBlankTheme({ themeSlug: 'dla-replica', hasJs: false, headLinks: [] }).find((f) => f.relativePath === 'functions.php')!.content;
    // Toggle rules must be present via wp_add_inline_style
    expect(fns).toContain('wp_add_inline_style');
    expect(fns).toContain('dla-content-desktop');
    expect(fns).toContain('dla-content-mobile');
    // Desktop hidden at ≤768px, mobile hidden at ≥769px
    expect(fns).toContain('max-width: 768px');
    expect(fns).toContain('min-width: 769px');
    expect(fns).toContain('display:none !important');
  });

  it('functions.php does NOT emit scale CSS or fit script when hasDesignCapture is absent', () => {
    const fns = buildBlankTheme({ themeSlug: 'dla-replica', hasJs: false, headLinks: [] }).find((f) => f.relativePath === 'functions.php')!.content;
    expect(fns).not.toContain('dla-content-mobile-inner');
    expect(fns).not.toContain('scrollWidth');
    expect(fns).not.toContain("transform='scale'");
  });

  it('functions.php emits content-top spacing reset so absolute header overlays the hero', () => {
    const fns = buildBlankTheme({ themeSlug: 'dla-replica', hasJs: false, headLinks: [] }).find((f) => f.relativePath === 'functions.php')!.content;
    // The absolute-positioned header must overlay the first content section (hero) at top:0.
    // A margin/padding-top reset on the main content wrapper is required so the page
    // starts at the very top with no theme spacing pushing content below the header.
    expect(fns).toContain('margin-top:0 !important');
    expect(fns).toContain('padding-top:0 !important');
    // The rule must target the content wrapper selectors.
    expect(fns).toContain('wp-site-blocks');
    expect(fns).toContain('dla-replica');
  });

  it('functions.php emits scale CSS and fit script when hasDesignCapture is true', () => {
    const fns = buildBlankTheme({
      themeSlug: 'dla-replica',
      hasJs: false,
      headLinks: [],
      headerBlockMarkup: '<!-- wp:navigation /-->',
      hasDesignCapture: true,
    }).find((f) => f.relativePath === 'functions.php')!.content;

    // Scale CSS: clip outer, set transform-origin on inner
    expect(fns).toContain('dla-content-mobile-inner');
    expect(fns).toContain('transform-origin: top left');
    expect(fns).toContain('.dla-content-mobile{ overflow: hidden; }');

    // Fit script emitted via wp_add_inline_script
    expect(fns).toContain('wp_add_inline_script');
    expect(fns).toContain('scrollWidth');
    // Single quotes are escaped by phpString() when embedded in PHP string literals
    expect(fns).toContain("transform=\\'scale(\\'+s+\\')");
    // 768 breakpoint present in the script
    expect(fns).toContain('innerWidth>768');
    // Natural width measured from scrollWidth, not hardcoded
    expect(fns).toContain('inner.scrollWidth||980');
    // Height reservation for correct page flow
    expect(fns).toContain('inner.scrollHeight*s');
  });
});
