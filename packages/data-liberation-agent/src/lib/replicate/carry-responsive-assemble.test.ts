import { describe, it, expect } from 'vitest';
import { assembleResponsiveMobile } from './carry-responsive-assemble.js';

// Synthetic Wix media id (matches the xxxx_<hash> shape; no real source asset).
const ID = 'aaaa1111_0123456789abcdef0123456789abcdef';
// The desktop variant that WAS downloaded + installed (present in the run media map).
const DESKTOP_CDN = `https://static.wixstatic.com/media/${ID}~mv2.jpg/v1/fill/w_980,h_500,q_90/photo.jpg`;
const DESKTOP_LOCAL = `http://localhost:8899/wp-content/uploads/2026/06/${ID}-mv2.jpg`;
// The mobile crop the capture recorded but NEVER downloaded (only on the CDN).
const MOBILE_CDN = `https://static.wixstatic.com/media/${ID}~mv2.jpg/v1/fill/w_390,h_700,q_90/photo.jpg`;

const mediaMap = () => new Map<string, string>([[DESKTOP_CDN, DESKTOP_LOCAL]]);
const responsive = () => ({ [ID]: MOBILE_CDN });

describe('assembleResponsiveMobile', () => {
  it('self-hosts the injected mobile-variant URLs by repointing them to the local desktop copy', () => {
    // Carried (already-rewritten) island: <img> src is local desktop; a pro-gallery of the same image.
    const html =
      `<wow-image><img src="${DESKTOP_LOCAL}" alt="hero"/></wow-image>` +
      `<div class="pro-gallery"><img data-hook="gallery-item-image-img" src="${DESKTOP_LOCAL}" alt="g"/></div>`;

    const out = assembleResponsiveMobile(html, responsive(), mediaMap());

    // Hard requirement: zero CDN references survive.
    expect(out).not.toContain('static.wixstatic.com');
    // The responsive <source> and the mobile grid both point at the local desktop file.
    expect(out).toContain(`srcset="${DESKTOP_LOCAL}"`);
    expect(out).toContain('lib-carry-gallery-mobile');
    // Mobile grid <img> resolves to the local desktop copy (cheerio serializes void <img> without a self-close).
    expect(out).toContain(`<img src="${DESKTOP_LOCAL}" alt="g" loading="lazy">`);
  });

  it('still injects the responsive <picture> + mobile grid structure (fidelity steps preserved)', () => {
    const html = `<div class="pro-gallery"><img data-hook="gallery-item-image-img" src="${DESKTOP_LOCAL}" alt="g"/></div>`;
    const out = assembleResponsiveMobile(html, responsive(), mediaMap());
    expect(out).toContain('lib-carry-gallery-mobile');
    expect(out).toContain('media="(max-width:750px)"');
  });

  it('with no media map, leaves the (best-effort) CDN refs as the inject steps produced them', () => {
    const html = `<wow-image><img src="${DESKTOP_LOCAL}" alt="hero"/></wow-image>`;
    const out = assembleResponsiveMobile(html, responsive(), new Map());
    // No map → nothing to repoint; the mobile <source> keeps the CDN url (unchanged behavior).
    expect(out).toContain(`srcset="${MOBILE_CDN}"`);
  });
});
