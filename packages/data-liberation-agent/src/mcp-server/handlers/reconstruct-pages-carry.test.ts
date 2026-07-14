import { describe, it, expect } from 'vitest';
import { assembleCarryTheme, extractStoreHeaderIsland } from './reconstruct-pages-carry.js';

describe('extractStoreHeaderIsland', () => {
  it('captures the FULL header group (announcement bar + header) when present, not just <header>', () => {
    // Fictional Shopify-style header group: an announcement section + a header section,
    // siblings sharing `shopify-section-group-header-group`.
    const island =
      '<div class="shopify-section shopify-section-group-header-group announcement-bar-section"><p class="announcement-bar__message">Sale on now</p></div>' +
      '<div class="shopify-section shopify-section-group-header-group section-header"><header class="header"><a class="logo">Acme</a><nav><ul><li>Shop</li></ul></nav></header></div>' +
      '<main>page body</main>';
    const out = extractStoreHeaderIsland(island);
    expect(out).toContain('Sale on now'); // announcement bar kept
    expect(out).toContain('<header'); // header kept
    expect(out).toContain('shopify-section-group-header-group'); // wrapper context kept (CSS relies on it)
    expect(out).not.toContain('page body'); // main excluded
    expect(out).toContain('lib-carry-vp-desktop');
  });

  it('falls back to the bare <header> when there is no header group (non-Shopify)', () => {
    const island = '<header class="site-header"><a>Logo</a></header><main>body</main>';
    const out = extractStoreHeaderIsland(island);
    expect(out).toContain('site-header');
    expect(out).not.toContain('body');
  });

  it('returns empty string when there is no header at all', () => {
    expect(extractStoreHeaderIsland('<main>just content</main>')).toBe('');
    expect(extractStoreHeaderIsland('')).toBe('');
  });
});

describe('assembleCarryTheme', () => {
  it('builds theme files + per-page WXR content, with chrome CSS site-wide and main CSS per-page', () => {
    const out = assembleCarryTheme({
      themeName: 'Acme Carry',
      pages: [
        {
          slug: 'home',
          title: 'Home',
          isHome: true,
          bodyHtml:
            '<header class="h">H</header><main><div class="hero">Hi</div></main><footer class="f">F</footer>',
          css: '.hero{color:red} .h{color:green}',
        },
      ],
      mediaUrlMap: new Map(),
    });
    const byPath = (p: string) => out.themeFiles.find((f) => f.path === p)?.content ?? '';
    // chrome rule is in the globally-enqueued site.css (after the reset), main rule in page sheet
    expect(byPath('assets/css/site.css')).toContain(':where(body.lib-carry-site) .h');
    expect(byPath('assets/css/page-home.css')).toContain(':where(body.lib-carry-site.lib-carry-page-home) .hero');
    const home = out.wxrPages.find((p) => p.slug === 'home')!;
    expect(home.postContent).toContain('<!-- wp:html ');
    expect(home.postContent).toContain('class="hero"');
  });

  it('threads a page mobile-DOM into a dual-viewport island', () => {
    const out = assembleCarryTheme({
      themeName: 'Acme Carry',
      pages: [
        {
          slug: 'home',
          title: 'Home',
          isHome: true,
          bodyHtml: '<main><div class="c">desktop</div></main>',
          css: '',
          mobile: { docUrl: '/wp-content/uploads/_carry-mobile/home.html', height: 4000 },
        },
      ],
      mediaUrlMap: new Map(),
    });
    const home = out.wxrPages.find((p) => p.slug === 'home')!;
    expect(home.postContent).toContain('class="lib-carry-vp-desktop"');
    expect(home.postContent).toContain('class="lib-carry-vp-mobile"');
    expect(home.postContent).toContain('src="/wp-content/uploads/_carry-mobile/home.html"');
    expect(home.postContent).toContain('height="4000"');
  });

  it('skips a page that throws in reconstructPageCarry instead of crashing the whole build', () => {
    // `<xmp>` is rawtext: cheerio keeps the `<script>` as text, so carryHtml's
    // injection gate throws. ONE such page must not take down the whole reconstruct.
    const out = assembleCarryTheme({
      themeName: 'Acme Carry',
      mediaUrlMap: new Map(),
      pages: [
        { slug: 'good', title: 'G', isHome: true, bodyHtml: '<main><div class="c">ok</div></main>', css: '' },
        { slug: 'bad', title: 'B', bodyHtml: '<xmp><script>x()</script></xmp>', css: '' },
      ],
    });
    expect(out.wxrPages.find((p) => p.slug === 'good')).toBeTruthy();
    expect(out.wxrPages.find((p) => p.slug === 'bad')).toBeFalsy();
    expect(out.skipped).toContain('bad');
  });

  it('keeps the active-nav highlight on a single-page header, strips it on a shared one', () => {
    const header = (active: 'home' | 'about') =>
      '<header class="h"><nav data-hook="menu-root" class="wixui-horizontal-menu">' +
      `<a ${active === 'home' ? 'data-selected="true" aria-current="page" ' : ''}data-part="x">HOME</a>` +
      `<a ${active === 'about' ? 'data-selected="true" aria-current="page" ' : ''}data-part="x">ABOUT</a>` +
      '</nav></header><main><div class="c">c</div></main>';
    const findHeader = (out: ReturnType<typeof assembleCarryTheme>) =>
      out.themeFiles.find((f) => f.path === 'parts/header.html')?.content ?? '';

    // One page using the header → keeps its own "current" highlight.
    const solo = assembleCarryTheme({
      themeName: 'A',
      pages: [{ slug: 'home', title: 'H', isHome: true, bodyHtml: header('home'), css: '' }],
      mediaUrlMap: new Map(),
    });
    expect(findHeader(solo)).toContain('aria-current="page"');

    // Two pages sharing one header (differ only by which item is current) → dedupe
    // to one variant, emitted active-stripped so it doesn't pin one page's highlight.
    const shared = assembleCarryTheme({
      themeName: 'A',
      pages: [
        { slug: 'home', title: 'H', isHome: true, bodyHtml: header('home'), css: '' },
        { slug: 'about', title: 'A', bodyHtml: header('about'), css: '' },
      ],
      mediaUrlMap: new Map(),
    });
    // single shared header part (no header-2), and it's stripped
    expect(shared.themeFiles.some((f) => f.path === 'parts/header-2.html')).toBe(false);
    expect(findHeader(shared)).not.toContain('aria-current="page"');
  });

  it('rewrites carried hrefs through the linkMap', () => {
    const out = assembleCarryTheme({
      themeName: 'Acme Carry',
      pages: [
        {
          slug: 'home',
          title: 'Home',
          isHome: true,
          bodyHtml: '<main><a href="https://acme.test/about">About</a></main>',
          css: '',
        },
      ],
      mediaUrlMap: new Map(),
      linkMap: new Map([['acme.test/about', '/about/']]),
    });
    const home = out.wxrPages.find((p) => p.slug === 'home')!;
    expect(home.postContent).toContain('href="/about/"');
    expect(home.postContent).not.toContain('acme.test/about');
  });

  it('rewrites carried image srcs through the mediaUrlMap', () => {
    const out = assembleCarryTheme({
      themeName: 'Acme Carry',
      pages: [
        {
          slug: 'home',
          title: 'Home',
          isHome: true,
          bodyHtml: '<main><img src="https://cdn.test/a.jpg"></main>',
          css: '',
        },
      ],
      mediaUrlMap: new Map([['https://cdn.test/a.jpg', 'http://localhost/wp-content/uploads/a.jpg']]),
    });
    const home = out.wxrPages.find((p) => p.slug === 'home')!;
    expect(home.postContent).toContain('/wp-content/uploads/a.jpg');
    expect(home.postContent).not.toContain('cdn.test');
  });

  it('threads postType through to the WXR page records', () => {
    const out = assembleCarryTheme({
      themeName: 'Acme Carry',
      pages: [
        { slug: 'a-post', title: 'A Post', postType: 'post', bodyHtml: '<main>x</main>', css: '' },
      ],
      mediaUrlMap: new Map(),
    });
    expect(out.wxrPages.find((p) => p.slug === 'a-post')!.postType).toBe('post');
    // and the theme scopes it via is_single
    const fn = out.themeFiles.find((f) => f.path === 'functions.php')!.content;
    expect(fn).toContain("is_single( 'a-post' )");
  });

  it('emits WooCommerce store templates + a header-store part when hasProducts and a header is found', () => {
    const out = assembleCarryTheme({
      themeName: 'Acme Carry',
      hasProducts: true,
      pages: [
        {
          slug: 'home',
          title: 'H',
          isHome: true,
          bodyHtml: '<header class="h"><a href="/">Logo</a></header><main><div class="c">c</div></main>',
          css: '',
        },
      ],
      mediaUrlMap: new Map(),
    });
    expect(out.warnings).toHaveLength(0);
    expect(out.themeFiles.some((f) => f.path === 'parts/header-store.html')).toBe(true);
    const sp = out.themeFiles.find((f) => f.path === 'templates/single-product.html')?.content ?? '';
    expect(sp).toContain('"slug":"header-store"');
    // Modern product blocks + full-width post-content (marketing), not legacy-template.
    expect(sp).toContain('wp:woocommerce/add-to-cart-form');
    expect(sp).toContain('wp:post-content');
    expect(sp).not.toContain('legacy-template');
    expect(out.themeFiles.some((f) => f.path === 'templates/archive-product.html')).toBe(true);
  });

  it('WARNS and emits no store templates when hasProducts but no header can be isolated', () => {
    const out = assembleCarryTheme({
      themeName: 'Acme Carry',
      hasProducts: true,
      pages: [{ slug: 'home', title: 'H', isHome: true, bodyHtml: '<main><div class="c">no header here</div></main>', css: '' }],
      mediaUrlMap: new Map(),
    });
    expect(out.warnings.join(' ')).toMatch(/without site chrome/i);
    expect(out.themeFiles.some((f) => f.path === 'templates/single-product.html')).toBe(false);
    expect(out.themeFiles.some((f) => f.path === 'parts/header-store.html')).toBe(false);
  });

  it('emits no store templates (and no warning) when the run has no products', () => {
    const out = assembleCarryTheme({
      themeName: 'Acme Carry',
      hasProducts: false,
      pages: [{ slug: 'home', title: 'H', isHome: true, bodyHtml: '<header class="h">H</header><main>x</main>', css: '' }],
      mediaUrlMap: new Map(),
    });
    expect(out.warnings).toHaveLength(0);
    expect(out.themeFiles.some((f) => f.path === 'templates/single-product.html')).toBe(false);
  });

  it('carves header-store from the nav the MOST pages share, not the first page in list order', () => {
    // A site with sectional navs: one odd page (nav-alpha, FIRST in list order) and two pages
    // sharing nav-beta. The store header must be the dominant nav-beta. The beta pages have
    // DIFFERENT footers on purpose: the variant map keys on header+footer combined (each beta
    // page is its own 1-member variant there), so ranking must use a HEADER-ONLY signature —
    // combined-variant frequency would tie everything at 1 and fall back to list order (alpha).
    const page = (slug: string, nav: string, footer: string) => ({
      slug,
      title: slug,
      bodyHtml:
        `<header class="hdr"><nav class="${nav}"><a href="/a">A</a></nav></header>` +
        `<main><section class="s">${slug}</section></main>` +
        `<footer class="${footer}">F</footer>`,
      css: '',
    });
    const out = assembleCarryTheme({
      themeName: 'Acme Carry',
      hasProducts: true,
      pages: [page('odd-one', 'nav-alpha', 'ft'), page('b1', 'nav-beta', 'ft-1'), page('b2', 'nav-beta', 'ft-2')],
      mediaUrlMap: new Map(),
    });
    const store = out.themeFiles.find((f) => f.path === 'parts/header-store.html')?.content ?? '';
    expect(store).toContain('nav-beta');
    expect(store).not.toContain('nav-alpha');
  });

  it('still prefers an interior header over the home header when frequencies tie', () => {
    // Home headers are often transparent overlays that vanish on a white store page — on a
    // frequency tie (1 vs 1 here) the interior page must still win.
    const page = (slug: string, nav: string, isHome?: boolean) => ({
      slug,
      title: slug,
      isHome,
      bodyHtml:
        `<header class="hdr"><nav class="${nav}"><a href="/a">A</a></nav></header>` +
        `<main><section class="s">${slug}</section></main><footer class="ft">F</footer>`,
      css: '',
    });
    const out = assembleCarryTheme({
      themeName: 'Acme Carry',
      hasProducts: true,
      pages: [page('home', 'nav-home', true), page('inner', 'nav-int')],
      mediaUrlMap: new Map(),
    });
    const store = out.themeFiles.find((f) => f.path === 'parts/header-store.html')?.content ?? '';
    expect(store).toContain('nav-int');
    expect(store).not.toContain('nav-home');
  });
});
