import { classifyUrl, parseSitemapXml } from '../../lib/extraction/sitemap.js';
import { ensureUrlScheme } from '../../lib/url/index.js';
import { launchBrowser } from '../../lib/browser-kit/index.js';
import type { InventoryUrl } from '../shared.js';
import type { NavLink } from '../../lib/html-extract/index.js';
import type { WixAdapterOpts, Inventory } from './types.js';

export async function discover(url: string, opts: Record<string, unknown>): Promise<Inventory> {
    const wixOpts = opts as WixAdapterOpts;
    // Normalize scheme-less input (e.g. "www.example.com") so the new URL()
    // calls below don't throw "Invalid URL" — matches the guard that
    // hubspot/weebly/hostinger already have at the top of their discover().
    url = ensureUrlScheme(url);
    const { browser, page, close } = await launchBrowser({ cdpPort: wixOpts.cdpPort });

    try {
    const p = page as {
      goto(url: string, opts?: Record<string, unknown>): Promise<{ ok(): boolean } | null>;
      content(): Promise<string>;
      evaluate(fn: (...args: unknown[]) => unknown, ...args: unknown[]): Promise<unknown>;
      waitForTimeout(ms: number): Promise<void>;
    };

    // 1. Fetch sitemap via Playwright
    const baseUrl = (() => {
      const u = new URL(url);
      return u.origin + u.pathname.replace(/\/$/, '');
    })();

    const sitemapUrls: string[] = [];

    // Dedupe across child sitemaps — Wix sites commonly list the same URL in
    // multiple children (e.g. `/blog` appears in both pages-sitemap.xml and
    // blog-categories-sitemap.xml), and a naive crawl writes duplicates into
    // the WXR. `seenSitemaps` also prevents re-fetching a sitemap index file
    // if it appears more than once.
    const seenUrls = new Set<string>();
    const seenSitemaps = new Set<string>();
    const sitemapFailures: Array<{ url: string; reason: string }> = [];

    async function fetchSitemapPw(sitemapUrl: string, depth = 0, speculative = false): Promise<void> {
      if (depth > 3) return;
      if (seenSitemaps.has(sitemapUrl)) return;
      seenSitemaps.add(sitemapUrl);

      // Record a final fetch failure. Speculative sub-sitemap probes
      // (blog/store/forum) that simply aren't present on this site are an
      // expected miss, not a failure — stay quiet unless --verbose, and don't
      // count them toward the "inventory may be incomplete" warning.
      const fail = (reason: string): void => {
        if (speculative) {
          if (wixOpts.verbose) {
            console.warn(`[wix:discover] optional sub-sitemap not present: ${sitemapUrl} (${reason})`);
          }
          return;
        }
        console.warn(`[wix:discover] sitemap fetch failed after ${RETRIES} attempts: ${sitemapUrl} (${reason})`);
        sitemapFailures.push({ url: sitemapUrl, reason });
      };

      // Retry with exponential backoff — Wix CDN occasionally returns
      // transient errors or times out under parallel load. A silent failure
      // here turns into a zero-content WXR because children like
      // pages-sitemap.xml / blog-posts-sitemap.xml are never reached.
      const RETRIES = 3;
      let lastErr: string | null = null;
      for (let attempt = 1; attempt <= RETRIES; attempt++) {
        try {
          const resp = await p.goto(sitemapUrl, { timeout: 15000 });
          if (!resp || !resp.ok()) {
            lastErr = resp ? `HTTP ${resp.ok() ? 'ok=false' : 'status-not-ok'}` : 'no response';
            if (attempt < RETRIES) {
              await new Promise((r) => setTimeout(r, 500 * attempt));
              continue;
            }
            fail(lastErr ?? 'unknown');
            return;
          }
          const text = await p.content();
          const locs = parseSitemapXml(text);
          for (const loc of locs) {
            if (loc.endsWith('.xml')) {
              await fetchSitemapPw(loc, depth + 1);
            } else if (!seenUrls.has(loc)) {
              seenUrls.add(loc);
              sitemapUrls.push(loc);
            }
          }
          return;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          if (attempt < RETRIES) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
            continue;
          }
          fail(lastErr ?? 'unknown');
        }
      }
    }

    await fetchSitemapPw(`${baseUrl}/sitemap.xml`);

    if (sitemapFailures.length > 0) {
      console.warn(`[wix:discover] ${sitemapFailures.length} sitemap fetch(es) failed — inventory may be incomplete`);
    }

    // Wix's sitemap index typically only references pages-sitemap.xml,
    // even when blog/store/forum content exists. Probe the well-known
    // sub-sitemap paths so blog posts and storefront items don't get
    // silently dropped.
    for (const subSitemap of [
      'blog-posts-sitemap.xml',
      'store-products-sitemap.xml',
      'forum-posts-sitemap.xml',
    ]) {
      await fetchSitemapPw(`${baseUrl}/${subSitemap}`, 0, true);
    }

    // 2. If sitemap is empty, crawl homepage for same-origin links
    let allUrls = sitemapUrls;
    if (allUrls.length === 0) {
      try {
        // See comment at the page-extraction goto above — Wix's
        // background telemetry prevents `networkidle` from ever
        // resolving.
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await p.waitForTimeout(4000);
        const origin = new URL(url).origin;
        allUrls = (await p.evaluate((orig: unknown) => {
          const o = orig as string;
          return [
            ...new Set(
              [...document.querySelectorAll('a[href]')]
                .map((a) => (a as HTMLAnchorElement).href)
                .filter((h) => h.startsWith(o) && !h.includes('#'))
            ),
          ];
        }, origin)) as string[];
      } catch {
        // crawl failed
      }
    }

    // 3. Extract navigation from homepage
    let navigation: NavLink[] = [];
    try {
      // See comment at the page-extraction goto above for why we
      // avoid `networkidle` on Wix sites.
      await p
        .goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        .catch(() => {});
      await p.waitForTimeout(4000);
      navigation = (await p.evaluate(() => {
        const navLinks: Array<{ text: string; href: string }> = [];
        document
          .querySelectorAll('nav a, header a, [role="navigation"] a')
          .forEach((el) => {
            const a = el as HTMLAnchorElement;
            const text = a.textContent?.trim() || '';
            const href = a.href;
            if (text && href && !href.includes('#') && !navLinks.find((l) => l.href === href)) {
              navLinks.push({ text, href });
            }
          });
        return navLinks;
      })) as NavLink[];
    } catch {
      // nav extraction failed
    }

    // 4. Extract site title.
    //    Wix's editor sets document.title to "Page Title | Site Name Main".
    //    Take the substring after the last " | " (the site-name half), then
    //    drop the trailing " Main" suffix that Wix appends to every site
    //    name. Without this the WordPress import lands with a site title
    //    like "Home | Gilded Carat Main" instead of "Gilded Carat".
    let siteTitle = '';
    try {
      siteTitle = (await p.evaluate(() => {
        const t = document.title;
        const pipeIdx = t.lastIndexOf(' | ');
        const sitePart = pipeIdx > 0 ? t.slice(pipeIdx + 3).trim() : t;
        return sitePart.replace(/ Main$/, '').trim();
      })) as string;
    } catch {
      // title extraction failed
    }

    // 5. Classify URLs
    const counts: Record<string, number> = {};
    const inventoryUrls: InventoryUrl[] = [];
    for (const u of allUrls) {
      const type = classifyUrl(u);
      inventoryUrls.push({ url: u, type });
      counts[type] = (counts[type] || 0) + 1;
    }

    return {
      siteUrl: url,
      discoveredAt: new Date().toISOString(),
      siteMeta: {
        title: siteTitle || 'Imported Site',
        tagline: '',
        language: 'en-US',
      },
      navigation,
      counts,
      urls: inventoryUrls,
    };
    } finally {
      await close();
    }
}
