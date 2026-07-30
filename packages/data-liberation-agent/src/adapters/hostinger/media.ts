import { IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';

// ---------------------------------------------------------------------------
// Media extraction
// ---------------------------------------------------------------------------

/**
 * Extract media URLs from a Hostinger page.
 *
 * Hostinger serves images from assets.zyrosite.com via Cloudflare Image Resize
 * with URLs like:
 *   https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=400,h=280,fit=crop/SITE_ID/image-HASH.png
 *
 * We strip the /cdn-cgi/image/...params.../ portion to get the original image URL,
 * which gives us better quality and deduplication (since resize params vary per page).
 */
export function extractHostingerMediaUrls(html: string): string[] {
  const urls = new Set<string>();

  // Match zyrosite CDN image URLs (full, including resize params)
  const zyroPattern = /https?:\/\/[^\s"'<>)]*zyrosite\.com\/[^\s"'<>)]+/g;
  const zyroMatches = html.match(zyroPattern) || [];
  for (const m of zyroMatches) {
    // Strip Cloudflare Image Resize prefix to get the original asset URL
    const normalized = m.replace(
      /(https?:\/\/[^/]+\/cdn-cgi\/image\/[^/]+\/)(.+)/,
      (_all, _prefix, path) => `https://assets.zyrosite.com/${path}`
    );
    urls.add(normalized);
  }

  // Standard <img> tags
  const imgSrcMatches = html.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
  for (const imgMatch of imgSrcMatches) {
    const src = imgMatch.match(/src=["']([^"']+)["']/i);
    if (src?.[1] && src[1].startsWith('http')) {
      urls.add(src[1]);
    }
  }

  // Filter to image URLs only
  const nonImageExtensions = /\.(css|js|json|xml|txt|map|woff2?|ttf|eot|pdf)$/i;
  return [...urls].filter((u) => {
    try {
      const parsed = new URL(u);
      if (nonImageExtensions.test(parsed.pathname)) return false;
      // zyrosite URLs often lack extensions in the path but are always images
      if (/zyrosite\.com/i.test(parsed.hostname)) return true;
      return IMAGE_EXTENSIONS.test(parsed.pathname);
    } catch {
      return false;
    }
  });
}
