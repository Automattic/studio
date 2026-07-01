import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { closeSvgRasterizer, isRiskySvg, rasterizeSvg } from './svg-raster.js';

// cwd-local tmp dir per repo guidance (no os.tmpdir, no output/ reads).
const TMP_ROOT = join(process.cwd(), '.tmp-test', 'svg-raster');

describe('isRiskySvg', () => {
  it('flags <use href> references', () => {
    expect(isRiskySvg('<svg xmlns="http://www.w3.org/2000/svg"><use href="#icon"/></svg>')).toBe(true);
  });

  it('flags <defs> blocks', () => {
    expect(isRiskySvg('<svg><defs><linearGradient id="g"/></defs><rect/></svg>')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isRiskySvg('<svg><USE HREF="#a"/></svg>')).toBe(true);
    expect(isRiskySvg('<SVG><DEFS></DEFS></SVG>')).toBe(true);
  });

  it('accepts Buffer input', () => {
    expect(isRiskySvg(Buffer.from('<svg><defs/></svg>'))).toBe(true);
    expect(isRiskySvg(Buffer.from('<svg><rect/></svg>'))).toBe(false);
  });

  it('is false for a plain shape-only SVG', () => {
    expect(isRiskySvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')).toBe(false);
  });

  it('is not fooled by "used"/"defsX" appearing in text content', () => {
    expect(isRiskySvg('<svg><text>commonly used defsX tokens</text></svg>')).toBe(false);
    // element names that merely START with use/defs are not the risky tags
    expect(isRiskySvg('<svg><userSpace x="1"/><defsXtra/></svg>')).toBe(false);
  });
});

describe.skipIf(process.env.SKIP_BROWSER_TESTS)('rasterizeSvg (real Chromium)', () => {
  afterAll(async () => {
    await closeSvgRasterizer();
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('rasterizes a 200x100 SVG to a PNG with a 1024px long edge, preserving aspect', async () => {
    mkdirSync(TMP_ROOT, { recursive: true });
    const svgPath = join(TMP_ROOT, 'banner.svg');
    const pngPath = join(TMP_ROOT, 'banner.png');
    // Fictional fixture — a simple 2:1 banner.
    writeFileSync(
      svgPath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
        '<rect width="200" height="100" fill="#3366cc"/></svg>',
    );

    const result = await rasterizeSvg(svgPath, pngPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.width).toBe(1024);
      expect(result.height).toBe(512);
    }
    expect(existsSync(pngPath)).toBe(true);
    const png = PNG.sync.read(readFileSync(pngPath));
    expect(png.width).toBe(1024);
    expect(png.height).toBe(512);
  }, 60000);

  it('returns {ok:false} for a malformed SVG without throwing', async () => {
    mkdirSync(TMP_ROOT, { recursive: true });
    const svgPath = join(TMP_ROOT, 'broken.svg');
    const pngPath = join(TMP_ROOT, 'broken.png');
    writeFileSync(svgPath, 'this is <<< not >>> an svg at all');

    const result = await rasterizeSvg(svgPath, pngPath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
    expect(existsSync(pngPath)).toBe(false);
  }, 60000);

  it('returns {ok:false} when the source file is missing', async () => {
    const result = await rasterizeSvg(join(TMP_ROOT, 'nope.svg'), join(TMP_ROOT, 'nope.png'));
    expect(result.ok).toBe(false);
  }, 60000);
});
