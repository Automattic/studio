import { describe, it, expect } from 'vitest';
import { lintThemeJson } from './theme-json-lint.js';

describe('lintThemeJson', () => {
  it('passes a valid v3 theme.json', () => {
    expect(lintThemeJson({ version: 3, $schema: 'https://schemas.wp.org/trunk/theme.json' }).ok).toBe(true);
  });
  it('fails when version is not 3', () => {
    const r = lintThemeJson({ version: 2, $schema: 'x' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /version must be 3/.test(e))).toBe(true);
  });
  it('fails when $schema is missing', () => {
    expect(lintThemeJson({ version: 3 }).ok).toBe(false);
  });
  it('catches the spacingScale.theme:false activation fatal', () => {
    const r = lintThemeJson({ version: 3, $schema: 'x', settings: { spacing: { spacingScale: { theme: false } } } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /spacingScale.theme:false/.test(e))).toBe(true);
  });
  it('fails when both spacingSizes and spacingScale are present', () => {
    const r = lintThemeJson({ version: 3, $schema: 'x', settings: { spacing: { spacingSizes: [], spacingScale: { steps: 7 } } } });
    expect(r.ok).toBe(false);
  });
});
