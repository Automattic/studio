// Pixel-diff two PNGs (crops both to their common top-left region so differing
// heights/widths don't abort the compare). Prints {diffPct, diffPixels, dims}
// and writes a diff PNG. Used to measure replica-vs-source parity during the
// design-replication work.
//   npx tsx scripts/diff-pngs.ts <a.png> <b.png> [out-diff.png]
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const [aPath, bPath, outPath = 'diff.png'] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error('usage: tsx scripts/diff-pngs.ts <a.png> <b.png> [out.png]');
  process.exit(2);
}

const a = PNG.sync.read(readFileSync(aPath));
const b = PNG.sync.read(readFileSync(bPath));
const w = Math.min(a.width, b.width);
const h = Math.min(a.height, b.height);

function crop(src: PNG, cw: number, ch: number): PNG {
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = (src.width * y + x) << 2;
      const di = (cw * y + x) << 2;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

const ca = crop(a, w, h);
const cb = crop(b, w, h);
const diff = new PNG({ width: w, height: h });
const diffPixels = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: 0.1 });
writeFileSync(outPath, PNG.sync.write(diff));
const total = w * h;
console.log(
  JSON.stringify({
    dims: { w, h },
    aDims: { w: a.width, h: a.height },
    bDims: { w: b.width, h: b.height },
    diffPixels,
    totalPixels: total,
    diffPct: Number(((100 * diffPixels) / total).toFixed(2)),
    out: outPath,
  }),
);
