import * as cheerio from 'cheerio';
import { extractMeta, extractTitle } from '../../lib/html-extract/index.js';
import { upgradeIsteamUrl } from './media.js';

// ---------------------------------------------------------------------------
// HTML escaping helpers
// ---------------------------------------------------------------------------

export { escapeHtml } from '../../lib/html-escape.js';

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// _BLOG_DATA extraction
// ---------------------------------------------------------------------------

import type { BlogData } from './types.js';

/**
 * Parse `window._BLOG_DATA = {...}` from a W+M blog post's HTML. Returns null
 * if the page isn't a blog post or the JSON can't be parsed.
 */
export function parseBlogData(html: string): BlogData | null {
  const marker = 'window._BLOG_DATA=';
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const scriptEnd = html.indexOf('</script>', start);
  if (scriptEnd < 0) return null;
  const raw = html.slice(start + marker.length, scriptEnd).trim().replace(/;$/, '');
  try {
    return JSON.parse(raw) as BlogData;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// W+M-specific HTML extraction
// ---------------------------------------------------------------------------

export function extractContent(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, link, meta').remove();
  $('section[data-aid="HEADER_SECTION"]').remove();
  $('header[data-aid="HEADER_WIDGET"]').remove();
  $('[data-aid^="FOOTER_"]').remove();
  $('footer').remove();
  $('[data-aid*="COOKIE"], [data-aid*="HAMBURGER"], [data-aid="NAV_MORE"]').remove();

  // Strip the page title widget — it's duplicated with <wp:post_title>. W+M
  // tags the first section's title as `<SECTION>_SECTION_TITLE_RENDERED`
  // (e.g. ABOUT_SECTION_TITLE_RENDERED, CONTENT_SECTION_TITLE_RENDERED).
  // Only strip the first one so secondary section headings survive.
  $('[data-aid$="_SECTION_TITLE_RENDERED"]').first().remove();

  // Strip the hero image widget — it's duplicated with the media attachment
  // the extraction loop creates. W+M tags the lead image of a section as
  // `<SECTION>_IMAGE_RENDERED0`. Only strip the first one.
  $('[data-aid$="_IMAGE_RENDERED0"]').first().remove();

  // Upgrade any surviving isteam <img src> to request the CDN's max-resolution
  // variant. Must happen here so the body HTML and the mediaUrls both contain
  // the same string — otherwise the WP importer's exact-match URL rewriting
  // leaves the body pointing at the original img1.wsimg.com URL.
  //
  // W+M also uses a lazy-loading pattern where the real URL is hidden in
  // `data-srclazy` / `data-srcsetlazy` (and standard `srcset`) with a base64
  // gif placeholder in `src`. Rewrite those attrs too — otherwise WP sees
  // a data-uri `src` and an un-upgraded lazy attr, neither of which gets
  // rewritten to the local media attachment.
  // Rewrite <img src>, upgrade the lazy URL, and strip all srcset variants.
  // W+M ships responsive images as <picture><source srcset=1x,2x,3x><img src>
  // with srcset values containing URLs that themselves contain commas (inside
  // crop/resize transforms like `cr=t:12.53%25,l:0%25,...`). Trying to parse
  // that safely is fragile, and WordPress regenerates its own srcset from the
  // uploaded media on import — so we can just drop srcset and data-srcsetlazy
  // entirely and let the canonical <img src> handle everything.
  $('img, source').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src');
    if (src && !src.startsWith('data:')) $el.attr('src', upgradeIsteamUrl(src));
    const lazy = $el.attr('data-srclazy');
    if (lazy) {
      const upgraded = upgradeIsteamUrl(lazy);
      $el.attr('data-srclazy', upgraded);
      // Promote the lazy URL into the real src so WordPress's URL rewriting
      // picks it up. Without this the body keeps a data:image/gif placeholder.
      if (!src || src.startsWith('data:')) $el.attr('src', upgraded);
    }
    $el.removeAttr('srcset');
    $el.removeAttr('data-srcsetlazy');
  });
  // <source> elements inside a <picture> whose own srcset we just stripped
  // are now empty and useless — drop them entirely so they don't clutter the
  // imported HTML.
  $('source').remove();

  const main = $('main').first();
  if (main.length && main.text().trim().length > 50) {
    return main.html()?.trim() || '';
  }
  return $('body').html()?.trim() || '';
}

export function extractHeading(html: string): string {
  const $ = cheerio.load(html);
  const header = $('section[data-aid="HEADER_SECTION"]');
  const headerNodes = new Set(header.find('h1, h2').toArray());
  const h1 = $('h1').toArray().find((el) => !headerNodes.has(el));
  if (h1) {
    const t = $(h1).text().trim();
    if (t) return t;
  }
  const h2 = $('h2').toArray().find((el) => !headerNodes.has(el));
  if (h2) {
    const t = $(h2).text().trim();
    if (t) return t;
  }
  return extractMeta(html, 'og:title') || extractTitle(html);
}
