// src/lib/replicate/local-site/href-rewrite.ts
//
// Internal-href → WP-permalink rewriting for the owned-source path. Two
// consumers with one mapping convention (slugFromRelPath ⇄ /slug/, home → /):
//   - rewriteInternalHrefs: rewrite anchors in an HTML string (page bodies
//     BEFORE block emission; footer fragments via chrome-parts).
//   - buildInternalLinkMap: the raw-href → permalink map the theme's runtime
//     click shim uses for JS-RENDERED links (carried nav/footer scripts emit
//     source .html hrefs at runtime — no emission-time pass can see those).
//
import * as cheerio from 'cheerio';
import { slugFromRelPath } from './ingest.js';

/** "/": home; otherwise "/<slug>/" — matches the WP page permalinks created in page-plan. */
export function slugToUrl(slug: string): string {
  return slug === 'home' ? '/' : `/${slug}/`;
}

/**
 * Rewrite internal hrefs in an HTML string to WP permalink form (/slug/).
 * External hrefs (protocol, //, #) are untouched; unknown slugs untouched.
 * Assumes root-level pages: ".." segments resolve via slugFromRelPath's
 * sanitize; nested-page sources would need nav-graph's resolveHrefToRelPath.
 */
export function rewriteInternalHrefs(html: string, pageSlugs: string[]): string {
  const $ = cheerio.load(html);
  const known = new Set(pageSlugs);
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href') ?? '';
    if (!raw || /^[a-z]+:/i.test(raw) || raw.startsWith('//') || raw.startsWith('#')) return;
    let cleaned = raw.split(/[?#]/)[0];
    try {
      cleaned = decodeURIComponent(cleaned);
    } catch {
      // Malformed escape sequence — keep raw value.
    }
    const slug = slugFromRelPath(cleaned.replace(/^\.\//, '').replace(/^\//, ''));
    if (!known.has(slug)) return;
    $(el).attr('href', slugToUrl(slug));
  });
  return $('body').html() ?? html;
}

/**
 * Rewrite internal page references INSIDE carried source JS to permalinks.
 * The source JS is OURS to adapt at build time (owned-source philosophy) —
 * nav data arrays like { href:'shop.html' } become { href:'/shop/' } once,
 * in the bundle, instead of being patched at runtime. Conservative by
 * construction: only QUOTED string literals whose entire value is an internal
 * page path ('shop.html', "./shop.html", '/shop.html') are rewritten, matched
 * longest-path-first (the media-rewrite lesson: prefix paths must not clobber
 * longer ones).
 */
export function rewriteInternalLinksInJs(js: string, pages: Array<{ relPath: string; slug: string }>): string {
  const entries = pages
    .flatMap((p) => {
      const url = slugToUrl(p.slug);
      return [p.relPath, `./${p.relPath}`, `/${p.relPath}`].map((raw) => ({ raw, url }));
    })
    .sort((a, b) => b.raw.length - a.raw.length);
  let out = js;
  for (const { raw, url } of entries) {
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(['"])${escaped}\\1`, 'g'), (_m, q: string) => `${q}${url}${q}`);
  }
  return out;
}
