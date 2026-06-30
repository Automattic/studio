//
// Block-transform JSONL log
// =========================
// Append-only per-page record of compose-page-blocks runs. Modeled on
// `extraction-log.jsonl` (`ExtractionLog`):
//
//   - First line is a header `{version: 1, createdAt}` — written exactly
//     once when the file is created.
//   - Each subsequent line is one entry record (URL + transformation
//     metadata).
//   - Append-only; never rewrite. Partial lines from interrupted writes
//     are tolerated by the reader (skipped silently).
//
// Used for:
//   1. Idempotency — `liberate_block_transform_apply` checks `findLastTransform`
//      and skips re-applying when the source hasn't changed.
//   2. Audit — answer "was this URL transformed by heuristic or AI? what
//      version of the skill?".
//

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BlockTransformEntry {
  url: string;
  slug: string;
  blocksCount: number;
  transformedAt: string;
  source: 'heuristic' | 'ai';
  warnings: string[];
  composedBy: string;
  /** sha256 over sanitized source HTML (input to the skill). */
  sourceHash: string;
  /** sha256 over emitted block markup. */
  outputHash: string;
}

interface HeaderLine {
  version: 1;
  createdAt: string;
}

const LOG_FILENAME = 'block-transform-log.jsonl';

function logPath(outputDir: string): string {
  return join(outputDir, LOG_FILENAME);
}

/** Ensure the log file exists and starts with a `{version, createdAt}` header. */
function ensureHeader(outputDir: string): void {
  const path = logPath(outputDir);
  if (existsSync(path)) return;
  const header: HeaderLine = {
    version: 1,
    createdAt: new Date().toISOString(),
  };
  // Use writeFileSync for the first line to guarantee a clean start.
  writeFileSync(path, JSON.stringify(header) + '\n');
}

/** Append an entry. Creates the file with a header on first use. */
export function appendTransform(outputDir: string, entry: BlockTransformEntry): void {
  ensureHeader(outputDir);
  appendFileSync(logPath(outputDir), JSON.stringify(entry) + '\n');
}

/**
 * Return the most-recent entry for a URL, or `null` if the URL hasn't been
 * transformed yet. Partial / corrupt JSON lines are skipped silently — this
 * matches `ExtractionLog.getProcessedUrls`'s tolerant scan.
 */
export function findLastTransform(
  outputDir: string,
  url: string,
): BlockTransformEntry | null {
  const path = logPath(outputDir);
  if (!existsSync(path)) return null;

  const content = readFileSync(path, 'utf8');
  let last: BlockTransformEntry | null = null;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      // Skip the header row.
      if (parsed.version !== undefined && parsed.url === undefined) continue;
      if (typeof parsed.url !== 'string') continue;
      if (parsed.url !== url) continue;
      // Loose runtime shape — trust the writer. We coerce because the
      // file lives next to user code that may have been written by an
      // earlier schema version.
      last = parsed as unknown as BlockTransformEntry;
    } catch {
      // Skip incomplete/corrupt lines (Ctrl+C during write).
    }
  }
  return last;
}

/** List all URLs that have at least one logged transformation. */
export function listTransformedUrls(outputDir: string): Set<string> {
  const path = logPath(outputDir);
  const urls = new Set<string>();
  if (!existsSync(path)) return urls;

  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.version !== undefined && parsed.url === undefined) continue;
      if (typeof parsed.url === 'string') urls.add(parsed.url);
    } catch {
      // Skip corrupt lines.
    }
  }
  return urls;
}
