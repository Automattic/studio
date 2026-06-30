//
// Shared page-body internal-link map builder
// ==========================================
// Both reconstruct paths (block `reconstruct-pages` and carry-and-scope
// `reconstruct-pages-carry`) rewrite source hrefs in page bodies / nav parts to
// the imported WordPress permalinks. They build the rewrite map the SAME way —
// from `<outputDir>/redirect-map.json` (the canonical source-path → local
// permalink map the nav/footer rewrite also consumes), seeded with the page
// origins so ABSOLUTE same-site hrefs match too.
//
// Extracted here so the two handlers share one implementation instead of each
// carrying a private copy. Pure except for the single redirect-map read.
//

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildInternalLinkMap,
  type InternalLinkMap,
  type RedirectMapEntry,
} from '../streaming/internal-link-rewrite.js';

/**
 * Build the page-body link map from `<outputDir>/redirect-map.json` plus the
 * hostnames of the supplied page source URLs (so absolute same-site hrefs
 * match). Best-effort: a missing/corrupt map yields a root-only map and links
 * simply pass through unrewritten.
 *
 * @param outputDir       Liberation output directory containing redirect-map.json.
 * @param pageSourceUrls  Source URLs of the pages being reconstructed — their
 *                        hostnames seed the absolute-href (host+path) keys.
 */
export function buildPageLinkMap(outputDir: string, pageSourceUrls: string[]): InternalLinkMap {
  let redirectMap: RedirectMapEntry[] = [];
  try {
    const p = join(resolve(outputDir), 'redirect-map.json');
    if (existsSync(p)) {
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      if (Array.isArray(parsed)) redirectMap = parsed as RedirectMapEntry[];
    }
  } catch {
    /* best-effort — fall back to a root-only map */
  }
  redirectMap = redirectMap.concat(productRedirectEntries(outputDir));
  const origins = new Set<string>();
  for (const url of pageSourceUrls) {
    try {
      origins.add(new URL(url).hostname);
    } catch {
      /* skip an unparseable source URL */
    }
  }
  return buildInternalLinkMap(redirectMap, { siteOrigins: [...origins] });
}

/**
 * Product source URLs → local WooCommerce permalinks, derived from
 * `<outputDir>/products.jsonl`. The extraction's redirect-map only covers
 * pages/posts (products import separately via CSV, so their WP slugs don't
 * exist at extraction time) — without these entries every carried
 * `/products/<handle>` href passes through to the LIVE source site (getsnooz
 * dogfood finding, 2026-06-09: 425 product refs left absolute).
 *
 * The local slug is predicted with WordPress's `sanitize_title` semantics over
 * the product NAME — the same value the WooCommerce CSV importer slugs. A
 * collision-uniquified slug (`-2`) on import can still 404; verify post-build.
 * Only parent rows carry `sourceUrl` (variant rows don't), so the map stays
 * one-entry-per-product.
 */
function productRedirectEntries(outputDir: string): RedirectMapEntry[] {
  const out: RedirectMapEntry[] = [];
  try {
    const p = join(resolve(outputDir), 'products.jsonl');
    if (!existsSync(p)) return out;
    const seen = new Set<string>();
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row: { sourceUrl?: string; name?: string };
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (!row.sourceUrl || !row.name) continue;
      let fromPath: string;
      try {
        fromPath = new URL(row.sourceUrl).pathname;
      } catch {
        continue;
      }
      const slug = wcSlugFromName(row.name);
      if (!slug || seen.has(fromPath)) continue;
      seen.add(fromPath);
      out.push({ from: fromPath, to: `/product/${slug}/` });
    }
  } catch {
    /* best-effort — products simply stay unrewritten */
  }
  return out;
}

/** WP `sanitize_title` approximation: lowercase, strip accents/symbols, hyphenate. */
function wcSlugFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['"‘’“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
