//
// MCP result compaction
// ======================
// Some tool results (discover's url list, extract's failures, verify's stale-CDN
// buckets) can balloon past the MCP token cap on large sites — one real run had
// discover at ~68k chars, extract at ~132k, verify at ~55k, each of which had to
// be re-parsed from a spill file. This helper makes those results COMPACT and
// NON-LOSSY:
//
//   - All scalar / summary / object fields are preserved verbatim (callers depend
//     on counts, validation, paths, qualityScores, etc.).
//   - Named "large" arrays are capped to the first N items (default 50). When an
//     array is actually truncated, a sibling `<field>Truncated: <total>` marker
//     records the full length so truncation is always visible.
//   - Whenever a named array is actually capped (or the full result exceeds the
//     raw-size threshold) AND a sidecar path is supplied, the COMPLETE result
//     JSON is written there and a `fullResultPath` pointer is added so the full
//     set stays recoverable.
//
// Nothing is ever dropped silently: either the array fits inline, or it is capped
// with a visible count + a recoverable sidecar.
//

import { writeFileSync } from 'node:fs';

/** Default per-array inline cap. */
export const DEFAULT_ARRAY_CAP = 50;

/**
 * Size (in serialized JSON chars) above which we spill the full result to a
 * sidecar file. Kept well under the MCP token cap so the compact result always
 * fits. The full result is still recoverable from `fullResultPath`.
 */
export const DEFAULT_SPILL_THRESHOLD = 24_000;

export interface CompactOptions {
  /** Field names whose values are arrays eligible for capping. */
  arrayFields: string[];
  /**
   * Absolute path to write the full result JSON to when it is large. Pass null
   * when no stable location is available (e.g. discover without an outputDir) —
   * arrays are still capped inline, just without a `fullResultPath` pointer.
   */
  fullResultPath: string | null;
  /** Per-array inline cap. Defaults to {@link DEFAULT_ARRAY_CAP}. */
  cap?: number;
  /** Spill threshold in chars. Defaults to {@link DEFAULT_SPILL_THRESHOLD}. */
  spillThreshold?: number;
}

/**
 * Produce a compact, non-lossy copy of `full`. The input is not mutated.
 *
 * The returned object is the same shape as `full` with: each named array capped
 * to `cap` items + a `<field>Truncated` count when it overflowed, plus a
 * `fullResultPath` pointer when the full result was large enough to be spilled
 * to disk.
 */
export function compactResult(
  full: Record<string, unknown>,
  opts: CompactOptions,
): Record<string, unknown> {
  const cap = opts.cap ?? DEFAULT_ARRAY_CAP;
  const spillThreshold = opts.spillThreshold ?? DEFAULT_SPILL_THRESHOLD;

  // Cap the named arrays first and track whether ANY was truncated. A truncated
  // array means the full set is no longer inline, so it MUST be recoverable from
  // the sidecar — that drives the spill decision below alongside the raw-size
  // guard (which catches results that are large for other reasons).
  const out: Record<string, unknown> = { ...full };
  let anyTruncated = false;
  for (const field of opts.arrayFields) {
    const val = out[field];
    if (Array.isArray(val) && val.length > cap) {
      out[field] = val.slice(0, cap);
      out[`${field}Truncated`] = val.length;
      anyTruncated = true;
    }
  }

  const isLarge = anyTruncated || safeSize(full) > spillThreshold;

  if (isLarge && opts.fullResultPath) {
    try {
      writeFileSync(opts.fullResultPath, JSON.stringify(full, null, 2));
      out.fullResultPath = opts.fullResultPath;
    } catch {
      // If we can't write the sidecar, still return the capped result — the
      // caps keep us under the token cap; we lose recoverability for this call
      // rather than overflowing the response.
    }
  }

  return out;
}

function safeSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
