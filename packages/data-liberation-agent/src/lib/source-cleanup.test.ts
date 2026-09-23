import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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
:root{--wix-ads-height:50px;--wix-ads-top-height:50px;--sticky-offset:50px}
body{margin:0;font:16px Arial;padding-top:50px}#WIX_ADS{position:fixed;top:0;height:50px}
main{padding:20px} .ad-slot{height:200px}footer{padding:20px}
</style></head><body><div id="WIX_ADS">Free website by Wix</div>
<main><h1>Owner business</h1><p>${'Real owner content to retain. '.repeat(30)}</p>
<article>Powered by renewable energy. Read <a href="https://wix.com/blog">our platform article</a>.</article></main>
<div><iframe id="google_ads_iframe_1" srcdoc="Ad creative"></iframe></div>
<div class="ad-slot">${'Buy advertising now. '.repeat(50)}</div>
<footer><p>© Owner business. All rights reserved. <span>Powered&nbsp;and  secured\nby </span><span><a href="https://www.wix.com">Wix</a></span></p><p>Powered by <a href="https://www.wix.com">Wix</a></p><p>© 2035 by Owner. Powered and secured by <span style="text-decoration:underline"><a href="https://www.wix.com" target="_blank">Wix</a></span></p></footer>
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
      expect(await page.locator('footer').innerText()).toBe('© Owner business. All rights reserved.\n\n© 2035 by Owner.');
      expect(await page.locator('article a').count()).toBe(1);
      expect(await page.evaluate(() => getComputedStyle(document.body).paddingTop)).toBe('0px');
      expect(report.removed).toBeGreaterThanOrEqual(6);
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
  expect(output).not.toContain('#WIX_ADS{');
  expect(output).not.toContain('https://www.wix.com');
  expect(output).toContain('Powered by renewable energy');
  expect(output).toContain('Owner business');
  // The value has to reach the export: this is what a destination theme ships.
  const siteDir = join(directory, 'website');
  const site = readdirSync(siteDir, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(?:html|css)$/.test(name))
    .map((name) => readFileSync(join(siteDir, name), 'utf8')).join('\n').replace(/\s+/g, '');
  // The provider's own declaration stays where it was; the reclaim overrides it.
  expect(site.indexOf('--wix-ads-height:0px!important')).toBeGreaterThan(site.indexOf('--wix-ads-height:50px'));
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

it('treats mutation-budget exhaustion as a diagnostic, not a cleanup failure, when nothing dirty is left behind', async () => {
  // Mirrors an animated homepage (sliders, entrance transitions): each tick runs in its
  // own macrotask, so the observer fires once per tick and exhausts the 100-round budget
  // well before the loop finishes. None of the churn matches a cleanup rule.
  const churnHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Animated owner site</title></head><body>
<main><h1>Owner business</h1><p>${'Real owner content to retain. '.repeat(30)}</p></main>
<script>
(function tick(n){
  const span = document.createElement('span');
  span.className = 'churn';
  span.textContent = String(n);
  document.body.appendChild(span);
  span.remove();
  if (n < 160) setTimeout(tick, 0, n + 1);
})(0);
</script>
</body></html>`;
  server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(churnHtml); });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const url = `http://localtest.me:${(server.address() as { port: number }).port}/`;
  mkdirSync(join(process.cwd(), '.tmp-test'), { recursive: true });
  directory = mkdtempSync(join(process.cwd(), '.tmp-test', 'cleanup-churn-'));
  const result = await captureScreenshots({ urls: [url], primaryUrl: url, outputDir: directory,
    cleanupPolicy: cleanupPolicy(), captureImages: true, learnFluid: false, settleMs: 1000 });
  expect(result.failed).toBe(0);
  expect(result.captured).toBe(1);
  const manifest = JSON.parse(readFileSync(join(directory, 'screenshots', 'manifest.json'), 'utf8'));
  const reports = manifest.entries[url].cleanup.reports as Array<{ truncated: boolean; failures: string[]; residual: number }>;
  expect(reports.some((report) => report.truncated)).toBe(true);
  expect(reports.every((report) => report.failures.length === 0 && report.residual === 0)).toBe(true);
  exportWebsiteCapture({ outputDir: directory, sourceUrl: url, platform: 'default', summary: {}, failures: [] });
  const receipt = JSON.parse(readFileSync(join(directory, 'capture-receipt.json'), 'utf8'));
  expect(receipt.cleanup.complete).toBe(true);
  const comparison = await checkFidelity({ directory, widths: [1440], settleMs: 200 });
  expect(comparison.pass).toBe(true);
}, 90_000);

it('still reports genuine residual distinctly from budget exhaustion', async () => {
  // Crosses the 1000-removal safety cap on a single rule, so the sweep's own guard
  // (not the observer budget) leaves matches unremoved and reports them as residual.
  const adHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<main><h1>Owner business</h1></main>
${'<div class="ad-slot">ad</div>'.repeat(1001)}
</body></html>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(adHtml);
    await applySourceCleanup(page, policy);
    const report = await readSourceCleanup(page);
    expect(report.failures).toEqual([]);
    expect(report.residual).toBeGreaterThan(0);
  } finally { await browser.close(); }
});

it('removes the Lovable attribution badge with its orphaned stylesheet rules, keeping owner CSS', async () => {
  const { lovableAdapter } = await import('../adapters/lovable/index.js');
  const lovablePolicy = cleanupPolicy(lovableAdapter.liberation?.cleanupRules);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><style>
      body{margin:0;font:16px Arial}
      #lovable-badge{position:fixed;height:24px}
      #lovable-badge-cta:hover{opacity:.8}
      @media (max-width:768px){#lovable-badge{display:none}.owner-note{color:red}}
      #owner-section{color:blue}
      a[href="#lovable-badge"]{font-weight:700}
    </style></head><body>
      <main><h1>Owner business</h1><p>Real owner content to retain.</p></main>
      <aside id="lovable-badge" role="complementary" aria-label="Made with Lovable">
        <span id="lovable-badge-text">Made with</span>
        <a id="lovable-badge-cta" href="https://lovable.dev/projects/abc?utm_source=lovable-badge">Made with Lovable</a>
      </aside>
    </body></html>`);
    const report = await applySourceCleanup(page, lovablePolicy);
    expect(await page.locator('#lovable-badge').count()).toBe(0);
    expect(await page.locator('main').innerText()).toContain('Owner business');
    const css = await page.evaluate(() => document.querySelector('style')?.textContent ?? '');
    expect(css).not.toContain('#lovable-badge{');
    expect(css).not.toContain('#lovable-badge-cta');
    expect(css).not.toContain('#lovable-badge-text');
    expect(css).toContain('body{margin:0');
    expect(css).toContain('#owner-section{color:blue}');
    expect(css).toContain('.owner-note{color:red}');
    expect(css).toContain('@media');
    expect(css).toContain('a[href="#lovable-badge"]');
    expect(report.removed).toBeGreaterThanOrEqual(1);
    expect(report.strippedCssRules).toBeGreaterThanOrEqual(3);
    expect(report.failures).toEqual([]);
    expect(report.records.some((record) => record.rule === 'lovable-badge')).toBe(true);
  } finally { await browser.close(); }
}, 20_000);

// A builder badge from a platform this repo has never heard of, beside the
// floating chrome a site owner legitimately authors. Nothing here names the
// vendor to the cleanup policy: the badge has to be recognised structurally.
const builderChromeHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:16px Arial}
main{padding:20px}
.floating{position:fixed;bottom:16px;padding:8px 12px;background:#000;color:#fff}
</style></head><body>
<div id="root" style="position:fixed;inset:0;overflow:auto"><main><h1>Owner business</h1>
  <img src="https://media.base44.com/images/public/site/logo.png" alt="Owner business logo">
  <p>We built with Base44 before moving here. ${'Real owner content to retain. '.repeat(10)}</p></main></div>
<div id="platform-badge" class="floating" style="right:16px;z-index:999999">
  <img src="https://media.base44.com/images/public/builder-assets/symbol-orange.png" alt="base44" style="width:20px;height:20px">
  <span>Edit with </span><img src="data:image/png;base64,iVBORw0KGgo=" alt="Base44" height="18" width="56">
  <button aria-label="Close badge">x</button>
</div>
<div id="owner-cta" class="floating" style="left:16px">
  <a href="https://calendly.com/owner/consult">Book a consultation</a>
</div>
<div id="owner-credit" class="floating" style="left:200px">
  <img src="https://images.unsplash.com/heart.png" alt="heart"> Made with love in Brooklyn
</div>
<div id="owner-consent" class="floating" style="left:400px">
  We use cookies. <a href="https://cookiebot.com/policy">Accept all</a>
</div>
<div id="owner-tool" class="floating" style="left:600px">
  <a href="https://app.localtest.me/editor"><img src="https://app.localtest.me/mark.png" alt="Localtest"> Edit with Localtest</a>
</div>
<div id="owner-partner">Built with Base44 <img src="https://media.base44.com/mark.png" alt="Base44"></div>
</body></html>`;

it('removes an unknown builder badge from its authoring offer and vendor provenance, keeping authored floating chrome', async () => {
  server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(builderChromeHtml); });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const url = `http://localtest.me:${(server.address() as { port: number }).port}/`;
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(url);
      const report = await applySourceCleanup(page, cleanupPolicy());
      expect(await page.locator('#platform-badge').count()).toBe(0);
      // Everything else survives: a fixed app shell whose own prose credits the
      // platform and loads its logo, an in-flow partner credit, a floating CTA,
      // a geographic credit, a consent banner and the owner's own tooling.
      for (const id of ['#root', '#owner-partner', '#owner-cta', '#owner-credit', '#owner-consent', '#owner-tool'])
        expect(await page.locator(id).count()).toBe(1);
      expect(await page.locator('main').innerText()).toContain('We built with Base44');
      expect(report.failures).toEqual([]);
      const record = report.records.find((entry) => entry.rule === 'builder-chrome');
      expect(record).toMatchObject({ category: 'source-attribution', selector: '#platform-badge', action: 'remove' });
      expect(record!.text).toContain('Edit with');
      await page.close();
    }
  } finally { await browser.close(); }
}, 30_000);

it('removes a fixed trial badge and provider credit text without removing owner content', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.setContent(`<!doctype html><html><head><style>
      #trial{position:fixed;right:0;bottom:0;width:220px;height:52px}
    </style></head><body>
      <main><h1>Owner portfolio</h1><p>Contact owner@example.com</p></main>
      <p>Made with Squarespace</p>
      <a id="trial" href="https://www.squarespace.com/templates/example"><img alt="Squarespace"><span>Create A Site Like This</span><span>Free trial. Instant access.</span></a>
    </body></html>`);
    const report = await applySourceCleanup(page, cleanupPolicy([
      { id: 'squarespace-credit-text', category: 'source-attribution', selector: 'body', creditText: 'Squarespace' },
    ]));
    expect(await page.locator('#trial').count()).toBe(0);
    expect(await page.locator('main').innerText()).toContain('Owner portfolio');
    expect(await page.locator('body').innerText()).not.toContain('Made with Squarespace');
    expect(report.failures).toEqual([]);
    expect(report.records.some((record) => record.rule === 'builder-chrome')).toBe(true);
    expect(report.records.some((record) => record.rule === 'squarespace-credit-text')).toBe(true);
  } finally { await browser.close(); }
}, 20_000);

it('reports invalid rules rather than silently certifying cleanup', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<p>Owner</p>');
    const report = await applySourceCleanup(page, cleanupPolicy([{ id: 'invalid', category: 'advertisement', selector: '[' }]));
    expect(report.failures).toContain('invalid');
  } finally { await browser.close(); }
});

it('reclaims the space a removed provider bar reserved in custom properties, at every viewport', async () => {
  // The provider's own runtime measures its bar and publishes the height as
  // custom properties the site's layout reads. Removing the bar leaves that
  // reservation behind at whatever the live session measured, and one stale
  // value moves every element that reads it: a sticky header, the page root,
  // and a pinned menu layer each shift by the height of a bar that is gone.
  const wixHtml = (height: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--wix-ads-height:${height};--wix-ads-top-height:${height};--sticky-offset:${height};--owner-gap:24px}
body{margin:0;font:16px Arial}
#WIX_ADS{position:fixed;top:0;left:0;right:0;height:${height}}
#site-root{position:relative;top:var(--wix-ads-height)}
#SITE_HEADER{position:sticky;top:var(--wix-ads-height);height:60px}
.pinned-layer{position:fixed;top:0;margin-top:var(--wix-ads-height)}
main{padding-top:var(--owner-gap)}
</style></head><body>
<div id="WIX_ADS">This site was created with Wix. Create your own website today.</div>
<div id="site-root"><header id="SITE_HEADER">Logo</header><div class="pinned-layer">Menu</div>
<main><h1>Owner business</h1></main></div>
</body></html>`;
  const browser = await chromium.launch();
  try {
    for (const [width, height] of [[1440, '50px'], [390, '38px']] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(wixHtml(height));
      await applySourceCleanup(page, policy);
      const report = await readSourceCleanup(page);
      expect(await page.locator('#WIX_ADS').count()).toBe(0);
      const layout = await page.evaluate(() => ({
        variable: getComputedStyle(document.documentElement).getPropertyValue('--wix-ads-height').trim(),
        siteRoot: document.querySelector('#site-root')!.getBoundingClientRect().top,
        header: getComputedStyle(document.querySelector('#SITE_HEADER')!).top,
        pinned: getComputedStyle(document.querySelector('.pinned-layer')!).marginTop,
        ownerGap: getComputedStyle(document.querySelector('main')!).paddingTop,
      }));
      expect(layout.variable).toBe('0px');
      expect(layout.siteRoot).toBe(0);
      expect(layout.header).toBe('0px');
      expect(layout.pinned).toBe('0px');
      // Only the properties the rule names are reclaimed; owner tokens stand.
      expect(layout.ownerGap).toBe('24px');
      expect(report.records.find((record) => record.rule === 'wix-free-banner')?.reclaimedVariables)
        .toEqual(['--wix-ads-height', '--wix-ads-top-height', '--sticky-offset']);
      // The reclaimed value has to travel with the captured document, not just
      // exist in this session: the export reads serialized HTML.
      expect(await page.evaluate(() => document.documentElement.outerHTML)).toContain('--wix-ads-height:0px');
      await page.close();
    }
    // A bar that publishes nothing reserves nothing through a property: declaring
    // one on its behalf would override the fallback its readers were relying on.
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><style>
#WIX_ADS{position:fixed;top:0;height:50px}main{padding-top:var(--wix-ads-height,12px)}
</style></head><body><div id="WIX_ADS">Wix</div><main>Owner business</main></body></html>`);
    await applySourceCleanup(page, policy);
    const report = await readSourceCleanup(page);
    expect(await page.locator('style[data-dla-reclaimed-space]').count()).toBe(0);
    expect(report.records.some((record) => record.reclaimedVariables)).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('main')!).paddingTop)).toBe('12px');
    await page.close();
  } finally { await browser.close(); }
}, 20_000);
