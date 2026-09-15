import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverDefault } from './discover.js';

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()) ?? resolve());
  server = undefined;
});

describe('discoverDefault', () => {
  it('reports rejected sitemap leaves without adding them to the inventory', async () => {
    server = createServer((request, response) => {
      const origin = `http://${request.headers.host}`;
      if (request.url === '/sitemap.xml') {
        response.setHeader('content-type', 'application/xml');
        response.end(`<urlset>
          <url><loc>${origin}/</loc></url>
          <url><loc>https://${request.headers.host}/wrong-protocol</loc></url>
        </urlset>`);
        return;
      }
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><title>Example</title><nav><a href="/contact">Contact</a></nav>');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind to a TCP port');
    const origin = `http://127.0.0.1:${address.port}`;

    const inventory = await discoverDefault(`${origin}/`, {});

    expect(inventory.urls.map(({ url }) => url)).toEqual([`${origin}/`, `${origin}/contact`]);
    expect(inventory.diagnostics).toHaveLength(1);
    expect(inventory.diagnostics?.[0]).toEqual(expect.objectContaining({
      code: 'sitemap_url_rejected',
      url: `https://127.0.0.1:${address.port}/wrong-protocol`,
    }));
  });

  it('discovers rendered SPA navigation when raw sitemap and HTML are shells', async () => {
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><title>SPA</title><div id="root"></div><script>
        document.querySelector('#root').innerHTML = '<header><nav>' +
          '<a href="/">Home</a><a href="/platform">Platform</a>' +
          '<a href="/solutions">Solutions</a><a href="/ai">AI</a>' +
          '</nav><a href="/resources">Resources</a><a href="/contact">Contact</a></header>';
      </script>`);
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind to a TCP port');

    const inventory = await discoverDefault(`http://127.0.0.1:${address.port}/`, {});

    expect(inventory.urls.map(({ url }) => url)).toEqual([
      `http://127.0.0.1:${address.port}/`,
      `http://127.0.0.1:${address.port}/platform`,
      `http://127.0.0.1:${address.port}/solutions`,
      `http://127.0.0.1:${address.port}/ai`,
      `http://127.0.0.1:${address.port}/resources`,
      `http://127.0.0.1:${address.port}/contact`,
    ]);
  });
});
