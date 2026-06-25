import { fetchSitemap, classifyUrl } from '../../lib/extraction/sitemap.js';
import { extractMeta, extractTitle } from '../../lib/html-extract/index.js';
import type { InventoryUrl } from '../shared.js';
import { extractWeeblyNavLinks } from './media.js';
import type { WeeblyInventory } from './types.js';

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------

export async function discoverWeebly(url: string, _opts: Record<string, unknown>): Promise<WeeblyInventory> {
  // 1. Fetch homepage HTML
  let homepageHtml = '';
  try {
    const normalized = url.includes('://') ? url : `https://${url}`;
    const resp = await fetch(normalized, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)',
      },
    });
    if (resp.ok) {
      homepageHtml = await resp.text();
    } else {
      await resp.body?.cancel();
    }
  } catch {
    // Network error — continue with empty HTML
  }

  // 2. Extract site metadata
  const ogTitle = extractMeta(homepageHtml, 'og:title');
  const ogDescription = extractMeta(homepageHtml, 'og:description');
  const siteTitle = ogTitle || extractTitle(homepageHtml) || 'Imported Site';
  const siteTagline = ogDescription || extractMeta(homepageHtml, 'description') || '';

  // Detect language from <html lang="...">
  const langMatch = homepageHtml.match(/<html[^>]+lang=["']([^"']+)["']/i);
  const siteLanguage = langMatch?.[1] || 'en-US';

  // 3. Fetch sitemap
  const sitemapUrls = await fetchSitemap(url);

  // 4. Extract navigation from Weebly menu structure
  const normalized = url.includes('://') ? url : `https://${url}`;
  const navigation = extractWeeblyNavLinks(homepageHtml, normalized);

  // 5. Classify URLs
  const counts: Record<string, number> = {};
  const inventoryUrls: InventoryUrl[] = [];

  for (const u of sitemapUrls) {
    // Weebly blog posts live under /blog/ paths
    let type = classifyUrl(u);
    if (type === 'page' && /\/blog\//.test(u) && !/\/blog\/category\//.test(u)) {
      type = 'post';
    }
    inventoryUrls.push({ url: u, type });
    counts[type] = (counts[type] || 0) + 1;
  }

  // If sitemap was empty, add the homepage
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
