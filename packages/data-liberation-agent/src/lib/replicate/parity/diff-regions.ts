// src/lib/replicate/parity/diff-regions.ts
//
// Deterministic diff-region extraction for the parity repair loop. pixelmatch
// marks mismatching pixels in saturated red on the diff PNG; we cluster the
// mismatch rows into y-bands (the probe then inspects only elements that
// intersect a band). Pure given a PNG buffer — same buffer, same regions.
//
import { PNG } from 'pngjs';

export interface DiffRegion {
  /** Logical (CSS) px, top-of-capture origin. */
  top: number;
  /** Bounded by viewport.height / scale: compare.ts crops both PNGs to the
   * common top-viewport region before pixelmatch, so regions never reference
   * below-the-fold content — consistent with what the score measures. */
  bottom: number;
  left: number;
  right: number;
  /** Raw mismatch pixel count inside the band (png px). */
  pixels: number;
}

export interface DiffRegionOpts {
  /** Capture device scale (desktop 0.7, mobile 1) — png px -> logical px. */
  scale: number;
  /** Rows further apart than this (png px) start a new band. Default 8. */
  gapTolerance?: number;
  /** Bands with fewer mismatch pixels are noise. Default 6. */
  minPixels?: number;
}

function isMismatch(data: Buffer | Uint8Array, i: number): boolean {
  // Saturated red = pixelmatch mismatch. g < 100 also excludes the yellow
  // (255,255,0) anti-aliasing markers pixelmatch paints, which are not
  // mismatches. The alpha guard is belt-and-braces beyond the color check:
  // pixelmatch never emits transparent red (output alpha is always 255), so
  // it only screens out corrupt/uninitialized buffer data.
  return data[i] > 200 && data[i + 1] < 100 && data[i + 2] < 100 && data[i + 3] > 0;
}

export function extractDiffRegions(diffPngBuffer: Buffer, opts: DiffRegionOpts): DiffRegion[] {
  const { scale } = opts;
  const gap = opts.gapTolerance ?? 8;
  const minPixels = opts.minPixels ?? 6;
  const png = PNG.sync.read(diffPngBuffer);

  // Per-row mismatch stats.
  const rows: Array<{ y: number; x0: number; x1: number; count: number }> = [];
  for (let y = 0; y < png.height; y++) {
    let x0 = -1;
    let x1 = -1;
    let count = 0;
    for (let x = 0; x < png.width; x++) {
      if (isMismatch(png.data, (y * png.width + x) * 4)) {
        if (x0 < 0) x0 = x;
        x1 = x;
        count++;
      }
    }
    if (count > 0) rows.push({ y, x0, x1, count });
  }

  // Cluster rows into bands.
  const regions: DiffRegion[] = [];
  let band: { top: number; bottom: number; left: number; right: number; pixels: number } | null = null;
  const flush = (): void => {
    if (band && band.pixels >= minPixels) {
      regions.push({
        top: Math.round(band.top / scale),
        bottom: Math.round(band.bottom / scale),
        left: Math.round(band.left / scale),
        right: Math.round(band.right / scale),
        pixels: band.pixels,
      });
    }
    band = null;
  };
  for (const row of rows) {
    if (band && row.y - band.bottom <= gap) {
      band.bottom = row.y;
      band.left = Math.min(band.left, row.x0);
      band.right = Math.max(band.right, row.x1);
      band.pixels += row.count;
    } else {
      flush();
      band = { top: row.y, bottom: row.y, left: row.x0, right: row.x1, pixels: row.count };
    }
  }
  flush();
  return regions;
}
