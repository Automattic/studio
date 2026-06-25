//
// Foundation drift
// ================
// Helpers the tick-scheduler uses to decide whether to re-rev the design
// foundation. Wraps the existing `sha256` utility from
// `src/lib/design-foundation/scaffold.ts` (re-exported here so the streaming
// pipeline doesn't depend on a deep import path) and adds a `driftScore`
// estimate.
//
// Drift threshold contract: a returned score `> 1` means the foundation
// should be re-revved. The tick-scheduler reads `state.lastFoundationInputsDigest`
// and feeds it here alongside the current input objects.
//
import { sha256 } from '../design-foundation/scaffold.js';

/**
 * Compute a single sha256 digest over palette + typography + breakpoints.
 * The inputs are first JSON-stringified with stable key ordering (via
 * `JSON.stringify` of canonical-keyed values) so two semantically-equal inputs
 * always produce the same digest.
 *
 * Reuses `sha256` from scaffold.ts to keep the digest convention identical.
 */
export function computeInputsDigest(
  palette: unknown,
  typography: unknown,
  breakpoints: unknown,
  computedStyles?: unknown,
): string {
  const canonical = JSON.stringify({
    palette: canonicalize(palette),
    typography: canonicalize(typography),
    breakpoints: canonicalize(breakpoints),
    ...(computedStyles === undefined ? {} : { computedStyles: canonicalize(computedStyles) }),
  });
  return sha256(canonical);
}

/**
 * Estimate how much the foundation inputs have drifted since the previous
 * digest was recorded.
 *
 * Returns:
 *   0  — current inputs hash to `prevDigest` (no change).
 *   2  — current inputs hash differs (above the re-rev threshold).
 *
 * The "count changed top-8 palette entries + font-family changes" part of the
 * contract requires the previous inputs to reconstruct a per-entry diff;
 * because the caller only retains the prior digest string, we collapse the
 * decision to a binary same / different signal at a value (2) that exceeds
 * the documented `> 1` threshold.
 *
 * If the prevDigest is empty (first run), we treat that as "first foundation
 * — please run a tick" and return 2.
 */
export function driftScore(
  prevDigest: string,
  currentInputs: { palette: unknown; typography: unknown; breakpoints: unknown; computedStyles?: unknown },
): number {
  const current = computeInputsDigest(
    currentInputs.palette,
    currentInputs.typography,
    currentInputs.breakpoints,
    currentInputs.computedStyles,
  );
  if (!prevDigest) return 2;
  if (prevDigest === current) return 0;
  return 2;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Recursively sort object keys so two structurally-equal inputs produce the
 * same JSON string. Arrays preserve order — caller is responsible for any
 * domain-level normalization (e.g. ranking palette entries).
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) out[k] = canonicalize(obj[k]);
    return out;
  }
  return value;
}
