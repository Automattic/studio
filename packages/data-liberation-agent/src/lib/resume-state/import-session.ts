import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { faultpoint } from './faultpoint.js';

/**
 * Pipeline stage.
 *
 *   initial ──▶ discovering ──▶ extracting ──▶ downloading-media ──┐
 *                                                                   │
 *                            ┌──────────────────────────────────────┘
 *                            │
 *                            ▼
 *       (if --screenshots:) screenshotting ──┐
 *                                             │
 *                            ┌────────────────┘
 *                            │
 *                            ▼
 *                       finalizing ──▶ complete
 *
 *   error can be set from any stage.
 */
export type ImportStage =
  | 'initial'
  | 'discovering'
  | 'extracting'
  | 'downloading-media'
  | 'screenshotting'
  | 'finalizing'
  | 'complete'
  | 'error';

export interface EntityProgress {
  discovered: number;
  extracted: number;
  failed: number;
}

interface SessionData {
  version: 1;
  adapter: string;
  stage: ImportStage;
  startedAt: string;
  updatedAt: string;
  /** Original opts/args — lets `resume` re-run without re-passing flags */
  args: Record<string, unknown>;
  /** Per-entity-type counts (product, post, page, ...) */
  progress: Record<string, EntityProgress>;
  /** Adapter scratchpad for pagination cursors (e.g. GraphQL endCursor per query) */
  cursors: Record<string, unknown>;
  /** Last error message if stage === 'error' */
  lastError?: string;
}

interface LoadOpts {
  /** If false, any existing session is discarded and a fresh one is created. */
  resume?: boolean;
}

/**
 * Higher-level resume state for an import run. Sits alongside `ExtractionLog`
 * (which handles atomic URL-level dedupe) and tracks stage, original args,
 * per-entity counts, and pagination cursors.
 *
 * Persisted to `<outputDir>/session.json` via atomic rename.
 *
 * **Multi-process safety:** This class is single-writer by design. The
 * callers (`mcp-server.ts` and `ui/discover.tsx`) acquire `ExtractionLog`'s
 * `.liberation-lock` file for the full extraction lifetime, which covers
 * every session.json mutation. Do not read or write session.json from
 * outside that lock.
 */
export class ImportSession {
  readonly sessionPath: string;
  private data: SessionData;

  private constructor(sessionPath: string, data: SessionData) {
    this.sessionPath = sessionPath;
    this.data = data;
  }

  /**
   * Read the platform adapter recorded by a prior run's session.json WITHOUT
   * creating or mutating a session. Returns null when no valid session exists.
   * Lets later stages (e.g. reconstruction) reuse the platform detected at
   * extraction time instead of re-detecting over the network.
   */
  static readAdapter(outputDir: string): string | null {
    const sessionPath = join(outputDir, 'session.json');
    if (!existsSync(sessionPath)) return null;
    try {
      const loaded = JSON.parse(readFileSync(sessionPath, 'utf8')) as Partial<SessionData>;
      return loaded.version === 1 && typeof loaded.adapter === 'string' ? loaded.adapter : null;
    } catch {
      return null;
    }
  }

  static loadOrCreate(
    outputDir: string,
    adapter: string,
    args: Record<string, unknown>,
    { resume = false }: LoadOpts = {},
  ): ImportSession {
    const sessionPath = join(outputDir, 'session.json');

    if (resume && existsSync(sessionPath)) {
      try {
        const loaded = JSON.parse(readFileSync(sessionPath, 'utf8')) as SessionData;
        if (loaded.version === 1 && loaded.adapter === adapter) {
          const session = new ImportSession(sessionPath, loaded);
          // Merge in any new args the caller provided this run — caller wins
          session.data.args = { ...loaded.args, ...args };
          return session;
        }
      } catch {
        // corrupt session file — fall through to fresh
      }
    }

    // Fresh start — if a file exists, preserve it as a timestamped backup
    // rather than silently deleting. Protects against corrupt-parse → wipe.
    if (existsSync(sessionPath)) {
      try {
        const backup = `${sessionPath}.corrupt.${Date.now()}`;
        renameSync(sessionPath, backup);
      } catch {
        try { unlinkSync(sessionPath); } catch { /* ignore */ }
      }
    }

    const now = new Date().toISOString();
    const data: SessionData = {
      version: 1,
      adapter,
      stage: 'initial',
      startedAt: now,
      updatedAt: now,
      args,
      progress: {},
      cursors: {},
    };
    const session = new ImportSession(sessionPath, data);
    session.save();
    return session;
  }

  get stage(): ImportStage { return this.data.stage; }
  get adapter(): string { return this.data.adapter; }
  get args(): Record<string, unknown> { return this.data.args; }
  get progress(): Record<string, EntityProgress> { return this.data.progress; }

  setStage(stage: ImportStage, error?: string): void {
    this.data.stage = stage;
    if (stage === 'error' && error) {
      this.data.lastError = error;
    }
    this.save();
  }

  getEntity(type: string): EntityProgress {
    let p = this.data.progress[type];
    if (!p) {
      p = { discovered: 0, extracted: 0, failed: 0 };
      this.data.progress[type] = p;
    }
    return p;
  }

  /**
   * Increment a progress counter. Does NOT persist — callers should invoke
   * `save()` at checkpoint points (e.g. every N items, on stage change).
   * Keeping the hot loop out of fsync keeps overhead negligible.
   */
  bumpProgress(type: string, field: keyof EntityProgress, n = 1): void {
    this.getEntity(type)[field] += n;
  }

  setDiscovered(counts: Record<string, number>): void {
    for (const [type, count] of Object.entries(counts)) {
      this.getEntity(type).discovered = count;
    }
    this.save();
  }

  setCursor(key: string, value: unknown): void {
    this.data.cursors[key] = value;
    faultpoint('import-session:cursor-before-save');
    this.save();
  }

  getCursor<T = unknown>(key: string): T | undefined {
    return this.data.cursors[key] as T | undefined;
  }

  save(): void {
    this.data.updatedAt = new Date().toISOString();
    mkdirSync(dirname(this.sessionPath), { recursive: true });
    const tmp = this.sessionPath + '.tmp';
    faultpoint('import-session:before-save');
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.sessionPath);
  }

  complete(): void { this.setStage('complete'); }
}
