import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { ReplicateStateCache } from './replicate-state-cache.js';
import * as state from './replicate-state.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function tmp(): string {
  return mkdtempSync(join(FIXTURE_TMP, 'rsc-'));
}

describe('ReplicateStateCache', () => {
  it('reads from disk only on first access', () => {
    const dir = tmp();
    const spy = vi.spyOn(state, 'loadReplicateState');
    const cache = new ReplicateStateCache(dir);
    cache.get();
    cache.get();
    cache.get();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('persists changes through update() and returns the new state', () => {
    const dir = tmp();
    const cache = new ReplicateStateCache(dir);
    const result = cache.update((s) => ({ ...s, urlsSeen: 7 }));
    expect(result.urlsSeen).toBe(7);

    // Reload from disk via a fresh cache to confirm the write happened.
    const fresh = new ReplicateStateCache(dir);
    expect(fresh.get().urlsSeen).toBe(7);
  });

  it('update() updates the in-memory cache (no extra disk read)', () => {
    const dir = tmp();
    const cache = new ReplicateStateCache(dir);
    cache.update((s) => ({ ...s, urlsSeen: 1 }));

    const spy = vi.spyOn(state, 'loadReplicateState');
    expect(cache.get().urlsSeen).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reload() forces a fresh read from disk', () => {
    const dir = tmp();
    const cache = new ReplicateStateCache(dir);
    cache.get();

    // Simulate an out-of-band write
    state.saveReplicateState(dir, { ...state.emptyState(), urlsSeen: 42 });
    expect(cache.get().urlsSeen).toBe(0); // still cached

    const reloaded = cache.reload();
    expect(reloaded.urlsSeen).toBe(42);
    expect(cache.get().urlsSeen).toBe(42);
  });
});
