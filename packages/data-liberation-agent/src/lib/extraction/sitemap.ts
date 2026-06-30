export function parseSitemapXml(xml: string): string[] {
  const urls: string[] = [];
  const locMatches = xml.match(/<loc>([^<]+)<\/loc>/g);
  if (!locMatches) return urls;
  for (const match of locMatches) {
    const url = match.replace(/<\/?loc>/g, '').trim();
    if (url) urls.push(url);
  }
  return urls;
}

export type UrlType = 'homepage' | 'post' | 'product' | 'gallery' | 'event' | 'page';

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
  if (/\/(products?|product-page|store|shop)\//.test(path)) return 'product';
  if (/\/(gallery|portfolio)/.test(path)) return 'gallery';
  if (/\/(event|events)/.test(path)) return 'event';
  return 'page';
}

const MAX_SITEMAP_DEPTH = 3;
const MAX_URLS = 50000;

export async function fetchSitemap(baseUrl: string): Promise<string[]> {
  const normalizedBase = baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`;
  const sitemapUrl = `${normalizedBase.replace(/\/$/, '')}/sitemap.xml`;
  let baseOrigin: string;
  try {
    baseOrigin = new URL(normalizedBase).origin;
  } catch {
    return [];
  }
  const allUrls: string[] = [];
  const visited = new Set<string>();

  async function fetchAndParse(url: string, depth: number): Promise<void> {
    if (depth > MAX_SITEMAP_DEPTH || allUrls.length >= MAX_URLS || visited.has(url)) return;
    visited.add(url);

    // Same-origin enforcement to prevent SSRF
    try {
      if (new URL(url).origin !== baseOrigin) return;
    } catch {
      return;
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return;
      const xml = await response.text();
      const urls = parseSitemapXml(xml);

      for (const u of urls) {
        if (allUrls.length >= MAX_URLS) break;
        // Check for .xml before query string (e.g. sitemap_products_1.xml?from=...&to=...)
        const pathPart = u.includes('?') ? u.slice(0, u.indexOf('?')) : u;
        if (pathPart.endsWith('.xml')) {
          await fetchAndParse(u, depth + 1);
        } else {
          allUrls.push(u);
        }
      }
    } catch {
      // Sitemap fetch failed
    }
  }

  await fetchAndParse(sitemapUrl, 0);

  // Supplement with homepage nav link crawl if sitemap was thin
  if (allUrls.length < 5) {
    const navUrls = await crawlNavLinks(normalizedBase, baseOrigin);
    const seen = new Set(allUrls);
    for (const u of navUrls) {
      if (!seen.has(u) && allUrls.length < MAX_URLS) {
        allUrls.push(u);
        seen.add(u);
      }
    }
  }

  return allUrls;
}

// Paths that are platform UI, not user content
const SKIP_PATHS = /^\/(cart|account|login|signup|checkout|search|api|admin|favicon)/i;

async function crawlNavLinks(baseUrl: string, baseOrigin: string): Promise<string[]> {
  const urls: string[] = [];
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return urls;
    const html = await response.text();

    // Extract links from <nav> elements first, fall back to <header> links
    const navBlocks = [
      ...(html.match(/<nav[\s>][\s\S]*?<\/nav>/gi) || []),
      ...(html.match(/<footer[\s>][\s\S]*?<\/footer>/gi) || []),
    ];
    // Fall back to header if no nav or footer found
    if (navBlocks.length === 0) {
      navBlocks.push(...(html.match(/<header[\s>][\s\S]*?<\/header>/gi) || []));
    }

    const hrefPattern = /<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>/gi;
    const seen = new Set<string>();
    let match;

    for (const block of navBlocks) {
      hrefPattern.lastIndex = 0;
      while ((match = hrefPattern.exec(block)) !== null) {
        const href = match[1];
        if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;

        const resolved = resolveAndFilter(href, baseUrl, baseOrigin);
        if (resolved && !seen.has(resolved)) {
          seen.add(resolved);
          urls.push(resolved);
        }
      }
    }
  } catch {
    // Homepage fetch failed
  }
  return urls;
}

function resolveAndFilter(href: string, baseUrl: string, baseOrigin: string): string | null {
  try {
    const resolved = new URL(href, baseUrl);
    if (resolved.origin !== baseOrigin) return null;
    if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|xml|json)$/i.test(resolved.pathname)) return null;
    if (SKIP_PATHS.test(resolved.pathname)) return null;
    return resolved.href;
  } catch {
    return null;
  }
}
