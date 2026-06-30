import type { WxrBuilder } from '../../lib/wxr/index.js';
import type { ExtractionLog } from '../../lib/resume-state/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Browser, BrowserContext, Page } from 'playwright';
import { runExtractionLoop } from '../shared.js';
import { slugify } from '../../lib/url/index.js';
import { extractMeta, extractTitle, extractHeading } from '../../lib/html-extract/index.js';
import { launchBrowser } from '../../lib/browser-kit/index.js';
import type { ExtractedPage } from '../shared.js';
import { WooProductCsvBuilder } from '../../lib/woo-csv/index.js';
import { extractMainContent, parseJsonLd, detectTypeFromJsonLd, productLdJsonScript } from './content.js';
import { extractMediaUrls } from './media.js';
import type { DefaultInventory, DefaultAdapterOpts } from './types.js';

const UA = 'Mozilla/5.0 (compatible; DataLiberation/1.0)';

/** Plain HTTP fetch — used as the no-browser path and as a per-URL render fallback. */
async function fetchHtml(url: string): Promise<string> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': UA } });
    if (resp.ok) return await resp.text();
    await resp.body?.cancel();
  } catch {
    // Network error.
  }
  return '';
}

/** Render a URL in its own tab (closed after use) and return the post-JS HTML. */
async function renderHtml(context: BrowserContext, url: string): Promise<string> {
  const page: Page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(800).catch(() => {});
    return await page.content();
  } catch {
    return '';
  } finally {
    await page.close().catch(() => {});
  }
}

function dateFrom(html: string, jsonLd: unknown[]): string {
  const meta = extractMeta(html, 'article:published_time');
  if (meta) return meta;
  const timeEl = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  if (timeEl) return timeEl;
  for (const n of jsonLd) {
    const d = (n as Record<string, unknown>)['datePublished'];
    if (typeof d === 'string') return d;
  }
  return '';
}

function authorFrom(html: string, jsonLd: unknown[]): string | undefined {
  const meta = extractMeta(html, 'article:author');
  if (meta) return meta;
  for (const n of jsonLd) {
    const a = (n as Record<string, unknown>)['author'];
    if (typeof a === 'string') return a;
    if (a && typeof a === 'object') {
      const name = (a as Record<string, unknown>)['name'];
      if (typeof name === 'string') return name;
    }
  }
  return undefined;
}

/** Assemble an ExtractedPage from a page's HTML using the tested pure extractors. */
function buildExtractedPage(url: string, html: string): ExtractedPage {
  const baseContent = extractMainContent(html);
  const jsonLd = parseJsonLd(html);
  const detectedType = detectTypeFromJsonLd(jsonLd);

  const title = extractHeading(html) || slugify(url);
  const excerpt = extractMeta(html, 'og:description') || extractMeta(html, 'description') || '';
  const seoTitle = extractMeta(html, 'og:title') || extractTitle(html) || title;
  const mediaUrls = extractMediaUrls(html, url);

  // The shared loop's product extractor reads JSON-LD out of `content`, but our
  // content extraction strips <script> for clean prose. Re-attach the Product
  // script (only) so products are detected without a custom extractProduct.
  const prodScript = productLdJsonScript(jsonLd);
  const content = prodScript ? baseContent + '\n' + prodScript : baseContent;

  let qualityScore: 'high' | 'medium' | 'low' = 'low';
  if (baseContent.length > 200) qualityScore = 'high';
  else if (baseContent.length > 50) qualityScore = 'medium';

  return {
    title,
    slug: slugify(url),
    content,
    excerpt,
    date: dateFrom(html, jsonLd),
    seoTitle,
    seoDescription: excerpt,
    mediaUrls,
    qualityScore,
    categories: [],
    tags: [],
    author: authorFrom(html, jsonLd),
    detectedType,
    jsonLd,
  };
}

export async function extractDefault(
  inventory: unknown,
  wxr: WxrBuilder,
  opts: Record<string, unknown>,
  context: { log: ExtractionLog; server: Server },
): Promise<{
  pagesExtracted: number;
  postsExtracted: number;
  productsExtracted: number;
  failed: number;
  mediaCollected: number;
}> {
  const inv = inventory as DefaultInventory;
  const o = opts as DefaultAdapterOpts;
  const delayMs = o.delay != null ? o.delay : 300;
  const outputDir = o.outputDir || '';
  const useRender = o.render !== false;

  const csvBuilder = new WooProductCsvBuilder();
  if (outputDir && !o.dryRun) {
    csvBuilder.openStream(outputDir);
  }

  // One render browser for the whole run; degrade to plain fetch if it can't
  // launch (no browser installed, sandboxed). Each URL renders in its own tab,
  // closed after use, so concurrent batch fetches stay isolated and memory
  // stays bounded across long runs.
  let browser: Browser | null = null;
  let pwContext: BrowserContext | null = null;
  if (useRender) {
    try {
      const launched = await launchBrowser({ cdpPort: o.cdpPort });
      browser = launched.browser as unknown as Browser;
      pwContext = browser.contexts()[0] || (await browser.newContext());
    } catch {
      browser = null;
      pwContext = null;
    }
  }

  try {
    const result = await runExtractionLoop({
      urls: inv.urls,
      navigation: inv.navigation,
      wxr,
      log: context.log,
      outputDir,
      delay: delayMs,
      dryRun: !!o.dryRun,
      resume: !!o.resume,
      verbose: o.verbose,
      limit: o.limit,
      server: context.server,
      csvBuilder,
      onPageExtracted: o.onPageExtracted as never,
      extractPage: async (url: string) => {
        let html = pwContext ? await renderHtml(pwContext, url) : '';
        if (!html) html = await fetchHtml(url);
        return buildExtractedPage(url, html);
      },
    });

    if (result.productsExtracted > 0 && outputDir && !o.dryRun) {
      if (csvBuilder.isStreaming) {
        csvBuilder.closeStream();
      } else {
        csvBuilder.serialize(outputDir + '/products.csv');
      }
    }

    return result;
  } finally {
    await browser?.close().catch(() => {});
  }
}
