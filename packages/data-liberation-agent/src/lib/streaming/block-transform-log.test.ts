import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendTransform,
  findLastTransform,
  listTransformedUrls,
  type BlockTransformEntry,
} from './block-transform-log.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function makeEntry(overrides: Partial<BlockTransformEntry> = {}): BlockTransformEntry {
  return {
    url: 'https://example.com/about',
    slug: 'about',
    blocksCount: 3,
    transformedAt: '2026-04-29T12:00:00.000Z',
    source: 'heuristic',
    warnings: [],
    composedBy: 'compose-page-blocks@v1.0',
    sourceHash: 'sha256:aaa',
    outputHash: 'sha256:bbb',
    ...overrides,
  };
}

describe('block-transform-log', () => {
  it('writes a header on first append and the entry below it', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'btl-'));
    appendTransform(dir, makeEntry());
    const lines = readFileSync(join(dir, 'block-transform-log.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines.length).toBe(2);
    const header = JSON.parse(lines[0]);
    expect(header.version).toBe(1);
    expect(typeof header.createdAt).toBe('string');
    const entry = JSON.parse(lines[1]);
    expect(entry.url).toBe('https://example.com/about');
    expect(entry.source).toBe('heuristic');
  });

  it('does not rewrite the header on subsequent appends', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'btl-'));
    appendTransform(dir, makeEntry({ url: 'https://example.com/a' }));
    const headerAfterFirst = readFileSync(join(dir, 'block-transform-log.jsonl'), 'utf8').split('\n')[0];
    appendTransform(dir, makeEntry({ url: 'https://example.com/b' }));
    appendTransform(dir, makeEntry({ url: 'https://example.com/c' }));
    const headerAfterMultiple = readFileSync(join(dir, 'block-transform-log.jsonl'), 'utf8').split('\n')[0];
    expect(headerAfterMultiple).toBe(headerAfterFirst);
  });

  it('returns the most-recent entry for a URL via findLastTransform', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'btl-'));
    appendTransform(dir, makeEntry({ url: 'https://example.com/a', sourceHash: 'sha256:1' }));
    appendTransform(dir, makeEntry({ url: 'https://example.com/b', sourceHash: 'sha256:2' }));
    appendTransform(dir, makeEntry({ url: 'https://example.com/a', sourceHash: 'sha256:3' }));
    const last = findLastTransform(dir, 'https://example.com/a');
    expect(last?.sourceHash).toBe('sha256:3');
    const other = findLastTransform(dir, 'https://example.com/b');
    expect(other?.sourceHash).toBe('sha256:2');
  });

  it('returns null when the file does not exist', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'btl-'));
    expect(findLastTransform(dir, 'https://example.com/missing')).toBeNull();
    expect(existsSync(join(dir, 'block-transform-log.jsonl'))).toBe(false);
  });

  it('returns null for a URL not in the log', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'btl-'));
    appendTransform(dir, makeEntry({ url: 'https://example.com/a' }));
    expect(findLastTransform(dir, 'https://example.com/missing')).toBeNull();
  });

  it('tolerates corrupt / partial lines in the middle of the file', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'btl-'));
    appendTransform(dir, makeEntry({ url: 'https://example.com/a' }));
    // Simulate a Ctrl+C in the middle of a line.
    appendFileSync(join(dir, 'block-transform-log.jsonl'), '{"url":"https://e');
    appendFileSync(join(dir, 'block-transform-log.jsonl'), '\n');
    appendTransform(dir, makeEntry({ url: 'https://example.com/b' }));
    expect(findLastTransform(dir, 'https://example.com/a')?.url).toBe('https://example.com/a');
    expect(findLastTransform(dir, 'https://example.com/b')?.url).toBe('https://example.com/b');
  });

  it('listTransformedUrls returns all unique URLs', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'btl-'));
    appendTransform(dir, makeEntry({ url: 'https://example.com/a' }));
    appendTransform(dir, makeEntry({ url: 'https://example.com/b' }));
    appendTransform(dir, makeEntry({ url: 'https://example.com/a' }));
    const urls = listTransformedUrls(dir);
    expect(urls.size).toBe(2);
    expect(urls.has('https://example.com/a')).toBe(true);
    expect(urls.has('https://example.com/b')).toBe(true);
  });

  it('idempotency — caller can decide to skip re-applying via sourceHash compare', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'btl-'));
    const url = 'https://example.com/about';
    appendTransform(dir, makeEntry({ url, sourceHash: 'h1' }));
    const last = findLastTransform(dir, url);
    expect(last?.sourceHash).toBe('h1');
    // Caller would: if (last && last.sourceHash === currentHash) return skip;
  });
});
