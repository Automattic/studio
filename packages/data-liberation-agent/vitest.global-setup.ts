import { readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Age-gated cleanup of the cwd-local test scratch dir (`.tmp-test/`).
 *
 * Tests use cwd-local .tmp-test/ fixtures by convention (not because validateOutputDir requires it).
 * Most tests don't remove what they create, so the dir grows unbounded across runs (it reached ~15k
 * dirs / 91 MB).
 *
 * This runs ONCE before the suite and removes only entries whose mtime is older than `MAX_AGE_MS`.
 * The age gate IS the concurrency-safety mechanism: no real test run lasts anywhere near 24h, so a
 * >24h-old entry can never belong to a concurrent `vitest` run or another coding session's in-flight
 * fixtures — we never blindly sweep the shared dir. Self-heals every leaker with zero per-test
 * changes, and a run's own fresh dirs are kept (useful for post-failure debugging) until they age out.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export default function purgeStaleTestScratch(): void {
  const root = join(process.cwd(), '.tmp-test');
  const cutoff = Date.now() - MAX_AGE_MS;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return; // no .tmp-test yet — nothing to purge
  }
  let removed = 0;
  for (const name of entries) {
    const entry = join(root, name);
    try {
      if (statSync(entry).mtimeMs < cutoff) {
        rmSync(entry, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // raced with a concurrent run already removing this stale entry — fine, best-effort.
    }
  }
  if (removed > 0) {
    console.log(`[vitest] purged ${removed} stale .tmp-test entr${removed === 1 ? 'y' : 'ies'} (>24h old)`);
  }
}
