import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveStudioWpRoot } from './studio.js';

const TMP = join(process.cwd(), '.tmp-test');
mkdirSync(TMP, { recursive: true });

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function makeSite(): string {
  const d = mkdtempSync(join(TMP, 'studio-site-'));
  dirs.push(d);
  return d;
}

describe('resolveStudioWpRoot', () => {
  it('returns the sitePath itself for a flat layout (wp-content directly inside)', () => {
    const site = makeSite();
    mkdirSync(join(site, 'wp-content', 'themes'), { recursive: true });
    expect(resolveStudioWpRoot(site)).toBe(site);
  });

  it('returns <sitePath>/wordpress for a nested layout', () => {
    const site = makeSite();
    mkdirSync(join(site, 'wordpress', 'wp-content', 'themes'), { recursive: true });
    expect(resolveStudioWpRoot(site)).toBe(join(site, 'wordpress'));
  });

  it('prefers the flat layout when both exist (the running site uses flat)', () => {
    // This is the getsnooz-com-replica failure shape: a phantom wordpress/ dir
    // existed alongside the real flat wp-content. The probe must pick flat.
    const site = makeSite();
    mkdirSync(join(site, 'wp-content', 'themes'), { recursive: true });
    mkdirSync(join(site, 'wordpress', 'wp-content', 'themes'), { recursive: true });
    expect(resolveStudioWpRoot(site)).toBe(site);
  });

  it('falls back to the flat sitePath when neither layout exists', () => {
    const site = makeSite();
    expect(resolveStudioWpRoot(site)).toBe(site);
  });

  it('expands a leading ~ in the flat fallback (no literal ~ segment downstream)', () => {
    // Regression: the non-null fallback must not emit a <cwd>/~/... path that
    // would break `wp theme activate`. ~/x with no wp-content → $HOME/x.
    expect(resolveStudioWpRoot('~/Studio/no-such-site')).toBe(join(homedir(), 'Studio/no-such-site'));
  });
});
