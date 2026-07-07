import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { captureDesign } from './capture-design.js';

const FIXTURE = `<!DOCTYPE html><html><head>
  <style>.hero{color:red}.a{margin:0}.b{padding:8px}.c{display:flex}.d{font-size:16px}.e{line-height:1.5}.f{color:#333}.g{background:#fff}.h{border:1px solid #ccc}.i{border-radius:4px}.j{text-align:center}</style>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=X">
</head><body class="home dark">
  <header>chrome</header>
  <main><h1>Title</h1><p>Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.</p><p>Tempor incididunt ut labore et dolore magna aliqua ut enim ad minim.</p><section><h2>More</h2><p>Quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo.</p></section><img src="https://src.test/a.png" srcset="https://src.test/a2.png 2x"></main>
</body></html>`;

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

describe('captureDesign', () => {
  it('captures fragment + css + headLinks + bodyClasses', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    const r = await captureDesign(page, 'https://src.test/', { includeScripts: false });
    expect(r.bodyFragmentHtml).toContain('https://src.test/a.png');
    expect(r.css).toContain('.hero');
    expect(r.headLinks.some((l) => l.includes('fonts.googleapis.com'))).toBe(true);
    expect(r.bodyClasses).toEqual(['home', 'dark']);
    expect(r.scripts).toEqual([]);
    await page.close();
  });

  it('throws on near-empty capture (guards a false design)', async () => {
    const page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><html><body></body></html>');
    await expect(captureDesign(page, 'https://src.test/', { includeScripts: false })).rejects.toThrow(/too small/i);
    await page.close();
  });
});
