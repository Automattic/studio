import * as cheerio from 'cheerio';
import type { NavLink } from '../lib/html-extract/index.js';
import type { ExtractionLog } from '../lib/resume-state/index.js';
import type { ImportSession } from '../lib/resume-state/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { classifyUrl } from '../lib/extraction/sitemap.js';
import { MediaStubStore } from '../lib/resume-state/index.js';
import { claimSlug, pageSlugFromUrl } from '../lib/url/index.js';
import { withTimeout, TimeoutError } from '../lib/concurrency.js';

/** Default time limit for one extractPage call (see extractTimeoutMs). An
 *  adapter await that never settles (a frozen browser, a dead socket) would
 *  otherwise block the whole loop; when the time is up the URL is logged as
 *  failed and the run continues. */
const PAGE_EXTRACT_TIMEOUT_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Strip non-content tags from HTML
// ---------------------------------------------------------------------------

function stripNonContentTags(html: string): string {
  const $ = cheerio.load(html, null, false);
  // Remove whole subtrees we never want in post content.
  $('script, style, form').remove();
  // Strip inline style attributes — source sites typically emit absolute
  // pixel sizes, fonts, and colors that fight the WordPress theme. WP block
  // editor and theme CSS handle presentation once the content is imported.
  $('[style]').removeAttr('style');
  return $.html();
}

// ---------------------------------------------------------------------------
// Shared sleep helper
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Generic product detection from HTML (JSON-LD Product schema)
// ---------------------------------------------------------------------------

export interface InventoryUrl {
  url: string;
  type: string;
}

/**
 * Cap a typed URL list to `limit` entries while keeping the sample
 * *representative* across content types.
 *
 * A naive `urls.slice(0, limit)` follows sitemap/inventory order, which on
 * multi-type sites (notably Shopify stores, where `/pages/*` sort before
 * `/products/*`) can exhaust the cap on a single type and silently drop
 * products entirely. A limited extraction of a *store* that contains zero
 * products is not a useful sample.
 *
 * Strategy:
 *   1. The homepage (if present) is always included first.
 *   2. PINNED urls (e.g. primary-nav targets) come next — they MUST survive the
 *      cap so the reconstructed menu never points at an uncaptured page.
 *   3. The remaining slots are filled round-robin across the type buckets,
 *      in each type's first-appearance order, so every content type that
 *      exists gets proportional representation.
 *   4. Relative order within a type is preserved.
 *
 * Returns exactly `min(limit, urls.length)` entries.
 *
 * @param pinnedUrls - Optional set of URL strings to prioritize immediately
 *   after the homepage. Entries whose `.url` is in this set are pulled to the
 *   front of the slice (in their original order) so a small `--limit` still
 *   includes every primary-nav destination.
 */
export function stratifiedUrlSlice<T extends { type: string; url?: string }>(
  urls: T[],
  limit: number,
  pinnedUrls?: Set<string>,
): T[] {
  if (limit < 0) return [];
  if (urls.length <= limit) return urls.slice();
  if (limit === 0) return [];

  // Bucket by type, preserving first-appearance order of both types and members.
  const buckets = new Map<string, T[]>();
  for (const u of urls) {
    const bucket = buckets.get(u.type);
    if (bucket) bucket.push(u);
    else buckets.set(u.type, [u]);
  }

  const result: T[] = [];
  const taken = new Set<T>();

  // 1. Homepage(s) first — the source's primary page anchors the design.
  const homepageBucket = buckets.get('homepage');
  if (homepageBucket) {
    for (const u of homepageBucket) {
      if (result.length >= limit) break;
      result.push(u);
      taken.add(u);
    }
    buckets.delete('homepage');
  }

  // 2. Pinned URLs (primary-nav targets) — pull them to the front, in original
  //    order, so the cap can't strand a menu link on an uncaptured page. We
  //    leave the taken entries in their type buckets and skip them in the
  //    round-robin below via `taken`.
  if (pinnedUrls && pinnedUrls.size > 0) {
    for (const u of urls) {
      if (result.length >= limit) break;
      if (taken.has(u)) continue;
      if (u.url && pinnedUrls.has(u.url)) {
        result.push(u);
        taken.add(u);
      }
    }
  }

  // 3. Round-robin across remaining type buckets until the limit is hit.
  //    Skip entries already taken as pinned nav targets so they aren't
  //    double-counted.
  const cursors = new Map<string, number>();
  for (const type of buckets.keys()) cursors.set(type, 0);
  let progressed = true;
  while (result.length < limit && progressed) {
    progressed = false;
    for (const [type, bucket] of buckets) {
      if (result.length >= limit) break;
      let idx = cursors.get(type)!;
      // Advance past any pinned entries already in the result.
      while (idx < bucket.length && taken.has(bucket[idx])) idx++;
      if (idx < bucket.length) {
        result.push(bucket[idx]);
        taken.add(bucket[idx]);
        cursors.set(type, idx + 1);
        progressed = true;
      } else {
        cursors.set(type, idx);
      }
    }
  }

  return result;
}

/**
 * Resolve captured primary-nav hrefs to the matching inventory URL strings, so
 * they can be pinned into a `--limit` slice. Matching is by same-origin
 * pathname (ignoring trailing slash, query, hash): a nav href
 * `https://site/pages/about-us` pins the inventory URL `https://site/pages/about-us`
 * (or `.../about-us/`). Off-site nav hrefs match nothing and are omitted.
 */
export function navTargetInventoryUrls(
  navigation: NavLink[],
  inventory: Array<{ url: string }>,
): Set<string> {
  const pinned = new Set<string>();
  if (navigation.length === 0) return pinned;

  // Index inventory by normalized pathname → original URL.
  const byPath = new Map<string, string>();
  for (const inv of inventory) {
    const p = normalizeUrlPath(inv.url);
    if (p !== null && !byPath.has(p)) byPath.set(p, inv.url);
  }

  for (const nav of navigation) {
    const p = normalizeUrlPath(nav.href);
    if (p === null) continue;
    const match = byPath.get(p);
    if (match) pinned.add(match);
  }
  return pinned;
}

/** Normalize an absolute URL to its pathname without trailing slash / query / hash. Null if unparseable or root. */
function normalizeUrlPath(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const stripped = parsed.pathname.replace(/\/+$/, '');
  return stripped || null; // root → null (homepage handled separately)
}
