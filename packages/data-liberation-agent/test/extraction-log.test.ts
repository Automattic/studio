import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ExtractionLog } from '../src/lib/resume-state/index.js';

describe('ExtractionLog', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'log-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('appends entries as JSONL lines', () => {
    const log = new ExtractionLog(tempDir);
    log.logProcessed({ url: 'https://example.com/page1', slug: 'page1', durationMs: 1200, qualityScore: 'high' });
    log.logProcessed({ url: 'https://example.com/page2', slug: 'page2', durationMs: 800, qualityScore: 'medium' });

    const content = readFileSync(join(tempDir, 'extraction-log.jsonl'), 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).url).toBe('https://example.com/page1');
    expect(JSON.parse(lines[0]).type).toBe('processed');
    expect(JSON.parse(lines[1]).qualityScore).toBe('medium');
  });

  it('logs failures', () => {
    const log = new ExtractionLog(tempDir);
    log.logFailed({ url: 'https://example.com/broken', error: 'timeout' });

    const content = readFileSync(join(tempDir, 'extraction-log.jsonl'), 'utf8');
    const entry = JSON.parse(content.trim());
    expect(entry.type).toBe('failed');
    expect(entry.error).toBe('timeout');
  });

  it('reads processed URLs for resume', () => {
    const logPath = join(tempDir, 'extraction-log.jsonl');
    writeFileSync(logPath, [
      JSON.stringify({ type: 'processed', url: 'https://example.com/page1', slug: 'page1' }),
      JSON.stringify({ type: 'failed', url: 'https://example.com/page2', error: 'timeout' }),
      JSON.stringify({ type: 'processed', url: 'https://example.com/page3', slug: 'page3' }),
    ].join('\n') + '\n');

    const log = new ExtractionLog(tempDir);
    const processed = log.getProcessedUrls();
    expect(processed).toEqual(new Set(['https://example.com/page1', 'https://example.com/page3']));
  });

  it('skips incomplete last line on resume', () => {
    const logPath = join(tempDir, 'extraction-log.jsonl');
    writeFileSync(logPath,
      JSON.stringify({ type: 'processed', url: 'https://example.com/page1', slug: 'page1' }) +
      '\n{"type":"processed","url":"https://example.com/page2","slug":"pa'
    );

    const log = new ExtractionLog(tempDir);
    const processed = log.getProcessedUrls();
    expect(processed).toEqual(new Set(['https://example.com/page1']));
  });

  it('returns empty set when no log file exists', () => {
    const log = new ExtractionLog(tempDir);
    const processed = log.getProcessedUrls();
    expect(processed).toEqual(new Set());
  });
});

describe('ExtractionLog lock file', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lock-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('acquires and releases lock', () => {
    const log = new ExtractionLog(tempDir);
    expect(log.acquireLock()).toBe(true);
    log.releaseLock();
  });

  it('rejects if lock already held by running process', () => {
    writeFileSync(join(tempDir, '.liberation-lock'), JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
    const log = new ExtractionLog(tempDir);
    expect(log.acquireLock()).toBe(false);
  });

  it('clears stale lock from dead process', () => {
    writeFileSync(join(tempDir, '.liberation-lock'), JSON.stringify({ pid: 999999, timestamp: Date.now() }));
    const log = new ExtractionLog(tempDir);
    expect(log.acquireLock()).toBe(true);
  });
});
