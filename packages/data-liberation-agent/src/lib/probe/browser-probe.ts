import { getPlaywright } from '../browser-kit/index.js';

export interface ProbeResult {
  url: string;
  probedAt: string;
  globals: Record<string, { type: string; keys?: string[]; jsonSize?: number; length?: number; preview?: string; value?: unknown }>;
  jsonLd: unknown[];
  cookies: Array<{ name: string; domain: string; path: string; httpOnly: boolean; secure: boolean }>;
  localStorage: Record<string, { length: number; preview: string }>;
  networkEntries: Array<{ url: string; type: string; duration: number; size: number }>;
  identity: Record<string, unknown>;
}

/**
 * Connect to a browser via CDP and probe the active page for extraction-relevant data:
 * window globals, JSON-LD, cookies, localStorage, Performance API network entries,
 * and platform identity fields.
 */
export async function probeBrowser(cdpPort: number, siteUrl?: string): Promise<ProbeResult[]> {
  const pw = await getPlaywright();
  const browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);

  const results: ProbeResult[] = [];

  try {
    for (const context of browser.contexts()) {
      for (const rawPage of context.pages()) {
        const page = rawPage as {
          url(): string;
          evaluate(fn: () => unknown): Promise<unknown>;
          context(): { cookies(): Promise<Array<{ name: string; domain: string; path: string; httpOnly: boolean; secure: boolean; value: string }>> };
        };

        const pageUrl = page.url();

        // If a site URL is given, only probe pages on that domain
        if (siteUrl) {
          try {
            const targetHost = new URL(siteUrl).host;
            const pageHost = new URL(pageUrl).host;
            if (pageHost !== targetHost && !pageUrl.includes(targetHost)) continue;
          } catch { continue; }
        }

        // Skip browser internal pages
        if (pageUrl.startsWith('chrome://') || pageUrl.startsWith('about:') || pageUrl === 'about:blank') continue;

        try {
          const result = await probePage(page);
          results.push(result);
        } catch {
          // Page not accessible
        }
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

async function probePage(page: {
  url(): string;
  evaluate(fn: () => unknown): Promise<unknown>;
  context(): { cookies(): Promise<Array<{ name: string; domain: string; path: string; httpOnly: boolean; secure: boolean; value: string }>> };
}): Promise<ProbeResult> {
  const url = page.url();
  const result: ProbeResult = {
    url,
    probedAt: new Date().toISOString(),
    globals: {},
    jsonLd: [],
    cookies: [],
    localStorage: {},
    networkEntries: [],
    identity: {},
  };

  // 1. Window globals — platform-relevant prefixes
  result.globals = (await page.evaluate(() => {
    const found: Record<string, unknown> = {};
    const prefixes = ['__', '_wix', 'wix', 'Wix', '__NEXT', 'squarespace', 'Squarespace', '__SQS', 'Shopify', 'ShopifyAnalytics', 'webflow'];
    for (const key of Object.keys(window)) {
      if (!prefixes.some(p => key.startsWith(p))) continue;
      try {
        const val = (window as unknown as Record<string, unknown>)[key];
        const type = typeof val;
        if (type === 'function') {
          found[key] = { type: 'function', length: (val as Function).length };
        } else if (type === 'object' && val !== null) {
          const keys = Object.keys(val as object).slice(0, 30);
          const size = JSON.stringify(val).length;
          found[key] = { type: 'object', keys, jsonSize: size };
        } else if (type === 'string' && (val as string).length > 0) {
          found[key] = { type: 'string', length: (val as string).length, preview: (val as string).slice(0, 200) };
        } else {
          found[key] = { type, value: val };
        }
      } catch (e) {
        found[key] = { type: 'inaccessible', error: (e as Error).message };
      }
    }
    return found;
  })) as ProbeResult['globals'];

  // 2. JSON-LD structured data
  result.jsonLd = (await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map(s => { try { return JSON.parse(s.textContent || ''); } catch { return null; } })
      .filter(Boolean);
  })) as unknown[];

  // 3. Cookies (names and metadata only, not values)
  try {
    const allCookies = await page.context().cookies();
    result.cookies = allCookies.map(c => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
    }));
  } catch { /* cookies not accessible */ }

  // 4. localStorage
  result.localStorage = (await page.evaluate(() => {
    const items: Record<string, { length: number; preview: string }> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const val = localStorage.getItem(key) || '';
        items[key] = { length: val.length, preview: val.slice(0, 200) };
      }
    } catch { /* localStorage not accessible */ }
    return items;
  })) as ProbeResult['localStorage'];

  // 5. Performance API — API/resource network entries
  result.networkEntries = (await page.evaluate(() => {
    try {
      return performance.getEntriesByType('resource')
        .filter(e =>
          e.name.includes('_api') || e.name.includes('api/') ||
          e.name.includes('wixapis') || e.name.includes('squarespace') ||
          e.name.includes('cdn.shopify') || e.name.includes('webflow')
        )
        .map(e => ({
          url: e.name,
          type: (e as PerformanceResourceTiming).initiatorType,
          duration: Math.round(e.duration),
          size: (e as PerformanceResourceTiming).transferSize || 0,
        }));
    } catch { return []; }
  })) as ProbeResult['networkEntries'];

  // 6. Platform identity — probe known global locations
  result.identity = (await page.evaluate(() => {
    const id: Record<string, unknown> = {};
    const win = window as unknown as Record<string, unknown>;

    // Wix
    const wixBi = win.wixBiSession as Record<string, unknown> | undefined;
    if (wixBi) {
      if (wixBi.msid) id.wixMetaSiteId = wixBi.msid;
      if (wixBi.siteMemberId) id.wixSiteMemberId = wixBi.siteMemberId;
      if (wixBi.visitorId) id.wixVisitorId = wixBi.visitorId;
      if (wixBi.viewMode) id.wixViewMode = wixBi.viewMode;
    }

    // Squarespace
    const sqsConfig = win.Static as Record<string, unknown> | undefined;
    if (sqsConfig) {
      if (sqsConfig.SQUARESPACE_CONTEXT) {
        const ctx = sqsConfig.SQUARESPACE_CONTEXT as Record<string, unknown>;
        if (ctx.websiteId) id.squarespaceWebsiteId = ctx.websiteId;
        if (ctx.templateVersion) id.squarespaceVersion = ctx.templateVersion;
      }
    }

    // Shopify
    const shopify = win.Shopify as Record<string, unknown> | undefined;
    if (shopify) {
      if (shopify.shop) id.shopifyShop = shopify.shop;
      if (shopify.theme) id.shopifyTheme = (shopify.theme as Record<string, unknown>)?.name;
    }

    // URL params (metaSiteId etc.)
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of params.entries()) {
      if (k.toLowerCase().includes('siteid') || k.toLowerCase().includes('metasite')) {
        id[k] = v;
      }
    }

    return id;
  })) as Record<string, unknown>;

  return result;
}
