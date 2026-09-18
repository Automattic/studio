import { createServer } from 'node:http';
import { describe, it, expect, vi } from 'vitest';
import { classifyUrl, extractSameOriginLinks, fetchSitemap, fetchSitemapWithDiagnostics } from './sitemap.js';

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

  it('keeps valid sitemap and navigation routes while rejecting off-site sitemap leaves', async () => {
    const server = createServer((request, response) => {
      const origin = `http://${request.headers.host}`;
      if (request.url === '/sitemap.xml') {
        response.setHeader('content-type', 'application/xml');
        response.end(`<urlset>
          <url><loc>${origin}/</loc></url>
          <url><loc>${origin}/</loc></url>
          <url><loc>https://${request.headers.host}/other-scheme</loc></url>
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
        `${origin}/other-scheme`,
        `${origin}/contact`,
      ]);
      expect(diagnostics.map(({ url }) => url)).toEqual([
        'http://127.0.0.1:9/wrong-port',
        'https://elsewhere.example.test/foreign',
        'not-a-url',
      ]);
      expect(await fetchSitemap(origin)).toEqual(urls);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('moves www and apex sitemap page aliases onto the entry host', async () => {
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
        'https://example.test/one',
        'https://example.test/two',
        'https://example.test/three',
        'https://example.test/four',
        'https://example.test/five',
      ]);
      await expect(fetchSitemap('https://www.example.test')).resolves.toEqual([
        'https://www.example.test/one',
        'https://www.example.test/two',
        'https://www.example.test/three',
        'https://www.example.test/four',
        'https://www.example.test/five',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('follows an http sitemap index from an https site and reports what it rejects', async () => {
    // tallersherrera.com: served over https, but its sitemap index and every
    // page it lists are http:// URLs, which used to be skipped without a word.
    const pages = ['', 'contacto', 'servicios', 'quienes-somos', 'instalaciones', 'restauracion-de-faros'];
    const responseByUrl = new Map([
      ['https://www.example.test/sitemap.xml', `<sitemapindex>
        <sitemap><loc>http://www.example.test/sitemap_pages.xml</loc></sitemap>
        <sitemap><loc>https://elsewhere.test/sitemap_pages.xml</loc></sitemap>
      </sitemapindex>`],
      ['https://www.example.test/sitemap_pages.xml', `<urlset>${pages
        .map((path) => `<url><loc>http://www.example.test/${path}</loc></url>`).join('')}
        <url><loc>http://example.test/apex?lang=es</loc></url>
        <url><loc>https://sub.example.test/other-host</loc></url>
      </urlset>`],
    ]);
    const fetchMock = vi.fn(async (url: string) => responseByUrl.has(url)
      ? new Response(responseByUrl.get(url), { status: 200 })
      : new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { urls, diagnostics } = await fetchSitemapWithDiagnostics('https://www.example.test/');

      expect(urls).toEqual([
        ...pages.map((path) => `https://www.example.test/${path}`),
        'https://www.example.test/apex?lang=es',
      ]);
      expect(diagnostics).toEqual([
        { code: 'sitemap_url_rejected', url: 'https://sub.example.test/other-host', reason: 'origin differs from the entry URL' },
        { code: 'sitemap_url_rejected', url: 'https://elsewhere.test/sitemap_pages.xml', reason: 'origin differs from the entry URL' },
      ]);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'https://www.example.test/sitemap.xml',
        'https://www.example.test/sitemap_pages.xml',
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

describe('extractSameOriginLinks', () => {
  it('keeps links after a nested </nav>, outside <nav>, and in a div footer', () => {
    // Webflow nests a dropdown <nav> inside the menu <nav>; a lazy regex match
    // ended at the inner </nav> and dropped every top-level link after it.
    const html = `<div role="banner" class="w-nav">
      <nav class="w-nav-menu">
        <a href="/">Home</a>
        <div class="w-dropdown"><nav class="w-dropdown-list">
          <a href="/discover/offsite">Offsite</a>
        </nav></div>
        <a href="/events">Events</a>
        <a href="/house#rooms">House</a>
        <a href="/memberships">Memberships</a>
      </nav>
      <a href="/apply" class="button">Apply</a>
    </div>
    <main><a href="https://example.test/events">Events again</a></main>
    <div class="gdpr-footer"><a href="/privacidad">Privacidad</a><a href="/cookies">Cookies</a></div>
    <div class="dmFooter">
      <a href="/aviso-legal">Aviso legal</a>
      <a href="#top">Top</a>
      <a href="mailto:hi@example.test">Mail</a>
      <a href="/brochure.pdf">Brochure</a>
      <a href="/cart">Cart</a>
      <a href="https://elsewhere.test/about">Elsewhere</a>
    </div>`;

    expect(extractSameOriginLinks(html, 'https://example.test/')).toEqual([
      'https://example.test/',
      'https://example.test/discover/offsite',
      'https://example.test/events',
      'https://example.test/house',
      'https://example.test/memberships',
      'https://example.test/apply',
      'https://example.test/privacidad',
      'https://example.test/cookies',
      'https://example.test/aviso-legal',
    ]);
  });

  it('is used when the site has no sitemap', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.end('<nav><a href="/a">A</a><nav><a href="/b">B</a></nav><a href="/c">C</a></nav><a href="/d">D</a>');
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
        `${origin}/a`,
        `${origin}/b`,
        `${origin}/c`,
        `${origin}/d`,
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
