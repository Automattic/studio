import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

export interface ThemeChromeLink {
  label: string;
  href: string;
  external: boolean;
}

export interface ThemeChromeEvidence {
  header?: {
    logoUrl?: string;
    logoAlt?: string;
    links: ThemeChromeLink[];
    /**
     * Light vs dark header treatment, inferred from the source header's
     * background. 'light' → white header + dark text; 'dark' → inverse header.
     * Defaults to 'light' when indeterminate (most storefront headers are light).
     */
    tone?: 'light' | 'dark';
    /**
     * The header's prominent call-to-action (a button or button-styled link —
     * e.g. "CALL US", "Talk To Us", "Get Started"), captured separately from the
     * primary nav links. Rendered as a header button so the replica isn't missing
     * the source CTA. Absent when the header has none.
     */
    cta?: ThemeChromeLink;
    /**
     * Which utility affordances the SOURCE header actually shows. The header only
     * emits the icons that are present here — so a non-storefront site (no
     * cart/account/search) gets none, instead of inventing them.
     */
    utilities?: { search?: boolean; account?: boolean; cart?: boolean };
    /** Source selector the chrome was matched from (display/tiebreak for the
     *  region audit #2; the audit's join is by role). */
    sourceSelector?: string;
  };
  footer?: {
    /** Footer logo (often a white/inverse variant), rendered as the first column. */
    logoUrl?: string;
    logoAlt?: string;
    text: string[];
    /** Footer links — INCLUDING tel:/mailto: contact links (kept, unlike the
     *  primary nav) so a "call us" phone number isn't dropped. */
    links: ThemeChromeLink[];
    /** Source selector the chrome was matched from (display/tiebreak for the
     *  region audit #2; the audit's join is by role). */
    sourceSelector?: string;
  };
}

const HEADER_SELECTORS = ['header', '[role="banner"]', '.wixui-header', '[data-testid="header"]', '#header', '.site-header'];
const FOOTER_SELECTORS = ['footer', '[role="contentinfo"]', '.wixui-footer', '[data-testid="footer"]', '#footer', '.site-footer'];

const IGNORE_LINK_LABELS = new Set([
  '',
  'menu',
  'scroll',
  'top of page',
  'skip to main content',
  // Account / cart / search affordances — icons, not primary nav destinations.
  'log in',
  'login',
  'sign in',
  'account',
  'my account',
  'cart',
  'search',
  'wishlist',
]);

/**
 * Labels of social / utility links that commonly appear inside a header but are
 * NOT part of the primary navigation menu. Dropped from the captured header nav.
 */
const SOCIAL_LINK_LABELS = new Set([
  'instagram',
  'facebook',
  'twitter',
  'x',
  'pinterest',
  'tiktok',
  'youtube',
  'linkedin',
  'snapchat',
  'threads',
]);

/**
 * Href substrings that mark social / account / cart / search destinations —
 * used to drop them from the captured primary nav even when their label slips
 * past the label denylist.
 */
const NON_PRIMARY_HREF_HINTS = [
  'instagram.com',
  'facebook.com',
  'twitter.com',
  'pinterest.com',
  'tiktok.com',
  'youtube.com',
  'linkedin.com',
  '/cart',
  '/account',
  '/customer_authentication',
  '/search',
  'customer_authentication',
];

export function extractThemeChromeFromHtml(html: string, sourceUrl: string): ThemeChromeEvidence {
  if (!html.trim()) return {};

  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const $header = firstUseful($, HEADER_SELECTORS);
  const $footer = firstUseful($, FOOTER_SELECTORS);

  const out: ThemeChromeEvidence = {};
  if ($header.length > 0) {
    const logo = extractLogo($, $header, sourceUrl);
    out.header = {
      ...logo,
      links: extractPrimaryNavLinks($, $header, sourceUrl, 8),
      tone: detectHeaderTone($header),
      cta: extractHeaderCta($, $header, sourceUrl),
      utilities: detectHeaderUtilities($header),
      sourceSelector: firstUsefulSelector($, HEADER_SELECTORS),
    };
  }
  if ($footer.length > 0) {
    out.footer = {
      ...extractLogo($, $footer, sourceUrl),
      text: extractFooterText($, $footer),
      links: extractLinks($, $footer, sourceUrl, 14),
      sourceSelector: firstUsefulSelector($, FOOTER_SELECTORS),
    };
  }

  return out;
}

/**
 * Infer whether the header is a light (white-ish) or dark treatment from any
 * inline background-color on the header element or its first wrapping group.
 * Defaults to 'light' — most storefront headers are light, and a light header
 * with dark text is a safer fidelity default than a dark inverse bar.
 */
function detectHeaderTone($header: cheerio.Cheerio<AnyNode>): 'light' | 'dark' {
  const styles: string[] = [];
  const headerStyle = $header.attr('style');
  if (headerStyle) styles.push(headerStyle);
  const innerStyle = $header.children('[style]').first().attr('style');
  if (innerStyle) styles.push(innerStyle);

  for (const style of styles) {
    const m = /background(?:-color)?\s*:\s*([^;]+)/i.exec(style);
    if (!m) continue;
    const lum = cssColorLuminance(m[1].trim());
    if (lum !== null) return lum < 0.5 ? 'dark' : 'light';
  }
  return 'light';
}

/** Rough relative luminance for #hex / rgb()/rgba() values; null when unparseable. */
function cssColorLuminance(css: string): number | null {
  const s = css.trim().toLowerCase();
  let r: number, g: number, b: number;
  const hex = /^#([0-9a-f]{6})$/.exec(s);
  const hex3 = /^#([0-9a-f]{3})$/.exec(s);
  const rgb = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s);
  if (hex) {
    r = parseInt(hex[1].slice(0, 2), 16); g = parseInt(hex[1].slice(2, 4), 16); b = parseInt(hex[1].slice(4, 6), 16);
  } else if (hex3) {
    r = parseInt(hex3[1][0] + hex3[1][0], 16); g = parseInt(hex3[1][1] + hex3[1][1], 16); b = parseInt(hex3[1][2] + hex3[1][2], 16);
  } else if (rgb) {
    r = parseFloat(rgb[1]); g = parseFloat(rgb[2]); b = parseFloat(rgb[3]);
  } else {
    return null;
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function firstUseful($: cheerio.CheerioAPI, selectors: string[]): cheerio.Cheerio<AnyNode> {
  for (const selector of selectors) {
    const $match = $(selector).first();
    if ($match.length > 0 && normalizeText($match.text()).length > 0) {
      return $match;
    }
  }
  return $([]);
}

/** The selector firstUseful would have matched (for sourceSelector back-ref). */
function firstUsefulSelector($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const $match = $(selector).first();
    if ($match.length > 0 && normalizeText($match.text()).length > 0) return selector;
  }
  return undefined;
}

function extractLogo(
  $: cheerio.CheerioAPI,
  $root: cheerio.Cheerio<AnyNode>,
  sourceUrl: string,
): { logoUrl?: string; logoAlt?: string } {
  const images = $root.find('img').toArray();
  const scored = images
    .map((el) => {
      const $img = $(el);
      const alt = normalizeText($img.attr('alt') ?? '');
      const src = $img.attr('src') ?? '';
      const parentHref = $img.closest('a').attr('href') ?? '';
      let score = 0;
      if (/logo/i.test(alt) || /logo/i.test(src)) score += 4;
      if (isHomeHref(parentHref, sourceUrl)) score += 2;
      if ($img.attr('fetchpriority') === 'high') score += 1;
      return { src, alt, score };
    })
    .filter((item) => item.src && item.score > 0)
    .sort((a, b) => b.score - a.score);

  const logo = scored[0];
  if (!logo) return {};
  return {
    logoUrl: absolutizeUrl(logo.src, sourceUrl),
    logoAlt: logo.alt || 'Site logo',
  };
}

function extractLinks(
  $: cheerio.CheerioAPI,
  $root: cheerio.Cheerio<AnyNode>,
  sourceUrl: string,
  limit: number,
): ThemeChromeLink[] {
  const anchorEls: AnyNode[] = [];
  $root.find('nav a, a[data-part="menu-item-link"], a').each((_, el) => { anchorEls.push(el); });
  // Footer keeps social/utility links (primaryOnly = false).
  return finalizeLinks($, anchorEls, sourceUrl, limit, false);
}

/**
 * Extract the PRIMARY navigation menu links from a header.
 *
 * Headers carry far more anchors than the real menu: mega-menu sub-links,
 * a separate mobile drawer copy of the menu, social icons, cart/account/search.
 * Capturing all of them (as `extractLinks` does) yields a noisy nav. This
 * function instead:
 *
 *   1. Picks a single primary menu container — preferring the inline/desktop
 *      menu (`nav.header__inline-menu`, `nav[role]`, `.header__inline-menu`),
 *      then the first `<nav>`, then the header itself.
 *   2. Reads only TOP-LEVEL items — the first anchor inside each direct
 *      `<li>` of the menu's top-level `<ul>` (skipping nested mega-menu
 *      sub-link lists). Falls back to direct-child anchors when there's no list.
 *   3. Filters out social / account / cart / search affordances.
 *
 * Source-agnostic: the container preferences cover Shopify (`header__inline-menu`),
 * generic semantic `<nav>`, and role-based menus. Returns a deduped, capped list.
 */
function extractPrimaryNavLinks(
  $: cheerio.CheerioAPI,
  $header: cheerio.Cheerio<AnyNode>,
  sourceUrl: string,
  limit: number,
): ThemeChromeLink[] {
  const $menu = pickPrimaryMenu($, $header);

  // Prefer the top-level <ul>'s direct <li> anchors (one per item, no sub-links).
  const $topList = $menu.children('ul').first().length > 0
    ? $menu.children('ul').first()
    : $menu.find('ul').first();

  const anchorEls: AnyNode[] = [];
  if ($topList.length > 0) {
    $topList.children('li').each((_, li) => {
      const $a = $(li).find('a[href]').first();
      if ($a.length > 0) anchorEls.push($a.get(0) as AnyNode);
    });
  }
  // Fallback: direct-child anchors of the menu (flat nav, no <ul>).
  if (anchorEls.length === 0) {
    $menu.children('a[href]').each((_, a) => { anchorEls.push(a); });
  }
  // Last resort: all anchors in the menu (still filtered below).
  if (anchorEls.length === 0) {
    $menu.find('a[href]').each((_, a) => { anchorEls.push(a); });
  }

  return finalizeLinks($, anchorEls, sourceUrl, limit, true);
}

/** Labels that are NOT a content CTA (controls / utility affordances). */
const NON_CTA_LABEL = /\b(menu|close|open|toggle|hamburger|skip|search|cart|account|log\s?in|sign\s?in|next|previous|prev|submit|play|pause|expand|collapse|back|back to site)\b/i;

/**
 * Capture the header's prominent CTA — a `<button>` or button-styled link with a
 * real label (e.g. "CALL US"), distinct from the nav links. The first qualifying
 * one wins (CTAs sit at the header's end). tel:/mailto: hrefs are kept verbatim;
 * other hrefs are absolutized; a hrefless button yields an empty href (the
 * renderer emits a non-linking button). Site-agnostic.
 */
function extractHeaderCta(
  $: cheerio.CheerioAPI,
  $header: cheerio.Cheerio<AnyNode>,
  sourceUrl: string,
): ThemeChromeLink | undefined {
  const els = $header
    .find('button, [role="button"], a.button, a.btn, a[class*="cta" i], a[class*="button" i]')
    .toArray();
  const origin = safeUrl(sourceUrl)?.origin;
  for (const el of els) {
    const $el = $(el);
    // Skip controls inside a mobile drawer / dialog overlay — the desktop-visible
    // CTA lives in the open header bar, not the hamburger menu (which also holds
    // "Back to site"/duplicate CTAs). This keeps the captured CTA the one the user
    // actually sees in the nav.
    if ($el.closest('[role="dialog"],[aria-hidden="true"],[class*="hamburger" i],[class*="drawer" i],[class*="overlay" i]').length > 0) continue;
    const label = normalizeText($el.text());
    const lower = label.toLowerCase();
    if (label.length < 2 || label.length > 32) continue;
    if (NON_CTA_LABEL.test(lower) || IGNORE_LINK_LABELS.has(lower) || SOCIAL_LINK_LABELS.has(lower)) continue;
    const rawHref = $el.attr('href') ?? $el.find('a[href]').first().attr('href') ?? '';
    let href = '';
    if (rawHref.startsWith('tel:') || rawHref.startsWith('mailto:')) {
      href = rawHref;
    } else if (rawHref && !rawHref.startsWith('#')) {
      const parsed = safeUrl(absolutizeUrl(rawHref, sourceUrl));
      if (parsed) href = origin && parsed.origin === origin ? `${parsed.pathname}${parsed.search}` || '/' : parsed.toString();
    }
    return { label, href, external: false };
  }
  return undefined;
}

/**
 * Detect which utility affordances the source header actually has (search /
 * account / cart) from strong signals — an input/aria-label/link href — so the
 * replica only emits the icons that exist instead of inventing a storefront
 * cluster. Returns undefined when none (a non-storefront header gets no icons).
 */
function detectHeaderUtilities($header: cheerio.Cheerio<AnyNode>): { search?: boolean; account?: boolean; cart?: boolean } | undefined {
  const has = (sel: string): boolean => $header.find(sel).length > 0;
  const search = has('input[type="search"]') || has('[aria-label*="search" i]') || has('a[href*="?s=" i]') || has('a[href*="/search" i]');
  const account =
    has('a[href*="/account" i]') || has('a[href*="login" i]') || has('a[href*="signin" i]') || has('a[href*="customer_authentication" i]') || has('[aria-label*="account" i]') || has('[aria-label*="log in" i]');
  const cart = has('a[href*="/cart" i]') || has('[aria-label*="cart" i]') || has('[data-hook*="cart" i]') || has('[data-testid*="cart" i]');
  const out: { search?: boolean; account?: boolean; cart?: boolean } = {};
  if (search) out.search = true;
  if (account) out.account = true;
  if (cart) out.cart = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Choose the primary menu container within a header. Preference order targets
 * the desktop/inline menu so we don't capture the mobile drawer's duplicate.
 */
function pickPrimaryMenu(
  $: cheerio.CheerioAPI,
  $header: cheerio.Cheerio<AnyNode>,
): cheerio.Cheerio<AnyNode> {
  const selectors = [
    'nav.header__inline-menu',
    '.header__inline-menu',
    'nav[aria-label]',
    'nav[role="navigation"]',
    'nav',
  ];
  for (const sel of selectors) {
    const $match = $header.find(sel).first();
    if ($match.length > 0 && $match.find('a[href]').length > 0) return $match;
  }
  return $header;
}

/**
 * Normalize, filter, absolutize, and dedupe a list of anchor elements into
 * ThemeChromeLink[]. When `primaryOnly` is set, social/account/cart/search
 * links are dropped (header primary nav); footer links keep them.
 */
function finalizeLinks(
  $: cheerio.CheerioAPI,
  anchorEls: AnyNode[],
  sourceUrl: string,
  limit: number,
  primaryOnly: boolean,
): ThemeChromeLink[] {
  const origin = safeUrl(sourceUrl)?.origin;
  const seen = new Set<string>();
  const links: ThemeChromeLink[] = [];

  for (const el of anchorEls) {
    const $link = $(el);
    const label = normalizeText($link.text());
    const lower = label.toLowerCase();
    if (IGNORE_LINK_LABELS.has(lower)) continue;
    if (primaryOnly && SOCIAL_LINK_LABELS.has(lower)) continue;

    const rawHref = $link.attr('href') ?? '';
    if (!rawHref || rawHref.startsWith('#')) continue;
    // tel:/mailto: are contact affordances — dropped from the primary nav, but
    // KEPT (verbatim) in the footer so a "Call Us" phone number isn't lost.
    if (rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
      if (primaryOnly) continue;
      const ckey = `${lower} ${rawHref}`;
      if (seen.has(ckey)) continue;
      seen.add(ckey);
      links.push({ label, href: rawHref, external: false });
      if (links.length >= limit) break;
      continue;
    }
    if (primaryOnly && NON_PRIMARY_HREF_HINTS.some((h) => rawHref.toLowerCase().includes(h))) continue;

    const absolute = absolutizeUrl(rawHref, sourceUrl);
    if (!absolute) continue;
    const parsed = safeUrl(absolute);
    if (!parsed) continue;
    const external = origin ? parsed.origin !== origin : /^https?:\/\//i.test(absolute);
    const href = external ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
    const key = `${lower} ${href}`;
    if (seen.has(key)) continue;
    seen.add(key);

    links.push({ label, href: href === '' ? '/' : href, external });
    if (links.length >= limit) break;
  }

  return links;
}

function extractFooterText($: cheerio.CheerioAPI, $footer: cheerio.Cheerio<AnyNode>): string[] {
  const seen = new Set<string>();
  const linkLabels = new Set<string>();
  $footer.find('a').each((_, el) => {
    const text = normalizeText($(el).text());
    if (text) linkLabels.add(text.toLowerCase());
  });
  const chunks: string[] = [];
  $footer.find('p,h1,h2,h3,h4,h5,h6,li').each((_, el) => {
    const text = normalizeText($(el).text());
    if (!text || text.length < 3) return;
    if (IGNORE_LINK_LABELS.has(text.toLowerCase())) return;
    if (linkLabels.has(text.toLowerCase())) return;
    if (seen.has(text.toLowerCase())) return;
    seen.add(text.toLowerCase());
    chunks.push(text);
  });
  if (chunks.length > 0) return chunks.slice(0, 8);

  const fallback = normalizeText($footer.text());
  return fallback ? [fallback.slice(0, 240)] : [];
}

function isHomeHref(href: string, sourceUrl: string): boolean {
  const parsed = safeUrl(absolutizeUrl(href, sourceUrl));
  const source = safeUrl(sourceUrl);
  if (!parsed || !source) return false;
  return parsed.origin === source.origin && (parsed.pathname === '/' || parsed.pathname === '');
}

function absolutizeUrl(raw: string, base: string): string {
  try {
    return new URL(raw, base).toString();
  } catch {
    return '';
  }
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}
