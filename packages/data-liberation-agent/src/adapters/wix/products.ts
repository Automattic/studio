import type { PageData } from './types.js';
import type { WooProduct } from '../../lib/woo-csv/index.js';

// ---------------------------------------------------------------------------
// Wix product extraction helper
// ---------------------------------------------------------------------------

/**
 * Try to extract WooCommerce product data from a Wix page's captured data.
 * Looks in: JSON-LD Product schema, captured API calls, window globals.
 */
export function extractWixProduct(pageData: PageData): WooProduct | null {
  // 1. JSON-LD Product schema
  for (const ld of pageData.jsonLd) {
    const obj = ld as Record<string, unknown>;
    if (obj['@type'] === 'Product' && typeof obj.name === 'string') {
      // Wix emits "Offers" (uppercase) while schema.org uses "offers" (lowercase)
      const rawOffers = obj.offers || obj.Offers;
      const offers = Array.isArray(rawOffers) ? rawOffers : rawOffers ? [rawOffers as Record<string, unknown>] : [];
      const offer = (offers[0] || {}) as Record<string, unknown>;
      const price = offer.price ? String(offer.price) : '';
      const images: string[] = [];
      if (typeof obj.image === 'string') images.push(obj.image);
      else if (Array.isArray(obj.image)) {
        for (const img of obj.image) {
          if (typeof img === 'string') images.push(img);
          else if (typeof img === 'object' && img) {
            // Wix uses schema.org "contentUrl" for ImageObject; also check "url"
            const imgUrl = (img as Record<string, unknown>).url || (img as Record<string, unknown>).contentUrl;
            if (typeof imgUrl === 'string') images.push(imgUrl);
          }
        }
      }
      // Wix emits "Availability" (uppercase)
      const availability = offer.availability || offer.Availability;
      return {
        name: obj.name,
        description: typeof obj.description === 'string' ? obj.description : '',
        regularPrice: price,
        sku: typeof obj.sku === 'string' ? obj.sku : '',
        images,
        inStock: typeof availability === 'string'
          ? (availability as string).includes('InStock')
          : true,
        sourceUrl: pageData.sourceUrl,
      };
    }
  }

  // 2. Captured API calls — look for product data in Wix store API responses
  for (const call of pageData.apiCalls) {
    const data = call.data as Record<string, unknown>;
    // Wix stores API often returns product under .product or .catalog.product
    const product = (data.product || (data.catalog as Record<string, unknown>)?.product) as Record<string, unknown> | undefined;
    if (product && typeof product.name === 'string') {
      const price = product.price as Record<string, unknown> | undefined;
      const media = (product.media as Record<string, unknown>)?.items as Array<Record<string, unknown>> | undefined;
      const images: string[] = [];
      if (media) {
        for (const item of media) {
          const src = (item.image as Record<string, unknown>)?.url as string | undefined;
          if (src) images.push(src);
        }
      }
      return {
        name: product.name as string,
        description: typeof product.description === 'string' ? product.description : '',
        regularPrice: price?.formatted ? String(price.formatted).replace(/[^0-9.]/g, '') : '',
        sku: typeof product.sku === 'string' ? product.sku : '',
        images,
        inStock: (product.stock as Record<string, unknown> | undefined)?.inventoryStatus
          ? (product.stock as Record<string, unknown>).inventoryStatus !== 'OUT_OF_STOCK'
          : undefined,
        sourceUrl: pageData.sourceUrl,
      };
    }
  }

  // 3. DOM fallback — Wix product pages tag elements with stable
  //    [data-hook] attributes that survive even when JSON-LD is missing
  //    or malformed AND the products API call wasn't captured. This is
  //    the worst-case path that still yields a usable product record.
  if (pageData.pageHtml) {
    const html = pageData.pageHtml;
    const pickByHook = (hook: string): string => {
      const re = new RegExp(
        `data-hook=["']${hook}["'][^>]*>([\\s\\S]*?)</`,
        'i'
      );
      const m = html.match(re);
      return m?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
    };
    const name = pickByHook('product-title');
    if (name) {
      // [data-hook="formatted-primary-price"] is the clean value.
      // [data-hook="product-price"] wraps a screen-reader "Price" prefix.
      const price = pickByHook('formatted-primary-price').replace(/[^0-9.,]/g, '');
      const description = pickByHook('product-description');
      const imgRe = /data-hook=["'](?:main-media-image-wrapper|thumbnail-image)["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/gi;
      const images: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = imgRe.exec(html)) !== null) {
        if (!images.includes(match[1])) images.push(match[1]);
      }
      return {
        name,
        description,
        regularPrice: price,
        sku: '',
        images,
        inStock: true,
      };
    }
  }

  return null;
}
