import * as cheerio from 'cheerio';
import { desktopContextOptions } from '../browser-kit/browser-kit.js';

function decodeXml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
    if (entity === '&amp;') return '&';
    if (entity === '&lt;') return '<';
    if (entity === '&gt;') return '>';
    if (entity === '&quot;') return '"';
    if (entity === '&apos;') return "'";
    const numeric = entity.slice(2, -1);
    const codePoint = Number(numeric.startsWith('x') || numeric.startsWith('X') ? `0${numeric}` : numeric);
    return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
  });
}

export interface SitemapDocument {
  kind: 'urlset' | 'index' | 'unknown';
  locs: string[];
}

export function parseSitemapDocument(xml: string): SitemapDocument {
  const kind = /<\s*(?:\w+:)?sitemapindex\b/i.test(xml) ? 'index'
    : /<\s*(?:\w+:)?urlset\b/i.test(xml) ? 'urlset'
      : 'unknown';
  const urls: string[] = [];
  const locMatches = xml.match(/<\s*(?:\w+:)?loc\s*>([^<]+)<\/\s*(?:\w+:)?loc\s*>/gi);
  if (!locMatches) return { kind, locs: urls };
  for (const match of locMatches) {
    const url = decodeXml(match.replace(/<\/?(?:\w+:)?loc\s*>/gi, '').trim());
    if (url) urls.push(url);
  }
  return { kind, locs: urls };
}

import { canonicalizeHost } from '../screenshot/same-origin.js';

export function parseSitemapXml(xml: string): string[] {
  return parseSitemapDocument(xml).locs;
}

export type UrlType = 'homepage' | 'post' | 'product' | 'gallery' | 'event' | 'page';

export interface SitemapDiagnostic {
  code: string;
  url: string;
  reason: string;
}

export interface SitemapFetchResult {
  urls: string[];
  diagnostics: SitemapDiagnostic[];
}

export function classifyUrl(url: string): UrlType {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }

  if (path === '/' || path === '') return 'homepage';
  // Match /blog/<slug>, /post/<slug>, /blogs/<handle>/<slug>, etc.
  // Also match Wix patterns like /blog-1/post/<slug> and older Wix /single-post/<slug>.
  // Require a slug segment after the keyword — bare `/blog` is a listing page,
  // not a blog post, so it should fall through to the `page` default.
  if (/\/(blog|post|posts|article|articles|news|journal)\/[^/]/.test(path)) return 'post';
  if (/\/blogs\/[^/]+\/[^/]+/.test(path)) return 'post'; // Shopify /blogs/<blog>/<article>
  if (/\/blog-\d+\/post\//.test(path)) return 'post'; // Wix /blog-1/post/<slug>
  if (/\/single-post\//.test(path)) return 'post'; // Older Wix Blog URL pattern
  // A category/listing page under a store path is not a product, the same way a bare
  // /blog is not a post above. Weebly names these /store/c<N>/... against /store/p<N>/...
  // for an actual product; other platforms use /category/, /collections/ (Shopify), etc.,
  // or the bare /store//shop/ index. Check these before the broad product test below, or
  // e.g. lonestardinners.com's /store/c1/Current_Menu.html imports into WooCommerce as a
  // junk product named after the category, priced at whatever its cheapest listing costs.
  if (/\/(?:store|shop)\/c\d+\//.test(path)) return 'page';
  if (/\/(?:category|categories|collections|product-category|product-tag)(?:\/|$)/.test(path)) return 'page';
  if (/\/(?:store|shop)\/?$/.test(path)) return 'page';
  if (/\/(products?|product-page|store|shop)\//.test(path)) return 'product';
  if (/\/(gallery|portfolio)/.test(path)) return 'gallery';
  if (/\/(event|events)/.test(path)) return 'event';
  return 'page';
}

const MAX_SITEMAP_DEPTH = 3;
const MAX_URLS = 50000;

export async function fetchSitemap(baseUrl: string): Promise<string[]> {
  return (await fetchSitemapWithDiagnostics(baseUrl)).urls;
}

/**
 * Fetch sitemap routes scoped to the entry URL's origin. `fetchSitemap` keeps
 * the array-only contract used by existing adapters; callers that surface
 * discovery diagnostics can opt into this richer result.
 */
export async function fetchSitemapWithDiagnostics(baseUrl: string): Promise<SitemapFetchResult> {
  const normalizedBase = baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`;
  const sitemapUrl = `${normalizedBase.replace(/\/$/, '')}/sitemap.xml`;
  let baseOrigin: string;
  let siteHost: string;
  try {
    baseOrigin = new URL(normalizedBase).origin;
    siteHost = canonicalizeHost(normalizedBase);
  } catch {
    return { urls: [], diagnostics: [] };
  }
  const allUrls: string[] = [];
  const seenUrls = new Set<string>();
  const diagnostics: SitemapDiagnostic[] = [];
  const visited = new Set<string>();

  /**
   * Accept a sitemap entry on the entry URL's site and move it onto the entry
   * URL's origin. A site served over https whose sitemap still lists `http://`
   * (or the other `www` variant) is the same site; capture enforces the entry
   * origin exactly, so the entry is rewritten rather than kept as listed.
   * Anything else is reported, never dropped silently.
   */
  function acceptEntry(entry: string): URL | null {
    let entryUrl: URL;
    try {
      entryUrl = new URL(entry);
    } catch {
      diagnostics.push({ code: 'sitemap_url_rejected', url: entry, reason: 'invalid URL' });
      return null;
    }
    if (entryUrl.protocol !== 'http:' && entryUrl.protocol !== 'https:') {
      diagnostics.push({ code: 'sitemap_url_rejected', url: entry, reason: 'unsupported protocol' });
      return null;
    }
    if (canonicalizeHost(entryUrl) !== siteHost) {
      diagnostics.push({ code: 'sitemap_url_rejected', url: entry, reason: 'origin differs from the entry URL' });
      return null;
    }
    return new URL(`${entryUrl.pathname}${entryUrl.search}`, baseOrigin);
  }

  async function fetchAndParse(url: string, depth: number): Promise<void> {
    if (depth > MAX_SITEMAP_DEPTH || allUrls.length >= MAX_URLS || visited.has(url)) return;
    visited.add(url);

    // Same-origin enforcement to prevent SSRF: only the entry origin is fetched.
    try {
      if (new URL(url).origin !== baseOrigin) return;
    } catch {
      return;
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return;
      const xml = await response.text();
      const urls = parseSitemapDocument(xml).locs;

      for (const u of urls) {
        if (allUrls.length >= MAX_URLS) break;
        // Check for .xml before query string (e.g. sitemap_products_1.xml?from=...&to=...)
        const pathPart = u.includes('?') ? u.slice(0, u.indexOf('?')) : u;
        const entryUrl = acceptEntry(u);
        if (!entryUrl) continue;
        if (pathPart.endsWith('.xml')) {
          await fetchAndParse(entryUrl.href, depth + 1);
        } else {
          if (!seenUrls.has(entryUrl.href)) {
            allUrls.push(entryUrl.href);
            seenUrls.add(entryUrl.href);
          }
        }
      }
    } catch {
      // Sitemap fetch failed
    }
  }

  await fetchAndParse(sitemapUrl, 0);

  // Supplement with the homepage's links if sitemap was thin
  if (allUrls.length < 5) {
    const navUrls = await crawlHomepageLinks(normalizedBase, baseOrigin);
    const seen = new Set(allUrls);
    for (const u of navUrls) {
      if (!seen.has(u) && allUrls.length < MAX_URLS) {
        allUrls.push(u);
        seen.add(u);
      }
    }

    // Client-rendered sites can ship an empty application root, so raw HTML
    // cannot expose their navigation. Render only when the raw crawl found no
    // routes to retain the inexpensive fetch path for ordinary sites.
    if (navUrls.length === 0) {
      const renderedNavUrls = await crawlRenderedNavLinks(normalizedBase, baseOrigin);
      const seen = new Set(allUrls);
      for (const u of renderedNavUrls) {
        if (!seen.has(u) && allUrls.length < MAX_URLS) {
          allUrls.push(u);
          seen.add(u);
        }
      }
    }
  }

  return { urls: allUrls, diagnostics };
}

// Paths that are platform UI, not user content
const SKIP_PATHS = /^\/(cart|account|login|signup|checkout|search|api|admin|favicon)/i;

async function crawlHomepageLinks(baseUrl: string, baseOrigin: string): Promise<string[]> {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return [];
    return extractSameOriginLinks(await response.text(), baseUrl, baseOrigin);
  } catch {
    // Homepage fetch failed
    return [];
  }
}

/**
 * Every same-origin page link in one HTML document, in document order.
 *
 * Parsed with a DOM rather than matched by landmark regexes: a lazy
 * `<nav>…</nav>` match stops at the first nested `</nav>` (Webflow dropdowns),
 * and site chrome routinely lives outside `<nav>`/`<footer>` — a header CTA, a
 * GDPR bar, or a builder footer that is a plain `div` (Duda). The scope stays
 * one document, so no crawl depth is added; the same filter as the rendered
 * fallback below drops assets and platform UI paths.
 */
export function extractSameOriginLinks(html: string, baseUrl: string, baseOrigin = new URL(baseUrl).origin): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')?.trim();
    if (!href || href.startsWith('#')) return;
    const resolved = resolveAndFilter(href, baseUrl, baseOrigin);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      urls.push(resolved);
    }
  });
  return urls;
}

async function crawlRenderedNavLinks(baseUrl: string, baseOrigin: string): Promise<string[]> {
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(await desktopContextOptions(browser));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const hrefs = await page.locator('a[href]').evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).href),
    );
    const seen = new Set<string>();
    return hrefs.flatMap((href) => {
      const resolved = resolveAndFilter(href, baseUrl, baseOrigin);
      if (!resolved || seen.has(resolved)) return [];
      seen.add(resolved);
      return [resolved];
    });
  } catch {
    // Rendering is a best-effort fallback; sitemap and raw navigation remain usable.
    return [];
  } finally {
    await browser?.close();
  }
}

function resolveAndFilter(href: string, baseUrl: string, baseOrigin: string): string | null {
  try {
    const resolved = new URL(href, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    if (resolved.origin !== baseOrigin) return null;
    if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|xml|json)$/i.test(resolved.pathname)) return null;
    if (SKIP_PATHS.test(resolved.pathname)) return null;
    resolved.hash = '';
    return resolved.href;
  } catch {
    return null;
  }
}
