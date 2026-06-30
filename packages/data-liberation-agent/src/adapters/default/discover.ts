import { fetchSitemap, classifyUrl } from '../../lib/extraction/sitemap.js';
import { extractMeta, extractTitle, extractNavLinks } from '../../lib/html-extract/index.js';
import type { InventoryUrl } from '../shared.js';
import type { DefaultInventory } from './types.js';

const UA = 'Mozilla/5.0 (compatible; DataLiberation/1.0)';

/**
 * Discovery for the platform-agnostic fallback adapter. Mirrors the webflow
 * adapter: homepage metadata + sitemap + nav crawl, with a homepage-only
 * fallback when the site exposes no sitemap. Fetch-based (no browser) — the
 * sitemap is the primary URL source and doesn't require rendering.
 */
export async function discoverDefault(url: string, _opts: Record<string, unknown>): Promise<DefaultInventory> {
  const normalized = url.includes('://') ? url : `https://${url}`;

  let homepageHtml = '';
  try {
    const resp = await fetch(normalized, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': UA },
    });
    if (resp.ok) homepageHtml = await resp.text();
    else await resp.body?.cancel();
  } catch {
    // Network error — continue with empty HTML.
  }

  const ogTitle = extractMeta(homepageHtml, 'og:title');
  const ogDescription = extractMeta(homepageHtml, 'og:description');
  const siteTitle = ogTitle || extractTitle(homepageHtml) || 'Imported Site';
  const siteTagline = ogDescription || extractMeta(homepageHtml, 'description') || '';

  const langMatch = homepageHtml.match(/<html[^>]+lang=["']([^"']+)["']/i);
  const siteLanguage = langMatch?.[1] || 'en-US';

  const sitemapUrls = await fetchSitemap(url);
  const navigation = extractNavLinks(homepageHtml, normalized);

  const counts: Record<string, number> = {};
  const inventoryUrls: InventoryUrl[] = [];
  for (const u of sitemapUrls) {
    const type = classifyUrl(u);
    inventoryUrls.push({ url: u, type });
    counts[type] = (counts[type] || 0) + 1;
  }

  if (inventoryUrls.length === 0) {
    inventoryUrls.push({ url: normalized, type: 'homepage' });
    counts['homepage'] = 1;
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
