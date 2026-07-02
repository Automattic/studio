import { describe, it, expect } from 'vitest';
import { selectMissingMediaDownloads } from './carry-missing-media.js';
import { mediaIdOf } from './responsive-image-rewrite.js';

// Synthetic Wix media ids (no real source asset).
const MISSING = 'bbbb2222_fedcba9876543210fedcba9876543210';
const KNOWN = 'cccc3333_00112233445566778899aabbccddeeff';
const M1X = `https://static.wixstatic.com/media/${MISSING}~mv2.avif/v1/fill/w_317,h_238,q_90/x.avif`;
const M2X = `https://static.wixstatic.com/media/${MISSING}~mv2.avif/v1/fill/w_634,h_476,q_90/x.avif`;
const KNOWN_VARIANT = `https://static.wixstatic.com/media/${KNOWN}~mv2.png/v1/fill/w_500,h_400,q_90/y.png`;

describe('selectMissingMediaDownloads', () => {
  it('selects ONE url per missing Wix media-id (collapsing srcset variants)', () => {
    const html = `<picture><source srcset="${M1X} 1x, ${M2X} 2x"/><img src="${M1X}" alt="g"/></picture>`;
    const out = selectMissingMediaDownloads([html], new Set(), new Set());
    expect(out).toHaveLength(1);
    expect(mediaIdOf(out[0])).toBe(MISSING);
  });

  it('skips assets whose media-id is already downloaded (a variant is in the store)', () => {
    const html = `<img src="${KNOWN_VARIANT}" alt="k"/>`;
    expect(selectMissingMediaDownloads([html], new Set([KNOWN]), new Set())).toEqual([]);
  });

  it('skips a url already present as an exact store key', () => {
    const html = `<img src="${M1X}" alt="g"/>`;
    expect(selectMissingMediaDownloads([html], new Set(), new Set([M1X]))).toEqual([]);
  });

  it('ignores data: URIs and relative/local paths', () => {
    const html =
      '<img src="data:image/png;base64,AAAA"/>' +
      '<img src="/wp-content/uploads/2026/06/local.png"/>' +
      '<img src="../rel.jpg"/>';
    expect(selectMissingMediaDownloads([html], new Set(), new Set())).toEqual([]);
  });
});
