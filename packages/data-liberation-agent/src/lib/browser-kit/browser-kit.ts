type PwBrowser = {
  contexts(): Array<{ newPage(): Promise<unknown> }>;
  newContext(opts?: Record<string, unknown>): Promise<{ newPage(): Promise<unknown> }>;
  close(): Promise<void>;
};

export async function getPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'Playwright is required but is not installed. ' +
        'Run `npm install playwright` and `npx playwright install chromium` to set it up.'
    );
  }
}

type PwBrowserRaw = Awaited<ReturnType<(typeof import('playwright'))['chromium']['launch']>>;

export interface ConnectBrowserOpts {
  cdpPort?: number;
  headed?: boolean;
}

/**
 * Open a Playwright browser — CDP if cdpPort is set, otherwise a fresh headless
 * Chromium. Caller owns context/page creation and cleanup. Use launchBrowser()
 * instead if you just want a page to scrape one-off.
 */
export async function connectBrowser(opts: ConnectBrowserOpts): Promise<PwBrowserRaw> {
  const pw = await getPlaywright();
  if (opts.cdpPort) {
    return await pw.chromium.connectOverCDP(`http://127.0.0.1:${opts.cdpPort}`);
  }
  return await pw.chromium.launch({ headless: !opts.headed });
}

export async function launchBrowser(opts: { cdpPort?: number; headed?: boolean }): Promise<{
  browser: PwBrowser;
  page: unknown;
  close: () => Promise<void>;
}> {
  const pw = await getPlaywright();

  let browser: PwBrowser;
  let page: unknown;

  if (opts.cdpPort) {
    const raw = await pw.chromium.connectOverCDP(
      `http://127.0.0.1:${opts.cdpPort}`
    );
    browser = raw as unknown as PwBrowser;
    const ctx = browser.contexts()[0] || (await browser.newContext());
    page = await ctx.newPage();
  } else {
    const raw = await pw.chromium.launch({ headless: !opts.headed });
    browser = raw as unknown as PwBrowser;
    const ctx = await browser.newContext();
    page = await ctx.newPage();
  }

  return {
    browser,
    page,
    close: () => browser.close(),
  };
}
