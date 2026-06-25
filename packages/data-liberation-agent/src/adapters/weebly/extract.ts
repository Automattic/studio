import type { WxrBuilder } from '../../lib/wxr/index.js';
import type { ExtractionLog } from '../../lib/resume-state/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { runExtractionLoop } from '../shared.js';
import { slugify } from '../../lib/url/index.js';
import { extractMeta, extractTitle, IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';
import { WooProductCsvBuilder } from '../../lib/woo-csv/index.js';
import { extractContent, extractHeading, extractWeeblyDate, extractWeeblyCategories, resolveRelativeUrls } from './content.js';
import { extractWeeblyMediaUrls } from './media.js';
import { extractWeeblyProduct } from './products.js';
import type { WeeblyInventory, WeeblyAdapterOpts } from './types.js';

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

export async function extractWeebly(
  inventory: unknown,
  wxr: WxrBuilder,
  opts: Record<string, unknown>,
  context: { log: ExtractionLog; server: Server }
): Promise<{
  pagesExtracted: number;
  postsExtracted: number;
  productsExtracted: number;
  failed: number;
  mediaCollected: number;
}> {
  const inv = inventory as WeeblyInventory;
  const wbOpts = opts as WeeblyAdapterOpts;
  const delayMs = wbOpts.delay != null ? wbOpts.delay : 300;
  const outputDir = wbOpts.outputDir || '';

  const csvBuilder = new WooProductCsvBuilder();
  if (outputDir && !wbOpts.dryRun) {
    csvBuilder.openStream(outputDir);
  }

  const result = await runExtractionLoop({
    urls: inv.urls,
    navigation: inv.navigation,
    wxr,
    log: context.log,
    outputDir,
    delay: delayMs,
    dryRun: !!wbOpts.dryRun,
    resume: !!wbOpts.resume,
    verbose: wbOpts.verbose,
    limit: wbOpts.limit as number | undefined,
    server: context.server,
    csvBuilder,
    onPageExtracted: wbOpts.onPageExtracted as never,
    extractPage: async (url: string) => {
      // Fetch the page HTML
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)',
        },
      });
      if (!resp.ok) {
        await resp.body?.cancel();
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }
      const html = await resp.text();

      // Extract content and resolve relative URLs to absolute so WordPress
      // can match attachment URLs during import (rewrites src="/uploads/..." etc.)
      const content = resolveRelativeUrls(extractContent(html), url);
      const title = extractHeading(html) || slugify(url);
      const excerpt = extractMeta(html, 'og:description') || extractMeta(html, 'description') || '';
      const seoTitle = extractMeta(html, 'og:title') || extractTitle(html) || title;
      const seoDescription = excerpt;

      // Extract date
      const date = extractWeeblyDate(html);

      // Extract media
      const mediaUrls = extractWeeblyMediaUrls(html);

      // Extract OG image
      const ogImage = extractMeta(html, 'og:image');
      if (ogImage && ogImage.startsWith('http') && !mediaUrls.includes(ogImage)) {
        try {
          if (IMAGE_EXTENSIONS.test(new URL(ogImage).pathname)) {
            mediaUrls.push(ogImage);
          }
        } catch { /* invalid URL */ }
      }

      // Extract categories from blog posts
      const categories = extractWeeblyCategories(html);

      // Quality score based on content length
      const textOnly = content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      let qualityScore: 'high' | 'medium' | 'low' = 'low';
      if (textOnly.length > 200) qualityScore = 'high';
      else if (textOnly.length > 50) qualityScore = 'medium';

      return {
        title,
        slug: slugify(url),
        content,
        excerpt,
        date,
        seoTitle,
        seoDescription,
        mediaUrls,
        qualityScore,
        categories,
        tags: [],
      };
    },
    extractProduct: extractWeeblyProduct,
  });

  if (result.productsExtracted > 0 && outputDir && !wbOpts.dryRun) {
    if (csvBuilder.isStreaming) {
      csvBuilder.closeStream();
    } else {
      csvBuilder.serialize(`${outputDir}/products.csv`);
    }
  }

  return result;
}
