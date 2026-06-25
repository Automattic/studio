import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resetStreamingState } from './watch-state-reset.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

describe('resetStreamingState', () => {
  it('removes streaming state files', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'reset-'));
    try {
      writeFileSync(join(dir, 'replicate-state.json'), '{}');
      writeFileSync(join(dir, 'base-theme-replicated.json'), '{}');
      writeFileSync(join(dir, 'theme-pieces-replicated.json'), '{}');
      writeFileSync(join(dir, 'base-theme-brief.md'), '# Brief');
      writeFileSync(join(dir, 'block-transform-log.jsonl'), '');
      writeFileSync(join(dir, 'pending-imports.jsonl'), '');
      mkdirSync(join(dir, 'composed'), { recursive: true });
      writeFileSync(join(dir, 'composed', 'about.blocks.html'), '<!-- wp:paragraph -->...<!-- /wp:paragraph -->');

      const result = resetStreamingState(dir);

      expect(result.removed).toContain('replicate-state.json');
      expect(result.removed).toContain('base-theme-replicated.json');
      expect(result.removed).toContain('theme-pieces-replicated.json');
      expect(result.removed).toContain('base-theme-brief.md');
      expect(result.removed).toContain('block-transform-log.jsonl');
      expect(result.removed).toContain('pending-imports.jsonl');
      expect(result.removed).toContain('composed');
      expect(existsSync(join(dir, 'replicate-state.json'))).toBe(false);
      expect(existsSync(join(dir, 'base-theme-replicated.json'))).toBe(false);
      expect(existsSync(join(dir, 'theme-pieces-replicated.json'))).toBe(false);
      expect(existsSync(join(dir, 'base-theme-brief.md'))).toBe(false);
      expect(existsSync(join(dir, 'block-transform-log.jsonl'))).toBe(false);
      expect(existsSync(join(dir, 'pending-imports.jsonl'))).toBe(false);
      expect(existsSync(join(dir, 'composed'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves non-streaming files', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'reset-keep-'));
    try {
      writeFileSync(join(dir, 'output.wxr'), '<rss/>');
      writeFileSync(join(dir, 'session.json'), '{}');
      writeFileSync(join(dir, 'extraction-log.jsonl'), '');
      mkdirSync(join(dir, 'screenshots'), { recursive: true });
      writeFileSync(join(dir, 'screenshots', 'manifest.json'), '{}');

      resetStreamingState(dir);

      expect(existsSync(join(dir, 'output.wxr'))).toBe(true);
      expect(existsSync(join(dir, 'session.json'))).toBe(true);
      expect(existsSync(join(dir, 'extraction-log.jsonl'))).toBe(true);
      expect(existsSync(join(dir, 'screenshots', 'manifest.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports skipped items when nothing to remove', () => {
    const dir = mkdtempSync(join(FIXTURE_TMP, 'reset-empty-'));
    try {
      const result = resetStreamingState(dir);
      expect(result.removed).toEqual([]);
      expect(result.skipped).toContain('replicate-state.json');
      expect(result.skipped).toContain('base-theme-replicated.json');
      expect(result.skipped).toContain('theme-pieces-replicated.json');
      expect(result.skipped).toContain('base-theme-brief.md');
      expect(result.skipped).toContain('block-transform-log.jsonl');
      expect(result.skipped).toContain('pending-imports.jsonl');
      expect(result.skipped).toContain('composed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
