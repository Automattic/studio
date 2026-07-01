import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ExtractionLog } from './extraction-log.js';
import { ImportSession } from './import-session.js';
import { MediaStubStore } from './media-stubs.js';
import { armFault, disarmFault, clearFaults, FaultInjected } from './faultpoint.js';
import { PendingImportsBuffer } from '../streaming/pending-imports.js';
import type { WxrItem } from '../wxr/index.js';

const TMP_ROOT = join(process.cwd(), '.tmp-test', 'crash-recovery');
afterEach(() => clearFaults());

function dir(name: string): string {
  const d = join(TMP_ROOT, name);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

describe('extraction-log crash recovery', () => {
  it('a crash before the dedupe append leaves no partial line and re-processes cleanly', () => {
    const log = new ExtractionLog(dir('extraction-log'));
    log.logProcessed({ url: 'https://x.test/a', slug: 'a', durationMs: 1, qualityScore: 'A' });

    armFault('extraction-log:before-append');
    expect(() =>
      log.logProcessed({ url: 'https://x.test/b', slug: 'b', durationMs: 1, qualityScore: 'A' }),
    ).toThrow(FaultInjected);
    disarmFault('extraction-log:before-append');

    // 'b' never landed; log is uncorrupted and still dedupes 'a'.
    expect([...log.getProcessedUrls()]).toEqual(['https://x.test/a']);

    // Resume: re-process 'b' — now durable, no duplicate of 'a'.
    log.logProcessed({ url: 'https://x.test/b', slug: 'b', durationMs: 1, qualityScore: 'A' });
    expect([...log.getProcessedUrls()].sort()).toEqual(['https://x.test/a', 'https://x.test/b']);
  });
});

describe('import-session crash recovery', () => {
  it('a crash between cursor assign and save keeps the last durable cursor', () => {
    const d = dir('import-session-cursor');
    const s1 = ImportSession.loadOrCreate(d, 'wix', {});
    s1.setCursor('page', 'v1'); // durably saved

    armFault('import-session:cursor-before-save');
    expect(() => s1.setCursor('page', 'v2')).toThrow(FaultInjected);
    disarmFault('import-session:cursor-before-save');

    // Reload from disk (the in-memory v2 is the "lost" crash state).
    const s2 = ImportSession.loadOrCreate(d, 'wix', {}, { resume: true });
    expect(s2.getCursor('page')).toBe('v1');
  });

  it('a crash during save leaves the prior session.json intact (atomic rename)', () => {
    const d = dir('import-session-save');
    const s1 = ImportSession.loadOrCreate(d, 'wix', {});
    s1.setStage('extracting'); // durably saved

    armFault('import-session:before-save');
    expect(() => s1.setStage('finalizing')).toThrow(FaultInjected);
    disarmFault('import-session:before-save');

    const s2 = ImportSession.loadOrCreate(d, 'wix', {}, { resume: true });
    expect(s2.stage).toBe('extracting'); // not the half-written 'finalizing'
  });
});

describe('media-stubs crash recovery', () => {
  it('a crash between tmp-write and rename leaves the live store valid (atomic rename)', () => {
    const d = dir('media-stubs');
    const s1 = MediaStubStore.load(d);
    s1.markSuccess('https://cdn.test/a.jpg', '/a.jpg');
    s1.flush(); // durable: a.jpg success

    armFault('media-stubs:mid-flush');
    s1.markSuccess('https://cdn.test/b.jpg', '/b.jpg'); // buffered (dirty)
    expect(() => s1.flush()).toThrow(FaultInjected);
    disarmFault('media-stubs:mid-flush');

    // The live media-stubs.json must still parse and hold only the durable a.jpg.
    const s2 = MediaStubStore.load(d);
    expect(s2.get('https://cdn.test/a.jpg')?.status).toBe('success');
    expect(s2.get('https://cdn.test/b.jpg')).toBeUndefined();
  });
});

const fakeItem = { title: 'A', content: '<p>a</p>', sourceUrl: 'https://x.test/a' } as unknown as WxrItem;

describe('pending-imports crash recovery (buffer contract)', () => {
  it('a URL stays pending after a simulated crash before markImported, then clears', () => {
    const buf = new PendingImportsBuffer(dir('pending-imports'));
    buf.enqueue({ url: 'https://x.test/a', archetype: 'page', slug: 'a', payload: fakeItem });

    // Simulated crash: installPost "succeeded" but markImported never ran.
    expect(buf.listPending().map((p) => p.url)).toEqual(['https://x.test/a']);

    // Resume flush would call installPost again (idempotent on _source_url),
    // then mark imported — after which the URL is no longer pending.
    buf.markImported({ url: 'https://x.test/a', postId: 7, action: 'inserted' });
    expect(buf.listPending()).toEqual([]);
  });
});
