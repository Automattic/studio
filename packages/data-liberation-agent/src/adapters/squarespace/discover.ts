import { fetchSitemap, classifyUrl } from '../../lib/extraction/sitemap.js';
import { extractNavLinks } from '../../lib/html-extract/index.js';
import type { InventoryUrl } from '../shared.js';
import type { NavLink } from '../../lib/html-extract/index.js';
import type { SquarespaceAdapterOpts, SquarespaceInventory } from './types.js';
import { fetchSqsJson } from './content.js';
import { discoverAdmin, mergeAdminDiscovery } from './admin.js';

const MAX_ARCHIVE_PAGES = 200;
const BLOG_PREFIXES = ['/blog', '/journal', '/news', '/posts', '/stories'];

interface ArchivePage {
  items?: Array<{ urlId?: string; fullUrl?: string; addedOn?: number | string } | null>;
  pagination?: { nextPageOffset?: number | string };
}

function blogPrefixes(urls: InventoryUrl[]): string[] {
  const datePrefixes = new Map<string, number>();
  const conventions = new Set<string>();
  const datePath = /^(\/[^/]+(?:\/[^/]+)*?)\/\d{4}\/\d{1,2}\/\d{1,2}\/[^/]+\/?$/;

  for (const { url } of urls) {
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      continue;
    }

    const match = datePath.exec(path);
    if (match) {
      const prefix = match[1];
      datePrefixes.set(prefix, (datePrefixes.get(prefix) || 0) + 1);
      continue;
    }
    for (const prefix of BLOG_PREFIXES) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        conventions.add(prefix);
        break;
      }
    }
  }

  const detected = [...datePrefixes.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([prefix]) => prefix);
  return [...new Set([...detected, ...conventions])];
}

async function discoverArchiveUrls(siteUrl: string, prefix: string): Promise<string[]> {
  const origin = new URL(siteUrl).origin;
  const urls: string[] = [];
  const seenUrlIds = new Set<string>();
  const seenOffsets = new Set<string>();
  let offset: number | string | undefined;

  for (let page = 0; page < MAX_ARCHIVE_PAGES; page++) {
    const archiveUrl = new URL(prefix, origin);
    archiveUrl.searchParams.set('format', 'json-pretty');
    if (offset !== undefined) archiveUrl.searchParams.set('offset', String(offset));

    let response: Response;
    try {
      response = await fetch(archiveUrl, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)' },
      });
    } catch {
      break;
    }
    if (!response.ok) break;

    let archive: ArchivePage | null;
    try {
      archive = await response.json() as ArchivePage;
    } catch {
      break;
    }
    if (!archive || !Array.isArray(archive.items) || archive.items.length === 0) break;

    for (const item of archive.items) {
      if (!item || typeof item.urlId !== 'string' || !item.urlId || seenUrlIds.has(item.urlId) || typeof item.fullUrl !== 'string' || !item.fullUrl) continue;
      let itemUrl: URL;
      try {
        itemUrl = new URL(item.fullUrl, origin);
      } catch {
        continue;
      }
      if (itemUrl.origin !== origin || itemUrl.username || itemUrl.password) continue;
      seenUrlIds.add(item.urlId);
      itemUrl.hash = '';
      urls.push(itemUrl.href);
    }

    const next = archive.pagination?.nextPageOffset
      ?? archive.items[archive.items.length - 1]?.addedOn;
    if ((typeof next !== 'string' && typeof next !== 'number') || String(next).trim() === '' || (typeof next === 'number' && !Number.isFinite(next)) || seenOffsets.has(String(next))) break;
    seenOffsets.add(String(next));
    offset = next;
  }

  return urls;
}

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

  // 3. Squarespace renders its primary navigation in the public homepage HTML.
  // Admin discovery below supplements this list with published admin-only pages.
  let navigation: NavLink[] = [];
  try {
    const homepageResp = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)' },
    });
    if (homepageResp.ok) navigation = extractNavLinks(await homepageResp.text(), url);
    else await homepageResp.body?.cancel();
  } catch {
    // Public navigation is best-effort; sitemap and optional admin discovery continue.
  }

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

  // Squarespace blog listings expose a compact paginated feed which can recover
  // recently published posts before the sitemap catches up. It is discovery-only:
  // captured pages remain the portable artifact contract.
  const knownUrls = new Set(inventoryUrls.map(({ url: discoveredUrl }) => discoveredUrl));
  for (const prefix of blogPrefixes(inventoryUrls)) {
    const archiveUrls = await discoverArchiveUrls(url, prefix);
    for (const archiveUrl of archiveUrls) {
      if (knownUrls.has(archiveUrl)) continue;
      knownUrls.add(archiveUrl);
      inventoryUrls.push({ url: archiveUrl, type: 'post' });
      counts.post = (counts.post || 0) + 1;
    }
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
