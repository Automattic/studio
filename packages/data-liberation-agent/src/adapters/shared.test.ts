import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ExtractionLog } from '../lib/resume-state/index.js';
import { WxrBuilder } from '../lib/wxr/index.js';
import { runExtractionLoop, stratifiedUrlSlice, navTargetInventoryUrls, type ExtractedPage } from './shared.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function makeWxr() {
  return new WxrBuilder({
    title: 'Test',
    url: 'https://example.com',
    description: '',
    language: 'en-US',
  });
}

function makePage(url: string, overrides: Partial<ExtractedPage> = {}): ExtractedPage {
  return {
    title: url.includes('/blog/') ? 'Hello' : 'About',
    slug: url.includes('/blog/') ? 'hello' : 'about',
    content: '<p>Content</p>',
    excerpt: '',
    date: '2026-04-30 12:00:00',
    seoTitle: '',
    seoDescription: '',
    mediaUrls: [],
    qualityScore: 'high',
    ...overrides,
  };
}

describe('stratifiedUrlSlice', () => {
  function u(type: string, n: number) {
    return { url: `https://x.com/${type}/${n}`, type };
  }

  it('returns everything when limit >= length', () => {
    const urls = [u('page', 1), u('product', 1)];
    expect(stratifiedUrlSlice(urls, 5)).toEqual(urls);
    expect(stratifiedUrlSlice(urls, 2)).toEqual(urls);
  });

  it('returns empty for limit 0 or negative', () => {
    expect(stratifiedUrlSlice([u('page', 1)], 0)).toEqual([]);
    expect(stratifiedUrlSlice([u('page', 1)], -1)).toEqual([]);
  });

  it('includes products even when pages sort first (the Shopify-store bug)', () => {
    // Mirrors the inventory ordering that broke the limited getsnooz run:
    // all /pages/* before any /products/*.
    const urls = [
      ...Array.from({ length: 30 }, (_, i) => u('page', i)),
      ...Array.from({ length: 20 }, (_, i) => u('product', i)),
    ];
    const sliced = stratifiedUrlSlice(urls, 20);
    expect(sliced).toHaveLength(20);
    const types = sliced.map((s) => s.type);
    expect(types).toContain('product');
    expect(types).toContain('page');
    // Round-robin gives roughly even representation across the two types.
    const productCount = types.filter((t) => t === 'product').length;
    expect(productCount).toBeGreaterThanOrEqual(8);
  });

  it('always puts the homepage first', () => {
    const urls = [
      u('page', 1),
      u('page', 2),
      { url: 'https://x.com/', type: 'homepage' },
      u('product', 1),
    ];
    const sliced = stratifiedUrlSlice(urls, 2);
    expect(sliced[0].type).toBe('homepage');
    expect(sliced).toHaveLength(2);
  });

  it('preserves relative order within a type bucket', () => {
    const urls = [
      u('product', 1),
      u('product', 2),
      u('product', 3),
      u('page', 1),
      u('page', 2),
    ];
    const sliced = stratifiedUrlSlice(urls, 4);
    const products = sliced.filter((s) => s.type === 'product').map((s) => s.url);
    // whatever subset is taken, it must be a prefix of the original product order
    expect(products).toEqual(['https://x.com/product/1', 'https://x.com/product/2'].slice(0, products.length));
  });

  it('returns exactly min(limit, length) entries', () => {
    const urls = [u('page', 1), u('product', 1), u('post', 1), u('product', 2)];
    expect(stratifiedUrlSlice(urls, 3)).toHaveLength(3);
  });

  it('pins primary-nav-target URLs even when the cap would drop them', () => {
    // 30 pages + 20 products; the nav points at the 25th page, which a naive
    // round-robin slice under limit 6 would never reach.
    const pages = Array.from({ length: 30 }, (_, i) => u('page', i));
    const products = Array.from({ length: 20 }, (_, i) => u('product', i));
    const navTarget = pages[25].url; // https://x.com/page/25
    const sliced = stratifiedUrlSlice([...pages, ...products], 6, new Set([navTarget]));
    expect(sliced).toHaveLength(6);
    expect(sliced.map((s) => s.url)).toContain(navTarget);
  });

  it('does not double-count a pinned URL', () => {
    const pages = Array.from({ length: 10 }, (_, i) => u('page', i));
    const pinned = new Set([pages[0].url, pages[5].url]);
    const sliced = stratifiedUrlSlice(pages, 4, pinned);
    expect(sliced).toHaveLength(4);
    expect(new Set(sliced.map((s) => s.url)).size).toBe(4); // all unique
    expect(sliced.map((s) => s.url)).toContain(pages[0].url);
    expect(sliced.map((s) => s.url)).toContain(pages[5].url);
  });
});

describe('navTargetInventoryUrls', () => {
  const inventory = [
    { url: 'https://getsnooz.com/pages/shop-all' },
    { url: 'https://getsnooz.com/pages/sleep-bundle' },
    { url: 'https://getsnooz.com/pages/about-us' },
    { url: 'https://getsnooz.com/products/snooz-original' },
  ];

  it('matches absolutized nav hrefs to inventory URLs by pathname', () => {
    const nav = [
      { text: 'Shop', href: 'https://getsnooz.com/pages/shop-all' },
      { text: 'About', href: 'https://getsnooz.com/pages/about-us' },
    ];
    const pinned = navTargetInventoryUrls(nav, inventory);
    expect(pinned).toContain('https://getsnooz.com/pages/shop-all');
    expect(pinned).toContain('https://getsnooz.com/pages/about-us');
    expect(pinned.size).toBe(2);
  });

  it('ignores trailing slash differences', () => {
    const nav = [{ text: 'Shop', href: 'https://getsnooz.com/pages/shop-all/' }];
    const pinned = navTargetInventoryUrls(nav, inventory);
    expect(pinned).toContain('https://getsnooz.com/pages/shop-all');
  });

  it('does not pin off-site nav links', () => {
    const nav = [{ text: 'Support', href: 'https://snooz.zendesk.com/hc/en-us' }];
    expect(navTargetInventoryUrls(nav, inventory).size).toBe(0);
  });

  it('returns empty for empty navigation', () => {
    expect(navTargetInventoryUrls([], inventory).size).toBe(0);
  });
});

describe('runExtractionLoop streaming callback', () => {
  it('emits each extracted URL with the WXR items created for that URL', async () => {
    const outputDir = mkdtempSync(join(FIXTURE_TMP, 'shared-cb-'));
    try {
      const wxr = makeWxr();
      const log = new ExtractionLog(outputDir);
      const onPageExtracted = vi.fn();
      const extractPage = vi.fn((url: string) => Promise.resolve(makePage(url)));

      const result = await runExtractionLoop({
        urls: [
          { url: 'https://example.com/about', type: 'page' },
          { url: 'https://example.com/blog/hello', type: 'post' },
        ],
        navigation: [],
        wxr,
        log,
        outputDir,
        delay: 0,
        dryRun: false,
        resume: false,
        extractPage,
        onPageExtracted,
      });

      expect(result.pagesExtracted).toBe(1);
      expect(result.postsExtracted).toBe(1);
      expect(extractPage).toHaveBeenCalledTimes(2);
      expect(onPageExtracted).toHaveBeenCalledTimes(2);
      expect(onPageExtracted.mock.calls[0][0]).toMatchObject({
        url: 'https://example.com/about',
        slug: 'about',
        type: 'page',
      });
      expect(onPageExtracted.mock.calls[0][0].items.map((item: { type: string }) => item.type)).toEqual(['page']);
      expect(onPageExtracted.mock.calls[1][0]).toMatchObject({
        url: 'https://example.com/blog/hello',
        slug: 'hello',
        type: 'post',
      });
      expect(onPageExtracted.mock.calls[1][0].items.map((item: { type: string }) => item.type)).toEqual(['post']);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('runExtractionLoop watchdog cleanup', () => {
  it('lets onExtractTimeout swap shared state so a late mutation cannot touch the next URL', async () => {
    const outputDir = mkdtempSync(join(FIXTURE_TMP, 'shared-watchdog-'));
    try {
      const wxr = makeWxr();
      const log = new ExtractionLog(outputDir);

      // Stands in for the Playwright page adapters reuse across URLs.
      let resource = { writes: [] as string[] };
      const abandonedResource = resource;

      let lateMutate!: () => void;
      const extractPage = (url: string) => {
        const mine = resource; // captured like the wix extractPage closure captures the page
        if (url.endsWith('/a')) {
          // Never settles — the watchdog abandons it, then it "completes" late.
          return new Promise<ExtractedPage>(() => {
            lateMutate = () => { mine.writes.push('late write from a'); };
          });
        }
        mine.writes.push(`extract ${url}`);
        return Promise.resolve(makePage(url));
      };

      const onExtractTimeout = vi.fn(async () => {
        resource = { writes: [] };
      });

      const result = await runExtractionLoop({
        urls: [
          { url: 'https://example.com/a', type: 'page' },
          { url: 'https://example.com/b', type: 'page' },
        ],
        navigation: [],
        wxr,
        log,
        outputDir,
        // delay 500 keeps page concurrency at 1 so /a and /b are separate
        // batches; the max cap keeps the post-error inter-batch sleep short.
        delay: 500,
        tunerConfig: { pageDelayMax: 500 },
        dryRun: false,
        resume: false,
        extractPage,
        extractTimeoutMs: 50,
        onExtractTimeout,
      });

      // Simulate the abandoned extraction finishing after the loop moved on.
      lateMutate();

      expect(result.failed).toBe(1);
      expect(result.pagesExtracted).toBe(1);
      expect(onExtractTimeout).toHaveBeenCalledTimes(1);
      // The late write landed only on the abandoned resource...
      expect(abandonedResource.writes).toEqual(['late write from a']);
      // ...and /b ran against the fresh resource, untouched by /a.
      expect(resource.writes).toEqual(['extract https://example.com/b']);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('does not call onExtractTimeout for an ordinary extractPage failure', async () => {
    const outputDir = mkdtempSync(join(FIXTURE_TMP, 'shared-watchdog-err-'));
    try {
      const wxr = makeWxr();
      const log = new ExtractionLog(outputDir);
      const onExtractTimeout = vi.fn(async () => {});

      const result = await runExtractionLoop({
        urls: [{ url: 'https://example.com/broken', type: 'page' }],
        navigation: [],
        wxr,
        log,
        outputDir,
        delay: 0,
        dryRun: false,
        resume: false,
        extractPage: () => Promise.reject(new Error('adapter blew up')),
        extractTimeoutMs: 50,
        onExtractTimeout,
      });

      expect(result.failed).toBe(1);
      expect(onExtractTimeout).not.toHaveBeenCalled();
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('runExtractionLoop page concurrency cap', () => {
  function makeTrackingExtractPage() {
    let inFlight = 0;
    let peak = 0;
    const extractPage = async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return makePage(url);
    };
    return { extractPage, getPeak: () => peak };
  }

  const urls = Array.from({ length: 6 }, (_, i) => ({
    url: `https://example.com/p${i}`,
    type: 'page',
  }));

  it('batches more than 1 when the tuner delay is low and no cap is set', async () => {
    const outputDir = mkdtempSync(join(FIXTURE_TMP, 'shared-nocap-'));
    try {
      const { extractPage, getPeak } = makeTrackingExtractPage();
      await runExtractionLoop({
        urls,
        navigation: [],
        wxr: makeWxr(),
        log: new ExtractionLog(outputDir),
        outputDir,
        delay: 0,
        dryRun: false,
        resume: false,
        extractPage,
      });
      expect(getPeak()).toBeGreaterThan(1);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('keeps batches at 1 with maxPageConcurrency: 1 even when the tuner would batch more', async () => {
    const outputDir = mkdtempSync(join(FIXTURE_TMP, 'shared-cap-'));
    try {
      const { extractPage, getPeak } = makeTrackingExtractPage();
      await runExtractionLoop({
        urls,
        navigation: [],
        wxr: makeWxr(),
        log: new ExtractionLog(outputDir),
        outputDir,
        delay: 0,
        dryRun: false,
        resume: false,
        maxPageConcurrency: 1,
        extractPage,
      });
      expect(getPeak()).toBe(1);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('runExtractionLoop source-faithful slugs + redirect map', () => {
  it('uses the LAST path segment for the WXR post_name and a /slug/ redirect target', async () => {
    const outputDir = mkdtempSync(join(FIXTURE_TMP, 'shared-slug-'));
    try {
      const wxr = makeWxr();
      const log = new ExtractionLog(outputDir);
      // Adapter returns the mangled `slugify` slug (manifest filename
      // convention). The loop must override the WXR slug with the last segment.
      const extractPage = (url: string) =>
        Promise.resolve(
          makePage(url, {
            title: 'About',
            // Simulate slugify(url) = `--`-joined path.
            slug: new URL(url).pathname.replace(/^\//, '').replace(/\//g, '--') || 'homepage',
          }),
        );

      await runExtractionLoop({
        urls: [
          { url: 'https://getsnooz.com/pages/about-us', type: 'page' },
          { url: 'https://getsnooz.com/pages/shop-all', type: 'page' },
        ],
        navigation: [],
        wxr,
        log,
        outputDir,
        delay: 0,
        dryRun: false,
        resume: false,
        extractPage,
      });

      const pages = wxr.items.filter((i) => i.type === 'page');
      expect(pages.map((p) => p.slug).sort()).toEqual(['about-us', 'shop-all']);

      // Redirect map: source path → local pretty permalink (/slug/).
      const redirects = wxr.redirects;
      expect(redirects).toContainEqual({ from: '/pages/about-us', to: '/about-us/' });
      expect(redirects).toContainEqual({ from: '/pages/shop-all', to: '/shop-all/' });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('collision-suffixes duplicate last-segment slugs', async () => {
    const outputDir = mkdtempSync(join(FIXTURE_TMP, 'shared-collide-'));
    try {
      const wxr = makeWxr();
      const log = new ExtractionLog(outputDir);
      const extractPage = (url: string) => Promise.resolve(makePage(url, { slug: 'x' }));

      await runExtractionLoop({
        urls: [
          { url: 'https://x.com/a/contact', type: 'page' },
          { url: 'https://x.com/b/contact', type: 'page' },
        ],
        navigation: [],
        wxr,
        log,
        outputDir,
        delay: 0,
        dryRun: false,
        resume: false,
        extractPage,
      });

      const slugs = wxr.items.filter((i) => i.type === 'page').map((p) => p.slug);
      expect(slugs).toEqual(['contact', 'contact-2']);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('keeps the adapter (manifest) slug in the onPageExtracted callback', async () => {
    const outputDir = mkdtempSync(join(FIXTURE_TMP, 'shared-cb-slug-'));
    try {
      const wxr = makeWxr();
      const log = new ExtractionLog(outputDir);
      const onPageExtracted = vi.fn();
      // Adapter slug = `--`-joined manifest filename convention.
      const extractPage = (url: string) =>
        Promise.resolve(makePage(url, { slug: 'pages--about-us' }));

      await runExtractionLoop({
        urls: [{ url: 'https://getsnooz.com/pages/about-us', type: 'page' }],
        navigation: [],
        wxr,
        log,
        outputDir,
        delay: 0,
        dryRun: false,
        resume: false,
        extractPage,
        onPageExtracted,
      });

      // Callback slug stays the screenshot/manifest slug (used to join back to
      // html/<slug>.html + screenshots/.../<slug>.png) — NOT the WXR post_name.
      expect(onPageExtracted.mock.calls[0][0].slug).toBe('pages--about-us');
      // But the WXR post_name is source-faithful.
      expect(wxr.items.find((i) => i.type === 'page')?.slug).toBe('about-us');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
