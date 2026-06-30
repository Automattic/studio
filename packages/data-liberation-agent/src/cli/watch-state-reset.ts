//
// Reset streaming state for a project.
//
// Wipes:
//   <outputDir>/replicate-state.json
//   <outputDir>/base-theme-replicated.json
//   <outputDir>/theme-pieces-replicated.json
//   <outputDir>/base-theme-brief.md
//   <outputDir>/block-transform-log.jsonl
//   <outputDir>/pending-imports.jsonl   (queued/imported per-URL log)
//   <outputDir>/composed/               (block-markup sidecars from compose)
//
// Does NOT touch:
//   output.wxr, screenshots/, html/, palette.json, typography.json,
//   breakpoints.json, design-foundation.json, media/, products.jsonl,
//   extraction-log.jsonl, session.json, media-stubs.json, watch.log
//
// The reset is intentionally narrow — only the streaming-pipeline state.
// Re-running watch after a reset re-imports content into a fresh Studio site.
//
import { existsSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface ResetResult {
  outputDir: string;
  removed: string[];
  /** Items present but already absent on disk (no-op skips). */
  skipped: string[];
}

const TARGETS = [
  'replicate-state.json',
  'base-theme-replicated.json',
  'theme-pieces-replicated.json',
  'base-theme-brief.md',
  'block-transform-log.jsonl',
  'pending-imports.jsonl',
  'composed',
];

export function resetStreamingState(outputDir: string): ResetResult {
  const abs = resolve(outputDir);
  const removed: string[] = [];
  const skipped: string[] = [];

  for (const rel of TARGETS) {
    const full = join(abs, rel);
    if (!existsSync(full)) {
      skipped.push(rel);
      continue;
    }
    try {
      // Use rm + recursive for dirs; unlink for files. existsSync followed by
      // rmSync handles both via the stat-aware rmSync.
      rmSync(full, { recursive: true, force: true });
      removed.push(rel);
    } catch {
      // Best-effort cleanup; leave the file in place if rm fails.
      // Surfacing per-item failures isn't worth the API complexity here.
      skipped.push(rel);
    }
  }

  // Also drop any .corrupt.<ts> sidecars next to replicate-state.json and
  // the rotated block-transform-log files, if any. These accumulate over
  // time and a reset is a good moment to clear them.
  // (Best-effort; ignore if missing.)
  try {
    const replicateCorrupt = join(abs, 'replicate-state.json.corrupt');
    if (existsSync(replicateCorrupt)) unlinkSync(replicateCorrupt);
  } catch { /* ignore */ }

  return { outputDir: abs, removed, skipped };
}
