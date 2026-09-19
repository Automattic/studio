import { describe, it, expect } from 'vitest';
import { connectBrowser, desktopContextOptions, desktopUserAgent } from './index.js';

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

describe('desktopUserAgent', () => {
  it('drops the headless marker and keeps the browser version and platform', () => {
    expect(
      desktopUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36'
      )
    ).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36'
    );
  });

  it('leaves a real browser identity alone', () => {
    expect(
      desktopUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
      )
    ).toBeUndefined();
  });
});

describe('desktopContextOptions', () => {
  it('gives no override when the browser cannot report its user agent', async () => {
    expect(await desktopContextOptions({})).toEqual({});
    expect(
      await desktopContextOptions({ newBrowserCDPSession: () => Promise.reject(new Error('no cdp')) })
    ).toEqual({});
  });
});

describe.skipIf(process.env.SKIP_BROWSER_TESTS)('desktopContextOptions in a real browser', () => {
  it('presents the bundled Chromium as desktop Chrome, not HeadlessChrome', async () => {
    const b = await connectBrowser({});
    try {
      const options = await desktopContextOptions(b);
      const ctx = await b.newContext(options);
      const page = await ctx.newPage();
      const ua = await page.evaluate(() => navigator.userAgent);
      expect(ua).not.toContain('HeadlessChrome');
      expect(ua).toContain(`Chrome/${b.version()}`);
      expect(options).toEqual({ userAgent: ua });
    } finally {
      await b.close();
    }
  }, 30_000);
});
