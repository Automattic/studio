import { describe, it, expect } from 'vitest';
import { connectBrowser } from './index.js';

describe.skipIf(process.env.SKIP_BROWSER_TESTS)('connectBrowser', () => {
  it('launches headless Chromium by default', async () => {
    const b = await connectBrowser({});
    try {
      const ctx = await b.newContext();
      const page = await ctx.newPage();
      await page.goto('data:text/html,<h1>hi</h1>');
      expect(page).toBeDefined();
    } finally {
      await b.close();
    }
  }, 30_000);
});
