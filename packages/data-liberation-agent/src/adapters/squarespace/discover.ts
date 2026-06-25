import { fetchSitemap, classifyUrl } from '../../lib/extraction/sitemap.js';
import type { InventoryUrl } from '../shared.js';
import type { NavLink } from '../../lib/html-extract/index.js';
import type { SquarespaceAdapterOpts, SquarespaceInventory } from './types.js';
import { fetchSqsJson } from './content.js';
import { discoverAdmin, mergeAdminDiscovery } from './admin.js';

export async function discover(url: string, opts: Record<string, unknown>): Promise<SquarespaceInventory> {
  const sqOpts = opts as SquarespaceAdapterOpts;
  // 1. Fetch site metadata via ?format=json
  const siteJson = await fetchSqsJson(url);

  const siteTitle =
    siteJson?.website?.siteTitle ||
    siteJson?.websiteSettings?.siteTitle ||
    'Imported Site';
  const siteTagline =
    siteJson?.website?.siteTagLine ||
    siteJson?.websiteSettings?.siteTagLine ||
    siteJson?.website?.siteDescription ||
    '';
  const siteLanguage = siteJson?.website?.language || 'en-US';

  // 2. Fetch sitemap
  const sitemapUrls = await fetchSitemap(url);

  // 3. Extract navigation from the homepage JSON or sitemap
  const navigation: NavLink[] = [];
  // Squarespace JSON sometimes includes navigation in the website object;
  // for now, we derive nav from the top-level sitemap pages.

  // 4. Classify URLs — for Squarespace, we can probe each URL with ?format=json
  // to determine if it's a collection or item, but for the initial pass we use
  // path-based classification from the shared sitemap module.
  const counts: Record<string, number> = {};
  const inventoryUrls: InventoryUrl[] = [];

  for (const u of sitemapUrls) {
    const type = classifyUrl(u);
    inventoryUrls.push({ url: u, type });
    counts[type] = (counts[type] || 0) + 1;
  }

  // If sitemap was empty, try to discover from the homepage JSON items
  if (inventoryUrls.length === 0 && siteJson?.items) {
    const origin = new URL(url).origin;
    for (const item of siteJson.items) {
      if (item.fullUrl) {
        const fullUrl = item.fullUrl.startsWith('http')
          ? item.fullUrl
          : `${origin}${item.fullUrl}`;
        const type = classifyUrl(fullUrl);
        inventoryUrls.push({ url: fullUrl, type });
        counts[type] = (counts[type] || 0) + 1;
      }
    }
  }

  // If we still have nothing, add the homepage itself
  if (inventoryUrls.length === 0) {
    inventoryUrls.push({ url, type: 'homepage' });
    counts['homepage'] = 1;
  }

  let inventory: SquarespaceInventory = {
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

  // Admin discovery via CDP — finds drafts, unlisted pages, password-protected content
  if (sqOpts.cdpPort) {
    try {
      const adminEntries = await discoverAdmin(url, sqOpts.cdpPort);
      if (adminEntries.length > 0) {
        inventory = mergeAdminDiscovery(inventory, adminEntries);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      (inventory as unknown as Record<string, unknown>).adminWarning =
        `Squarespace admin discovery failed: ${message}. ` +
        'Drafts, unlisted pages, and password-protected content may be missing. ' +
        'Make sure you are logged in to Squarespace admin in the Chrome window connected via CDP.';
    }
  }

  return inventory;
}
