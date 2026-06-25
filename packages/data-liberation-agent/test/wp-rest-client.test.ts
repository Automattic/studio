import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WpRestClient } from '../src/lib/import/wp-rest-client.js';

function mockFetch(status: number, body: Record<string, unknown>, headers?: Record<string, string>) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers ?? {}),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('WpRestClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('base URL detection', () => {
    it('uses public-api for wordpress.com domains', () => {
      const client = new WpRestClient({ site: 'mysite.wordpress.com', username: 'u', token: 't' });
      expect(client.baseUrl).toBe('https://public-api.wordpress.com/wp/v2/sites/mysite.wordpress.com');
    });

    it('uses public-api for subdomains of wordpress.com', () => {
      const client = new WpRestClient({ site: 'blog.something.wordpress.com', username: 'u', token: 't' });
      expect(client.baseUrl).toBe('https://public-api.wordpress.com/wp/v2/sites/blog.something.wordpress.com');
    });

    it('uses wp-json for self-hosted domains', () => {
      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      expect(client.baseUrl).toBe('https://example.com/wp-json/wp/v2');
    });

    it('uses wp-json for domains that merely contain "wordpress" but are not wordpress.com', () => {
      const client = new WpRestClient({ site: 'wordpress.example.com', username: 'u', token: 't' });
      expect(client.baseUrl).toBe('https://wordpress.example.com/wp-json/wp/v2');
    });

    it('uses http for localhost', () => {
      const client = new WpRestClient({ site: 'localhost:8888', username: 'u', token: 't' });
      expect(client.baseUrl).toBe('http://localhost:8888/wp-json/wp/v2');
    });

    it('uses http for 127.0.0.1', () => {
      const client = new WpRestClient({ site: '127.0.0.1:8080', username: 'u', token: 't' });
      expect(client.baseUrl).toBe('http://127.0.0.1:8080/wp-json/wp/v2');
    });

    it('respects explicit http:// scheme', () => {
      const client = new WpRestClient({ site: 'http://mysite.local:8888', username: 'u', token: 't' });
      expect(client.baseUrl).toBe('http://mysite.local:8888/wp-json/wp/v2');
    });

    it('respects explicit https:// scheme', () => {
      const client = new WpRestClient({ site: 'https://mysite.com', username: 'u', token: 't' });
      expect(client.baseUrl).toBe('https://mysite.com/wp-json/wp/v2');
    });
  });

  describe('auth header', () => {
    it('sends Basic auth on every request', async () => {
      const fetch = mockFetch(201, { id: 1, link: 'https://example.com/hello' });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'admin', token: 'secret' });
      await client.createPost({ title: 'Hello', content: '<p>World</p>', slug: 'hello', status: 'publish' });

      const [, opts] = fetch.mock.calls[0];
      const expected = Buffer.from('admin:secret').toString('base64');
      expect(opts.headers['Authorization']).toBe(`Basic ${expected}`);
    });
  });

  describe('createCategory', () => {
    it('posts to /categories and returns { id }', async () => {
      const fetch = mockFetch(201, { id: 42 });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      const result = await client.createCategory({ name: 'Tech', slug: 'tech', description: 'Tech posts' });

      expect(result).toEqual({ id: 42 });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('https://example.com/wp-json/wp/v2/categories');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toMatchObject({ name: 'Tech', slug: 'tech', description: 'Tech posts' });
    });

    it('supports parent category', async () => {
      const fetch = mockFetch(201, { id: 43 });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      await client.createCategory({ name: 'JavaScript', slug: 'js', description: 'JS', parent: 42 });

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.parent).toBe(42);
    });
  });

  describe('createTag', () => {
    it('posts to /tags and returns { id }', async () => {
      const fetch = mockFetch(201, { id: 10 });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      const result = await client.createTag({ name: 'vue', slug: 'vue', description: 'Vue.js' });

      expect(result).toEqual({ id: 10 });
      const [url] = fetch.mock.calls[0];
      expect(url).toBe('https://example.com/wp-json/wp/v2/tags');
    });
  });

  describe('createTerm', () => {
    it('posts to /{taxonomy} endpoint and returns { id }', async () => {
      const fetch = mockFetch(201, { id: 55 });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      const result = await client.createTerm('custom_tax', { name: 'Term', slug: 'term', description: 'A term' });

      expect(result).toEqual({ id: 55 });
      const [url] = fetch.mock.calls[0];
      expect(url).toBe('https://example.com/wp-json/wp/v2/custom_tax');
    });

    it('supports parent for hierarchical taxonomies', async () => {
      const fetch = mockFetch(201, { id: 56 });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      await client.createTerm('custom_tax', { name: 'Child', slug: 'child', description: '', parent: 55 });

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.parent).toBe(55);
    });
  });

  describe('createPage', () => {
    it('posts to /pages and returns { id, url }', async () => {
      const fetch = mockFetch(201, { id: 5, link: 'https://example.com/about' });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      const result = await client.createPage({
        title: 'About', content: '<p>About us</p>', slug: 'about', status: 'publish',
      });

      expect(result).toEqual({ id: 5, url: 'https://example.com/about' });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('https://example.com/wp-json/wp/v2/pages');
      expect(opts.method).toBe('POST');
    });
  });

  describe('createPost', () => {
    it('posts to /posts and returns { id, url }', async () => {
      const fetch = mockFetch(201, { id: 7, link: 'https://example.com/hello-world' });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      const result = await client.createPost({
        title: 'Hello World',
        content: '<p>Hi</p>',
        slug: 'hello-world',
        status: 'draft',
        categories: [1, 2],
        tags: [3],
        featuredMedia: 99,
      });

      expect(result).toEqual({ id: 7, url: 'https://example.com/hello-world' });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.categories).toEqual([1, 2]);
      expect(body.tags).toEqual([3]);
      expect(body.featured_media).toBe(99);
    });
  });

  describe('createMedia', () => {
    it('uploads binary with Content-Disposition and returns { id, url }', async () => {
      const fetch = mockFetch(201, { id: 100, source_url: 'https://example.com/wp-content/uploads/photo.jpg' });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      const buf = Buffer.from('fake-image-data');
      const result = await client.createMedia(buf, 'photo.jpg', { altText: 'A photo', title: 'Photo' });

      expect(result).toEqual({ id: 100, url: 'https://example.com/wp-content/uploads/photo.jpg' });
      const [url, opts] = fetch.mock.calls[0];
      expect(url).toBe('https://example.com/wp-json/wp/v2/media');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/octet-stream');
      expect(opts.headers['Content-Disposition']).toBe('attachment; filename="photo.jpg"');
      expect(opts.body).toBe(buf);
    });
  });

  describe('createComment', () => {
    it('posts to /comments and returns { id }', async () => {
      const fetch = mockFetch(201, { id: 200 });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      const result = await client.createComment(7, {
        author: 'Jane',
        content: 'Great post!',
        date: '2024-01-01T00:00:00',
        status: 'approved',
      });

      expect(result).toEqual({ id: 200 });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.post).toBe(7);
      expect(body.author_name).toBe('Jane');
    });
  });

  describe('createMenu', () => {
    it('posts to /menus and returns { id }', async () => {
      const fetch = mockFetch(201, { id: 300 });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      const result = await client.createMenu({ name: 'Main Nav', slug: 'main-nav' });

      expect(result).toEqual({ id: 300 });
      const [url] = fetch.mock.calls[0];
      expect(url).toBe('https://example.com/wp-json/wp/v2/menus');
    });
  });

  describe('createMenuItem', () => {
    it('posts to /menu-items and returns { id }', async () => {
      const fetch = mockFetch(201, { id: 301 });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      const result = await client.createMenuItem({
        title: 'Home', url: '/', menuId: 300, parent: 0, menuOrder: 1,
      });

      expect(result).toEqual({ id: 301 });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.menus).toBe(300);
      expect(body.title).toBe('Home');
      expect(body.url).toBe('/');
    });
  });

  describe('error handling', () => {
    it('throws on non-OK responses with status and message', async () => {
      const fetch = mockFetch(403, { message: 'Forbidden', code: 'rest_forbidden' });
      vi.stubGlobal('fetch', fetch);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      await expect(client.createPost({ title: 'X', content: '', slug: 'x', status: 'publish' }))
        .rejects.toThrow('403: Forbidden');
    });

    it('includes full text when response has no JSON message', async () => {
      const fn = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: () => Promise.reject(new Error('invalid json')),
        text: () => Promise.resolve('Internal Server Error'),
      });
      vi.stubGlobal('fetch', fn);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't' });
      await expect(client.createTag({ name: 'x', slug: 'x', description: '' }))
        .rejects.toThrow('500: Internal Server Error');
    });
  });

  describe('429 retry with backoff', () => {
    it('retries on 429 and respects Retry-After header', async () => {
      const retryResponse = {
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '1' }),
        json: () => Promise.resolve({ message: 'Too many requests' }),
        text: () => Promise.resolve('Too many requests'),
      };
      const successResponse = {
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve({ id: 1 }),
        text: () => Promise.resolve('{"id":1}'),
      };

      const fn = vi.fn()
        .mockResolvedValueOnce(retryResponse)
        .mockResolvedValueOnce(successResponse);
      vi.stubGlobal('fetch', fn);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't', delay: 0 });
      const result = await client.createTag({ name: 'x', slug: 'x', description: '' });

      expect(result).toEqual({ id: 1 });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries exhausted', async () => {
      const retryResponse = {
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '0' }),
        json: () => Promise.resolve({ message: 'Too many requests' }),
        text: () => Promise.resolve('Too many requests'),
      };

      const fn = vi.fn().mockResolvedValue(retryResponse);
      vi.stubGlobal('fetch', fn);

      const client = new WpRestClient({ site: 'example.com', username: 'u', token: 't', delay: 0, maxRetries: 2 });
      await expect(client.createTag({ name: 'x', slug: 'x', description: '' }))
        .rejects.toThrow('429: Too many requests');

      // initial + 2 retries = 3
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});
