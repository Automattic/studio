// Integration test: Jetpack auto-install wired into liberate_reconstruct_pages.
// Exercises the REAL handler with the heavy edges mocked (Playwright capture,
// media install, block-fixer sidecar, studio wp subprocess, ensurePlugin) so we
// can assert the wiring contract: when ANY page's specs carry captured forms,
// ensurePlugin(studioSitePath, 'jetpack', exec) runs ONCE in Phase A; no forms →
// no call; an ensure failure degrades to a result-text warning (never fatal).
// All data is fictional. Style mirrors reconstruct-pages-hoist.test.ts.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const { ensureCalls, ensureState, specState, execCalls, execState } = vi.hoisted(() => ({
  ensureCalls: [] as Array<{ sitePath: string; slug: string }>,
  ensureState: { result: { ok: true, action: 'installed' } as { ok: true; action: string } | { ok: false; error: string } },
  specState: { withForms: true },
  execCalls: [] as string[][],
  execState: { failModuleActivate: false },
}));

vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const execFile: any = (...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') (cb as (e: null, o: string, s: string) => void)(null, '', '');
  };
  execFile[promisify.custom] = async (_cmd: string, cmdArgs?: string[]) => {
    execCalls.push(cmdArgs ?? []);
    if (execState.failModuleActivate && (cmdArgs ?? []).join(' ').includes('jetpack module activate')) {
      throw new Error('module activate exploded (fictional)');
    }
    return { stdout: '', stderr: '' };
  };
  const spawn = vi.fn();
  return { execFile, spawn, default: { execFile, spawn } };
});

/** The `wp jetpack module activate contact-form` invocations recorded by the exec mock. */
const moduleActivateCalls = () =>
  execCalls.filter((a) => a.join(' ').includes('jetpack module activate contact-form'));

vi.mock('../../lib/preview/ensure-plugin.js', () => ({
  ensurePlugin: vi.fn(async (sitePath: string, slug: string) => {
    ensureCalls.push({ sitePath, slug });
    return ensureState.result;
  }),
}));

vi.mock('../../lib/streaming/block-fixer-client.js', () => ({
  BlockFixerClient: class {
    get isReady(): boolean {
      return false; // hoist out of the way — this test targets the jetpack wiring
    }
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async fix(items: string[]): Promise<Array<{ html: string; changed: boolean; fixedIssues: string[] }>> {
      return items.map((html) => ({ html, changed: false, fixedIssues: [] }));
    }
  },
}));

vi.mock('../../lib/replicate/section-extract.js', () => ({
  extractFullFromUrl: vi.fn(async () => ({
    specs: [
      specState.withForms
        ? {
            selector: 'main > section',
            forms: [{ fields: [{ kind: 'email', label: 'Email', required: true }], submitLabel: 'Send' }],
          }
        : { selector: 'main > section' },
    ],
    landmarks: [],
  })),
  rewriteThroughMediaMap: vi.fn((url: string) => url),
}));

vi.mock('../../lib/replicate/reconstruct-pages.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/replicate/reconstruct-pages.js')>();
  return {
    ...actual,
    buildPageReconstruction: vi.fn((_specs: unknown, opts: { slug: string }) => ({
      patternSlug: `fictional-${opts.slug}`,
      files: [{ path: `patterns/page-${opts.slug}.php`, content: '<?php ?>' }],
      template: '<!-- wp:post-content /-->',
      postContent: '<!-- wp:paragraph --><p>Fictional copy.</p><!-- /wp:paragraph -->',
      gate: { ok: true, errors: [] },
      variant: { overlayHeader: false, fullWidth: false, key: 'standard' as const },
      sectionsRendered: 1,
      iconAssetCount: 0,
      expectedAssets: [],
      provenanceFlags: [],
      fallbackSections: 0,
      fallbackDiagnostics: [],
    })),
  };
});

vi.mock('../../lib/replicate/run-media-map.js', () => ({
  installRunMediaMap: vi.fn(async () => ({ mediaUrlMap: new Map<string, string>(), result: { installed: [] } })),
}));
vi.mock('../../lib/replicate/download-section-media.js', () => ({
  downloadSectionMedia: vi.fn(async () => ({ downloaded: 0 })),
}));
vi.mock('../../lib/replicate/convert-semantic-sections.js', () => ({
  convertSemanticSections: vi.fn(async () => new Map()),
}));
vi.mock('../../lib/replicate/page-link-map.js', () => ({
  buildPageLinkMap: vi.fn(() => new Map()),
}));
vi.mock('../../lib/detect-platform/index.js', () => ({
  detect: vi.fn(async () => ({ platform: 'unknown' })),
}));

import { reconstructPagesHandler } from './reconstruct-pages.js';
import type { HandlerContext } from '../handler-types.js';

const TMP_BASE = resolve('.tmp-test', `reconstruct-jetpack-${process.pid}`);

function makeFixture(name: string) {
  const base = join(TMP_BASE, name);
  rmSync(base, { recursive: true, force: true });
  const outputDir = join(base, 'out');
  const studioSitePath = join(base, 'site');
  const themeSlug = 'fictional-replica';
  const themeRoot = join(studioSitePath, 'wp-content', 'themes', themeSlug);
  for (const root of [themeRoot, join(outputDir, 'theme')]) {
    mkdirSync(join(root, 'templates'), { recursive: true });
    writeFileSync(join(root, 'theme.json'), '{}');
  }
  return { outputDir, studioSitePath, themeSlug };
}

const ctx: HandlerContext = {
  adapters: [],
  findAdapter: () => null,
  textResult: (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }),
  errorResult: (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true }),
  server: {} as HandlerContext['server'],
};

const PAGES = [{ slug: 'contact', sourceUrl: 'https://fictional-co.example/contact', title: 'Contact' }];

beforeEach(() => {
  ensureCalls.length = 0;
  ensureState.result = { ok: true, action: 'installed' };
  specState.withForms = true;
  execCalls.length = 0;
  execState.failModuleActivate = false;
});

afterAll(() => {
  rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('liberate_reconstruct_pages jetpack auto-install', () => {
  it('forms in any page specs → ensurePlugin(studioSitePath, "jetpack") once + jetpackEnsured tally', async () => {
    const fx = makeFixture('forms');
    const result = await reconstructPagesHandler(
      { outputDir: fx.outputDir, studioSitePath: fx.studioSitePath, themeSlug: fx.themeSlug, pages: PAGES },
      ctx,
    );
    const text = result.content[0].text;
    expect(ensureCalls).toEqual([{ sitePath: fx.studioSitePath, slug: 'jetpack' }]);
    expect(text).toContain('"jetpackEnsured": true');
    expect(text).not.toContain('jetpackWarning');
    // Module activation runs after the ensure success — an unconnected Jetpack
    // starts with all modules inactive and forms render an empty wrapper.
    expect(moduleActivateCalls()).toEqual([['wp', '--path', fx.studioSitePath, 'jetpack', 'module', 'activate', 'contact-form']]);
  });

  it('no forms anywhere → ensurePlugin NOT called, jetpackEnsured false', async () => {
    const fx = makeFixture('no-forms');
    specState.withForms = false;
    const result = await reconstructPagesHandler(
      { outputDir: fx.outputDir, studioSitePath: fx.studioSitePath, themeSlug: fx.themeSlug, pages: PAGES },
      ctx,
    );
    const text = result.content[0].text;
    expect(ensureCalls).toEqual([]);
    expect(text).toContain('"jetpackEnsured": false');
    expect(moduleActivateCalls()).toEqual([]);
  });

  it('ensure failure → jetpackWarning in result text, run NOT fatal (pages still reconstruct), module NOT activated', async () => {
    const fx = makeFixture('ensure-fails');
    ensureState.result = { ok: false, error: 'network down (fictional)' };
    const result = await reconstructPagesHandler(
      { outputDir: fx.outputDir, studioSitePath: fx.studioSitePath, themeSlug: fx.themeSlug, pages: PAGES },
      ctx,
    );
    const text = result.content[0].text;
    expect(result.isError).not.toBe(true);
    expect(text).toContain('"jetpackEnsured": false');
    expect(text).toContain('network down (fictional)');
    expect(text).toContain('"reconstructed": 1'); // the failure did not abort the run
    // No point activating a module on a plugin that failed to install.
    expect(moduleActivateCalls()).toEqual([]);
  });

  it('module-activate failure → jetpackWarning (ensure still counts), run NOT fatal', async () => {
    const fx = makeFixture('activate-fails');
    execState.failModuleActivate = true;
    const result = await reconstructPagesHandler(
      { outputDir: fx.outputDir, studioSitePath: fx.studioSitePath, themeSlug: fx.themeSlug, pages: PAGES },
      ctx,
    );
    const text = result.content[0].text;
    expect(result.isError).not.toBe(true);
    expect(text).toContain('"jetpackEnsured": true'); // plugin install/activate itself succeeded
    expect(text).toContain('module activation failed');
    expect(text).toContain('module activate exploded (fictional)');
    expect(text).toContain('"reconstructed": 1'); // the failure did not abort the run
  });
});
