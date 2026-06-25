import { appendFileSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { faultpoint } from './faultpoint.js';

export interface ProcessedEntry {
  url: string;
  slug: string;
  durationMs: number;
  qualityScore: string;
}

export interface FailedEntry {
  url: string;
  error: string;
}

export interface MediaEntry {
  url: string;
  localPath?: string | null;
  error?: string | null;
}

export interface LogSummary {
  processed: unknown[];
  failed: unknown[];
  mediaDownloaded: unknown[];
  mediaFailed: unknown[];
}

interface LockFile {
  pid: number;
  timestamp: number;
}

export class ExtractionLog {
  outputDir: string;
  logPath: string;
  lockPath: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    this.logPath = join(outputDir, 'extraction-log.jsonl');
    this.lockPath = join(outputDir, '.liberation-lock');
  }

  logProcessed(entry: ProcessedEntry): void {
    const line = JSON.stringify({
      type: 'processed',
      url: entry.url,
      slug: entry.slug,
      durationMs: entry.durationMs,
      qualityScore: entry.qualityScore,
      timestamp: new Date().toISOString(),
    });
    faultpoint('extraction-log:before-append');
    appendFileSync(this.logPath, line + '\n');
  }

  logFailed(entry: FailedEntry): void {
    const line = JSON.stringify({
      type: 'failed',
      url: entry.url,
      error: entry.error,
      timestamp: new Date().toISOString(),
    });
    appendFileSync(this.logPath, line + '\n');
  }

  logMedia(entry: MediaEntry): void {
    const line = JSON.stringify({
      type: entry.error ? 'media_failed' : 'media_downloaded',
      url: entry.url,
      localPath: entry.localPath || null,
      error: entry.error || null,
      timestamp: new Date().toISOString(),
    });
    appendFileSync(this.logPath, line + '\n');
  }

  getProcessedUrls(): Set<string> {
    const urls = new Set<string>();
    if (!existsSync(this.logPath)) return urls;

    const content = readFileSync(this.logPath, 'utf8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { type: string; url: string };
        if (entry.type === 'processed') {
          urls.add(entry.url);
        }
      } catch {
        // Incomplete line (Ctrl+C during write) — skip
      }
    }

    return urls;
  }

  getSummary(): LogSummary {
    const processed: unknown[] = [];
    const failed: unknown[] = [];
    const mediaDownloaded: unknown[] = [];
    const mediaFailed: unknown[] = [];

    if (!existsSync(this.logPath)) {
      return { processed, failed, mediaDownloaded, mediaFailed };
    }

    const content = readFileSync(this.logPath, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { type: string };
        switch (entry.type) {
          case 'processed': processed.push(entry); break;
          case 'failed': failed.push(entry); break;
          case 'media_downloaded': mediaDownloaded.push(entry); break;
          case 'media_failed': mediaFailed.push(entry); break;
        }
      } catch { /* skip incomplete lines */ }
    }

    return { processed, failed, mediaDownloaded, mediaFailed };
  }

  acquireLock(): boolean {
    if (existsSync(this.lockPath)) {
      try {
        const lock = JSON.parse(readFileSync(this.lockPath, 'utf8')) as LockFile;
        try {
          process.kill(lock.pid, 0);
          return false;
        } catch {
          unlinkSync(this.lockPath);
        }
      } catch {
        unlinkSync(this.lockPath);
      }
    }

    writeFileSync(this.lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
    return true;
  }

  releaseLock(): void {
    try { unlinkSync(this.lockPath); } catch {}
  }

  isLockActive(): boolean {
    if (!existsSync(this.lockPath)) return false;
    try {
      const lock = JSON.parse(readFileSync(this.lockPath, 'utf8')) as LockFile;
      try {
        process.kill(lock.pid, 0);
        return true; // PID is running — lock is active
      } catch {
        return false; // PID dead — stale lock
      }
    } catch {
      return false; // Corrupt lock file
    }
  }
}
