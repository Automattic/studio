import { getPlaywright } from '../browser-kit/index.js';

export interface ApiEndpoint {
  path: string;
  methods: string[];
  statuses: number[];
  sections: string[];
  queryParams: string[];
  callCount: number;
  sampleRequestHeaders: Record<string, string> | null;
  samplePostData: string | null;
  sampleResponsePreview: unknown;
}

export interface ApiMapResult {
  url: string;
  mappedAt: string;
  totalApiCalls: number;
  totalEndpoints: number;
  endpoints: ApiEndpoint[];
  categories: Record<string, ApiEndpoint[]>;
  authHeaders: string[];
}

interface RawApiCall {
  section: string;
  method: string;
  url: string;
  status: number | undefined;
  mimeType: string | undefined;
  requestHeaders: Record<string, string>;
  postData: string | null;
  responseBody: unknown;
}

function tryParseJSON(str: string): unknown {
  try { return JSON.parse(str); } catch { return str; }
}

/** Truncate a response body to a reasonable preview size. */
function previewResponse(body: unknown): unknown {
  if (!body) return null;
  const str = typeof body === 'string' ? body : JSON.stringify(body);
  if (str.length <= 2000) return body;
  // Return the first level of keys + types for large objects
  if (typeof body === 'object' && !Array.isArray(body)) {
    const preview: Record<string, string> = { _truncated: `${str.length} bytes` };
    for (const [key, val] of Object.entries(body as Record<string, unknown>)) {
      if (Array.isArray(val)) preview[key] = `Array(${val.length})`;
      else if (val && typeof val === 'object') preview[key] = `Object(${Object.keys(val).length} keys)`;
      else preview[key] = typeof val;
    }
    return preview;
  }
  return { _truncated: `${str.length} bytes` };
}

function categorizeEndpoint(path: string): string {
  const p = path.toLowerCase();
  if (p.includes('blog') || p.includes('media') || p.includes('page') || p.includes('content') ||
      p.includes('cms') || p.includes('post') || p.includes('article') || p.includes('collection')) {
    return 'Content';
  }
  if (p.includes('site') || p.includes('settings') || p.includes('config') ||
      p.includes('properties') || p.includes('domain') || p.includes('seo') || p.includes('theme')) {
    return 'Site Config';
  }
  if (p.includes('account') || p.includes('auth') || p.includes('user') || p.includes('member') ||
      p.includes('identity') || p.includes('profile') || p.includes('login') || p.includes('session')) {
    return 'Auth & Identity';
  }
  if (p.includes('store') || p.includes('product') || p.includes('payment') || p.includes('cart') ||
      p.includes('order') || p.includes('commerce') || p.includes('ecom') || p.includes('checkout')) {
    return 'Commerce';
  }
  if (p.includes('analytics') || p.includes('marketing') || p.includes('traffic') || p.includes('metrics')) {
    return 'Analytics';
  }
  if (p.includes('upload') || p.includes('image') || p.includes('file') || p.includes('asset')) {
    return 'Media & Assets';
  }
  return 'Other';
}

/**
 * Map all API calls made by a website by navigating through provided URLs
 * (or the current page) via CDP, capturing all JSON network traffic.
 *
 * Platform-agnostic: works with any site that makes JSON API calls.
 */
export async function mapApis(opts: {
  cdpPort: number;
  url: string;
  /** Additional URLs to navigate to (e.g. admin dashboard sections). If empty, only probes the current page. */
  crawlUrls?: string[];
  /** Follow links on each page that match this origin (default: true) */
  followLinks?: boolean;
}): Promise<ApiMapResult> {
  const { cdpPort, url, crawlUrls = [], followLinks = false } = opts;
  const origin = new URL(url).origin;

  const pw = await getPlaywright();
  const browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);

  const allApiCalls: RawApiCall[] = [];
  const endpointMap = new Map<string, {
    path: string;
    methods: Set<string>;
    statuses: Set<number>;
    sections: Set<string>;
    queryParams: Set<string>;
    callCount: number;
    sampleRequestHeaders: Record<string, string> | null;
    samplePostData: string | null;
    sampleResponseBody: unknown;
  }>();

  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('No browser context found. Make sure Chrome has at least one window open.');

    async function mapPage(pageUrl: string, label: string): Promise<void> {
      const page = await (context as unknown as { newPage(): Promise<{
        goto(url: string, opts: Record<string, unknown>): Promise<unknown>;
        evaluate(fn: () => unknown): Promise<unknown>;
        close(): Promise<void>;
        on(event: string, handler: (resp: unknown) => void): void;
        off(event: string, handler: (resp: unknown) => void): void;
        context(): { newCDPSession(page: unknown): Promise<{
          send(method: string, params: Record<string, unknown>): Promise<unknown>;
          on(event: string, handler: (params: unknown) => void): void;
          detach(): Promise<void>;
        }> };
      }> }).newPage();

      // Set up CDP network interception for response bodies
      const cdpSession = await page.context().newCDPSession(page);
      await cdpSession.send('Network.enable', { maxPostDataSize: 65536 });

      const capturedBodies = new Map<string, string>();
      const capturedRequests = new Map<string, { method: string; headers: Record<string, string>; postData: string | null }>();

      cdpSession.on('Network.requestWillBeSent', (params: unknown) => {
        const p = params as { requestId: string; request: { method: string; headers: Record<string, string>; postData?: string } };
        capturedRequests.set(p.requestId, {
          method: p.request.method,
          headers: p.request.headers,
          postData: p.request.postData || null,
        });
      });

      cdpSession.on('Network.responseReceived', async (params: unknown) => {
        const p = params as { requestId: string; response: { status: number; headers: Record<string, string>; mimeType: string; url: string } };
        const ct = p.response.headers['content-type'] || p.response.mimeType || '';
        if (!ct.includes('json')) return;

        try {
          const { body } = (await cdpSession.send('Network.getResponseBody', { requestId: p.requestId })) as { body: string };
          capturedBodies.set(p.requestId, body);
        } catch { /* body not available */ }
      });

      // Also capture via Playwright response events for broader coverage
      const apiCalls: RawApiCall[] = [];

      const responseHandler = async (response: unknown) => {
        const resp = response as { url(): string; status(): number; headers(): Record<string, string>; json(): Promise<unknown> };
        const respUrl = resp.url();
        const ct = resp.headers()['content-type'] || '';
        if (!ct.includes('json')) return;

        // Skip static assets
        try {
          const parsed = new URL(respUrl);
          if (/\.(js|css|png|jpg|svg|woff2?)$/i.test(parsed.pathname)) return;
        } catch { return; }

        let body: unknown;
        try { body = await resp.json(); } catch { return; }

        apiCalls.push({
          section: label,
          method: 'GET', // Will be enriched from CDP data
          url: respUrl,
          status: resp.status(),
          mimeType: ct,
          requestHeaders: {},
          postData: null,
          responseBody: body,
        });
      };

      page.on('response', responseHandler);

      try {
        await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
      } catch {
        // Timeout is fine — we captured what we could
        await new Promise(r => setTimeout(r, 3000));
      }

      // Scroll to trigger lazy loads
      try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 2000));
      } catch { /* scroll failed */ }

      page.off('response', responseHandler);

      // Enrich Playwright-captured calls with CDP request data
      for (const call of apiCalls) {
        // Find matching CDP request by URL
        for (const [reqId, req] of capturedRequests) {
          // Match by URL suffix since CDP may have full URL
          if (call.url.includes(new URL(call.url).pathname)) {
            call.method = req.method;
            call.requestHeaders = req.headers;
            call.postData = req.postData;
            // Use CDP body if available (more reliable)
            if (capturedBodies.has(reqId)) {
              call.responseBody = tryParseJSON(capturedBodies.get(reqId)!);
            }
            break;
          }
        }

        allApiCalls.push(call);

        // Index by endpoint path
        const urlObj = new URL(call.url);
        const path = urlObj.pathname;
        if (!endpointMap.has(path)) {
          endpointMap.set(path, {
            path,
            methods: new Set(),
            statuses: new Set(),
            sections: new Set(),
            queryParams: new Set(),
            callCount: 0,
            sampleRequestHeaders: null,
            samplePostData: null,
            sampleResponseBody: null,
          });
        }
        const ep = endpointMap.get(path)!;
        ep.methods.add(call.method);
        if (call.status) ep.statuses.add(call.status);
        ep.sections.add(label);
        ep.callCount++;
        if (call.status === 200 && !ep.sampleResponseBody && call.responseBody) {
          ep.sampleResponseBody = call.responseBody;
          ep.sampleRequestHeaders = call.requestHeaders;
          ep.samplePostData = call.postData;
        }
        for (const [key] of urlObj.searchParams) {
          ep.queryParams.add(key);
        }
      }

      await cdpSession.detach().catch(() => {});
      await page.close();
    }

    // Map the main URL
    await mapPage(url, 'main');

    // Map additional crawl URLs
    for (const crawlUrl of crawlUrls) {
      const label = new URL(crawlUrl).pathname.replace(/^\//, '') || 'page';
      await mapPage(crawlUrl, label);
    }

    // Optionally follow links from the main page
    if (followLinks) {
      const mainPage = (context as unknown as { pages(): Array<{ url(): string; evaluate(fn: (o: string) => unknown, arg: string): Promise<unknown> }> }).pages()[0];
      if (mainPage) {
        const links = (await mainPage.evaluate((orig: string) => {
          return [...new Set(
            [...document.querySelectorAll('a[href]')]
              .map(a => (a as HTMLAnchorElement).href)
              .filter(h => h.startsWith(orig) && !h.includes('#'))
          )].slice(0, 20); // Cap at 20 links
        }, origin)) as string[];

        const visited = new Set([url, ...crawlUrls]);
        for (const link of links) {
          if (visited.has(link)) continue;
          visited.add(link);
          const label = new URL(link).pathname.replace(/^\//, '') || 'page';
          await mapPage(link, label);
        }
      }
    }

    // Compile results
    const endpoints: ApiEndpoint[] = [...endpointMap.values()]
      .map(ep => ({
        path: ep.path,
        methods: [...ep.methods],
        statuses: [...ep.statuses],
        sections: [...ep.sections],
        queryParams: [...ep.queryParams],
        callCount: ep.callCount,
        sampleRequestHeaders: ep.sampleRequestHeaders,
        samplePostData: ep.samplePostData,
        sampleResponsePreview: previewResponse(ep.sampleResponseBody),
      }))
      .sort((a, b) => b.callCount - a.callCount);

    // Categorize
    const categories: Record<string, ApiEndpoint[]> = {};
    for (const ep of endpoints) {
      const cat = categorizeEndpoint(ep.path);
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(ep);
    }

    // Extract auth headers
    const authHeaderSet = new Set<string>();
    for (const ep of endpoints) {
      if (!ep.sampleRequestHeaders) continue;
      for (const key of Object.keys(ep.sampleRequestHeaders)) {
        const lower = key.toLowerCase();
        if (lower.startsWith('x-') || lower === 'authorization' ||
            lower === 'commonconfig' || lower === 'consent-policy' ||
            lower === 'cookie') {
          authHeaderSet.add(key);
        }
      }
    }

    return {
      url,
      mappedAt: new Date().toISOString(),
      totalApiCalls: allApiCalls.length,
      totalEndpoints: endpoints.length,
      endpoints,
      categories,
      authHeaders: [...authHeaderSet].sort(),
    };
  } finally {
    await browser.close();
  }
}
