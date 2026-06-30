import { extractMeta, extractTitle } from '../../lib/html-extract/index.js';

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/**
 * Extract the inner HTML of the first element matching a given class or ID,
 * handling nested tags of the same type by tracking depth.
 */
export function extractBySelector(html: string, pattern: RegExp, tag = 'div'): string {
  const match = html.match(pattern);
  if (!match) return '';

  const startIdx = html.indexOf(match[0]);
  const afterTag = startIdx + match[0].length;
  let depth = 1;
  let i = afterTag;
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;

  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf(openTag, i);
    const nextClose = html.indexOf(closeTag, i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) {
        return html.slice(afterTag, nextClose).trim();
      }
      i = nextClose + closeTag.length;
    }
  }
  return '';
}

/**
 * Extract content from Weebly's #wsite-content container.
 * Falls back to <main>, <article>, or body content.
 */
export function extractContent(html: string): string {
  // Strategy 1: Weebly's main content container
  const wsiteContent = extractBySelector(html, /<div[^>]*\sid=["']wsite-content["'][^>]*>/i);
  if (wsiteContent) return wsiteContent;

  // Strategy 2: <main> tag
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch?.[1]?.trim()) return mainMatch[1].trim();

  // Strategy 3: <article> tag
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch?.[1]?.trim()) return articleMatch[1].trim();

  return '';
}

/**
 * Extract heading from the page — tries h1, then og:title, then <title>.
 */
export function extractHeading(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g, '').trim();
  if (h1) return h1;

  const ogTitle = extractMeta(html, 'og:title');
  if (ogTitle) return ogTitle;

  return extractTitle(html);
}

/**
 * Extract blog post date from Weebly's date format.
 * Weebly displays dates as plain text in MM/DD/YYYY format.
 */
export function extractWeeblyDate(html: string): string {
  // Try standard meta tags first
  const articleDate = extractMeta(html, 'article:published_time');
  if (articleDate) return articleDate;

  // Weebly blog date in date-text class
  const dateTextMatch = html.match(/class=["'][^"']*date-text[^"']*["'][^>]*>([^<]+)</i);
  if (dateTextMatch?.[1]) {
    const dateStr = dateTextMatch[1].trim();
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  // <time> element — prefer semantic markup before falling back to text scraping
  const timeElement = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  if (timeElement) return timeElement;

  // Weebly blog date as plain text in MM/DD/YYYY format. Scope the search to
  // the #wsite-content container so we don't pick up stray dates from footer
  // copyright lines, testimonials, or chrome.
  const contentScope = extractBySelector(html, /<div[^>]*\sid=["']wsite-content["'][^>]*>/i) || html;
  const datePattern = /(\d{1,2}\/\d{1,2}\/\d{4})/;
  const dateMatch = contentScope.match(datePattern);
  if (dateMatch?.[1]) {
    const parsed = new Date(dateMatch[1]);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return '';
}

/**
 * Extract blog categories from Weebly's category links.
 * Weebly uses /blog/category/slug format for category pages.
 */
export function extractWeeblyCategories(html: string): string[] {
  const categories: string[] = [];
  const seen = new Set<string>();

  const categoryPattern = /href=["'][^"']*\/blog\/category\/([^"']+)["'][^>]*>([^<]+)/gi;
  let match;
  while ((match = categoryPattern.exec(html)) !== null) {
    const name = match[2].trim();
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      categories.push(name);
    }
  }

  return categories;
}

// ---------------------------------------------------------------------------
// Resolve relative URLs in HTML content to absolute
// ---------------------------------------------------------------------------

/**
 * Rewrite relative src and href attributes in HTML to absolute URLs.
 * This ensures WordPress can match attachment URLs in content during import.
 */
export function resolveRelativeUrls(html: string, baseUrl: string): string {
  let origin: string;
  try {
    origin = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).origin;
  } catch {
    return html;
  }

  // Resolve src="/..." and href="/..." to absolute URLs.
  // The (?!\/) guard skips protocol-relative URLs like src="//cdn.example.com/...",
  // which would otherwise be mangled into "https://site.com//cdn.example.com/...".
  return html.replace(/(src|href)=["'](\/(?!\/)[^"']+)["']/gi, (_match, attr, path) => {
    return `${attr}="${origin}${path}"`;
  });
}
