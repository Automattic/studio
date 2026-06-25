import { extractMeta } from '../../lib/html-extract/index.js';
import type { CheerioRoot } from './types.js';

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

/**
 * Parse all JSON-LD blocks in the page, flattening `@graph` wrappers and
 * stripping CDATA markers. Returns the flat list of JSON-LD objects.
 */
export function parseJsonLdBlocks($: CheerioRoot): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el)
      .text()
      .trim()
      .replace(/^<!\[CDATA\[/i, '')
      .replace(/\]\]>$/, '')
      .trim();
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const graph = obj['@graph'];
      if (Array.isArray(graph)) {
        for (const node of graph) {
          if (node && typeof node === 'object') out.push(node as Record<string, unknown>);
        }
      } else {
        out.push(obj);
      }
    }
  });
  return out;
}

export function isArticleLd(block: Record<string, unknown>): boolean {
  const type = block['@type'];
  const match = (t: unknown) => t === 'BlogPosting' || t === 'Article' || t === 'NewsArticle';
  return match(type) || (Array.isArray(type) && type.some(match));
}

/**
 * Extract publication date from a HubSpot blog post.
 *
 * Tried in order:
 * 1. `.blog-post__timestamp` element text (HubSpot's default theme renders
 *    the post date in this class and also powers the visible byline)
 * 2. `<time datetime="…">` element (explicit machine-readable date)
 * 3. JSON-LD `datePublished` (survives custom themes)
 * 4. `<meta property="article:published_time">`
 * 5. Byline text like "by Author, on Dec 6, 2024 6:57:40 PM" — scoped to the
 *    first 500 chars of the post body so we don't pick up dates from unrelated
 *    prose deeper in the article or in sidebar widgets.
 */
export function extractHubSpotDate($: CheerioRoot, html: string): string {
  const timestampText = $('.blog-post__timestamp').first().text().replace(/\s+/g, ' ').trim();
  if (timestampText) {
    const parsed = new Date(timestampText);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const timeAttr = $('time[datetime]').first().attr('datetime');
  if (timeAttr) return timeAttr;

  for (const block of parseJsonLdBlocks($)) {
    if (!isArticleLd(block)) continue;
    const datePublished = block.datePublished;
    if (typeof datePublished === 'string' && datePublished) return datePublished;
  }

  const articleDate = extractMeta(html, 'article:published_time');
  if (articleDate) return articleDate;

  const postBodyText = $('.post-body').first().text() || $('body').first().text() || '';
  const haystack = postBodyText.slice(0, 500);
  const bylineDate = haystack.match(
    /\b(?:on|posted on|published on|by[^,\n]{1,80},\s*on)\s+([A-Z][a-z]{2,}\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)?)/
  );
  if (bylineDate?.[1]) {
    const parsed = new Date(bylineDate[1]);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return '';
}

/**
 * Extract author name from HubSpot blog post.
 *
 * Tried in order:
 * 1. `.blog-post__author` element text (HubSpot default theme)
 * 2. `/author/{slug}` link text (fallback for variants of the default theme)
 * 3. JSON-LD Article `author.name` (handles @graph)
 * 4. JSON-LD Person block linked via @graph
 * 5. <meta name="author"> tag
 */
export function extractHubSpotAuthor($: CheerioRoot, html: string): string | undefined {
  const classAuthor = $('.blog-post__author').first().text().replace(/\s+/g, ' ').trim();
  if (classAuthor) return classAuthor;

  const authorLink = $('a[href*="/author/"]').first().text().trim();
  if (authorLink) return authorLink;

  const blocks = parseJsonLdBlocks($);
  for (const block of blocks) {
    if (!isArticleLd(block)) continue;
    const author = block.author;
    if (!author) continue;
    const first = Array.isArray(author) ? author[0] : author;
    if (first && typeof first === 'object' && typeof (first as { name?: unknown }).name === 'string') {
      return (first as { name: string }).name;
    }
  }
  for (const block of blocks) {
    if (block['@type'] === 'Person' && typeof block.name === 'string') {
      return block.name as string;
    }
  }

  const metaAuthor = extractMeta(html, 'author');
  return metaAuthor || undefined;
}

/**
 * Extract tags from HubSpot blog post topic links.
 *
 * Preferred: `.blog-post__tag-link` elements (HubSpot's default theme wraps
 * each tag in this class). Fallback: any `/topic/{slug}` anchor anywhere on
 * the page — we require the slug to be the last path segment so we don't
 * pick up `/topic/foo/page/2` pagination links.
 */
export function extractHubSpotTags($: CheerioRoot): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  const add = (text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(clean);
  };

  const tagLinks = $('.blog-post__tag-link');
  if (tagLinks.length) {
    tagLinks.each((_, el) => add($(el).text()));
    return tags;
  }

  $('a[href*="/topic/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!/\/topic\/[^/?#]+\/?(?:[?#]|$)/.test(href)) return;
    add($(el).text());
  });
  return tags;
}
