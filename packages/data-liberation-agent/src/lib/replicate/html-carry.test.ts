import { describe, it, expect } from 'vitest';
import { carryHtml } from './html-carry.js';

describe('carryHtml', () => {
  it('keeps classes/structure but strips scripts and event handlers', () => {
    const { html } = carryHtml('<div class="hero" onclick="x()"><script>bad()</script><p>Hi</p></div>', {});
    expect(html).toContain('class="hero"');
    expect(html).toContain('<p>Hi</p>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
  });

  it('does not choke on a <script> inside an HTML comment (inert) — strips the comment', () => {
    // Commented-out scripts are common in Shopify/Wix markup. They are inert, but
    // cheerio leaves the comment node, so the injection gate used to false-positive
    // and throw "raw <script> tag" — crashing reconstruction of the whole page.
    const { html } = carryHtml(
      '<div class="c">ok</div><!-- <script async src="https://x/a.js"></script> -->',
      {},
    );
    expect(html).toContain('class="c"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<!--');
  });

  it('strips dead SPA-runtime <link> hints (preload/prefetch + Wix-CDN), keeps real links', () => {
    const input =
      '<link rel="preload" as="script" href="https://siteassets.parastorage.com/pages/thunderbolt?x=1"/>' +
      '<link rel="stylesheet" href="https://static.parastorage.com/services/wix-thunderbolt/dist/group_7.min.css"/>' +
      '<link rel="prefetch" href="https://static.wixstatic.com/runtime/x.js"/>' +
      '<link rel="canonical" href="https://www.example.com/page"/>' +
      '<div class="c">body</div>';
    const { html } = carryHtml(input, {});
    expect(html).not.toContain('parastorage.com');
    expect(html).not.toContain('wixstatic.com');
    expect(html).not.toContain('rel="preload"');
    expect(html).not.toContain('rel="prefetch"');
    expect(html).toContain('rel="canonical"'); // genuine link kept
    expect(html).toContain('class="c"');
  });

  it('extracts inline <style> into styleText and removes it from html', () => {
    const { html, styleText } = carryHtml('<style>.a{color:red}</style><div class="a">x</div>', {});
    expect(styleText).toContain('.a{color:red}');
    expect(html).not.toContain('<style');
  });

  it('keeps allowlisted iframes and drops others', () => {
    const yt = carryHtml('<iframe src="https://www.youtube.com/embed/abc"></iframe>', {}).html;
    expect(yt).toContain('youtube.com/embed');
    const evil = carryHtml('<iframe src="https://evil.example/x"></iframe>', {}).html;
    expect(evil).not.toContain('iframe');
  });

  it('rewrites media URLs and internal links via the provided maps', () => {
    const { html } = carryHtml('<a href="/about"><img src="https://cdn/x.png"></a>', {
      mediaUrlMap: new Map([['https://cdn/x.png', '/wp/up/x.png']]),
      linkMap: new Map([['/about', '/about-2']]) as any,
    });
    expect(html).toContain('/wp/up/x.png');
    expect(html).toContain('/about-2');
  });

  it('rewrites media URLs that contain multi-param query strings', () => {
    const { html } = carryHtml('<img src="https://cdn/x?w=300&h=200">', {
      mediaUrlMap: new Map([['https://cdn/x?w=300&h=200', '/wp/up/x.png']]),
    });
    expect(html).toContain('/wp/up/x.png');
  });

  it('strips <base> so relative links are not redirected to the source domain', () => {
    const { html } = carryHtml('<base href="https://source.example/"><a href="/x">y</a>', {});
    expect(html).not.toContain('<base');
    expect(html).toContain('href="/x"');
  });

  it('strips javascript: hrefs but keeps the element and text', () => {
    const { html } = carryHtml('<a href="javascript:alert(1)">click</a>', {});
    expect(html).not.toContain('javascript:');
    expect(html).toContain('>click</a>');
    expect(html).toContain('<a');
  });

  it('strips vbscript: hrefs (with leading whitespace)', () => {
    const { html } = carryHtml('<a href="  vbscript:msgbox(1)">click</a>', {});
    expect(html).not.toContain('vbscript:');
    expect(html).toContain('>click</a>');
  });

  it('joins multiple <style> blocks into styleText with a newline', () => {
    const { styleText } = carryHtml(
      '<style>.a{color:red}</style><div>x</div><style>.b{color:blue}</style>',
      {},
    );
    expect(styleText).toContain('.a{color:red}');
    expect(styleText).toContain('.b{color:blue}');
    expect(styleText).toBe('.a{color:red}\n.b{color:blue}');
  });

  it('strips explicit width/height from object-fit:cover images (inline style + attrs)', () => {
    const { html } = carryHtml(
      '<img src="x.jpg" width="980" height="733" style="width: 1440px; height: 733px; object-fit: cover; object-position: 100% 0%;">',
      {},
    );
    expect(html).not.toMatch(/width="980"/);
    expect(html).not.toMatch(/height="733"/);
    expect(html).not.toMatch(/width:\s*1440px/);
    expect(html).not.toMatch(/height:\s*733px/);
    // cover behavior is preserved
    expect(html).toContain('object-fit: cover');
    expect(html).toContain('object-position: 100% 0%');
  });

  it('keeps explicit width/height on images WITHOUT object-fit:cover', () => {
    const { html } = carryHtml(
      '<img src="x.jpg" width="100" height="50" style="width: 100px; height: 50px; object-fit: contain;">',
      {},
    );
    expect(html).toContain('width="100"');
    expect(html).toContain('height="50"');
    expect(html).toContain('width: 100px');
  });

  it('does not crash on a cover image that has no width/height to strip', () => {
    const { html } = carryHtml('<img src="x.jpg" style="object-fit: cover;">', {});
    expect(html).toContain('object-fit: cover');
  });
});

describe('carryHtml scroll-trigger un-gating (Shopify Dawn)', () => {
  it('strips scroll-trigger + scroll-trigger--* hook classes, keeps the rest', () => {
    const { html } = carryHtml(
      '<div class="footer-block scroll-trigger animate--slide-in scroll-trigger--offscreen"><p>Newsletter</p></div>',
      {},
    );
    expect(html).not.toContain('scroll-trigger');
    expect(html).toContain('class="footer-block animate--slide-in"');
    expect(html).toContain('<p>Newsletter</p>');
  });

  it('removes the class attribute entirely when scroll-trigger was its only class', () => {
    const { html } = carryHtml('<section class="scroll-trigger"><p>Body</p></section>', {});
    expect(html).not.toContain('class=');
    expect(html).toContain('<p>Body</p>');
  });
});
