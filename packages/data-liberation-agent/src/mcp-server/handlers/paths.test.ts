import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathsHandler } from './paths.js';

const ctx = { textResult: (o: unknown) => o, errorResult: (m: string) => ({ error: m }) } as never;

describe('pathsHandler', () => {
  let prev: string | undefined;
  let prevOutput: string | undefined;
  beforeEach(() => { prev = process.env.STUDIO_SITES_DIR; prevOutput = process.env.DLA_OUTPUT_DIR; delete process.env.STUDIO_SITES_DIR; delete process.env.DLA_OUTPUT_DIR; });
  afterEach(() => { if (prev === undefined) delete process.env.STUDIO_SITES_DIR; else process.env.STUDIO_SITES_DIR = prev; if (prevOutput === undefined) delete process.env.DLA_OUTPUT_DIR; else process.env.DLA_OUTPUT_DIR = prevOutput; });

  it('returns the base and per-site dir for a url', async () => {
    const r = await pathsHandler({ url: 'https://example.com' }, ctx) as unknown as { base: string; siteDir: string | null };
    expect(r.base).toBe(join(homedir(), 'Studio', '_liberations'));
    expect(r.siteDir).toBe(join(homedir(), 'Studio', '_liberations', 'example.com'));
  });

  it('returns base with null siteDir when no url given', async () => {
    const r = await pathsHandler({}, ctx) as unknown as { base: string; siteDir: string | null };
    expect(r.siteDir).toBeNull();
  });
});
