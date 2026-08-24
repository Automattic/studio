import { withTimeout } from '../concurrency.js';

type PwPage = { close(): Promise<void> };

const CLOSE_TIMEOUT_MS = 3_000;
const CREATE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 60_000;

type PwBrowser = {
  contexts(): Array<{ newPage(): Promise<PwPage> }>;
  newContext(opts?: Record<string, unknown>): Promise<{ newPage(): Promise<PwPage> }>;
  close(): Promise<void>;
  isConnected(): boolean;
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
  const raw = await withTimeout(connectBrowser(opts), CONNECT_TIMEOUT_MS, 'browser connect');
  const browser = raw as unknown as PwBrowser;

  const newContext = () =>
    withTimeout(browser.newContext(), CREATE_TIMEOUT_MS, 'context create');
  let page: PwPage;
  try {
    const ctx = opts.cdpPort
      ? browser.contexts()[0] || (await newContext())
      : await newContext();
    // A page that materializes after the deadline must be closed before we
    // disconnect, or under CDP it survives as an orphan tab in the user's
    // real browser.
    const pending = ctx.newPage();
    page = await withTimeout(pending, CREATE_TIMEOUT_MS, 'page create', (late) => {
      void late.close().catch(() => {});
    });
  } catch (err) {
    await withTimeout(browser.close(), CLOSE_TIMEOUT_MS, 'browser close').catch(() => {});
    throw err;
  }

  return {
    browser,
    page,
    close: async () => {
      // Under CDP, browser.close() only disconnects — close our tab first.
      await withTimeout(page.close(), CLOSE_TIMEOUT_MS, 'page close').catch(() => {});
      await withTimeout(browser.close(), CLOSE_TIMEOUT_MS, 'browser close').catch(() => {});
    },
  };
}
