import { createServer } from 'node:http';
import { describe, it, expect, vi } from 'vitest';
import { classifyUrl, fetchSitemap, fetchSitemapWithDiagnostics } from './sitemap.js';

describe('classifyUrl', () => {
  it('classifies the homepage', () => {
    expect(classifyUrl('https://example.com/')).toBe('homepage');
    expect(classifyUrl('https://example.com')).toBe('homepage');
  });

  it('classifies an actual product page', () => {
    expect(classifyUrl('https://example.com/store/p20/Widget.html')).toBe('product'); // Weebly
    expect(classifyUrl('https://example.com/products/widget')).toBe('product');
    expect(classifyUrl('https://example.com/shop/widget')).toBe('product');
  });

  it('does not classify a store/shop category page as a product', () => {
    // Weebly names a category /store/c<N>/... against a product's /store/p<N>/...; importing
    // one as a product creates a junk WooCommerce row named after the category (lonestardinners.com).
    expect(classifyUrl('https://example.com/store/c1/Current_Menu.html')).toBe('page');
    expect(classifyUrl('https://example.com/shop/c6/Beer_Soaps.html')).toBe('page');
  });

  it('does not classify the bare store/shop index as a product', () => {
    expect(classifyUrl('https://example.com/store')).toBe('page');
    expect(classifyUrl('https://example.com/store/')).toBe('page');
    expect(classifyUrl('https://example.com/shop')).toBe('page');
  });

  it('does not classify generic category/collection listing pages as products', () => {
    expect(classifyUrl('https://example.com/product-category/widgets')).toBe('page');
    expect(classifyUrl('https://example.com/collections/widgets')).toBe('page'); // Shopify
    expect(classifyUrl('https://example.com/category/widgets')).toBe('page');
    expect(classifyUrl('https://example.com/product-tag/on-sale')).toBe('page');
  });

  it('classifies a blog post but not a bare blog listing', () => {
    expect(classifyUrl('https://example.com/blog/my-post')).toBe('post');
    expect(classifyUrl('https://example.com/blog')).toBe('page');
    expect(classifyUrl('https://example.com/blog/')).toBe('page');
  });

  it('classifies gallery and event pages', () => {
    expect(classifyUrl('https://example.com/gallery/summer')).toBe('gallery');
    expect(classifyUrl('https://example.com/events/launch-party')).toBe('event');
  });

  it('falls back to page for anything else', () => {
    expect(classifyUrl('https://example.com/about-us')).toBe('page');
  });
});

describe('fetchSitemap', () => {

  it('keeps valid sitemap and navigation routes while rejecting out-of-origin sitemap leaves', async () => {
    const server = createServer((request, response) => {
      const origin = `http://${request.headers.host}`;
      if (request.url === '/sitemap.xml') {
        response.setHeader('content-type', 'application/xml');
        response.end(`<urlset>
          <url><loc>${origin}/</loc></url>
          <url><loc>${origin}/</loc></url>
          <url><loc>https://${request.headers.host}/wrong-protocol</loc></url>
          <url><loc>http://127.0.0.1:9/wrong-port</loc></url>
          <url><loc>https://elsewhere.example.test/foreign</loc></url>
          <url><loc>not-a-url</loc></url>
        </urlset>`);
        return;
      }
      if (request.url === '/') {
        response.setHeader('content-type', 'text/html');
        response.end('<nav><a href="/contact">Contact</a><a href="/contact">Contact again</a></nav>');
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not start');
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      const { urls, diagnostics } = await fetchSitemapWithDiagnostics(origin);

      expect(urls).toEqual([
        `${origin}/`,
        `${origin}/contact`,
      ]);
      expect(diagnostics.map(({ url }) => url)).toEqual([
        `https://127.0.0.1:${address.port}/wrong-protocol`,
        'http://127.0.0.1:9/wrong-port',
        'https://elsewhere.example.test/foreign',
        'not-a-url',
      ]);
      expect(await fetchSitemap(origin)).toEqual(urls);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('preserves www and apex sitemap page aliases accepted by capture', async () => {
    const sitemap = (pageOrigin: string) => `<urlset>${[ 'one', 'two', 'three', 'four', 'five' ]
      .map((path) => `<url><loc>${pageOrigin}/${path}</loc></url>`)
      .join('')}</urlset>`;
    const responseByUrl = new Map([
      ['https://example.test/sitemap.xml', sitemap('https://www.example.test')],
      ['https://www.example.test/sitemap.xml', sitemap('https://example.test')],
    ]);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(responseByUrl.get(url), { status: 200 })));

    try {
      await expect(fetchSitemap('https://example.test')).resolves.toEqual([
        'https://www.example.test/one',
        'https://www.example.test/two',
        'https://www.example.test/three',
        'https://www.example.test/four',
        'https://www.example.test/five',
      ]);
      await expect(fetchSitemap('https://www.example.test')).resolves.toEqual([
        'https://example.test/one',
        'https://example.test/two',
        'https://example.test/three',
        'https://example.test/four',
        'https://example.test/five',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('discovers navigation inserted by client-side JavaScript', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.end(`<!doctype html><div id="root"></div><script>
          document.querySelector('#root').innerHTML = '<nav><a href="/platform">Platform</a><a href="/solutions">Solutions</a><a href="/ai">AI</a><a href="data:text/html,unsafe">Unsafe data</a><a href="vbscript:msgbox(1)">Unsafe vbscript</a></nav>';
        </script>`);
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not start');
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      await expect(fetchSitemap(origin)).resolves.toEqual([
        `${origin}/platform`,
        `${origin}/solutions`,
        `${origin}/ai`,
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
