export class SameOriginViolation extends Error {
  constructor(public violations: string[], public expected: string) {
    super(`Same-origin violation — expected ${expected}, got: ${violations.join(', ')}`);
    this.name = 'SameOriginViolation';
  }
}

/**
 * Canonicalize an origin for same-origin comparison by stripping a single
 * leading `www.` from the host. `https://example.com` and
 * `https://www.example.com` canonicalize to the same value so the apex and the
 * `www` subdomain are treated as one origin (detect/discover/extract already
 * tolerate this; capture used to reject it). Protocol and port are preserved
 * verbatim, so a different protocol/port/host still differs.
 */
export function canonicalizeOrigin(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  return `${parsed.protocol}//${canonicalizeHost(parsed)}`;
}

/**
 * The host (with any non-default port) minus a single leading `www.` — the
 * scheme-independent part of `canonicalizeOrigin`. Sitemaps are published by
 * the site, not fetched by capture, and routinely list `http://` or the other
 * `www` variant of the host they are served from, so discovery compares on this
 * and then rewrites accepted entries onto the entry URL's own origin.
 */
export function canonicalizeHost(url: string | URL): string {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  return parsed.host.replace(/^www\./i, '');
}

/**
 * Throws SameOriginViolation if any URL in `urls` has a different origin than
 * `primaryUrl`. If primaryUrl is null, the first URL in `urls` is used as the
 * reference. A leading `www.` is treated as origin-equivalent to the apex.
 * Matches the same-origin enforcement in fetchSitemap().
 */
export function enforceSameOrigin(primaryUrl: string | null, urls: string[]): void {
  if (urls.length === 0) return;
  const reference = primaryUrl ?? urls[0];
  let refOrigin: string;
  try {
    refOrigin = canonicalizeOrigin(reference);
  } catch {
    throw new Error(`enforceSameOrigin: invalid reference URL: ${reference}`);
  }
  const violations: string[] = [];
  for (const u of urls) {
    try {
      if (canonicalizeOrigin(u) !== refOrigin) violations.push(u);
    } catch {
      throw new Error(`enforceSameOrigin: invalid URL: ${u}`);
    }
  }
  if (violations.length > 0) throw new SameOriginViolation(violations, refOrigin);
}
