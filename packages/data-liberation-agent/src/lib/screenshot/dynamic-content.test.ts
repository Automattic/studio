import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, type Browser } from 'playwright';
import { assessBody, expandCollapsedContent, waitForAppWidgets, readPngHeight, classifyEmptyBodies, KNOWN_WIDGETS, type PageStat } from './dynamic-content.js';

// Fictional content only (no source-site data).
const wrap = (bodyInner: string) =>
  `<html><body><header><nav>Home Shop About</nav></header>${bodyInner}<footer>(c) Acme Co</footer></body></html>`;

describe('assessBody (Phase 0)', () => {
  it('passes a page with real main content', () => {
    const html = wrap(`<main>${'Lorem ipsum dolor sit amet consectetur. '.repeat(20)}</main>`);
    expect(assessBody(html)).toMatchObject({ empty: false, reason: 'ok' });
  });

  it('flags a cross-origin iframe body as empty/iframe', () => {
    const html = wrap('<main><iframe src="https://help.widget-app.example/embed"></iframe></main>');
    expect(assessBody(html, 'https://shop.example')).toMatchObject({ empty: true, reason: 'iframe' });
  });

  it('does NOT treat a same-origin iframe as the cross-origin case', () => {
    const html = wrap('<main><iframe src="https://shop.example/embed"></iframe></main>');
    expect(assessBody(html, 'https://shop.example').reason).not.toBe('iframe');
  });

  it('flags a known empty content widget (Loox) by name', () => {
    const html = wrap('<main><div id="looxReviews"></div></main>');
    expect(assessBody(html)).toMatchObject({ empty: true, reason: 'app-widget', detail: 'loox' });
  });

  it('flags a chrome-only page (header to footer, no body) as empty', () => {
    const html = '<html><body><header><nav>Home</nav></header><footer>(c) Acme</footer></body></html>';
    expect(assessBody(html).empty).toBe(true);
  });

  it('reports a thin body as reason "thin"', () => {
    expect(assessBody(wrap('<main>tiny</main>'))).toMatchObject({ empty: true, reason: 'thin' });
  });
});

describe('readPngHeight (rendered-height signal)', () => {
  it('reads height from a PNG IHDR without decoding', () => {
    const buf = Buffer.alloc(24);
    buf.writeUInt32BE(0x89504e47, 0);
    buf.writeUInt32BE(0x0d0a1a0a, 4);
    buf.writeUInt32BE(13, 8);
    buf.write('IHDR', 12);
    buf.writeUInt32BE(800, 16); // width
    buf.writeUInt32BE(630, 20); // height
    const p = join(tmpdir(), `dla-png-${process.pid}.png`);
    writeFileSync(p, buf);
    expect(readPngHeight(p)).toBe(630);
    rmSync(p);
  });

  it('returns null for a missing file or non-PNG', () => {
    expect(readPngHeight('/no/such/file.png')).toBeNull();
    const p = join(tmpdir(), `dla-notpng-${process.pid}.txt`);
    writeFileSync(p, 'not a png at all');
    expect(readPngHeight(p)).toBeNull();
    rmSync(p);
  });

  it('rejects a corrupt/implausible height (would otherwise poison the page-set median)', () => {
    const buf = Buffer.alloc(24);
    buf.writeUInt32BE(0x89504e47, 0);
    buf.writeUInt32BE(0x0d0a1a0a, 4);
    buf.writeUInt32BE(13, 8);
    buf.write('IHDR', 12);
    buf.writeUInt32BE(800, 16);
    buf.writeUInt32BE(0xffffffff, 20); // garbage huge height
    const p = join(tmpdir(), `dla-png-huge-${process.pid}.png`);
    writeFileSync(p, buf);
    expect(readPngHeight(p)).toBeNull();
    rmSync(p);
  });

  it('returns null when the first chunk is not IHDR (valid signature, junk chunk)', () => {
    const buf = Buffer.alloc(24);
    buf.writeUInt32BE(0x89504e47, 0);
    buf.write('JUNK', 12); // not IHDR
    buf.writeUInt32BE(630, 20);
    const p = join(tmpdir(), `dla-png-junk-${process.pid}.png`);
    writeFileSync(p, buf);
    expect(readPngHeight(p)).toBeNull();
    rmSync(p);
  });
});

describe('classifyEmptyBodies (Phase 0 page-set decision)', () => {
  // A page-set median of ~3000px: tall content pages plus a few short ones.
  const stat = (slug: string, height: number | null, mainTextLen: number, over?: Partial<PageStat['assess']>): PageStat => ({
    slug,
    height,
    assess: { empty: mainTextLen < 200, reason: 'ok', widget: null, crossOriginIframe: false, mainTextLen, ...over },
  });

  it('flags a chrome-only page (short render, thin text) and not the tall content pages', () => {
    const stats = [stat('home', 3200, 5000), stat('about', 2800, 4000), stat('faqs', 639, 326)];
    const flagged = classifyEmptyBodies(stats);
    expect(flagged.map((f) => f.slug)).toEqual(['faqs']);
    expect(flagged[0].reason).toBe('short-render');
    expect(flagged[0].detail).toMatch(/639px vs median/);
  });

  it('RESCUES a short-but-text-rich page (real policy copy renders compact)', () => {
    // returns: rendered short (under median*0.5) but carries 1597 chars of real text.
    const stats = [stat('home', 3200, 5000), stat('about', 2800, 4000), stat('returns', 1439, 1597)];
    expect(classifyEmptyBodies(stats).map((f) => f.slug)).toEqual([]);
  });

  it('names the reason from the widget / iframe signal even on a short render', () => {
    const stats = [
      stat('home', 3200, 5000),
      stat('about', 2800, 4000),
      stat('reviews', 639, 326, { widget: 'loox', reason: 'app-widget' }),
      stat('help', 639, 326, { crossOriginIframe: true, reason: 'iframe', detail: 'cross-origin <iframe> body' }),
    ];
    const bySlug = Object.fromEntries(classifyEmptyBodies(stats).map((f) => [f.slug, f]));
    expect(bySlug.reviews.reason).toBe('app-widget');
    expect(bySlug.reviews.detail).toBe('loox');
    expect(bySlug.help.reason).toBe('iframe');
  });

  it('falls back to the text signal when a page has no screenshot height', () => {
    const stats = [stat('home', 3200, 5000), stat('about', 2800, 4000), stat('ghost', null, 12)];
    const flagged = classifyEmptyBodies(stats);
    expect(flagged.map((f) => f.slug)).toEqual(['ghost']);
    expect(flagged[0].reason).toBe('thin');
  });
});

describe('KNOWN_WIDGETS registry', () => {
  it('has named, non-empty widget entries', () => {
    expect(KNOWN_WIDGETS.length).toBeGreaterThan(3);
    for (const w of KNOWN_WIDGETS) {
      expect(w.name).toBeTruthy();
      expect(w.selector).toBeTruthy();
    }
  });
});

describe('interaction + wait helpers (Phase 1/2, browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('expandCollapsedContent opens <details>', async () => {
    const page = await browser.newPage();
    await page.setContent('<details><summary>Q</summary><p>A</p></details>');
    await expandCollapsedContent(page);
    expect(await page.evaluate(() => document.querySelector('details')?.open)).toBe(true);
    await page.close();
  });

  it('waitForAppWidgets waits until a known widget populates', async () => {
    const page = await browser.newPage();
    // Loox-like container that fills in after 300ms.
    await page.setContent(
      '<div id="looxReviews"></div><script>setTimeout(()=>{document.getElementById("looxReviews").innerHTML="<div>a review here that is long enough</div>"},300)</script>',
    );
    await waitForAppWidgets(page, 5000);
    const populated = await page.evaluate(() => (document.getElementById('looxReviews')?.childElementCount ?? 0) > 0);
    expect(populated).toBe(true);
    await page.close();
  });

  it('waitForAppWidgets is a no-op (returns fast) when no known widget is present', async () => {
    const page = await browser.newPage();
    await page.setContent('<main>just normal content</main>');
    const t0 = Date.now();
    await waitForAppWidgets(page, 5000);
    expect(Date.now() - t0).toBeLessThan(2000); // didn't burn the full timeout
    await page.close();
  });
});
