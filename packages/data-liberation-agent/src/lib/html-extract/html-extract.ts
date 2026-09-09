import * as cheerio from 'cheerio';

// ---------------------------------------------------------------------------
// Shared HTML extraction helpers — used by multiple adapters
// ---------------------------------------------------------------------------

export const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|svg|webp|avif|ico|bmp|tiff)/i;

export function extractMeta(html: string, property: string): string {
  const $ = cheerio.load(html);
  return $(`meta[property="${property}"]`).attr('content')
    || $(`meta[name="${property}"]`).attr('content')
    || '';
}

export function extractTitle(html: string): string {
  const $ = cheerio.load(html);
  return $('title').first().text().trim();
}

export function extractHeading(html: string): string {
  const $ = cheerio.load(html);
  const h1 = $('h1').first().text().trim();
  if (h1) return h1;
  return $('title').first().text().trim();
}

export function extractNavLinks(html: string, baseUrl: string): NavLink[] {
  const $ = cheerio.load(html);
  const links: NavLink[] = [];
  const seen = new Set<string>();

  // Header navigation is the page's primary navigation. Some sites also use
  // <nav> in their footer, so only fall back to every nav landmark when no
  // header navigation is present.
  const primaryLinks = $('header nav a[href], [role="banner"] nav a[href]');
  const navLinks = primaryLinks.length > 0 ? primaryLinks : $('nav a[href]');

  navLinks.each((_, el) => {
    const rawHref = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (!text || rawHref === '#' || rawHref.startsWith('javascript:')) return;

    let href = rawHref;
    try {
      href = new URL(rawHref, baseUrl).href;
    } catch {
      // Preserve malformed or non-URL schemes rather than dropping source data.
    }
    if (seen.has(href)) return;
    seen.add(href);
    links.push({ text, href });
  });

  return links;
}

export interface NavLink {
  text: string;
  href: string;
}
