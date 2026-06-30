import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { persistThemeFiles } from './theme-scaffold.js';

const TMP_ROOT = join(process.cwd(), '.tmp-test', 'theme-scaffold');
mkdirSync(TMP_ROOT, { recursive: true });

describe('persistThemeFiles', () => {
  it('writes each file under themeDir, creating nested dirs, and returns the paths', () => {
    const themeDir = mkdtempSync(join(TMP_ROOT, 'theme-'));
    try {
      const files = [
        { relativePath: 'style.css', content: '/* style */' },
        { relativePath: 'theme.json', content: '{"version":3}' },
        { relativePath: 'patterns/page-home.php', content: '<?php /** Title: Home */ ?>' },
      ];

      const written = persistThemeFiles(themeDir, files);

      expect(written).toEqual(['style.css', 'theme.json', 'patterns/page-home.php']);
      expect(readFileSync(join(themeDir, 'style.css'), 'utf8')).toBe('/* style */');
      expect(readFileSync(join(themeDir, 'theme.json'), 'utf8')).toBe('{"version":3}');
      // nested path gets its parent dir created
      expect(existsSync(join(themeDir, 'patterns'))).toBe(true);
      expect(readFileSync(join(themeDir, 'patterns', 'page-home.php'), 'utf8')).toBe(
        '<?php /** Title: Home */ ?>',
      );
    } finally {
      rmSync(themeDir, { recursive: true, force: true });
    }
  });

  it('overwrites an existing file on a second run (deterministic re-scaffold)', () => {
    const themeDir = mkdtempSync(join(TMP_ROOT, 'theme-'));
    try {
      persistThemeFiles(themeDir, [{ relativePath: 'theme.json', content: 'old' }]);
      persistThemeFiles(themeDir, [{ relativePath: 'theme.json', content: 'new' }]);
      expect(readFileSync(join(themeDir, 'theme.json'), 'utf8')).toBe('new');
    } finally {
      rmSync(themeDir, { recursive: true, force: true });
    }
  });
});
