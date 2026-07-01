import type { WxrBuilder } from '../../lib/wxr/index.js';
import type { ExtractionLog } from '../../lib/resume-state/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { runExtractionLoop } from '../shared.js';
import { launchBrowser } from '../../lib/browser-kit/index.js';
import { WooProductCsvBuilder } from '../../lib/woo-csv/index.js';
import type { WixAdapterOpts, Inventory } from './types.js';
import { extractWixPage } from './page.js';
import { extractWixProduct } from './products.js';

export async function extract(
    inventory: unknown,
    wxr: WxrBuilder,
    opts: Record<string, unknown>,
    context: { log: ExtractionLog; server: Server }
  ): Promise<{
    pagesExtracted: number;
    postsExtracted: number;
    failed: number;
    mediaCollected: number;
  }> {
    const inv = inventory as Inventory;
    const wixOpts = opts as WixAdapterOpts;
    const delayMs = wixOpts.delay != null ? wixOpts.delay : 500;
    const outputDir = wixOpts.outputDir || '';

    // Product CSV builder — streams products as JSONL, builds CSV at the end
    const csvBuilder = new WooProductCsvBuilder();
    let hasProducts = false;
    if (outputDir && !wixOpts.dryRun) {
      csvBuilder.openStream(outputDir);
    }

    // Build a set of product URLs for quick lookup
    const productUrls = new Set(
      inv.urls.filter((u) => u.type === 'product').map((u) => u.url)
    );

    // Launch browser for Wix-specific page extraction
    const { page, close } = await launchBrowser({ cdpPort: wixOpts.cdpPort });

    try {
      const result = await runExtractionLoop({
        urls: inv.urls,
        navigation: inv.navigation,
        wxr,
        log: context.log,
        outputDir,
        delay: delayMs,
        dryRun: !!wixOpts.dryRun,
        resume: !!wixOpts.resume,
        verbose: wixOpts.verbose,
        limit: wixOpts.limit,
        server: context.server,
        csvBuilder,
        onPageExtracted: wixOpts.onPageExtracted as never,
        extractPage: async (url: string) => {
          const pageData = await extractWixPage(page, url);

          // Check if this is a product page and try to extract product data
          const isProduct = productUrls.has(url) || /\/product-page\//.test(url) || /\/store\//.test(url);
          if (isProduct) {
            const wooProduct = extractWixProduct(pageData);
            if (wooProduct) {
              csvBuilder.addProduct(wooProduct);
              hasProducts = true;
            }
          }

          // Strip site-name suffix from Wix titles (e.g. "About | MySite Copy" → "About")
          const rawTitle = pageData.meta.ogTitle || pageData.meta.title || pageData.slug;
          const pipeIdx = rawTitle.lastIndexOf(' | ');
          const cleanedTitle = pipeIdx > 0 ? rawTitle.slice(0, pipeIdx).trim() : rawTitle;

          // Extract author from JSON-LD
          let author: string | undefined;
          for (const ld of pageData.jsonLd) {
            const obj = ld as Record<string, unknown>;
            const ldAuthor = obj.author as Record<string, unknown> | string | undefined;
            if (typeof ldAuthor === 'string' && ldAuthor) {
              author = ldAuthor;
              break;
            }
            if (ldAuthor && typeof ldAuthor === 'object' && typeof ldAuthor.name === 'string') {
              author = ldAuthor.name;
              break;
            }
          }

          return {
            title: cleanedTitle || pageData.slug,
            slug: pageData.slug,
            content: pageData.content,
            excerpt: pageData.meta.ogDescription || pageData.meta.description || '',
            date: pageData.extractedAt,
            seoTitle: pageData.meta.title,
            seoDescription: pageData.meta.description,
            mediaUrls: pageData.mediaUrls,
            qualityScore: pageData.qualityScore,
            author,
            jsonLd: pageData.jsonLd,
          };
        },
      });

      // Finalize product CSV — reads JSONL and writes CSV
      if (hasProducts && outputDir && !wixOpts.dryRun) {
        if (csvBuilder.isStreaming) {
          csvBuilder.closeStream();
        } else {
          csvBuilder.serialize(`${outputDir}/products.csv`);
        }
      }

      return result;
    } finally {
      await close();
    }
  }
