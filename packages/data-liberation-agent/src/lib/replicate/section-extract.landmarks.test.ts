import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { extractFull } from './section-extract.js';

let browser: Browser | null = null;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

describe('extractFull landmark census', () => {
  it('captures body-level aside and complementary landmarks while excluding nested content asides', async () => {
    const page = await browser!.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setContent(`<!doctype html><html><head><style>
      aside, main, [role="complementary"] { display:block; min-height:40px; }
    </style></head><body>
      <aside id="rail"><a href="/intro">Intro</a><a href="/api">API</a></aside>
      <div role="complementary" id="tools"><a href="/status">Status</a><a href="/logs">Logs</a></div>
      <main><article><aside id="pullquote">A short pull quote inside content.</aside></article></main>
    </body></html>`, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(50);

    const { landmarks } = await extractFull(page, {}, 20_000);
    await page.close();

    expect(landmarks.map((l) => [l.role, l.selector, l.linkCount])).toEqual([
      ['aside', 'aside#rail', 2],
      ['complementary', 'div#tools', 2],
      ['main', 'main:nth-of-type(1)', 0],
    ]);
    expect(landmarks.some((l) => l.selector === 'aside#pullquote')).toBe(false);
  });
});
