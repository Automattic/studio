import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../lib/streaming/media-install.js', () => ({
  installMediaForUrl: vi.fn().mockResolvedValue({
    installed: [],
    skipped: [],
    errors: [],
    svg: { svgUploaded: 1, svgSubstituted: 2, svgFailed: 0, safeSvgEnsured: true },
  }),
}));

import { wpRootFor, mediaInstallHandler } from './media-install.js';

describe('wpRootFor — Studio layout detection', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'media-install-wproot-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('flat Studio site (wp-content at site root) resolves to the site path itself', () => {
    const sitePath = join(root, 'flat-site');
    mkdirSync(join(sitePath, 'wp-content'), { recursive: true });
    expect(wpRootFor({ kind: 'studio', sitePath })).toBe(sitePath);
  });

  it('nested Studio site (wordpress/wp-content) resolves to the nested wp-root', () => {
    const sitePath = join(root, 'nested-site');
    mkdirSync(join(sitePath, 'wordpress', 'wp-content'), { recursive: true });
    expect(wpRootFor({ kind: 'studio', sitePath })).toBe(join(sitePath, 'wordpress'));
  });

  it('does not invent a phantom wordpress/ subdir for flat sites (regression)', () => {
    const sitePath = join(root, 'flat-site-2');
    mkdirSync(join(sitePath, 'wp-content'), { recursive: true });
    // The previous implementation hardcoded `<sitePath>/wordpress`, which made
    // uploads land in a directory the running flat site never serves.
    expect(wpRootFor({ kind: 'studio', sitePath })).not.toBe(join(sitePath, 'wordpress'));
  });

});

describe('mediaInstallHandler — SVG tally surfacing', () => {
  it('includes the svg routing tally from the installer result', async () => {
    const sitePath = mkdtempSync(join(tmpdir(), 'media-install-handler-'));
    mkdirSync(join(sitePath, 'wp-content'), { recursive: true });
    try {
      const ctx = {
        adapters: [],
        findAdapter: () => null,
        textResult: (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] }),
        errorResult: (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true }),
        server: {} as never,
      };
      const result = await mediaInstallHandler(
        { outputDir: '/tmp/out', url: 'https://example.com/', target: { kind: 'studio', sitePath } },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.svg).toEqual({ svgUploaded: 1, svgSubstituted: 2, svgFailed: 0, safeSvgEnsured: true });
    } finally {
      rmSync(sitePath, { recursive: true, force: true });
    }
  });
});
