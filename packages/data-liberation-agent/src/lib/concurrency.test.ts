import { describe, it, expect, vi } from 'vitest';
import { mapPool, withTimeout, TimeoutError } from './concurrency.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapPool', () => {
  it('returns results in INPUT order regardless of completion order', async () => {
    // item 0 finishes LAST, item 3 finishes first — output must still be [0,1,2,3].
    const delays = [30, 5, 20, 1];
    const out = await mapPool(delays, 4, async (d, i) => {
      await sleep(d);
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it('never exceeds the concurrency limit, but does parallelize', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool([...Array(20).keys()], 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // genuinely concurrent, not serial
  });

  it('processes every item exactly once', async () => {
    const seen = new Set<number>();
    await mapPool([...Array(50).keys()], 7, async (n) => {
      seen.add(n);
    });
    expect(seen.size).toBe(50);
  });

  it('handles an empty list', async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });

  it('floors concurrency at 1 (0 / negative still runs serially)', async () => {
    expect(await mapPool([1, 2, 3], 0, async (x) => x * 2)).toEqual([2, 4, 6]);
  });
});

describe('withTimeout', () => {
  it('resolves with the promise value when it settles in time', async () => {
    expect(await withTimeout(Promise.resolve(42), 1000, 'fast')).toBe(42);
  });

  it('propagates the promise rejection when it rejects in time', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'rejecting'))
      .rejects.toThrow('boom');
  });

  it('rejects with the label when the promise never settles', async () => {
    const never = new Promise<void>(() => {});
    await expect(withTimeout(never, 10, 'stuck call'))
      .rejects.toThrow('stuck call timed out after 10ms');
  });

  it('rejects with a TimeoutError carrying the label', async () => {
    const err = await withTimeout(new Promise<void>(() => {}), 10, 'watchdog').catch((e) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).label).toBe('watchdog');
  });

  it('calls onLateResolve with the value when the promise resolves after the deadline', async () => {
    let resolveLate!: (v: number) => void;
    const p = new Promise<number>((r) => { resolveLate = r; });
    const onLate = vi.fn();
    await expect(withTimeout(p, 10, 'late', onLate)).rejects.toThrow('late timed out after 10ms');
    expect(onLate).not.toHaveBeenCalled();
    resolveLate(42);
    await sleep(0);
    expect(onLate).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('does not call onLateResolve when the promise resolves in time', async () => {
    const onLate = vi.fn();
    expect(await withTimeout(Promise.resolve(1), 1000, 'in time', onLate)).toBe(1);
    await sleep(20);
    expect(onLate).not.toHaveBeenCalled();
  });

  it('swallows a late rejection instead of raising an unhandled rejection', async () => {
    let rejectLate!: (e: Error) => void;
    const p = new Promise<void>((_, rj) => { rejectLate = rj; });
    const onLate = vi.fn();
    await expect(withTimeout(p, 10, 'late-reject', onLate)).rejects.toThrow('timed out');

    const unhandled: unknown[] = [];
    const capture = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', capture);
    try {
      rejectLate(new Error('late boom'));
      await sleep(20);
    } finally {
      process.off('unhandledRejection', capture);
    }
    expect(unhandled).toEqual([]);
    expect(onLate).not.toHaveBeenCalled();
  });

  it('swallows an onLateResolve error instead of raising an unhandled rejection', async () => {
    let resolveLate!: (v: number) => void;
    const p = new Promise<number>((r) => { resolveLate = r; });
    await expect(
      withTimeout(p, 10, 'late-throw', () => { throw new Error('disposal failed'); })
    ).rejects.toThrow('timed out');

    const unhandled: unknown[] = [];
    const capture = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', capture);
    try {
      resolveLate(1);
      await sleep(20);
    } finally {
      process.off('unhandledRejection', capture);
    }
    expect(unhandled).toEqual([]);
  });

  // Mirrors the wix CDP wiring (adapters/wix/page.ts): a session that resolves
  // after the deadline is never assigned to the caller's variable, so its
  // finally-detach can't see it — the late-resolve hook must detach it.
  it('detaches a CDP session created after the deadline', async () => {
    const client = { detach: vi.fn(() => Promise.resolve()) };
    let resolveSession!: (c: typeof client) => void;
    const sessionPromise = new Promise<typeof client>((r) => { resolveSession = r; });

    let assigned: typeof client | null = null;
    try {
      assigned = await withTimeout(
        sessionPromise, 10, 'CDP session',
        (c) => { void c.detach().catch(() => {}); });
    } catch {
      // timed out — session abandoned
    }
    resolveSession(client);
    await sleep(0);

    expect(assigned).toBeNull();
    expect(client.detach).toHaveBeenCalledTimes(1);
  });
});
