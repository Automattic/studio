import { getPlaywright } from '../../lib/browser-kit/index.js';
import type { InventoryUrl } from '../shared.js';
import type { AdminEntry, SquarespaceInventory } from './types.js';

export const COLLECTION_TYPES: Record<number, string> = {
  1: 'index', 2: 'gallery', 5: 'album', 6: 'blog',
  7: 'events', 8: 'product', 10: 'page', 11: 'portfolio',
};

export function classifyAdminType(rawType: unknown, urlPath: string): string {
  if (typeof rawType === 'number' && COLLECTION_TYPES[rawType]) return COLLECTION_TYPES[rawType];
  if (typeof rawType === 'string') {
    const n = rawType.toLowerCase();
    if (n.startsWith('blog')) return 'post';
    if (n.startsWith('gallery') || n.startsWith('portfolio')) return 'gallery';
    if (n.startsWith('events')) return 'event';
    if (n.startsWith('products')) return 'product';
    if (n.startsWith('index') || n.startsWith('folder')) return 'page';
    return n;
  }
  const path = urlPath.toLowerCase();
  if (path.includes('/blog') || path.includes('/post')) return 'post';
  if (path.includes('/gallery') || path.includes('/portfolio')) return 'gallery';
  if (path.includes('/store') || path.includes('/product')) return 'product';
  if (path.includes('/event')) return 'event';
  return path === '/' ? 'homepage' : 'page';
}

/** Check if a value looks like a Squarespace page/collection object. */
export function looksLikePageObject(value: Record<string, unknown>): boolean {
  if (value.assetUrl || value.scriptUrl || value.mimeType || value.contentType) return false;
  const hasUrl = !!(value.fullUrl || value.publicUrl || value.pageUrl || value.path || value.url || value.href || value.slug);
  const hasLabel = !!(value.title || value.navigationTitle || value.name);
  const hasId = !!(value.id || value.pageId || value.collectionId);
  return hasUrl && (hasLabel || hasId);
}

/** Recursively extract page-like entries from a JSON tree (API responses, __NEXT_DATA__). */
export function extractAdminEntries(rootValue: unknown, origin: string, targetHost: string): AdminEntry[] {
  const entries = new Map<string, AdminEntry>();
  const visited = new WeakSet<object>();

  function normUrl(raw: unknown): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes('/config/pages')) return null;
    try {
      const abs = new URL(trimmed, origin);
      if (abs.host !== targetHost) return null;
      if (/^\/(api|scripts|assets|styles|fonts|static)\//.test(abs.pathname)) return null;
      if (/\.(jpg|jpeg|png|gif|webp|svg|avif|ico|js|css|map|json|txt|xml|pdf|woff2?|ttf|eot)$/i.test(abs.pathname)) return null;
      abs.hash = '';
      return abs.toString();
    } catch { return null; }
  }

  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value as object)) return;
    visited.add(value as object);

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const obj = value as Record<string, unknown>;
    if (looksLikePageObject(obj)) {
      const url = normUrl(obj.fullUrl || obj.publicUrl || obj.pageUrl || obj.path || obj.url || obj.href || obj.slug);
      if (url) {
        const title = (obj.navigationTitle || obj.title || obj.name || new URL(url).pathname) as string;
        const adminPageId = obj.pageId || obj.collectionId || obj.id;
        const visibility: AdminEntry['visibility'] =
          obj.published === false ? 'draft'
          : (obj.showInNavigation === false || obj.navigationHidden || obj.unlinked) ? 'unlinked'
          : obj.passwordProtected ? 'password-protected'
          : 'published';

        entries.set(url, {
          url,
          title,
          type: classifyAdminType(obj.typeName || obj.pageType || obj.type || obj.collectionType, new URL(url).pathname),
          visibility,
          adminPageId: adminPageId ? String(adminPageId) : null,
        });
      }
    }

    for (const child of Object.values(obj)) visit(child);
  }

  visit(rootValue);
  return [...entries.values()];
}

/**
 * Connect to a logged-in Squarespace admin session via CDP, navigate to /config/pages,
 * and extract page entries from API calls, __NEXT_DATA__, and DOM links.
 */
export async function discoverAdmin(siteUrl: string, cdpPort: number): Promise<AdminEntry[]> {
  const origin = new URL(siteUrl).origin;
  const targetHost = new URL(siteUrl).host;
  const pw = await getPlaywright();
  const browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);

  try {
    const context = browser.contexts()[0] || await (browser as unknown as { newContext(): Promise<{ newPage(): Promise<unknown>; pages(): unknown[] }> }).newContext();
    // Look for an existing admin tab or open a new one
    const pages = context.pages() as Array<{
      url(): string;
      goto(url: string, opts: Record<string, unknown>): Promise<unknown>;
      waitForLoadState(state: string, opts: Record<string, unknown>): Promise<void>;
      evaluate(fn: () => unknown): Promise<unknown>;
      on(event: string, handler: (resp: unknown) => void): void;
      off(event: string, handler: (resp: unknown) => void): void;
    }>;
    let page = pages.find(p => p.url().includes('/config'));
    if (!page) {
      page = await (context as unknown as { newPage(): Promise<typeof pages[0]> }).newPage();
    }

    const apiCalls: Array<{ url: string; data: unknown }> = [];

    const responseHandler = async (response: unknown) => {
      const resp = response as { url(): string; headers(): Record<string, string>; json(): Promise<unknown> };
      const respUrl = resp.url();
      const ct = resp.headers()['content-type'] || '';
      if (!ct.includes('application/json')) return;
      const isAdminApi = respUrl.includes('/api/') || respUrl.includes('/api/content/') || respUrl.includes('/api/commondata/');
      if (!isAdminApi) return;
      try { apiCalls.push({ url: respUrl, data: await resp.json() }); } catch { /* body not readable */ }
    };

    page.on('response', responseHandler);

    // Navigate to /config/pages to trigger admin API calls
    try {
      await page.goto(`${origin}/config/pages`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 3000));
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1000));
    } catch {
      // Navigation may fail if not logged in
    }

    page.off('response', responseHandler);

    // Extract __NEXT_DATA__ hydration payload
    let nextData: unknown = null;
    try {
      nextData = await page.evaluate(() => (window as unknown as Record<string, unknown>).__NEXT_DATA__ || null);
    } catch { /* not available */ }

    // Combine entries from API calls and __NEXT_DATA__
    const entries = [
      ...extractAdminEntries(apiCalls.map(c => c.data), origin, targetHost),
      ...extractAdminEntries(nextData, origin, targetHost),
    ];

    // Deduplicate by URL
    const byUrl = new Map<string, AdminEntry>();
    for (const entry of entries) byUrl.set(entry.url, entry);

    return [...byUrl.values()];
  } finally {
    await browser.close();
  }
}

/**
 * Merge admin-discovered entries into the public inventory.
 * Admin entries add drafts/unlisted pages and enrich existing entries with visibility metadata.
 */
export function mergeAdminDiscovery(
  inventory: SquarespaceInventory,
  adminEntries: AdminEntry[]
): SquarespaceInventory {
  if (adminEntries.length === 0) return inventory;

  const mergedUrls = new Map<string, InventoryUrl & { visibility?: string }>();
  for (const u of inventory.urls) mergedUrls.set(u.url, { ...u });

  for (const entry of adminEntries) {
    const existing = mergedUrls.get(entry.url);
    if (existing) {
      // Enrich with admin data
      if (entry.type && entry.type !== 'page') existing.type = entry.type;
      (existing as unknown as Record<string, unknown>).visibility = entry.visibility;
    } else {
      // New URL from admin (draft, unlisted, etc.)
      mergedUrls.set(entry.url, {
        url: entry.url,
        type: entry.type || 'page',
        visibility: entry.visibility,
      } as InventoryUrl & { visibility?: string });
    }
  }

  // Update navigation — add admin-only published pages
  const navHrefs = new Set(inventory.navigation.map(n => n.href));
  const navigation = [...inventory.navigation];
  for (const entry of adminEntries) {
    if (entry.visibility !== 'published' || navHrefs.has(entry.url)) continue;
    navigation.push({ text: entry.title, href: entry.url });
    navHrefs.add(entry.url);
  }

  // Recount
  const counts: Record<string, number> = {};
  const urls: InventoryUrl[] = [];
  for (const u of mergedUrls.values()) {
    urls.push(u);
    counts[u.type] = (counts[u.type] || 0) + 1;
  }

  return { ...inventory, navigation, counts, urls };
}
