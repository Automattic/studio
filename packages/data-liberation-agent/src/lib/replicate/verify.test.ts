import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

// Mock Playwright connectBrowser to avoid launching a real browser.
const screenshotMock = vi.fn().mockResolvedValue(undefined);
const gotoMock = vi.fn().mockResolvedValue({ status: () => 200 });
const SECTION_MEASURES = [
  { columnCount: 3, bg: 'rgb(204, 198, 198)', hasMedia: true },
  { columnCount: 1, bg: 'rgb(255, 255, 255)', hasMedia: false },
];
// One mock backs both in-page reads (page.evaluate). Distinguish them by the
// evaluated function's name so the desktop section read can be counted
// independently of the mobile content-past-fold read: the section read returns
// the per-section measures, the past-fold read returns a leaf count.
const evaluateMock = vi.fn(async (fn: unknown) => {
  if (typeof fn === 'function' && fn.name === 'measureContentPastFoldInBrowser') return 0;
  return SECTION_MEASURES;
});
const newPageMock = vi.fn(async () => ({
  goto: gotoMock,
  waitForLoadState: vi.fn().mockResolvedValue(undefined),
  screenshot: screenshotMock,
  evaluate: evaluateMock,
  close: vi.fn().mockResolvedValue(undefined),
}));

const addInitScriptMock = vi.fn().mockResolvedValue(undefined);
// connectBrowser now lives in browser-kit; mock it there.
vi.mock('../browser-kit/index.js', () => ({
  connectBrowser: vi.fn(async () => ({
    newContext: vi.fn(async () => ({
      on: vi.fn(),
      addInitScript: addInitScriptMock,
      newPage: newPageMock,
      close: vi.fn().mockResolvedValue(undefined),
    })),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { verifyReplica } from './verify.js';

function setupFixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(FIXTURE_TMP, 'verify-'));
  // minimal manifest with two URLs, both viewports
  mkdirSync(join(dir, 'screenshots', 'desktop'), { recursive: true });
  mkdirSync(join(dir, 'screenshots', 'mobile'), { recursive: true });
  const manifest = {
    version: 1,
    entries: {
      'https://example.com/': {
        slug: 'homepage',
        desktop: 'screenshots/desktop/homepage.png',
        mobile: 'screenshots/mobile/homepage.png',
        html: 'html/homepage.html',
      },
      'https://example.com/about/': {
        slug: 'about',
        desktop: 'screenshots/desktop/about.png',
        mobile: 'screenshots/mobile/about.png',
        html: 'html/about.html',
      },
    },
  };
  writeFileSync(join(dir, 'screenshots', 'manifest.json'), JSON.stringify(manifest));
  for (const vp of ['desktop', 'mobile']) {
    writeFileSync(join(dir, 'screenshots', vp, 'homepage.png'), 'png');
    writeFileSync(join(dir, 'screenshots', vp, 'about.png'), 'png');
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('verifyReplica', () => {
  it('captures desktop + mobile screenshots and pairs each to its source manifest viewport', async () => {
    const { dir, cleanup } = setupFixture();
    try {
      screenshotMock.mockClear();
      gotoMock.mockClear();
      evaluateMock.mockClear();
      const result = await verifyReplica({
        outputDir: dir,
        replicaBaseUrl: 'http://localhost:8881',
        urls: ['/', '/about/'],
      });

      expect(result.ok).toBe(true);
      expect(result.pairs).toHaveLength(2);

      // Each URL has 2 captures (desktop + mobile)
      for (const pair of result.pairs) {
        expect(pair.captures).toHaveLength(2);
        const [desktop, mobile] = pair.captures;
        expect(desktop.viewport).toBe('desktop');
        expect(desktop.replicaScreenshot.startsWith('replica-screenshots/desktop/')).toBe(true);
        expect(desktop.sourceScreenshot?.startsWith('screenshots/desktop/')).toBe(true);
        expect(mobile.viewport).toBe('mobile');
        expect(mobile.replicaScreenshot.startsWith('replica-screenshots/mobile/')).toBe(true);
        expect(mobile.sourceScreenshot?.startsWith('screenshots/mobile/')).toBe(true);
        // Per-section DOM metrics are read once (desktop) and attached to the pair.
        expect(pair.sections).toEqual(SECTION_MEASURES);
      }
      // The section read runs only at desktop — once per URL, not per viewport
      // (the mobile content-past-fold read is a separate page.evaluate call).
      const sectionReads = evaluateMock.mock.calls.filter(
        ([fn]) => typeof fn === 'function' && fn.name === 'measureReplicaSectionsInBrowser',
      );
      expect(sectionReads).toHaveLength(2);

      // Replica viewport directories were created
      expect(existsSync(join(dir, 'replica-screenshots', 'desktop'))).toBe(true);
      expect(existsSync(join(dir, 'replica-screenshots', 'mobile'))).toBe(true);

      expect(result.unmatchedUrls).toEqual([]);
      // 2 URLs × 2 viewports = 4 navigations + 4 screenshots
      expect(gotoMock).toHaveBeenCalledTimes(4);
      expect(screenshotMock).toHaveBeenCalledTimes(4);
    } finally {
      cleanup();
    }
  });

  it('captures pages concurrently (bounded) and preserves input order', async () => {
    const { dir, cleanup } = setupFixture();
    try {
      gotoMock.mockClear();
      let inflight = 0;
      let maxInflight = 0;
      gotoMock.mockImplementation(async () => {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 10));
        inflight -= 1;
        return { status: () => 200 };
      });
      // 3 URLs, desktop only, concurrency 2 → at least 2 navigations overlap.
      const result = await verifyReplica({
        outputDir: dir,
        replicaBaseUrl: 'http://localhost:8881',
        urls: ['/', '/about', '/contact'],
        viewports: ['desktop'],
        concurrency: 2,
      });
      expect(maxInflight).toBeGreaterThan(1); // ran in parallel, not one-at-a-time
      expect(maxInflight).toBeLessThanOrEqual(2); // bounded by the cap
      // Results stay in input order regardless of which finished first.
      expect(result.pairs.map((p) => p.urlPath)).toEqual(['/', '/about', '/contact']);
    } finally {
      gotoMock.mockReset();
      gotoMock.mockResolvedValue({ status: () => 200 });
      cleanup();
    }
  });

  it('injects the __name polyfill so serialized in-browser functions run (regression: __name is not defined)', async () => {
    const { dir, cleanup } = setupFixture();
    try {
      addInitScriptMock.mockClear();
      await verifyReplica({
        outputDir: dir,
        replicaBaseUrl: 'http://localhost:8881',
        urls: ['/'],
        viewports: ['desktop'],
      });
      expect(addInitScriptMock).toHaveBeenCalled();
      const injected = addInitScriptMock.mock.calls.map((c) => String(c[0])).join('\n');
      expect(injected).toContain('__name');
    } finally {
      cleanup();
    }
  });

  it('honors a custom viewports list (desktop only)', async () => {
    const { dir, cleanup } = setupFixture();
    try {
      gotoMock.mockClear();
      screenshotMock.mockClear();
      const result = await verifyReplica({
        outputDir: dir,
        replicaBaseUrl: 'http://localhost:8881',
        urls: ['/'],
        viewports: ['desktop'],
      });
      expect(result.pairs[0].captures).toHaveLength(1);
      expect(result.pairs[0].captures[0].viewport).toBe('desktop');
      expect(gotoMock).toHaveBeenCalledTimes(1);
      expect(screenshotMock).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it('flags URLs that have no source manifest entry', async () => {
    const { dir, cleanup } = setupFixture();
    try {
      const result = await verifyReplica({
        outputDir: dir,
        replicaBaseUrl: 'http://localhost:8881',
        urls: ['/never-extracted'],
      });
      // Each viewport's sourceScreenshot is null when no manifest entry
      for (const cap of result.pairs[0].captures) {
        expect(cap.sourceScreenshot).toBeNull();
      }
      expect(result.unmatchedUrls).toContain('/never-extracted');
      // Replica screenshots are still attempted
      expect(result.pairs[0].captures[0].replicaScreenshot).toBe(
        'replica-screenshots/desktop/never-extracted.png',
      );
    } finally {
      cleanup();
    }
  });

  it('returns ok=false but does not throw when navigation fails on one viewport', async () => {
    const { dir, cleanup } = setupFixture();
    try {
      gotoMock.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'));
      const result = await verifyReplica({
        outputDir: dir,
        replicaBaseUrl: 'http://localhost:8881',
        urls: ['/'],
      });
      expect(result.ok).toBe(false);
      // First viewport (desktop) failed; second (mobile) succeeded.
      const desktopCap = result.pairs[0].captures.find((c) => c.viewport === 'desktop');
      expect(desktopCap?.errors[0]).toContain('ERR_CONNECTION_REFUSED');
      const mobileCap = result.pairs[0].captures.find((c) => c.viewport === 'mobile');
      expect(mobileCap?.errors).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('returns failure result when browser cannot launch', async () => {
    const { dir, cleanup } = setupFixture();
    try {
      const bk = await import('../browser-kit/index.js');
      const original = bk.connectBrowser;
      (bk.connectBrowser as unknown as ReturnType<typeof vi.fn>) = vi
        .fn()
        .mockRejectedValueOnce(new Error('no chromium'));
      try {
        const result = await verifyReplica({
          outputDir: dir,
          replicaBaseUrl: 'http://localhost:8881',
          urls: ['/'],
        });
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain('Browser launch failed');
      } finally {
        (bk.connectBrowser as unknown as typeof original) = original;
      }
    } finally {
      cleanup();
    }
  });
});
