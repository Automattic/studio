import { describe, it, expect } from 'vitest';
import { reconstructPageCarry, deriveSectionName } from './page-reconstruct-carry.js';

describe('deriveSectionName', () => {
  it('prefers the first heading text', () => {
    expect(deriveSectionName('<section><div><h2 class="x">What I Offer</h2><p>body</p></div></section>', 0)).toBe('What I Offer');
  });
  it('decodes entities in the label', () => {
    expect(deriveSectionName('<section><h1>FAQ&apos;s &amp; More</h1></section>', 1)).toBe("FAQ's & More");
  });
  it('falls back to first visible text when there is no heading', () => {
    expect(deriveSectionName('<section><div>Therapy in the Keystone State</div></section>', 2)).toBe('Therapy in the Keystone State');
  });
  it('falls back to a positional name when the section has no text', () => {
    expect(deriveSectionName('<section><img src="/x.jpg" alt=""></section>', 4)).toBe('Section 5');
  });
  it('caps the label length', () => {
    const long = 'A'.repeat(80);
    expect(deriveSectionName(`<section><h2>${long}</h2></section>`, 0).length).toBeLessThanOrEqual(48);
  });
});

describe('reconstructPageCarry', () => {
  it('produces a scoped main island + split chrome/main CSS', () => {
    const r = reconstructPageCarry({
      slug: 'home',
      isHome: true,
      bodyHtml:
        '<header class="h">H</header><main><div class="hero">Hi</div></main><footer class="f">F</footer>',
      css: '.hero{color:red} .h{color:green} .nope{color:blue}',
      specs: [],
      mediaUrlMap: new Map(),
    });
    expect(r.mainIsland).toContain('<!-- wp:html ');
    expect(r.mainIsland).toContain('class="hero"');
    // main sheet: page-scoped (zero-specificity :where), has .hero, drops chrome-only/unmatched
    expect(r.mainCss).toContain(':where(body.lib-carry-site.lib-carry-page-home) .hero');
    expect(r.mainCss).not.toContain('.nope');
    expect(r.mainCss).not.toContain('.h{'); // .h is chrome, not in main DOM -> dropped from main sheet
    // chrome sheet: site-wide scoped, has .h, drops main-only rules
    expect(r.chromeCss).toContain(':where(body.lib-carry-site) .h');
    expect(r.chromeCss).not.toContain('.hero'); // .hero not in chrome DOM
    expect(r.headerIsland).toContain('class="h"');
    expect(r.footerIsland).toContain('class="f"');
  });

  it('keeps @media blocks that contain a matched selector', () => {
    const r = reconstructPageCarry({
      slug: 'about',
      bodyHtml: '<div class="hero">Hello</div>',
      css: '@media(max-width:1px){.hero{color:green}} @media(max-width:1px){.gone{color:red}}',
      specs: [],
      mediaUrlMap: new Map(),
    });
    // The @media rule containing .hero should survive treeshaking in the main sheet
    expect(r.mainCss).toContain('.hero');
  });

  it('returns empty islands when header/footer are absent', () => {
    const r = reconstructPageCarry({
      slug: 'inner',
      bodyHtml: '<div class="content">Text</div>',
      css: '.content{font-size:16px}',
      specs: [],
      mediaUrlMap: new Map(),
    });
    expect(r.headerIsland).toBe('');
    expect(r.footerIsland).toBe('');
    expect(r.chromeCss).toBe('');
    expect(r.mainIsland).toContain('<!-- wp:html -->');
    expect(r.mainIsland).toContain('class="content"');
  });

  it('emits a dual island with a mobile-DOM iframe when `mobile` is provided', () => {
    const r = reconstructPageCarry({
      slug: 'home',
      bodyHtml: '<div class="content">Desktop</div>',
      css: '.content{color:red}',
      specs: [],
      mediaUrlMap: new Map(),
      mobile: { docUrl: '/wp-content/uploads/_carry-mobile/home.html', height: 5200 },
    });
    // desktop content is wrapped so the theme can hide it on mobile
    expect(r.mainIsland).toContain('class="lib-carry-vp-desktop"');
    expect(r.mainIsland).toContain('class="content"');
    // the mobile island is an iframe loading the captured mobile DOM (its own 320px viewport)
    expect(r.mainIsland).toContain('class="lib-carry-vp-mobile"');
    expect(r.mainIsland).toContain('<iframe');
    expect(r.mainIsland).toContain('src="/wp-content/uploads/_carry-mobile/home.html"');
    expect(r.mainIsland).toContain('width="320"');
    expect(r.mainIsland).toContain('height="5200"');
  });

  it('deep chrome path: emits per-section core/html blocks (not one dual island) even with mobile', () => {
    const r = reconstructPageCarry({
      slug: 'svc',
      bodyHtml:
        '<header id="SITE_HEADER">H</header>' +
        '<div id="PAGES_CONTAINER"><section class="s1">A</section><section class="s2">B</section></div>' +
        '<footer id="SITE_FOOTER">F</footer>',
      css: '',
      specs: [],
      mediaUrlMap: new Map(),
      mobile: { docUrl: '/wp-content/uploads/_carry-mobile/svc.html', height: 1000 },
    });
    expect(r.splitChrome).toBe(true);
    // content splits into one NAMED core/html block per source <section> …
    expect(r.postContentBlocks.length).toBe(2);
    expect((r.mainIsland.match(/<!-- wp:html /g) ?? []).length).toBe(2);
    expect(r.mainIsland).toContain('class="s1"');
    expect(r.mainIsland).toContain('class="s2"');
    // … each block carries metadata.name (List View label) derived from its text
    expect(r.mainIsland).toContain('"metadata":{"name":"A"}');
    expect(r.mainIsland).toContain('"metadata":{"name":"B"}');
    // … and the dual-viewport wrapper + iframe do NOT live in post_content here:
    // they move to the template (scaffoldedTemplate) so the post stays editable section blocks.
    expect(r.mainIsland).not.toContain('lib-carry-vp-desktop');
    expect(r.mainIsland).not.toContain('<iframe');
  });

  it('omits the mobile island when `mobile` is absent (desktop-only, back-compat)', () => {
    const r = reconstructPageCarry({
      slug: 'home',
      bodyHtml: '<div class="content">Desktop</div>',
      css: '',
      specs: [],
      mediaUrlMap: new Map(),
    });
    expect(r.mainIsland).not.toContain('lib-carry-vp-mobile');
    expect(r.mainIsland).not.toContain('<iframe');
  });

  it('escapes the iframe src URL', () => {
    const r = reconstructPageCarry({
      slug: 'p',
      bodyHtml: '<div>x</div>',
      css: '',
      specs: [],
      mediaUrlMap: new Map(),
      mobile: { docUrl: '/wp-content/uploads/_carry-mobile/a"b.html', height: 100 },
    });
    expect(r.mainIsland).toContain('a&quot;b.html');
    expect(r.mainIsland).not.toContain('a"b.html');
  });

  it('scroll-trigger gates are STRIPPED from the carried DOM (chrome and main) — no unfreeze override needed', () => {
    // Fixture: header AND a content section carry `scroll-trigger` (a JS
    // IntersectionObserver gate whose initial CSS state is opacity:0). carryHtml now
    // drops the hook class itself — stronger than the former chrome-only
    // opacity:1!important override, because it also un-gates MAIN-content sections
    // (where the override never applied; the getsnooz islands shipped 12 frozen ones).
    const r = reconstructPageCarry({
      slug: 'home',
      bodyHtml:
        '<header class="scroll-trigger h">NAV</header>' +
        '<div class="content scroll-trigger animate--slide-in">C</div>' +
        '<footer class="f">F</footer>',
      css: '.scroll-trigger{opacity:0;transition:opacity 0.4s ease}',
      specs: [],
      mediaUrlMap: new Map(),
    });
    // The gate class is gone from every carried region, so the source's
    // `.scroll-trigger{opacity:0}` rule can never match the emitted DOM.
    expect(r.mainIsland).not.toContain('scroll-trigger');
    expect(r.mainIsland).toContain('animate--slide-in');
    expect(r.mainIsland).toContain('C');
  });

  it('rewrites media URLs in carried HTML', () => {
    const mediaUrlMap = new Map([['https://cdn.example.com/img.jpg', '/wp-content/uploads/img.jpg']]);
    const r = reconstructPageCarry({
      slug: 'media-test',
      bodyHtml: '<img src="https://cdn.example.com/img.jpg" />',
      css: '',
      specs: [],
      mediaUrlMap,
    });
    expect(r.mainIsland).toContain('/wp-content/uploads/img.jpg');
    expect(r.mainIsland).not.toContain('cdn.example.com');
  });

  it('Shopify Dawn: lifts a header with nested <header-*> custom elements into the GLOBAL chrome sheet, not the per-page sheet', () => {
    // Before the balancedSpan custom-element fix this header never balanced, so it stayed in the
    // main DOM and its CSS landed in the per-page mainCss (styled only on its own page). It must
    // now split into the header part and globalize via chromeCss (site-wide), like the footer does.
    const r = reconstructPageCarry({
      slug: 'home',
      isHome: true,
      bodyHtml:
        '<div class="section-header"><sticky-header>' +
        '<header class="header header--middle-left">' +
        '<header-drawer><details><summary>Menu</summary></details></header-drawer>' +
        '<nav class="header__inline-menu">Shop</nav>' +
        '</header></sticky-header></div>' +
        '<main><section class="hero">Hi</section></main>' +
        '<footer class="f">F</footer>',
      css: '.header__inline-menu{display:flex} .hero{color:red}',
      specs: [],
      mediaUrlMap: new Map(),
    });
    expect(r.splitChrome).toBe(true);
    // the real <header> (with its custom elements) is lifted into the header part…
    expect(r.headerIsland).toContain('class="header header--middle-left"');
    expect(r.headerIsland).toContain('<header-drawer');
    // …its CSS globalizes: site-scoped in chromeCss, and ABSENT from the per-page mainCss…
    expect(r.chromeCss).toContain(':where(body.lib-carry-site) .header__inline-menu');
    expect(r.mainCss).not.toContain('header__inline-menu');
    // …and the header is gone from the content island (no duplication), content stays per-page.
    expect(r.mainIsland).not.toContain('header__inline-menu');
    expect(r.mainCss).toContain(':where(body.lib-carry-site.lib-carry-page-home) .hero');
  });
});
