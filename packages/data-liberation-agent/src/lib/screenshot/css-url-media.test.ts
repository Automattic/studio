import { describe, it, expect } from 'vitest';
import { extractCssMediaUrls } from './css-url-media.js';

describe('extractCssMediaUrls', () => {
  it('finds background + self-hosted font urls, skips CDN font hosts and data URIs', () => {
    const css = `
      .hero{background:url("https://src.test/bg.jpg")}
      @font-face{font-family:F;src:url(https://src.test/f.woff2)}
      .x{background:url(data:image/png;base64,AAA)}
      @font-face{font-family:G;src:url(https://fonts.gstatic.com/g.woff2)}`;
    const urls = extractCssMediaUrls(css, ['fonts.gstatic.com', 'fonts.googleapis.com']);
    expect(urls).toContain('https://src.test/bg.jpg');
    expect(urls).toContain('https://src.test/f.woff2');
    expect(urls).not.toContain('https://fonts.gstatic.com/g.woff2');
    expect(urls.some((u) => u.startsWith('data:'))).toBe(false);
  });

  it('dedupes repeated urls and handles single/no quotes', () => {
    const css = `.a{background:url('https://src.test/x.png')}.b{background:url(https://src.test/x.png)}`;
    const urls = extractCssMediaUrls(css, []);
    expect(urls).toEqual(['https://src.test/x.png']);
  });

  it('ignores relative urls (handled by the rewrite, not discovery)', () => {
    const urls = extractCssMediaUrls(`.a{background:url(/img/x.png)}`, []);
    expect(urls).toEqual([]);
  });
});
