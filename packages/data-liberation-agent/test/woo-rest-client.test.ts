import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WooCommerceClient } from '../src/lib/import/woo-rest-client.js';

function mockFetch(status: number, body: Record<string, unknown> | Array<unknown>) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('WooCommerceClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('base URL construction', () => {
    it('constructs base URL for localhost', () => {
      const client = new WooCommerceClient({ site: 'localhost:8883', consumerKey: 'ck', consumerSecret: 'cs' });
      expect(client.baseUrl).toBe('http://localhost:8883/wp-json/wc/v3');
    });

    it('constructs base URL for HTTPS site', () => {
      const client = new WooCommerceClient({ site: 'example.com', consumerKey: 'ck', consumerSecret: 'cs' });
      expect(client.baseUrl).toBe('https://example.com/wp-json/wc/v3');
    });

    it('respects explicit http:// scheme', () => {
      const client = new WooCommerceClient({ site: 'http://mysite.local:8888', consumerKey: 'ck', consumerSecret: 'cs' });
      expect(client.baseUrl).toBe('http://mysite.local:8888/wp-json/wc/v3');
    });

    it('respects explicit https:// scheme', () => {
      const client = new WooCommerceClient({ site: 'https://shop.example.com', consumerKey: 'ck', consumerSecret: 'cs' });
      expect(client.baseUrl).toBe('https://shop.example.com/wp-json/wc/v3');
    });

    it('strips trailing slashes from explicit URL', () => {
      const client = new WooCommerceClient({ site: 'https://example.com/', consumerKey: 'ck', consumerSecret: 'cs' });
      expect(client.baseUrl).toBe('https://example.com/wp-json/wc/v3');
    });
  });

  describe('uses Basic auth header', () => {
    it('sends correct Authorization header', async () => {
      const fetch = mockFetch(201, { id: 1 });
      vi.stubGlobal('fetch', fetch);

      const client = new WooCommerceClient({ site: 'example.com', consumerKey: 'ck_abc', consumerSecret: 'cs_xyz' });
      await client.createProduct({ name: 'Test Product', type: 'simple' });

      const [, opts] = fetch.mock.calls[0];
      const expected = Buffer.from('ck_abc:cs_xyz').toString('base64');
      expect(opts.headers['Authorization']).toBe(`Basic ${expected}`);
    });
  });

  describe('createProduct', () => {
    it('creates a simple product', async () => {
      const fetch = mockFetch(201, { id: 99 });
      vi.stubGlobal('fetch', fetch);

      const client = new WooCommerceClient({ site: 'example.com', consumerKey: 'ck', consumerSecret: 'cs' });
      const result = await client.createProduct({ name: 'My Product', type: 'simple', regular_price: '19.99' });

      expect(result).toEqual({ id: 99 });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('https://example.com/wp-json/wc/v3/products');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.name).toBe('My Product');
      expect(body.type).toBe('simple');
      expect(body.regular_price).toBe('19.99');
    });
  });

  describe('createVariation', () => {
    it('creates a product variation', async () => {
      const fetch = mockFetch(201, { id: 55 });
      vi.stubGlobal('fetch', fetch);

      const client = new WooCommerceClient({ site: 'example.com', consumerKey: 'ck', consumerSecret: 'cs' });
      const result = await client.createVariation(42, { regular_price: '9.99', attributes: [{ name: 'Size', option: 'Large' }] });

      expect(result).toEqual({ id: 55 });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('https://example.com/wp-json/wc/v3/products/42/variations');
      expect(opts.method).toBe('POST');
    });
  });

  describe('ensureCategory', () => {
    it('finds or creates a category', async () => {
      // First call: search returns empty array
      // Second call: create returns { id: 7 }
      const fn = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve([]),
          text: () => Promise.resolve('[]'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers(),
          json: () => Promise.resolve({ id: 7 }),
          text: () => Promise.resolve('{"id":7}'),
        });
      vi.stubGlobal('fetch', fn);

      const client = new WooCommerceClient({ site: 'example.com', consumerKey: 'ck', consumerSecret: 'cs' });
      const id = await client.ensureCategory('Clothing');

      expect(id).toBe(7);
      expect(fn).toHaveBeenCalledTimes(2);

      // Second call should use cache — no additional fetch calls
      const id2 = await client.ensureCategory('Clothing');
      expect(id2).toBe(7);
      expect(fn).toHaveBeenCalledTimes(2); // still 2, no new calls
    });

    it('returns existing category when found in search', async () => {
      const fn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([{ id: 3, name: 'Accessories' }]),
        text: () => Promise.resolve('[{"id":3,"name":"Accessories"}]'),
      });
      vi.stubGlobal('fetch', fn);

      const client = new WooCommerceClient({ site: 'example.com', consumerKey: 'ck', consumerSecret: 'cs' });
      const id = await client.ensureCategory('Accessories');

      expect(id).toBe(3);
      expect(fn).toHaveBeenCalledTimes(1); // only search, no create
    });
  });

  describe('error handling', () => {
    it('throws with status and message on non-OK response', async () => {
      const fetch = mockFetch(422, { message: 'Invalid product data', code: 'woocommerce_invalid_product' });
      vi.stubGlobal('fetch', fetch);

      const client = new WooCommerceClient({ site: 'example.com', consumerKey: 'ck', consumerSecret: 'cs' });
      await expect(client.createProduct({ name: '' }))
        .rejects.toThrow('WooCommerce API 422: Invalid product data');
    });

    it('falls back to text when response body is not JSON', async () => {
      const fn = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: () => Promise.reject(new Error('invalid json')),
        text: () => Promise.resolve('Internal Server Error'),
      });
      vi.stubGlobal('fetch', fn);

      const client = new WooCommerceClient({ site: 'example.com', consumerKey: 'ck', consumerSecret: 'cs' });
      await expect(client.createProduct({ name: 'X' }))
        .rejects.toThrow('WooCommerce API 500: Internal Server Error');
    });
  });
});
