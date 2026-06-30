import * as cheerio from 'cheerio';
import { fetchSitemap, classifyUrl } from '../../lib/extraction/sitemap.js';
import { extractMeta, extractTitle, extractNavLinks } from '../../lib/html-extract/index.js';
import type { InventoryUrl } from '../shared.js';
import type { HubSpotInventory } from './types.js';
import { MAX_HTML_BYTES } from './constants.js';
import { looksLikeBlogPostPath } from './url.js';

export async function discover(url: string, _opts: Record<string, unknown>): Promise<HubSpotInventory> {
  const normalized = url.includes('://') ? url : `https://${url}`;

  // Fetch homepage HTML — propagate failures so callers can see why
  // discovery produced nothing, rather than silently returning a
  // hollow inventory.
  let resp: Response;
  try {
    resp = await fetch(normalized, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)' },
    });
  } catch (err) {
    throw new Error(`HubSpot discover(): fetch failed for ${normalized}: ${(err as Error).message}`);
  }
  if (!resp.ok) {
    await resp.body?.cancel();
    throw new Error(`HubSpot discover(): HTTP ${resp.status} ${resp.statusText} for ${normalized}`);
  }
  let homepageHtml: string;
  try {
    homepageHtml = await resp.text();
  } catch (err) {
    await resp.body?.cancel().catch(() => { /* already failing */ });
    throw new Error(`HubSpot discover(): failed reading body of ${normalized}: ${(err as Error).message}`);
  }
  if (homepageHtml.length > MAX_HTML_BYTES) {
    homepageHtml = homepageHtml.slice(0, MAX_HTML_BYTES);
  }

  const $ = cheerio.load(homepageHtml);

  const ogTitle = extractMeta(homepageHtml, 'og:title');
  const ogDescription = extractMeta(homepageHtml, 'og:description');
  const siteTitle = ogTitle || extractTitle(homepageHtml) || 'Imported Site';
  const siteTagline = ogDescription || extractMeta(homepageHtml, 'description') || '';
  const siteLanguage = $('html').attr('lang') || 'en-US';

  const sitemapUrls = await fetchSitemap(url);
  const navigation = extractNavLinks(homepageHtml, normalized);

  const counts: Record<string, number> = {};
  const inventoryUrls: InventoryUrl[] = [];

  for (const u of sitemapUrls) {
    let type = classifyUrl(u);
    if (type === 'page' && looksLikeBlogPostPath(u)) {
      type = 'post';
    }
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
