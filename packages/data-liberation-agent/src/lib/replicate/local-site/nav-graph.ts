import { posix } from 'node:path';
import * as cheerio from 'cheerio';
import { slugFromRelPath } from './ingest.js';
import type { LocalSite, NavLink } from './types.js';

/** True for hrefs that point outside the local site (absolute URL, mailto, anchor). */
function isExternal(href: string): boolean {
  return /^[a-z]+:/i.test(href) || href.startsWith('//') || href.startsWith('#');
}

/** Resolve a raw internal href against the linking page's relPath → site-root-relative path. */
function resolveHrefToRelPath(href: string, fromRelPath: string): string {
  let cleaned = href.split(/[?#]/)[0];
  // Percent-encoded internal hrefs ("about%20us.html") must decode before
  // slugging so they match the slug derived from the on-disk filename.
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // Malformed escape sequence — resolve the raw href as-is.
  }
  if (!cleaned || cleaned === '/') return 'index.html';
  if (cleaned.startsWith('/')) return cleaned.slice(1); // root-relative
  // Relative href: resolve against the linking page's directory. Paths that
  // escape the site root keep a leading ".." after normalize and simply won't
  // match any known slug downstream — dropped, which is the right outcome.
  return posix.normalize(posix.join(posix.dirname(fromRelPath), cleaned));
}

export function buildNavGraph(site: LocalSite): NavLink[] {
  const knownSlugs = new Set(site.pages.map((p) => p.slug));
  const links: NavLink[] = [];
  for (const page of site.pages) {
    const $ = cheerio.load(page.html);
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (!href || isExternal(href)) return;
      const toSlug = slugFromRelPath(resolveHrefToRelPath(href, page.relPath));
      if (!knownSlugs.has(toSlug)) return;
      const link: NavLink = { fromSlug: page.slug, toSlug, label: $(el).text().trim() };
      // Footer-nested navs (Privacy/Terms legal menus) must not enter the
      // header menu pool; body-direct <nav> sites still mark normally.
      if ($(el).closest('nav').length > 0 && $(el).closest('footer').length === 0) link.inNav = true;
      links.push(link);
    });
  }
  return links;
}
