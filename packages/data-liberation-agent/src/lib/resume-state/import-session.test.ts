import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImportSession } from './import-session.js';

describe('ImportSession new stages', () => {
  it('accepts the new screenshotting stage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-'));
    try {
      const s = ImportSession.loadOrCreate(dir, 'test', {});
      s.setStage('screenshotting');
      expect(s.stage).toBe('screenshotting');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('roundtrips the new stages through save + reload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-'));
    try {
      const s1 = ImportSession.loadOrCreate(dir, 'test', {});
      s1.setStage('screenshotting');
      const s2 = ImportSession.loadOrCreate(dir, 'test', {}, { resume: true });
      expect(s2.stage).toBe('screenshotting');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ImportSession.readAdapter', () => {
  it('reads the recorded platform from session.json without mutating it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-'));
    try {
      const s = ImportSession.loadOrCreate(dir, 'shopify', {});
      s.setStage('extracting'); // persists session.json
      expect(ImportSession.readAdapter(dir)).toBe('shopify');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no session.json exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-'));
    try {
      expect(ImportSession.readAdapter(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
