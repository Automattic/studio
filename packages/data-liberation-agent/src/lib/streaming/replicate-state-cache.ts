//
// Replicate state cache
// =====================
// In-memory cache wrapper around `replicate-state.json`. The streaming engine
// `observe()`s on every URL, but loading the JSON file each time is wasteful;
// this cache reads once on first access, mutates in-memory, and writes back
// only when `update()` is called.
//
// Single-process semantics: the cache assumes the calling tick-scheduler is
// the sole writer. Multi-process callers must coordinate via the streaming
// lockfile and call `reload()` after acquiring the lock.
//
import {
  loadReplicateState,
  saveReplicateState,
  type ReplicateState,
} from './replicate-state.js';

export class ReplicateStateCache {
  private readonly outputDir: string;
  private cached: ReplicateState | null = null;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * Read the state. First call reads from disk; subsequent calls return the
   * cached value without I/O. The returned object is the cache's internal
   * reference — callers should treat it as read-only and use `update()` to
   * mutate.
   */
  get(): ReplicateState {
    if (this.cached === null) {
      this.cached = loadReplicateState(this.outputDir);
    }
    return this.cached;
  }

  /**
   * Apply a transform to the state and persist it. The transform should
   * return a new (or mutated) state object; the cache writes whichever value
   * the transform returns and uses that as its new cached value.
   */
  update(fn: (state: ReplicateState) => ReplicateState): ReplicateState {
    const current = this.get();
    const next = fn(current);
    this.cached = next;
    saveReplicateState(this.outputDir, next);
    return next;
  }

  /**
   * Force a reread from disk (e.g. after releasing a lock that another writer
   * may have held). Drops the in-memory copy and reloads on next access.
   */
  reload(): ReplicateState {
    this.cached = loadReplicateState(this.outputDir);
    return this.cached;
  }
}
