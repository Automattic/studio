import type { WooProduct } from '../../lib/woo-csv/index.js';

// ---------------------------------------------------------------------------
// JSON-LD parsing
// ---------------------------------------------------------------------------

/**
 * Extract and parse all JSON-LD blocks from HTML.
 */
export function extractJsonLdBlocks(html: string): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        for (const p of parsed) if (p && typeof p === 'object') blocks.push(p as Record<string, unknown>);
      } else if (parsed && typeof parsed === 'object') {
        blocks.push(parsed as Record<string, unknown>);
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return blocks;
}

/**
 * Find the first JSON-LD block with type matching the given pattern (e.g. /Article/).
 */
export function findJsonLdByType(blocks: Array<Record<string, unknown>>, typePattern: RegExp): Record<string, unknown> | null {
  for (const block of blocks) {
    const type = block['@type'];
    if (typeof type === 'string' && typePattern.test(type)) return block;
    if (Array.isArray(type) && type.some((t) => typeof t === 'string' && typePattern.test(t))) return block;
  }
  return null;
}

/**
 * Convert a JSON-LD Product block into a WooProduct for CSV output.
 */
export function jsonLdToWooProduct(ld: Record<string, unknown>, sourceUrl: string): WooProduct | null {
  const name = typeof ld.name === 'string' ? ld.name : '';
  if (!name) return null;

  const offers = Array.isArray(ld.offers)
    ? ld.offers as Array<Record<string, unknown>>
    : ld.offers && typeof ld.offers === 'object'
      ? [ld.offers as Record<string, unknown>]
      : [];
  const firstOffer = offers[0];
  const price = firstOffer?.price != null ? String(firstOffer.price) : '';
  const availability = typeof firstOffer?.availability === 'string' ? firstOffer.availability : '';

  const images: string[] = [];
  if (typeof ld.image === 'string') {
    images.push(ld.image);
  } else if (Array.isArray(ld.image)) {
    for (const img of ld.image) {
      if (typeof img === 'string') images.push(img);
      else if (img && typeof img === 'object' && typeof (img as { url?: unknown }).url === 'string') {
        images.push((img as { url: string }).url);
      }
    }
  }

  return {
    name,
    type: 'simple',
    description: typeof ld.description === 'string' ? ld.description : '',
    regularPrice: price,
    sku: typeof ld.sku === 'string' ? ld.sku : '',
    images,
    inStock: availability ? /InStock/i.test(availability) : true,
    sourceUrl,
  };
}
