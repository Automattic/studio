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

  $('nav a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (!text || seen.has(href)) return;
    seen.add(href);

    let fullHref = href;
    if (href.startsWith('/')) {
      try {
        fullHref = new URL(href, baseUrl).href;
      } catch {
        fullHref = href;
      }
    }
    links.push({ text, href: fullHref });
  });

  return links;
}

export interface NavLink {
  text: string;
  href: string;
}

export interface PageTitleContext {
  siteTitle?: string;
  navigation?: NavLink[];
  url?: string;
}

function normalizeNavUrl(url: string): string {
  return url.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Derive the WordPress admin title for an imported page.
 *
 * Strips a trailing " | Site Name" suffix. A title that is just the site-wide
 * title carries no page identity (site builders let owners set one SEO title
 * for every page, which would name every imported page identically), so it
 * falls back to the page's navigation label, then to the humanized slug.
 */
export function resolvePageTitle(
  rawTitle: string,
  slug: string,
  context: PageTitleContext = {}
): string {
  const pipeIdx = rawTitle.lastIndexOf(' | ');
  const cleaned = (pipeIdx > 0 ? rawTitle.slice(0, pipeIdx) : rawTitle).trim();

  const isSiteWide = context.siteTitle ? cleaned === context.siteTitle.trim() : false;
  if (cleaned && !isSiteWide) {
    return cleaned;
  }

  if (context.url && context.navigation) {
    const target = normalizeNavUrl(context.url);
    const navMatch = context.navigation.find((link) => normalizeNavUrl(link.href) === target);
    if (navMatch?.text) {
      return navMatch.text;
    }
  }

  return humanizeSlug(slug) || cleaned;
}
