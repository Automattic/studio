import { describe, it, expect } from 'vitest';
import { splitRegions } from './split-regions.js';

const BODY = '<header class="site-h">H</header><main><section>M</section></main><footer class="site-f">F</footer>';

describe('splitRegions', () => {
  it('splits header/main/footer from a typical body', () => {
    const r = splitRegions(BODY, []);
    expect(r.headerHtml).toContain('site-h');
    expect(r.mainHtml).toContain('<section>M</section>');
    expect(r.footerHtml).toContain('site-f');
  });

  it('returns empty header/footer when absent; everything is main', () => {
    const r = splitRegions('<div class="only">x</div>', []);
    expect(r.headerHtml).toBe('');
    expect(r.footerHtml).toBe('');
    expect(r.mainHtml).toContain('only');
  });

  it('does not extract a nested header inside main as the page header', () => {
    const html = '<main><header class="inner-h">Nested</header><p>content</p></main><footer>F</footer>';
    const r = splitRegions(html, []);
    // The nested header stays inside mainHtml
    expect(r.headerHtml).toBe('');
    expect(r.mainHtml).toContain('inner-h');
    expect(r.footerHtml).toContain('F');
  });

  it('matches role=banner for header and role=contentinfo for footer', () => {
    const html = '<div role="banner" class="nav-h">NAV</div><section>BODY</section><div role="contentinfo" class="ft">FOOT</div>';
    const r = splitRegions(html, []);
    expect(r.headerHtml).toContain('nav-h');
    expect(r.footerHtml).toContain('ft');
    expect(r.mainHtml).toContain('BODY');
  });
});
