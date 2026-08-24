import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createManagedBrowser } from './managed-browser.js';

const { mockLaunch, mockPwLaunch } = vi.hoisted(() => ({
  mockLaunch: vi.fn(),
  mockPwLaunch: vi.fn(),
}));
vi.mock('./browser-kit.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./browser-kit.js')>();
  return { ...mod, launchBrowser: mockLaunch };
});
vi.mock('playwright', () => ({
  chromium: { launch: mockPwLaunch, connectOverCDP: vi.fn() },
}));

function fakeSession() {
  let connected = true;
  let pageClosed = false;
  return {
    browser: { isConnected: () => connected },
    page: { id: Symbol('page'), isClosed: () => pageClosed },
    close: vi.fn(async () => {
      connected = false;
    }),
    disconnect: () => {
      connected = false;
    },
    closePage: () => {
      pageClosed = true;
    },
  };
}

beforeEach(() => {
  mockLaunch.mockReset();
  mockPwLaunch.mockReset();
});

describe('createManagedBrowser', () => {
  it('concurrent acquires share one launch', async () => {
    const session = fakeSession();
    let resolveLaunch!: (s: unknown) => void;
    mockLaunch.mockReturnValueOnce(new Promise((r) => { resolveLaunch = r; }));
    const managed = createManagedBrowser({});

    const a = managed.openLease().acquire();
    const b = managed.openLease().acquire();
    resolveLaunch(session);
    const [ra, rb] = await Promise.all([a, b]);

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(ra.page).toBe(session.page);
    expect(rb.page).toBe(session.page);
  });

  it('relaunches on the next acquire after the browser disconnects', async () => {
    const s1 = fakeSession();
    const s2 = fakeSession();
    mockLaunch.mockResolvedValueOnce(s1).mockResolvedValueOnce(s2);
    const managed = createManagedBrowser({});

    expect((await managed.openLease().acquire()).page).toBe(s1.page);
    s1.disconnect();
    expect((await managed.openLease().acquire()).page).toBe(s2.page);
    expect(mockLaunch).toHaveBeenCalledTimes(2);
    expect(s1.close).toHaveBeenCalledTimes(1);
  });

  it('relaunches on the next acquire after the page is closed', async () => {
    const s1 = fakeSession();
    const s2 = fakeSession();
    mockLaunch.mockResolvedValueOnce(s1).mockResolvedValueOnce(s2);
    const managed = createManagedBrowser({});

    expect((await managed.openLease().acquire()).page).toBe(s1.page);
    s1.closePage();
    expect((await managed.openLease().acquire()).page).toBe(s2.page);
    expect(mockLaunch).toHaveBeenCalledTimes(2);
    expect(s1.close).toHaveBeenCalledTimes(1);
  });

  it('rejects acquire after end() without relaunching', async () => {
    const s1 = fakeSession();
    mockLaunch.mockResolvedValueOnce(s1);
    const managed = createManagedBrowser({});

    await managed.openLease().acquire();
    await managed.end();
    expect(s1.close).toHaveBeenCalledTimes(1);
    await expect(managed.openLease().acquire()).rejects.toThrow('after end()');
    expect(mockLaunch).toHaveBeenCalledTimes(1);
  });

  it('never launches when end() comes before any acquire', async () => {
    const managed = createManagedBrowser({});
    await managed.end();
    await expect(managed.openLease().acquire()).rejects.toThrow('after end()');
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('reset() closes the session and a fresh lease gets a fresh one', async () => {
    const s1 = fakeSession();
    const s2 = fakeSession();
    mockLaunch.mockResolvedValueOnce(s1).mockResolvedValueOnce(s2);
    const managed = createManagedBrowser({});

    await managed.openLease().acquire();
    await managed.reset();
    expect(s1.close).toHaveBeenCalledTimes(1);
    expect((await managed.openLease().acquire()).page).toBe(s2.page);
  });

  it('a lease opened before reset() cannot acquire after it while a fresh lease can', async () => {
    const s1 = fakeSession();
    const s2 = fakeSession();
    mockLaunch.mockResolvedValueOnce(s1).mockResolvedValueOnce(s2);
    const managed = createManagedBrowser({});

    const stale = managed.openLease();
    expect((await stale.acquire()).page).toBe(s1.page);
    await managed.reset();

    await expect(stale.acquire()).rejects.toThrow('lease invalidated');
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect((await managed.openLease().acquire()).page).toBe(s2.page);
    expect(mockLaunch).toHaveBeenCalledTimes(2);
  });

  it('isValid() flips false after reset() and end() so late results can fence themselves', async () => {
    mockLaunch.mockResolvedValueOnce(fakeSession());
    const managed = createManagedBrowser({});

    const lease = managed.openLease();
    await lease.acquire();
    expect(lease.isValid()).toBe(true);

    await managed.reset();
    expect(lease.isValid()).toBe(false);

    const fresh = managed.openLease();
    expect(fresh.isValid()).toBe(true);
    await managed.end();
    expect(fresh.isValid()).toBe(false);
  });

  it('surfaces a launch failure from acquire, then retries on the next acquire', async () => {
    const s2 = fakeSession();
    mockLaunch.mockRejectedValueOnce(new Error('no chrome')).mockResolvedValueOnce(s2);
    const managed = createManagedBrowser({});

    await expect(managed.openLease().acquire()).rejects.toThrow('no chrome');
    expect((await managed.openLease().acquire()).page).toBe(s2.page);
  });

  it('reset() during a pending launch closes its session and invalidates the lease', async () => {
    const s1 = fakeSession();
    let resolveLaunch!: (s: unknown) => void;
    mockLaunch.mockReturnValueOnce(new Promise((r) => { resolveLaunch = r; }));
    const managed = createManagedBrowser({});

    const pending = managed.openLease().acquire();
    const pendingRejects = expect(pending).rejects.toThrow('lease invalidated');
    const resetDone = managed.reset();
    resolveLaunch(s1);
    await resetDone;

    expect(s1.close).toHaveBeenCalledTimes(1);
    await pendingRejects;
    expect(mockLaunch).toHaveBeenCalledTimes(1);
  });

  it('reset() settles within its bound while a launch hangs, then closes the late session', async () => {
    vi.useFakeTimers();
    try {
      let resolveLaunch!: (s: unknown) => void;
      mockLaunch.mockReturnValueOnce(new Promise((r) => { resolveLaunch = r; }));
      const managed = createManagedBrowser({});

      const pending = managed.openLease().acquire();
      const pendingRejects = expect(pending).rejects.toThrow('lease invalidated');
      const resetDone = managed.reset();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(resetDone).resolves.toBeUndefined();

      const s1 = fakeSession();
      resolveLaunch(s1);
      await vi.advanceTimersByTimeAsync(0);
      expect(s1.close).toHaveBeenCalledTimes(1);
      await pendingRejects;
    } finally {
      vi.useRealTimers();
    }
  });

  it('an acquire that joined a dead launch retries instead of failing fresh-launch style', async () => {
    const s1 = fakeSession();
    s1.disconnect();
    const s2 = fakeSession();
    let resolveLaunch!: (s: unknown) => void;
    mockLaunch
      .mockReturnValueOnce(new Promise((r) => { resolveLaunch = r; }))
      .mockResolvedValueOnce(s2);
    const managed = createManagedBrowser({});

    const first = managed.openLease().acquire();
    const joiner = managed.openLease().acquire();
    const firstRejects = expect(first).rejects.toThrow('disconnected right after launch');
    resolveLaunch(s1);

    await firstRejects;
    expect((await joiner).page).toBe(s2.page);
    expect(mockLaunch).toHaveBeenCalledTimes(2);
    expect(s1.close).toHaveBeenCalledTimes(1);
  });

  it('acquire rejects when the launch hangs, closes the late session once, and relaunches next time', async () => {
    vi.useFakeTimers();
    try {
      let resolveLaunch!: (s: unknown) => void;
      const s2 = fakeSession();
      mockLaunch
        .mockReturnValueOnce(new Promise((r) => { resolveLaunch = r; }))
        .mockResolvedValueOnce(s2);
      const managed = createManagedBrowser({});

      const pending = managed.openLease().acquire();
      const pendingRejects = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(60_000);
      await pendingRejects;

      const s1 = fakeSession();
      resolveLaunch(s1);
      await vi.advanceTimersByTimeAsync(0);
      expect(s1.close).toHaveBeenCalledTimes(1);

      expect((await managed.openLease().acquire()).page).toBe(s2.page);
      expect(mockLaunch).toHaveBeenCalledTimes(2);
      expect(s1.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset() during a hung launch plus the launch timeout close the late session exactly once', async () => {
    vi.useFakeTimers();
    try {
      let resolveLaunch!: (s: unknown) => void;
      mockLaunch.mockReturnValueOnce(new Promise((r) => { resolveLaunch = r; }));
      const managed = createManagedBrowser({});

      const pending = managed.openLease().acquire();
      const pendingRejects = expect(pending).rejects.toThrow('timed out');
      const resetDone = managed.reset();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(resetDone).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(60_000);
      await pendingRejects;

      const s1 = fakeSession();
      resolveLaunch(s1);
      await vi.advanceTimersByTimeAsync(0);
      expect(s1.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('end() resolves even when the close hangs', async () => {
    vi.useFakeTimers();
    try {
      const s1 = fakeSession();
      s1.close.mockReturnValue(new Promise(() => {}));
      mockLaunch.mockResolvedValueOnce(s1);
      const managed = createManagedBrowser({});

      await managed.openLease().acquire();
      const done = managed.end();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(done).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('launchBrowser close()', () => {
  it('still closes the browser when page.close() hangs', async () => {
    vi.useFakeTimers();
    try {
      const page = { close: vi.fn(() => new Promise<void>(() => {})) };
      const ctx = { newPage: vi.fn(async () => page) };
      const browserClose = vi.fn(async () => {});
      mockPwLaunch.mockResolvedValueOnce({
        contexts: () => [],
        newContext: vi.fn(async () => ctx),
        close: browserClose,
        isConnected: () => true,
      });

      const { launchBrowser } = await vi.importActual<typeof import('./browser-kit.js')>(
        './browser-kit.js'
      );
      const session = await launchBrowser({});
      const closing = session.close();
      await vi.advanceTimersByTimeAsync(3_000);
      await closing;

      expect(page.close).toHaveBeenCalledTimes(1);
      expect(browserClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects within the bound and closes the browser when newContext() hangs', async () => {
    vi.useFakeTimers();
    try {
      const browserClose = vi.fn(async () => {});
      mockPwLaunch.mockResolvedValueOnce({
        contexts: () => [],
        newContext: vi.fn(() => new Promise(() => {})),
        close: browserClose,
        isConnected: () => true,
      });

      const { launchBrowser } = await vi.importActual<typeof import('./browser-kit.js')>(
        './browser-kit.js'
      );
      const pendingRejects = expect(launchBrowser({})).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(30_000);
      await pendingRejects;
      expect(browserClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects within the bound and closes the browser when newPage() hangs', async () => {
    vi.useFakeTimers();
    try {
      const ctx = { newPage: vi.fn(() => new Promise(() => {})) };
      const browserClose = vi.fn(async () => {});
      mockPwLaunch.mockResolvedValueOnce({
        contexts: () => [],
        newContext: vi.fn(async () => ctx),
        close: browserClose,
        isConnected: () => true,
      });

      const { launchBrowser } = await vi.importActual<typeof import('./browser-kit.js')>(
        './browser-kit.js'
      );
      const pendingRejects = expect(launchBrowser({})).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(30_000);
      await pendingRejects;
      expect(browserClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('under cdp, a page that arrives after the deadline is closed instead of orphaned', async () => {
    vi.useFakeTimers();
    try {
      let resolvePage!: (p: unknown) => void;
      const latePage = { close: vi.fn(async () => {}) };
      const ctx = { newPage: vi.fn(() => new Promise((r) => { resolvePage = r; })) };
      const browserClose = vi.fn(async () => {});
      const pw = await import('playwright');
      vi.mocked(pw.chromium.connectOverCDP).mockResolvedValueOnce({
        contexts: () => [ctx],
        newContext: vi.fn(),
        close: browserClose,
        isConnected: () => true,
      } as never);

      const { launchBrowser } = await vi.importActual<typeof import('./browser-kit.js')>(
        './browser-kit.js'
      );
      const pendingRejects = expect(launchBrowser({ cdpPort: 9222 })).rejects.toThrow('page create timed out');
      await vi.advanceTimersByTimeAsync(30_000);
      await pendingRejects;
      expect(browserClose).toHaveBeenCalledTimes(1);

      resolvePage(latePage);
      await vi.advanceTimersByTimeAsync(0);
      expect(latePage.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('under cdp with no existing context, a hanging newContext() rejects and disconnects', async () => {
    vi.useFakeTimers();
    try {
      const browserClose = vi.fn(async () => {});
      const pw = await import('playwright');
      vi.mocked(pw.chromium.connectOverCDP).mockResolvedValueOnce({
        contexts: () => [],
        newContext: vi.fn(() => new Promise(() => {})),
        close: browserClose,
        isConnected: () => true,
      } as never);

      const { launchBrowser } = await vi.importActual<typeof import('./browser-kit.js')>(
        './browser-kit.js'
      );
      const pendingRejects = expect(launchBrowser({ cdpPort: 9222 })).rejects.toThrow('context create timed out');
      await vi.advanceTimersByTimeAsync(30_000);
      await pendingRejects;
      expect(browserClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves with a page when context and page creation settle promptly', async () => {
    const page = { close: vi.fn(async () => {}) };
    const ctx = { newPage: vi.fn(async () => page) };
    const browserClose = vi.fn(async () => {});
    mockPwLaunch.mockResolvedValueOnce({
      contexts: () => [],
      newContext: vi.fn(async () => ctx),
      close: browserClose,
      isConnected: () => true,
    });

    const { launchBrowser } = await vi.importActual<typeof import('./browser-kit.js')>(
      './browser-kit.js'
    );
    const session = await launchBrowser({});
    expect(session.page).toBe(page);
    expect(browserClose).not.toHaveBeenCalled();
    await session.close();
    expect(browserClose).toHaveBeenCalledTimes(1);
  });

  it('closes the browser when page creation fails after launch', async () => {
    const browserClose = vi.fn(async () => {});
    mockPwLaunch.mockResolvedValueOnce({
      contexts: () => [],
      newContext: vi.fn(async () => {
        throw new Error('no context');
      }),
      close: browserClose,
      isConnected: () => true,
    });

    const { launchBrowser } = await vi.importActual<typeof import('./browser-kit.js')>(
      './browser-kit.js'
    );
    await expect(launchBrowser({})).rejects.toThrow('no context');
    expect(browserClose).toHaveBeenCalledTimes(1);
  });
});
