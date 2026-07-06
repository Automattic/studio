import { describe, it, expect } from 'vitest';
import { splitRegionsDeep } from './split-regions-deep.js';

// Synthetic builder-style body: chrome buried inside a deep wrapper scaffold,
// with the content sections as children of an inner container.
const BODY =
  '<div id="SITE_CONTAINER"><div id="masterPage">' +
  '<header id="SITE_HEADER"><nav>menu</nav></header>' +
  '<div id="content"><div id="container">' +
  '<section id="s1">one</section>' +
  '<section id="s2">two</section>' +
  '<section id="s3">three</section>' +
  '</div></div>' +
  '<footer id="SITE_FOOTER"><p>foot</p></footer>' +
  '</div></div>';

describe('splitRegionsDeep', () => {
  const r = splitRegionsDeep(BODY);

  it('finds chrome nested deep in the wrapper scaffold', () => {
    expect(r.found).toBe(true);
    expect(r.headerHtml).toBe('<header id="SITE_HEADER"><nav>menu</nav></header>');
    expect(r.footerHtml).toBe('<footer id="SITE_FOOTER"><p>foot</p></footer>');
  });

  it('peels the content sections out of the middle', () => {
    expect(r.sectionsHtml).toHaveLength(3);
    expect(r.sectionsHtml[0]).toContain('<section id="s1">one</section>');
    expect(r.sectionsHtml[2]).toContain('<section id="s3">three</section>');
  });

  it('keeps the inner content wrappers in midBefore / midAfter', () => {
    expect(r.midBefore).toContain('<div id="content"><div id="container">');
    expect(r.midAfter).toContain('</div></div>');
  });

  it('is byte-lossless — concatenation reproduces the body exactly', () => {
    const recon =
      r.openWrap + r.headerHtml + r.midBefore + r.sectionsHtml.join('') + r.midAfter + r.footerHtml + r.closeWrap;
    expect(recon).toBe(BODY);
  });

  it('puts the opening/closing scaffold in openWrap / closeWrap', () => {
    expect(r.openWrap).toBe('<div id="SITE_CONTAINER"><div id="masterPage">');
    expect(r.closeWrap).toBe('</div></div>');
  });

  it('returns found=false when there is no semantic chrome', () => {
    const r2 = splitRegionsDeep('<div><section>x</section><section>y</section></div>');
    expect(r2.found).toBe(false);
  });

  it('matches a semantic <header>/<footer> without the Wix ids', () => {
    const r3 = splitRegionsDeep('<div><header>h</header><main><section>a</section></main><footer>f</footer></div>');
    expect(r3.found).toBe(true);
    expect(r3.headerHtml).toBe('<header>h</header>');
    expect(r3.footerHtml).toBe('<footer>f</footer>');
    expect(r3.sectionsHtml).toHaveLength(1);
  });
});

// Shopify Dawn (and other component themes) nest CUSTOM ELEMENTS whose tag name starts
// with the chrome tag — `<header-drawer>`, `<header-menu>` — INSIDE the real `<header>`.
// Their opening tags must not be counted as `<header>` opens: `</header-drawer>` never
// matches `</header>`, so a naive `<header\b` open inflates the depth and the real
// `<header>` span never balances → the whole header is lost into per-page content.
describe('splitRegionsDeep — header with nested <header-*> custom elements (Shopify Dawn)', () => {
  const DAWN_BODY =
    '<div class="shopify-section announcement-bar-section"><div class="utility-bar">Sale</div></div>' +
    '<div class="shopify-section section-header"><sticky-header>' +
    '<header class="header header--middle-left">' +
    '<header-drawer data-breakpoint="tablet"><details><summary>Menu</summary></details></header-drawer>' +
    '<a class="header__heading-link">Logo</a>' +
    '<nav class="header__inline-menu"><header-menu><details><summary>Shop</summary></details></header-menu></nav>' +
    '</header>' +
    '</sticky-header></div>' +
    '<main><section>content</section></main>' +
    '<footer class="footer">foot</footer>';
  const r = splitRegionsDeep(DAWN_BODY);

  it('isolates the real <header> as one balanced span despite the custom elements', () => {
    expect(r.found).toBe(true);
    expect(r.headerHtml.startsWith('<header class="header header--middle-left">')).toBe(true);
    expect(r.headerHtml.endsWith('</header>')).toBe(true);
    // the custom elements are captured INSIDE the header span, not treated as header opens
    expect(r.headerHtml).toContain('<header-drawer');
    expect(r.headerHtml).toContain('<header-menu>');
    // and the span stops at the real </header> — it must not swallow main/footer
    expect(r.headerHtml).not.toContain('<main>');
    expect(r.headerHtml).not.toContain('<footer');
  });

  it('keeps the footer + content sections out of the header', () => {
    expect(r.footerHtml).toBe('<footer class="footer">foot</footer>');
    expect(r.sectionsHtml.join('')).toContain('<section>content</section>');
  });

  it('is byte-lossless', () => {
    const recon =
      r.openWrap + r.headerHtml + r.midBefore + r.sectionsHtml.join('') + r.midAfter + r.footerHtml + r.closeWrap;
    expect(recon).toBe(DAWN_BODY);
  });
});

// The Shopify header is a GROUP of sibling sections (`.shopify-section-group-header-group`):
// an announcement/utility bar then the nav header. The bare <header> drops the announcement
// + the section wrapper context its CSS relies on, so the whole contiguous group must be the
// chrome region — then it globalizes (chromeCss) and lifts out of content as one unit.
describe('splitRegionsDeep — Shopify header group (announcement + header) as one chrome region', () => {
  const DAWN_GROUP_BODY =
    '<div id="shopify-section-ann" class="shopify-section shopify-section-group-header-group announcement-bar-section"><div class="utility-bar">Recall info</div></div>' +
    '\n' +
    '<div id="shopify-section-hdr" class="shopify-section shopify-section-group-header-group section-header"><sticky-header>' +
    '<header class="header header--middle-left">' +
    '<header-drawer><details><summary>Menu</summary></details></header-drawer>' +
    '<nav class="header__inline-menu">Shop</nav>' +
    '</header>' +
    '</sticky-header></div>' +
    '<main><section>content</section></main>' +
    '<footer class="footer">foot</footer>';
  const r = splitRegionsDeep(DAWN_GROUP_BODY);

  it('extends the header region across the full contiguous .shopify-section-group-header-group run', () => {
    expect(r.found).toBe(true);
    // headerHtml spans the announcement section THROUGH the header section …
    expect(r.headerHtml).toContain('announcement-bar-section');
    expect(r.headerHtml).toContain('Recall info');
    expect(r.headerHtml).toContain('<header class="header');
    // … and stops before the content/footer
    expect(r.headerHtml).not.toContain('<main>');
    expect(r.headerHtml).not.toContain('<footer');
    // the announcement bar is no longer stranded in openWrap (it's part of the chrome region)
    expect(r.openWrap).not.toContain('announcement-bar-section');
  });

  it('keeps content + footer out of the header region', () => {
    expect(r.footerHtml).toBe('<footer class="footer">foot</footer>');
    expect(r.sectionsHtml.join('')).toContain('<section>content</section>');
  });

  it('is byte-lossless', () => {
    const recon =
      r.openWrap + r.headerHtml + r.midBefore + r.sectionsHtml.join('') + r.midAfter + r.footerHtml + r.closeWrap;
    expect(recon).toBe(DAWN_GROUP_BODY);
  });
});
