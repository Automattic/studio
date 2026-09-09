import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { discover } from './discover.js';

const servers: Server[] = [];

async function squarespaceServer(
  archive: (request: URL) => { status?: number; body: string },
): Promise<{ url: string; archiveRequests: URL[] }> {
  const archiveRequests: URL[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    if (url.pathname === '/sitemap.xml') {
      const origin = url.origin;
      response.end(`<urlset>${['/blog', '/about', '/contact', '/services', '/privacy'].map((path) => `<url><loc>${origin}${path}</loc></url>`).join('')}</urlset>`);
      return;
    }
    if (url.searchParams.get('format') === 'json') {
      response.end(JSON.stringify({ website: { siteTitle: 'Test Site' } }));
      return;
    }
    if (url.pathname === '/blog' && url.searchParams.get('format') === 'json-pretty') {
      archiveRequests.push(url);
      const result = archive(url);
      response.statusCode = result.status || 200;
      response.end(result.body);
      return;
    }
    response.end('<html></html>');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a port');
  return { url: `http://127.0.0.1:${address.port}`, archiveRequests };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

describe('Squarespace archive discovery', () => {
  it('recovers paginated posts the sitemap omitted', async () => {
    const { url, archiveRequests } = await squarespaceServer((request) => {
      if (request.searchParams.get('offset') === '100') {
        return { body: JSON.stringify({ items: [{ urlId: 'two', fullUrl: '/blog/two' }] }) };
      }
      return { body: JSON.stringify({ items: [{ urlId: 'one', fullUrl: '/blog/one' }], pagination: { nextPageOffset: 100 } }) };
    });

    const inventory = await discover(url, {});

    expect(inventory.urls).toContainEqual({ url: `${url}/blog/one`, type: 'post' });
    expect(inventory.urls).toContainEqual({ url: `${url}/blog/two`, type: 'post' });
    expect(inventory.counts.post).toBe(2);
    expect(archiveRequests.map((request) => request.searchParams.get('offset'))).toEqual([null, '100']);
  });

  it('deduplicates urlIds and terminates a non-advancing offset', async () => {
    const { url, archiveRequests } = await squarespaceServer(() => ({
      body: JSON.stringify({
        items: [{ urlId: 'one', fullUrl: '/blog/one' }],
        pagination: { nextPageOffset: 100 },
      }),
    }));

    const inventory = await discover(url, {});

    expect(inventory.urls.filter(({ url: discoveredUrl }) => discoveredUrl === `${url}/blog/one`)).toHaveLength(1);
    expect(archiveRequests).toHaveLength(2);
  });

  it('keeps sitemap discovery when the archive response is malformed or fails', async () => {
    const malformed = await squarespaceServer(() => ({ body: '{not json' }));
    const malformedInventory = await discover(malformed.url, {});
    expect(malformedInventory.urls).toContainEqual({ url: `${malformed.url}/blog`, type: 'page' });

    const failed = await squarespaceServer(() => ({ status: 503, body: 'unavailable' }));
    const failedInventory = await discover(failed.url, {});
    expect(failedInventory.urls).toContainEqual({ url: `${failed.url}/blog`, type: 'page' });
  });

  it('caps an archive walk at 200 pages', async () => {
    const { url, archiveRequests } = await squarespaceServer((request) => {
      const page = Number(request.searchParams.get('offset') || 0);
      return {
        body: JSON.stringify({
          items: [{ urlId: `post-${page}`, fullUrl: `/blog/${page}` }],
          pagination: { nextPageOffset: page + 1 },
        }),
      };
    });

    const inventory = await discover(url, {});

    expect(archiveRequests).toHaveLength(200);
    expect(inventory.urls.filter(({ type }) => type === 'post')).toHaveLength(200);
  });

  it('ignores invalid JSON shapes and invalid archive entries without losing sitemap routes', async () => {
    const empty = await squarespaceServer(() => ({ body: 'null' }));
    await expect(discover(empty.url, {})).resolves.toMatchObject({
      urls: expect.arrayContaining([{ url: `${empty.url}/about`, type: 'page' }]),
    });

    const mixed = await squarespaceServer(() => ({
      body: JSON.stringify({
        items: [null, 42, { urlId: 1, fullUrl: '/blog/bad' }, { urlId: 'valid', fullUrl: '/blog/valid' }],
        pagination: { nextPageOffset: {} },
      }),
    }));
    const inventory = await discover(mixed.url, {});
    expect(inventory.urls.filter(({ type }) => type === 'post')).toEqual([
      { url: `${mixed.url}/blog/valid`, type: 'post' },
    ]);
    expect(mixed.archiveRequests).toHaveLength(1);
  });
});
