import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PendingImportsBuffer } from './pending-imports.js';
import type { PageItem } from '../wxr/index.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function tmp(): string {
  return mkdtempSync(join(FIXTURE_TMP, 'pi-'));
}

function makePage(overrides: Partial<PageItem> = {}): PageItem {
  return {
    id: 1,
    type: 'page',
    title: 'About',
    slug: 'about',
    content: '<p>About us</p>',
    excerpt: '',
    date: '2026-04-29T12:00:00.000Z',
    parent: 0,
    menuOrder: 0,
    author: 'admin',
    seoTitle: '',
    seoDescription: '',
    sourceUrl: 'https://example.com/about',
    ...overrides,
  };
}

describe('PendingImportsBuffer', () => {
  it('writes a header on first enqueue', () => {
    const dir = tmp();
    const buf = new PendingImportsBuffer(dir);
    buf.enqueue({ url: 'https://example.com/a', archetype: 'page', slug: 'a', payload: makePage() });
    const lines = readFileSync(join(dir, 'pending-imports.jsonl'), 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
    const header = JSON.parse(lines[0]);
    expect(header.version).toBe(1);
    expect(typeof header.createdAt).toBe('string');
  });

  it('listPending returns nothing when the file does not exist', () => {
    const dir = tmp();
    const buf = new PendingImportsBuffer(dir);
    expect(buf.listPending()).toEqual([]);
    expect(existsSync(join(dir, 'pending-imports.jsonl'))).toBe(false);
  });

  it('returns queued URLs in queued-at order', async () => {
    const dir = tmp();
    const buf = new PendingImportsBuffer(dir);
    buf.enqueue({ url: 'https://example.com/a', archetype: 'page', slug: 'a', payload: makePage({ slug: 'a' }) });
    // Wait a millisecond so timestamps differ.
    await new Promise((r) => setTimeout(r, 2));
    buf.enqueue({ url: 'https://example.com/b', archetype: 'page', slug: 'b', payload: makePage({ slug: 'b' }) });
    const pending = buf.listPending();
    expect(pending.map((p) => p.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('markImported removes a URL from listPending', () => {
    const dir = tmp();
    const buf = new PendingImportsBuffer(dir);
    buf.enqueue({ url: 'https://example.com/a', archetype: 'page', slug: 'a', payload: makePage() });
    expect(buf.size()).toBe(1);
    buf.markImported({ url: 'https://example.com/a', postId: 42, action: 'inserted', composedAs: 'raw-html' });
    expect(buf.size()).toBe(0);
    expect(buf.listPending()).toEqual([]);
  });

  it('re-enqueueing after an imported entry makes the URL pending again', () => {
    const dir = tmp();
    const buf = new PendingImportsBuffer(dir);
    buf.enqueue({ url: 'https://example.com/a', archetype: 'page', slug: 'a', payload: makePage({ content: '<p>v1</p>' }) });
    buf.markImported({ url: 'https://example.com/a', postId: 1, action: 'inserted', composedAs: 'raw-html' });
    expect(buf.size()).toBe(0);
    buf.enqueue({ url: 'https://example.com/a', archetype: 'page', slug: 'a', payload: makePage({ content: '<p>v2</p>' }) });
    const pending = buf.listPending();
    expect(pending).toHaveLength(1);
    expect((pending[0].payload as PageItem).content).toBe('<p>v2</p>');
  });

  it('latest queued payload wins when a URL is re-enqueued without imported in between', () => {
    const dir = tmp();
    const buf = new PendingImportsBuffer(dir);
    buf.enqueue({ url: 'https://example.com/a', archetype: 'page', slug: 'a', payload: makePage({ content: '<p>v1</p>' }) });
    buf.enqueue({ url: 'https://example.com/a', archetype: 'page', slug: 'a', payload: makePage({ content: '<p>v2</p>' }) });
    const pending = buf.listPending();
    expect(pending).toHaveLength(1);
    expect((pending[0].payload as PageItem).content).toBe('<p>v2</p>');
  });

  it('tolerates corrupt / partial lines mid-file', () => {
    const dir = tmp();
    const buf = new PendingImportsBuffer(dir);
    buf.enqueue({ url: 'https://example.com/a', archetype: 'page', slug: 'a', payload: makePage() });
    appendFileSync(join(dir, 'pending-imports.jsonl'), '{"event":"queued","url":"https://e');
    appendFileSync(join(dir, 'pending-imports.jsonl'), '\n');
    buf.enqueue({ url: 'https://example.com/b', archetype: 'page', slug: 'b', payload: makePage({ slug: 'b' }) });
    const pending = buf.listPending();
    expect(pending.map((p) => p.url).sort()).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('persists queued payloads across new buffer instances (resume)', () => {
    const dir = tmp();
    const buf1 = new PendingImportsBuffer(dir);
    buf1.enqueue({ url: 'https://example.com/a', archetype: 'page', slug: 'a', payload: makePage() });
    buf1.enqueue({ url: 'https://example.com/b', archetype: 'page', slug: 'b', payload: makePage({ slug: 'b' }) });

    const buf2 = new PendingImportsBuffer(dir);
    expect(buf2.size()).toBe(2);
    expect(buf2.listPending().map((p) => p.url).sort()).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });
});
