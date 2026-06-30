/**
 * Resolve a site identifier to a base URL with scheme.
 *
 * If the input already has a scheme, use it as-is.
 * Otherwise, try HTTPS first with a quick probe; fall back to HTTP if it fails.
 * For bare hostnames like "localhost:8883" or "127.0.0.1:8080",
 * this avoids hardcoding http:// since local dev environments may use HTTPS.
 */
export async function resolveSiteUrl(site: string): Promise<string> {
  if (site.startsWith('http://') || site.startsWith('https://')) {
    return site.replace(/\/+$/, '');
  }

  const host = site.replace(/\/+$/, '');

  // Try HTTPS first
  try {
    const resp = await fetch(`https://${host}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000),
      redirect: 'manual',
    });
    // Any response (even 301/302/403) means HTTPS works
    if (resp.status > 0) return `https://${host}`;
  } catch {
    // HTTPS failed — try HTTP
  }

  return `http://${host}`;
}

/**
 * Synchronous version that uses the old heuristic (localhost/127.0.0.1 → http, else https).
 * Use resolveSiteUrl() when async is available.
 */
export function resolveSiteUrlSync(site: string): string {
  if (site.startsWith('http://') || site.startsWith('https://')) {
    return site.replace(/\/+$/, '');
  }
  const host = site.replace(/\/+$/, '');
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return `http://${host}`;
  }
  return `https://${host}`;
}
