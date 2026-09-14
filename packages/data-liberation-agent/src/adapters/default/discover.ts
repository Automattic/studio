import { fetchSitemap, classifyUrl } from '../../lib/extraction/sitemap.js';
import { extractMeta, extractTitle, extractNavLinks } from '../../lib/html-extract/index.js';
import { getPlaywright } from '../../lib/browser-kit/browser-kit.js';
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
  let navigation = extractNavLinks(homepageHtml, normalized);
  let renderedHeaderUrls: string[] = [];

  // Single-page apps commonly serve an empty shell to both the homepage and
  // sitemap.xml. Render their primary navigation before falling back to one route.
  if (sitemapUrls.length < 5) {
    try {
      const pw = await getPlaywright();
      const browser = await pw.chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        const renderedNavigation = extractNavLinks(await page.content(), page.url());
        if (renderedNavigation.length > 0) navigation = renderedNavigation;
        renderedHeaderUrls = await page.locator('header a[href], [role="banner"] a[href]').evaluateAll(
          (links) => links.map((link) => (link as HTMLAnchorElement).href)
        );
      } finally {
        await browser.close();
      }
    } catch {
      // Browser discovery is supplemental; retain sitemap and raw HTML results.
    }
  }

  const counts: Record<string, number> = {};
  const inventoryUrls: InventoryUrl[] = [];
  const discoveredUrls = new Set(sitemapUrls);
  const origin = new URL(normalized).origin;
  for (const href of [...navigation.map((link) => link.href), ...renderedHeaderUrls]) {
    const linkUrl = new URL(href);
    if (linkUrl.origin === origin && ['http:', 'https:'].includes(linkUrl.protocol)) {
      linkUrl.hash = '';
      discoveredUrls.add(linkUrl.href);
    }
  }
  for (const u of discoveredUrls) {
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
