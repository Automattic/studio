// Behavioral consumer of a relocated runtime. Only Node built-ins are imported
// here: all DLA operations and registries come from the supplied artifact.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const bundleUrl = pathToFileURL(resolve(process.argv[2]));
const browserless = process.argv.includes('--browserless');
const runtime = await import(bundleUrl.href);
const outputDir = await mkdtemp(join(process.cwd(), '.runtime-verification-'));
const ownerText = 'This is owner content that must survive capture. '.repeat(40);
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Runtime fixture</title>
<style>body{font:16px Arial;margin:0}main,footer{padding:20px}.ad-slot{height:100px}</style></head>
<body><main><h1>Owner website</h1><p>${ownerText}</p></main>
<div class="ad-slot">Unwanted advertisement</div><footer>Owner copyright <span class="provider-credit">Powered by fixture</span></footer>
<script>const app=document.createElement('section');app.dataset.booking='true';app.textContent='Booking surface';document.querySelector('main').append(app)</script>
</body></html>`;

const server = createServer((request, response) => {
  response.setHeader('x-runtime-fixture', 'true');
  response.setHeader('content-type', request.url === '/sitemap.xml' ? 'application/xml' : 'text/html; charset=utf-8');
  response.end(request.url === '/sitemap.xml' ? '<urlset/>' : html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://localtest.me:${server.address().port}/`;

try {
  runtime.registerPlatform({
    id: 'runtime-fixture',
    detection: { httpSignals: [{ header: 'x-runtime-fixture', value: 'true', signal: 'Fixture response header' }] },
    discover: async (source) => ({ urls: [{ url: source }] }),
    inspection: [{ capability: 'booking', selector: '[data-booking]', evidence: 'Fixture application surface' }],
    liberation: { cleanupRules: [{ id: 'fixture-credit', category: 'source-attribution', selector: '.provider-credit' }] },
  });
  assert.equal((await runtime.detectPlatform(url)).platform, 'runtime-fixture');

  if (browserless) {
    assert.throws(() => createRequire(bundleUrl).resolve('playwright'), { code: 'MODULE_NOT_FOUND' });
    const http = await runtime.inspectSource(url, { rendered: false, sampleLimit: 1 });
    assert.equal(http.source.platform.id, 'runtime-fixture');
    assert.equal(http.complexity.band, 'unknown');
    const rendered = await runtime.inspectSource(url, { sampleLimit: 1 });
    assert.equal(rendered.complexity.band, 'unknown');
    assert.ok(rendered.issues.some((issue) => issue.code === 'browser-unavailable'));
    await mkdir(join(outputDir, 'website'), { recursive: true });
    await writeFile(join(outputDir, 'website', 'index.html'), '<h1>Owner website</h1>');
    await writeFile(join(outputDir, 'capture-receipt.json'), JSON.stringify({ source: { url }, websiteRoot: 'website', routes: [{ url, path: 'website/index.html' }] }));
    // A rejected browser operation must release resources and let this process
    // terminate normally, rather than retaining an already-started web server.
    await assert.rejects(runtime.checkFidelity({ directory: outputDir }), /playwright/);
  } else {
    const inspection = await runtime.inspectSource(url, { sampleLimit: 1 });
    const evidence = JSON.stringify({ issues: inspection.issues, rendered: inspection.rendered });
    assert.equal(inspection.rendered.succeeded, 1, evidence);
    // observedBand is the measured classification. The reported band can
    // additionally be unknown whenever a page resource was blocked or failed,
    // which legitimately depends on the environment rather than the source.
    assert.equal(inspection.complexity.observedBand, 'complex', evidence);
    assert.ok(['complex', 'unknown'].includes(inspection.complexity.band), evidence);
    assert.ok(inspection.rendered.samples[0].capabilities.some((finding) => finding.capability === 'booking'), evidence);

    const capture = await runtime.captureWebsite({ url, outputDir, learnFluid: false, captureImages: true });
    assert.equal(capture.summary.routesCaptured, 1);
    assert.equal(capture.summary.routesFailed, 0);
    const receipt = JSON.parse(await readFile(capture.captureReceiptPath, 'utf8'));
    assert.equal(receipt.cleanup.complete, true);
    assert.ok(receipt.cleanup.policy.rules.some((rule) => rule.id === 'fixture-credit'));
    const artifactPath = join(outputDir, 'website', 'index.html');
    const artifact = await readFile(artifactPath, 'utf8');
    assert.ok(artifact.includes('Booking surface'));
    assert.ok(!artifact.includes('Unwanted advertisement'));
    assert.ok(!artifact.includes('Powered by fixture'));

    const comparison = await runtime.checkFidelity({ directory: outputDir, widths: [1440], settleMs: 100 });
    assert.equal(comparison.pass, true, JSON.stringify(comparison.scores));
    assert.ok(comparison.cleanup.source.some((report) => report.removed >= 2));
    await writeFile(artifactPath, artifact.replaceAll(ownerText.trim(), ''));
    const damaged = await runtime.checkFidelity({ directory: outputDir, widths: [1440], settleMs: 100 });
    assert.equal(damaged.pass, false, 'Loss of retained owner content must fail');
    await writeFile(artifactPath, artifact);
  }

  const canonical = await readFile(join(outputDir, 'website', 'index.html'), 'utf8');
  let staging;
  runtime.registerPublishTarget({
    name: 'fixture-target',
    async attribution({ directory }) {
      staging = directory;
      const path = join(directory, 'index.html');
      await writeFile(path, (await readFile(path, 'utf8')) + '<footer>Destination credit</footer>');
    },
    async publish({ directory }) {
      assert.ok((await readFile(join(directory, 'index.html'), 'utf8')).includes('Destination credit'));
      return { target: 'fixture-target', liveUrl: 'https://published.example/', files: 1, bytes: 1, notes: [] };
    },
  });
  assert.equal((await runtime.publishSite({ directory: outputDir, target: 'fixture-target' })).target, 'fixture-target');
  assert.equal(await readFile(join(outputDir, 'website', 'index.html'), 'utf8'), canonical);
  await assert.rejects(stat(staging), { code: 'ENOENT' });
  process.stdout.write(`Runtime workflow passed (${browserless ? 'browserless' : 'rendered inspect → capture → compare → publish'})\n`);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(outputDir, { recursive: true, force: true });
}
