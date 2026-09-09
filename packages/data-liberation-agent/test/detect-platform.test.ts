import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { findAdapter } from '../src/adapters/index.js';
import { detectFromUrl, detectFromHttp } from '../src/lib/detect-platform/index.js';

describe('detectFromUrl (heuristics)', () => {
  // Every URL pattern the table claims, asserted against the one detector that
  // owns them. Adapters used to carry a duplicate copy of these regexes behind
  // an uncalled `PlatformAdapter.detect`; this is where that coverage lives now.
  it.each([
    ['https://mysite.wixsite.com/blog', 'wix'],
    ['https://www.wix.com/mysite', 'wix'],
    ['https://mysite.squarespace.com', 'squarespace'],
    ['https://www.squarespace.com/mysite', 'squarespace'],
    ['https://mysite.webflow.io', 'webflow'],
    ['https://example.webflow.io/blog', 'webflow'],
    ['https://webflow.com', 'webflow'],
    ['https://www.webflow.com/made-in-webflow', 'webflow'],
    ['https://mystore.myshopify.com', 'shopify'],
    ['https://mystore.myshopify.com/blogs/news', 'shopify'],
    ['https://shopify.com', 'shopify'],
    ['https://www.shopify.com/something', 'shopify'],
    ['https://mysite.weebly.com', 'weebly'],
  ])('detects %s as %s', (url, platform) => {
    const detected = detectFromUrl(url);
    expect(detected).toBe(platform);
    expect(findAdapter(detected!)).toMatchObject({ id: platform });
  });

  // Platforms that serve custom domains carry no URL signal at all, so the URL
  // tier must decline rather than guess. GoDaddy W+M is the sharp case: these
  // are real W+M sites, identified later by header and source signals.
  it.each([
    'https://www.mybusiness.com',
    'https://skywaydiner.com',
    'https://cruisewarehouse.com',
  ])('returns null for the custom domain %s', (url) => {
    expect(detectFromUrl(url)).toBeNull();
    expect(findAdapter('unknown')).toMatchObject({ id: 'default' });
  });

  it('handles URLs without protocol', () => {
    expect(detectFromUrl('mysite.wixsite.com/blog')).toBe('wix');
  });
});

describe('detectFromHttp (fingerprinting)', () => {
  it('detects Wix from X-Wix-Request-Id header', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['x-wix-request-id', 'abc123']]),
      text: () => Promise.resolve('<html></html>'),
    });
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('wix');
    expect(result.confidence).toBe('high');
    expect(result.signals).toContain('X-Wix-Request-Id header');
  });

  it('detects Squarespace from X-ServedBy header', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['x-servedby', 'squarespace']]),
      text: () => Promise.resolve('<html></html>'),
    });
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('squarespace');
  });

  it('returns unknown for unrecognized sites', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      text: () => Promise.resolve('<html><body>Hello</body></html>'),
    });
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('unknown');
    expect(result.confidence).toBe('low');
  });

  it('handles fetch failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('unknown');
    expect(result.confidence).toBe('low');
  });

  it('detects GoDaddy Websites & Marketing from generator meta in page source', async () => {
    const html = readFileSync('test/fixtures/godaddy-wm-blog-post.html', 'utf8');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map(),
      text: () => Promise.resolve(html),
    });
    const result = await detectFromHttp('https://cruisewarehouse.com');
    expect(result.platform).toBe('godaddy-wm');
    expect(result.signals.some((s) => /generator meta|isteam/i.test(s))).toBe(true);
  });

  it('detects GoDaddy Websites & Marketing from X-SiteId header', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['x-siteid', 'us-west-2']]),
      text: () => Promise.resolve('<html></html>'),
    });
    const result = await detectFromHttp('https://skywaydiner.com');
    expect(result.platform).toBe('godaddy-wm');
    expect(result.confidence).toBe('high');
  });
});

// Path probes are declared by the platform that owns them (Platform.detection.
// pathProbes) and consumed by the shared detection engine — these tests
// register probe-carrying platforms exactly the way a third-party consumer
// would, without editing any core table. Each test gets a FRESH module registry
// (the moral equivalent of the old `PATH_PROBES.length = 0` afterEach) so
// one test's probe platform can never cross-match another's probe mocks.
describe('platform-owned path probes', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const freshRegistry = async () => {
    const { registerPlatform } = await import('../src/platform/registry.js');
    return registerPlatform;
  };
  const freshDetect = async () => {
    const { detectFromHttp } = await import('../src/lib/detect-platform/index.js');
    return detectFromHttp;
  };

  const probePlatform = async (
    id: string,
    probe: { path: string; expectedStatus: number[]; locationContains?: string; signal: string },
  ) => {
    const registerPlatform = await freshRegistry();
    registerPlatform({
      id,
      discover: async () => ({}),
      detection: { pathProbes: [probe] },
    });
  };

  it('matches a path probe when source signals fail (status only)', async () => {
    await probePlatform('probe-status-only', {
      path: '/_test/admin',
      expectedStatus: [302, 401],
      signal: '/_test/admin probe',
    });

    // Mock chain: first fetch (homepage) returns generic HTML (forces probe),
    // second fetch (probe HEAD) returns 302.
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map(),
        text: () => Promise.resolve('<html><body>Generic</body></html>'),
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: new Map([['location', 'https://example.com/_test/admin/login']]),
      });

    const detectFromHttp = await freshDetect();
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('probe-status-only');
    expect(result.confidence).toBe('high');
    expect(result.signals).toContain('/_test/admin probe');
  });

  it('does NOT match when probe returns wrong status', async () => {
    await probePlatform('probe-wrong-status', {
      path: '/_test/admin',
      expectedStatus: [302, 401],
      signal: '/_test/admin probe',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map(),
        text: () => Promise.resolve('<html></html>'),
      })
      .mockResolvedValueOnce({
        status: 404,  // Wrong status
        headers: new Map(),
      });

    const detectFromHttp = await freshDetect();
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('unknown');
  });

  it('matches when Location header contains expected substring', async () => {
    await probePlatform('probe-location-match', {
      path: '/_test/admin',
      expectedStatus: [302],
      locationContains: '/_test/admin/login',
      signal: '/_test/admin probe with location check',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map(),
        text: () => Promise.resolve('<html></html>'),
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: new Map([['location', 'https://example.com/_test/admin/login?redirect=%2F_test%2Fadmin']]),
      });

    const detectFromHttp = await freshDetect();
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('probe-location-match');
  });

  it('does NOT match when Location header lacks expected substring', async () => {
    await probePlatform('probe-location-mismatch', {
      path: '/_test/admin',
      expectedStatus: [302],
      locationContains: '/_test/admin/login',
      signal: '/_test/admin probe with location check',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map(),
        text: () => Promise.resolve('<html></html>'),
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: new Map([['location', 'https://example.com/somewhere-else']]),  // Wrong location
      });

    const detectFromHttp = await freshDetect();
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('unknown');  // Status matched but Location didn't
  });

  it('does NOT match when Location header is missing entirely', async () => {
    await probePlatform('probe-location-missing', {
      path: '/_test/admin',
      expectedStatus: [302],
      locationContains: '/_test/admin/login',
      signal: '/_test/admin probe with location check',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map(),
        text: () => Promise.resolve('<html></html>'),
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: new Map(),  // No Location header
      });

    const detectFromHttp = await freshDetect();
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('unknown');
  });

  it('skips probes when source signals already identified the platform', async () => {
    await probePlatform('probe-gated-by-source', {
      path: '/_test/admin',
      expectedStatus: [302],
      signal: '/_test/admin probe',
    });

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      headers: new Map(),
      // HTML matches Wix's source signal (wixstatic.com). Wix wins on tier 3,
      // so the probe should never fire.
      text: () => Promise.resolve('<html><img src="https://static.wixstatic.com/media/x.jpg"></html>'),
    });
    global.fetch = fetchMock;

    const detectFromHttp = await freshDetect();
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('wix');
    // Critical: only ONE fetch call (the homepage). Probe never fired.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips probes when HTTP signals already identified the platform', async () => {
    await probePlatform('probe-gated-by-header', {
      path: '/_test/admin',
      expectedStatus: [302],
      signal: '/_test/admin probe',
    });

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      headers: new Map([['x-wix-request-id', 'abc123']]),  // Header-signal match
      text: () => Promise.resolve('<html></html>'),
    });
    global.fetch = fetchMock;

    const detectFromHttp = await freshDetect();
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('wix');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips probe when path resolves to a different origin', async () => {
    await probePlatform('probe-cross-origin', {
      path: '//attacker.example/admin',  // Protocol-relative — would resolve to attacker.example
      expectedStatus: [302],
      signal: '/_test/admin probe',
    });

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      headers: new Map(),
      text: () => Promise.resolve('<html></html>'),
    });
    global.fetch = fetchMock;

    const detectFromHttp = await freshDetect();
    const result = await detectFromHttp('https://example.com');
    expect(result.platform).toBe('unknown');
    // Critical: only ONE fetch call (the homepage). Cross-origin probe never fired.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still runs probe tier when homepage body read throws', async () => {
    await probePlatform('probe-body-read-failure', {
      path: '/_test/admin',
      expectedStatus: [302],
      signal: '/_test/admin probe',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Map(),
        // Body read throws (e.g. truncated stream)
        text: () => Promise.reject(new Error('truncated')),
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: new Map([['location', 'https://example.com/_test/admin/login']]),
      });

    const detectFromHttp = await freshDetect();
    const result = await detectFromHttp('https://example.com');
    // Probe tier runs despite body read failure, identifies platform
    expect(result.platform).toBe('probe-body-read-failure');
    expect(result.confidence).toBe('high');
  });
});
