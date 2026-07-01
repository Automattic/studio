//
// Pending-imports JSONL buffer
// ============================
// Holds extracted URLs that haven't been imported into the running site yet.
// Used by the streaming watch loop: per-URL extraction enqueues a payload,
// then a flush pass — gated on the design foundation being ready (and any
// other agent-side prerequisites) — drains the buffer by calling
// installPost.
//
// File format mirrors block-transform-log.jsonl:
//   - First line is a header `{version: 1, createdAt}` written exactly once.
//   - Each subsequent line is one entry: `queued` or `imported`.
//   - Append-only; never rewrite. Partial / corrupt lines from interrupted
//     writes are tolerated by the reader (skipped silently).
//
// "Pending" semantics: a URL is pending iff its most-recent entry is
// `queued`. listPending() walks the log keeping the latest entry per URL and
// returns those whose final state is `queued`. This means re-enqueueing the
// same URL (e.g. on resume) replaces the prior payload, and a re-import
// after `imported` is allowed if a new `queued` entry is appended.
//
// The buffer is intentionally crash-tolerant rather than transactional. A
// crash between "post installed" and "marked imported in log" leaves the URL
// pending; the next flush re-runs installPost, which is idempotent on
// `_source_url`.
//

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WxrItem } from '../wxr/index.js';

const LOG_FILENAME = 'pending-imports.jsonl';

interface HeaderLine {
  version: 1;
  createdAt: string;
}

interface QueuedEntry {
  event: 'queued';
  url: string;
  archetype: string;
  /** Slug of the post being queued (for sidecar paths, html / screenshots). */
  slug: string;
  payload: WxrItem;
  queuedAt: string;
}

interface ImportedEntry {
  event: 'imported';
  url: string;
  postId: number | null;
  action: 'inserted' | 'updated' | 'error';
  composedAs?: 'blocks' | 'raw-html';
  importedAt: string;
}

type LogEntry = QueuedEntry | ImportedEntry;

export interface PendingImport {
  url: string;
  archetype: string;
  slug: string;
  payload: WxrItem;
  queuedAt: string;
}

function logPath(outputDir: string): string {
  return join(outputDir, LOG_FILENAME);
}

function ensureHeader(outputDir: string): void {
  const path = logPath(outputDir);
  if (existsSync(path)) return;
  const header: HeaderLine = {
    version: 1,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(header) + '\n');
}

function isHeader(parsed: Record<string, unknown>): boolean {
  return parsed.version !== undefined && parsed.event === undefined;
}

/**
 * Append-only buffer of URLs awaiting import. Construct once per outputDir;
 * the underlying file is opened lazily on first append.
 */
export class PendingImportsBuffer {
  constructor(private readonly outputDir: string) {}

  /**
   * Queue one item for later import. Multiple enqueues for the same URL are
   * allowed — the latest queued entry wins until an `imported` entry follows
   * it.
   */
  enqueue(opts: {
    url: string;
    archetype: string;
    slug: string;
    payload: WxrItem;
  }): void {
    ensureHeader(this.outputDir);
    const entry: QueuedEntry = {
      event: 'queued',
      url: opts.url,
      archetype: opts.archetype,
      slug: opts.slug,
      payload: opts.payload,
      queuedAt: new Date().toISOString(),
    };
    appendFileSync(logPath(this.outputDir), JSON.stringify(entry) + '\n');
  }

  /**
   * Mark a URL as imported. Subsequent listPending() calls will not return
   * it unless a new `queued` entry is appended.
   */
  markImported(opts: {
    url: string;
    postId: number | null;
    action: 'inserted' | 'updated' | 'error';
    composedAs?: 'blocks' | 'raw-html';
  }): void {
    ensureHeader(this.outputDir);
    const entry: ImportedEntry = {
      event: 'imported',
      url: opts.url,
      postId: opts.postId,
      action: opts.action,
      composedAs: opts.composedAs,
      importedAt: new Date().toISOString(),
    };
    appendFileSync(logPath(this.outputDir), JSON.stringify(entry) + '\n');
  }

  /**
   * Walk the log, keeping the latest entry per URL. Return URLs whose final
   * state is `queued`, in queued-at order (oldest first). Corrupt / partial
   * lines are skipped silently.
   */
  listPending(): PendingImport[] {
    const path = logPath(this.outputDir);
    if (!existsSync(path)) return [];

    const latest = new Map<string, LogEntry>();
    for (const parsed of readEntries(path)) {
      if (typeof parsed.url !== 'string') continue;
      // Trust-the-writer: the file is owned by this module, so a
      // shape-loose cast is safe. Corrupt lines were already filtered by
      // readEntries.
      latest.set(parsed.url, parsed as unknown as LogEntry);
    }

    const pending: PendingImport[] = [];
    for (const entry of latest.values()) {
      if (entry.event !== 'queued') continue;
      pending.push({
        url: entry.url,
        archetype: entry.archetype,
        slug: entry.slug,
        payload: entry.payload,
        queuedAt: entry.queuedAt,
      });
    }
    pending.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    return pending;
  }

  /** Convenience — number of pending URLs. */
  size(): number {
    return this.listPending().length;
  }
}

function* readEntries(path: string): Iterable<Record<string, unknown>> {
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (isHeader(parsed)) continue;
    yield parsed;
  }
}
