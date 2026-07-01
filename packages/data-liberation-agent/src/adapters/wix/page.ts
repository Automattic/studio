import type { PageData, PageMeta, CapturedApiCall } from './types.js';
import { isExecutionContextDestroyed, ROUTE_PIN_INIT_SCRIPT } from './runtime.js';
import { emptyMeta, extractImageUrls, deriveContent, extractFeaturedImageFromJsonLd } from './content.js';
import { extractGalleryFromHtml } from './gallery.js';
import { slugify } from '../../lib/url/index.js';

/**
 * Plain GET of a page's served HTML. Used as the last-resort fallback when
 * the live Playwright context is destroyed mid-extract (Pro Gallery) and
 * `page.content()` can't be read — Wix server-renders the page, so a bare
 * fetch still yields parseable markup with the gallery's embedded media.
 * Never throws; returns '' on any failure.
 */
async function fetchHtml(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(20000),
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

// ---------------------------------------------------------------------------
// extractPage — loads a single URL in Playwright, intercepts API calls
// ---------------------------------------------------------------------------

export async function extractWixPage(
  page: unknown,
  url: string
): Promise<PageData> {
  const p = page as {
    on(event: string, handler: (resp: unknown) => void): void;
    off(event: string, handler: (resp: unknown) => void): void;
    goto(url: string, opts: Record<string, unknown>): Promise<unknown>;
    evaluate(fn: (arg?: unknown) => unknown, arg?: unknown): Promise<unknown>;
    content(): Promise<string>;
    waitForTimeout(ms: number): Promise<void>;
    waitForLoadState(state: string, opts?: Record<string, unknown>): Promise<void>;
    addInitScript(script: string | { content: string }): Promise<void>;
    context(): {
      newCDPSession(page: unknown): Promise<{
        send(method: string, params: Record<string, unknown>): Promise<unknown>;
        detach(): Promise<void>;
      }>;
    };
  };

  // Re-settle the page: best-effort networkidle (bounded) + a short fixed
  // delay so Wix's lazy hydration finishes before we read the DOM. Used both
  // before the first evaluate and again before a retry. Wrapped in try/catch
  // because Wix's perpetual analytics/chat traffic can keep networkidle from
  // ever resolving — we never want that to throw.
  const settle = async (idleMs: number, delayMs: number): Promise<void> => {
    try {
      await p.waitForLoadState('networkidle', { timeout: idleMs });
    } catch {
      // analytics can keep the network busy forever — proceed anyway
    }
    await p.waitForTimeout(delayMs);
  };

  // Run an in-page evaluate that may race the Pro Gallery's hydration-time
  // navigation. On the "execution context was destroyed" error we re-settle
  // and retry exactly once; any other error (or a second destroy) propagates
  // to the caller, which has a served-HTML fallback. `label` is only for the
  // (already swallowed) call sites' own try/catch — kept for symmetry.
  const evaluateWithRetry = async <T>(fn: (arg?: unknown) => unknown): Promise<T> => {
    try {
      return (await p.evaluate(fn)) as T;
    } catch (err) {
      if (!isExecutionContextDestroyed(err)) throw err;
      await settle(8_000, 1_500);
      return (await p.evaluate(fn)) as T;
    }
  };

  const captured: {
    apiCalls: CapturedApiCall[];
  } = { apiCalls: [] };

  const responseHandler = async (response: unknown) => {
    const resp = response as {
      url(): string;
      headers(): Record<string, string>;
      json(): Promise<unknown>;
    };
    const respUrl = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;

    const isWixApi =
      respUrl.includes('/_api/') ||
      respUrl.includes('wixapis.com') ||
      respUrl.includes('wix.com/_api');
    if (!isWixApi) return;

    try {
      const body = await resp.json();
      captured.apiCalls.push({ url: respUrl, data: body });
    } catch {
      // response body not readable
    }
  };

  p.on('response', responseHandler);

  // Pin the route before navigation so Wix's Pro Gallery can't fire the
  // hydration-time client-side navigation that destroys our execution
  // context mid-evaluate. Best-effort — `addInitScript` may be unavailable
  // on some Page shapes, and the script can't always override the native
  // `location` setter; the retry + HTML-fallback layers below are the real
  // safety net.
  try {
    await p.addInitScript(ROUTE_PIN_INIT_SCRIPT);
  } catch {
    // older/foreign page shape — proceed without route pinning
  }

  try {
    // Wix's analytics, chat widgets, and tracking pixels keep firing
    // requests indefinitely, so `networkidle` never resolves on many
    // pages — especially product pages — and the 30s budget is
    // exhausted by background telemetry. `domcontentloaded` + a bounded
    // networkidle (best-effort) + a short fixed delay catches Wix's lazy
    // hydration without hanging. The networkidle attempt also lets the Pro
    // Gallery finish its hydration navigation *before* we evaluate, instead
    // of having it fire mid-extract.
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(6_000, 4000);
    // Scroll through the page to trigger lazy-loaded gallery thumbnails so
    // images below the fold make it into the live DOM read. Best-effort.
    try {
      await p.evaluate(async () => {
        const step = 800;
        const total = document.documentElement.scrollHeight;
        for (let y = 0; y < total; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      });
      await settle(3_000, 500);
    } catch {
      // scroll failed (e.g. context destroyed) — non-fatal; the DOM read and
      // HTML fallback still recover what's already present.
    }
  } catch {
    // Navigation may timeout on heavy Wix pages
  }

  p.off('response', responseHandler);

  // Tracks whether the live in-page evaluate path failed (context destroyed
  // even after one retry). When true we lean on the served-HTML fallback.
  let liveEvaluateFailed = false;

  // The globals/jsonLd/meta read is the evaluate that historically crashed
  // the *entire* page extraction on Pro Gallery pages (it was unguarded).
  // Route it through evaluateWithRetry and degrade to an empty shell on a
  // second failure so the served-HTML fallback below can still salvage the
  // page instead of the whole URL erroring out.
  let browserData: {
    globals: Record<string, unknown>;
    jsonLd: unknown[];
    meta: PageMeta;
  };
  try {
    browserData = await evaluateWithRetry<{
      globals: Record<string, unknown>;
      jsonLd: unknown[];
      meta: PageMeta;
    }>(() => {
    const result: Record<string, unknown> = {};

    const knownGlobals = [
      '__WIX_DATA__',
      '__SITE_DATA__',
      'wixBiSession',
      '__wixInjectedPageData',
    ];
    const win = window as unknown as Record<string, unknown>;
    for (const g of knownGlobals) {
      if (win[g]) {
        result[g] = win[g];
      }
    }

    for (const key of Object.keys(window)) {
      if ((key.startsWith('__WIX') || key.startsWith('_wix')) && !result[key]) {
        try {
          result[key] = win[key];
        } catch {
          // skip inaccessible
        }
      }
    }

    const jsonLd = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    )
      .map((s) => {
        try {
          return JSON.parse(s.textContent || '');
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const meta = {
      title: document.title,
      description:
        (document.querySelector('meta[name="description"]') as HTMLMetaElement | null)
          ?.content || '',
      ogTitle:
        (document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null)
          ?.content || '',
      ogDescription:
        (
          document.querySelector(
            'meta[property="og:description"]'
          ) as HTMLMetaElement | null
        )?.content || '',
      ogImage:
        (document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null)
          ?.content || '',
      canonical:
        (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)
          ?.href || '',
    };

    return { globals: result, jsonLd, meta };
    });
  } catch {
    // Even after one retry the context was destroyed (or another error).
    // Degrade to an empty shell; the served-HTML fallback below recovers
    // title/content/images so the page still yields something.
    browserData = { globals: {}, jsonLd: [], meta: emptyMeta() };
    liveEvaluateFailed = true;
  }

  let renderedContent: string | null = null;
  try {
    renderedContent = await evaluateWithRetry<string | null>(() => {
      const mainEl = document.querySelector('main')
        || document.querySelector('#PAGES_CONTAINER')
        || document.querySelector('#SITE_PAGES');
      if (!mainEl) return null;

      const richTextEls = mainEl.querySelectorAll('[data-testid="richTextElement"]');
      if (richTextEls.length === 0) return null;

      const blocks: string[] = [];
      const seen = new Set<string>();

      richTextEls.forEach((el) => {
        const children = el.querySelectorAll('h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote');
        if (children.length > 0) {
          children.forEach((child) => {
            const text = (child as HTMLElement).innerText?.trim();
            if (!text || seen.has(text)) return;
            seen.add(text);
            const tag = child.tagName.toLowerCase();
            if (tag.startsWith('h')) {
              blocks.push(`<${tag}>${text}</${tag}>`);
            } else if (tag === 'ul' || tag === 'ol') {
              blocks.push((child as HTMLElement).outerHTML);
            } else if (tag === 'blockquote') {
              blocks.push(`<blockquote>${text}</blockquote>`);
            } else {
              blocks.push(`<p>${text}</p>`);
            }
          });
        } else {
          const text = (el as HTMLElement).innerText?.trim();
          if (text && !seen.has(text)) {
            seen.add(text);
            blocks.push(`<p>${text}</p>`);
          }
        }
      });

      const images = mainEl.querySelectorAll('img[src*="wixstatic"], img[src*="wixmp"], [data-testid="image"] img');
      images.forEach((img) => {
        const src = (img as HTMLImageElement).src;
        const alt = (img as HTMLImageElement).alt || '';
        if (src && !seen.has(src)) {
          seen.add(src);
          blocks.push(`<img src="${src}" alt="${alt}" />`);
        }
      });

      return blocks.length > 0 ? blocks.join('\n') : null;
    });
  } catch {
    // DOM extraction failed
  }

  // Wix typed-blog feed pages (the post-listing page rendered by the Wix
  // Blog widget) carry a stable [data-hook="feed-page-root"] container
  // at the top of the feed. Verified across two independent Wix sites
  // that diverge on theme; absent on regular pages and on custom-styled
  // pages that look archive-like but don't use the typed-blog widget.
  // High-precision signal — false negatives acceptable (sites not using
  // the widget go untagged), false positives unlikely.
  let pageType: string | null = null;
  try {
    const isBlogArchive = await evaluateWithRetry<boolean>(
      () => !!document.querySelector('[data-hook="feed-page-root"]')
    );
    if (isBlogArchive) pageType = 'blog_archive';
  } catch {
    // detection failed; leave pageType unset
  }

  let accessibility: Array<{ role: string; name: string; description?: string }> | null =
    null;
  try {
    const client = await p.context().newCDPSession(page);
    const axResult = (await client.send('Accessibility.getFullAXTree', {
      depth: 10,
    })) as { nodes?: Array<{ role?: { value: string }; name?: { value: string }; description?: { value: string } }> };
    const textNodes = (axResult.nodes || [])
      .filter((n) =>
        [
          'heading',
          'paragraph',
          'StaticText',
          'link',
          'img',
          'list',
          'listitem',
          'article',
          'main',
          'section',
        ].includes(n.role?.value || '')
      )
      .map((n) => ({
        role: n.role?.value || '',
        name: n.name?.value || '',
        description: n.description?.value,
      }))
      .filter((n) => n.name);
    accessibility = textNodes;
    await client.detach();
  } catch {
    // CDP session failed
  }

  let pageHtml = '';
  try {
    pageHtml = await p.content();
  } catch {
    // content() failed (e.g. context destroyed). Fall back to a plain GET of
    // the served HTML — Wix server-renders the page (and the Pro Gallery's
    // embedded media), so a bare fetch still yields parseable markup.
    pageHtml = (await fetchHtml(url)) || '';
  }

  // If the live evaluate path failed *and* the in-browser HTML is also thin,
  // make sure we at least have the served HTML to parse for gallery data.
  if (liveEvaluateFailed && pageHtml.length < 2000) {
    pageHtml = (await fetchHtml(url)) || pageHtml;
  }

  const mediaUrls: string[] = extractImageUrls({
    apiCalls: captured.apiCalls,
    globals: browserData.globals,
    jsonLd: browserData.jsonLd,
    meta: browserData.meta,
    accessibility,
    pageHtml,
  });

  let { content, qualityScore } = deriveContent({
    apiCalls: captured.apiCalls,
    jsonLd: browserData.jsonLd,
    renderedContent,
    accessibility,
    meta: browserData.meta,
  });

  // Pro Gallery / served-HTML fallback. When the live extract produced no
  // usable content or no images (the failure mode for Pro Gallery pages
  // whose execution context was destroyed mid-evaluate), recover gallery
  // images + a content shell from the served HTML so the page is never
  // dropped entirely. `extractImageUrls` already scans pageHtml for <img>
  // src + background URLs; this adds the warmup-data media tokens and a
  // title/heading content shell that the live read missed.
  if (pageHtml) {
    const gallery = extractGalleryFromHtml(pageHtml);
    if (mediaUrls.length === 0 && gallery.mediaUrls.length > 0) {
      mediaUrls.push(...gallery.mediaUrls);
    } else {
      // Always fold in any token-derived URLs the live scan didn't have.
      const have = new Set(mediaUrls);
      for (const u of gallery.mediaUrls) if (!have.has(u)) mediaUrls.push(u);
    }
    if ((!content || content.length < 30) && gallery.content) {
      content = gallery.content;
      qualityScore = 'low';
    }
    // Backfill a title/description into meta if the live read came up empty,
    // so the WXR item gets a real title instead of the URL slug.
    if (!browserData.meta.title && !browserData.meta.ogTitle && gallery.title) {
      browserData.meta.ogTitle = gallery.title;
    }
  }

  // Recover the post's author-set cover image from BlogPosting JSON-LD.
  // Set only when the page is actually a post; absent on regular pages.
  const featuredImage = extractFeaturedImageFromJsonLd(browserData.jsonLd);

  return {
    sourceUrl: url,
    slug: slugify(url),
    extractedAt: new Date().toISOString(),
    apiCalls: captured.apiCalls,
    globals: browserData.globals,
    jsonLd: browserData.jsonLd,
    meta: browserData.meta,
    accessibility,
    mediaUrls,
    content,
    qualityScore,
    pageHtml,
    ...(pageType ? { pageType } : {}),
    ...(featuredImage ? { featuredImage } : {}),
  };
}
