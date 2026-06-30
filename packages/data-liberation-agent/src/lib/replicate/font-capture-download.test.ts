import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { downloadFonts } from './font-capture-download.js';
import type { CapturedParsedFontFace } from '@automattic/blocks-engine/theme';

const FACES: CapturedParsedFontFace[] = [
  { family: 'Larsseit', src: 'https://cdn.shopify.com/Larsseit-Regular.woff', format: 'woff', weight: '400', style: 'normal' },
  { family: 'Larsseit Bold', src: 'https://cdn.shopify.com/Larsseit-Bold.woff', format: 'woff', weight: '700', style: 'normal' },
];

// Use a cwd-local tmp dir (gitignored), per project convention.
function makeTmp(): string {
  const root = join(process.cwd(), '.tmp-test');
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, 'fontcap-'));
}

describe('downloadFonts', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('downloads each font into assets/fonts and returns local paths', async () => {
    const fakeFetch = (async (url: string) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(`font-bytes-for-${url}`).buffer,
    })) as unknown as typeof fetch;

    const { faces, errors } = await downloadFonts(FACES, { themeDir: dir, fetchImpl: fakeFetch });

    expect(errors).toEqual([]);
    expect(faces).toHaveLength(2);
    expect(faces[0].localPath).toBe('assets/fonts/Larsseit-Regular.woff');
    expect(existsSync(join(dir, 'assets/fonts/Larsseit-Regular.woff'))).toBe(true);
    expect(existsSync(join(dir, 'assets/fonts/Larsseit-Bold.woff'))).toBe(true);
  });

  it('records errors for failed downloads without throwing', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch;
    const { faces, errors } = await downloadFonts(FACES, { themeDir: dir, fetchImpl: fakeFetch });
    expect(faces).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0].error).toContain('404');
  });

  it('rejects empty bodies', async () => {
    const fakeFetch = (async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch;
    const { faces, errors } = await downloadFonts(FACES, { themeDir: dir, fetchImpl: fakeFetch });
    expect(faces).toEqual([]);
    expect(errors[0].error).toContain('empty');
  });

  it('reuses one file for duplicate URLs', async () => {
    let calls = 0;
    const fakeFetch = (async () => { calls++; return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer }; }) as unknown as typeof fetch;
    const dupes: CapturedParsedFontFace[] = [FACES[0], { ...FACES[0] }];
    const { faces } = await downloadFonts(dupes, { themeDir: dir, fetchImpl: fakeFetch });
    expect(faces).toHaveLength(2);
    expect(calls).toBe(1);
  });

  it('records an error (does not throw) for an internal-host font src — SSRF guard', async () => {
    let calls = 0;
    const fakeFetch = (async () => { calls++; return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer }; }) as unknown as typeof fetch;
    const internal: CapturedParsedFontFace[] = [
      { family: 'Evil', src: 'http://169.254.169.254/x.woff2', format: 'woff2', weight: '400', style: 'normal' },
    ];
    const { faces, errors } = await downloadFonts(internal, { themeDir: dir, fetchImpl: fakeFetch });
    expect(faces).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/internal|loopback|not allowed/i);
    expect(calls).toBe(0); // never fetched
  });
});
