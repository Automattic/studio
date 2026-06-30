/**
 * styledHtml capture — the R4b deterministic styled-island floor depends on each
 * section carrying a self-contained snapshot whose computed styles are inlined,
 * so it renders faithfully with NO external CSS. Like the segmentation harness,
 * this runs the real in-browser fidelity walk (extractFull) via setContent — the
 * inlining uses getComputedStyle, which only exists in a real browser.
 *
 * Fictional content only (per project convention — no real source-site data).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { extractFull } from './section-extract.js';

let browser: Browser | null = null;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

describe('extractFull — styledHtml capture (R4b floor)', () => {
  it('inlines computed styles so a flex band lays out and is colored without external CSS', async () => {
    const page = await browser!.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    const html = `<!doctype html><html><head><style>
      *{margin:0;box-sizing:border-box}
      .band{display:flex;gap:24px;background-color:rgb(10,20,30);padding:48px}
      .band h2{color:rgb(255,255,255);font-size:40px}
      .card{flex:1;background-color:rgb(200,100,50);min-height:160px}
    </style></head><body>
      <section class="band"><h2>Findings overview</h2>
        <div class="card">Alpha</div><div class="card">Beta</div><div class="card">Gamma</div>
      </section>
    </body></html>`;
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(150);
    const { specs } = await extractFull(page, {}, 20_000);
    await page.close();

    const band = specs.find((s) => s.headings.includes('Findings overview'));
    expect(band, 'a section carrying the heading was captured').toBeTruthy();
    expect(band!.styledHtml, 'styledHtml was captured').toBeTruthy();

    const styled = band!.styledHtml!;
    // Layout is inlined — the flex container does not need the external stylesheet.
    expect(styled).toMatch(/display:\s*flex/);
    // Foreground + background colors carried so the island is NOT unstyled.
    expect(styled).toMatch(/color:\s*rgb\(255,\s*255,\s*255\)/);
    expect(styled).toMatch(/background-color:\s*rgb\(10,\s*20,\s*30\)/);
    // The card color (a descendant) is inlined too — the whole subtree is styled.
    expect(styled).toMatch(/background-color:\s*rgb\(200,\s*100,\s*50\)/);
    // Content is preserved.
    expect(styled).toContain('Alpha');
    expect(styled).toContain('Gamma');
  });

  it('skips default/initial and context-irrelevant props (bloat control)', async () => {
    const page = await browser!.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    const html = `<!doctype html><html><head><style>
      *{margin:0;box-sizing:border-box}
      .band{display:flex;gap:24px;background-color:rgb(10,20,30);padding:48px}
      .band h2{color:rgb(255,255,255);font-size:40px}
      .card{flex:1;background-color:rgb(200,100,50);min-height:160px}
    </style></head><body>
      <section class="band"><h2>Bloat control</h2>
        <div class="card">Alpha</div><div class="card">Beta</div>
      </section>
    </body></html>`;
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(150);
    const { specs } = await extractFull(page, {}, 20_000);
    await page.close();

    const styled = specs.find((s) => s.headings.includes('Bloat control'))!.styledHtml!;

    // Meaningful values survive.
    expect(styled).toMatch(/display:\s*flex/);
    expect(styled).toMatch(/background-color:\s*rgb\(10,\s*20,\s*30\)/);

    // Grid props on a FLEX element are context-irrelevant → dropped.
    expect(styled).not.toContain('grid-template-columns');
    expect(styled).not.toContain('grid-auto-flow');
    // Initial/default values add no fidelity → dropped.
    expect(styled).not.toContain('z-index:auto');
    expect(styled).not.toMatch(/align-content:\s*normal/);
    expect(styled).not.toMatch(/min-height:\s*auto/);
    expect(styled).not.toMatch(/max-width:\s*none/);
    // Inset on a non-positioned element → dropped.
    expect(styled).not.toMatch(/(^|;|")\s*top:\s*0px/);
  });
});
