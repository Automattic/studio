import { createServer, type Server } from 'node:http';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectSource } from '../../lib/inspect.js';
import { inspection } from './inspection.js';

function matchCount(html: string, selector: string): number {
  const dom = new JSDOM(html);
  return dom.window.document.querySelectorAll(selector).length;
}

describe('wix events capability rule', () => {
  it('declares a commerce rule, alongside Stores and Bookings, for the Wix Events ticketing surface', () => {
    const events = inspection.find((rule) => rule.evidence.includes('Wix Events'));
    expect(events).toBeDefined();
    expect(events?.capability).toBe('commerce');
    expect(inspection.find((rule) => rule.evidence.includes('Wix Stores'))).toBeDefined();
    expect(inspection.find((rule) => rule.capability === 'booking')).toBeDefined();
  });

  it('matches the rendered ticketing markup a Wix Events page ships, with no <form> to capture', () => {
    const html = '<!doctype html><body><main>' +
      '<button data-hook="get-tickets-button">Buy Tickets</button>' +
      '<div data-hook="ticketPickerContainer"></div>' +
      '<a href="/event-details/the-artistic-gala-night">The Artistic Gala Night</a>' +
      '</main></body>';
    const events = inspection.find((rule) => rule.evidence.includes('Wix Events'))!;
    expect(matchCount(html, events.selector)).toBeGreaterThan(0);
    expect(matchCount(html, 'form')).toBe(0);
  });

  it('does not match Wix Events markup against the Stores or Bookings selectors', () => {
    const html = '<button data-hook="get-tickets-button">Buy Tickets</button>' +
      '<a href="/event-details/the-artistic-gala-night">Details</a>';
    const stores = inspection.find((rule) => rule.evidence.includes('Wix Stores'))!;
    const booking = inspection.find((rule) => rule.capability === 'booking')!;
    expect(matchCount(html, stores.selector)).toBe(0);
    expect(matchCount(html, booking.selector)).toBe(0);
  });
});

let server: Server;
async function wixSource(html: string) {
  server = createServer((req, res) => {
    res.setHeader('x-wix-request-id', 'fixture');
    res.setHeader('content-type', req.url === '/sitemap.xml' ? 'application/xml' : 'text/html');
    res.end(req.url === '/sitemap.xml' ? '<urlset/>' : html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://localtest.me:${(server.address() as { port: number }).port}/`;
}
afterEach(async () => { server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

it('reports an app capability for a Wix Events ticketing page, so a ticketing source is no longer indistinguishable from a brochure site', async () => {
  // No same-origin link here: a discovered but unsampled route would make
  // this sample legitimately incomplete, which is a different assertion
  // than the one this test makes (see the /event-details/ href coverage above).
  const url = await wixSource(
    '<meta name="generator" content="Wix.com"><main><h1>Fête Forte</h1>' +
    '<button data-hook="get-tickets-button">Buy Tickets</button>' +
    '<div data-hook="ticketPickerContainer"></div></main>',
  );
  const result = await inspectSource(url, { sampleLimit: 1 });
  const found = result.rendered.samples[0].capabilities.find(
    (finding) => finding.capability === 'commerce' && finding.evidence.includes('Wix Events'),
  );
  expect(found).toBeDefined();
  expect(result.complexity.band).toBe('complex');
}, 30_000);

it('reports no app capability for a Wix site with no events, stores or bookings', async () => {
  const url = await wixSource('<meta name="generator" content="Wix.com"><main><h1>Brochure</h1><p>Just words.</p></main>');
  const result = await inspectSource(url, { sampleLimit: 1 });
  const appCapabilities = result.rendered.samples[0].capabilities
    .map((finding) => finding.capability)
    .filter((capability) => ['booking', 'commerce', 'membership'].includes(capability));
  expect(appCapabilities).toEqual([]);
  expect(result.complexity.band).not.toBe('complex');
}, 30_000);
