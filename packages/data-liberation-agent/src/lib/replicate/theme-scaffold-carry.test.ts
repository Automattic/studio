import { describe, it, expect } from 'vitest';
import { buildCarryThemeFiles, buildWooBuyboxRemRestore, editorScopeCss, type CarryThemeInput, type CarryPage } from './theme-scaffold-carry.js';

/** A single-variant chrome ('c0') so page-level tests stay terse. */
function oneVariant(headerIsland = '', footerIsland = ''): CarryThemeInput['chromeVariants'] {
  return [{ key: 'c0', headerIsland, footerIsland }];
}
/** Default a page onto the single 'c0' variant. */
function page(p: Omit<CarryPage, 'chromeKey'> & { chromeKey?: string }): CarryPage {
  return { chromeKey: 'c0', ...p };
}

describe('buildCarryThemeFiles', () => {
  const files = buildCarryThemeFiles({
    themeName: 'Acme Carry',
    chromeVariants: oneVariant(
      '<!-- wp:html -->\n<header>H</header>\n<!-- /wp:html -->',
      '<!-- wp:html -->\n<footer>F</footer>\n<!-- /wp:html -->',
    ),
    siteCss: 'body.lib-carry-site{margin:0}',
    pages: [page({ slug: 'home', isHome: true, pageCss: 'body.lib-carry-page-home .x{a:b}' })],
  });
  const byPath = (p: string) => files.find((f) => f.path === p)?.content ?? '';

  it('emits required theme files', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toContain('style.css');
    expect(paths).toContain('theme.json');
    expect(paths).toContain('functions.php');
    expect(paths).toContain('parts/header.html');
    expect(paths).toContain('parts/footer.html');
    expect(paths).toContain('assets/css/site.css');
    expect(paths).toContain('assets/css/page-home.css');
  });

  it('home page maps to templates/front-page.html and references header+footer parts', () => {
    const tpl = byPath('templates/front-page.html');
    expect(tpl).toContain('wp:template-part {"slug":"header"');
    expect(tpl).toContain('wp:template-part {"slug":"footer"');
  });

  it('functions.php adds body classes and conditionally enqueues page css', () => {
    const fn = byPath('functions.php');
    expect(fn).toContain('lib-carry-site');
    expect(fn).toContain('lib-carry-page-home');
    expect(fn).toContain('wp_enqueue_style');
  });

  it('replicates sanitized source body classes onto the WP body (e.g. responsive)', () => {
    const fn = buildCarryThemeFiles({
      themeName: 'A', chromeVariants: oneVariant(), siteCss: '',
      bodyClasses: ['responsive', 'device-mobile', 'bad class!', '', '123nope'],
      pages: [page({ slug: 'home', isHome: true, pageCss: '' })],
    }).find((f) => f.path === 'functions.php')!.content;
    expect(fn).toContain("$classes[] = 'responsive';");
    expect(fn).toContain("$classes[] = 'device-mobile';");
    // unsafe tokens are dropped
    expect(fn).not.toContain('bad class!');
    expect(fn).not.toContain("'123nope'");
  });

  it('emits templates/index.html as a required WP block theme fallback template', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toContain('templates/index.html');
    const tpl = byPath('templates/index.html');
    expect(tpl).toContain('wp:template-part {"slug":"header"');
    expect(tpl).toContain('wp:template-part {"slug":"footer"');
  });

  it('style.css contains Theme Name header', () => {
    expect(byPath('style.css')).toContain('Theme Name: Acme Carry');
  });

  it('style.css has a Theme Name header and NO Template field (not a child theme)', () => {
    const s = byPath('style.css');
    expect(s).toContain('Theme Name:');
    expect(s).not.toMatch(/^\s*Template:/m);
  });

  it('site.css carries the reset before the carried CSS', () => {
    const css = byPath('assets/css/site.css');
    expect(css).toContain('all:revert');
    expect(css.indexOf('all:revert')).toBeLessThan(css.indexOf('body.lib-carry-site{margin:0}'));
  });

  it('site.css makes decorative Wix background layers non-interactive (they must not swallow clicks)', () => {
    // Wix bgLayers/colorUnderlay are absolute; inset:0 overlays; without containment a carried
    // one can blanket the page and intercept every click on the links beneath it. They are purely
    // decorative, so the carry forces them pointer-events:none. Unconditional (this fixture has no
    // scaffold), and must win the cascade (!important) over the carried source CSS.
    const css = byPath('assets/css/site.css');
    expect(css).toContain('[data-hook="bgLayers"]');
    expect(css).toContain('[data-testid="colorUnderlay"]');
    expect(css).toMatch(/\[data-testid="colorUnderlay"\][^}]*pointer-events:none!important/);
  });

  it('site.css reasserts the store-header layout for the isolated header part (Dawn-family, scoped to the store-header wrapper)', () => {
    const css = byPath('assets/css/site.css');
    // The carried chrome CSS is :where()-scoped, so the isolated store header loses the
    // grid/flex/nav rules; reassert them scoped to the store-header wrapper.
    expect(css).toContain('.lib-carry-vp-desktop .header.header--middle-left');
    expect(css).toMatch(/\.lib-carry-vp-desktop[^}]*\.header[^}]*display:grid!important/);
    expect(css).toMatch(/\.lib-carry-vp-desktop \.header__icons[^}]*\{display:flex!important/);
    // The header PART wrapper is force-shown — carried `header{display:none!important}` matches the
    // injected <header class="wp-block-template-part"> wrapper; a tag+class selector out-specifies it.
    expect(css).toContain('header.wp-block-template-part{display:block!important}');
    // Header-group containers are force-shown (must win over a competing display:none from page CSS).
    expect(css).toMatch(/\.lib-carry-vp-desktop sticky-header[^}]*display:block!important/);
    // The SAME rescues fire inside per-page header parts (tagName:div wrappers — display:contents,
    // so the header.wp-block-template-part wrapper rescue can't reach them; without this scope the
    // carried Dawn header{display:none!important} hides the lifted header on every content page).
    expect(css).toMatch(/\.wp-block-template-part sticky-header[^}]*display:block!important/);
    expect(css).toMatch(/\.wp-block-template-part \.header\.header--middle-left[^}]*\{display:grid!important/);
    // …but the interactive drawers are NOT force-shown (they must stay hidden when closed).
    expect(css).not.toContain('cart-drawer{display:block!important');
    // Never scoped outside the rescue wrappers (must not touch content-page islands).
    expect(css).not.toMatch(/(^|[^-])body\.lib-carry-site \.header\{display:grid/);
  });

  it('theme.json is valid JSON at version 3', () => {
    expect(JSON.parse(byPath('theme.json')).version).toBe(3);
  });

  it('a non-home page emits templates/page-<slug>.html and is_page() enqueue/body-class', () => {
    const f = buildCarryThemeFiles({
      themeName: 'Acme Carry', chromeVariants: oneVariant(), siteCss: '',
      pages: [page({ slug: 'about', isHome: false, pageCss: '' })],
    });
    expect(f.map((x) => x.path)).toContain('templates/page-about.html');
    expect(f.find((x) => x.path === 'functions.php')!.content).toContain("is_page( 'about' )");
  });

  it('a post scopes via is_single() and its CSS file, not is_page()', () => {
    const f = buildCarryThemeFiles({
      themeName: 'Acme Carry', chromeVariants: oneVariant(), siteCss: '',
      pages: [page({ slug: 'my-article', isHome: false, postType: 'post', pageCss: 'body.lib-carry-page-my-article{}' })],
    });
    const fn = f.find((x) => x.path === 'functions.php')!.content;
    expect(fn).toContain("is_single( 'my-article' )");
    expect(fn).not.toContain("is_page( 'my-article' )");
    expect(f.map((x) => x.path)).toContain('assets/css/page-my-article.css');
    expect(fn).toContain('lib-carry-page-my-article');
  });

  it('posts share ONE single.html and emit no per-post page template', () => {
    const f = buildCarryThemeFiles({
      themeName: 'Acme Carry', chromeVariants: oneVariant(), siteCss: '',
      pages: [
        page({ slug: 'post-a', isHome: false, postType: 'post', pageCss: '' }),
        page({ slug: 'post-b', isHome: false, postType: 'post', pageCss: '' }),
      ],
    });
    const paths = f.map((x) => x.path);
    expect(paths.filter((p) => p === 'templates/single.html')).toHaveLength(1);
    expect(paths).not.toContain('templates/page-post-a.html');
    expect(paths).not.toContain('templates/page-post-b.html');
  });

  describe('per-page chrome variants (dedupe by content)', () => {
    // Home uses variant c0 (transparent overlay); two interior pages share c1 (solid).
    const f = buildCarryThemeFiles({
      themeName: 'Acme Carry',
      chromeVariants: [
        { key: 'c0', headerIsland: '<!-- wp:html --><header id="home-hdr">home</header><!-- /wp:html -->', footerIsland: '<!-- wp:html --><footer id="f0">f0</footer><!-- /wp:html -->' },
        { key: 'c1', headerIsland: '<!-- wp:html --><header id="int-hdr">interior</header><!-- /wp:html -->', footerIsland: '<!-- wp:html --><footer id="f1">f1</footer><!-- /wp:html -->' },
      ],
      siteCss: 'body.lib-carry-site #home-hdr{a:b}\nbody.lib-carry-site #int-hdr{c:d}',
      pages: [
        page({ slug: 'home', isHome: true, chromeKey: 'c0', pageCss: '' }),
        page({ slug: 'about', isHome: false, chromeKey: 'c1', pageCss: '' }),
        page({ slug: 'contact', isHome: false, chromeKey: 'c1', pageCss: '' }),
      ],
    });
    const get = (p: string) => f.find((x) => x.path === p)?.content ?? '';
    const paths = f.map((x) => x.path);

    it('emits one part pair per DISTINCT variant (c0 → header, c1 → header-2)', () => {
      expect(paths).toContain('parts/header.html');
      expect(paths).toContain('parts/footer.html');
      expect(paths).toContain('parts/header-2.html');
      expect(paths).toContain('parts/footer-2.html');
      // not one-per-page: no header-3 for the second c1 page
      expect(paths).not.toContain('parts/header-3.html');
      expect(get('parts/header.html')).toContain('home-hdr');
      expect(get('parts/header-2.html')).toContain('int-hdr');
    });

    it('home template references the home header, interior templates reference header-2', () => {
      expect(get('templates/front-page.html')).toContain('"slug":"header"');
      expect(get('templates/front-page.html')).not.toContain('"slug":"header-2"');
      expect(get('templates/page-about.html')).toContain('"slug":"header-2"');
      expect(get('templates/page-contact.html')).toContain('"slug":"header-2"');
    });

    it('declares every variant\'s parts in theme.json', () => {
      const names = (JSON.parse(get('theme.json')).templateParts ?? []).map((p: { name: string }) => p.name);
      expect(names).toEqual(expect.arrayContaining(['header', 'footer', 'header-2', 'footer-2']));
    });

    it('site.css carries BOTH variants\' chrome CSS', () => {
      const css = get('assets/css/site.css');
      expect(css).toContain('#home-hdr');
      expect(css).toContain('#int-hdr');
    });
  });

  describe('scaffolded chrome architecture', () => {
    const scaffold = { openWrap: '<div id="C"><div id="root">', midBefore: '<div id="inner">', midAfter: '</div>', closeWrap: '</div></div>' };
    const f = buildCarryThemeFiles({
      themeName: 'Acme Carry',
      chromeVariants: oneVariant(
        '<!-- wp:html --><header id="H">nav</header><!-- /wp:html -->',
        '<!-- wp:html --><footer id="F">foot</footer><!-- /wp:html -->',
      ),
      siteCss: 'body.lib-carry-site #H{a:b}',
      pages: [page({ slug: 'about', isHome: false, scaffold, pageCss: '' })],
    });
    const get = (p: string) => f.find((x) => x.path === p)?.content ?? '';

    it('puts the wrapper scaffold + chrome parts + post-content in the template', () => {
      const tpl = get('templates/page-about.html');
      expect(tpl).toContain('<div id="C"><div id="root">');
      expect(tpl).toContain('<div id="inner">');
      expect(tpl).toContain('wp:template-part {"slug":"header","tagName":"div"}');
      expect(tpl).toContain('wp:post-content');
      expect(tpl).toContain('wp:template-part {"slug":"footer","tagName":"div"}');
      expect(tpl.indexOf('"header"')).toBeLessThan(tpl.indexOf('wp:post-content'));
      expect(tpl.indexOf('wp:post-content')).toBeLessThan(tpl.indexOf('"footer"'));
    });

    it('wraps post-content in the dual-viewport desktop wrapper + mobile iframe when the page has mobile', () => {
      const fm = buildCarryThemeFiles({
        themeName: 'Acme Carry',
        chromeVariants: oneVariant(
          '<!-- wp:html --><header id="H">nav</header><!-- /wp:html -->',
          '<!-- wp:html --><footer id="F">foot</footer><!-- /wp:html -->',
        ),
        siteCss: '',
        pages: [
          page({
            slug: 'about',
            isHome: false,
            scaffold,
            pageCss: '',
            mobile: { docUrl: '/wp-content/uploads/_carry-mobile/about.html', height: 1234 },
          }),
        ],
      });
      const tpl = fm.find((x) => x.path === 'templates/page-about.html')?.content ?? '';
      // the viewport wrapper + iframe live in the TEMPLATE now (not post_content)
      expect(tpl).toContain('<div class="lib-carry-vp-desktop">');
      expect(tpl).toContain('wp:post-content');
      expect(tpl).toContain('<div class="lib-carry-vp-mobile">');
      expect(tpl).toContain('<iframe');
      expect(tpl).toContain('src="/wp-content/uploads/_carry-mobile/about.html"');
      expect(tpl).toContain('height="1234"');
      // ordering: desktop wrapper opens → post-content (sections) → mobile iframe
      expect(tpl.indexOf('lib-carry-vp-desktop')).toBeLessThan(tpl.indexOf('wp:post-content'));
      expect(tpl.indexOf('wp:post-content')).toBeLessThan(tpl.indexOf('lib-carry-vp-mobile'));
    });

    it('does NOT add the viewport wrapper to the template when the page has no mobile', () => {
      const tpl = get('templates/page-about.html');
      expect(tpl).toContain('wp:post-content');
      expect(tpl).not.toContain('lib-carry-vp-desktop');
      expect(tpl).not.toContain('<iframe');
    });

    it('adds the display:contents wrapper rescue to site.css when scaffolded', () => {
      expect(get('assets/css/site.css')).toContain('.wp-block-template-part{display:contents}');
    });

    it('adds the mobile-gated pro-gallery grid toggle to site.css', () => {
      const css = get('assets/css/site.css');
      expect(css).toContain('@media screen and (max-width:750px)');
      expect(css).toContain('div.pro-gallery:has(+ .lib-carry-gallery-mobile){display:none!important}');
      expect(css).toContain('.lib-carry-gallery-mobile{display:grid!important');
    });

    it('adds the dual-viewport mobile-DOM iframe toggle to site.css', () => {
      const css = get('assets/css/site.css');
      // base: mobile island hidden, desktop wrapper transparent (no layout impact)
      expect(css).toContain('.lib-carry-vp-mobile{display:none}');
      expect(css).toContain('.lib-carry-vp-desktop{display:contents}');
      // below 750px: hide desktop island, show the iframe, neutralize the desktop scaffold
      expect(css).toContain('.lib-carry-vp-desktop{display:none!important}');
      expect(css).toContain('.lib-carry-vp-mobile{display:block!important}');
      expect(css).toContain('[id^="pageBackground"]');
    });

    it('functions.php allows the mobile-island <iframe> through KSES', () => {
      const fn = get('functions.php');
      expect(fn).toContain('wp_kses_allowed_html');
      expect(fn).toContain("'iframe'");
    });

    it('declares header/footer template-part areas in theme.json', () => {
      const areas = (JSON.parse(get('theme.json')).templateParts ?? []).map((p: { area: string }) => p.area);
      expect(areas).toContain('header');
      expect(areas).toContain('footer');
    });

    it('omits the chrome-rescue display:contents rule when no page has a scaffold', () => {
      const plain = buildCarryThemeFiles({
        themeName: 'Acme Carry', chromeVariants: oneVariant(), siteCss: '',
        pages: [page({ slug: 'about', isHome: false, pageCss: '' })],
      });
      // The CHROME_RESCUE rule specifically — NOT the unconditional vp-toggle's
      // display:contents (which legitimately appears for the mobile-DOM iframe).
      expect(plain.find((x) => x.path === 'assets/css/site.css')?.content).not.toContain(
        '.wp-block-template-part{display:contents}',
      );
    });
  });
});

describe('buildCarryThemeFiles — native blog templates (hybrid carry)', () => {
  const scaffold = { openWrap: '<div id="C"><div id="root">', midBefore: '<div id="inner">', midAfter: '</div>', closeWrap: '</div></div>' };
  const build = (pages: CarryPage[], nativeBlog?: boolean) =>
    buildCarryThemeFiles({
      themeName: 'Acme Carry',
      chromeVariants: oneVariant(
        '<!-- wp:html --><header id="H">nav</header><!-- /wp:html -->',
        '<!-- wp:html --><footer id="F">foot</footer><!-- /wp:html -->',
      ),
      siteCss: '',
      pages,
      nativeBlog,
    });
  const pick = (files: ReturnType<typeof build>, p: string) => files.find((f) => f.path === p)?.content ?? '';

  it('emits single/home/archive when no post is carried (hybrid default)', () => {
    const files = build([
      page({ slug: 'home', isHome: true, scaffold, pageCss: '' }),
      page({ slug: 'about', scaffold, pageCss: '' }),
    ]);
    const single = pick(files, 'templates/single.html');
    const home = pick(files, 'templates/home.html');
    const archive = pick(files, 'templates/archive.html');
    expect(single).toContain('wp:post-title');
    expect(single).toContain('wp:post-content');
    expect(home).toContain('wp:query');
    expect(home).toContain('>Blog<');
    expect(archive).toContain('wp:query-title');
    // chrome parts wrap them, and there is NO dual-viewport wrapper (native posts have no mobile iframe)
    expect(single).toContain('wp:template-part {"slug":"header"');
    expect(single).toContain('wp:template-part {"slug":"footer"');
    expect(single).not.toContain('lib-carry-vp-desktop');
    expect(home).not.toContain('lib-carry-vp-mobile');
    // index.html stays the homepage fallback (not overridden)
    expect(pick(files, 'templates/index.html')).not.toContain('wp:query');
  });

  it('does NOT emit native blog templates when a post is carried', () => {
    const files = build([
      page({ slug: 'home', isHome: true, scaffold, pageCss: '' }),
      page({ slug: 'my-post', postType: 'post', scaffold, pageCss: '' }),
    ]);
    // the carried-post single.html is emitted by the per-page loop, but the listing
    // templates are not — carried posts are not a native feed.
    expect(files.some((f) => f.path === 'templates/single.html')).toBe(true);
    expect(pick(files, 'templates/single.html')).not.toContain('wp:post-navigation-link');
    expect(pick(files, 'templates/home.html')).toBe('');
    expect(pick(files, 'templates/archive.html')).toBe('');
  });

  it('respects an explicit nativeBlog=false override', () => {
    const files = build([page({ slug: 'home', isHome: true, scaffold, pageCss: '' })], false);
    expect(pick(files, 'templates/home.html')).toBe('');
    expect(pick(files, 'templates/single.html')).toBe('');
  });

  it('native blog + index templates render the carved store header (styled globally via siteCss) when one exists', () => {
    // Without a store header the native templates keep the (possibly empty) home header part.
    const noStore = build([page({ slug: 'home', isHome: true, scaffold, pageCss: '' })]);
    expect(pick(noStore, 'templates/single.html')).toContain('"slug":"header"');
    expect(pick(noStore, 'templates/single.html')).not.toContain('header-store');

    // With a carved store header, the island-less native templates render IT instead, so blog
    // pages get real chrome — styled by the GLOBAL chrome CSS (no per-page donor-CSS reapply).
    const withStore = buildCarryThemeFiles({
      themeName: 'Acme Carry',
      chromeVariants: oneVariant(
        '<!-- wp:html --><header id="H">nav</header><!-- /wp:html -->',
        '<!-- wp:html --><footer id="F">foot</footer><!-- /wp:html -->',
      ),
      siteCss: '',
      pages: [page({ slug: 'home', isHome: true, pageCss: '' })],
      hasProducts: true,
      storeHeaderIsland:
        '<!-- wp:html -->\n<div class="lib-carry-vp-desktop"><header class="section-header">NAV</header></div>\n<!-- /wp:html -->',
    });
    const pickWith = (p: string) => withStore.find((f) => f.path === p)?.content ?? '';
    expect(pickWith('templates/single.html')).toContain('"slug":"header-store"');
    expect(pickWith('templates/home.html')).toContain('"slug":"header-store"');
    expect(pickWith('templates/archive.html')).toContain('"slug":"header-store"');
    // canonical footer still used on the native templates
    expect(pickWith('templates/single.html')).toContain('"slug":"footer"');
    // the index.html fallback (404 / search) also renders the store header
    expect(pickWith('templates/index.html')).toContain('"slug":"header-store"');
    // no per-page donor-CSS reapply branch any more (the header is globally styled via siteCss)
    expect(pickWith('functions.php')).not.toContain('is_woocommerce');
    expect(pickWith('functions.php')).not.toContain('! is_page()');
  });
});

describe('buildCarryThemeFiles — WooCommerce store templates', () => {
  const STORE_HEADER =
    '<!-- wp:html -->\n<div class="lib-carry-vp-desktop">\n<header class="section-header">NAV</header>\n</div>\n<!-- /wp:html -->';
  const base: Omit<CarryThemeInput, 'hasProducts' | 'storeHeaderIsland'> = {
    themeName: 'Acme Carry',
    chromeVariants: oneVariant(
      '<!-- wp:html -->\n<header>H</header>\n<!-- /wp:html -->',
      '<!-- wp:html -->\n<footer>F</footer>\n<!-- /wp:html -->',
    ),
    siteCss: 'body.lib-carry-site{margin:0}',
    pages: [page({ slug: 'home', isHome: true, pageCss: '' })],
  };
  const find = (files: ReturnType<typeof buildCarryThemeFiles>, p: string) =>
    files.find((f) => f.path === p)?.content;

  it('emits header-store part + single/archive-product templates when hasProducts + storeHeaderIsland', () => {
    const files = buildCarryThemeFiles({ ...base, hasProducts: true, storeHeaderIsland: STORE_HEADER });
    expect(find(files, 'parts/header-store.html')).toContain('section-header');
    const sp = find(files, 'templates/single-product.html');
    expect(sp).toContain('"slug":"header-store"');
    // Modern product blocks (not legacy-template) so we control buy-box → marketing order.
    expect(sp).toContain('wp:woocommerce/product-image-gallery');
    expect(sp).toContain('wp:woocommerce/add-to-cart-form');
    expect(sp).toContain('wp:post-content'); // rich marketing rendered full-width below the buy box
    expect(sp).not.toContain('legacy-template');
    expect(sp).toContain('"slug":"footer"'); // canonical footer still used
    // The shop/category archive keeps the robust classic WC archive grid.
    expect(find(files, 'templates/archive-product.html')).toContain(
      'wp:woocommerce/legacy-template {"template":"archive-product"}',
    );
  });

  it('registers captured palette + font tokens in theme.json when provided', () => {
    const files = buildCarryThemeFiles({
      ...base,
      hasProducts: true,
      storeHeaderIsland: STORE_HEADER,
      themeJsonPalette: [{ slug: 'c1', name: 'Replica 1', color: '#abcdef' }],
      themeJsonFontFamilies: [{ slug: 'brandsans', name: 'BrandSans', fontFamily: 'BrandSans, sans-serif' }],
    });
    const tj = JSON.parse(find(files, 'theme.json')!);
    expect(tj.settings.color.palette).toEqual([{ slug: 'c1', name: 'Replica 1', color: '#abcdef' }]);
    expect(tj.settings.typography.fontFamilies[0].slug).toBe('brandsans');
  });

  it('declares header-store as a header template part in theme.json', () => {
    const files = buildCarryThemeFiles({ ...base, hasProducts: true, storeHeaderIsland: STORE_HEADER });
    const tj = JSON.parse(find(files, 'theme.json')!);
    expect(tj.templateParts).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'header-store', area: 'header' })]),
    );
  });

  it('does NOT emit store templates when hasProducts is false', () => {
    const files = buildCarryThemeFiles({ ...base, hasProducts: false, storeHeaderIsland: STORE_HEADER });
    expect(find(files, 'templates/single-product.html')).toBeUndefined();
    expect(find(files, 'parts/header-store.html')).toBeUndefined();
  });

  it('does NOT emit store templates when no header could be isolated (empty storeHeaderIsland)', () => {
    const files = buildCarryThemeFiles({ ...base, hasProducts: true, storeHeaderIsland: '' });
    expect(find(files, 'templates/single-product.html')).toBeUndefined();
    expect(find(files, 'templates/archive-product.html')).toBeUndefined();
  });

  it('emits NO per-page donor-CSS reapply branch — the store chrome is styled globally via siteCss', () => {
    // The header now splits into the chrome region (chromeCss → siteCss) and is force-shown by
    // STORE_HEADER_RESCUE, so the dedicated header-store part is styled site-wide. The retired
    // #76/#77 workaround left no is_woocommerce() / ! is_page() reapply branch in functions.php.
    const fn = find(buildCarryThemeFiles({ ...base, hasProducts: true, storeHeaderIsland: STORE_HEADER }), 'functions.php')!;
    expect(fn).not.toContain('is_woocommerce');
    expect(fn).not.toContain('! is_page()');
    expect(fn).not.toContain('storeChromeDonorSlug');
  });
});

describe('buildCarryThemeFiles — mobile viewport scaling (non-responsive Wix only)', () => {
  // Non-responsive (classic/adaptive) Wix mobile is a FIXED 320px canvas, carried as the
  // .lib-carry-vp-mobile iframe (CarryPage.mobile is set). The live site scales that canvas
  // to fill the phone via a width=320 viewport on mobile UAs; WordPress's default
  // width=device-width leaves it un-scaled (white gap on wide phones). The theme must mirror
  // Wix — but ONLY when a page actually carries that fixed mobile canvas (responsive sites and
  // other platforms never set `mobile`, and forcing width=320 there would shrink/break them).
  const scaffoldWithViewport = {
    openWrap:
      '<meta name="viewport" content="width=device-width, initial-scale=1" id="wixDesktopViewport">\n<div id="SITE_CONTAINER">',
    midBefore: '<div id="inner">',
    midAfter: '</div>',
    closeWrap: '</div>',
  };
  const build = (withMobile: boolean) =>
    buildCarryThemeFiles({
      themeName: 'Acme Carry',
      chromeVariants: oneVariant(
        '<!-- wp:html --><header id="H">nav</header><!-- /wp:html -->',
        '<!-- wp:html --><footer id="F">foot</footer><!-- /wp:html -->',
      ),
      siteCss: '',
      pages: [
        page({
          slug: 'about',
          isHome: false,
          scaffold: scaffoldWithViewport,
          pageCss: '',
          ...(withMobile ? { mobile: { docUrl: '/wp-content/uploads/_carry-mobile/about.html', height: 4000 } } : {}),
        }),
      ],
    });
  const pick = (files: ReturnType<typeof build>, p: string) => files.find((f) => f.path === p)?.content ?? '';

  it('functions.php swaps to a width=320 viewport on mobile UAs when a page carries a mobile canvas', () => {
    const fn = pick(build(true), 'functions.php');
    expect(fn).toContain('wp_is_mobile()');
    expect(fn).toContain('width=320');
    // Core registers _block_template_viewport_meta_tag during template-canvas setup (AFTER
    // functions.php loads, priority 0), so it must be removed from INSIDE wp_head (priority -1).
    expect(fn).toContain("remove_action( 'wp_head', '_block_template_viewport_meta_tag', 0 )");
  });

  it('strips the carried <meta viewport> from the template when a page carries a mobile canvas (a later body meta would otherwise override ours)', () => {
    const tpl = pick(build(true), 'templates/page-about.html');
    expect(tpl).not.toContain('name="viewport"');
    expect(tpl).not.toContain('wixDesktopViewport');
    expect(tpl).toContain('id="SITE_CONTAINER"'); // the rest of the carried wrapper survives
  });

  it('does NOT touch the viewport (functions.php or templates) when no page carries a mobile canvas', () => {
    const files = build(false);
    const fn = pick(files, 'functions.php');
    expect(fn).not.toContain('wp_is_mobile()');
    expect(fn).not.toContain('width=320');
    expect(fn).not.toContain('_block_template_viewport_meta_tag');
    // a responsive / other-platform carry keeps its carried template byte-for-byte
    expect(pick(files, 'templates/page-about.html')).toContain('name="viewport"');
  });

  it('scopes the width=320 viewport to the mobile-canvas pages (native/non-canvas pages stay device-width)', () => {
    // Hybrid carry: one page carries a mobile canvas, another (scaffolded) does not. The
    // viewport swap must gate on the canvas page, so native blog contexts (is_single/is_home/
    // is_archive) and non-canvas pages fall through to device-width — matching VP_TOGGLE_CSS's
    // :has() scope (otherwise native blog pages render zoomed at a 320 viewport on mobile).
    const files = buildCarryThemeFiles({
      themeName: 'Acme Carry',
      chromeVariants: oneVariant(
        '<!-- wp:html --><header id="H">n</header><!-- /wp:html -->',
        '<!-- wp:html --><footer id="F">f</footer><!-- /wp:html -->',
      ),
      siteCss: '',
      pages: [
        page({ slug: 'about', scaffold: scaffoldWithViewport, pageCss: '', mobile: { docUrl: '/m/about.html', height: 4000 } }),
        page({ slug: 'plain', scaffold: { openWrap: '<div id="x">', midBefore: '', midAfter: '', closeWrap: '</div>' }, pageCss: '' }),
      ],
    });
    const fn = pick(files, 'functions.php');
    const vp = fn.slice(fn.indexOf("remove_action( 'wp_head', '_block_template_viewport_meta_tag'")); // the viewport block
    expect(vp).toContain('wp_is_mobile() && (');   // scoped, not global
    expect(vp).toContain("is_page( 'about' )");     // the mobile-canvas page is in the gate
    expect(vp).not.toContain("'plain'");            // the non-canvas page is excluded
    expect(vp).toContain('width=device-width');     // non-matching pages fall to device-width
  });
});

describe('buildCarryThemeFiles — WC buy-box restore wired into site.css', () => {
  const base: CarryThemeInput = {
    themeName: 'Acme Carry',
    chromeVariants: [{ key: 'c0', headerIsland: '', footerIsland: '' }],
    siteCss: ':root{font-size:62.5%} body.lib-carry-site{margin:0}',
    pages: [page({ slug: 'home', isHome: true, pageCss: '' })],
    hasProducts: true,
  };
  const getSiteCss = (f: ReturnType<typeof buildCarryThemeFiles>) =>
    f.find((x) => x.path === 'assets/css/site.css')?.content ?? '';

  it('appends WC buy-box restore to site.css when hasProducts=true and siteCss contains :root font-size', () => {
    const css = getSiteCss(buildCarryThemeFiles(base));
    // The restore targets the buy-box blocks on single-product pages.
    expect(css).toContain('wp-block-woocommerce-product-price');
    expect(css).toContain('wc-block-components-product-summary');
    // Must appear AFTER siteCss (restore lives at the end, after source CSS).
    expect(css.indexOf('wp-block-woocommerce-product-price')).toBeGreaterThan(
      css.indexOf('body.lib-carry-site{margin:0}'),
    );
  });

  it('does NOT append WC restore when siteCss lacks a :root font-size (no rem mismatch)', () => {
    const css = getSiteCss(
      buildCarryThemeFiles({ ...base, siteCss: 'body.lib-carry-site{margin:0}' }),
    );
    expect(css).not.toContain('wp-block-woocommerce-product-price');
  });

  it('does NOT append WC restore when hasProducts is false', () => {
    const css = getSiteCss(buildCarryThemeFiles({ ...base, hasProducts: false }));
    expect(css).not.toContain('wp-block-woocommerce-product-price');
  });
});

describe('buildWooBuyboxRemRestore', () => {
  it('emits a scoped price/summary restore when products + non-default root', () => {
    const css = buildWooBuyboxRemRestore({ hasProducts: true, rootFontSizeApplied: true });
    expect(css).toMatch(/body\.single-product[^{]*\.wp-block-woocommerce-product-price[^{]*\{[^}]*font-size/);
    expect(css).toMatch(/wc-block-components-product-summary/);
  });
  it('emits nothing without products', () => {
    expect(buildWooBuyboxRemRestore({ hasProducts: false, rootFontSizeApplied: true })).toBe('');
  });
  it('emits nothing when the root is the default (no rem mismatch)', () => {
    expect(buildWooBuyboxRemRestore({ hasProducts: true, rootFontSizeApplied: false })).toBe('');
  });
});

describe('editorScopeCss', () => {
  it('neutralizes the :where(body.lib-carry-site) site scope to bare body', () => {
    expect(editorScopeCss(':where(body.lib-carry-site) .ph{color:red}')).toBe('body .ph{color:red}');
  });
  it('neutralizes the bare body.lib-carry-site reset and descendant scopes', () => {
    expect(editorScopeCss('body.lib-carry-site{margin:0}')).toBe('body{margin:0}');
    expect(editorScopeCss('body.lib-carry-site .x{a:b}')).toBe('body .x{a:b}');
  });
  it('neutralizes per-page scopes (both bare and :where forms)', () => {
    expect(editorScopeCss('body.lib-carry-page-home .x{a:b}')).toBe('body .x{a:b}');
    expect(editorScopeCss(':where(body.lib-carry-page-the-shop) .y{c:d}')).toBe('body .y{c:d}');
  });
  it('leaves unscoped rules untouched', () => {
    expect(editorScopeCss('.ph{color:red}')).toBe('.ph{color:red}');
  });
});

describe('buildCarryThemeFiles — block-editor canvas styling', () => {
  const files = buildCarryThemeFiles({
    themeName: 'Acme Carry',
    chromeVariants: oneVariant(
      '<!-- wp:html -->\n<header>H</header>\n<!-- /wp:html -->',
      '<!-- wp:html -->\n<footer>F</footer>\n<!-- /wp:html -->',
    ),
    siteCss: ':where(body.lib-carry-site) .chrome{color:red}',
    pages: [
      page({ slug: 'home', isHome: true, pageCss: 'body.lib-carry-page-home .x{a:b}' }),
      page({ slug: 'the-shop', pageCss: 'body.lib-carry-page-the-shop .y{c:d}' }),
    ],
  });
  const byPath = (p: string) => files.find((f) => f.path === p)?.content ?? '';

  it('emits a global editor-site.css and per-page editor CSS files', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toContain('assets/css/editor-site.css');
    expect(paths).toContain('assets/css/editor-page-home.css');
    expect(paths).toContain('assets/css/editor-page-the-shop.css');
  });

  it('editor CSS is scope-neutralized while the front-end CSS keeps the carry scope', () => {
    const editorSite = byPath('assets/css/editor-site.css');
    expect(editorSite).toContain('body .chrome{color:red}');
    expect(editorSite).not.toContain('lib-carry-site');

    const editorPage = byPath('assets/css/editor-page-the-shop.css');
    expect(editorPage).toBe('body .y{c:d}');
    expect(editorPage).not.toContain('lib-carry-page');

    // Front-end files are untouched (no fidelity change).
    expect(byPath('assets/css/site.css')).toContain('lib-carry-site');
    expect(byPath('assets/css/page-the-shop.css')).toContain('lib-carry-page-the-shop');
  });

  it('functions.php wires add_editor_style + per-page block_editor_settings_all map', () => {
    const fn = byPath('functions.php');
    expect(fn).toContain("add_theme_support( 'editor-styles' )");
    expect(fn).toContain("add_editor_style( 'assets/css/editor-site.css' )");
    expect(fn).toContain("block_editor_settings_all");
    expect(fn).toContain("'home' => 'assets/css/editor-page-home.css'");
    expect(fn).toContain("'the-shop' => 'assets/css/editor-page-the-shop.css'");
    expect(fn).toContain('$context->post->post_name');
  });
});
