// ---------------------------------------------------------------------------
// Shared slugify — used by all adapters
// ---------------------------------------------------------------------------

export function slugify(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '').replace(/\//g, '--') || 'homepage';
  } catch {
    return 'homepage';
  }
}

// ---------------------------------------------------------------------------
// Page slug derivation — source-faithful WP post_name
// ---------------------------------------------------------------------------

/**
 * Derive a WordPress `post_name` (page/post slug) from a source URL.
 *
 * Unlike {@link slugify} — which joins the full path with `--` for use as a
 * screenshot/manifest *filename* (`/pages/about-us` → `pages--about-us`) — this
 * returns the LAST path segment so the imported page lives at a source-faithful
 * permalink:
 *
 *   /pages/about-us                        → about-us
 *   /pages/shop-all                        → shop-all
 *   /blogs/snoozweek/white-noise-vs-brown  → white-noise-vs-brown
 *   /                                      → homepage
 *
 * IMPORTANT: this is intentionally separate from `slugify`. The screenshot
 * manifest join + filenames depend on `slugify`'s `--`-joined convention and
 * MUST NOT change; only the WXR `post_name` uses this last-segment slug.
 *
 * The result is normalized to WP slug characters (lowercase a–z0–9 and `-`).
 * Collision suffixing is the caller's responsibility (see `claimSlug`), so the
 * extraction loop can keep a single shared `seen` map across all pages.
 */
export function pageSlugFromUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 'homepage';
  }
  // Last non-empty path segment.
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  // Truly empty path (root `/`) → the homepage sentinel.
  if (!last) return 'homepage';
  const normalized = normalizeSlug(decodeSegment(last));
  // A non-empty segment that normalizes to empty (all-punctuation, `..`, etc.)
  // must NOT silently shadow the homepage sentinel — it's a distinct page.
  if (!normalized) return 'page-1';
  return escapeReservedSlug(normalized);
}

/**
 * WordPress slugs that collide with core routes (or our own `homepage`
 * sentinel). A source page whose last path segment normalizes to one of these
 * would shadow a core endpoint (`/feed/`, `/wp-admin/`, `/page/2/` pagination,
 * `/wp-json/`) or our homepage — silently breaking the route. Suffix such a
 * slug with `-page` so it stays distinct and visible rather than colliding.
 */
const RESERVED_SLUGS = new Set([
  'wp-admin', 'wp-content', 'wp-includes', 'wp-json', 'feed', 'embed',
  'page', 'attachment', 'comments', 'trackback', 'author', 'category', 'tag',
  'homepage',
]);

/** Suffix a normalized slug when it would collide with a WP-reserved route. */
function escapeReservedSlug(slug: string): string {
  return RESERVED_SLUGS.has(slug) ? `${slug}-page` : slug;
}

/** Decode a single path segment (percent-encoding), tolerating malformed input. */
function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** Normalize a string to WordPress slug characters: lowercase, a–z0–9 and `-`. */
function normalizeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Claim a slug, appending `-2`, `-3`, … on collision. Mutates `seen`.
 *
 * Mirrors the screenshot pipeline's `claimSlug` (src/lib/screenshot/output-layout.ts)
 * so page-slug collisions (e.g. `/a/contact` and `/b/contact` both → `contact`)
 * resolve deterministically to distinct WP `post_name`s.
 */
export function claimSlug(base: string, seen: Map<string, number>): string {
  const existing = seen.get(base);
  if (existing === undefined) {
    seen.set(base, 1);
    return base;
  }
  const next = existing + 1;
  seen.set(base, next);
  return `${base}-${next}`;
}
