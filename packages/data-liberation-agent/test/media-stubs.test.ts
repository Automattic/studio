import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MediaStubStore } from '../src/lib/resume-state/index.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'stubs-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('MediaStubStore', () => {
  it('shouldAttempt returns true for unknown URL', () => {
    const store = MediaStubStore.load(dir);
    expect(store.shouldAttempt('https://cdn.example.com/a.jpg')).toBe(true);
  });

  it('markSuccess persists immediately on explicit save/flush', () => {
    const store = MediaStubStore.load(dir);
    store.markSuccess('https://cdn.example.com/a.jpg', '/tmp/a.jpg');
    // Success is buffered in memory
    expect(existsSync(join(dir, 'media-stubs.json'))).toBe(false);
    store.flush();
    expect(existsSync(join(dir, 'media-stubs.json'))).toBe(true);
  });

  it('markFailure persists immediately without flush', () => {
    const store = MediaStubStore.load(dir);
    store.markFailure('https://cdn.example.com/bad.jpg', 'HTTP 404');
    // Failures flush synchronously to preserve attempt counts across crashes
    const raw = JSON.parse(readFileSync(join(dir, 'media-stubs.json'), 'utf8'));
    expect(raw.stubs['https://cdn.example.com/bad.jpg'].status).toBe('error');
    expect(raw.stubs['https://cdn.example.com/bad.jpg'].attempts).toBe(1);
  });

  it('stops attempting after maxAttempts failures', () => {
    const store = MediaStubStore.load(dir, { maxAttempts: 2 });
    const url = 'https://cdn.example.com/bad.jpg';
    store.markFailure(url, 'x');
    expect(store.shouldAttempt(url)).toBe(true);
    store.markFailure(url, 'x');
    expect(store.shouldAttempt(url)).toBe(false);
  });

  it('success is final — no more attempts', () => {
    const store = MediaStubStore.load(dir);
    const url = 'https://cdn.example.com/a.jpg';
    store.markSuccess(url, '/tmp/a.jpg');
    store.flush();
    expect(store.shouldAttempt(url)).toBe(false);
  });

  it('ignored status is final', () => {
    const store = MediaStubStore.load(dir);
    const url = 'https://cdn.example.com/a.jpg';
    store.markIgnored(url, 'user override');
    expect(store.shouldAttempt(url)).toBe(false);
  });

  it('counts() reports each status bucket', () => {
    const store = MediaStubStore.load(dir);
    store.markSuccess('https://cdn.example.com/a.jpg', '/tmp/a.jpg');
    store.markFailure('https://cdn.example.com/b.jpg', 'err');
    store.markIgnored('https://cdn.example.com/c.jpg');
    store.flush();

    const c = store.counts();
    expect(c.success).toBe(1);
    expect(c.error).toBe(1);
    expect(c.ignored).toBe(1);
    expect(c.awaiting).toBe(0);
  });

  it('load reads back persisted state', () => {
    const store1 = MediaStubStore.load(dir);
    store1.markSuccess('https://cdn.example.com/a.jpg', '/tmp/a.jpg');
    store1.flush();

    const store2 = MediaStubStore.load(dir);
    expect(store2.get('https://cdn.example.com/a.jpg')?.status).toBe('success');
    expect(store2.shouldAttempt('https://cdn.example.com/a.jpg')).toBe(false);
  });

  it('tolerates corrupt store file by starting fresh', () => {
    writeFileSync(join(dir, 'media-stubs.json'), 'not json', 'utf8');
    const store = MediaStubStore.load(dir);
    expect(store.shouldAttempt('https://cdn.example.com/a.jpg')).toBe(true);
  });
});
