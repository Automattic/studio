import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { saveDesignFoundation } from './save.js';
import type { DesignFoundation } from './schema.js';

const TMP_ROOT = join(process.cwd(), '.tmp-test', 'design-foundation-save');

function validFoundation(inputsDigest = {
  palette: 'sha256:abc',
  typography: 'sha256:def',
  breakpoints: 'sha256:ghi',
  manifest: 'sha256:jkl',
}): DesignFoundation {
  return {
    version: 1,
    generatedAt: '2026-04-19T10:00:00.000Z',
    origin: 'https://example.com',
    inputsDigest,
    color: {
      surface: { base: { value: '#ffffff', role: 'p', evidence: ['e'] } },
      text: { default: { value: '#111', role: 'p', evidence: ['e'] } },
      accent: { primary: { value: '#0066cc', role: 'p', evidence: ['e'] } },
      border: { default: { value: '#ddd', role: 'p', evidence: ['e'] } },
    },
    gradient: {},
    typography: {
      families: { body: { value: 'Inter', role: 'body', evidence: ['e'] } },
      scale: { base: '16px', steps: { base: '16px' } },
      weights: [400],
    },
    spacing: {
      base: '4px',
      scale: { '1': '4px' },
      sections: { padY: '80px', padX: '40px', contentMaxWidth: '1200px' },
    },
    breakpoints: { evidence: [] },
    radius: { evidence: [] },
    components: {},
    openQuestions: [],
    skillTodos: [],
  };
}

describe('saveDesignFoundation', () => {
  beforeEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  it('writes design-foundation.json and design-foundation.md atomically', () => {
    const dir = join(TMP_ROOT, 'happy');
    mkdirSync(dir, { recursive: true });
    const r = saveDesignFoundation(dir, validFoundation());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(existsSync(r.jsonPath)).toBe(true);
      expect(existsSync(r.mdPath)).toBe(true);
      expect(r.unchanged).toBe(false);
      // Tmp files cleaned up
      expect(existsSync(r.jsonPath + '.tmp')).toBe(false);
      expect(existsSync(r.mdPath + '.tmp')).toBe(false);
    }
  });

  it('skips write when inputsDigest matches existing file (returns unchanged: true)', () => {
    const dir = join(TMP_ROOT, 'unchanged');
    mkdirSync(dir, { recursive: true });
    const f = validFoundation();
    saveDesignFoundation(dir, f);
    const jsonPath = join(dir, 'design-foundation.json');
    const priorMtime = readFileSync(jsonPath, 'utf8');
    // Call again with same digest — should skip.
    const r = saveDesignFoundation(dir, f);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unchanged).toBe(true);
    expect(readFileSync(jsonPath, 'utf8')).toBe(priorMtime);
  });

  it('overwrites existing file when force=true even with matching digest', () => {
    const dir = join(TMP_ROOT, 'force');
    mkdirSync(dir, { recursive: true });
    saveDesignFoundation(dir, validFoundation());
    const r = saveDesignFoundation(dir, validFoundation(), { force: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unchanged).toBe(false);
  });

  it('writes when inputsDigest differs from prior file', () => {
    const dir = join(TMP_ROOT, 'differs');
    mkdirSync(dir, { recursive: true });
    saveDesignFoundation(dir, validFoundation());
    const r = saveDesignFoundation(
      dir,
      validFoundation({
        palette: 'sha256:XXX',
        typography: 'sha256:def',
        breakpoints: 'sha256:ghi',
        manifest: 'sha256:jkl',
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unchanged).toBe(false);
  });

  it('defensively re-validates input; returns zod errors and does NOT write on failure', () => {
    const dir = join(TMP_ROOT, 'invalid');
    mkdirSync(dir, { recursive: true });
    const bad = { version: 1, origin: 'not a url' } as unknown;
    const r = saveDesignFoundation(dir, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'design-foundation.json'))).toBe(false);
    expect(existsSync(join(dir, 'design-foundation.md'))).toBe(false);
  });

  it('falls through and overwrites when prior file is corrupt JSON', () => {
    const dir = join(TMP_ROOT, 'corrupt-prior');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'design-foundation.json'), 'not json');
    const r = saveDesignFoundation(dir, validFoundation());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unchanged).toBe(false);
  });

  it('rejects outputDir containing `..` via validateOutputDir', () => {
    expect(() =>
      // relative path — normalize keeps the leading '..' (join would collapse it)
      saveDesignFoundation('../escape', validFoundation()),
    ).toThrow(/traversal|outside/i);
  });
});
