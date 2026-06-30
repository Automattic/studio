import type { WxrBuilder } from '../../lib/wxr/index.js';
import type { ExtractionLog } from '../../lib/resume-state/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { classifyUrl } from '../../lib/extraction/sitemap.js';
import { runExtractionLoop } from '../shared.js';
import { slugify } from '../../lib/url/index.js';
import { launchBrowser } from '../../lib/browser-kit/index.js';
import { WooProductCsvBuilder } from '../../lib/woo-csv/index.js';
import type { WooProduct } from '../../lib/woo-csv/index.js';
import type { SquarespaceInventory, SquarespaceAdapterOpts } from './types.js';
import { fetchSqsJson, extractSquarespaceMediaUrls, sqsTimestampToIso, extractDomContent } from './content.js';

// ---------------------------------------------------------------------------
// Squarespace product extraction via ?format=json
// ---------------------------------------------------------------------------

async function extractSquarespaceProduct(url: string): Promise<WooProduct | null> {
  const json = await fetchSqsJson(url);
  const item = json?.item;
  if (!item) return null;

  const sc = item.structuredContent as Record<string, unknown> | undefined;
  if (!sc) return null;

  const priceMoney = sc.priceMoney as { value?: string; currency?: string } | undefined;
  const salePriceMoney = sc.salePriceMoney as { value?: string; currency?: string } | undefined;
  const onSale = sc.onSale as boolean | undefined;

  const variants = (sc.variants as Array<{
    sku?: string;
    priceMoney?: { value?: string };
    optionValues?: Array<{ value?: string; optionName?: string }>;
    stock?: { quantity?: number; unlimited?: boolean };
  }>) || [];

  // Collect images from item.items (image gallery)
  const images: string[] = [];
  const itemImages = (item as Record<string, unknown>).items as Array<{ assetUrl?: string }> | undefined;
  if (itemImages) {
    for (const img of itemImages) {
      if (img.assetUrl) images.push(img.assetUrl);
    }
  }
  if (item.assetUrl && !images.includes(item.assetUrl)) {
    images.unshift(item.assetUrl);
  }

  const isVariable = variants.length > 1;
  const price = priceMoney?.value || '';
  const salePrice = onSale && salePriceMoney?.value && salePriceMoney.value !== '0.00' ? salePriceMoney.value : undefined;

  const parent: WooProduct = {
    name: item.title || '',
    type: isVariable ? 'variable' : 'simple',
    sku: isVariable ? '' : (variants[0]?.sku || ''),
    published: true,
    description: item.body || '',
    regularPrice: isVariable ? '' : price,
    salePrice: isVariable ? undefined : salePrice,
    images,
    categories: item.categories || [],
    tags: item.tags || [],
    sourceUrl: url,
  };

  // Build option names for attributes
  const optionOrdering = (sc.variantOptionOrdering as string[]) || [];
  if (optionOrdering.length > 0 && isVariable) {
    const optionValues = new Map<string, Set<string>>();
    for (const name of optionOrdering) optionValues.set(name, new Set());
    for (const v of variants) {
      for (const ov of v.optionValues || []) {
        if (ov.optionName && ov.value) {
          optionValues.get(ov.optionName)?.add(ov.value);
        }
      }
    }
    parent.attributes = optionOrdering.map((name) => ({
      name,
      values: [...(optionValues.get(name) || [])],
      visible: true,
      global: false,
    }));
  }

  return parent;
}

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
  const inv = inventory as SquarespaceInventory;
  const sqOpts = opts as SquarespaceAdapterOpts;
  const delayMs = sqOpts.delay != null ? sqOpts.delay : 300;

  // Launch browser lazily — only if a page needs DOM fallback
  let browserSession: { page: unknown; close: () => Promise<void> } | null = null;

  async function getBrowserPage(): Promise<unknown> {
    if (!browserSession) {
      const session = await launchBrowser({ cdpPort: sqOpts.cdpPort });
      browserSession = { page: session.page, close: () => session.close() };
    }
    return browserSession.page;
  }

  const outputDir = sqOpts.outputDir || '';
  const csvBuilder = new WooProductCsvBuilder();
  if (outputDir && !sqOpts.dryRun) {
    csvBuilder.openStream(outputDir);
  }

  try {
    const result = await runExtractionLoop({
      urls: inv.urls,
      navigation: inv.navigation,
      wxr,
      log: context.log,
      outputDir,
      delay: delayMs,
      dryRun: !!sqOpts.dryRun,
      resume: !!sqOpts.resume,
      verbose: sqOpts.verbose,
      limit: sqOpts.limit,
      server: context.server,
      csvBuilder,
      onPageExtracted: sqOpts.onPageExtracted as never,
      extractPage: async (url: string) => {
        const json = await fetchSqsJson(url);

        const item = json?.item;
        const collection = json?.collection;

        let body = item?.body || collection?.mainContent || '';
        let title = item?.title || collection?.title || slugify(url);
        const excerpt = item?.excerpt || collection?.description || '';
        const date = sqsTimestampToIso(item?.publishOn || item?.addedOn);
        const seoTitle = item?.seoData?.seoTitle || title;
        const seoDescription = item?.seoData?.seoDescription || excerpt;
        const categories = item?.categories || [];
        const tags = item?.tags || [];

        let mediaUrls = extractSquarespaceMediaUrls(body, item?.assetUrl);

        // Check if JSON content is empty/stub (Squarespace 7.1 Fluid Engine returns
        // structural HTML like sqs-layout/sqs-block divs with no actual text content)
        const textOnly = body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        const isEmptyContent = !body || body.includes('columns-12 empty') || textOnly.length < 50;

        if (isEmptyContent) {
          // Fall back to Playwright DOM extraction
          try {
            const page = await getBrowserPage();
            const domResult = await extractDomContent(page, url);
            if (domResult.content) {
              body = domResult.content;
              mediaUrls = [
                ...mediaUrls,
                ...extractSquarespaceMediaUrls(domResult.content),
                ...domResult.mediaUrls,
              ];
              // Deduplicate
              mediaUrls = [...new Set(mediaUrls)];
            }
            if (domResult.title && title === slugify(url)) {
              title = domResult.title;
            }
          } catch {
            // Playwright not available or DOM extraction failed — continue with what we have
          }
        }

        const bodyText = body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        let qualityScore: 'high' | 'medium' | 'low' = 'low';
        if (bodyText.length > 200) qualityScore = 'high';
        else if (bodyText.length > 50) qualityScore = 'medium';

        const author = item?.author?.displayName || undefined;

        return {
          title,
          slug: slugify(url),
          content: body,
          excerpt,
          date,
          seoTitle,
          seoDescription,
          mediaUrls,
          qualityScore,
          categories,
          tags,
          author,
        };
      },
      extractProduct: (_url: string, _html: string) => {
        // Return null — we handle products asynchronously below
        return null;
      },
    });

    // Extract products from Squarespace JSON API for product URLs
    const productUrls = inv.urls.filter((u) => classifyUrl(u.url) === 'product');
    for (const pu of productUrls) {
      if (sqOpts.dryRun) break;
      try {
        const product = await extractSquarespaceProduct(pu.url);
        if (product && product.name) {
          csvBuilder.addProduct(product);
          result.productsExtracted++;
        }
      } catch {
        // product extraction failed — non-fatal
      }
    }

    if (result.productsExtracted > 0 && outputDir && !sqOpts.dryRun) {
      if (csvBuilder.isStreaming) {
        csvBuilder.closeStream();
      } else {
        csvBuilder.serialize(`${outputDir}/products.csv`);
      }
    }

    return result;
  } finally {
    if (browserSession) await (browserSession as NonNullable<typeof browserSession>).close();
  }
}
