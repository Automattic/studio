// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

export function parseOrigin(baseUrl: string): string | null {
  try {
    return new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).origin;
  } catch {
    return null;
  }
}

/**
 * Normalize a URL candidate — accepting absolute, protocol-relative
 * (`//host/path`), and root-relative (`/path`) forms. Returns an absolute
 * URL string or null.
 */
export function normalizeUrl(candidate: string, origin: string | null): string | null {
  if (!candidate) return null;
  if (candidate.startsWith('http://') || candidate.startsWith('https://')) return candidate;
  if (candidate.startsWith('//')) return 'https:' + candidate;
  if (candidate.startsWith('/')) return origin ? origin + candidate : null;
  return null;
}

/**
 * URL-based blog classification. HubSpot sites often put posts under paths
 * like `/blog/`, `/news/`, `/insights/`. Require a non-empty segment after the
 * keyword so index pages aren't reclassified, and restrict the broader
 * keywords (`resources`, `updates`) to two-segment depth.
 */
export function looksLikeBlogPostPath(u: string): boolean {
  if (/\/(blog|news|insights|articles)\/[^/?#]+/i.test(u)) return true;
  if (/\/(resources|updates)\/[^/?#]+\/[^/?#]+/i.test(u)) return true;
  return false;
}
