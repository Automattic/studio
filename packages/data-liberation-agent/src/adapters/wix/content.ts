import type { CapturedApiCall, PageMeta } from './types.js';
import { IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';

/** An empty PageMeta, used when the live evaluate path is unavailable. */
export function emptyMeta(): PageMeta {
  return { title: '', description: '', ogTitle: '', ogDescription: '', ogImage: '', canonical: '' };
}

/** Extract image URLs from all captured page data sources. */
export function extractImageUrls(data: {
  apiCalls: CapturedApiCall[];
  globals: Record<string, unknown>;
  jsonLd: unknown[];
  meta: PageMeta;
  accessibility: Array<{ role: string; name: string }> | null;
  pageHtml?: string;
}): string[] {
  const urls = new Set<string>();

  // Scan all captured data as JSON for wixstatic/wixmp URLs
  const allDataStr = JSON.stringify({ apiCalls: data.apiCalls, globals: data.globals, jsonLd: data.jsonLd });
  const wixMatches = allDataStr.match(/https?:\/\/[^"'\s]*(?:wixstatic\.com|wixmp\.com)[^"'\s]*/g) || [];
  for (const url of wixMatches) {
    urls.add(url);
  }

  // JSON-LD image fields
  for (const ld of data.jsonLd) {
    const obj = ld as Record<string, unknown>;
    if (typeof obj.image === 'string') urls.add(obj.image);
    if (Array.isArray(obj.image)) {
      for (const img of obj.image) {
        if (typeof img === 'string') urls.add(img);
        if (typeof img === 'object' && img && typeof (img as Record<string, unknown>).url === 'string') {
          urls.add((img as Record<string, unknown>).url as string);
        }
      }
    }
    if (typeof obj.thumbnailUrl === 'string') urls.add(obj.thumbnailUrl);
  }

  // OG image
  if (data.meta.ogImage) urls.add(data.meta.ogImage);

  // Scan page HTML for <img> src attributes
  if (data.pageHtml) {
    const imgSrcMatches = data.pageHtml.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
    for (const match of imgSrcMatches) {
      const src = match.match(/src=["']([^"']+)["']/i);
      if (src?.[1] && src[1].startsWith('http')) {
        urls.add(src[1]);
      }
    }
    // Also background images in style attributes
    const bgMatches = data.pageHtml.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/gi) || [];
    for (const match of bgMatches) {
      const bgUrl = match.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/i);
      if (bgUrl?.[1]) urls.add(bgUrl[1]);
    }
  }

  // Filter: only keep URLs that look like images.
  // Wix-hosted media is split across three CDN hosts:
  //   static.wixstatic.com   — images, documents
  //   static.parastorage.com — platform assets (icons, decorative)
  //   video.wixstatic.com    — video content (covered by `wixstatic.com`)
  const imageExtensions = IMAGE_EXTENSIONS;
  const imageCdns = /wixstatic\.com|wixmp\.com|parastorage\.com|images\.unsplash\.com|cdn\.shopify\.com/i;
  return [...urls].filter((u) => {
    try {
      const parsed = new URL(u);
      return imageExtensions.test(parsed.pathname) || imageCdns.test(parsed.hostname);
    } catch {
      return false;
    }
  });
}

/**
 * Extract a blog post's featured image from BlogPosting JSON-LD. Returns
 * the URL of the first matching image (schema.org-defined as the post's
 * primary image) or null if no BlogPosting/Article JSON-LD is present.
 *
 * Handles all three image-field shapes the schema allows:
 *   - string                                       → URL directly
 *   - { @type: 'ImageObject', url: '...' }         → nested url property
 *   - [ImageObject, ImageObject, ...]              → first item's URL
 *
 * Verified across two independent Wix Blog themes that diverge on DOM
 * markup but both emit BlogPosting JSON-LD with image populated. Source-
 * level (server-rendered) so detection doesn't depend on JS hydration.
 */
export function extractFeaturedImageFromJsonLd(jsonLd: unknown[]): string | null {
  for (const ld of jsonLd) {
    const obj = ld as Record<string, unknown>;
    const type = obj['@type'];
    const isPostType =
      type === 'BlogPosting' ||
      type === 'Article' ||
      type === 'NewsArticle' ||
      (Array.isArray(type) && type.some((t) => t === 'BlogPosting' || t === 'Article' || t === 'NewsArticle'));
    if (!isPostType) continue;

    const image = obj.image;
    if (typeof image === 'string') return image;
    if (image && typeof image === 'object' && !Array.isArray(image)) {
      const url = (image as Record<string, unknown>).url;
      if (typeof url === 'string') return url;
    }
    if (Array.isArray(image)) {
      for (const item of image) {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const url = (item as Record<string, unknown>).url;
          if (typeof url === 'string') return url;
        }
      }
    }
  }
  return null;
}

/** Walk a JSON value tree looking for HTML content in known field names. */
function findHtmlContent(value: unknown, depth = 0): string | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === 'string') return null;
  if (typeof value !== 'object') return null;

  const obj = value as Record<string, unknown>;
  const contentKeys = ['html', 'richText', 'body', 'content', 'text', 'plainText'];

  for (const key of contentKeys) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 50 && v.includes('<')) {
      return v;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findHtmlContent(item, depth + 1);
      if (found) return found;
    }
  } else {
    for (const child of Object.values(obj)) {
      const found = findHtmlContent(child, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Determine the best content string from the extracted page data.
 */
export function deriveContent(pageData: {
  apiCalls: CapturedApiCall[];
  jsonLd: unknown[];
  renderedContent: string | null;
  accessibility: Array<{ role: string; name: string }> | null;
  meta: PageMeta;
}): { content: string; qualityScore: 'high' | 'medium' | 'low' } {
  // 1. Try API calls — walk the JSON tree for HTML content fields
  // Skip non-content API endpoints (tag manager, access tokens) whose responses
  // contain <script> blocks in fields named "content"/"html" that match
  // findHtmlContent but produce empty strings after script/style stripping.
  for (const call of pageData.apiCalls) {
    const htmlContent = findHtmlContent(call.data);
    if (htmlContent && htmlContent.length > 50) {
      // Verify the match has real text content after stripping script/style tags
      const stripped = htmlContent
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<link\b[^>]*\/?>/gi, '')
        .replace(/<meta\b[^>]*\/?>/gi, '')
        .trim();
      if (stripped.length > 50 && /<[a-z][\s\S]*>/i.test(stripped)) {
        return { content: htmlContent, qualityScore: 'high' };
      }
    }
  }

  // 2. Rendered DOM content
  if (pageData.renderedContent && pageData.renderedContent.length > 30) {
    return { content: pageData.renderedContent, qualityScore: 'high' };
  }

  // 3. Try JSON-LD. Only accept `description` from content-level types
  // (Article, BlogPosting, Product, Event, Recipe, etc.) — NOT from site-level
  // types like Organization, LocalBusiness, FurnitureStore, Restaurant,
  // WebSite, or Corporation. Wix ecommerce category pages include a site-level
  // Organization/FurnitureStore block whose description is a generic site
  // tagline that gets duplicated across every page.
  const CONTENT_LD_TYPES = new Set([
    'Article', 'BlogPosting', 'NewsArticle', 'SocialMediaPosting',
    'Product', 'ItemPage', 'Event', 'Recipe', 'Course', 'Book', 'Movie',
  ]);
  for (const ld of pageData.jsonLd) {
    const obj = ld as Record<string, unknown>;
    // articleBody is inherently content-level, always safe to accept
    if (typeof obj.articleBody === 'string' && obj.articleBody.length > 50) {
      return { content: `<p>${obj.articleBody}</p>`, qualityScore: 'medium' };
    }
    const atType = obj['@type'];
    const isContentType = typeof atType === 'string' && CONTENT_LD_TYPES.has(atType);
    if (isContentType && typeof obj.description === 'string' && obj.description.length > 50) {
      return { content: `<p>${obj.description}</p>`, qualityScore: 'medium' };
    }
  }

  // 4. Page-specific meta/og:description — for pages where real content is
  // JS-rendered (Wix category archives, product grids) and we have no better
  // source. og:description is per-page and written by the site owner, so it's
  // meaningfully distinct from the site-level boilerplate handled in step 3.
  const ogDesc = pageData.meta.ogDescription || pageData.meta.description || '';
  if (ogDesc.length > 50) {
    return { content: `<p>${ogDesc}</p>`, qualityScore: 'medium' };
  }

  // 5. Accessibility tree fallback
  if (pageData.accessibility && pageData.accessibility.length > 0) {
    const parts: string[] = [];
    for (const node of pageData.accessibility) {
      if (node.role === 'heading') {
        parts.push(`<h2>${node.name}</h2>`);
      } else if (node.name) {
        parts.push(`<p>${node.name}</p>`);
      }
    }
    if (parts.length > 0) {
      return { content: parts.join('\n'), qualityScore: 'low' };
    }
  }

  // 6. Nothing found
  return { content: '', qualityScore: 'low' };
}
