import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateWpConnection, type WpSetupReport } from './wp-setup.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(responses: Array<{ url: RegExp; status: number; json?: unknown; headers?: Record<string, string> }>) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const r of responses) {
      if (r.url.test(url)) {
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          headers: new Headers(r.headers || {}),
          json: async () => r.json || {},
          text: async () => JSON.stringify(r.json || {}),
        };
      }
    }
    throw new Error(`No mock for ${url}`);
  });
}

describe('validateWpConnection', () => {
  it('reports success for a valid connection', async () => {
    mockFetch([
      {
        url: /\/wp-json$/,
        status: 200,
        json: { name: 'My Site', namespaces: ['wp/v2'] },
      },
      {
        url: /\/wp-json\/wp\/v2\/users\/me/,
        status: 200,
        json: { id: 1, name: 'admin' },
      },
    ]);

    const report = await validateWpConnection({
      site: 'https://example.com',
      username: 'admin',
      token: 'xxxx xxxx xxxx xxxx',
    });

    expect(report.siteReachable).toBe(true);
    expect(report.restApiAvailable).toBe(true);
    expect(report.authenticated).toBe(true);
    expect(report.siteName).toBe('My Site');
    expect(report.errors).toEqual([]);
  });

  it('reports unreachable site', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));

    const report = await validateWpConnection({
      site: 'https://example.com',
      username: 'admin',
      token: 'xxxx',
    });

    expect(report.siteReachable).toBe(false);
    expect(report.authenticated).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it('reports REST API not available', async () => {
    mockFetch([
      { url: /\/wp-json$/, status: 404, json: {} },
    ]);

    const report = await validateWpConnection({
      site: 'https://example.com',
      username: 'admin',
      token: 'xxxx',
    });

    expect(report.siteReachable).toBe(true);
    expect(report.restApiAvailable).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it('reports auth failure', async () => {
    mockFetch([
      {
        url: /\/wp-json$/,
        status: 200,
        json: { name: 'My Site', namespaces: ['wp/v2'] },
      },
      {
        url: /\/wp-json\/wp\/v2\/users\/me/,
        status: 401,
        json: { code: 'rest_not_logged_in' },
      },
    ]);

    const report = await validateWpConnection({
      site: 'https://example.com',
      username: 'admin',
      token: 'bad-token',
    });

    expect(report.siteReachable).toBe(true);
    expect(report.restApiAvailable).toBe(true);
    expect(report.authenticated).toBe(false);
    expect(report.errors.some((e) => e.includes('uthentication'))).toBe(true);
  });

  it('provides guidance steps', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));

    const report = await validateWpConnection({
      site: 'https://example.com',
      username: 'admin',
      token: 'xxxx',
    });

    expect(report.guidance.length).toBeGreaterThan(0);
  });
});
