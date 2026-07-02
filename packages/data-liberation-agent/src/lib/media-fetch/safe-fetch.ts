//
// SSRF guard + size-bounded fetch
// ================================
// Every downloader in this project pulls URLs parsed out of arbitrary
// third-party source HTML/CSS (font `src`, logo `<img>`, `<img>`/`url()`
// media references). Those URLs are attacker-controlled: a malicious source
// site can point a font/logo/media URL at an internal address
// (`http://169.254.169.254/...`, `http://localhost/...`, `http://10.0.0.1/...`)
// to make our fetcher exfiltrate cloud metadata or probe an internal network
// (SSRF), or 302-redirect a public URL to an internal host, or return a
// multi-gigabyte body to OOM the process / fill the disk.
//
// `assertPublicHttpUrl(url)` rejects non-http(s) schemes and internal hosts.
// `safeFetch(url, opts)` re-checks on every redirect (manual follow, capped),
// and enforces a max body size via Content-Length pre-check AND a running
// byte counter while reading. Every source-derived download path routes
// through here.
//

/** Max bytes any single download may produce. Bounds OOM (buffered) + disk-fill (streamed). */
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
/** Max redirects to follow before giving up. */
export const MAX_REDIRECTS = 5;
/** Default per-request timeout. */
const DEFAULT_TIMEOUT_MS = 30_000;

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export class BodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyTooLargeError';
  }
}

/**
 * Parse a host string into its literal-IP form when it is one, else null.
 * Strips IPv6 brackets. Returns the normalized string for range checks.
 */
function literalIp(host: string): { kind: 'ipv4' | 'ipv6'; value: string } | null {
  let h = host;
  // IPv6 in URL form is bracketed: [::1], [fe80::1]
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  // Strip a zone id (fe80::1%eth0)
  const pct = h.indexOf('%');
  if (pct >= 0) h = h.slice(0, pct);

  // IPv4: four dotted decimal octets.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const parts = h.split('.').map((p) => Number(p));
    if (parts.every((n) => n >= 0 && n <= 255)) return { kind: 'ipv4', value: h };
  }
  // IPv6: contains a colon and only hex/colon chars (best-effort literal detection).
  if (h.includes(':') && /^[0-9a-fA-F:]+$/.test(h)) {
    return { kind: 'ipv6', value: h.toLowerCase() };
  }
  return null;
}

/** Is a literal IPv4 address in a loopback / private / link-local / unspecified range? */
function isInternalIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map((p) => Number(p));
  if (a === 0) return true; // 0.0.0.0/8 "this network" (incl. 0.0.0.0)
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. 169.254.169.254 metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240/4 reserved
  return false;
}

/** Is a literal IPv6 address loopback / unique-local / link-local / unspecified / IPv4-mapped-internal? */
function isInternalIpv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::1') return true; // loopback
  if (v === '::' || v === '0:0:0:0:0:0:0:0') return true; // unspecified
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // fc00::/7 unique-local
  if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4.
  const mapped = v.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isInternalIpv4(mapped[1]);
  return false;
}

/**
 * Throw {@link SsrfBlockedError} when `rawUrl` is not a fetchable PUBLIC
 * http(s) URL. Rejects:
 *   - non-http(s) schemes (file:, ftp:, data:, gopher:, etc.)
 *   - literal loopback/private/link-local/unspecified IPs (v4 + v6)
 *   - `localhost`, `*.local`, and bare single-label hostnames (no dot)
 *
 * Hostname (non-literal) resolution is best-effort by design — we block the
 * literal-IP and localhost/.local/bare-host cases without a DNS lookup so the
 * check stays synchronous and side-effect-free. Returns the parsed URL.
 */
export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`unparseable URL: ${String(rawUrl).slice(0, 200)}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`disallowed URL scheme "${url.protocol}" (only http/https)`);
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    throw new SsrfBlockedError('URL has no host');
  }

  // Literal IP? Check it against the internal ranges directly.
  const lit = literalIp(host);
  if (lit) {
    const internal = lit.kind === 'ipv4' ? isInternalIpv4(lit.value) : isInternalIpv6(lit.value);
    if (internal) {
      throw new SsrfBlockedError(`internal/loopback IP address not allowed: ${host}`);
    }
    return url;
  }

  // Hostname (not a literal IP).
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new SsrfBlockedError(`loopback hostname not allowed: ${host}`);
  }
  if (host.endsWith('.local')) {
    throw new SsrfBlockedError(`mDNS/.local hostname not allowed: ${host}`);
  }
  // Bare single-label hostnames (no dot) resolve to internal names on most
  // networks (e.g. `intranet`, `metadata`, a container/service name). A real
  // public site always has a dot. Best-effort block.
  if (!host.includes('.')) {
    throw new SsrfBlockedError(`bare single-label hostname not allowed: ${host}`);
  }

  return url;
}

export interface SafeFetchOpts {
  /** Per-request timeout in ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Max body bytes. Defaults to {@link MAX_DOWNLOAD_BYTES}. */
  maxBytes?: number;
  /** Max redirects to follow. Defaults to {@link MAX_REDIRECTS}. */
  maxRedirects?: number;
  /** Injected fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Extra request headers. */
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  /** Final (post-redirect) URL that produced the body. */
  finalUrl: string;
  /** HTTP status of the final response. */
  status: number;
  /** Response headers of the final response. */
  headers: Headers;
  /** The fully-read body, size-capped. */
  body: Buffer;
}

/**
 * SSRF-safe, size-bounded fetch. Validates the URL (and every redirect target)
 * with {@link assertPublicHttpUrl}, follows redirects manually (capped), and
 * enforces a max body size via Content-Length pre-check AND a running byte
 * counter while streaming. Throws {@link SsrfBlockedError} or
 * {@link BodyTooLargeError} on violation; other failures throw normally.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOpts = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const doFetch = opts.fetchImpl ?? fetch;

  let currentUrl = assertPublicHttpUrl(rawUrl).toString();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await doFetch(currentUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
      headers: opts.headers,
    });

    // Defensive header accessor — real fetch always supplies `headers`, but
    // test mocks may omit it. A missing header reads as null.
    const header = (name: string): string | null => {
      try {
        return res.headers?.get?.(name) ?? null;
      } catch {
        return null;
      }
    };

    // Manual redirect handling: re-validate every Location so a public URL
    // can't 302 to an internal host.
    if (res.status >= 300 && res.status < 400) {
      const location = header('location');
      // Drain the redirect body so the connection can be reused/closed.
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (!location) {
        throw new Error(`redirect ${res.status} with no Location header`);
      }
      if (hop === maxRedirects) {
        throw new Error(`too many redirects (> ${maxRedirects})`);
      }
      const next = new URL(location, currentUrl).toString();
      currentUrl = assertPublicHttpUrl(next).toString();
      continue;
    }

    // Content-Length pre-check (cheap reject before reading the body).
    const contentLength = header('content-length');
    if (contentLength) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > maxBytes) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        throw new BodyTooLargeError(
          `response body ${declared} bytes exceeds max ${maxBytes} (Content-Length)`,
        );
      }
    }

    const body = await readCapped(res, maxBytes);
    return { finalUrl: currentUrl, status: res.status, headers: res.headers, body };
  }

  // Unreachable: the loop returns or throws on every path.
  throw new Error(`too many redirects (> ${maxRedirects})`);
}

/**
 * Read a response body into a Buffer, aborting (and throwing
 * {@link BodyTooLargeError}) if the running total exceeds `maxBytes`. Works on
 * a streaming body (web ReadableStream); falls back to arrayBuffer + post-check
 * for environments / mocks without a stream.
 */
async function readCapped(res: { body?: unknown; arrayBuffer: () => Promise<ArrayBuffer> }, maxBytes: number): Promise<Buffer> {
  const stream = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            try { await reader.cancel(); } catch { /* ignore */ }
            throw new BodyTooLargeError(`response body exceeds max ${maxBytes} bytes (streamed)`);
          }
          chunks.push(value);
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }

  // No stream available (test mock): read fully then post-check.
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new BodyTooLargeError(`response body ${buf.length} bytes exceeds max ${maxBytes}`);
  }
  return buf;
}
