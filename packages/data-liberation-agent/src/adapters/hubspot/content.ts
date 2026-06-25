import * as cheerio from 'cheerio';
import { parseOrigin } from './url.js';
import { pickLargestFromSrcset } from './media.js';
import type { CheerioRoot } from './types.js';

// Classes HubSpot uses for marketing widgets we want to strip from content.
// `blog-post__preheader` is the above-title label strip; `blog-post__summary`
// is the intro paragraph that HubSpot renders before the body — we surface
// it as a WordPress excerpt instead of leaving it duplicated inside content.
export const HUBSPOT_WIDGET_SELECTORS = [
  '.hs-cta-wrapper',
  '.hs-cta-node',
  '.hs_cos_wrapper_type_form',
  '.hs_cos_wrapper_type_blog_comments',
  '.addthis_toolbox',
  '.addthis_sharing_toolbox',
  '.blog-post__preheader',
  '.blog-post__summary',
  '.blog-post__timestamp',
  '.blog-post__author',
  '.blog-post__social-sharing',
  '.blog-post__tags',
  '.blog-more',
  '.blog-more-grid',
  '.subscriber-form',
].join(', ');

export function isHubSpotBlogPost($: CheerioRoot): boolean {
  return $('.hs-blog-post').length > 0;
}

export function stripWidgets($container: ReturnType<CheerioRoot>): void {
  $container.find(HUBSPOT_WIDGET_SELECTORS).remove();
}

/**
 * Extract content from a HubSpot page.
 *
 * Strategy:
 * 1. Blog posts: use `.post-body` container (clean article content)
 * 2. Regular pages: use `.body-container` with navigation/chrome stripped
 * 3. Fallback to `<main>` or `<body>` with chrome stripped
 */
export function extractContent($: CheerioRoot): string {
  // 1. .post-body — try first regardless of body class, since some custom
  //    themes strip `hs-blog-post` but still render blog content in a
  //    .post-body container.
  const postBody = $('.post-body').first();
  if (postBody.length) {
    stripWidgets(postBody);
    const html = postBody.html();
    if (html) return html.trim();
  }

  // 2. .body-container with nav/header/footer removed
  const bodyContainer = $('.body-container').first();
  if (bodyContainer.length) {
    bodyContainer.find('nav, header, footer').remove();
    stripWidgets(bodyContainer);
    const html = bodyContainer.html();
    if (html) return html.trim();
  }

  // 3. <main>
  const main = $('main').first();
  if (main.length && main.text().trim()) {
    stripWidgets(main);
    const html = main.html();
    if (html) return html.trim();
  }

  // 4. <body> with chrome stripped
  const body = $('body').first();
  if (body.length) {
    body.find('nav, header, footer').remove();
    stripWidgets(body);
    const html = body.html();
    if (html) return html.trim();
  }

  return '';
}

/**
 * Finalize extracted post content HTML:
 *   1. Resolve relative `src`, `href`, `data-src` attributes to absolute URLs.
 *   2. Strip `srcset` and `sizes` from `<img>` elements and remove `<source>`
 *      tags from `<picture>` wrappers.
 *
 * Why the srcset stripping: the importer imports only the largest candidate
 * from each srcset, and `rewriteMediaUrls` only knows how to replace URLs
 * that were imported as media. Any smaller srcset variants we leave behind
 * will never be rewritten and will orphan-link back to hubspotusercontent.
 *
 * Once srcset is stripped, WordPress re-derives a fresh responsive srcset at
 * render time via `wp_filter_content_tags()` — it matches the rewritten
 * `<img src>` against the imported attachment's metadata and injects the
 * sub-sizes WP generated on upload. Browsers rendering a `<picture>` with
 * its `<source>` children removed fall back to the nested `<img>`.
 */
export function finalizeContentHtml(contentHtml: string, baseUrl: string): string {
  const origin = parseOrigin(baseUrl);

  const resolve = origin
    ? (candidate: string): string => {
        if (/^https?:\/\//i.test(candidate)) return candidate;
        if (candidate.startsWith('//')) return 'https:' + candidate;
        if (candidate.startsWith('/')) return origin + candidate;
        return candidate;
      }
    : (candidate: string): string => candidate;

  // `false` = don't add <html>/<body> wrappers (fragment parse).
  const $ = cheerio.load(contentHtml, null, false);

  // Promote <img> src to the largest srcset candidate BEFORE dropping srcset.
  // The media extractor imports the largest candidate, and `rewriteMediaUrls`
  // in the importer rewrites content URLs only if they match what it imported.
  // HubSpot often emits a small fallback `src` alongside a much larger srcset,
  // so without this promotion the imported-media URL and the content `src`
  // never line up and the post keeps pointing at hubspotusercontent.
  $('img[srcset]').each((_, el) => {
    const $el = $(el);
    const srcset = $el.attr('srcset') || '';
    const largest = pickLargestFromSrcset(srcset);
    if (largest) $el.attr('src', largest);
  });

  if (origin) {
    $('[src], [href], [data-src]').each((_, el) => {
      const $el = $(el);
      for (const attr of ['src', 'href', 'data-src'] as const) {
        const v = $el.attr(attr);
        if (v) $el.attr(attr, resolve(v));
      }
    });
  }

  // Drop responsive-image metadata so WordPress regenerates its own.
  $('img').removeAttr('srcset').removeAttr('sizes');
  $('picture source').remove();

  return $.html();
}

/**
 * Strip the first <h1> if its text matches the post title. HubSpot renders
 * the title inside content; WordPress also displays post_title, so we'd see
 * the title twice otherwise.
 */
export function stripDuplicateTitle($: CheerioRoot, title: string): void {
  if (!title) return;
  const normalized = title.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return;
  const $h1 = $('h1').first();
  if (!$h1.length) return;
  const h1Text = $h1.text().replace(/\s+/g, ' ').trim().toLowerCase();
  if (h1Text === normalized) $h1.remove();
}
