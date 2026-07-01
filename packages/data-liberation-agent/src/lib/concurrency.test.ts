import { describe, it, expect } from 'vitest';
import { mapPool } from './concurrency.js';

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
