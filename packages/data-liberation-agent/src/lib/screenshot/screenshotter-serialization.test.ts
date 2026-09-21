import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { capturePageHtml } from './screenshotter.js';

describe('capturePageHtml stylesheet serialization', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('preserves linked stylesheet source text and responsive layout', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.setContent(`
      <style data-href="https://cdn.example.test/forms.css">.grid{display:grid;grid-template-columns:repeat(12,1fr)}@media(max-width:500px){.field{grid-column:1 / span 12;width:100%}}</style>
      <form class="grid"><input class="field"></form>
    `);
    const before = await page.locator('.field').evaluate((element) => element.getBoundingClientRect().width);
    const html = await capturePageHtml(page);
    const after = await page.locator('.field').evaluate((element) => element.getBoundingClientRect().width);
    expect(after).toBe(before);
    expect(html).toContain('.grid{display:grid;grid-template-columns:repeat(12,1fr)}@media(max-width:500px){.field{grid-column:1 / span 12;width:100%}}');
    await page.close();
  });
});
