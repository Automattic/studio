import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterEach, expect, it } from 'vitest';
import { cleanupPolicy, applySourceCleanup, readSourceCleanup } from './source-cleanup.js';
import { capture as wixCapture } from '../adapters/wix/capture.js';
import { captureScreenshots } from './screenshot/screenshotter.js';
import { exportWebsiteCapture } from './capture-export.js';
import { checkFidelity } from './fidelity/check.js';

let server: Server | undefined;
let directory: string | undefined;
const policy = cleanupPolicy(wixCapture.cleanupRules);
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Owner site</title><style>
body{margin:0;font:16px Arial;padding-top:50px}#WIX_ADS{position:fixed;top:0;height:50px}
main{padding:20px} .ad-slot{height:200px}footer{padding:20px}
</style></head><body><div id="WIX_ADS">Free website by Wix</div>
<main><h1>Owner business</h1><p>${'Real owner content to retain. '.repeat(30)}</p>
<article>Powered by renewable energy. Read <a href="https://wix.com/blog">our platform article</a>.</article></main>
<div><iframe id="google_ads_iframe_1" srcdoc="Ad creative"></iframe></div>
<div class="ad-slot">${'Buy advertising now. '.repeat(50)}</div>
<footer><p>© Owner business. All rights reserved. <span>Powered by </span><span>Wix.</span></p><p>Powered by <a href="https://www.wix.com">Wix</a></p></footer>
<script>setTimeout(()=>{const ad=document.createElement('div');ad.className='ad-slot';ad.textContent='Late advertisement';document.body.prepend(ad)},80)</script>
</body></html>`;

async function source() {
  server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://localtest.me:${(server.address() as { port: number }).port}/`;
}
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it('removes source credits and late ads, reclaims space, and preserves owner content at both viewports', async () => {
  const url = await source();
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(url);
      await applySourceCleanup(page, policy);
      await page.waitForTimeout(150);
      const report = await readSourceCleanup(page);
      expect(await page.locator('#WIX_ADS,.ad-slot,iframe').count()).toBe(0);
      expect(await page.locator('footer').innerText()).toBe('© Owner business. All rights reserved.');
      expect(await page.locator('article a').count()).toBe(1);
      expect(await page.evaluate(() => getComputedStyle(document.body).paddingTop)).toBe('0px');
      expect(report.removed).toBeGreaterThanOrEqual(5);
      expect(report.failures).toEqual([]);
      expect(report.records.some((record) => record.reclaimedBodyPadding)).toBe(true);
      await page.close();
    }
  } finally { await browser.close(); }
}, 20_000);

it('captures clean artifacts and compares intentional removals while rejecting deleted owner content', async () => {
  const url = await source();
  mkdirSync(join(process.cwd(), '.tmp-test'), { recursive: true });
  directory = mkdtempSync(join(process.cwd(), '.tmp-test', 'cleanup-'));
  const result = await captureScreenshots({ urls: [url], primaryUrl: url, outputDir: directory,
    cleanupPolicy: policy, captureImages: true, learnFluid: false, settleMs: 100 });
  expect(result.failed).toBe(0);
  expect(result.captured).toBe(1);
  exportWebsiteCapture({ outputDir: directory, sourceUrl: url, platform: 'wix', summary: {}, failures: [] });
  const receipt = JSON.parse(readFileSync(join(directory, 'capture-receipt.json'), 'utf8'));
  expect(receipt.cleanup.complete).toBe(true);
  const output = readFileSync(join(directory, 'website', 'index.html'), 'utf8');
  expect(output).not.toContain('Buy advertising now.');
  expect(output).not.toContain('Free website by Wix');
  expect(output).not.toContain('https://www.wix.com');
  expect(output).toContain('Powered by renewable energy');
  expect(output).toContain('Owner business');
  const comparison = await checkFidelity({ directory, widths: [1440], settleMs: 200 });
  expect(comparison.scores.flatMap((score) => score.failures)).toEqual([]);
  expect(comparison.pass).toBe(true);
  expect(comparison.cleanup!.source[0].removed).toBeGreaterThan(0);
  writeFileSync(join(directory, 'website', 'index.html'), output.replaceAll('Real owner content to retain.', ''));
  const broken = await checkFidelity({ directory, widths: [1440], settleMs: 200 });
  expect(broken.pass).toBe(false);
  writeFileSync(join(directory, 'website', 'index.html'), output.replace('</body>', '<div class="ad-slot">Unexpected ad</div></body>'));
  await expect(checkFidelity({ directory, widths: [1440], settleMs: 200 })).rejects.toThrow('retains advertising');
  expect(JSON.parse(readFileSync(join(directory, 'compare', 'cleanup-evidence.json'), 'utf8')).completed).toBe(false);
}, 90_000);

it('reports invalid rules rather than silently certifying cleanup', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<p>Owner</p>');
    const report = await applySourceCleanup(page, cleanupPolicy([{ id: 'invalid', category: 'advertisement', selector: '[' }]));
    expect(report.failures).toContain('invalid');
  } finally { await browser.close(); }
});
