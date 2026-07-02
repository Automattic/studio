// src/lib/resume-state/faultpoint.ts
//
// Test-only fault injection for resume-state boundaries.
// ====================================================
// `faultpoint(name)` is a single guarded check that throws ONLY when a test has
// armed `name`. In production nothing arms a fault, so every call is a cheap
// Set.has on an empty set — effectively free, and inert. The named seams double
// as living documentation of where the durable, atomic boundaries are: a crash
// at the seam must leave prior state intact and resume cleanly.
//
// MVP is an in-process registry (covers vitest-driven boundary tests). A
// subprocess / env-var variant for real process death is deliberately deferred —
// none of the covered boundaries need it (they are single-write atomicity or
// idempotent replay).

/** Thrown by `faultpoint` when its name is armed. */
export class FaultInjected extends Error {
  constructor(name: string) {
    super(`fault injected at ${name}`);
    this.name = 'FaultInjected';
  }
}

const armed = new Set<string>();

/** Throw `FaultInjected` iff `name` is currently armed; otherwise no-op. */
export function faultpoint(name: string): void {
  if (armed.size > 0 && armed.has(name)) throw new FaultInjected(name);
}

/** Test helper: arm a fault name so the next matching `faultpoint` throws. */
export function armFault(name: string): void {
  armed.add(name);
}

/** Test helper: disarm a previously-armed fault name. */
export function disarmFault(name: string): void {
  armed.delete(name);
}

/** Test helper: clear all armed faults (use in afterEach). */
export function clearFaults(): void {
  armed.clear();
}

/** Test helper: run `fn` with `name` armed, disarming in `finally`. */
export function withFault<T>(name: string, fn: () => T): T {
  armFault(name);
  try {
    return fn();
  } finally {
    disarmFault(name);
  }
}
