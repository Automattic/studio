import { extractNavLinks, IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';
import type { NavLink } from '../../lib/html-extract/index.js';

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

/**
 * Extract Weebly navigation links from the wsite-menu structure.
 * Weebly uses li.wsite-menu-item-wrap > a.wsite-menu-item for top-level nav.
 * Falls back to the shared <nav> extractor.
 */
export function extractWeeblyNavLinks(html: string, baseUrl: string): NavLink[] {
  const links: NavLink[] = [];
  const seen = new Set<string>();

  // Match Weebly menu items: <a ... class="wsite-menu-item" ...>text</a>
  const menuItemPattern = /<a[^>]+class=["'][^"']*wsite-menu-item[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = menuItemPattern.exec(html)) !== null) {
    const fullTag = match[0];
    const text = match[1].replace(/<[^>]*>/g, '').trim();
    const hrefMatch = fullTag.match(/href=["']([^"']+)["']/i);
    if (!text || !hrefMatch) continue;

    let href = hrefMatch[1];
    if (seen.has(href)) continue;
    seen.add(href);

    // Normalize protocol-relative and relative URLs
    if (href.startsWith('//')) {
      href = 'https:' + href;
    } else if (href.startsWith('/')) {
      try {
        href = new URL(href, baseUrl).href;
      } catch {
        // keep as-is
      }
    }

    links.push({ text, href });
  }

  // Fall back to generic <nav> extraction if Weebly menu structure wasn't found
  if (links.length === 0) {
    return extractNavLinks(html, baseUrl);
  }

  return links;
}

/**
 * Extract media URLs from Weebly content.
 * Looks for editmysite.com CDN URLs, weeblycloud.com, and standard <img> tags.
 */
export function extractWeeblyMediaUrls(html: string): string[] {
  const urls = new Set<string>();

  // Weebly CDN URLs (editmysite.com)
  const cdnPattern = /https?:\/\/[^\s"'<>)]*editmysite\.com\/[^\s"'<>)]+/g;
  const cdnMatches = html.match(cdnPattern) || [];
  for (const m of cdnMatches) urls.add(m);

  // Weebly Cloud image URLs
  const cloudPattern = /https?:\/\/[^\s"'<>)]*weeblycloud\.com\/[^\s"'<>)]+/g;
  const cloudMatches = html.match(cloudPattern) || [];
  for (const m of cloudMatches) urls.add(m);

  // Weebly uploads directory
  const uploadsPattern = /https?:\/\/[^\s"'<>)]*\/uploads\/[^\s"'<>)]+/g;
  const uploadsMatches = html.match(uploadsPattern) || [];
  for (const m of uploadsMatches) urls.add(m);

  // Standard <img> tags
  const imgSrcMatches = html.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
  for (const imgMatch of imgSrcMatches) {
    const src = imgMatch.match(/src=["']([^"']+)["']/i);
    if (src?.[1] && src[1].startsWith('http')) {
      urls.add(src[1]);
    }
  }

  // Filter to image URLs only (exclude CSS, JS, fonts, and other assets)
  const nonImageExtensions = /\.(css|js|json|xml|txt|map|woff2?|ttf|eot|pdf)$/i;
  return [...urls].filter((u) => {
    try {
      const parsed = new URL(u);
      if (nonImageExtensions.test(parsed.pathname)) return false;
      return IMAGE_EXTENSIONS.test(parsed.pathname);
    } catch {
      return false;
    }
  });
}
