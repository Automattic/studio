import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { inspectSource } from './inspect.js';
import { registerHost, unregisterHost } from '../platform/host.js';

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

it('reports where a capability was observed, and refuses to look decided when the sample was not', async () => {
  const url = await source('<main><h1>Contact</h1><form id="enquiry" class="contact-form stacked"><input name="email"></form><iframe id="map" src="about:blank"></iframe></main>');
  const result = await inspectSource(url, { sampleLimit: 1 });
  expect(result.capabilityVocabulary).toEqual({
    schema: 'data-liberation/source-capability-vocabulary/v1',
    capabilities: ['booking', 'commerce', 'dialogs', 'embeds', 'forms', 'media', 'membership', 'navigation'],
  });
  const sample = result.rendered.samples[0];
  expect(sample.url).toBe(url);
  const forms = sample.capabilities.find((finding) => finding.capability === 'forms');
  expect(forms).toMatchObject({ count: 1, selector: 'form' });
  expect(forms?.locators).toEqual(['form#enquiry.contact-form.stacked']);
  expect(sample.capabilities.find((finding) => finding.capability === 'embeds')?.locators).toEqual(['iframe#map']);
  // Every published capability name is one a destination can declare coverage against.
  for (const finding of sample.capabilities) expect(result.capabilityVocabulary.capabilities).toContain(finding.capability);
  expect(result.complexity.confidence).toBe('bounded-sample');
  expect(sample.unknowns).toEqual([]);

  // An incomplete sample is not a quiet 'simple': the band withholds instead.
  const truncated = await inspectSource(url, { rendered: false, sampleLimit: 1 });
  expect(truncated.complexity.band).toBe('unknown');
  expect(truncated.complexity.confidence).toBe('incomplete');
  expect(truncated.capabilityVocabulary.capabilities).toEqual(result.capabilityVocabulary.capabilities);
}, 45_000);

it('attributes a host badge to the host instead of to the site it is serving', async () => {
  const badge = '<main><h1>Brochure</h1><p>One page, no app.</p></main><script>const frame = document.createElement("iframe"); frame.id = "hud-badge"; frame.title = "Powered by Fixture Host"; frame.srcdoc = "<p>badge</p>"; frame.style.position = "fixed"; document.body.append(frame);</script>';
  posts = 0;
  server = createServer((req, res) => {
    res.setHeader('x-fixture-host-id', 'edge-1');
    res.setHeader('content-type', req.url === '/sitemap.xml' ? 'application/xml' : 'text/html');
    res.end(req.url === '/sitemap.xml' ? '<urlset/>' : badge);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://localtest.me:${(server.address() as { port: number }).port}/`;

  const unattributed = await inspectSource(url, { sampleLimit: 1 });
  expect(unattributed.source.hosts).toEqual([]);
  expect(unattributed.rendered.samples[0].counts.frames).toBe(1);
  expect(unattributed.complexity.factors.map((factor) => factor.code)).toContain('embeds');

  registerHost({
    id: 'fixture-host',
    detection: { httpSignals: [{ header: 'x-fixture-host-id', signal: 'fixture host request identifier' }] },
    residue: [{ selector: 'iframe#hud-badge', evidence: 'fixture host badge frame' }],
  });
  try {
    const attributed = await inspectSource(url, { sampleLimit: 1 });
    expect(attributed.source.hosts).toEqual([{ id: 'fixture-host', evidence: ['fixture host request identifier'] }]);
    expect(attributed.rendered.samples[0].counts.frames).toBe(0);
    expect(attributed.rendered.samples[0].excluded).toEqual([
      { host: 'fixture-host', selector: 'iframe#hud-badge', evidence: 'fixture host badge frame', matched: 1, elements: 1 },
    ]);
    expect(attributed.complexity.factors.map((factor) => factor.code)).not.toContain('embeds');
    expect(attributed.complexity.band).toBe('simple');
    expect(attributed.rendered.samples[0].elements).toBe(unattributed.rendered.samples[0].elements - 1);
    // Recognizing a host is not a statement that the rest of the page is host-owned.
    expect(attributed.rendered.samples[0].counts.links).toBe(unattributed.rendered.samples[0].counts.links);
    expect(attributed.rendered.samples[0].textCharacters).toBe(unattributed.rendered.samples[0].textCharacters);
  } finally {
    unregisterHost('fixture-host');
  }
}, 45_000);

it('keeps authored content when a host rule is registered but that host is not serving the page', async () => {
  const url = await source('<main><h1>Studio</h1><iframe id="hud-badge" title="Authored map" src="about:blank"></iframe><form><input name="q"></form></main>');
  registerHost({
    id: 'absent-host',
    detection: { httpSignals: [{ header: 'x-absent-host', signal: 'absent host header' }] },
    residue: [{ selector: 'iframe#hud-badge', evidence: 'absent host badge frame' }],
  });
  try {
    const result = await inspectSource(url, { sampleLimit: 1 });
    expect(result.source.hosts).toEqual([]);
    expect(result.rendered.samples[0].excluded).toEqual([]);
    expect(result.rendered.samples[0].counts.frames).toBe(1);
    expect(result.complexity.factors.map((factor) => factor.code)).toContain('embeds');
  } finally {
    unregisterHost('absent-host');
  }
}, 45_000);

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
