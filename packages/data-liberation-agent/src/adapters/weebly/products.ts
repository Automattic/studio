import { IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';
import type { WooProduct } from '../../lib/woo-csv/index.js';

// ---------------------------------------------------------------------------
// Weebly product extraction from HTML
// ---------------------------------------------------------------------------

/**
 * Extract product data from a Weebly product page.
 *
 * Weebly product pages have minimal semantic markup — the content inside
 * #wsite-content is flat: an <h2> for the title, plain divs for price/SKU,
 * and paragraphs for the description. There are no product-specific classes
 * on the actual DOM elements (only in CSS selectors).
 *
 * We extract from within #wsite-content to avoid picking up nav/header text.
 */
export function extractWeeblyProduct(_url: string, html: string): WooProduct | null {
  // NOTE: html here is pageData.content — already scoped to #wsite-content
  // by extractContent(). No need to re-scope.
  if (!html) return null;

  // Product title: first <h2> in the content
  const titleMatch = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const name = titleMatch?.[1]?.replace(/<[^>]*>/g, '').trim();
  if (!name) return null;

  // Price: look for dollar amount pattern
  // Weebly renders price as flat text like "$8.50" or "$8.50 per item"
  const pricePattern = /\$\s*(\d+(?:\.\d{2})?)/;
  const priceMatch = html.match(pricePattern);
  const firstPrice = priceMatch?.[1] || '';

  // Sale price: look for crossed-out / original price patterns
  const salePriceMatch = html.match(/class=["'][^"']*(?:sale|original)[^"']*["'][^>]*>\s*\$\s*(\d+(?:\.\d{2})?)/i);
  const salePrice = salePriceMatch?.[1] || undefined;

  // Description: collect text from <p> tags first. If no <p> tags produce
  // results, fall back to <div class="paragraph"> blocks. Weebly wraps text
  // in both, and the <div> version often contains a concatenated duplicate
  // of all the <p> content, so we prefer <p> tags when available.
  const descParts: string[] = [];

  function isDescText(text: string): boolean {
    if (text.length < 15) return false;
    if (/^\$\d/.test(text)) return false;
    if (/^SKU:/i.test(text)) return false;
    if (/^(Add to Cart|Unavailable|Out of Stock|per item|Have questions|Items handcrafted)/i.test(text)) return false;
    return true;
  }

  // Try <p> tags first
  const pTags = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  for (const p of pTags) {
    const text = p.replace(/<[^>]*>/g, '').trim();
    if (isDescText(text)) descParts.push(text);
  }

  // Fall back to <div class="paragraph"> blocks if no <p> content found
  if (descParts.length === 0) {
    const divParas = html.match(/<div[^>]+class=["'][^"']*paragraph[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi) || [];
    for (const div of divParas) {
      const text = div.replace(/<[^>]*>/g, '').trim();
      if (isDescText(text)) descParts.push(text);
    }
  }

  const description = descParts.join('\n\n');

  // Images: Weebly product images in /uploads/ paths
  const images: string[] = [];
  const imgPattern = /<img[^>]+src=["']([^"']*\/uploads\/[^"']+)["']/gi;
  let imgMatch;
  while ((imgMatch = imgPattern.exec(html)) !== null) {
    let src = imgMatch[1];
    // Make absolute if relative
    if (src.startsWith('/')) {
      try {
        const urlObj = new URL(_url);
        src = urlObj.origin + src;
      } catch { /* keep relative */ }
    }
    // Strip Weebly resize params for original image
    src = src.replace(/\?width=\d+/, '');
    if (!images.includes(src)) {
      images.push(src);
    }
  }

  // Also check for CDN-hosted product images
  const cdnImgPattern = /<img[^>]+src=["'](https?:\/\/[^"']*editmysite\.com\/[^"']+)["']/gi;
  while ((imgMatch = cdnImgPattern.exec(html)) !== null) {
    const src = imgMatch[1];
    if (IMAGE_EXTENSIONS.test(src) && !images.includes(src)) {
      images.push(src);
    }
  }

  return {
    name,
    type: 'simple',
    description,
    regularPrice: firstPrice,
    salePrice,
    images,
    // Default to in-stock. Weebly's commerce template often renders "Unavailable"
    // as part of the page chrome even for products that are in stock, so we can't
    // reliably detect stock status from the static HTML alone.
    inStock: true,
    sourceUrl: _url,
  };
}
