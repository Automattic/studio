// src/lib/streaming/site-finalize.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Mock the exec seam (same convention as convert-local-site.test.ts) so the
// wiring test can capture the eval-file argv + stage files without a real
// `studio` binary. Script copy + payload write stay REAL fs operations.
const execCalls: Array<{ cmd: string; args: string[] }> = [];
let execBehavior: (args: string[]) => { stdout: string } = () => ({
  stdout: '{"ok":true,"applied":{"options":[],"templates":[],"frontPage":false},"errors":[]}',
});
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((cmd: string, args: string[], _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
      execCalls.push({ cmd, args });
      try {
        cb(null, { stdout: execBehavior(args).stdout, stderr: '' });
      } catch (e) {
        cb(e as Error, { stdout: '', stderr: '' });
      }
    }),
  };
});

import { finalizeSite, parseFinalizeStdout, type SiteFinalizePayload } from './site-finalize.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

beforeEach(() => {
  execCalls.length = 0;
  execBehavior = () => ({
    stdout: '{"ok":true,"applied":{"options":[],"templates":[],"frontPage":false},"errors":[]}',
  });
});

describe('parseFinalizeStdout', () => {
  it('extracts the result JSON from prefixed wp-cli stdout', () => {
    const res = parseFinalizeStdout(
      'Studio banner line\n{"ok":false,"applied":{"options":["blogname"],"templates":[12],"frontPage":true},"errors":[{"item":"template:about","error":"boom"}]}\n',
    );
    expect(res.ok).toBe(false);
    expect(res.applied).toEqual({ options: ['blogname'], templates: [12], frontPage: true });
    expect(res.errors).toEqual([{ item: 'template:about', error: 'boom' }]);
  });

  it('throws on stdout with no JSON object (whole-call failure)', () => {
    expect(() => parseFinalizeStdout('Error: something exploded')).toThrow(/unexpected stdout/);
  });

  it('normalizes missing fields defensively', () => {
    const res = parseFinalizeStdout('{"ok":true}');
    expect(res).toEqual({ ok: true, applied: { options: [], templates: [], frontPage: false }, errors: [] });
  });
});

describe('finalizeSite', () => {
  it('short-circuits an empty payload without staging files or shelling out', async () => {
    const sitePath = mkdtempSync(join(FIXTURE_TMP, 'sf-empty-'));
    try {
      const res = await finalizeSite({
        payload: { options: {}, templateAssigns: [] },
        studioSitePath: sitePath,
      });
      expect(res).toEqual({ ok: true, applied: { options: [], templates: [], frontPage: false }, errors: [] });
      expect(execCalls).toHaveLength(0);
      expect(existsSync(join(sitePath, '.dla-scripts'))).toBe(false);
    } finally {
      rmSync(sitePath, { recursive: true, force: true });
    }
  });

  it('stages script + JSON payload into .dla-scripts and invokes eval-file with VFS paths', async () => {
    const sitePath = mkdtempSync(join(FIXTURE_TMP, 'sf-wire-'));
    try {
      const payload: SiteFinalizePayload = {
        options: { blogname: 'Acme' },
        templateAssigns: [{ postId: 12, slug: 'about', template: 'page-local' }],
        frontPageId: 11,
      };
      const res = await finalizeSite({ payload, studioSitePath: sitePath });
      expect(res.ok).toBe(true);
      // One exec: studio wp --path <site> eval-file <scriptVfs> <payloadVfs>.
      expect(execCalls).toHaveLength(1);
      const { cmd, args } = execCalls[0];
      expect(cmd).toBe('studio');
      expect(args.slice(0, 4)).toEqual(['wp', '--path', sitePath, 'eval-file']);
      expect(args[4]).toBe('/wordpress/.dla-scripts/site-finalize.php');
      expect(args[5]).toMatch(/^\/wordpress\/\.dla-scripts\/site-finalize-.*\.json$/);
      // Script copied into the site dir; payload file round-trips the input.
      const scriptsDir = join(sitePath, '.dla-scripts');
      expect(existsSync(join(scriptsDir, 'site-finalize.php'))).toBe(true);
      const payloadFile = readdirSync(scriptsDir).find((f) => f.startsWith('site-finalize-') && f.endsWith('.json'));
      expect(payloadFile).toBeDefined();
      expect(JSON.parse(readFileSync(join(scriptsDir, payloadFile as string), 'utf8'))).toEqual(payload);
    } finally {
      rmSync(sitePath, { recursive: true, force: true });
    }
  });

  it('rejects on exec failure with stderr surfaced (whole-call failure)', async () => {
    const sitePath = mkdtempSync(join(FIXTURE_TMP, 'sf-fail-'));
    execBehavior = () => {
      const e = new Error('Command failed: studio wp') as Error & { stderr?: string };
      e.stderr = 'PHP Fatal error: nope';
      throw e;
    };
    try {
      await expect(
        finalizeSite({
          payload: { options: { blogname: 'Acme' }, templateAssigns: [] },
          studioSitePath: sitePath,
        }),
      ).rejects.toThrow(/Command failed.*stderr: PHP Fatal error: nope/s);
    } finally {
      rmSync(sitePath, { recursive: true, force: true });
    }
  });

  it('rejects on garbage stdout (parse failure is a whole-call failure)', async () => {
    const sitePath = mkdtempSync(join(FIXTURE_TMP, 'sf-garbage-'));
    execBehavior = () => ({ stdout: 'not json at all' });
    try {
      await expect(
        finalizeSite({
          payload: { options: { blogname: 'Acme' }, templateAssigns: [] },
          studioSitePath: sitePath,
        }),
      ).rejects.toThrow(/unexpected stdout/);
    } finally {
      rmSync(sitePath, { recursive: true, force: true });
    }
  });
});
