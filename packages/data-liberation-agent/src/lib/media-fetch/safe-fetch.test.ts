import { describe, it, expect } from 'vitest';
import {
  assertPublicHttpUrl,
  safeFetch,
  SsrfBlockedError,
  BodyTooLargeError,
  MAX_DOWNLOAD_BYTES,
} from './safe-fetch.js';

/** Minimal Response-shaped mock for safeFetch's injected fetch. */
function mockResponse(opts: {
  status?: number;
  headers?: Record<string, string>;
  body?: Uint8Array;
}): Response {
  const headers = new Headers(opts.headers ?? {});
  const bytes = opts.body ?? new Uint8Array(0);
  return {
    status: opts.status ?? 200,
    headers,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

describe('assertPublicHttpUrl', () => {
  it('rejects the cloud metadata link-local address', () => {
    expect(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/'))
      .toThrow(SsrfBlockedError);
  });
  it('rejects localhost', () => {
    expect(() => assertPublicHttpUrl('http://localhost/x.woff2')).toThrow(SsrfBlockedError);
  });
  it('rejects 127.0.0.1 loopback', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1:8080/a')).toThrow(SsrfBlockedError);
  });
  it('rejects 10.0.0.0/8 private', () => {
    expect(() => assertPublicHttpUrl('http://10.0.0.1/x')).toThrow(SsrfBlockedError);
  });
  it('rejects 172.16/12 private', () => {
    expect(() => assertPublicHttpUrl('http://172.16.5.4/x')).toThrow(SsrfBlockedError);
    expect(() => assertPublicHttpUrl('http://172.31.255.255/x')).toThrow(SsrfBlockedError);
  });
  it('allows a 172.32 host (outside the private 172.16/12 block)', () => {
    expect(() => assertPublicHttpUrl('http://172.32.0.1/x')).not.toThrow();
  });
  it('rejects 192.168/16 private', () => {
    expect(() => assertPublicHttpUrl('http://192.168.1.1/x')).toThrow(SsrfBlockedError);
  });
  it('rejects 0.0.0.0', () => {
    expect(() => assertPublicHttpUrl('http://0.0.0.0/x')).toThrow(SsrfBlockedError);
  });
  it('rejects IPv6 loopback ::1', () => {
    expect(() => assertPublicHttpUrl('http://[::1]/x')).toThrow(SsrfBlockedError);
  });
  it('rejects IPv6 unique-local fc00::/7', () => {
    expect(() => assertPublicHttpUrl('http://[fc00::1]/x')).toThrow(SsrfBlockedError);
    expect(() => assertPublicHttpUrl('http://[fd12:3456::1]/x')).toThrow(SsrfBlockedError);
  });
  it('rejects IPv6 link-local fe80::/10', () => {
    expect(() => assertPublicHttpUrl('http://[fe80::1]/x')).toThrow(SsrfBlockedError);
  });
  it('rejects a .local mDNS hostname', () => {
    expect(() => assertPublicHttpUrl('http://printer.local/x')).toThrow(SsrfBlockedError);
  });
  it('rejects a bare single-label hostname (no dot)', () => {
    expect(() => assertPublicHttpUrl('http://metadata/x')).toThrow(SsrfBlockedError);
  });
  it('rejects non-http(s) schemes (file/ftp/data)', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(SsrfBlockedError);
    expect(() => assertPublicHttpUrl('ftp://example.com/x')).toThrow(SsrfBlockedError);
    expect(() => assertPublicHttpUrl('data:text/html,<script>1</script>')).toThrow(SsrfBlockedError);
  });
  it('allows a normal public https URL', () => {
    expect(() => assertPublicHttpUrl('https://fonts.gstatic.com/s/x.woff2')).not.toThrow();
    expect(() => assertPublicHttpUrl('https://cdn.shopify.com/Larsseit.woff')).not.toThrow();
  });
});

describe('safeFetch', () => {
  it('fetches a normal public URL and returns the body', async () => {
    const fakeFetch = (async () => mockResponse({ status: 200, body: new TextEncoder().encode('OK-BYTES') })) as unknown as typeof fetch;
    const res = await safeFetch('https://cdn.example.com/font.woff2', { fetchImpl: fakeFetch });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('OK-BYTES');
  });

  it('rejects an internal-host URL before fetching', async () => {
    let called = false;
    const fakeFetch = (async () => { called = true; return mockResponse({}); }) as unknown as typeof fetch;
    await expect(safeFetch('http://169.254.169.254/x.woff2', { fetchImpl: fakeFetch }))
      .rejects.toBeInstanceOf(SsrfBlockedError);
    expect(called).toBe(false);
  });

  it('rejects a public URL that 302-redirects to an internal host', async () => {
    const fakeFetch = (async (url: string) => {
      if (url.startsWith('https://public.example.com')) {
        return mockResponse({ status: 302, headers: { location: 'http://169.254.169.254/latest/' } });
      }
      return mockResponse({ status: 200, body: new TextEncoder().encode('SECRET') });
    }) as unknown as typeof fetch;
    await expect(safeFetch('https://public.example.com/start', { fetchImpl: fakeFetch }))
      .rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('follows a redirect to another public host', async () => {
    const fakeFetch = (async (url: string) => {
      if (url.startsWith('https://a.example.com')) {
        return mockResponse({ status: 301, headers: { location: 'https://b.example.com/final' } });
      }
      return mockResponse({ status: 200, body: new TextEncoder().encode('FINAL') });
    }) as unknown as typeof fetch;
    const res = await safeFetch('https://a.example.com/start', { fetchImpl: fakeFetch });
    expect(res.body.toString()).toBe('FINAL');
    expect(res.finalUrl).toBe('https://b.example.com/final');
  });

  it('aborts an over-size body via Content-Length pre-check', async () => {
    const fakeFetch = (async () => mockResponse({
      status: 200,
      headers: { 'content-length': String(MAX_DOWNLOAD_BYTES + 1) },
      body: new TextEncoder().encode('small'),
    })) as unknown as typeof fetch;
    await expect(safeFetch('https://cdn.example.com/huge.woff2', { fetchImpl: fakeFetch }))
      .rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('aborts an over-size body via the streaming byte counter (no Content-Length)', async () => {
    const fakeFetch = (async () => mockResponse({
      status: 200,
      body: new Uint8Array(64), // larger than the tiny maxBytes below
    })) as unknown as typeof fetch;
    await expect(safeFetch('https://cdn.example.com/x.woff2', { fetchImpl: fakeFetch, maxBytes: 16 }))
      .rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('caps the number of redirects', async () => {
    const fakeFetch = (async (url: string) => mockResponse({
      status: 302,
      headers: { location: `https://example.com/${encodeURIComponent(url)}` },
    })) as unknown as typeof fetch;
    await expect(safeFetch('https://example.com/start', { fetchImpl: fakeFetch, maxRedirects: 3 }))
      .rejects.toThrow(/too many redirects/);
  });
});
