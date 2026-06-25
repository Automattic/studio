//
// Internal link rewriting (source href -> imported permalink)
// ===========================================================
// Reconstructed pages and generated nav template parts carry source hrefs
// verbatim. After import, a link to the source site's `/about` should point at
// the imported WordPress page's permalink instead.
//
// `output/<site>/screenshots/manifest.json` is the authoritative
// `sourceUrl -> slug` map. Imported pages get `post_name = slug`, so the target
// is the root-relative pretty permalink `/{slug}/` (homepage -> `/`).
//
// This module is pure (no I/O), mirroring `media-url-rewrite.ts`: the caller
// builds the map from the manifest and hands us a string. The same function is
// used for page-body block markup and for generated nav template parts — both
// expose links as `href="..."` attribute surfaces.
//
/** A `redirect-map.json` entry: source path -> local WP permalink. */
export interface RedirectMapEntry {
  from: string;
  to: string;
}

/** Normalized link key -> root-relative target permalink (e.g. "/about/"). */
export type InternalLinkMap = Map<string, string>;

export interface BuildInternalLinkMapOpts {
  /**
   * Source-site hostnames (e.g. ["example.test"]). When supplied, each redirect
   * entry also registers a `host+path` key so ABSOLUTE same-site hrefs match.
   * Absolute hrefs to any other host are left untouched (no false rewrites).
   */
  siteOrigins?: string[];
}

export interface InternalLinkRewriteOpts {
  /**
   * Fired once per unique candidate href that looked internal (root-relative or
   * bare-relative) but had no mapping — e.g. a page we didn't extract. Mirrors
   * `rewriteMediaUrls`' missing-warning contract.
   */
  onMissing?: (href: string) => void;
}

/**
 * Collapse a URL pathname into the canonical key form used for both map keys
 * and candidate lookups: percent-decoded, `.html`/`.htm` stripped, trailing
 * slash removed (except root), lowercased, leading-slash guaranteed.
 */
function normalizePath(pathname: string): string {
  let p = pathname;
  try {
    p = decodeURIComponent(p);
  } catch {
    // Leave malformed percent-sequences as-is.
  }
  p = p.replace(/\.html?$/i, '');
  if (!p.startsWith('/')) p = '/' + p;
  if (p !== '/') p = p.replace(/\/+$/, '');
  if (p === '') p = '/';
  return p.toLowerCase();
}

/** Lowercase host with a leading `www.` stripped. */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Build the rewrite map from `redirect-map.json` entries — the canonical
 * source-path -> local-permalink map the nav/footer rewrite also consumes.
 *
 * Each entry registers two keys pointing at the same target so both absolute
 * and relative source hrefs match:
 *   - path-only      `/about`                 (root-relative + bare hrefs)
 *   - host + path    `example.test/about`     (absolute hrefs; requires origins)
 *
 * The site root (`/`) is always seeded to `/` so homepage links pass through
 * without a spurious "unmapped" warning.
 */
export function buildInternalLinkMap(
  redirectMap: RedirectMapEntry[],
  opts: BuildInternalLinkMapOpts = {},
): InternalLinkMap {
  const map: InternalLinkMap = new Map();
  const hosts = (opts.siteOrigins ?? []).map(normalizeHost).filter(Boolean);

  const register = (from: string, to: string) => {
    const path = normalizePath(from);
    map.set(path, to);
    for (const host of hosts) map.set(`${host}${path}`, to);
  };

  register('/', '/');
  for (const entry of redirectMap ?? []) {
    if (!entry?.from || !entry?.to) continue;
    register(entry.from, entry.to);
  }
  return map;
}

const SKIP_SCHEME = /^(?:mailto:|tel:|javascript:|data:|sms:|geo:|callto:)/i;

interface Candidate {
  /** Map lookup key, or null when the href should be skipped entirely. */
  key: string | null;
  /** `#fragment` (including the leading `#`) to re-append after rewrite, or ''. */
  fragment: string;
  /** True when the href is root-relative or bare-relative (clearly internal). */
  internalRelative: boolean;
}

/** Derive the lookup key + fragment for a single href value. */
function analyzeHref(rawHref: string): Candidate {
  const href = rawHref.trim();
  const none: Candidate = { key: null, fragment: '', internalRelative: false };
  if (!href || SKIP_SCHEME.test(href)) return none;
  // Pure in-page anchor: no path component.
  if (href.startsWith('#')) return none;

  // Absolute (or protocol-relative) URL.
  if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
    let url: URL;
    try {
      url = new URL(href.startsWith('//') ? `https:${href}` : href);
    } catch {
      return none;
    }
    const key = `${normalizeHost(url.hostname)}${normalizePath(url.pathname)}`;
    return { key, fragment: url.hash, internalRelative: false };
  }

  // Relative (root-relative `/x` or bare `x` / `./x` / `../x`).
  const hashIdx = href.indexOf('#');
  const fragment = hashIdx >= 0 ? href.slice(hashIdx) : '';
  let pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const queryIdx = pathPart.indexOf('?');
  if (queryIdx >= 0) pathPart = pathPart.slice(0, queryIdx);
  pathPart = pathPart.replace(/^(?:\.\.?\/)+/, '');
  return { key: normalizePath(pathPart), fragment, internalRelative: true };
}

/**
 * Rewrite internal href surfaces in an HTML / block-markup string. Pure.
 *
 * Only `href` attribute values are touched; unmatched/external/scheme links are
 * left as-is. Internal-looking misses are reported via `opts.onMissing`.
 */
export function rewriteInternalLinks(
  input: string,
  map: InternalLinkMap,
  opts: InternalLinkRewriteOpts = {},
): string {
  if (!input || map.size === 0) return input;

  const warned = new Set<string>();
  // Capture the quote char so we re-emit the same style (group 1 = quote).
  return input.replace(/\bhref\s*=\s*(["'])([^"']*)\1/gi, (whole, quote: string, value: string) => {
    const { key, fragment, internalRelative } = analyzeHref(value);
    if (key === null) return whole;
    const target = map.get(key);
    if (target) {
      return `href=${quote}${target}${fragment}${quote}`;
    }
    if (internalRelative && opts.onMissing && !warned.has(value)) {
      warned.add(value);
      opts.onMissing(value);
    }
    return whole;
  });
}
