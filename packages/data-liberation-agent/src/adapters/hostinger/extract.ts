import type { WxrBuilder } from '../../lib/wxr/index.js';
import type { ExtractionLog } from '../../lib/resume-state/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { runExtractionLoop } from '../shared.js';
import { slugify } from '../../lib/url/index.js';
import { extractMeta, extractTitle, IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';
import { WooProductCsvBuilder } from '../../lib/woo-csv/index.js';
import type { WooProduct } from '../../lib/woo-csv/index.js';
import { extractJsonLdBlocks, findJsonLdByType, jsonLdToWooProduct } from './products.js';
import { extractContent, extractHeading, stripDuplicateTitle, resolveRelativeUrls } from './content.js';
import { extractHostingerMediaUrls } from './media.js';
import type { HostingerAdapterOpts, HostingerInventory } from './types.js';

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

export async function extract(
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
  const inv = inventory as HostingerInventory;
  const hoOpts = opts as HostingerAdapterOpts;
  const delayMs = hoOpts.delay != null ? hoOpts.delay : 300;
  const outputDir = hoOpts.outputDir || '';

  const csvBuilder = new WooProductCsvBuilder();
  if (outputDir && !hoOpts.dryRun) {
    csvBuilder.openStream(outputDir);
  }

  // Cache product data extracted during extractPage (where we have the full
  // HTML including JSON-LD scripts from <head>). The shared loop's
  // extractProduct callback looks up by URL rather than re-fetching.
  const productCache = new Map<string, WooProduct>();

  const result = await runExtractionLoop({
    urls: inv.urls,
    navigation: inv.navigation,
    wxr,
    log: context.log,
    outputDir,
    delay: delayMs,
    dryRun: !!hoOpts.dryRun,
    resume: !!hoOpts.resume,
    verbose: hoOpts.verbose,
    limit: hoOpts.limit as number | undefined,
    server: context.server,
    csvBuilder,
    onPageExtracted: hoOpts.onPageExtracted as never,
    extractPage: async (url: string) => {
      // Fetch the page HTML, throwing on non-200 so the loop logs the failure.
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

      // Extract structured data — Hostinger blog posts include rich JSON-LD
      const ldBlocks = extractJsonLdBlocks(html);
      const article = findJsonLdByType(ldBlocks, /^(Article|BlogPosting|NewsArticle)$/);
      const product = findJsonLdByType(ldBlocks, /^Product$/);

      // Detect product pages: Hostinger marks them with a .block-product wrapper
      // and/or a JSON-LD Product schema. Both signals are reliable.
      const isProduct = !!product || /class=["'][^"']*\bblock-product(?:-wrapper)?\b/.test(html);

      // Cache product data for the shared loop's extractProduct callback.
      // The callback only receives pageData.content (stripped of <head>),
      // so we extract from the full HTML here where JSON-LD is still available.
      if (isProduct && product) {
        const wooProduct = jsonLdToWooProduct(product, url);
        if (wooProduct) productCache.set(url, wooProduct);
      }

      // Title: prefer JSON-LD headline, then h1/og:title/title
      const title =
        (article?.headline as string) ||
        extractHeading(html) ||
        slugify(url);

      // Extract content, strip the duplicate title h1, and resolve relative URLs
      // for WordPress import compatibility. Title is stripped so the rendered
      // page doesn't show "My Title" above "My Title" (post_title + embedded h1).
      const content = resolveRelativeUrls(
        stripDuplicateTitle(extractContent(html), title),
        url
      );

      const excerpt = extractMeta(html, 'og:description') || extractMeta(html, 'description') || '';
      const seoTitle = extractMeta(html, 'og:title') || extractTitle(html) || title;
      const seoDescription = excerpt;

      // Date: prefer JSON-LD datePublished, then article:published_time meta, then <time>
      let date = (article?.datePublished as string) || '';
      if (!date) date = extractMeta(html, 'article:published_time') || '';
      if (!date) {
        const timeElement = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
        if (timeElement) date = timeElement;
      }

      // Categories: JSON-LD articleSection (may be string or array)
      let categories: string[] = [];
      const section = article?.articleSection;
      if (typeof section === 'string') {
        categories = [section];
      } else if (Array.isArray(section)) {
        categories = section.filter((s): s is string => typeof s === 'string');
      }

      // Author: JSON-LD author.name (single or array)
      let author: string | undefined;
      const ldAuthor = article?.author;
      if (ldAuthor && typeof ldAuthor === 'object') {
        if (Array.isArray(ldAuthor)) {
          const first = ldAuthor[0];
          if (first && typeof first === 'object' && typeof (first as { name?: unknown }).name === 'string') {
            author = (first as { name: string }).name;
          }
        } else if (typeof (ldAuthor as { name?: unknown }).name === 'string') {
          author = (ldAuthor as { name: string }).name;
        }
      }

      // Extract media
      const mediaUrls = extractHostingerMediaUrls(html);

      // OG image fallback
      const ogImage = extractMeta(html, 'og:image');
      if (ogImage && ogImage.startsWith('http') && !mediaUrls.includes(ogImage)) {
        try {
          const parsed = new URL(ogImage);
          if (IMAGE_EXTENSIONS.test(parsed.pathname) || /zyrosite\.com/i.test(parsed.hostname)) {
            mediaUrls.push(ogImage);
          }
        } catch { /* invalid URL */ }
      }

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
        author,
        // Signal product pages to the shared loop so they route to products.csv
        // instead of being imported as regular pages. Hostinger marks product
        // pages with .block-product wrappers and/or JSON-LD Product schema.
        detectedType: isProduct ? 'product' : undefined,
      };
    },
    extractProduct: (url: string) => productCache.get(url) ?? null,
  });

  if (result.productsExtracted > 0 && outputDir && !hoOpts.dryRun) {
    if (csvBuilder.isStreaming) {
      csvBuilder.closeStream();
    } else {
      csvBuilder.serialize(`${outputDir}/products.csv`);
    }
  }

  return result;
}
