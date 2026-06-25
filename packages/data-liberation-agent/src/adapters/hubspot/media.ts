import { IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';
import type { CheerioRoot } from './types.js';
import { parseOrigin, normalizeUrl } from './url.js';

// Extensions that should never be treated as images, even when hosted on a
// recognized HubSpot CDN.
export const NON_IMAGE_EXTENSIONS = /\.(css|js|json|xml|txt|map|woff2?|ttf|eot|otf|pdf|zip|mp4|webm|mov)$/i;

/**
 * Tokenize an HTML srcset attribute into `{ url, descriptor }` pairs.
 *
 * A naive `split(',')` mis-handles URLs that contain commas in query strings
 * (e.g. `/img?sizes=1,2 1x`). This walker follows the HTML spec loosely: each
 * candidate is `URL` (non-whitespace run) optionally followed by a descriptor
 * (`1x`, `2x`, `320w`, etc.), with candidates separated by whitespace + comma.
 */
export function parseSrcset(srcset: string): { url: string; descriptor: string }[] {
  const out: { url: string; descriptor: string }[] = [];
  const n = srcset.length;
  let i = 0;
  while (i < n) {
    while (i < n && /[\s,]/.test(srcset.charAt(i))) i++;
    if (i >= n) break;
    const urlStart = i;
    while (i < n && !/\s/.test(srcset.charAt(i))) i++;
    let url = srcset.slice(urlStart, i);
    let urlHasTrailingComma = false;
    while (url.endsWith(',')) {
      url = url.slice(0, -1);
      urlHasTrailingComma = true;
    }
    while (i < n && /[ \t]/.test(srcset.charAt(i))) i++;
    let descriptor = '';
    if (!urlHasTrailingComma) {
      const descStart = i;
      while (i < n && srcset.charAt(i) !== ',') i++;
      descriptor = srcset.slice(descStart, i).trim();
    }
    if (url) out.push({ url, descriptor });
    if (i < n && srcset.charAt(i) === ',') i++;
  }
  return out;
}

/**
 * Pick the largest-resolution URL from a parsed srcset.
 *
 * Responsive images emit the same source at many widths (e.g. `foo-300w`,
 * `foo-600w`, `foo-1200w`). Importing every candidate duplicates the asset
 * in WordPress, which will then re-derive its own thumbnails on top — a
 * multiplicative explosion. We want the single largest source; WP regenerates
 * intermediate sizes server-side.
 *
 * Ranking prefers the highest `Nw` (width) descriptor, then the highest
 * `Nx` (density), then the last candidate listed (HubSpot's srcset is
 * typically ordered small → large).
 */
export function pickLargestFromSrcset(srcset: string): string | undefined {
  const candidates = parseSrcset(srcset);
  if (candidates.length === 0) return undefined;

  const score = (descriptor: string): number => {
    const wMatch = descriptor.match(/(\d+(?:\.\d+)?)w/);
    if (wMatch) return parseFloat(wMatch[1]);
    const xMatch = descriptor.match(/(\d+(?:\.\d+)?)x/);
    if (xMatch) return parseFloat(xMatch[1]);
    return 0;
  };

  let best = candidates[candidates.length - 1];
  let bestScore = score(best.descriptor);
  for (const c of candidates) {
    const s = score(c.descriptor);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best.url;
}

/**
 * Extract media URLs from a HubSpot page.
 *
 * Sources covered:
 * - HubSpot CDN (hubspotusercontent-*.net, f.hubspotusercontent*.net)
 * - `/hubfs/` paths on the site itself
 * - `<img src>`, `<img data-src>`
 * - Largest candidate from `<img srcset>` and `<source srcset>` inside `<picture>`
 */
export function extractHubSpotMediaUrls($: CheerioRoot, baseUrl: string): string[] {
  const urls = new Set<string>();
  const origin = parseOrigin(baseUrl);

  const push = (candidate: string | undefined) => {
    if (!candidate) return;
    const normalized = normalizeUrl(candidate, origin);
    if (normalized) urls.add(normalized);
  };

  $('img').each((_, el) => {
    const $el = $(el);
    push($el.attr('src'));
    push($el.attr('data-src'));
    const srcset = $el.attr('srcset');
    if (srcset) push(pickLargestFromSrcset(srcset));
  });

  $('source[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset') || '';
    push(pickLargestFromSrcset(srcset));
  });

  // Filter to image URLs. An image extension OR a HubSpot-hosted URL (which
  // often lacks an explicit extension on optimized assets). The hostname
  // shortcut is NOT a bypass for files like PDFs or stylesheets — the
  // non-image extension blocklist is enforced above it.
  return [...urls].filter((u) => {
    try {
      const parsed = new URL(u);
      if (NON_IMAGE_EXTENSIONS.test(parsed.pathname)) return false;
      if (IMAGE_EXTENSIONS.test(parsed.pathname)) return true;
      return /hubspotusercontent/i.test(parsed.hostname) || /\/hubfs\//.test(parsed.pathname);
    } catch {
      return false;
    }
  });
}
