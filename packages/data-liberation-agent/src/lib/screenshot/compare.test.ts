import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { buildRepairTasks, compareScreenshotDirs, scoreViewportPair, PARITY_GATE_SCORE, HEIGHT_MISMATCH_THRESHOLD, type ComparisonResult, type ViewportScore } from './compare.js';

const TMP = join(process.cwd(), '.tmp-test', 'compare');

/** Write a solid RGBA PNG of w×h at `path`. */
function writeSolidPng(path: string, w: number, h: number, rgba: [number, number, number, number]) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    png.data[o] = rgba[0]; png.data[o + 1] = rgba[1]; png.data[o + 2] = rgba[2]; png.data[o + 3] = rgba[3];
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

/** Build a screenshot dir: manifest.json + <viewport>/<slug>.png for one page. */
function buildDir(dir: string, url: string, slug: string, png: { w: number; h: number; color: [number, number, number, number] }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 1, entries: { [url]: { slug, capturedAt: '2026-05-20T00:00:00Z' } } }, null, 2));
  for (const vp of ['desktop', 'mobile']) writeSolidPng(join(dir, vp, `${slug}.png`), png.w, png.h, png.color);
}

describe('scoreViewportPair', () => {
  beforeEach(() => rmSync(TMP, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('returns status:ok score:1 for two identical solid PNGs', () => {
    const oPath = join(TMP, 'a', 'origin.png');
    const rPath = join(TMP, 'a', 'replica.png');
    writeSolidPng(oPath, 1440, 900, [42, 42, 42, 255]);
    writeSolidPng(rPath, 1440, 900, [42, 42, 42, 255]);
    const result = scoreViewportPair(oPath, rPath, 'desktop');
    expect(result.status).toBe('ok');
    expect(result.score).toBe(1);
  });

  it('returns status:missing-origin when the origin path does not exist', () => {
    const rPath = join(TMP, 'b', 'replica.png');
    writeSolidPng(rPath, 390, 844, [1, 2, 3, 255]);
    const result = scoreViewportPair(join(TMP, 'b', 'no-origin.png'), rPath, 'mobile');
    expect(result.status).toBe('missing-origin');
    expect(result.score).toBeNull();
  });
});

describe('compareScreenshotDirs', () => {
  beforeEach(() => rmSync(TMP, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('scores identical screenshots as 1.0', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    buildDir(origin, 'https://origin.test/services', 'services', { w: 1440, h: 900, color: [10, 20, 30, 255] });
    buildDir(replica, 'http://localhost:8881/services', 'services', { w: 1440, h: 900, color: [10, 20, 30, 255] });

    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica });

    expect(result.results).toHaveLength(1);
    const r = result.results[0];
    expect(r.pathname).toBe('/services');
    expect(r.desktop.status).toBe('ok');
    expect(r.desktop.score).toBe(1);
    expect(r.mobile.score).toBe(1);
  });

  it('scores fully-different screenshots near 0', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    buildDir(origin, 'https://origin.test/x', 'x', { w: 1440, h: 900, color: [0, 0, 0, 255] });
    buildDir(replica, 'http://localhost:8881/x', 'x', { w: 1440, h: 900, color: [255, 255, 255, 255] });

    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica });
    expect(result.results[0].desktop.score).toBeLessThan(0.01);
  });

  it('crops to the shorter common region when origin and replica heights differ', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    // full-page heights differ (3000 vs 1200) but top 900 is identical color
    buildDir(origin, 'https://origin.test/p', 'p', { w: 1440, h: 3000, color: [5, 5, 5, 255] });
    buildDir(replica, 'http://localhost:8881/p', 'p', { w: 1440, h: 1200, color: [5, 5, 5, 255] });

    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica });
    const d = result.results[0].desktop;
    expect(d.status).toBe('ok');
    expect(d.width).toBe(1440);
    expect(d.height).toBe(900);      // min(3000, 1200, 900)
    expect(d.score).toBe(1);
  });

  it('crops to min height when both pages are shorter than the viewport', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    buildDir(origin, 'https://origin.test/short', 's', { w: 1440, h: 500, color: [9, 9, 9, 255] });
    buildDir(replica, 'http://localhost:8881/short', 's', { w: 1440, h: 700, color: [9, 9, 9, 255] });

    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica });
    expect(result.results[0].desktop.height).toBe(500); // min(500, 700, 900)
  });

  it('throws an explicit error when a manifest is missing', async () => {
    await expect(compareScreenshotDirs({ originDir: join(TMP, 'nope'), replicaDir: join(TMP, 'nope2') }))
      .rejects.toThrow(/manifest missing/);
  });

  it('reports missing-replica when a pathname is absent from the replica', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    buildDir(origin, 'https://origin.test/only-origin', 'oo', { w: 1440, h: 900, color: [1, 2, 3, 255] });
    mkdirSync(replica, { recursive: true });
    writeFileSync(join(replica, 'manifest.json'), JSON.stringify({ version: 1, entries: {} }));
    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica });
    expect(result.results[0].desktop.status).toBe('missing-replica');
    expect(result.results[0].desktop.score).toBeNull();
  });

  it('reports decode-error for a corrupt PNG instead of crashing', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    buildDir(origin, 'https://origin.test/c', 'c', { w: 1440, h: 900, color: [1, 2, 3, 255] });
    buildDir(replica, 'http://localhost:8881/c', 'c', { w: 1440, h: 900, color: [1, 2, 3, 255] });
    writeFileSync(join(replica, 'desktop', 'c.png'), 'not a png');   // corrupt one side
    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica });
    expect(result.results[0].desktop.status).toBe('decode-error');
    expect(result.results[0].mobile.status).toBe('ok'); // other viewport unaffected
  });

  it('reports missing-replica when the replica PNG file is absent', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    buildDir(origin, 'https://origin.test/m', 'm', { w: 1440, h: 900, color: [1, 2, 3, 255] });
    buildDir(replica, 'http://localhost:8881/m', 'm', { w: 1440, h: 900, color: [1, 2, 3, 255] });
    rmSync(join(replica, 'desktop', 'm.png'));
    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica });
    expect(result.results[0].desktop.status).toBe('missing-replica');
  });

  it('reports missing-origin when the origin PNG file is absent', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    buildDir(origin, 'https://origin.test/mo', 'mo', { w: 1440, h: 900, color: [1, 2, 3, 255] });
    buildDir(replica, 'http://localhost:8881/mo', 'mo', { w: 1440, h: 900, color: [1, 2, 3, 255] });
    rmSync(join(origin, 'desktop', 'mo.png'));
    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica });
    expect(result.results[0].desktop.status).toBe('missing-origin');
  });

  it('writes a diff PNG and comparison.json', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    buildDir(origin, 'https://origin.test/d', 'd', { w: 1440, h: 900, color: [0, 0, 0, 255] });
    buildDir(replica, 'http://localhost:8881/d', 'd', { w: 1440, h: 900, color: [255, 255, 255, 255] });
    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica });
    const d = result.results[0].desktop;
    expect(d.diffPath).toBeDefined();
    expect(existsSync(d.diffPath!)).toBe(true);
    expect(existsSync(join(replica, 'comparison.json'))).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(replica, 'comparison.json'), 'utf8'));
    expect(onDisk.version).toBe(2);
    expect(onDisk.results[0].desktop.score).toBeCloseTo(d.score!, 5);
  });
});

describe('height-delta co-gate', () => {
  beforeEach(() => rmSync(TMP, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('reports heightDelta from PRE-crop dimensions and fails the gate beyond the default 8px', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    // Identical content inside the cropped region — the min-crop comparison
    // HIDES the 40px height loss (score stays 1); heightDelta is the gate
    // that surfaces it.
    buildDir(origin, 'https://origin.test/h', 'h', { w: 1440, h: 940, color: [7, 7, 7, 255] });
    buildDir(replica, 'http://localhost:8881/h', 'h', { w: 1440, h: 900, color: [7, 7, 7, 255] });
    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica });
    const d = result.results[0].desktop;
    expect(d.status).toBe('ok');
    expect(d.score).toBe(1);
    expect(d.heightDelta).toBe(40);
    expect(d.heightPass).toBe(false);
  });

  it('equal heights pass: heightDelta 0, heightPass true', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    buildDir(origin, 'https://origin.test/eq', 'eq', { w: 1440, h: 900, color: [7, 7, 7, 255] });
    buildDir(replica, 'http://localhost:8881/eq', 'eq', { w: 1440, h: 900, color: [7, 7, 7, 255] });
    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica });
    const d = result.results[0].desktop;
    expect(d.heightDelta).toBe(0);
    expect(d.heightPass).toBe(true);
  });

  it('maxHeightDelta opt widens the gate', async () => {
    const origin = join(TMP, 'origin');
    const replica = join(TMP, 'replica');
    buildDir(origin, 'https://origin.test/w', 'w', { w: 1440, h: 940, color: [7, 7, 7, 255] });
    buildDir(replica, 'http://localhost:8881/w', 'w', { w: 1440, h: 900, color: [7, 7, 7, 255] });
    const result = await compareScreenshotDirs({ originDir: origin, replicaDir: replica, maxHeightDelta: 50 });
    expect(result.results[0].desktop.heightDelta).toBe(40);
    expect(result.results[0].desktop.heightPass).toBe(true);
  });
});

describe('buildRepairTasks', () => {
  const vp = (over: Partial<ViewportScore>): ViewportScore => ({
    status: 'ok', score: 1, heightDelta: 0, heightPass: true, ...over,
  });
  const res = (over: Partial<ComparisonResult>): ComparisonResult => ({
    pathname: '/p', originUrl: 'o', replicaUrl: 'r', desktop: vp({}), mobile: vp({}), ...over,
  });

  it('passing pages emit no tasks', () => {
    expect(buildRepairTasks([res({})], { floor: 0.99 })).toEqual([]);
  });

  it('a sub-floor score emits a mismatch task for the failing viewport only', () => {
    const tasks = buildRepairTasks([res({ desktop: vp({ score: 0.8 }) })], { floor: 0.99 });
    expect(tasks).toEqual([
      { surface: 'frontend', pathname: '/p', viewport: 'desktop', kind: 'mismatch', score: 0.8, heightDelta: 0 },
    ]);
  });

  it('a height failure emits kind height and takes precedence over a co-failing score', () => {
    const tasks = buildRepairTasks(
      [res({ mobile: vp({ score: 0.5, heightDelta: 300, heightPass: false }) })],
      { floor: 0.99 },
    );
    expect(tasks).toEqual([
      { surface: 'frontend', pathname: '/p', viewport: 'mobile', kind: 'height', score: 0.5, heightDelta: 300 },
    ]);
  });

  it('non-ok viewports emit no tasks (their failure rides the status field)', () => {
    const tasks = buildRepairTasks(
      [res({ desktop: { status: 'missing-replica', score: null } })],
      { floor: 0.99 },
    );
    expect(tasks).toEqual([]);
  });
});

describe('compare v2 — height-mismatch signal + padded diff + gate consts', () => {
  beforeEach(() => rmSync(TMP, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('scoreViewportPair: origin 1440×900 vs replica 1440×450 has status ok, originHeight 900, replicaHeight 450, heightMismatchRatio ~0.5', () => {
    const oPath = join(TMP, 'hm', 'origin.png');
    const rPath = join(TMP, 'hm', 'replica.png');
    writeSolidPng(oPath, 1440, 900, [50, 100, 150, 255]);
    writeSolidPng(rPath, 1440, 450, [50, 100, 150, 255]);
    const result = scoreViewportPair(oPath, rPath, 'desktop');
    expect(result.status).toBe('ok');
    expect(result.originHeight).toBe(900);
    expect(result.replicaHeight).toBe(450);
    expect(result.heightMismatchRatio).toBeCloseTo(0.5, 5);
  });

  it('scoreViewportPair: height-mismatched pair writes paddedDiffPath and the file exists', () => {
    const oPath = join(TMP, 'hm2', 'origin.png');
    const rPath = join(TMP, 'hm2', 'replica.png');
    const diffPath = join(TMP, 'hm2', 'out.diff.png');
    writeSolidPng(oPath, 1440, 900, [10, 20, 30, 255]);
    writeSolidPng(rPath, 1440, 450, [10, 20, 30, 255]);
    const result = scoreViewportPair(oPath, rPath, 'desktop', diffPath);
    expect(result.paddedDiffPath).toBe(join(TMP, 'hm2', 'out.padded.png'));
    expect(existsSync(result.paddedDiffPath!)).toBe(true);
    // The padded band (y > 450: origin content vs magenta fill) must register
    // as a diff — pixelmatch paints differing pixels red [255, 0, 0, 255].
    const padDiff = PNG.sync.read(readFileSync(result.paddedDiffPath!));
    expect(padDiff.height).toBe(900);
    const i = (700 * padDiff.width + 720) * 4; // pixel at (720, 700), inside the padded band
    const px = [padDiff.data[i], padDiff.data[i + 1], padDiff.data[i + 2], padDiff.data[i + 3]];
    expect(px).toEqual([255, 0, 0, 255]);
  });

  it('scoreViewportPair: a diffPath without the .diff.png suffix gets .padded.png APPENDED (never overwrites the crop diff)', () => {
    const oPath = join(TMP, 'hm3', 'origin.png');
    const rPath = join(TMP, 'hm3', 'replica.png');
    const diffPath = join(TMP, 'hm3', 'out.png');
    writeSolidPng(oPath, 1440, 900, [10, 20, 30, 255]);
    writeSolidPng(rPath, 1440, 450, [10, 20, 30, 255]);
    const result = scoreViewportPair(oPath, rPath, 'desktop', diffPath);
    expect(result.paddedDiffPath).toBe(join(TMP, 'hm3', 'out.png.padded.png'));
    expect(existsSync(diffPath)).toBe(true);
    expect(existsSync(result.paddedDiffPath!)).toBe(true);
    // Distinct files with distinct content: crop diff is 450px tall, padded diff 900px.
    expect(readFileSync(diffPath).equals(readFileSync(result.paddedDiffPath!))).toBe(false);
  });

  it('scoreViewportPair: identical origin vs itself has heightMismatchRatio 0 and paddedDiffPath undefined', () => {
    const oPath = join(TMP, 'same', 'origin.png');
    const diffPath = join(TMP, 'same', 'out.diff.png');
    writeSolidPng(oPath, 1440, 900, [80, 80, 80, 255]);
    const result = scoreViewportPair(oPath, oPath, 'desktop', diffPath);
    expect(result.heightMismatchRatio).toBe(0);
    expect(result.paddedDiffPath).toBeUndefined();
  });

  // (compareScreenshotDirs version:2 is asserted by the comparison.json test above)

  it('exported PARITY_GATE_SCORE === 0.995 and HEIGHT_MISMATCH_THRESHOLD === 0.02', () => {
    expect(PARITY_GATE_SCORE).toBe(0.995);
    expect(HEIGHT_MISMATCH_THRESHOLD).toBe(0.02);
  });
});

describe('fullPageScore — full-canvas score closes the top-viewport blind spot', () => {
  beforeEach(() => rmSync(TMP, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  /** Write a PNG split into a top band and a bottom band of different colors. */
  function writeTwoBandPng(path: string, w: number, h: number, splitY: number, top: [number, number, number, number], bottom: [number, number, number, number]) {
    const png = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
      const c = y < splitY ? top : bottom;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = c[3];
      }
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, PNG.sync.write(png));
  }

  it('equal-height identical pair: fullPageScore is 1.0 and equals the crop score', () => {
    const oPath = join(TMP, 'fp1', 'origin.png');
    const rPath = join(TMP, 'fp1', 'replica.png');
    writeSolidPng(oPath, 1440, 900, [42, 42, 42, 255]);
    writeSolidPng(rPath, 1440, 900, [42, 42, 42, 255]);
    const result = scoreViewportPair(oPath, rPath, 'desktop');
    expect(result.status).toBe('ok');
    expect(result.fullPageScore).toBe(1);
    expect(result.fullPageScore).toBe(result.score);
  });

  it('THE blind spot: pair differing ONLY below the 900px fold has crop score 1.0 BUT fullPageScore < 1', () => {
    const oPath = join(TMP, 'fp2', 'origin.png');
    const rPath = join(TMP, 'fp2', 'replica.png');
    // 1440×1800: identical top 900px, completely different bottom 900px.
    writeTwoBandPng(oPath, 1440, 1800, 900, [10, 20, 30, 255], [10, 20, 30, 255]);
    writeTwoBandPng(rPath, 1440, 1800, 900, [10, 20, 30, 255], [240, 240, 240, 255]);
    const result = scoreViewportPair(oPath, rPath, 'desktop');
    expect(result.status).toBe('ok');
    expect(result.score).toBe(1);                       // crop sees only the fold — blind
    expect(result.fullPageScore).toBeDefined();
    expect(result.fullPageScore!).toBeLessThan(1);      // full canvas sees the difference
    expect(result.fullPageScore!).toBeCloseTo(0.5, 2);  // ~half the canvas differs
  });

  it('mismatched-height pair: fullPageScore present, < 1 (padding penalty), and consistent with the padded artifact diffPixels', () => {
    const oPath = join(TMP, 'fp3', 'origin.png');
    const rPath = join(TMP, 'fp3', 'replica.png');
    const diffPath = join(TMP, 'fp3', 'out.diff.png');
    writeSolidPng(oPath, 1440, 900, [10, 20, 30, 255]);
    writeSolidPng(rPath, 1440, 450, [10, 20, 30, 255]);
    const result = scoreViewportPair(oPath, rPath, 'desktop', diffPath);
    expect(result.fullPageScore).toBeDefined();
    expect(result.fullPageScore!).toBeLessThan(1);
    // Consistency: the score must come from the SAME pixelmatch pass that
    // painted the padded artifact — red [255,0,0,255] pixels ARE diffPixels.
    const padDiff = PNG.sync.read(readFileSync(result.paddedDiffPath!));
    let red = 0;
    for (let i = 0; i < padDiff.width * padDiff.height; i++) {
      const o = i * 4;
      if (padDiff.data[o] === 255 && padDiff.data[o + 1] === 0 && padDiff.data[o + 2] === 0 && padDiff.data[o + 3] === 255) red++;
    }
    expect(result.fullPageScore!).toBeCloseTo(1 - red / (padDiff.width * padDiff.height), 10);
  });

  it('mismatched-height pair WITHOUT diffPath still computes fullPageScore (no artifact, null pixelmatch output)', () => {
    const oPath = join(TMP, 'fp4', 'origin.png');
    const rPath = join(TMP, 'fp4', 'replica.png');
    writeSolidPng(oPath, 1440, 900, [10, 20, 30, 255]);
    writeSolidPng(rPath, 1440, 450, [10, 20, 30, 255]);
    const result = scoreViewportPair(oPath, rPath, 'desktop');
    expect(result.paddedDiffPath).toBeUndefined();
    expect(result.fullPageScore).toBeDefined();
    expect(result.fullPageScore!).toBeLessThan(1);
    expect(result.fullPageScore!).toBeCloseTo(0.5, 2);  // magenta-padded half counts as diff
  });

  it('non-ok statuses omit fullPageScore', () => {
    const rPath = join(TMP, 'fp5', 'replica.png');
    writeSolidPng(rPath, 1440, 900, [1, 2, 3, 255]);
    const missing = scoreViewportPair(join(TMP, 'fp5', 'nope.png'), rPath, 'desktop');
    expect(missing.status).toBe('missing-origin');
    expect(missing.fullPageScore).toBeUndefined();
    const corrupt = join(TMP, 'fp5', 'corrupt.png');
    writeFileSync(corrupt, 'not a png');
    const decodeErr = scoreViewportPair(corrupt, rPath, 'desktop');
    expect(decodeErr.status).toBe('decode-error');
    expect(decodeErr.fullPageScore).toBeUndefined();
  });
});
