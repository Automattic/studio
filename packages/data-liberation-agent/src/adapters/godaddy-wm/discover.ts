import { parseSitemapXml, classifyUrl } from '../../lib/extraction/sitemap.js';
import { extractMeta, extractTitle, extractNavLinks } from '../../lib/html-extract/index.js';
import type { InventoryUrl } from '../shared.js';
import type { GoDaddyWmInventory } from './types.js';

// ---------------------------------------------------------------------------
// W+M sitemap discovery
// ---------------------------------------------------------------------------

export async function fetchXml(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)' },
    });
    if (!resp.ok) {
      await resp.body?.cancel();
      return '';
    }
    return await resp.text();
  } catch {
    return '';
  }
}

// Fetch each W+M sub-sitemap individually so blog posts can be tagged `post`
// precisely — classifyUrl does not match W+M's /news,-updates-and-reviews/f/<slug> shape.
// sitemap.ols.xml is intentionally skipped in v1 (no test fixture for OLS yet).
export async function discoverWmUrls(baseUrl: string): Promise<InventoryUrl[]> {
  const normalized = baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`;
  const origin = new URL(normalized).origin;

  const out: InventoryUrl[] = [];
  const seen = new Set<string>();

  const tagged: Array<{ path: string; type: 'page' | 'post' }> = [
    { path: '/sitemap.website.xml', type: 'page' },
    { path: '/sitemap.blog.xml', type: 'post' },
  ];

  for (const { path, type } of tagged) {
    const xml = await fetchXml(`${origin}${path}`);
    if (!xml) continue;
    const urls = parseSitemapXml(xml);
    for (const u of urls) {
      if (seen.has(u)) continue;
      seen.add(u);
      const finalType = classifyUrl(u) === 'homepage' ? 'homepage' : type;
      out.push({ url: u, type: finalType });
    }
  }

  return out;
}

export async function discover(url: string, _opts: Record<string, unknown>): Promise<GoDaddyWmInventory> {
  const normalized = url.includes('://') ? url : `https://${url}`;

  let homepageHtml = '';
  try {
    const resp = await fetch(normalized, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)' },
    });
    if (resp.ok) {
      homepageHtml = await resp.text();
    } else {
      await resp.body?.cancel();
    }
  } catch {
    // Network error — continue with empty HTML
  }

  const ogTitle = extractMeta(homepageHtml, 'og:title');
  const ogDescription = extractMeta(homepageHtml, 'og:description');
  const ogSiteName = extractMeta(homepageHtml, 'og:site_name');
  const siteTitle = ogSiteName || ogTitle || extractTitle(homepageHtml) || 'Imported Site';
  const siteTagline = ogDescription || extractMeta(homepageHtml, 'description') || '';

  const langMatch = homepageHtml.match(/<html[^>]+lang=["']([^"']+)["']/i);
  const siteLanguage = langMatch?.[1] || 'en-US';

  const navigation = extractNavLinks(homepageHtml, normalized);

  const inventoryUrls = await discoverWmUrls(normalized);

  if (inventoryUrls.length === 0) {
    inventoryUrls.push({ url: normalized, type: 'homepage' });
  }

  const counts: Record<string, number> = {};
  for (const u of inventoryUrls) {
    counts[u.type] = (counts[u.type] || 0) + 1;
  }

  return {
    siteUrl: url,
    discoveredAt: new Date().toISOString(),
    siteMeta: {
      title: siteTitle,
      tagline: siteTagline,
      language: siteLanguage,
    },
    navigation,
    counts,
    urls: inventoryUrls,
  };
}
