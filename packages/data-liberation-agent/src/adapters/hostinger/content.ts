import { extractMeta, extractTitle } from '../../lib/html-extract/index.js';
import { HOSTINGER_CHROME_CLASS, stripChrome } from './chrome.js';

// ---------------------------------------------------------------------------
// Content extraction helpers
// ---------------------------------------------------------------------------

export function extractContent(html: string): string {
  // Strategy 1: Hostinger's <section class="block ..."> blocks.
  // Checked first because <main> on Astro sites wraps ALL page content
  // including chrome, so main-based extraction would include site furniture.
  const sectionPattern = /<section[^>]*\bclass=["']([^"']*)["'][^>]*>([\s\S]*?)<\/section>/gi;
  const contentBlocks: string[] = [];
  let match;
  while ((match = sectionPattern.exec(html)) !== null) {
    const className = match[1];
    const inner = match[2];
    if (!/\bblock\b/.test(className)) continue;
    if (HOSTINGER_CHROME_CLASS.test(className)) continue;
    if (inner.trim()) contentBlocks.push(inner.trim());
  }
  if (contentBlocks.length > 0) return contentBlocks.join('\n\n');

  // Strategy 2: <article> tag
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch?.[1]?.trim()) return articleMatch[1].trim();

  // Strategy 3: <main> with chrome stripped
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch?.[1]?.trim()) return stripChrome(mainMatch[1]).trim();

  // Strategy 4: <body> with chrome stripped (last resort)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) return stripChrome(bodyMatch[1]).trim();

  return '';
}

/**
 * Extract page heading — tries h1, then og:title, then <title>.
 */
export function extractHeading(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g, '').trim();
  if (h1) return h1;

  const ogTitle = extractMeta(html, 'og:title');
  if (ogTitle) return ogTitle;

  return extractTitle(html);
}

/**
 * Strip the first <h1> element if its text matches the post title.
 *
 * Hostinger's blog templates render the post title as an <h1> inside the
 * content body (.block-blog-header__title). When WordPress displays the
 * post, it shows the post_title field PLUS this embedded h1, producing
 * a duplicated title. Stripping the matching h1 avoids that.
 */
export function stripDuplicateTitle(html: string, title: string): string {
  if (!title) return html;
  // Normalize for comparison: strip tags, collapse whitespace, lowercase
  const normalize = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizedTitle = normalize(title);
  if (!normalizedTitle) return html;

  return html.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/i, (fullMatch, inner) => {
    return normalize(inner) === normalizedTitle ? '' : fullMatch;
  });
}

/**
 * Rewrite relative src and href attributes in HTML to absolute URLs.
 * Ensures WordPress can match attachment URLs in content during import.
 */
export function resolveRelativeUrls(html: string, baseUrl: string): string {
  let origin: string;
  try {
    origin = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).origin;
  } catch {
    return html;
  }

  return html.replace(/(src|href)=["'](\/[^"']+)["']/gi, (_match, attr, path) => {
    return `${attr}="${origin}${path}"`;
  });
}
