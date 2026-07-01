import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeThemeFilesDigest,
  emptyState,
  loadReplicateState,
  saveReplicateState,
  type ReplicateState,
} from './replicate-state.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function tmp(): string {
  return mkdtempSync(join(FIXTURE_TMP, 'rs-'));
}

describe('replicate-state', () => {
  it('returns an empty state when the file does not exist', () => {
    const dir = tmp();
    const state = loadReplicateState(dir);
    expect(state.version).toBe(1);
    expect(state.urlsSeen).toBe(0);
    expect(state.archetypesObserved).toEqual([]);
    expect(state.archetypeTemplateMap).toEqual({});
    expect(state.lastThemeFilesDigest).toBe('');
    expect(state.lastFoundationInputsDigest).toBe('');
    expect(state.lastTickAt).toBeNull();
    expect(state.lastTickReason).toBeNull();
  });

  it('round-trips through save + load', () => {
    const dir = tmp();
    const state: ReplicateState = {
      ...emptyState(),
      urlsSeen: 3,
      archetypesObserved: ['homepage', 'page'],
      archetypeTemplateMap: { page: ['templates/page.html'] },
      lastFoundationInputsDigest: 'sha256:abc',
      lastTickAt: '2026-04-29T12:00:00.000Z',
      lastTickReason: 'periodic',
    };
    saveReplicateState(dir, state);
    const loaded = loadReplicateState(dir);
    expect(loaded).toEqual(state);
  });

  it('writes atomically (no .tmp left after save)', () => {
    const dir = tmp();
    saveReplicateState(dir, { ...emptyState(), urlsSeen: 1 });
    const files = readdirSync(dir);
    expect(files).toContain('replicate-state.json');
    expect(files.find((f) => f.endsWith('.tmp'))).toBeUndefined();
  });

  it('quarantines a corrupt file as .corrupt.<ts> and returns empty state', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'replicate-state.json'), '{not valid json');
    const state = loadReplicateState(dir);
    expect(state).toEqual(emptyState());
    const files = readdirSync(dir);
    const corrupt = files.find((f) => f.startsWith('replicate-state.json.corrupt.'));
    expect(corrupt).toBeDefined();
  });

  it('quarantines a wrong-version file', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'replicate-state.json'),
      JSON.stringify({ version: 999, urlsSeen: 0 }),
    );
    const state = loadReplicateState(dir);
    expect(state).toEqual(emptyState());
    const files = readdirSync(dir);
    expect(files.some((f) => f.startsWith('replicate-state.json.corrupt.'))).toBe(true);
  });

  it('quarantines a structurally-invalid file (wrong field types)', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'replicate-state.json'),
      JSON.stringify({ version: 1, urlsSeen: 'three', archetypesObserved: [], archetypeTemplateMap: {}, lastThemeFilesDigest: '', lastFoundationInputsDigest: '', lastTickAt: null, lastTickReason: null }),
    );
    const state = loadReplicateState(dir);
    expect(state).toEqual(emptyState());
  });

  it('creates the parent directory on save', () => {
    const dir = tmp();
    const nested = join(dir, 'nested', 'subdir');
    saveReplicateState(nested, emptyState());
    expect(existsSync(join(nested, 'replicate-state.json'))).toBe(true);
  });

  it('preserves an empty file as corrupt and returns empty state', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'replicate-state.json'), '');
    const state = loadReplicateState(dir);
    expect(state).toEqual(emptyState());
  });
});

describe('computeThemeFilesDigest', () => {
  it('produces a stable sha256 digest', () => {
    const digest = computeThemeFilesDigest([
      { relativePath: 'templates/page.html', content: '<!-- wp:heading -->' },
    ]);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is order-independent (sorts by relativePath)', () => {
    const a = computeThemeFilesDigest([
      { relativePath: 'a.html', content: 'A' },
      { relativePath: 'b.html', content: 'B' },
    ]);
    const b = computeThemeFilesDigest([
      { relativePath: 'b.html', content: 'B' },
      { relativePath: 'a.html', content: 'A' },
    ]);
    expect(a).toBe(b);
  });

  it('changes when a file content changes', () => {
    const a = computeThemeFilesDigest([{ relativePath: 'a.html', content: 'A' }]);
    const b = computeThemeFilesDigest([{ relativePath: 'a.html', content: 'A2' }]);
    expect(a).not.toBe(b);
  });

  it('changes when a new file is added', () => {
    const a = computeThemeFilesDigest([{ relativePath: 'a.html', content: 'A' }]);
    const b = computeThemeFilesDigest([
      { relativePath: 'a.html', content: 'A' },
      { relativePath: 'b.html', content: 'B' },
    ]);
    expect(a).not.toBe(b);
  });

  it('returns a deterministic empty digest for an empty list', () => {
    expect(computeThemeFilesDigest([])).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
