import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { downloadReplacementFont } from './font-substitution-download.js';
import type { FreeFontReplacement } from './font-substitution.js';

const HANKEN: FreeFontReplacement = {
  family: 'Hanken Grotesk',
  faces: [
    { weight: '400 700', style: 'normal', url: 'https://fonts.gstatic.com/s/hankengrotesk/v12/a.woff2' },
  ],
  rationale: 'test',
};

// A two-face (non-variable) replacement to exercise multi-file download.
const TWO_FACE: FreeFontReplacement = {
  family: 'Hanken Grotesk',
  faces: [
    { weight: '400', style: 'normal', url: 'https://fonts.gstatic.com/s/x/a.woff2' },
    { weight: '700', style: 'normal', url: 'https://fonts.gstatic.com/s/x/b.woff2' },
  ],
  rationale: 'test',
};

function makeTmp(): string {
  const root = join(process.cwd(), '.tmp-test');
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, 'fontsub-'));
}

describe('downloadReplacementFont', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('downloads a variable-font replacement (weight range) into one file', async () => {
    const fakeFetch = (async (url: string) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(`bytes-${url}`).buffer,
    })) as unknown as typeof fetch;

    const { faces, errors } = await downloadReplacementFont(HANKEN, { themeDir: dir, fetchImpl: fakeFetch });

    expect(errors).toEqual([]);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatchObject({ family: 'Hanken Grotesk', weight: '400 700', format: 'woff2', style: 'normal' });
    // Weight-range space flattened in the filename.
    expect(faces[0].localPath).toBe('assets/fonts/HankenGrotesk-400-700.woff2');
    expect(existsSync(join(dir, 'assets/fonts/HankenGrotesk-400-700.woff2'))).toBe(true);
  });

  it('downloads each face of a multi-weight replacement', async () => {
    const fakeFetch = (async (url: string) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(`bytes-${url}`).buffer,
    })) as unknown as typeof fetch;
    const { faces, errors } = await downloadReplacementFont(TWO_FACE, { themeDir: dir, fetchImpl: fakeFetch });
    expect(errors).toEqual([]);
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => f.localPath)).toEqual([
      'assets/fonts/HankenGrotesk-400.woff2',
      'assets/fonts/HankenGrotesk-700.woff2',
    ]);
  });

  it('records errors for failed downloads without throwing', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch;
    const { faces, errors } = await downloadReplacementFont(HANKEN, { themeDir: dir, fetchImpl: fakeFetch });
    expect(faces).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toContain('403');
  });

  it('reuses existing files on a second call (idempotent)', async () => {
    let calls = 0;
    const fakeFetch = (async () => { calls++; return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer }; }) as unknown as typeof fetch;
    await downloadReplacementFont(HANKEN, { themeDir: dir, fetchImpl: fakeFetch });
    expect(calls).toBe(1);
    const { faces } = await downloadReplacementFont(HANKEN, { themeDir: dir, fetchImpl: fakeFetch });
    expect(faces).toHaveLength(1);
    expect(calls).toBe(1); // no re-fetch
  });

  it('records an error (does not throw) for an internal-host replacement URL — SSRF guard', async () => {
    let calls = 0;
    const fakeFetch = (async () => { calls++; return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer }; }) as unknown as typeof fetch;
    const internal: FreeFontReplacement = {
      family: 'Evil',
      faces: [{ weight: '400', style: 'normal', url: 'http://localhost/evil.woff2' }],
      rationale: 'test',
    };
    const { faces, errors } = await downloadReplacementFont(internal, { themeDir: dir, fetchImpl: fakeFetch });
    expect(faces).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/loopback|internal|not allowed/i);
    expect(calls).toBe(0);
  });
});
