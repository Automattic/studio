import { describe, it, expect, vi } from 'vitest';
import { rewriteMediaUrls, toLocalUrlMapping } from './media-url-rewrite.js';

describe('rewriteMediaUrls', () => {
  it('returns input unchanged when mapping is empty', () => {
    const html = '<img src="https://cdn.example.com/a.jpg" />';
    expect(rewriteMediaUrls(html, new Map())).toBe(html);
  });

  it('rewrites <img src> when source URL is mapped', () => {
    const html = '<p>Hi</p><img src="https://cdn.example.com/a.jpg" alt="A">';
    const map = new Map([['https://cdn.example.com/a.jpg', 'http://localhost:8881/wp-content/uploads/2024/01/a.jpg']]);
    const out = rewriteMediaUrls(html, map);
    expect(out).toContain('http://localhost:8881/wp-content/uploads/2024/01/a.jpg');
    expect(out).not.toContain('https://cdn.example.com/a.jpg');
  });

  it('rewrites srcset entries', () => {
    const html = '<img srcset="https://cdn/a.jpg 1x, https://cdn/a-2x.jpg 2x">';
    const map = new Map([
      ['https://cdn/a.jpg', 'http://l/a.jpg'],
      ['https://cdn/a-2x.jpg', 'http://l/a-2x.jpg'],
    ]);
    const out = rewriteMediaUrls(html, map);
    expect(out).toContain('http://l/a.jpg 1x');
    expect(out).toContain('http://l/a-2x.jpg 2x');
  });

  it('rewrites JSON-shaped block-markup attributes', () => {
    const block = '<!-- wp:image {"id":1,"url":"https://cdn/a.jpg"} -->\n<figure><img src="https://cdn/a.jpg"/></figure>\n<!-- /wp:image -->';
    const map = new Map([['https://cdn/a.jpg', 'http://l/a.jpg']]);
    const out = rewriteMediaUrls(block, map);
    expect(out).toContain('"url":"http://l/a.jpg"');
    expect(out).toContain('src="http://l/a.jpg"');
    expect(out).not.toContain('cdn/a.jpg');
  });

  it('escapes regex metacharacters in source URLs (querystrings)', () => {
    const html = '<img src="https://cdn/a.jpg?v=1&w=820">';
    const map = new Map([['https://cdn/a.jpg?v=1&w=820', 'http://l/a.jpg']]);
    const out = rewriteMediaUrls(html, map);
    expect(out).toBe('<img src="http://l/a.jpg">');
  });

  it('leaves URLs not in the map untouched', () => {
    const html = '<img src="https://cdn/known.jpg"><img src="https://cdn/unknown.jpg">';
    const map = new Map([['https://cdn/known.jpg', 'http://l/k.jpg']]);
    const out = rewriteMediaUrls(html, map);
    expect(out).toContain('http://l/k.jpg');
    expect(out).toContain('https://cdn/unknown.jpg');
  });

  it('reports unmapped URLs via onMissing callback', () => {
    const html = '<img src="https://cdn/unknown.jpg">';
    const onMissing = vi.fn();
    const map = new Map([['https://cdn/known.jpg', 'http://l/k.jpg']]);
    rewriteMediaUrls(html, map, { onMissing });
    expect(onMissing).toHaveBeenCalledWith('https://cdn/unknown.jpg');
  });

  it('rewrites Wix image variants that share the same media asset id', () => {
    const mapped =
      'https://static.wixstatic.com/media/e20b04_78c87aec087f40859a405e925d30d2f5~mv2.jpg/v1/fill/w_1280,h_663,fp_0.63_0.02,q_85,enc_avif,quality_auto/e20b04_78c87aec087f40859a405e925d30d2f5~mv2.jpg';
    const composed =
      'https://static.wixstatic.com/media/e20b04_78c87aec087f40859a405e925d30d2f5~mv2.jpg/v1/fill/w_1008,h_557,fp_0.63_0.02,q_85,enc_avif,quality_auto/e20b04_78c87aec087f40859a405e925d30d2f5~mv2.jpg';
    const html = `<img src="${composed}">`;
    const onMissing = vi.fn();
    const out = rewriteMediaUrls(html, new Map([[mapped, 'http://localhost:8881/wp-content/uploads/2026/04/hero.jpg']]), { onMissing });

    expect(out).toBe('<img src="http://localhost:8881/wp-content/uploads/2026/04/hero.jpg">');
    expect(onMissing).not.toHaveBeenCalled();
  });

  it('does not warn for URLs that were successfully rewritten', () => {
    const html = '<img src="https://cdn/known.jpg">';
    const onMissing = vi.fn();
    const map = new Map([['https://cdn/known.jpg', 'http://l/k.jpg']]);
    rewriteMediaUrls(html, map, { onMissing });
    expect(onMissing).not.toHaveBeenCalled();
  });

  it('handles <a href> to image files', () => {
    const html = '<a href="https://cdn/file.pdf">PDF</a>';
    const map = new Map([['https://cdn/file.pdf', 'http://l/file.pdf']]);
    const out = rewriteMediaUrls(html, map);
    expect(out).toContain('href="http://l/file.pdf"');
  });

  it('rewrites Wix transform URLs in srcset without mangling (commas in transform params)', () => {
    // Wix gallery srcset: the transform URL contains commas inside the parameter
    // segment (/v1/fill/w_680,h_510,q_90,enc_avif,quality_auto/).  A naïve
    // split-on-comma parser produces a truncated key like
    // https://…/media/<HASH>~mv2.png/v1/fill/w_943 which is a substring of the
    // full transform URL.  The regex-replace then only replaces the prefix,
    // appending the transform tail to the local path — the "mangle".
    const hash = '53bc4c_c32b1032bb294fc993285aa77002c515';
    const base = `https://static.wixstatic.com/media/${hash}~mv2.png`;
    // The map key is the variant that was actually downloaded (v1/fit/w_943,h_707)
    const mapKey = `${base}/v1/fit/w_943,h_707,q_90,enc_avif,quality_auto/${hash}~mv2.png`;
    const localUrl = `http://localhost:8884/wp-content/uploads/2026/05/${hash}-mv2.png`;
    const map = new Map([[mapKey, localUrl]]);

    // The gallery HTML uses a different size variant (v1/fill/w_943,h_707)
    const fillUrl1x = `${base}/v1/fill/w_680,h_510,q_90,enc_avif,quality_auto/${hash}~mv2.png`;
    const fillUrl2x = `${base}/v1/fill/w_943,h_707,q_90,enc_avif,quality_auto/${hash}~mv2.png`;
    const html = `<picture><source srcset="${fillUrl1x} 1x, ${fillUrl2x} 2x" type="image/png"><img src="${fillUrl2x}"></picture>`;

    const out = rewriteMediaUrls(html, map);

    // Every occurrence of the source domain must be replaced
    expect(out).not.toContain('static.wixstatic.com');
    // Local URL must appear and must NOT have transform-tail garbage appended
    expect(out).not.toContain(`${localUrl},`);
    expect(out).not.toContain(`${localUrl}/`);
    // srcset and img src should both point cleanly to the local file
    expect(out).toContain(`srcset="${localUrl} 1x, ${localUrl} 2x"`);
    expect(out).toContain(`src="${localUrl}"`);
  });

  it('rewrites a transform <img src> when only the BASE url is mapped (no transform-tail mangle)', () => {
    // installMediaForUrl stores the BASE wixstatic URL as the map key (that's the
    // stub source). Carried blog/post <img> use the transform CDN path. The base
    // key is a substring-prefix of the transform URL, so applying it first would
    // leave `<local>.jpg/v1/fill/.../img.jpg` (a 404). Longest-source-first fixes it.
    const hash = '670df9_94b496dd08804719b2be70c43165684f';
    const base = `https://static.wixstatic.com/media/${hash}~mv2.jpg`;
    const local = `http://localhost:8884/wp-content/uploads/2026/05/${hash}-mv2.jpg`;
    const map = new Map([[base, local]]);
    const transform = `${base}/v1/fill/w_518,h_311,al_c,q_80,enc_avif,quality_auto/${hash}~mv2.jpg`;
    const html = `<img src="${transform}">`;

    const out = rewriteMediaUrls(html, map);

    expect(out).toBe(`<img src="${local}">`);
    expect(out).not.toContain('static.wixstatic.com');
    expect(out).not.toContain(`${local}/v1`); // no leftover transform tail
  });

  it('rewrites a Wix srcset whose display filename contains parentheses (no `).png` mangle)', () => {
    // The Wix logo srcset ends each variant with the display name `… (1).png`.
    // URL_LIKE must not truncate at the `)`, or the rewrite leaves `<local>).png`.
    const hash = '670df9_dc553b632f22456e8f3e591105cdc3da';
    const base = `https://static.wixstatic.com/media/${hash}~mv2.png`;
    const local = `http://localhost:8884/wp-content/uploads/2026/05/Cornelius-Holmes-1.png`;
    const map = new Map([[base, local]]);
    const v1 = `${base}/v1/crop/x_0,y_167,w_500,h_160/fill/w_153,h_49,q_85,enc_avif,quality_auto/Cornelius%20Holmes%20(1).png`;
    const v2 = `${base}/v1/crop/x_0,y_167,w_500,h_160/fill/w_306,h_98,q_85,enc_avif,quality_auto/Cornelius%20Holmes%20(1).png`;
    const html = `<img srcset="${v1} 1x, ${v2} 2x" src="${v1}">`;

    const out = rewriteMediaUrls(html, map);

    expect(out).toBe(`<img srcset="${local} 1x, ${local} 2x" src="${local}">`);
    expect(out).not.toContain('static.wixstatic.com');
    expect(out).not.toContain(').png'); // the mangle signature
  });
});

describe('toLocalUrlMapping', () => {
  it('joins filename with localBase, stripping trailing slash', () => {
    const filenames = new Map([
      ['https://cdn/a.jpg', 'a.jpg'],
      ['https://cdn/b.jpg', 'b-2.jpg'],
    ]);
    const out = toLocalUrlMapping(filenames, 'http://localhost:8881/uploads/');
    expect(out.get('https://cdn/a.jpg')).toBe('http://localhost:8881/uploads/a.jpg');
    expect(out.get('https://cdn/b.jpg')).toBe('http://localhost:8881/uploads/b-2.jpg');
  });
});
