//
// Replicate state file
// ====================
// Per-outputDir JSON state for the streaming replicate loop. Tracks how many
// URLs the streaming pipeline has observed, which archetypes have been seen
// (and which template/pattern files were applied to each), the digests of the
// last theme files + foundation inputs that were applied, and metadata about
// the last tick.
//
// File path: `<outputDir>/replicate-state.json`
//
// Persistence model:
//   - Single-writer atomic rename (write `.tmp` then rename over the target).
//   - Corrupt files are renamed to `replicate-state.json.corrupt.<ts>` rather
//     than silently dropped — mirrors `ImportSession`.
//   - `version: 1` is the current contract; consumers must pin.
//
// Lock semantics: callers are responsible for serializing writes. The streaming
// engine's lockfile (in `src/lib/preview/lockfile.ts`) is used for the full
// tick scope; this module does not acquire locks itself.
//
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export interface ReplicateState {
  version: 1;
  /** Number of URLs the streaming pipeline has observed (monotonic). */
  urlsSeen: number;
  /** Sorted unique list of archetypes (e.g. ['homepage', 'page', 'product']). */
  archetypesObserved: string[];
  /**
   * Map archetype → list of theme files that were applied for that archetype
   * (e.g. `{'product': ['templates/single-product.html', 'patterns/product-card.php']}`).
   */
  archetypeTemplateMap: Partial<Record<string, string[]>>;
  /** sha256 digest over the canonical JSON of the last applied theme files. */
  lastThemeFilesDigest: string;
  /** Last applied design-foundation inputsDigest (palette+typography+breakpoints). */
  lastFoundationInputsDigest: string;
  /** ISO timestamp of the last tick that ran (or null if none yet). */
  lastTickAt: string | null;
  /** Reason of the last tick (e.g. 'periodic', 'new-archetype'). */
  lastTickReason: string | null;
}

const STATE_FILENAME = 'replicate-state.json';

/**
 * Construct an empty `version: 1` state. Used when no state file exists or the
 * existing file is corrupt / wrong-version.
 */
export function emptyState(): ReplicateState {
  return {
    version: 1,
    urlsSeen: 0,
    archetypesObserved: [],
    archetypeTemplateMap: {},
    lastThemeFilesDigest: '',
    lastFoundationInputsDigest: '',
    lastTickAt: null,
    lastTickReason: null,
  };
}

function statePath(outputDir: string): string {
  return join(outputDir, STATE_FILENAME);
}

/**
 * Read the replicate state from disk. Missing → empty state. Corrupt or
 * wrong-version → preserve original as `.corrupt.<ts>` and return empty.
 */
export function loadReplicateState(outputDir: string): ReplicateState {
  const p = statePath(outputDir);
  if (!existsSync(p)) return emptyState();

  let raw: string;
  try {
    raw = readFileSync(p, 'utf8');
  } catch {
    return emptyState();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantine(p);
    return emptyState();
  }

  if (!isReplicateState(parsed)) {
    quarantine(p);
    return emptyState();
  }
  return parsed;
}

/**
 * Write the replicate state atomically. Caller owns serialization (lock).
 */
export function saveReplicateState(outputDir: string, state: ReplicateState): void {
  const p = statePath(outputDir);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, p);
}

/**
 * Compute sha256 over the canonical JSON of theme files. Files are sorted by
 * `relativePath` so the digest is stable across reorderings.
 */
export function computeThemeFilesDigest(
  files: Array<{ relativePath: string; content: string }>,
): string {
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const canonical = JSON.stringify(
    sorted.map((f) => ({ relativePath: f.relativePath, content: f.content })),
  );
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex');
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function quarantine(p: string): void {
  // Preserve the corrupt file as .corrupt.<ts>; if rename fails, drop it as a
  // last resort rather than leaving an unparseable file in place that future
  // loads will keep failing on.
  try {
    const backup = `${p}.corrupt.${Date.now()}`;
    renameSync(p, backup);
  } catch {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

function isReplicateState(value: unknown): value is ReplicateState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.urlsSeen !== 'number') return false;
  if (!Array.isArray(v.archetypesObserved)) return false;
  if (!v.archetypesObserved.every((x) => typeof x === 'string')) return false;
  if (typeof v.archetypeTemplateMap !== 'object' || v.archetypeTemplateMap === null) return false;
  if (typeof v.lastThemeFilesDigest !== 'string') return false;
  if (typeof v.lastFoundationInputsDigest !== 'string') return false;
  if (v.lastTickAt !== null && typeof v.lastTickAt !== 'string') return false;
  if (v.lastTickReason !== null && typeof v.lastTickReason !== 'string') return false;
  return true;
}
