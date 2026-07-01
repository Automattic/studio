//
// Tick scheduler
// ==============
// Decides when the streaming replicate loop needs a "judgment moment" — i.e.
// when a skill (replicate / design-foundation) should run. The scheduler is
// a small state machine over `replicate-state.json` plus an in-memory queue
// of pending judgments.
//
// Triggers:
//   - First URL of a new archetype  -> 'new-archetype' tick
//   - Every Nth URL (default 5)     -> 'periodic' tick (caller checks drift)
//   - Caller-driven                 -> 'foundation-drift' or 'manual'
//
// Foundation gating: `archetype-template` judgments require a design
// foundation to anchor template/pattern generation. While
// `design-foundation.json` is missing, new-archetype ticks are held in a
// deferred queue. When the foundation appears (after the first periodic
// `foundation-rev` runs and the consumer generates the file), the next
// observe() or drain() releases the deferred ticks in observation order.
// `foundation-rev` ticks (periodic / drift / manual) are never deferred.
//
// The scheduler does NOT invoke skills directly. `drain()` returns
// `JudgmentNeeded[]` markers that the calling agent (via the
// `liberate_replicate_tick` MCP handler, the watch CLI, etc.) acts on by
// running the appropriate skill.
//
// Persistence: each `observe()` writes through to `replicate-state.json` via
// `ReplicateStateCache` so a crash mid-loop doesn't lose URL counts. The
// cache batches reads but not writes; if hot-loop write cost matters in the
// future, switch the cache to deferred-write with explicit `flush()` calls.
//
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ReplicateStateCache } from './replicate-state-cache.js';

const FOUNDATION_FILENAME = 'design-foundation.json';

export type TickReason = 'new-archetype' | 'periodic' | 'foundation-drift' | 'manual';

export interface JudgmentNeeded {
  /** What kind of skill the consumer should run. */
  kind: 'archetype-template' | 'foundation-rev' | 'theme-piece';
  /** When `kind === 'archetype-template'`, the archetype that needs templates. */
  archetype?: string;
  /** Human-readable reason the agent / CLI can surface to the user. */
  rationale: string;
  /**
   * Free-form inputs the consumer should pass into the skill. Common keys:
   *   - `outputDir`: liberation output dir
   *   - `archetype`: same as the field above (mirrored for skill-side convenience)
   *   - `tickReason`: 'new-archetype' | 'periodic' | etc.
   *   - `urlsSeen`: snapshot of state.urlsSeen at observe-time
   */
  inputs: Record<string, unknown>;
}

export interface TickScheduler {
  /**
   * Notify the scheduler a URL just finished extracting. Updates `urlsSeen` +
   * `archetypesObserved`; enqueues `new-archetype` and / or `periodic` ticks
   * as appropriate.
   */
  observe(url: string, archetype: string): void;
  /**
   * Manually enqueue a tick for a given reason. Useful when the consumer has
   * external evidence drift has occurred (e.g. user invoked a manual rebuild).
   */
  trigger(reason: TickReason): void;
  /**
   * Drain all queued ticks and return the resulting JudgmentNeeded markers.
   * The internal queue is cleared even if the consumer ignores the returned
   * markers — `drain()` is a single-shot operation per tick window.
   */
  drain(): Promise<JudgmentNeeded[]>;
  /**
   * Persist the digest of the foundation inputs that have just been handled.
   * This goes through the scheduler's cache so later observe() calls in the
   * same process do not overwrite an out-of-band replicate-state write.
   */
  recordFoundationInputsDigest(digest: string): void;
}

export interface TickSchedulerOpts {
  outputDir: string;
  /** How many URLs between periodic ticks. Default 5. */
  urlsPerTick?: number;
}

interface PendingTick {
  reason: TickReason;
  archetype?: string;
  urlsSeenAtEnqueue: number;
}

export function createTickScheduler(opts: TickSchedulerOpts): TickScheduler {
  const urlsPerTick = opts.urlsPerTick ?? 5;
  if (urlsPerTick < 1 || !Number.isInteger(urlsPerTick)) {
    throw new Error(`urlsPerTick must be a positive integer (got ${urlsPerTick})`);
  }
  const cache = new ReplicateStateCache(opts.outputDir);
  const queue: PendingTick[] = [];
  // Held archetype-template ticks waiting for the design foundation to exist.
  // Released in observation order once `design-foundation.json` appears.
  const deferredArchetypeTicks: PendingTick[] = [];
  // Set-based dedup so two URLs of the same new archetype don't both enqueue.
  const enqueuedNewArchetypes = new Set<string>();

  function foundationFileExists(): boolean {
    return existsSync(join(opts.outputDir, FOUNDATION_FILENAME));
  }

  function releaseDeferredIfReady(): void {
    if (deferredArchetypeTicks.length === 0) return;
    if (!foundationFileExists()) return;
    queue.push(...deferredArchetypeTicks);
    deferredArchetypeTicks.length = 0;
  }

  function observe(url: string, archetype: string): void {
    void url; // accepted for future use; the scheduler is archetype-driven today

    // Release any previously-deferred archetype ticks first. This preserves
    // observation order: archetypes seen earlier (while the foundation was
    // still missing) end up ahead of any archetype enqueued by this same
    // observe() call.
    releaseDeferredIfReady();

    let wasNewArchetype = false;
    const updated = cache.update((s) => {
      wasNewArchetype = !s.archetypesObserved.includes(archetype);
      const next = { ...s, urlsSeen: s.urlsSeen + 1 };
      if (wasNewArchetype) {
        next.archetypesObserved = [...s.archetypesObserved, archetype].sort();
      }
      return next;
    });

    // Set-based in-process dedup: even if `wasNewArchetype` slips (e.g. two
    // observe() calls race for the same archetype before the first persists),
    // we enqueue exactly one new-archetype tick per archetype per run.
    if (wasNewArchetype && !enqueuedNewArchetypes.has(archetype)) {
      enqueuedNewArchetypes.add(archetype);
      const tick: PendingTick = {
        reason: 'new-archetype',
        archetype,
        urlsSeenAtEnqueue: updated.urlsSeen,
      };
      // Hold archetype-template ticks until the design foundation exists.
      // Templates/patterns need foundation tokens (palette, typography,
      // spacing) to anchor — running them first wastes an agent invocation.
      if (foundationFileExists()) {
        queue.push(tick);
      } else {
        deferredArchetypeTicks.push(tick);
      }
    }

    if (updated.urlsSeen > 0 && updated.urlsSeen % urlsPerTick === 0) {
      queue.push({ reason: 'periodic', urlsSeenAtEnqueue: updated.urlsSeen });
    }
  }

  function trigger(reason: TickReason): void {
    const state = cache.get();
    queue.push({ reason, urlsSeenAtEnqueue: state.urlsSeen });
  }

  async function drain(): Promise<JudgmentNeeded[]> {
    // Last-chance release: foundation may have appeared between observe() and
    // drain() (e.g. the consumer just finished processing a foundation-rev
    // tick from this same drain cycle in a prior loop iteration).
    releaseDeferredIfReady();
    const ticks = queue.splice(0, queue.length);
    const judgments: JudgmentNeeded[] = [];

    for (const tick of ticks) {
      if (tick.reason === 'new-archetype' && tick.archetype) {
        judgments.push({
          kind: 'archetype-template',
          archetype: tick.archetype,
          rationale: `First ${tick.archetype} URL observed; templates and patterns for this archetype should be generated.`,
          inputs: {
            outputDir: opts.outputDir,
            archetype: tick.archetype,
            tickReason: tick.reason,
            urlsSeen: tick.urlsSeenAtEnqueue,
          },
        });
      } else if (tick.reason === 'periodic' || tick.reason === 'foundation-drift' || tick.reason === 'manual') {
        judgments.push({
          kind: 'foundation-rev',
          rationale:
            tick.reason === 'periodic'
              ? `Periodic check after ${tick.urlsSeenAtEnqueue} URLs; consumer should compute drift score and re-run design-foundation if needed.`
              : tick.reason === 'foundation-drift'
                ? 'Foundation inputs have drifted; re-run design-foundation skill.'
                : 'Manual tick triggered.',
          inputs: {
            outputDir: opts.outputDir,
            tickReason: tick.reason,
            urlsSeen: tick.urlsSeenAtEnqueue,
          },
        });
      }
    }

    if (judgments.length > 0) {
      const lastReason = ticks[ticks.length - 1].reason;
      cache.update((s) => ({
        ...s,
        lastTickAt: new Date().toISOString(),
        lastTickReason: lastReason,
      }));
    }

    return judgments;
  }

  function recordFoundationInputsDigest(digest: string): void {
    cache.update((s) => ({
      ...s,
      lastFoundationInputsDigest: digest,
    }));
  }

  return { observe, trigger, drain, recordFoundationInputsDigest };
}
