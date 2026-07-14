import { describe, it, expect } from 'vitest';
import { extractMediaUrls } from './media.js';

const BASE = 'https://shop.fictional.test/page';

describe('extractMediaUrls', () => {
  it('collects absolute <img> sources', () => {
    const html = `<img src="https://cdn.fictional.test/hero.jpg">`;
    expect(extractMediaUrls(html, BASE)).toContain('https://cdn.fictional.test/hero.jpg');
  });

  it('resolves root-relative and protocol-relative sources', () => {
    const html = `<img src="/img/a.png"><img src="//cdn.fictional.test/b.png">`;
    const out = extractMediaUrls(html, BASE);
    expect(out).toContain('https://shop.fictional.test/img/a.png');
    expect(out).toContain('https://cdn.fictional.test/b.png');
  });

  it('parses srcset candidates from <img> and <picture><source>', () => {
    const html = `
      <picture>
        <source srcset="https://cdn.fictional.test/w800.jpg 800w, https://cdn.fictional.test/w1600.jpg 1600w">
        <img srcset="https://cdn.fictional.test/small.jpg 1x, https://cdn.fictional.test/large.jpg 2x"
             src="https://cdn.fictional.test/fallback.jpg">
      </picture>`;
    const out = extractMediaUrls(html, BASE);
    expect(out).toContain('https://cdn.fictional.test/w800.jpg');
    expect(out).toContain('https://cdn.fictional.test/w1600.jpg');
    expect(out).toContain('https://cdn.fictional.test/large.jpg');
    expect(out).toContain('https://cdn.fictional.test/fallback.jpg');
  });

  it('collects the og:image', () => {
    const html = `<meta property="og:image" content="https://cdn.fictional.test/social.png">`;
    expect(extractMediaUrls(html, BASE)).toContain('https://cdn.fictional.test/social.png');
  });

  it('ignores data: URIs and deduplicates', () => {
    const html = `
      <img src="data:image/gif;base64,R0lGOD">
      <img src="https://cdn.fictional.test/x.jpg">
      <img src="https://cdn.fictional.test/x.jpg">`;
    const out = extractMediaUrls(html, BASE);
    expect(out).toEqual(['https://cdn.fictional.test/x.jpg']);
  });
});
