interface UrlPattern {
  pattern: RegExp;
  platform: string;
}

interface HttpSignal {
  header: string;
  value?: string;
  platform: string;
  signal: string;
}

interface SourceSignal {
  pattern: RegExp;
  platform: string;
  signal: string;
}

/**
 * Active path-probe signal — issues an HTTP HEAD request to a platform-specific
 * path and matches on the response status (and optionally the Location header).
 *
 * Use for platforms that expose a stable admin or API path that can be detected
 * even when the homepage HTML has been heavily themed and emits no source markers.
 * Probes only fire when URL_PATTERNS, HTTP_SIGNALS, and SOURCE_SIGNALS all fail
 * to identify the platform — they pay an extra HTTP round-trip, so they're a
 * fallback, not a primary detection mechanism.
 */
interface PathProbe {
  /** Path relative to site root, e.g. "/_emdash/admin" */
  path: string;
  /** Status codes that indicate a match (e.g. [302, 401]) */
  expectedStatus: number[];
  /**
   * Optional substring that must appear in the response Location header.
   * Tightens probe against false-positives from wildcard redirects on
   * non-platform sites that happen to return the same status code.
   */
  locationContains?: string;
  platform: string;
  signal: string;
}

export interface DetectionResult {
  platform: string;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
}

export interface FullDetectionResult extends DetectionResult {
  url: string;
}

const URL_PATTERNS: UrlPattern[] = [
  { pattern: /wixsite\.com|wix\.com/i, platform: 'wix' },
  { pattern: /squarespace\.com/i, platform: 'squarespace' },
  { pattern: /webflow\.io|webflow\.com/i, platform: 'webflow' },
  { pattern: /myshopify\.com|shopify\.com/i, platform: 'shopify' },
  { pattern: /weebly\.com/i, platform: 'weebly' },
];

const HTTP_SIGNALS: HttpSignal[] = [
  { header: 'x-wix-request-id', platform: 'wix', signal: 'X-Wix-Request-Id header' },
  { header: 'server', value: 'squarespace', platform: 'squarespace', signal: 'Server: Squarespace header' },
  { header: 'x-servedby', value: 'squarespace', platform: 'squarespace', signal: 'X-ServedBy: squarespace header' },
  { header: 'x-powered-by', value: 'webflow', platform: 'webflow', signal: 'X-Powered-By: Webflow header' },
  { header: 'x-wf-region', platform: 'webflow', signal: 'x-wf-region header (Webflow infrastructure)' },
  { header: 'x-shopid', platform: 'shopify', signal: 'X-ShopId header' },
  { header: 'powered-by', value: 'shopify', platform: 'shopify', signal: 'Powered-by: Shopify header' },
  { header: 'x-host', value: 'weebly.net', platform: 'weebly', signal: 'X-Host: *.weebly.net header (Weebly backend)' },
  { header: 'x-siteid', platform: 'godaddy-wm', signal: 'X-SiteId header (GoDaddy DPS)' },
];

const SOURCE_SIGNALS: SourceSignal[] = [
  { pattern: /wixstatic\.com/i, platform: 'wix', signal: 'wixstatic.com in page source' },
  { pattern: /cdn\.shopify\.com/i, platform: 'shopify', signal: 'cdn.shopify.com in page source' },
  { pattern: /static\.squarespace\.com/i, platform: 'squarespace', signal: 'static.squarespace.com in page source' },
  { pattern: /data-wf-domain/i, platform: 'webflow', signal: 'data-wf-domain attribute in page source' },
  { pattern: /_shopify_s|_shopify_y|Shopify\.theme/i, platform: 'shopify', signal: 'Shopify markers in page source' },
  { pattern: /editmysite\.com/i, platform: 'weebly', signal: 'editmysite.com CDN in page source' },
  { pattern: /wsite-menu-item|wsite-content|_W\.configDomain\s*=\s*["'].*weebly/i, platform: 'weebly', signal: 'Weebly markers in page source' },
  { pattern: /zyrosite\.com/i, platform: 'hostinger', signal: 'zyrosite.com CDN in page source (Hostinger Website Builder)' },
  { pattern: /<meta[^>]+name=["']generator["'][^>]+content=["']Hostinger[^"']*["']/i, platform: 'hostinger', signal: 'Hostinger generator meta tag' },
  { pattern: /<meta[^>]+name=["']generator["'][^>]+content=["']HubSpot["']/i, platform: 'hubspot', signal: 'HubSpot generator meta tag' },
  { pattern: /Go Daddy Website Builder|Starfield Technologies/i, platform: 'godaddy-wm', signal: 'GoDaddy Website Builder generator meta in page source' },
  { pattern: /img1\.wsimg\.com\/isteam/i, platform: 'godaddy-wm', signal: 'img1.wsimg.com/isteam CDN reference in page source' },
];

/**
 * Registry of path probes. Iterated by the probe tier in `detectFromHttp`
 * when URL/header/source-pattern detection all return 'unknown'.
 *
 * **Exported only for test injection.** Tests may push probe entries via
 * `PATH_PROBES.push(...)` and clean up via `PATH_PROBES.length = 0` (typically
 * in an `afterEach` hook). Production code must NOT mutate this array — define
 * platform-specific probes here at module load time, not at runtime.
 */
export const PATH_PROBES: PathProbe[] = [
  // PR 2 adds the EmDash entry. Keeping this PR pure-infrastructure.
];

export function detectFromUrl(url: string): string | null {
  const normalized = url.includes('://') ? url : `https://${url}`;
  for (const { pattern, platform } of URL_PATTERNS) {
    if (pattern.test(normalized)) return platform;
  }
  return null;
}

export async function detectFromHttp(url: string): Promise<DetectionResult> {
  const signals: string[] = [];
  let platform = 'unknown';
  let confidence: 'high' | 'medium' | 'low' = 'low';

  try {
    const normalized = url.includes('://') ? url : `https://${url}`;
    const response = await fetch(normalized, {
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });

    for (const sig of HTTP_SIGNALS) {
      const headerVal = response.headers.get(sig.header);
      if (headerVal && (!sig.value || headerVal.toLowerCase().includes(sig.value))) {
        platform = sig.platform;
        confidence = 'high';
        signals.push(sig.signal);
      }
    }

    if (platform === 'unknown') {
      let html = '';
      try {
        html = await response.text();
      } catch {
        // Body read failed (truncation, encoding, mid-stream network error).
        // Fall through to source-pattern (no matches) and probe tier.
      }
      for (const sig of SOURCE_SIGNALS) {
        if (sig.pattern.test(html)) {
          platform = sig.platform;
          confidence = 'medium';
          signals.push(sig.signal);
        }
      }
    }

    if (platform === 'unknown') {
      for (const probe of PATH_PROBES) {
        try {
          const probeUrlObj = new URL(probe.path, normalized);
          if (probeUrlObj.origin !== new URL(normalized).origin) continue;
          const probeUrl = probeUrlObj.toString();
          const probeResp = await fetch(probeUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(10000),
            redirect: 'manual',
          });
          if (!probe.expectedStatus.includes(probeResp.status)) continue;
          if (probe.locationContains) {
            const loc = probeResp.headers.get('location') || '';
            if (!loc.includes(probe.locationContains)) continue;
          }
          platform = probe.platform;
          confidence = 'high';
          signals.push(probe.signal);
          break;
        } catch {
          // Probe fetch failed (network error, timeout, etc.) — try next probe.
        }
      }
    }
  } catch {
    // Network error — return unknown
  }

  return { platform, confidence, signals };
}

export async function detect(url: string): Promise<FullDetectionResult> {
  const urlResult = detectFromUrl(url);
  if (urlResult) {
    return {
      url,
      platform: urlResult,
      confidence: 'high',
      signals: [`URL contains ${urlResult} domain`],
    };
  }

  const httpResult = await detectFromHttp(url);
  return { url, ...httpResult };
}
