// src/lib/replicate/parity/diff-regions.test.ts
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { extractDiffRegions } from './diff-regions.js';

/** Build a diff PNG buffer: white base, colored rows at given y (defaults to
 * pixelmatch mismatch red; pass `color` for e.g. anti-aliasing yellow). */
function diffPng(
  width: number,
  height: number,
  rows: Array<{ y: number; x0: number; x1: number; color?: [number, number, number, number] }>,
): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(255); // white, alpha 255
  for (const r of rows) {
    const [cr, cg, cb, ca] = r.color ?? [255, 0, 0, 255];
    for (let x = r.x0; x <= r.x1; x++) {
      const i = (r.y * width + x) * 4;
      png.data[i] = cr;
      png.data[i + 1] = cg;
      png.data[i + 2] = cb;
      png.data[i + 3] = ca;
    }
  }
  return PNG.sync.write(png);
}

describe('extractDiffRegions', () => {
  it('clusters mismatch rows into y-band regions with x extents', () => {
    const buf = diffPng(100, 200, [
      { y: 10, x0: 20, x1: 60 },
      { y: 12, x0: 25, x1: 70 },   // same band (gap < 8)
      { y: 100, x0: 0, x1: 99 },   // second band
    ]);
    const regions = extractDiffRegions(buf, { scale: 1 });
    expect(regions).toEqual([
      { top: 10, bottom: 12, left: 20, right: 70, pixels: 87 },
      { top: 100, bottom: 100, left: 0, right: 99, pixels: 100 },
    ]);
  });

  it('merges bands within the gap tolerance and scales to logical px', () => {
    const buf = diffPng(140, 100, [
      { y: 14, x0: 14, x1: 28 },
      { y: 20, x0: 14, x1: 28 },   // gap 6 <= 8 -> same band
    ]);
    const regions = extractDiffRegions(buf, { scale: 0.7 }); // desktop capture scale
    expect(regions).toHaveLength(1);
    expect(regions[0].top).toBe(20);     // 14 / 0.7
    expect(regions[0].bottom).toBe(29);  // round(20 / 0.7)
    expect(regions[0].left).toBe(20);
    expect(regions[0].right).toBe(40);
  });

  it('ignores tiny noise below minPixels', () => {
    const buf = diffPng(100, 100, [{ y: 5, x0: 50, x1: 51 }]);
    expect(extractDiffRegions(buf, { scale: 1, minPixels: 10 })).toEqual([]);
  });

  it('returns empty for a clean diff', () => {
    expect(extractDiffRegions(diffPng(50, 50, []), { scale: 1 })).toEqual([]);
  });

  it('excludes pixelmatch anti-aliasing yellow (locks g < 100)', () => {
    // pixelmatch paints AA pixels yellow (255,255,0) — ~40% of real diff
    // pixels; they are NOT mismatches. minPixels: 1 so the [] result can
    // only come from the color heuristic, not the noise filter.
    const yellow = diffPng(100, 100, [{ y: 5, x0: 50, x1: 50, color: [255, 255, 0, 255] }]);
    expect(extractDiffRegions(yellow, { scale: 1, minPixels: 1 })).toEqual([]);
    // Control: same coords in mismatch red DOES region — fixture is valid.
    const red = diffPng(100, 100, [{ y: 5, x0: 50, x1: 50 }]);
    expect(extractDiffRegions(red, { scale: 1, minPixels: 1 })).toHaveLength(1);
  });

  it('gap boundary: row distance exactly 8 merges, 9 splits (locks <=)', () => {
    const merged = extractDiffRegions(
      diffPng(100, 100, [
        { y: 10, x0: 20, x1: 26 },
        { y: 18, x0: 20, x1: 26 }, // diff 8 = tolerance -> same band
      ]),
      { scale: 1 },
    );
    expect(merged).toEqual([{ top: 10, bottom: 18, left: 20, right: 26, pixels: 14 }]);

    const split = extractDiffRegions(
      diffPng(100, 100, [
        { y: 10, x0: 20, x1: 26 },
        { y: 19, x0: 20, x1: 26 }, // diff 9 > tolerance -> new band
      ]),
      { scale: 1 },
    );
    expect(split).toEqual([
      { top: 10, bottom: 10, left: 20, right: 26, pixels: 7 },
      { top: 19, bottom: 19, left: 20, right: 26, pixels: 7 },
    ]);
  });

  it('minPixels is inclusive: a band with exactly the default 6 pixels survives (locks >=)', () => {
    const buf = diffPng(100, 100, [{ y: 5, x0: 50, x1: 55 }]); // 6 pixels
    expect(extractDiffRegions(buf, { scale: 1 })).toEqual([
      { top: 5, bottom: 5, left: 50, right: 55, pixels: 6 },
    ]);
  });
});
