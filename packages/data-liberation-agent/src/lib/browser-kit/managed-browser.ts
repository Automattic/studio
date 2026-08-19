import { launchBrowser } from './browser-kit.js';
import { withTimeout } from '../concurrency.js';

type BrowserSession = Awaited<ReturnType<typeof launchBrowser>>;

const CLOSE_TIMEOUT_MS = 10_000;
const LAUNCH_SETTLE_TIMEOUT_MS = 5_000;

export interface BrowserLease {
  acquire(): Promise<{ page: unknown }>;
  /** False once reset()/end() invalidated this lease — late results must not
   *  touch shared state after that. */
  isValid(): boolean;
}

export interface ManagedBrowser {
  /** Fencing token: reset()/end() invalidate every lease opened before them. */
  openLease(): BrowserLease;
  reset(): Promise<void>;
  end(): Promise<void>;
}

/**
 * One lazily launched browser shared by many callers. Concurrent acquires
 * share a single launch; a crashed browser or closed page is relaunched on
 * the next acquire; reset() drops the session so the next acquire starts
 * fresh; end() closes it for good. All acquiring goes through leases —
 * reset()/end() invalidate previously opened leases, so a caller abandoned
 * by a watchdog can never touch the replacement session. All closes are
 * bounded and swallowed; launch failures reject the acquire that hit them.
 */
export function createManagedBrowser(opts: {
  cdpPort?: number;
  headed?: boolean;
}): ManagedBrowser {
  let launching: Promise<BrowserSession> | null = null;
  let ended = false;
  let epoch = 0;

  const boundedClose = (session: BrowserSession): Promise<void> =>
    withTimeout(session.close(), CLOSE_TIMEOUT_MS, 'managed browser close').catch(() => {});

  // Bounded even when the launch itself hangs: after the deadline the pending
  // session is abandoned and closed whenever it eventually arrives.
  const closeSession = async (p: Promise<BrowserSession>): Promise<void> => {
    const session = await withTimeout(
      p,
      LAUNCH_SETTLE_TIMEOUT_MS,
      'managed browser launch settle',
      boundedClose
    ).catch(() => null);
    if (session) await boundedClose(session);
  };

  const isDead = (session: BrowserSession): boolean =>
    !session.browser.isConnected() ||
    (session.page as { isClosed?: () => boolean }).isClosed?.() === true;

  const acquire = async (leaseEpoch: number): Promise<{ page: unknown }> => {
    for (;;) {
      if (ended) throw new Error('managed browser: acquire() after end()');
      if (leaseEpoch !== epoch) {
        throw new Error('managed browser: lease invalidated by reset()');
      }
      let launchedFresh = false;
      let attempt = launching;
      if (!attempt) {
        attempt = launching = launchBrowser(opts);
        launchedFresh = true;
      }
      let session: BrowserSession;
      try {
        session = await attempt;
      } catch (err) {
        if (launching === attempt) launching = null;
        throw err;
      }
      if (ended) throw new Error('managed browser: acquire() after end()');
      if (leaseEpoch !== epoch) {
        throw new Error('managed browser: lease invalidated by reset()');
      }
      if (launching !== attempt) continue;
      if (isDead(session)) {
        launching = null;
        await closeSession(attempt);
        if (launchedFresh) throw new Error('managed browser: disconnected right after launch');
        continue;
      }
      return { page: session.page };
    }
  };

  return {
    openLease() {
      const leaseEpoch = epoch;
      return {
        acquire: () => acquire(leaseEpoch),
        isValid: () => !ended && leaseEpoch === epoch,
      };
    },
    async reset() {
      epoch++;
      const old = launching;
      launching = null;
      if (old) await closeSession(old);
    },
    async end() {
      ended = true;
      epoch++;
      const old = launching;
      launching = null;
      if (old) await closeSession(old);
    },
  };
}
