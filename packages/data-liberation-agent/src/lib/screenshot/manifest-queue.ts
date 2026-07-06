import { writeFileSync, renameSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DismissedOverlay } from './page-helpers.js';

export interface ManifestEntry {
  slug: string;
  desktop?: string;          // path to screenshots/desktop/<slug>.png
  desktopScrolled?: string;  // path to scrolled variant
  mobile?: string;
  mobileScrolled?: string;
  html?: string;
  /** path to sections/<slug>.json (captured section specs) when present */
  sections?: string;
  /** Overlays/banners dismissed before this URL was captured (observability). */
  dismissed?: DismissedOverlay[];
  capturedAt: string;
  /** Populated by site-analysis; may be absent */
  metadata?: {
    title?: string;
    metaDescription?: string;
    openGraph?: Record<string, string>;
    jsonLdTypes?: string[];
    htmlBytes?: number;
  };
}

export interface FailureEntry {
  url: string;
  viewport: string;
  stage: 'goto' | 'content' | 'screenshot-fullpage' | 'screenshot-scrolled' | 'screenshot-timeout' | 'evaluate';
  error: string;
  timestamp: string;
  attempt: number;
}

interface ManifestFile {
  version: 1;
  entries: Record<string, ManifestEntry>;
}

/**
 * Serializes concurrent writes to manifest.json, failures.json, and the slug
 * collision map. Uses a single promise chain so operations are ordered.
 * Atomic writes via tmp + rename.
 */
export class ManifestQueue {
  private chain: Promise<void> = Promise.resolve();
  private manifest: ManifestFile = { version: 1, entries: {} };
  private failures: FailureEntry[] = [];
  private slugSeen = new Map<string, number>();
  private manifestPath: string;
  private failuresPath: string;

  constructor(manifestPath: string) {
    this.manifestPath = manifestPath;
    this.failuresPath = join(dirname(manifestPath), 'failures.json');
  }

  async init(): Promise<void> {
    mkdirSync(dirname(this.manifestPath), { recursive: true });
    if (existsSync(this.manifestPath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.manifestPath, 'utf8')) as ManifestFile;
        if (parsed.version === 1 && parsed.entries) {
          this.manifest = parsed;
          for (const e of Object.values(parsed.entries)) {
            const base = e.slug.replace(/-\d+$/, '');
            this.slugSeen.set(base, (this.slugSeen.get(base) ?? 0) + 1);
          }
        }
      } catch { /* corrupt — start fresh */ }
    }
    if (existsSync(this.failuresPath)) {
      try {
        this.failures = JSON.parse(readFileSync(this.failuresPath, 'utf8')) as FailureEntry[];
      } catch { this.failures = []; }
    }
  }

  updateEntry(url: string, entry: ManifestEntry): Promise<void> {
    const p = this.chain.then(() => {
      const prior = this.manifest.entries[url] ?? {} as ManifestEntry;
      this.manifest.entries[url] = { ...prior, ...entry };
    });
    this.chain = p;
    return p;
  }

  recordFailure(f: FailureEntry): Promise<void> {
    const p = this.chain.then(() => {
      this.failures.push(f);
    });
    this.chain = p;
    return p;
  }

  /** Lookup an existing entry by URL (used to reuse slug on resume). */
  getEntry(url: string): ManifestEntry | undefined {
    return this.manifest.entries[url];
  }

  /** Claim a slug through the serialization chain. */
  claimSlug(base: string): Promise<string> {
    let result: string = base;
    const p = this.chain.then(() => {
      const existing = this.slugSeen.get(base);
      if (existing === undefined) {
        this.slugSeen.set(base, 1);
        result = base;
      } else {
        const next = existing + 1;
        this.slugSeen.set(base, next);
        result = `${base}-${next}`;
      }
    });
    this.chain = p;
    return p.then(() => result);
  }

  /** Force all queued ops through, then write atomically. */
  async flush(): Promise<void> {
    await this.chain;
    this._writeAtomic(this.manifestPath, JSON.stringify(this.manifest, null, 2));
    if (this.failures.length > 0) {
      this._writeAtomic(this.failuresPath, JSON.stringify(this.failures, null, 2));
    }
  }

  /** Wipe failures on --force. */
  resetFailures(): Promise<void> {
    const p = this.chain.then(() => {
      this.failures = [];
    });
    this.chain = p;
    return p;
  }

  private _writeAtomic(path: string, content: string): void {
    const tmp = path + '.tmp';
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  }
}
