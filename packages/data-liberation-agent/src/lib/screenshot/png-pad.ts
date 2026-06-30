// padToMatch — Neptune-style magenta canvas padding (technique #1).
// pixelmatch needs equal dimensions, but origin and replica screenshots
// often disagree on height — and that disagreement IS the finding (lazy-load
// short captures, admin-bar offsets, layout overrun). Pad both to a common
// canvas, top-left aligned, magenta #ff00ff in the empty region: magenta in
// the resulting diff means "this side has no content here while the other
// side does" — a layout signal, never a style one.
import { PNG } from 'pngjs';

export const MAGENTA = { r: 255, g: 0, b: 255, a: 255 } as const;

export interface PadResult {
  padded: boolean;
  canvas: { width: number; height: number };
  aPng: Buffer;
  bPng: Buffer;
}

export interface PadResultDecoded {
  padded: boolean;
  canvas: { width: number; height: number };
  aImg: PNG;
  bImg: PNG;
}

/** Same contract as padToMatch but operates on already-decoded PNGs and
 *  returns decoded PNGs — no encode/decode round-trip. The Buffer variant
 *  stays for callers that only have file bytes. */
export function padToMatchDecoded(aImg: PNG, bImg: PNG): PadResultDecoded {
  if (aImg.width === bImg.width && aImg.height === bImg.height) {
    return { padded: false, canvas: { width: aImg.width, height: aImg.height }, aImg, bImg };
  }
  const width = Math.max(aImg.width, bImg.width);
  const height = Math.max(aImg.height, bImg.height);
  const fit = (img: PNG) => (img.width === width && img.height === height ? img : padOne(img, width, height));
  return { padded: true, canvas: { width, height }, aImg: fit(aImg), bImg: fit(bImg) };
}

export function padToMatch(a: Buffer, b: Buffer): PadResult {
  const aImg = PNG.sync.read(a);
  const bImg = PNG.sync.read(b);
  const r = padToMatchDecoded(aImg, bImg);
  if (!r.padded) return { padded: false, canvas: r.canvas, aPng: a, bPng: b };
  return {
    padded: true,
    canvas: r.canvas,
    // Encode only what actually changed — an image already at canvas size
    // comes back as the same decoded object, so reuse its original bytes.
    aPng: r.aImg === aImg ? a : PNG.sync.write(r.aImg),
    bPng: r.bImg === bImg ? b : PNG.sync.write(r.bImg),
  };
}

function padOne(img: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    out.data[i * 4] = MAGENTA.r;
    out.data[i * 4 + 1] = MAGENTA.g;
    out.data[i * 4 + 2] = MAGENTA.b;
    out.data[i * 4 + 3] = MAGENTA.a;
  }
  PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
  return out;
}
