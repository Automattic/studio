import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ImportSession } from '../src/lib/resume-state/index.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'session-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('ImportSession', () => {
  it('creates a fresh session with captured args', () => {
    const s = ImportSession.loadOrCreate(dir, 'shopify', { token: 'secret', resume: false });
    expect(s.adapter).toBe('shopify');
    expect(s.stage).toBe('initial');
    expect(s.args.token).toBe('secret');
    expect(existsSync(join(dir, 'session.json'))).toBe(true);
  });

  it('setStage transitions and persists', () => {
    const s = ImportSession.loadOrCreate(dir, 'shopify', {});
    s.setStage('extracting');
    expect(s.stage).toBe('extracting');

    const raw = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    expect(raw.stage).toBe('extracting');
  });

  it('error stage records lastError', () => {
    const s = ImportSession.loadOrCreate(dir, 'shopify', {});
    s.setStage('error', 'network timeout');
    const raw = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    expect(raw.stage).toBe('error');
    expect(raw.lastError).toBe('network timeout');
  });

  it('resume loads prior session preserving progress and cursors', () => {
    const first = ImportSession.loadOrCreate(dir, 'shopify', { a: 1 });
    first.bumpProgress('product', 'extracted', 5);
    first.setCursor('shopify:products:endCursor', 'abc123');
    first.save();

    const second = ImportSession.loadOrCreate(dir, 'shopify', { a: 2 }, { resume: true });
    expect(second.getCursor('shopify:products:endCursor')).toBe('abc123');
    expect(second.progress.product.extracted).toBe(5);
    // Caller-supplied args override stored on resume
    expect(second.args.a).toBe(2);
  });

  it('without resume, existing file is preserved as .corrupt backup', () => {
    ImportSession.loadOrCreate(dir, 'shopify', {});
    expect(existsSync(join(dir, 'session.json'))).toBe(true);

    ImportSession.loadOrCreate(dir, 'shopify', {});
    const backups = readdirSync(dir).filter((f) => f.startsWith('session.json.corrupt.'));
    expect(backups.length).toBe(1);
  });

  it('corrupt JSON is preserved as backup, fresh session created', () => {
    writeFileSync(join(dir, 'session.json'), 'not json', 'utf8');
    const s = ImportSession.loadOrCreate(dir, 'shopify', {}, { resume: true });
    expect(s.stage).toBe('initial');
    const backups = readdirSync(dir).filter((f) => f.startsWith('session.json.corrupt.'));
    expect(backups.length).toBe(1);
  });

  it('adapter mismatch on resume creates fresh session', () => {
    ImportSession.loadOrCreate(dir, 'shopify', {});
    const s2 = ImportSession.loadOrCreate(dir, 'wix', {}, { resume: true });
    expect(s2.adapter).toBe('wix');
    expect(s2.stage).toBe('initial');
  });

  it('bumpProgress does not auto-persist; save() does', () => {
    const s = ImportSession.loadOrCreate(dir, 'shopify', {});
    s.bumpProgress('page', 'extracted');
    const beforeSave = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    expect(beforeSave.progress.page?.extracted ?? 0).toBe(0);

    s.save();
    const afterSave = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    expect(afterSave.progress.page.extracted).toBe(1);
  });

  it('setDiscovered seeds entity counts', () => {
    const s = ImportSession.loadOrCreate(dir, 'shopify', {});
    s.setDiscovered({ product: 10, page: 5 });
    expect(s.progress.product.discovered).toBe(10);
    expect(s.progress.page.discovered).toBe(5);
  });

  it('setCursor round-trips arbitrary JSON values', () => {
    const s = ImportSession.loadOrCreate(dir, 'shopify', {});
    s.setCursor('handles', ['a', 'b', 'c']);
    expect(s.getCursor<string[]>('handles')).toEqual(['a', 'b', 'c']);
    s.setCursor('handles', null);
    expect(s.getCursor('handles')).toBeNull();
  });
});
