import { describe, it, expect } from 'vitest';
import { rewriteResponsiveImages, mediaIdOf } from './responsive-image-rewrite.js';

const DESKTOP = 'http://localhost:8885/wp-content/uploads/2026/06/e20b04_78c87aec087f40859a405e925d30d2f5-mv2.jpg';
const MOBILE = 'https://static.wixstatic.com/media/e20b04_78c87aec087f40859a405e925d30d2f5~mv2.jpg/v1/fill/w_375,h_782,fp_0.63_0.02/x~mv2.jpg';
const ID = 'e20b04_78c87aec087f40859a405e925d30d2f5';

describe('mediaIdOf', () => {
  it('extracts the Wix media id from a local filename and a CDN url', () => {
    expect(mediaIdOf(DESKTOP)).toBe(ID);
    expect(mediaIdOf(MOBILE)).toBe(ID);
  });
  it('returns null for a non-Wix url', () => {
    expect(mediaIdOf('http://x/y/logo.png')).toBeNull();
  });
});

describe('rewriteResponsiveImages', () => {
  it('wraps an <img> with a mobile variant in a <picture> + media-gated <source>', () => {
    const html = `<wow-image><img src="${DESKTOP}" alt="hero"/></wow-image>`;
    const out = rewriteResponsiveImages(html, { [ID]: MOBILE });
    expect(out).toContain('<picture>');
    expect(out).toContain('media="(max-width:750px)"');
    expect(out).toContain(`srcset="${MOBILE}"`);
    expect(out).toContain(`src="${DESKTOP}"`); // desktop img preserved as default
    expect(out.indexOf('<source')).toBeLessThan(out.indexOf('<img')); // source before img
  });

  it('leaves <img>s without a captured mobile variant untouched', () => {
    const html = '<img src="http://localhost/uploads/aaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbb-mv2.jpg"/>';
    expect(rewriteResponsiveImages(html, { [ID]: MOBILE })).toBe(html);
  });

  it('is idempotent — does not double-wrap an already-wrapped <img>', () => {
    const html = `<wow-image><img src="${DESKTOP}"/></wow-image>`;
    const once = rewriteResponsiveImages(html, { [ID]: MOBILE });
    const twice = rewriteResponsiveImages(once, { [ID]: MOBILE });
    expect(twice).toBe(once);
    expect((twice.match(/<picture>/g) || []).length).toBe(1);
  });

  it('is a no-op with an empty map', () => {
    const html = `<img src="${DESKTOP}"/>`;
    expect(rewriteResponsiveImages(html, {})).toBe(html);
  });
});
