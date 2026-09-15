import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { inspectSource } from './inspect.js';

let server: Server;
let posts = 0;
async function source(html: string) {
  posts = 0;
  server = createServer((req, res) => {
    if (req.method === 'POST') posts++;
    res.setHeader('content-type', req.url === '/sitemap.xml' ? 'application/xml' : 'text/html');
    res.end(req.url === '/sitemap.xml' ? '<urlset/>' : html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://localtest.me:${(server.address() as { port: number }).port}/`;
}
afterEach(async () => { server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

it('distinguishes a rendered simple source from a JS-created booking app', async () => {
  const url = await source('<!doctype html><title>Wix.com</title><main><h1>Welcome</h1></main>');
  const simple = await inspectSource(url, { sampleLimit: 1 });
  expect(simple.complexity.band).toBe('simple');
  expect(simple.rendered.samples[0].elements).toBeGreaterThan(3);
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    res.setHeader('x-wix-request-id', 'fixture');
    res.setHeader('content-type', req.url === '/sitemap.xml' ? 'application/xml' : 'text/html');
    res.end(req.url === '/sitemap.xml' ? '<urlset/>' : '<meta name="generator" content="Wix.com"><main></main><script>document.querySelector("main").innerHTML = `<div data-hook="booking-calendar"><form><input type="password"></form></div>`</script>');
  });
  const complex = await inspectSource(url, { sampleLimit: 1 });
  expect(complex.samples[0].observations.forms).toBe(0);
  expect(complex.rendered.samples[0].counts.forms).toBe(1);
  expect(complex.complexity.band).toBe('complex');
  expect(complex.rendered.samples[0].capabilities).toContainEqual(expect.objectContaining({ capability: 'booking' }));
}, 30_000);

it('samples JS-discovered navigation and reports backend requests as unknown, never easy', async () => {
  const url = await source('<main>Hello</main><script>document.body.insertAdjacentHTML("beforeend", `<nav><a href="/runtime">Runtime</a></nav>`); fetch("/submit", {method:"POST"});</script>');
  const result = await inspectSource(url, { sampleLimit: 2 });
  expect(result.samples.map((s) => s.url)).toContain(`${url}runtime`);
  expect(result.complexity.band).toBe('unknown');
  expect(result.rendered.samples[0].unknowns).toContain('Non-GET requests were blocked');
  expect(posts).toBe(0);
}, 30_000);

it('closes timed-out browser samples and keeps missing evidence unknown', async () => {
  const url = await source('<main>Visible</main>');
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.url === '/slow.js') return;
    res.setHeader('content-type', req.url === '/sitemap.xml' ? 'application/xml' : 'text/html');
    res.end(req.url === '/sitemap.xml' ? '<urlset/>' : '<main>Visible</main><script src="/slow.js"></script>');
  });
  const result = await inspectSource(url, { overallTimeoutMs: 3000, requestTimeoutMs: 1000 });
  expect(result.complexity.band).toBe('unknown');
  expect(result.rendered.succeeded).toBe(0);
  expect(result.issues).toContainEqual(expect.objectContaining({ code: 'rendered-sample-failed' }));
  expect(result.timing.durationMs).toBeLessThan(4500);
}, 10_000);
