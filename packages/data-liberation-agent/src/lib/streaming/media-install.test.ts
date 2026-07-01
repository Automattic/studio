import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { installMediaFiles, installMediaForUrl } from './media-install.js';
import { MediaStubStore } from '../resume-state/index.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

interface SetupOpts {
  /** Stubs to seed; key is sourceUrl, value defines status + localPath relative to outputDir/media. */
  stubs: Array<{
    url: string;
    filename: string;
    bytes?: Buffer;
    alreadyInstalled?: number;
    status?: 'success' | 'error' | 'awaiting';
    /** Record `svgRisky` on the stub (SVG survival routing). */
    svgRisky?: boolean;
    /** Write this PNG into media/ AND record it as the stub's rasterPath. */
    rasterFilename?: string;
    /** Write this PNG into media/ WITHOUT recording rasterPath (dedup-guard scenario). */
    sidecarPng?: string;
  }>;
}

function setup(opts: SetupOpts) {
  const outputDir = mkdtempSync(join(FIXTURE_TMP, 'mi-'));
  const wpRoot = join(outputDir, 'site', 'wordpress');
  mkdirSync(wpRoot, { recursive: true });
  mkdirSync(join(outputDir, 'media'), { recursive: true });

  const store = MediaStubStore.load(outputDir);
  for (const s of opts.stubs) {
    const status = s.status ?? 'success';
    const filePath = join(outputDir, 'media', s.filename);
    if (status === 'success') {
      writeFileSync(filePath, s.bytes ?? Buffer.from('fake'));
      let extra: { rasterPath?: string; svgRisky?: boolean } | undefined;
      if (s.rasterFilename) {
        const rasterPath = join(outputDir, 'media', s.rasterFilename);
        writeFileSync(rasterPath, Buffer.from('fake-png'));
        extra = { rasterPath, svgRisky: s.svgRisky };
      } else if (s.svgRisky !== undefined) {
        extra = { svgRisky: s.svgRisky };
      }
      if (s.sidecarPng) {
        writeFileSync(join(outputDir, 'media', s.sidecarPng), Buffer.from('fake-png'));
      }
      store.markSuccess(s.url, filePath, extra);
      if (s.alreadyInstalled !== undefined) {
        store.recordWpPostId(s.url, s.alreadyInstalled);
      }
    } else if (status === 'error') {
      store.markFailure(s.url, 'test-error');
    }
    // 'awaiting' is the default-no-mutation state
  }
  store.flush();
  return { outputDir, wpRoot };
}

/** Read back the JSON payload staged for a given eval-file exec call. */
function readStagedPayload(outputDir: string, args: string[]): Array<{ filename: string; sourceUrl: string }> {
  const vfsPath = args[args.indexOf('eval-file') + 2] as string;
  const name = vfsPath.split('/').pop()!;
  return JSON.parse(readFileSync(join(outputDir, 'site', '.dla-scripts', 'payloads', name), 'utf8'));
}

/** All exec calls that are wp-cli `plugin …` invocations (ensurePlugin traffic). */
function pluginCalls(exec: ReturnType<typeof vi.fn>): string[][] {
  return exec.mock.calls.filter(([, args]) => (args as string[]).includes('plugin')).map(([, args]) => args as string[]);
}

const SUCCESS_RESPONSE = (entries: Array<{ sourceUrl: string; filename: string; postId: number; localUrl: string; reused?: boolean }>) =>
  `Some other PHP output...\nDLA_INSTALL_MEDIA_JSON_BEGIN\n${JSON.stringify({
    results: entries.map((e) => ({ ...e, reused: e.reused ?? false })),
    errors: [],
  })}\nDLA_INSTALL_MEDIA_JSON_END\nMore noise after\n`;

describe('installMediaFiles', () => {
  it('copies caller-supplied files into uploads and returns parsed installs', async () => {
    const root = mkdtempSync(join(FIXTURE_TMP, 'mi-files-'));
    const sourceDir = join(root, 'source', 'assets', 'media');
    const wpRoot = join(root, 'site', 'wordpress');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(wpRoot, { recursive: true });
    const absPath = join(sourceDir, 'card-aurora.png');
    writeFileSync(absPath, Buffer.from('fictional image'));
    const stamp = new Date(2026, 5, 9, 12, 0, 0);
    utimesSync(absPath, stamp, stamp);

    try {
      const exec = vi.fn().mockResolvedValue({
        stdout: SUCCESS_RESPONSE([
          {
            sourceUrl: 'assets/media/card-aurora.png',
            filename: 'card-aurora.png',
            postId: 17,
            localUrl: 'https://studio.test/wp-content/uploads/2026/06/card-aurora.png',
          },
        ]),
        stderr: '',
      });

      const result = await installMediaFiles({
        files: [{ absPath, sourceUrl: 'assets/media/card-aurora.png' }],
        wpRoot,
        _execFile: exec,
      });

      expect(result).toEqual({
        installed: [
          {
            sourceUrl: 'assets/media/card-aurora.png',
            postId: 17,
            localUrl: 'https://studio.test/wp-content/uploads/2026/06/card-aurora.png',
          },
        ],
        errors: [],
      });
      expect(existsSync(join(wpRoot, 'wp-content', 'uploads', '2026', '06', 'card-aurora.png'))).toBe(true);
      expect(exec).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('installMediaForUrl', () => {
  it('copies media into wpRoot uploads, runs PHP, and records wpPostId', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/a.jpg', filename: 'a.jpg' }],
    });
    try {
      const exec = vi.fn().mockResolvedValue({
        stdout: SUCCESS_RESPONSE([
          { sourceUrl: 'https://cdn/a.jpg', filename: 'a.jpg', postId: 42, localUrl: 'http://wp/uploads/2024/01/a.jpg' },
        ]),
        stderr: '',
      });

      const result = await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });

      expect(result.errors).toEqual([]);
      expect(result.installed).toHaveLength(1);
      expect(result.installed[0]).toMatchObject({ sourceUrl: 'https://cdn/a.jpg', postId: 42 });

      // File was copied into the wpRoot under the year/month derived from mtime.
      // The exact year/month varies with the run, but we know the file should
      // exist under wp-content/uploads somewhere.
      const uploadsDir = join(wpRoot, 'wp-content', 'uploads');
      expect(existsSync(uploadsDir)).toBe(true);

      // Stub store now records the post ID.
      const store = MediaStubStore.load(outputDir);
      expect(store.get('https://cdn/a.jpg')?.wpPostId).toBe(42);

      // The PHP script + payload were staged to the parent of wpRoot (the site path).
      const sitePath = join(outputDir, 'site');
      expect(existsSync(join(sitePath, '.dla-scripts', 'install-media.php'))).toBe(true);

      // exec was called with studio + wp + eval-file + script + payload.
      expect(exec).toHaveBeenCalledTimes(1);
      const [bin, args] = exec.mock.calls[0];
      expect(bin).toBe('studio');
      expect(args).toContain('wp');
      expect(args).toContain('eval-file');
      expect(args).toContain('--path');
      expect(args[args.indexOf('--path') + 1]).toBe(sitePath);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('uses wpRoot itself as the Studio site path for flat Studio installs', async () => {
    const outputDir = mkdtempSync(join(FIXTURE_TMP, 'mi-flat-studio-'));
    const wpRoot = join(outputDir, 'flat-site');
    mkdirSync(join(wpRoot, 'wp-content'), { recursive: true });
    mkdirSync(join(outputDir, 'media'), { recursive: true });

    const filePath = join(outputDir, 'media', 'a.jpg');
    writeFileSync(filePath, Buffer.from('fake'));
    const store = MediaStubStore.load(outputDir);
    store.markSuccess('https://cdn/a.jpg', filePath);
    store.flush();

    try {
      const exec = vi.fn().mockResolvedValue({
        stdout: SUCCESS_RESPONSE([
          { sourceUrl: 'https://cdn/a.jpg', filename: 'a.jpg', postId: 42, localUrl: 'http://wp/uploads/2024/01/a.jpg' },
        ]),
        stderr: '',
      });

      await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });

      const [, args] = exec.mock.calls[0];
      expect(args[args.indexOf('--path') + 1]).toBe(wpRoot);
      expect(existsSync(join(wpRoot, '.dla-scripts', 'install-media.php'))).toBe(true);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('skips entries already installed without persisted localUrl (legacy stub)', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/a.jpg', filename: 'a.jpg', alreadyInstalled: 99 }],
    });
    try {
      const exec = vi.fn();

      const result = await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });

      // Nothing pending → no exec call.
      expect(exec).not.toHaveBeenCalled();
      expect(result.installed).toHaveLength(0);
      expect(result.skipped.some((s) => s.reason === 'already-installed')).toBe(true);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('returns already-installed stubs in result.installed when localUrl is persisted', async () => {
    // Regression for the streaming-mode bug where mediaUrlMap stayed empty
    // on resume runs: with localUrl persisted to MediaStub, idempotent
    // re-calls surface the mapping so flushPendingImports can rebuild
    // its rewrite map without re-running the PHP installer.
    const outputDir = mkdtempSync(join(FIXTURE_TMP, 'mi-resume-'));
    const wpRoot = join(outputDir, 'site', 'wordpress');
    mkdirSync(wpRoot, { recursive: true });
    mkdirSync(join(outputDir, 'media'), { recursive: true });
    const filePath = join(outputDir, 'media', 'a.jpg');
    writeFileSync(filePath, Buffer.from('fake'));

    const store = MediaStubStore.load(outputDir);
    store.markSuccess('https://cdn/a.jpg', filePath);
    store.recordWpPostId('https://cdn/a.jpg', 42);
    store.recordLocalUrl('https://cdn/a.jpg', 'http://localhost:8882/wp-content/uploads/2024/01/a.jpg');
    store.flush();

    try {
      const exec = vi.fn();
      const result = await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });

      expect(exec).not.toHaveBeenCalled();
      expect(result.skipped).toHaveLength(0);
      expect(result.installed).toEqual([
        {
          sourceUrl: 'https://cdn/a.jpg',
          postId: 42,
          // Stored + surfaced root-relative (port-independent) by the stub store.
          localUrl: '/wp-content/uploads/2024/01/a.jpg',
          localPath: filePath,
        },
      ]);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('persists localUrl to the stub on fresh install (so resume runs can rebuild the map)', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/b.jpg', filename: 'b.jpg' }],
    });
    try {
      const exec = vi.fn().mockResolvedValue({
        stdout: SUCCESS_RESPONSE([
          { sourceUrl: 'https://cdn/b.jpg', filename: 'b.jpg', postId: 7, localUrl: 'http://localhost:8882/wp-content/uploads/2024/01/b.jpg' },
        ]),
        stderr: '',
      });

      await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });

      const store = MediaStubStore.load(outputDir);
      // PHP returns an absolute URL; the stub store persists it root-relative
      // so the mapping survives a Studio site/port change.
      expect(store.get('https://cdn/b.jpg')?.localUrl).toBe('/wp-content/uploads/2024/01/b.jpg');
      expect(store.get('https://cdn/b.jpg')?.wpPostId).toBe(7);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('skips stubs whose local file is missing', async () => {
    const outputDir = mkdtempSync(join(FIXTURE_TMP, 'mi-missing-'));
    const wpRoot = join(outputDir, 'site', 'wordpress');
    mkdirSync(wpRoot, { recursive: true });
    mkdirSync(join(outputDir, 'media'), { recursive: true });

    // Stub recorded as success but the file isn't actually on disk.
    const store = MediaStubStore.load(outputDir);
    store.markSuccess('https://cdn/ghost.jpg', join(outputDir, 'media', 'ghost.jpg'));
    store.flush();

    try {
      const exec = vi.fn();
      const result = await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });
      expect(exec).not.toHaveBeenCalled();
      expect(result.skipped).toEqual([{ sourceUrl: 'https://cdn/ghost.jpg', reason: 'no-local-file' }]);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('returns errors when the studio exec fails', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/a.jpg', filename: 'a.jpg' }],
    });
    try {
      const exec = vi.fn().mockRejectedValue(new Error('studio not found'));

      const result = await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });

      expect(result.installed).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toMatch(/studio not found/);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('includes stderr/stdout details when the studio exec fails', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/a.jpg', filename: 'a.jpg' }],
    });
    try {
      const err = Object.assign(new Error('Command failed: studio wp eval-file'), {
        stderr: 'Fatal error: database is locked',
        stdout: 'wp-cli bootstrap output',
      });
      const exec = vi.fn().mockRejectedValue(err);

      const result = await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Fatal error: database is locked');
      expect(result.errors[0].error).toContain('wp-cli bootstrap output');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('returns errors when the PHP response has no parseable JSON', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/a.jpg', filename: 'a.jpg' }],
    });
    try {
      const exec = vi.fn().mockResolvedValue({ stdout: 'unrelated wp-cli output without sentinels', stderr: '' });

      const result = await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].error).toMatch(/no parseable JSON/);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('reads the response from the sidecar result file (bypasses Studio 64KB stdout cap)', async () => {
    // The script writes its full JSON to `<payload>.result.json` and emits only
    // a tiny `{resultFile}` pointer to stdout. Simulate that: the mock locates
    // the staged payload, writes the sidecar, and returns the pointer block.
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/big.jpg', filename: 'big.jpg' }],
    });
    try {
      const sitePath = join(outputDir, 'site');
      const payloadsDir = join(sitePath, '.dla-scripts', 'payloads');
      const exec = vi.fn().mockImplementation(async () => {
        // Find the payload the real code just staged.
        const { readdirSync } = await import('node:fs');
        const payloadFile = readdirSync(payloadsDir).find((f) => f.endsWith('.json') && !f.endsWith('.result.json'));
        const payloadHostPath = join(payloadsDir, payloadFile!);
        const fullResponse = JSON.stringify({
          results: [{ sourceUrl: 'https://cdn/big.jpg', filename: 'big.jpg', postId: 99, reused: false, localUrl: 'http://wp/uploads/2026/05/big.jpg' }],
          errors: [],
        });
        writeFileSync(`${payloadHostPath}.result.json`, fullResponse);
        // stdout carries ONLY the small pointer between the sentinels.
        return {
          stdout: `noise\nDLA_INSTALL_MEDIA_JSON_BEGIN\n${JSON.stringify({ resultFile: `/wordpress/.dla-scripts/payloads/${payloadFile}.result.json` })}\nDLA_INSTALL_MEDIA_JSON_END\nmore noise\n`,
          stderr: '',
        };
      });

      const result = await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });

      expect(result.errors).toEqual([]);
      expect(result.installed).toHaveLength(1);
      expect(result.installed[0]).toMatchObject({ sourceUrl: 'https://cdn/big.jpg', postId: 99 });
      const store = MediaStubStore.load(outputDir);
      expect(store.get('https://cdn/big.jpg')?.wpPostId).toBe(99);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('returns errors when the sidecar result file is missing/unreadable', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/a.jpg', filename: 'a.jpg' }],
    });
    try {
      // Pointer references a sidecar that was never written.
      const exec = vi.fn().mockResolvedValue({
        stdout: `DLA_INSTALL_MEDIA_JSON_BEGIN\n${JSON.stringify({ resultFile: '/wordpress/.dla-scripts/payloads/nonexistent.json.result.json' })}\nDLA_INSTALL_MEDIA_JSON_END\n`,
        stderr: '',
      });
      const result = await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].error).toMatch(/no parseable JSON/);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('reports per-stub errors that came back from PHP', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [
        { url: 'https://cdn/a.jpg', filename: 'a.jpg' },
        { url: 'https://cdn/b.jpg', filename: 'b.jpg' },
      ],
    });
    try {
      const exec = vi.fn().mockResolvedValue({
        stdout: 'noise\nDLA_INSTALL_MEDIA_JSON_BEGIN\n' + JSON.stringify({
          results: [{ sourceUrl: 'https://cdn/a.jpg', filename: 'a.jpg', postId: 1, reused: false, localUrl: 'http://l/a.jpg' }],
          errors: [{ sourceUrl: 'https://cdn/b.jpg', filename: 'b.jpg', error: 'wp_insert_attachment returned 0' }],
        }) + '\nDLA_INSTALL_MEDIA_JSON_END\n',
        stderr: '',
      });

      const result = await installMediaForUrl({
        outputDir,
        url: 'https://example.com/page',
        wpRoot,
        _execFile: exec,
      });
      expect(result.installed).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].sourceUrl).toBe('https://cdn/b.jpg');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('installMediaForUrl — SVG routing (svg survival)', () => {
  it('substitutes the PNG sibling for risky SVGs without touching safe-svg', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/logo.svg', filename: 'logo.svg', svgRisky: true, rasterFilename: 'logo.png' }],
    });
    try {
      const exec = vi.fn().mockImplementation(async (_bin: string, args: string[]) => {
        if (args.includes('eval-file')) {
          return {
            stdout: SUCCESS_RESPONSE([
              { sourceUrl: 'https://cdn/logo.svg', filename: 'logo.png', postId: 5, localUrl: 'http://wp/uploads/2026/06/logo.png' },
            ]),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await installMediaForUrl({ outputDir, url: 'https://example.com/page', wpRoot, _execFile: exec });

      // No SVG left in the batch → no ensurePlugin traffic at all.
      expect(pluginCalls(exec)).toHaveLength(0);
      expect(exec).toHaveBeenCalledTimes(1);
      const payload = readStagedPayload(outputDir, exec.mock.calls[0][1] as string[]);
      expect(payload).toHaveLength(1);
      expect(payload[0].filename).toBe('logo.png');
      expect(payload[0].sourceUrl).toBe('https://cdn/logo.svg');
      expect(result.errors).toEqual([]);
      expect(result.installed).toHaveLength(1);
      expect(result.svg).toEqual({ svgUploaded: 0, svgSubstituted: 1, svgFailed: 0, safeSvgEnsured: false });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('keeps clean SVGs as SVG and ensures safe-svg exactly once before the batch', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [
        { url: 'https://cdn/a.svg', filename: 'a.svg' },
        { url: 'https://cdn/b.svg', filename: 'b.svg' },
      ],
    });
    try {
      const exec = vi.fn().mockImplementation(async (_bin: string, args: string[]) => {
        if (args.includes('eval-file')) {
          return {
            stdout: SUCCESS_RESPONSE([
              { sourceUrl: 'https://cdn/a.svg', filename: 'a.svg', postId: 1, localUrl: 'http://wp/uploads/2026/06/a.svg' },
              { sourceUrl: 'https://cdn/b.svg', filename: 'b.svg', postId: 2, localUrl: 'http://wp/uploads/2026/06/b.svg' },
            ]),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await installMediaForUrl({ outputDir, url: 'https://example.com/page', wpRoot, _execFile: exec });

      // ensurePlugin ran once (one is-installed probe) and BEFORE the eval-file batch.
      const isInstalledCalls = exec.mock.calls.filter(([, args]) => (args as string[]).includes('is-installed'));
      expect(isInstalledCalls).toHaveLength(1);
      expect((isInstalledCalls[0][1] as string[])).toContain('safe-svg');
      const firstPluginIdx = exec.mock.calls.findIndex(([, args]) => (args as string[]).includes('plugin'));
      const evalIdx = exec.mock.calls.findIndex(([, args]) => (args as string[]).includes('eval-file'));
      expect(firstPluginIdx).toBeGreaterThanOrEqual(0);
      expect(firstPluginIdx).toBeLessThan(evalIdx);

      const payload = readStagedPayload(outputDir, exec.mock.calls[evalIdx][1] as string[]);
      expect(payload.map((p) => p.filename).sort()).toEqual(['a.svg', 'b.svg']);
      expect(result.errors).toEqual([]);
      expect(result.svg).toEqual({ svgUploaded: 2, svgSubstituted: 0, svgFailed: 0, safeSvgEnsured: true });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('risky deduped SVG (no rasterPath) substitutes the on-disk PNG sibling via the dedup guard', async () => {
    // Byte-duplicate SVG URLs dedupe at fetch: the stub points at the
    // ORIGINAL's localPath but carries no rasterPath of its own. The
    // original's sibling lives at exactly localPath with .svg → .png.
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/dup.svg', filename: 'shared.svg', svgRisky: true, sidecarPng: 'shared.png' }],
    });
    try {
      const exec = vi.fn().mockImplementation(async (_bin: string, args: string[]) => {
        if (args.includes('eval-file')) {
          return {
            stdout: SUCCESS_RESPONSE([
              { sourceUrl: 'https://cdn/dup.svg', filename: 'shared.png', postId: 8, localUrl: 'http://wp/uploads/2026/06/shared.png' },
            ]),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await installMediaForUrl({ outputDir, url: 'https://example.com/page', wpRoot, _execFile: exec });

      const payload = readStagedPayload(outputDir, exec.mock.calls[0][1] as string[]);
      expect(payload[0].filename).toBe('shared.png');
      expect(pluginCalls(exec)).toHaveLength(0);
      expect(result.svg).toEqual({ svgUploaded: 0, svgSubstituted: 1, svgFailed: 0, safeSvgEnsured: false });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('clean deduped SVG stays SVG even when a PNG sibling exists on disk', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/dup2.svg', filename: 'icon.svg', sidecarPng: 'icon.png' }],
    });
    try {
      const exec = vi.fn().mockImplementation(async (_bin: string, args: string[]) => {
        if (args.includes('eval-file')) {
          return {
            stdout: SUCCESS_RESPONSE([
              { sourceUrl: 'https://cdn/dup2.svg', filename: 'icon.svg', postId: 3, localUrl: 'http://wp/uploads/2026/06/icon.svg' },
            ]),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await installMediaForUrl({ outputDir, url: 'https://example.com/page', wpRoot, _execFile: exec });

      const evalCall = exec.mock.calls.find(([, args]) => (args as string[]).includes('eval-file'))!;
      const payload = readStagedPayload(outputDir, evalCall[1] as string[]);
      expect(payload[0].filename).toBe('icon.svg');
      expect(result.svg).toEqual({ svgUploaded: 1, svgSubstituted: 0, svgFailed: 0, safeSvgEnsured: true });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('ensurePlugin failure → mass PNG substitution + error stub for SVGs without raster', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [
        { url: 'https://cdn/c.svg', filename: 'c.svg', rasterFilename: 'c.png' },
        { url: 'https://cdn/d.svg', filename: 'd.svg' },
      ],
    });
    try {
      const exec = vi.fn().mockImplementation(async (_bin: string, args: string[]) => {
        if (args.includes('plugin')) throw new Error('no network');
        if (args.includes('eval-file')) {
          return {
            stdout: SUCCESS_RESPONSE([
              { sourceUrl: 'https://cdn/c.svg', filename: 'c.png', postId: 6, localUrl: 'http://wp/uploads/2026/06/c.png' },
            ]),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await installMediaForUrl({ outputDir, url: 'https://example.com/page', wpRoot, _execFile: exec });

      const evalCall = exec.mock.calls.find(([, args]) => (args as string[]).includes('eval-file'))!;
      const payload = readStagedPayload(outputDir, evalCall[1] as string[]);
      expect(payload.map((p) => p.filename)).toEqual(['c.png']);
      expect(result.installed).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].sourceUrl).toBe('https://cdn/d.svg');
      expect(result.errors[0].error).toMatch(/safe-svg unavailable and no raster fallback/);
      expect(result.svg).toEqual({ svgUploaded: 0, svgSubstituted: 1, svgFailed: 1, safeSvgEnsured: false });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('retries a per-file SVG insert failure once with the PNG sibling', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/e.svg', filename: 'e.svg', rasterFilename: 'e.png' }],
    });
    try {
      let evalCalls = 0;
      const exec = vi.fn().mockImplementation(async (_bin: string, args: string[]) => {
        if (args.includes('eval-file')) {
          evalCalls += 1;
          if (evalCalls === 1) {
            return {
              stdout: 'DLA_INSTALL_MEDIA_JSON_BEGIN\n' + JSON.stringify({
                results: [],
                errors: [{ sourceUrl: 'https://cdn/e.svg', filename: 'e.svg', error: 'svg_mime_rejected: image/svg+xml is not allowed on this site (Safe SVG inactive)' }],
              }) + '\nDLA_INSTALL_MEDIA_JSON_END\n',
              stderr: '',
            };
          }
          return {
            stdout: SUCCESS_RESPONSE([
              { sourceUrl: 'https://cdn/e.svg', filename: 'e.png', postId: 9, localUrl: 'http://wp/uploads/2026/06/e.png' },
            ]),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await installMediaForUrl({ outputDir, url: 'https://example.com/page', wpRoot, _execFile: exec });

      expect(evalCalls).toBe(2);
      const evalArgList = exec.mock.calls.filter(([, args]) => (args as string[]).includes('eval-file'));
      const retryPayload = readStagedPayload(outputDir, evalArgList[1][1] as string[]);
      expect(retryPayload.map((p) => p.filename)).toEqual(['e.png']);
      expect(result.errors).toEqual([]);
      expect(result.installed).toHaveLength(1);
      expect(result.installed[0].postId).toBe(9);
      expect(result.svg).toEqual({ svgUploaded: 0, svgSubstituted: 1, svgFailed: 0, safeSvgEnsured: true });
      // The PNG was copied into uploads for the retry batch.
      const store = MediaStubStore.load(outputDir);
      expect(store.get('https://cdn/e.svg')?.wpPostId).toBe(9);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('a failed PNG retry surfaces as svgFailed with a retry-tagged error', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/f.svg', filename: 'f.svg', rasterFilename: 'f.png' }],
    });
    try {
      let evalCalls = 0;
      const exec = vi.fn().mockImplementation(async (_bin: string, args: string[]) => {
        if (args.includes('eval-file')) {
          evalCalls += 1;
          const failure = evalCalls === 1
            ? { sourceUrl: 'https://cdn/f.svg', filename: 'f.svg', error: 'svg_mime_rejected: nope' }
            : { sourceUrl: 'https://cdn/f.svg', filename: 'f.png', error: 'wp_insert_attachment returned 0' };
          return {
            stdout: 'DLA_INSTALL_MEDIA_JSON_BEGIN\n' + JSON.stringify({ results: [], errors: [failure] }) + '\nDLA_INSTALL_MEDIA_JSON_END\n',
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await installMediaForUrl({ outputDir, url: 'https://example.com/page', wpRoot, _execFile: exec });

      expect(evalCalls).toBe(2);
      expect(result.installed).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toMatch(/svg png retry/);
      expect(result.svg).toEqual({ svgUploaded: 0, svgSubstituted: 0, svgFailed: 1, safeSvgEnsured: true });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('a per-file SVG failure with no raster fallback stays an error (no retry batch)', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/g.svg', filename: 'g.svg' }],
    });
    try {
      let evalCalls = 0;
      const exec = vi.fn().mockImplementation(async (_bin: string, args: string[]) => {
        if (args.includes('eval-file')) {
          evalCalls += 1;
          return {
            stdout: 'DLA_INSTALL_MEDIA_JSON_BEGIN\n' + JSON.stringify({
              results: [],
              errors: [{ sourceUrl: 'https://cdn/g.svg', filename: 'g.svg', error: 'svg_mime_rejected: nope' }],
            }) + '\nDLA_INSTALL_MEDIA_JSON_END\n',
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await installMediaForUrl({ outputDir, url: 'https://example.com/page', wpRoot, _execFile: exec });

      expect(evalCalls).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toMatch(/svg_mime_rejected/);
      expect(result.svg).toEqual({ svgUploaded: 0, svgSubstituted: 0, svgFailed: 1, safeSvgEnsured: true });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('non-SVG batches never touch the plugin CLI and report a zero tally', async () => {
    const { outputDir, wpRoot } = setup({
      stubs: [{ url: 'https://cdn/a.jpg', filename: 'a.jpg' }],
    });
    try {
      const exec = vi.fn().mockResolvedValue({
        stdout: SUCCESS_RESPONSE([
          { sourceUrl: 'https://cdn/a.jpg', filename: 'a.jpg', postId: 42, localUrl: 'http://wp/uploads/2024/01/a.jpg' },
        ]),
        stderr: '',
      });

      const result = await installMediaForUrl({ outputDir, url: 'https://example.com/page', wpRoot, _execFile: exec });

      expect(exec).toHaveBeenCalledTimes(1);
      expect(pluginCalls(exec)).toHaveLength(0);
      expect(result.svg).toEqual({ svgUploaded: 0, svgSubstituted: 0, svgFailed: 0, safeSvgEnsured: false });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
