import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManifestQueue } from './manifest-queue.js';
import type { DismissedOverlay } from './page-helpers.js';

describe('ManifestQueue', () => {
  it('serializes concurrent updates deterministically', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mq-'));
    try {
      const q = new ManifestQueue(join(dir, 'manifest.json'));
      await q.init();
      await Promise.all([
        q.updateEntry('https://a.com/1', { slug: 'one', capturedAt: '2025-01-01' }),
        q.updateEntry('https://a.com/2', { slug: 'two', capturedAt: '2025-01-01' }),
        q.updateEntry('https://a.com/3', { slug: 'three', capturedAt: '2025-01-01' }),
      ]);
      await q.flush();
      const data = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      expect(data.version).toBe(1);
      expect(Object.keys(data.entries)).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes atomically via tmp + rename (no .tmp file left)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mq-'));
    try {
      const q = new ManifestQueue(join(dir, 'manifest.json'));
      await q.init();
      await q.updateEntry('https://a.com/1', { slug: 'one', capturedAt: '2025-01-01' });
      await q.flush();
      expect(existsSync(join(dir, 'manifest.json.tmp'))).toBe(false);
      expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records failures and writes to failures.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mq-'));
    try {
      const q = new ManifestQueue(join(dir, 'manifest.json'));
      await q.init();
      await q.recordFailure({ url: 'https://a.com/x', viewport: 'desktop', stage: 'goto', error: 'timeout', timestamp: '2025-01-01', attempt: 1 });
      await q.recordFailure({ url: 'https://a.com/y', viewport: 'mobile', stage: 'screenshot-fullpage', error: 'oom', timestamp: '2025-01-01', attempt: 1 });
      await q.flush();
      const fails = JSON.parse(readFileSync(join(dir, 'failures.json'), 'utf8'));
      expect(fails).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('claimSlug appends -2, -3 on collision', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mq-'));
    try {
      const q = new ManifestQueue(join(dir, 'manifest.json'));
      await q.init();
      expect(await q.claimSlug('about')).toBe('about');
      expect(await q.claimSlug('about')).toBe('about-2');
      expect(await q.claimSlug('about')).toBe('about-3');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resetFailures wipes failures in-memory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mq-'));
    try {
      const q = new ManifestQueue(join(dir, 'manifest.json'));
      await q.init();
      await q.recordFailure({ url: 'https://a.com/x', viewport: 'desktop', stage: 'goto', error: 'x', timestamp: '2025-01-01', attempt: 1 });
      await q.resetFailures();
      await q.flush();
      // failures.json should not be written when empty
      expect(existsSync(join(dir, 'failures.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads existing manifest on init', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mq-'));
    try {
      const q1 = new ManifestQueue(join(dir, 'manifest.json'));
      await q1.init();
      await q1.updateEntry('https://a.com/1', { slug: 'one', capturedAt: '2025-01-01' });
      await q1.flush();

      const q2 = new ManifestQueue(join(dir, 'manifest.json'));
      await q2.init();
      await q2.updateEntry('https://a.com/2', { slug: 'two', capturedAt: '2025-01-02' });
      await q2.flush();

      const data = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      expect(Object.keys(data.entries)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips a dismissed[] on a manifest entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mq-dismissed-'));
    try {
      const q = new ManifestQueue(join(dir, 'manifest.json'));
      await q.init();
      const dismissed: DismissedOverlay[] = [
        { selector: 'div.popup', method: 'close-click', kind: 'takeover', score: 11, signals: ['dialog', 'scroll-lock'] },
      ];
      await q.updateEntry('https://example.test/', { slug: 'home', capturedAt: 't', dismissed });
      await q.flush();
      const parsed = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      expect(parsed.entries['https://example.test/'].dismissed[0].method).toBe('close-click');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
