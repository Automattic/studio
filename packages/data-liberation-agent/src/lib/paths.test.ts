import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveStudioRoot, resolveOutputBase, siteOutputDir } from './paths.js';

const ENV_KEYS = ['STUDIO_SITES_DIR', 'DLA_OUTPUT_DIR'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveStudioRoot', () => {
  it('defaults to ~/Studio', () => {
    expect(resolveStudioRoot()).toBe(join(homedir(), 'Studio'));
  });
  it('honors STUDIO_SITES_DIR', () => {
    process.env.STUDIO_SITES_DIR = '/tmp/custom-studio';
    expect(resolveStudioRoot()).toBe('/tmp/custom-studio');
  });
});

describe('resolveOutputBase', () => {
  it('defaults to <studio root>/_liberations', () => {
    expect(resolveOutputBase()).toBe(join(homedir(), 'Studio', '_liberations'));
  });
  it('follows STUDIO_SITES_DIR', () => {
    process.env.STUDIO_SITES_DIR = '/tmp/custom-studio';
    expect(resolveOutputBase()).toBe(join('/tmp/custom-studio', '_liberations'));
  });
  it('DLA_OUTPUT_DIR (absolute) wins', () => {
    process.env.DLA_OUTPUT_DIR = '/var/data/dla';
    expect(resolveOutputBase()).toBe('/var/data/dla');
  });
  it('DLA_OUTPUT_DIR (relative) resolves against home, not cwd', () => {
    process.env.DLA_OUTPUT_DIR = 'dla-out';
    expect(resolveOutputBase()).toBe(join(homedir(), 'dla-out'));
  });
  it('empty DLA_OUTPUT_DIR is treated as unset', () => {
    process.env.DLA_OUTPUT_DIR = '   ';
    expect(resolveOutputBase()).toBe(join(homedir(), 'Studio', '_liberations'));
  });
});

describe('siteOutputDir', () => {
  it('appends a sanitized hostname+pathname under the base', () => {
    expect(siteOutputDir('/base', 'https://Example.com/Shop/')).toBe(join('/base', 'example.com-shop'));
  });
  it('falls back to the raw string on an unparseable URL', () => {
    expect(siteOutputDir('/base', 'not a url')).toBe(join('/base', 'not-a-url'));
  });
});
