// Integration test: WooCommerce auto-install wired into liberate_reconstruct_pages_carry.
// Exercises the REAL handler with the heavy edges mocked so we can assert the
// wiring contract: when products.csv/products.jsonl is present, ensurePlugin
// called once with 'woocommerce'; absent → not called; failure → warning not fatal.
// All data is fictional. Style mirrors reconstruct-pages-jetpack.test.ts.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const { ensureCalls, ensureState } = vi.hoisted(() => ({
  ensureCalls: [] as Array<{ sitePath: string; slug: string }>,
  ensureState: { result: { ok: true, action: 'installed' } as { ok: true; action: string } | { ok: false; error: string } },
}));

vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const execFile: any = (...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') (cb as (e: null, o: string, s: string) => void)(null, '', '');
  };
  execFile[promisify.custom] = async () => ({ stdout: '', stderr: '' });
  const spawn = vi.fn();
  return { execFile, spawn, default: { execFile, spawn } };
});

vi.mock('../../lib/preview/ensure-plugin.js', () => ({
  ensurePlugin: vi.fn(async (sitePath: string, slug: string) => {
    ensureCalls.push({ sitePath, slug });
    return ensureState.result;
  }),
}));

// Mock all heavy IO dependencies so the handler completes without real network/disk.
vi.mock('../../lib/replicate/css-collect.js', () => ({
  collectCss: vi.fn(async () => ''),
}));

vi.mock('../../lib/replicate/page-reconstruct-carry.js', () => ({
  reconstructPageCarry: vi.fn(() => ({
    mainIsland: '<div class="fictional-main">content</div>',
    headerIsland: '<header class="fictional-header"><a>Logo</a></header>',
    footerIsland: '<footer class="fictional-footer">Footer</footer>',
    deepChrome: true,
    scaffold: undefined,
    chromeCss: '.fictional-header{color:red}',
    mainCss: '.fictional-main{color:blue}',
  })),
}));

vi.mock('../../lib/replicate/theme-scaffold-carry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/replicate/theme-scaffold-carry.js')>();
  return {
    ...actual,
    buildCarryThemeFiles: vi.fn(() => []),
  };
});

vi.mock('../../lib/replicate/carry-missing-media.js', () => ({
  fetchMissingCarriedMedia: vi.fn(async () => ({ downloaded: 0, failed: 0 })),
}));

vi.mock('../../lib/replicate/carry-fonts.js', () => ({
  localizeCarryFonts: vi.fn(async () => ({ files: [], downloaded: 0, failed: 0 })),
}));

vi.mock('../../lib/replicate/carry-cdn-audit.js', () => ({
  findExternalAssetRefs: vi.fn(() => ({ refs: [], byHost: {}, samples: [] })),
}));

vi.mock('../../lib/replicate/carry-design-tokens.js', () => ({
  loadCarryDesignTokens: vi.fn(() => ({ themeJsonPalette: [], themeJsonFontFamilies: [] })),
}));

vi.mock('../../lib/replicate/page-link-map.js', () => ({
  buildPageLinkMap: vi.fn(() => new Map()),
}));

vi.mock('../../lib/replicate/carry-page-list.js', () => ({
  reconcileCarryIslands: vi.fn(),
}));

vi.mock('../../lib/replicate/run-media-map.js', () => ({
  installRunMediaMap: vi.fn(async () => ({ mediaUrlMap: new Map<string, string>(), result: { installed: [] } })),
}));

vi.mock('../../lib/replicate/carry-responsive-assemble.js', () => ({
  assembleResponsiveMobile: vi.fn((html: string) => html),
}));

vi.mock('../../lib/screenshot/dynamic-content.js', () => ({
  assessBody: vi.fn(() => ({ isolated: false })),
  readPngHeight: vi.fn(() => null),
  classifyEmptyBodies: vi.fn(() => []),
}));

import { reconstructPagesCarryHandler } from './reconstruct-pages-carry.js';
import type { HandlerContext } from '../handler-types.js';

const TMP_BASE = resolve('.tmp-test', `reconstruct-carry-woo-${process.pid}`);

function makeFixture(name: string, opts: { withProductsCsv?: boolean; withProductsJsonl?: boolean } = {}) {
  const base = join(TMP_BASE, name);
  rmSync(base, { recursive: true, force: true });
  const outputDir = join(base, 'out');
  const studioSitePath = join(base, 'site');
  const wpContent = join(studioSitePath, 'wp-content');
  const htmlDir = join(outputDir, 'html');
  mkdirSync(htmlDir, { recursive: true });
  mkdirSync(wpContent, { recursive: true });
  // Minimal carried HTML so the handler doesn't fall back to a live fetch.
  writeFileSync(
    join(htmlDir, 'home.html'),
    '<html><head></head><body><header class="h">H</header><main>content</main><footer class="f">F</footer></body></html>',
  );
  if (opts.withProductsCsv) {
    writeFileSync(join(outputDir, 'products.csv'), 'name\nFictional Product');
  }
  if (opts.withProductsJsonl) {
    writeFileSync(join(outputDir, 'products.jsonl'), '{"name":"Fictional Product"}');
  }
  return { outputDir, studioSitePath };
}

const ctx: HandlerContext = {
  adapters: [],
  findAdapter: () => null,
  textResult: (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }),
  errorResult: (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true }),
  server: {} as HandlerContext['server'],
};

const PAGES = [{ slug: 'home', sourceUrl: 'https://fictional-store.example/', title: 'Home', isHome: true }];

beforeEach(() => {
  ensureCalls.length = 0;
  ensureState.result = { ok: true, action: 'installed' };
});

afterAll(() => {
  rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('liberate_reconstruct_pages_carry woocommerce auto-install', () => {
  it('products.csv present → ensurePlugin(studioSitePath, "woocommerce") once + wooEnsured true', async () => {
    const fx = makeFixture('csv', { withProductsCsv: true });
    const result = await reconstructPagesCarryHandler(
      { outputDir: fx.outputDir, studioSitePath: fx.studioSitePath, pages: PAGES },
      ctx,
    );
    const text = result.content[0].text;
    expect(ensureCalls).toEqual([{ sitePath: fx.studioSitePath, slug: 'woocommerce' }]);
    expect(text).toContain('"wooEnsured": true');
    expect(text).not.toContain('wooWarning');
  });

  it('products.jsonl present → ensurePlugin called once', async () => {
    const fx = makeFixture('jsonl', { withProductsJsonl: true });
    const result = await reconstructPagesCarryHandler(
      { outputDir: fx.outputDir, studioSitePath: fx.studioSitePath, pages: PAGES },
      ctx,
    );
    const text = result.content[0].text;
    expect(ensureCalls).toEqual([{ sitePath: fx.studioSitePath, slug: 'woocommerce' }]);
    expect(text).toContain('"wooEnsured": true');
  });

  it('no products → ensurePlugin NOT called, wooEnsured false', async () => {
    const fx = makeFixture('no-products');
    const result = await reconstructPagesCarryHandler(
      { outputDir: fx.outputDir, studioSitePath: fx.studioSitePath, pages: PAGES },
      ctx,
    );
    const text = result.content[0].text;
    expect(ensureCalls).toEqual([]);
    expect(text).toContain('"wooEnsured": false');
    expect(text).not.toContain('wooWarning');
  });

  it('ensure failure → wooWarning in result text, run NOT fatal (pages still carry)', async () => {
    const fx = makeFixture('ensure-fails', { withProductsCsv: true });
    ensureState.result = { ok: false, error: 'woo install exploded (fictional)' };
    const result = await reconstructPagesCarryHandler(
      { outputDir: fx.outputDir, studioSitePath: fx.studioSitePath, pages: PAGES },
      ctx,
    );
    const text = result.content[0].text;
    expect(result.isError).not.toBe(true);
    expect(text).toContain('"wooEnsured": false');
    expect(text).toContain('woo install exploded (fictional)');
  });
});
