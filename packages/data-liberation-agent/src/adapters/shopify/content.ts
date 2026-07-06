import { extractMeta, IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';

/**
 * Extract the myshopify.com hostname from storefront HTML. Every Shopify
 * storefront sets `Shopify.shop = "name.myshopify.com"` as a global — it
 * powers the Shopify JS runtime, so it's reliably present on every page.
 * Falls back to matching the CDN pattern and `shop_id`/`shop_url` hints.
 */
export function extractShopDomain(html: string): string | undefined {
  // Most reliable: the Shopify JS runtime global
  const shopGlobal = html.match(/Shopify\.shop\s*=\s*["']([^"']+\.myshopify\.com)["']/i);
  if (shopGlobal?.[1]) return shopGlobal[1];

  // Analytics bootstrap (trekkie) carries the same value
  const trekkie = html.match(/shopId["']?\s*[:,]\s*\d+[^}]*shop["']?\s*[:,]\s*["']([^"']+\.myshopify\.com)["']/i);
  if (trekkie?.[1]) return trekkie[1];

  // Monorail "shop" payload
  const monorail = html.match(/"shop"\s*:\s*"([^"]+\.myshopify\.com)"/i);
  if (monorail?.[1]) return monorail[1];

  return undefined;
}

export interface QualitySignals {
  title: string;
  content: string;
  images: string[];
  date: string;
  hasStructuredData: boolean;
  hasPriceSku: boolean;
}

export function scorePageQuality(signals: QualitySignals): 'high' | 'medium' | 'low' {
  let score = 0;
  if (signals.title.length > 0) score += 20;
  if (signals.content.length > 200) score += 25;
  else if (signals.content.length > 50) score += 10;
  if (signals.images.length > 0) score += 15;
  if (signals.hasStructuredData) score += 10;
  if (signals.hasPriceSku) score += 10;
  if (signals.date.length > 0) score += 10;

  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/**
 * Extract content from Shopify page HTML.
 * Tries multiple strategies and picks the richest result. Narrow selectors
 * (Replo, .rte) are preferred when they return substantial content (>=100
 * chars of text); otherwise we fall through to broader selectors (<article>,
 * <main>) which capture section-based page builders.
 */
export function extractShopifyContent(html: string): string {
  const textLen = (h: string) => h.replace(/<[^>]*>/g, '').trim().length;
  const MIN_CONTENT = 100; // chars of stripped text to accept a narrow strategy

  // Strategy 1: Replo page builder
  const reploMatch = html.match(/<div[^>]*id="replo-fullpage-element"[^>]*>([\s\S]*?)<\/main>/i);
  if (reploMatch?.[1] && textLen(reploMatch[1]) >= MIN_CONTENT) {
    return reploMatch[1].trim();
  }

  // Strategy 2: .rte content block (standard Shopify rich text)
  const rteStart = html.match(/<div[^>]*class="[^"]*\brte\b[^"]*"[^>]*>/i);
  if (rteStart) {
    const startIdx = html.indexOf(rteStart[0]);
    const afterTag = startIdx + rteStart[0].length;
    let depth = 1;
    let i = afterTag;
    while (i < html.length && depth > 0) {
      const nextOpen = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) {
          const rteContent = html.slice(afterTag, nextClose).trim();
          if (textLen(rteContent) >= MIN_CONTENT) return rteContent;
          break; // thin .rte — fall through to broader strategies
        }
        i = nextClose + 6;
      }
    }
  }

  // Strategy 3: .alchemy-rte (another common page builder pattern)
  const alchemyMatch = html.match(/<div[^>]*class="[^"]*alchemy-rte[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (alchemyMatch?.[1] && textLen(alchemyMatch[1]) >= MIN_CONTENT) return alchemyMatch[1].trim();

  // Strategy 4: <article> tag content
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch?.[1] && textLen(articleMatch[1]) >= MIN_CONTENT) return articleMatch[1].trim();

  // Strategy 5: <main> tag (broadest — captures all section content)
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch?.[1]?.trim()) return mainMatch[1].trim();

  return '';
}

// Non-image asset extensions we always reject (scripts, fonts, docs, video).
export const NON_IMAGE_ASSET_EXTENSIONS = /\.(css|js|mjs|json|xml|txt|map|woff2?|ttf|eot|otf|pdf|zip|mp4|webm|mov|m4v)(?:$|[?#])/i;

// Tracking / analytics hosts that emit 1x1 pixel "images" we never want as media.
export const TRACKING_HOST = /(google-analytics|googletagmanager|facebook\.com\/tr|doubleclick|hotjar|segment\.|cdn\.shopify\.com\/shopifycloud\/(?:web-pixels|consent))/i;

/**
 * Extract media URLs referenced by a page's HTML — regardless of host.
 *
 * Page builders layered on top of Shopify (Replo via `assets.replocdn.com`,
 * Shogun, PageFly, etc.) serve their hero/lifestyle/app imagery from their own
 * CDN, and those URLs frequently carry NO file extension — the path is a bare
 * UUID (`/projects/<uuid>/<uuid>?width=820`). The previous implementation only
 * collected `cdn.shopify.com` URLs and then required an image *extension* in the
 * pathname, so every extension-less builder URL was dropped (getsnooz: 0 of 19
 * pages' Replo images captured). The hero/app/lifestyle photography was absent
 * and the pattern builder substituted unrelated product photos.
 *
 * Strategy: collect every image *reference* in the markup — `<img src>`,
 * `srcset`/`data-srcset` (incl. `<source>`), common lazy-load attrs
 * (`data-src`/`data-lazy-src`/`data-original`), and CSS `background-image:
 * url(...)`. Keep the explicit Shopify-CDN sweep too (covers JSON/inline data
 * not in a tag). Then filter: reject non-image asset extensions and known
 * tracking/pixel hosts, but ACCEPT extension-less URLs — those are downloaded
 * via `downloadMedia`, which derives the real extension from the response
 * `content-type`. This makes capture content-driven, not host-hardcoded.
 */
export function extractShopifyMediaUrls(html: string): string[] {
  const urls = new Set<string>();

  const addAbs = (raw: string | undefined): void => {
    if (!raw) return;
    const v = raw.trim();
    // Only absolute http(s) URLs — relative refs are handled elsewhere and
    // protocol-relative would need a base we don't have here.
    if (/^https?:\/\//i.test(v)) urls.add(v);
  };

  // Shopify CDN URLs anywhere in the markup (covers inline JSON / data blobs).
  for (const m of html.match(/https?:\/\/cdn\.shopify\.com\/s\/files\/[^\s"'<>)]+/g) || []) {
    addAbs(m);
  }

  // <img>/<source> tags — src plus lazy-load and srcset variants.
  for (const tag of html.match(/<(?:img|source)\b[^>]*>/gi) || []) {
    // Direct/eager + lazy single-URL attributes.
    for (const attr of ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-image']) {
      const m = tag.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
      addAbs(m?.[1]);
    }
    // srcset / data-srcset: comma-separated "url descriptor" pairs.
    for (const attr of ['srcset', 'data-srcset']) {
      const m = tag.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
      if (m?.[1]) {
        for (const entry of m[1].split(',')) {
          addAbs(entry.trim().split(/\s+/)[0]);
        }
      }
    }
  }

  // CSS background-image: url(...) in inline styles and <style> blocks.
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*[^;"']*url\((['"]?)([^)'"]+)\1\)/gi)) {
    addAbs(m[2]);
  }

  return [...urls].filter((u) => {
    try {
      const parsed = new URL(u);
      if (TRACKING_HOST.test(parsed.host) || TRACKING_HOST.test(u)) return false;
      if (NON_IMAGE_ASSET_EXTENSIONS.test(parsed.pathname)) return false;
      // A real image extension is sufficient on its own.
      if (IMAGE_EXTENSIONS.test(parsed.pathname)) return true;
      // Extension-less path: accept it. Page-builder CDNs (Replo, Shogun) and
      // image-resizing proxies serve images without an extension; downloadMedia
      // adds the correct one from the response content-type. The reference came
      // from an <img>/srcset/background-image slot, so it is image-intended.
      // (Anything that turns out to be non-image is dropped at download time.)
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Extract date from HTML — tries schema.org, <time>, and meta tags.
 */
export function extractDate(html: string): string {
  // Schema.org datePublished
  const schemaDate = html.match(/datePublished["']?\s*[:=]\s*["']([^"']+)["']/i)?.[1];
  if (schemaDate) return schemaDate;

  // <time datetime="...">
  const timeEl = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  if (timeEl) return timeEl;

  // meta article:published_time
  const metaDate = extractMeta(html, 'article:published_time');
  if (metaDate) return metaDate;

  return '';
}
