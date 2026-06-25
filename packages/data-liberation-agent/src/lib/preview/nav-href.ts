/**
 * src/lib/preview/nav-href.ts
 * ============================
 * Resolves a source-site nav href to its local imported page path.
 *
 * Rules:
 *   - Unparseable href (relative, anchor, mailto:, tel:) → returned unchanged.
 *   - Different registrable domain (eTLD+1) → EXTERNAL → returned unchanged.
 *   - Same site, pathname is `/` or empty → `/` (WP front page).
 *   - Same site, any other pathname → `/<pageSlugFromUrl(href)>/`
 *     where the slug is the LAST path segment, matching exactly how imported
 *     pages get their WP `post_name` (src/adapters/shared.ts runExtractionLoop).
 *     This is the SOURCE-FAITHFUL slug (`/pages/about-us` → `/about-us/`), NOT
 *     the `--`-joined screenshot/manifest `slugify` filename.
 */

import { registrableDomain } from '../screenshot/first-party.js';
import { pageSlugFromUrl } from '../url/index.js';

/**
 * Map a source nav href to the corresponding local WordPress page path.
 *
 * @param href    - The href value from the extracted nav item (may be absolute,
 *                  relative, anchor, mailto:, etc.)
 * @param siteUrl - The base URL of the source site (e.g. "https://www.swiftlumber.com").
 *                  Used to determine whether `href` is first-party.
 * @returns The local path (e.g. `/about-us/`, `/`) for same-site pages, or
 *          the original href unchanged for external / relative / non-HTTP links.
 */
export function resolveNavHref(href: string, siteUrl: string): string {
  // Reject obviously non-absolute-URL values before attempting URL parsing:
  // relative paths, pure anchors, mailto:, tel:, javascript:, etc.
  // We only rewrite fully-qualified http(s) URLs.
  if (!href.startsWith('http://') && !href.startsWith('https://')) {
    return href;
  }

  let parsed: URL;
  let base: URL;

  try {
    parsed = new URL(href);
  } catch {
    return href;
  }

  try {
    base = new URL(siteUrl);
  } catch {
    // Can't parse siteUrl — can't determine first-party, leave href unchanged.
    return href;
  }

  // Different registrable domain → external link, keep unchanged.
  if (registrableDomain(parsed.hostname) !== registrableDomain(base.hostname)) {
    return href;
  }

  // Same site: check if it's the home page (root path).
  // Normalize by stripping trailing slashes from the pathname, then check
  // whether what remains is empty (meaning it was "/" or "").
  const rawPath = parsed.pathname;
  const stripped = rawPath.replace(/\/+$/, '');

  if (!stripped) {
    // Pathname is "/" or "" → front page.
    return '/';
  }

  // Non-root same-site URL: build a normalized URL with the trailing slash
  // removed (preserving origin) so the derived slug matches the imported page,
  // which is pageSlugFromUrl(canonicalUrl) — the last path segment.
  // Example: "https://example.com/pages/about-us/" → strip trailing "/" →
  // "https://example.com/pages/about-us" → pageSlugFromUrl → "about-us".
  const normalized = new URL(parsed.href);
  normalized.pathname = stripped;
  normalized.search = '';
  normalized.hash = '';
  return `/${pageSlugFromUrl(normalized.href)}/`;
}
