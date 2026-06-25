// src/lib/preview/studio-site.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureStudioSite, expandTilde, studioWpRoot, type ExecFn } from './studio-site.js';

const TMP = join(process.cwd(), '.tmp-test');

describe('expandTilde', () => {
  it('expands a bare ~ to the home dir', () => {
    expect(expandTilde('~')).toBe(homedir());
  });

  it('expands a leading ~/ to the home dir', () => {
    expect(expandTilde('~/Studio/maison-clouet')).toBe(join(homedir(), 'Studio/maison-clouet'));
  });

  it('leaves absolute paths untouched', () => {
    expect(expandTilde('/Users/matt/Studio/x')).toBe('/Users/matt/Studio/x');
  });

  it('does NOT expand ~user (only ~ or ~/ — username homes are not resolvable here)', () => {
    expect(expandTilde('~bob/Studio')).toBe('~bob/Studio');
  });
});

describe('studioWpRoot', () => {
  let dir: string;
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
    dir = mkdtempSync(join(TMP, 'studio-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('resolves wp-content at the site root', () => {
    mkdirSync(join(dir, 'wp-content'), { recursive: true });
    expect(studioWpRoot(dir)).toBe(dir);
  });

  it('resolves wp-content under a wordpress/ subdir', () => {
    mkdirSync(join(dir, 'wordpress', 'wp-content'), { recursive: true });
    expect(studioWpRoot(dir)).toBe(join(dir, 'wordpress'));
  });

  it('returns null when no wp-content exists', () => {
    expect(studioWpRoot(dir)).toBeNull();
  });

  it('expands a leading ~ before probing (regression: literal ~ never has wp-content)', () => {
    // The convert-local-site bug: a ~/Studio/... path resolved to <cwd>/~/Studio/...
    // (path.resolve treats ~ as a literal segment), so the post-create wp-content
    // probe always missed even though `studio site create` made the real dir.
    // The test temp dir lives under cwd, which is under $HOME, so it has a tilde form.
    expect(dir.startsWith(homedir() + '/')).toBe(true); // precondition for the tilde form
    mkdirSync(join(dir, 'wp-content'), { recursive: true });
    const tildePath = '~' + dir.slice(homedir().length); // e.g. ~/projects/.../.tmp-test/studio-xxx
    expect(studioWpRoot(tildePath)).toBe(dir);
  });
});

describe('ensureStudioSite', () => {
  let dir: string;
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
    dir = mkdtempSync(join(TMP, 'studio-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('does not shell out when the site already exists (idempotent)', async () => {
    mkdirSync(join(dir, 'wp-content'), { recursive: true });
    const exec = vi.fn<ExecFn>();
    const res = await ensureStudioSite({ name: 'X', sitePath: dir, exec });
    expect(res.created).toBe(false);
    expect(res.wpRoot).toBe(dir);
    expect(exec).not.toHaveBeenCalled();
  });

  it('creates + starts the site via `studio site create` when absent, then resolves wpRoot', async () => {
    // The site dir exists but has no wp-content yet; the stubbed create
    // materializes wp-content (what `studio site create` does on disk).
    const exec = vi.fn<ExecFn>(async (_file, _args, _opts) => {
      mkdirSync(join(dir, 'wp-content'), { recursive: true });
      return { stdout: '', stderr: '' };
    });
    const res = await ensureStudioSite({ name: 'Maison Clouet', sitePath: dir, exec });
    expect(res.created).toBe(true);
    expect(res.wpRoot).toBe(dir);
    expect(exec).toHaveBeenCalledOnce();
    const [file, args] = exec.mock.calls[0];
    expect(file).toBe('studio');
    expect(args.slice(0, 2)).toEqual(['site', 'create']);
    expect(args).toContain('--name');
    expect(args).toContain('Maison Clouet');
    expect(args).toContain('--path');
    expect(args).toContain(dir);
    // Non-interactive flags so the call never blocks on a TTY / browser.
    expect(args).toContain('--start');
    expect(args).toContain('--skip-browser');
    expect(args).toContain('--skip-log-details');
  });

  it('passes admin creds + versions through when provided', async () => {
    const exec = vi.fn<ExecFn>(async () => {
      mkdirSync(join(dir, 'wp-content'), { recursive: true });
      return { stdout: '', stderr: '' };
    });
    await ensureStudioSite({
      name: 'X',
      sitePath: dir,
      adminUser: 'admin',
      adminPassword: 'secret',
      wp: '6.5',
      php: '8.3',
      exec,
    });
    const [, args] = exec.mock.calls[0];
    expect(args).toContain('--admin-username');
    expect(args).toContain('admin');
    expect(args).toContain('--admin-password');
    expect(args).toContain('secret');
    expect(args).toContain('--wp');
    expect(args).toContain('6.5');
    expect(args).toContain('--php');
    expect(args).toContain('8.3');
  });

  it('throws when creation runs but no wp-content materializes', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ stdout: '', stderr: '' })); // no-op: dir stays empty
    await expect(ensureStudioSite({ name: 'X', sitePath: dir, exec })).rejects.toThrow(/no wp-content/);
  });
});
