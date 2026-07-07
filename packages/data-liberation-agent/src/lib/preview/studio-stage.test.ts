import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// stageArtifacts is module-private so we reach it via the exports indirectly —
// here we test it through the public interface the way it'll actually be used
// by importing from the module. The module exports `stageArtifacts` for test
// access explicitly.
import { stageArtifacts, toVfsPath, updateStudioSiteOptions } from './studio.js';

describe('toVfsPath', () => {
  it('prefixes site-relative paths with /wordpress', () => {
    expect(toVfsPath('.dla-scripts/import-wxr.php')).toBe('/wordpress/.dla-scripts/import-wxr.php');
    expect(toVfsPath('wp-content/uploads/liberation/output.wxr')).toBe('/wordpress/wp-content/uploads/liberation/output.wxr');
  });
  it('normalizes leading slashes', () => {
    expect(toVfsPath('/foo/bar')).toBe('/wordpress/foo/bar');
    expect(toVfsPath('///x')).toBe('/wordpress/x');
  });
});

describe('stageArtifacts', () => {
  let outDir: string;
  let siteDir: string;
  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'dla-stage-out-'));
    siteDir = mkdtempSync(join(tmpdir(), 'dla-stage-site-'));
  });
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(siteDir, { recursive: true, force: true });
  });

  it('copies both vendored PHP scripts into the site and the returned paths point at them', () => {
    writeFileSync(join(outDir, 'output.wxr'), '<rss/>');

    const staged = stageArtifacts(outDir, siteDir);

    const wxrScriptAbs = join(siteDir, staged.wxrScriptRelPath);
    const productScriptAbs = join(siteDir, staged.productScriptRelPath);

    expect(existsSync(wxrScriptAbs)).toBe(true);
    expect(existsSync(productScriptAbs)).toBe(true);
    expect(readFileSync(wxrScriptAbs, 'utf8')).toContain('pre_http_request');
    expect(readFileSync(productScriptAbs, 'utf8')).toContain('WC_Product_CSV_Importer');
  });

  it('stages media files into the site uploads dir', () => {
    mkdirSync(join(outDir, 'media'));
    writeFileSync(join(outDir, 'media', 'a.jpg'), 'jpg-bytes');

    const staged = stageArtifacts(outDir, siteDir);
    expect(staged.hasMedia).toBe(true);
    expect(readFileSync(join(siteDir, 'wp-content/uploads/liberation/a.jpg'), 'utf8')).toBe('jpg-bytes');
  });
});

describe('updateStudioSiteOptions', () => {
  it('updates blogname and blogdescription through studio wp', async () => {
    const calls: Array<{ sitePath: string; args: string[] }> = [];

    const warnings = await updateStudioSiteOptions(
      '/tmp/studio-site',
      { title: 'Swift Lumber', tagline: 'Quality building materials' },
      async (sitePath, args) => {
        calls.push({ sitePath, args });
        return '';
      },
    );

    expect(warnings).toEqual([]);
    expect(calls).toEqual([
      {
        sitePath: '/tmp/studio-site',
        args: ['option', 'update', 'blogname', 'Swift Lumber'],
      },
      {
        sitePath: '/tmp/studio-site',
        args: ['option', 'update', 'blogdescription', 'Quality building materials'],
      },
    ]);
  });
});
