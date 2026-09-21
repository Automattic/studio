import { withTimeout } from '../concurrency.js';

type PwPage = { close(): Promise<void> };

const CLOSE_TIMEOUT_MS = 3_000;
const CREATE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 60_000;
const IDENTITY_TIMEOUT_MS = 5_000;

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

/**
 * The desktop browser identity a source page is loaded with: the browser's own
 * user agent, with the headless marker removed. Playwright's headless Chromium
 * announces itself as `HeadlessChrome/<version>`, and anti-bot challenges
 * (Cloudflare `cf-mitigated: challenge`) refuse it outright, so a page that
 * serves real visitors returns a 403 to capture. Mobile capture already loads as
 * a real device (iPhone 17); this is the desktop counterpart.
 *
 * The version and platform stay the bundled browser's own, so the identity never
 * goes stale. A user agent without the marker (a real Chrome over CDP) is left
 * alone, and a browser that cannot report its user agent gets no override.
 */
export function desktopUserAgent(nativeUserAgent: string): string | undefined {
  return nativeUserAgent.includes('HeadlessChrome/')
    ? nativeUserAgent.replace('HeadlessChrome/', 'Chrome/')
    : undefined;
}

type CdpCapableBrowser = {
  newBrowserCDPSession?(): Promise<{
    send(method: 'Browser.getVersion'): Promise<{ userAgent: string }>;
    detach(): Promise<void>;
  }>;
};

const desktopContexts = new WeakMap<object, Promise<{ userAgent?: string }>>();

/**
 * Context options that give a desktop page a real desktop-browser identity.
 * Spread into every `newContext`/`newPage` that loads the source site, so
 * discovery, capture and comparison all present the same browser. Resolved
 * once per browser and never throws.
 */
export function desktopContextOptions(browser: object): Promise<{ userAgent?: string }> {
  let pending = desktopContexts.get(browser);
  if (!pending) {
    pending = (async () => {
      try {
        const cdp = browser as CdpCapableBrowser;
        if (typeof cdp.newBrowserCDPSession !== 'function') return {};
        const session = await withTimeout(
          cdp.newBrowserCDPSession(),
          IDENTITY_TIMEOUT_MS,
          'cdp session',
          (late) => void late.detach().catch(() => {})
        );
        try {
          const { userAgent } = await withTimeout(
            session.send('Browser.getVersion'),
            IDENTITY_TIMEOUT_MS,
            'browser version'
          );
          const desktop = desktopUserAgent(userAgent);
          return desktop ? { userAgent: desktop } : {};
        } finally {
          await session.detach().catch(() => {});
        }
      } catch {
        return {};
      }
    })();
    desktopContexts.set(browser, pending);
  }
  return pending;
}

/**
 * The subset of `context.storageState()`'s return value we carry between
 * contexts. Matches Playwright's own shape so it can be spread straight into
 * `newContext({ storageState })`.
 */
export interface SourceStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

type SessionCapableBrowser = {
  newContext(opts?: Record<string, unknown>): Promise<{
    newPage(): Promise<{ goto(url: string, opts?: Record<string, unknown>): Promise<unknown> }>;
    storageState(): Promise<SourceStorageState>;
    close(): Promise<void>;
  }>;
};

const HARVEST_TIMEOUT_MS = 30_000;

/**
 * One harvested session per origin, for the life of this process. Some
 * sources establish an authenticated session at the ENTRY URL only — the URL
 * carries a token, the server answers with `Set-Cookie`, and every other
 * route/asset on the origin requires it. Keyed by origin (not by the exact
 * URL) so every context this run creates — parallel capture workers,
 * discovery, comparison, a browser restarted mid-run — reuses ONE harvest
 * instead of each re-navigating the entry URL cold.
 */
const sourceSessions = new Map<string, Promise<SourceStorageState | null>>();

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function harvestSourceSession(
  browser: SessionCapableBrowser,
  entryUrl: string,
  origin: string
): Promise<SourceStorageState | null> {
  let pending = sourceSessions.get(origin);
  if (!pending) {
    pending = (async () => {
      let context: Awaited<ReturnType<SessionCapableBrowser['newContext']>> | undefined;
      try {
        context = await browser.newContext(await desktopContextOptions(browser));
        const page = await context.newPage();
        await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: HARVEST_TIMEOUT_MS });
        const state = await context.storageState();
        const hasSession =
          state.cookies.length > 0 || state.origins.some((o) => o.localStorage.length > 0);
        return hasSession ? state : null;
      } catch {
        return null;
      } finally {
        await context?.close().catch(() => {});
      }
    })();
    sourceSessions.set(origin, pending);
  }
  return pending;
}

/**
 * Context options carrying the source's desktop identity and, when its
 * origin gates itself behind an entry-URL session (a tokenized share link, a
 * preview-protected host), that session. The first call for an origin
 * navigates `entryUrl` once to harvest whatever the origin set; every later
 * call — a different context, a different browser instance after a restart,
 * any of this run's parallel workers — reuses that harvest rather than
 * navigating again. Best-effort and never throws: a source that never gates
 * itself, or a harvest that fails, resolves to plain desktop identity, so
 * behavior is unchanged from before this existed.
 *
 * Spread into every `newContext`/`newPage` that loads the source site,
 * alongside (or in place of) {@link desktopContextOptions}.
 */
export async function sourceContextOptions(
  browser: object,
  entryUrl: string
): Promise<{ userAgent?: string; storageState?: SourceStorageState }> {
  const origin = originOf(entryUrl);
  const [identity, session] = await Promise.all([
    desktopContextOptions(browser),
    origin ? harvestSourceSession(browser as SessionCapableBrowser, entryUrl, origin) : null,
  ]);
  return session ? { ...identity, storageState: session } : identity;
}

/**
 * The `Cookie` header value already harvested for `origin`, or undefined
 * when nothing has been harvested for it (yet, or ever). Read-only — unlike
 * {@link sourceContextOptions}, this never triggers a harvest itself, so a
 * caller with no browser to drive (the media downloader) can ask "do we
 * already hold credentials for this exact origin" without launching one.
 *
 * Origin-EXACT by construction: a caller must look this up again for each
 * redirect hop's own origin rather than reusing one lookup across hops, or a
 * cookie meant for the source origin would follow a redirect off it.
 */
export async function sourceSessionCookieHeader(origin: string): Promise<string | undefined> {
  const pending = sourceSessions.get(origin);
  if (!pending) return undefined;
  const state = await pending.catch(() => null);
  if (!state || state.cookies.length === 0) return undefined;
  return state.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

/** Test-only: clear the harvested-session cache between isolated test runs. */
export function __resetSourceSessionsForTests(): void {
  sourceSessions.clear();
}

export async function launchBrowser(opts: { cdpPort?: number; headed?: boolean }): Promise<{
  browser: PwBrowser;
  page: unknown;
  close: () => Promise<void>;
}> {
  const raw = await withTimeout(
    connectBrowser(opts),
    CONNECT_TIMEOUT_MS,
    'browser connect',
    (late) => {
      void withTimeout(late.close(), CLOSE_TIMEOUT_MS, 'late browser close').catch(() => {});
    }
  );
  const browser = raw as unknown as PwBrowser;

  const newContext = async () =>
    withTimeout(
      browser.newContext(await desktopContextOptions(raw)),
      CREATE_TIMEOUT_MS,
      'context create'
    );
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
