import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Browser-lifecycle behavior (timeouts, cache invalidation, bounded close)
// tested against fakes — the real-Chromium render path is covered in
// svg-raster.test.ts.
const { mockGetPlaywright } = vi.hoisted(() => ({ mockGetPlaywright: vi.fn() }));
vi.mock('../browser-kit/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../browser-kit/index.js')>();
  return { ...mod, getPlaywright: mockGetPlaywright };
});

// cwd-local tmp dir per repo guidance (no os.tmpdir, no output/ reads).
const TMP_ROOT = join(process.cwd(), '.tmp-test', 'svg-raster-lifecycle');
const SVG_PATH = join(TMP_ROOT, 'shape.svg');

// Fresh module per test — the rasterizer caches its browser at module level.
async function loadModule(): Promise<typeof import('./svg-raster.js')> {
  vi.resetModules();
  return await import('./svg-raster.js');
}

function fakeBrowser() {
  let connected = true;
  const page = {
    evaluate: vi.fn(async () => ({ loaded: true, w: 200, h: 100 })),
    setViewportSize: vi.fn(async () => {}),
    setContent: vi.fn(async () => {}),
    locator: vi.fn(() => ({
      screenshot: vi.fn(async ({ path }: { path: string }) => {
        writeFileSync(path, 'fake-png-bytes');
      }),
    })),
  };
  const context = {
    addInitScript: vi.fn(async () => {}),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  return {
    newContext: vi.fn(async () => {
      if (!connected) throw new Error('Browser has been closed');
      return context;
    }),
    close: vi.fn(async () => {
      connected = false;
    }),
    isConnected: () => connected,
    disconnect: () => {
      connected = false;
    },
    page,
    context,
  };
}

function stubLaunches(...browsers: unknown[]) {
  const launch = vi.fn();
  for (const b of browsers) {
    if (typeof b === 'function') launch.mockImplementationOnce(b as () => unknown);
    else launch.mockResolvedValueOnce(b);
  }
  mockGetPlaywright.mockResolvedValue({ chromium: { launch } });
  return launch;
}

beforeEach(() => {
  mockGetPlaywright.mockReset();
  mkdirSync(TMP_ROOT, { recursive: true });
  writeFileSync(SVG_PATH, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>');
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('rasterizeSvg browser lifecycle', () => {
  it('a render timeout drops the cached browser so the next call relaunches', async () => {
    vi.useFakeTimers();
    const { rasterizeSvg } = await loadModule();
    const b1 = fakeBrowser();
    b1.page.evaluate.mockReturnValue(new Promise(() => {}));
    const b2 = fakeBrowser();
    const launch = stubLaunches(b1, b2);

    const first = rasterizeSvg(SVG_PATH, join(TMP_ROOT, 'a.png'));
    await vi.advanceTimersByTimeAsync(60_000);
    const r1 = await first;
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain('timed out');
    await vi.advanceTimersByTimeAsync(0);
    expect(b1.close).toHaveBeenCalledTimes(1);

    const r2 = await rasterizeSvg(SVG_PATH, join(TMP_ROOT, 'b.png'));
    expect(r2.ok).toBe(true);
    expect(existsSync(join(TMP_ROOT, 'b.png'))).toBe(true);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(b1.close).toHaveBeenCalledTimes(1);
  });

  it('a hung launch times out and the late browser is closed exactly once', async () => {
    vi.useFakeTimers();
    const { rasterizeSvg, closeSvgRasterizer } = await loadModule();
    let resolveLaunch!: (b: unknown) => void;
    stubLaunches(() => new Promise((r) => { resolveLaunch = r; }));

    const first = rasterizeSvg(SVG_PATH, join(TMP_ROOT, 'c.png'));
    await vi.advanceTimersByTimeAsync(30_000);
    const r1 = await first;
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain('timed out');

    const b1 = fakeBrowser();
    resolveLaunch(b1);
    await vi.advanceTimersByTimeAsync(0);
    expect(b1.close).toHaveBeenCalledTimes(1);

    await closeSvgRasterizer();
    expect(b1.close).toHaveBeenCalledTimes(1);
  });

  it('a failure that killed the browser drops the cache so the next call relaunches', async () => {
    const { rasterizeSvg } = await loadModule();
    const b1 = fakeBrowser();
    b1.newContext.mockImplementation(async () => {
      b1.disconnect();
      throw new Error('Target closed');
    });
    const b2 = fakeBrowser();
    const launch = stubLaunches(b1, b2);

    const r1 = await rasterizeSvg(SVG_PATH, join(TMP_ROOT, 'd.png'));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain('Target closed');
    await new Promise((r) => setTimeout(r, 0));
    expect(b1.close).toHaveBeenCalledTimes(1);

    const r2 = await rasterizeSvg(SVG_PATH, join(TMP_ROOT, 'e.png'));
    expect(r2.ok).toBe(true);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('closeSvgRasterizer settles when the browser close hangs', async () => {
    vi.useFakeTimers();
    const { rasterizeSvg, closeSvgRasterizer } = await loadModule();
    const b1 = fakeBrowser();
    b1.close.mockReturnValue(new Promise(() => {}));
    stubLaunches(b1);

    expect((await rasterizeSvg(SVG_PATH, join(TMP_ROOT, 'f.png'))).ok).toBe(true);

    const closing = closeSvgRasterizer();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(closing).resolves.toBeUndefined();
    expect(b1.close).toHaveBeenCalledTimes(1);
  });

  it('closeSvgRasterizer settles while the launch itself hangs, then closes the late browser', async () => {
    vi.useFakeTimers();
    const { rasterizeSvg, closeSvgRasterizer } = await loadModule();
    let resolveLaunch!: (b: unknown) => void;
    stubLaunches(() => new Promise((r) => { resolveLaunch = r; }));

    const first = rasterizeSvg(SVG_PATH, join(TMP_ROOT, 'g.png'));
    const firstSettles = first.then((r) => {
      expect(r.ok).toBe(false);
    });
    const closing = closeSvgRasterizer();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(closing).resolves.toBeUndefined();

    const b1 = fakeBrowser();
    resolveLaunch(b1);
    await vi.advanceTimersByTimeAsync(0);
    expect(b1.close).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    await firstSettles;
    expect(b1.close).toHaveBeenCalledTimes(1);
  });
});
