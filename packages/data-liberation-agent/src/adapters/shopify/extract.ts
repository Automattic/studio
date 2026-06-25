import type { WxrBuilder } from '../../lib/wxr/index.js';
import type { ExtractionLog } from '../../lib/resume-state/index.js';
import { ImportSession } from '../../lib/resume-state/index.js';
import {
  ShopifyGraphqlClient,
  fetchAllProducts,
  type ShopifyGqlProduct,
} from '../../lib/extraction/shopify-graphql.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { runExtractionLoop } from '../shared.js';
import { slugify } from '../../lib/url/index.js';
import { extractMeta, extractHeading, IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';
import { WooProductCsvBuilder } from '../../lib/woo-csv/index.js';
import type { ShopifyAdapterOpts, ShopifyInventory, ShopifyArticle, ShopifyPage, ShopifyProductJson } from './types.js';
import { fetchShopifyJson } from './http.js';
import {
  scorePageQuality,
  extractShopifyContent,
  extractShopifyMediaUrls,
  extractDate,
} from './content.js';
import { shopifyProductToWoo, shopifyGraphqlProductToWoo } from './products.js';

/**
 * Extract product data from page HTML via JSON-LD or embedded product JSON.
 */
function extractProductFromHtml(html: string, sourceUrl: string) {
  // Try JSON-LD Product schema
  const ldMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldMatches) {
    const jsonStr = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
    try {
      const ld = JSON.parse(jsonStr);
      if (ld['@type'] === 'Product' && ld.name) {
        const offers = Array.isArray(ld.offers) ? ld.offers : ld.offers ? [ld.offers] : [];
        const price = offers[0]?.price ? String(offers[0].price) : '';
        const images: string[] = [];
        if (typeof ld.image === 'string') images.push(ld.image);
        else if (Array.isArray(ld.image)) {
          for (const img of ld.image) {
            if (typeof img === 'string') images.push(img);
            else if (img?.url) images.push(img.url);
          }
        }
        return {
          name: ld.name,
          description: ld.description || '',
          regularPrice: price,
          sku: ld.sku || '',
          images,
          inStock: offers[0]?.availability?.includes('InStock') ?? true,
          sourceUrl,
        };
      }
    } catch {
      // invalid JSON-LD
    }
  }

  // Try [data-product-json] or similar embedded product data
  const productJsonMatch = html.match(/data-product-json[^>]*>([\s\S]*?)<\/script>/i);
  if (productJsonMatch?.[1]) {
    try {
      const pData = JSON.parse(productJsonMatch[1]);
      if (pData.title) {
        return shopifyProductToWoo(pData as ShopifyProductJson, sourceUrl).parent;
      }
    } catch {
      // invalid JSON
    }
  }

  return null;
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
  const inv = inventory as ShopifyInventory;
  const shopifyOpts = opts as ShopifyAdapterOpts;
  const delayMs = shopifyOpts.delay != null ? shopifyOpts.delay : 300;
  const outputDir = shopifyOpts.outputDir || '';

  // Higher-level resume state (stage, args, per-entity progress, cursors).
  // Lives alongside extraction-log.jsonl; session.json captures original
  // args so a future `resume` run doesn't need them re-passed.
  const session = outputDir
    ? ImportSession.loadOrCreate(outputDir, 'shopify', shopifyOpts, { resume: !!shopifyOpts.resume })
    : undefined;

  // Product CSV builder — streams products as JSONL, builds CSV at the end
  const csvBuilder = new WooProductCsvBuilder();
  let hasProducts = false;
  if (outputDir && !shopifyOpts.dryRun) {
    csvBuilder.openStream(outputDir, { resume: !!shopifyOpts.resume });
  }

  // GraphQL fast-path: when an Admin API token is available, fetch all
  // products up-front via GraphQL. This gives us compareAtPrice, unitCost,
  // inventoryPolicy, tracked, variant media, collections, and SEO
  // metafields — data the public JSON API doesn't expose. We then strip
  // product URLs from the inventory so the URL loop doesn't reprocess them.
  const graphqlProductHandles = new Set<string>();
  if (shopifyOpts.adminToken && !shopifyOpts.dryRun) {
    // Resolve the admin hostname. Shopify Admin API only accepts the
    // myshopify.com subdomain; custom storefront domains (e.g.
    // shop.brand.com) will silently fail authentication. Preference:
    //   1. explicit shopDomain opt (user override)
    //   2. inventory.shopDomain auto-detected during discover()
    //   3. siteUrl hostname (only if it's already *.myshopify.com)
    let shopDomain = shopifyOpts.shopDomain || inv.shopDomain;
    if (!shopDomain) {
      const derived = new URL(
        inv.siteUrl.includes('://') ? inv.siteUrl : `https://${inv.siteUrl}`
      ).hostname;
      if (derived.endsWith('.myshopify.com')) {
        shopDomain = derived;
      } else {
        throw new Error(
          `Shopify GraphQL requires a *.myshopify.com host, but auto-detection ` +
          `failed and siteUrl "${derived}" is a custom domain. Pass --shop-domain ` +
          `explicitly, or re-run discover() to refresh inventory.shopDomain.`
        );
      }
    } else if (!shopDomain.endsWith('.myshopify.com')) {
      throw new Error(`shopDomain "${shopDomain}" must end in .myshopify.com`);
    }
    // Resume-idempotency: remember which handles we've already emitted
    // to the CSV across runs. Without this, a crash mid-pagination means
    // the next resume replays all prior pages as duplicate CSV rows.
    const emittedHandles: string[] = session?.getCursor<string[]>('shopify:products:emittedHandles') ?? [];
    for (const h of emittedHandles) graphqlProductHandles.add(h);

    // Compute the storefront origin for sourceUrl on emitted products.
    // Prefer inv.siteUrl (user-facing, possibly a custom domain) so the
    // stamped URL matches what the JSON-API URL-loop path would emit.
    // Fall back to the admin myshopify.com host if parsing fails.
    let storefrontOrigin: string;
    try {
      storefrontOrigin = new URL(
        inv.siteUrl.includes('://') ? inv.siteUrl : `https://${inv.siteUrl}`
      ).origin;
    } catch {
      storefrontOrigin = `https://${shopDomain}`;
    }

    try {
      const client = new ShopifyGraphqlClient({ shopDomain, accessToken: shopifyOpts.adminToken });
      await fetchAllProducts(client, {
        session,
        onBatch: (batch: ShopifyGqlProduct[]) => {
          for (const node of batch) {
            if (node.handle && graphqlProductHandles.has(node.handle)) continue;
            const productSourceUrl = node.handle
              ? `${storefrontOrigin}/products/${node.handle}`
              : undefined;
            const { parent, variations } = shopifyGraphqlProductToWoo(node, productSourceUrl);
            csvBuilder.addProduct(parent);
            for (const v of variations) csvBuilder.addProduct(v);
            hasProducts = true;
            if (node.handle) graphqlProductHandles.add(node.handle);
            if (session) session.bumpProgress('product', 'extracted');
          }
          if (session) {
            // Persist the running set so a crash doesn't re-emit.
            session.setCursor('shopify:products:emittedHandles', [...graphqlProductHandles]);
            session.save();
          }
        },
      });
      // Successful completion — clear the emitted-handles cursor so a
      // subsequent fresh run doesn't inherit stale state.
      if (session) session.setCursor('shopify:products:emittedHandles', null);
    } catch (err) {
      // GraphQL path failed — fall back to JSON API via the URL loop below.
      const msg = err instanceof Error ? err.message : String(err);
      context.server?.sendLoggingMessage?.({
        level: 'warning',
        data: `Shopify GraphQL fetch failed, falling back to JSON API: ${msg}`,
      });
    }
  }

  // Strip products already handled by GraphQL so the URL loop doesn't
  // reprocess them. We mutate the inventory in-place for this run.
  if (graphqlProductHandles.size > 0) {
    inv.urls = inv.urls.filter((u) => {
      if (u.type !== 'product') return true;
      const handle = u.url.match(/\/products\/([^/?#]+)/)?.[1];
      return !handle || !graphqlProductHandles.has(handle);
    });
  }

  // Build a set of product URLs for quick lookup
  const productUrls = new Set(
    inv.urls.filter((u) => u.type === 'product').map((u) => u.url)
  );

  // Lazy-init browser session for CDP/headed fallback on 403s
  let browserSession: { page: unknown; close: () => Promise<void> } | null = null;
  async function getBrowserPage(): Promise<unknown> {
    if (!browserSession) {
      const { launchBrowser } = await import('../../lib/browser-kit/index.js');
      // Prefer user-provided CDP port; otherwise auto-launch headed Chromium
      // (headed bypasses Cloudflare bot detection that blocks headless)
      const session = await launchBrowser(
        shopifyOpts.cdpPort ? { cdpPort: shopifyOpts.cdpPort } : { headed: true }
      );
      browserSession = { page: session.page, close: () => session.close() };
    }
    return browserSession.page;
  }

  let result;
  try {
  result = await runExtractionLoop({
    urls: inv.urls,
    navigation: inv.navigation,
    wxr,
    log: context.log,
    outputDir,
    delay: delayMs,
    dryRun: !!shopifyOpts.dryRun,
    resume: !!shopifyOpts.resume,
    verbose: shopifyOpts.verbose,
    limit: shopifyOpts.limit as never,
    server: context.server,
    csvBuilder,
    session,
    onPageExtracted: shopifyOpts.onPageExtracted as never,
    extractPage: async (url: string) => {
      // Tier 1: Try JSON API — append .json to URL
      let title = '';
      let content = '';
      let excerpt = '';
      let date = '';
      let tags: string[] = [];
      let categories: string[] = [];
      let mediaUrls: string[] = [];
      let jsonSuccess = false;
      let productHandled = false; // tracks whether CSV builder already has this product
      let detectedType: 'product' | 'post' | 'page' | undefined;
      let author: string | undefined;

      // Check if this URL is a product
      const isProduct = productUrls.has(url) || /\/products\//.test(url);

      try {
        const jsonUrl = url.replace(/\/?$/, '') + '.json';
        const jsonResp = await fetchShopifyJson<Record<string, unknown>>(jsonUrl);

        if (jsonResp) {
          const article = jsonResp.article as ShopifyArticle | undefined;
          const page = jsonResp.page as ShopifyPage | undefined;
          const product = jsonResp.product as ShopifyProductJson | undefined;

          if (product?.title) {
            // Product JSON found — add to CSV builder for WooCommerce export
            detectedType = 'product';
            const { parent, variations } = shopifyProductToWoo(product, url);
            csvBuilder.addProduct(parent);
            for (const variation of variations) {
              csvBuilder.addProduct(variation);
            }
            hasProducts = true;
            productHandled = true;

            // Collect JSON metadata — but DON'T set jsonSuccess so we
            // fall through to HTML for richer page content (product pages
            // typically have section-based content far beyond body_html).
            title = product.title;
            content = product.body_html || '';
            tags = product.tags
              ? product.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
              : [];
            categories = product.product_type ? [product.product_type] : [];
            mediaUrls = parent.images ? [...parent.images] : [];
            mediaUrls.push(...extractShopifyMediaUrls(content));
          } else if (article?.body_html) {
            title = article.title;
            content = article.body_html;
            excerpt = article.summary_html || article.body_html.replace(/<[^>]*>/g, '').slice(0, 200);
            date = article.published_at || '';
            author = article.author || undefined;
            tags = article.tags ? article.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
            if (article.image?.src) {
              mediaUrls.push(article.image.src);
            }
            mediaUrls.push(...extractShopifyMediaUrls(content));
            jsonSuccess = true;
          } else if (page?.body_html) {
            title = page.title;
            content = page.body_html;
            date = page.published_at || '';
            author = page.author || undefined;
            mediaUrls.push(...extractShopifyMediaUrls(content));
            jsonSuccess = true;
          }

          // Thin-content gate: if JSON returned very little actual text,
          // mark as not successful so we fall through to HTML extraction.
          // Keep JSON metadata (title, date, tags, author) but replace content.
          if (jsonSuccess) {
            const strippedText = content.replace(/<[^>]*>/g, '').trim();
            if (strippedText.length < 100) {
              jsonSuccess = false;
            }
          }
        }
      } catch {
        // JSON failed — fall through to HTML
      }

      // Tier 2: Fall back to HTML parsing, or supplement thin JSON content
      const isBlogPost = /\/blogs\//.test(url);
      const needsHtml = !jsonSuccess || isBlogPost;
      if (needsHtml) {
        let html = '';
        let needsBrowser = false;
        try {
          const resp = await fetch(url, {
            signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)' },
          });
          if (resp.ok) {
            html = await resp.text();
            // Detect Cloudflare challenge pages served with 200 status
            if (html.includes('Just a moment...') && html.includes('cf_chl_opt')) {
              html = '';
              needsBrowser = true;
            }
          } else {
            await resp.body?.cancel();
            if (resp.status === 403) needsBrowser = true;
          }
        } catch {
          // Network error
        }

        // Tier 3: browser fallback for blocked pages (Cloudflare, bot protection)
        // Uses CDP if cdpPort provided, otherwise auto-launches headed Chromium
        if (needsBrowser && !html) {
          try {
            const page = await getBrowserPage() as import('playwright').Page;
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            html = await page.content();
          } catch {
            // Browser extraction failed — continue with empty html
          }
        }

        if (!jsonSuccess) {
          // Full HTML fallback — replace all content from HTML
          // Try to extract product data from HTML structured data (JSON-LD, microdata)
          // Skip if we already handled the product via JSON API
          if (!productHandled) {
            const wooProduct = extractProductFromHtml(html, url);
            if (wooProduct) {
              detectedType = 'product';
              csvBuilder.addProduct(wooProduct);
              hasProducts = true;
            }
          }

          const htmlContent = extractShopifyContent(html);
          // Only replace content if HTML actually has more
          if (htmlContent.replace(/<[^>]*>/g, '').trim().length > content.replace(/<[^>]*>/g, '').trim().length) {
            content = htmlContent;
          }
          // Only replace metadata if we didn't get it from JSON
          if (!title) title = extractHeading(html) || '';
          if (!excerpt) excerpt = extractMeta(html, 'og:description') || extractMeta(html, 'description') || '';
          if (!date) date = extractDate(html);
          // Merge HTML media with any JSON media already collected
          const htmlMedia = extractShopifyMediaUrls(html);
          for (const m of htmlMedia) {
            if (!mediaUrls.includes(m)) mediaUrls.push(m);
          }
        }

        // Always extract OG image (covers blog featured images and general cases)
        if (html) {
          const ogImage = extractMeta(html, 'og:image');
          if (ogImage && ogImage.startsWith('http') && !mediaUrls.includes(ogImage)) {
            try {
              if (IMAGE_EXTENSIONS.test(new URL(ogImage).pathname)) {
                // Prepend OG image so it becomes the featured image
                mediaUrls.unshift(ogImage);
              }
            } catch { /* invalid URL */ }
          }
        }
      }

      if (!title) title = slugify(url);

      const seoTitle = title;
      const seoDescription = excerpt;

      // Deduplicate media
      mediaUrls = [...new Set(mediaUrls)];

      // Quality score
      const qualityScore = scorePageQuality({
        title,
        content,
        images: mediaUrls,
        date,
        hasStructuredData: jsonSuccess,
        hasPriceSku: detectedType === 'product',
      });

      // isProduct is computed above but TypeScript needs the variable used to avoid unused-var warnings
      void isProduct;

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
        tags,
        detectedType,
        author,
      };
    },
  });

  // Finalize product CSV — reads JSONL and writes CSV
  if (hasProducts && outputDir && !shopifyOpts.dryRun) {
    if (csvBuilder.isStreaming) {
      csvBuilder.closeStream();
    } else {
      csvBuilder.serialize(`${outputDir}/products.csv`);
    }
  }

  if (session) session.complete();
  return result;
  } catch (err) {
    // Swallow any secondary error from persisting the failure state so the
    // original exception reaches the caller unmasked.
    if (session) {
      try {
        session.setStage('error', err instanceof Error ? err.message : String(err));
      } catch { /* disk full, etc. — don't shadow the real error */ }
    }
    throw err;
  } finally {
    if (browserSession) await (browserSession as { close: () => Promise<void> }).close();
  }
}
