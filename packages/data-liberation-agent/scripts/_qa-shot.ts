/**
 * Throwaway QA screenshot helper: full-page shot of a URL at a given viewport.
 *   npx tsx scripts/_qa-shot.ts <url> <outPath> [width=1440] [height=900]
 */
import { chromium } from 'playwright';
import { shimNames } from './_pw.js';

const [url, out, w = '1440', h = '900'] = process.argv.slice(2);
if (!url || !out) { console.error('usage: _qa-shot.ts <url> <out> [w] [h]'); process.exit(2); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await shimNames(page);
await page.goto(url, { waitUntil: 'load', timeout: 45000 });
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); }
  window.scrollTo(0, 0);
  const imgs = Array.from(document.images);
  await Promise.race([Promise.all(imgs.map((im) => (im.complete ? 0 : im.decode().catch(() => 0)))), new Promise((r) => setTimeout(r, 5000))]);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('shot:', out);
