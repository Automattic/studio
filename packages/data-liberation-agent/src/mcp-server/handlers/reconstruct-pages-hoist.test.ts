// Integration test: variation hoisting wired into liberate_reconstruct_pages.
// Exercises the REAL handler with the heavy edges mocked (Playwright capture,
// media install, block-fixer sidecar, studio wp subprocess) so we can assert
// the wiring contract: hoist sees all pages at once, runs BEFORE the
// block-fixer canonicalization, writes <theme>/styles/blocks/lib-*.json, and
// is gated by `variationHoist !== false`. All data is fictional.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Markup that reached the canonicalize step (BlockFixerClient.fix), in call order.
// fixerState.ready drives the mock's isReady — the hoist is gated on it (a down
// fixer can't reconcile comment-attr edits with the emitter's inner HTML).
const { fixCalls, fixerState } = vi.hoisted(() => ({ fixCalls: [] as string[], fixerState: { ready: true } }));

vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  // Callback-style stub for any direct use + a promisify.custom that mirrors the
  // real execFile's promisified {stdout, stderr} shape (the handler relies on it).
  const execFile: any = (...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') (cb as (e: null, o: string, s: string) => void)(null, '', '');
  };
  execFile[promisify.custom] = async () => ({ stdout: '', stderr: '' });
  const spawn = vi.fn();
  return { execFile, spawn, default: { execFile, spawn } };
});

vi.mock('../../lib/streaming/block-fixer-client.js', () => ({
  BlockFixerClient: class {
    get isReady(): boolean {
      return fixerState.ready;
    }
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async fix(items: string[]): Promise<Array<{ html: string; changed: boolean; fixedIssues: string[] }>> {
      fixCalls.push(...items);
      return items.map((html) => ({ html, changed: false, fixedIssues: [] }));
    }
    async rawConvert(items: string[]): Promise<Array<{ html: null; wpHtmlResidue: number }>> {
      return items.map(() => ({ html: null, wpHtmlResidue: Infinity }));
    }
  },
}));

vi.mock('../../lib/replicate/section-extract.js', () => ({
  extractFullFromUrl: vi.fn(async () => ({ specs: [{ selector: 'main > section' }], landmarks: [] })),
  rewriteThroughMediaMap: vi.fn((url: string) => url),
}));

// The Neptune-style instance constellation that recurs across pages (3 total).
const STYLE_ATTRS = '{"style":{"color":{"background":"#123456"}}}';
const STYLED_GROUP =
  `<!-- wp:group ${STYLE_ATTRS} -->` +
  '<div class="wp-block-group has-background" style="background-color:#123456"><p>Fictional copy.</p></div>' +
  '<!-- /wp:group -->';
const MARKUP_BY_SLUG: Record<string, string> = {
  home: STYLED_GROUP + STYLED_GROUP,
  about: STYLED_GROUP,
};

vi.mock('../../lib/replicate/reconstruct-pages.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/replicate/reconstruct-pages.js')>();
  return {
    ...actual,
    buildPageReconstruction: vi.fn((_specs: unknown, opts: { slug: string }) => ({
      patternSlug: `fictional-${opts.slug}`,
      // The real builder embeds the SAME (pre-hoist) block markup in the pattern
      // file (header + body) — mirror that so the Phase-B pattern-copy hoist
      // (applyHoistSwaps) is exercised.
      files: [
        {
          path: `patterns/page-${opts.slug}.php`,
          content: `<?php\n/**\n * Title: Fictional ${opts.slug}\n */\n?>\n` + (MARKUP_BY_SLUG[opts.slug] ?? ''),
        },
      ],
      template: '<!-- wp:post-content /-->',
      postContent: MARKUP_BY_SLUG[opts.slug] ?? '',
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

const TMP_BASE = resolve('.tmp-test', `reconstruct-hoist-${process.pid}`);

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
  return { outputDir, studioSitePath, themeSlug, themeRoot, outThemeRoot: join(outputDir, 'theme') };
}

const ctx: HandlerContext = {
  adapters: [],
  findAdapter: () => null,
  textResult: (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }),
  errorResult: (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true }),
  server: {} as HandlerContext['server'],
};

const PAGES = [
  { slug: 'home', sourceUrl: 'https://fictional-co.example/', title: 'Home', isHome: true },
  { slug: 'about', sourceUrl: 'https://fictional-co.example/about', title: 'About' },
];

beforeEach(() => {
  fixCalls.length = 0;
  fixerState.ready = true;
});

afterAll(() => {
  rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('liberate_reconstruct_pages variation hoisting', () => {
  it('hoists a site-wide constellation into styles/blocks/lib-*.json before canonicalization (default on)', async () => {
    const fx = makeFixture('default-on');
    const result = await reconstructPagesHandler(
      { outputDir: fx.outputDir, studioSitePath: fx.studioSitePath, themeSlug: fx.themeSlug, pages: PAGES },
      ctx,
    );
    const text = result.content[0].text;

    // (a) variation files exist with the contracted shape.
    for (const root of [fx.themeRoot, fx.outThemeRoot]) {
      const dir = join(root, 'styles', 'blocks');
      const files = readdirSync(dir).filter((f) => f.startsWith('lib-') && f.endsWith('.json'));
      expect(files).toHaveLength(1);
      const v = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'));
      // WP_Theme_JSON migrates versionless partials as schema v1, stripping
      // slug/blockTypes/styles — the variation would silently never register.
      expect(v.version).toBe(3);
      expect(v.slug).toMatch(/^lib-group-/);
      expect(v.blockTypes).toEqual(['core/group']);
      expect(v.styles).toEqual({ color: { background: '#123456' } });
      expect(typeof v.title).toBe('string');
      expect(v).not.toHaveProperty('count'); // count is a tally, not part of the variation file
    }

    // (c) BOTH theme roots carry the same variation file set (live theme + output copy).
    const variationSet = (root: string) => readdirSync(join(root, 'styles', 'blocks')).sort();
    expect(variationSet(fx.outThemeRoot)).toEqual(variationSet(fx.themeRoot));

    // (b) the markup that reached the block-fixer canonicalization is the HOISTED
    // markup: is-style class present, original inlined style attrs gone.
    expect(fixCalls.length).toBe(2); // one fix per page
    const fixed = fixCalls.join('\n');
    expect(fixed).toContain('is-style-lib-group-');
    expect(fixed).not.toContain(STYLE_ATTRS);

    // (d) result text carries the tallies.
    expect(text).toContain('"variationsHoisted": 1');
    expect(text).toContain('"variationInstances": 3');

    // (e) the written pattern-file copies stay PRE-hoist: patterns never pass
    // block-fixer canonicalization, so a comment-attr-only swap would leave
    // them editor-invalid (is-style attrs over pre-hoist inline HTML). They
    // keep the original style attrs — internally consistent and editor-valid.
    for (const root of [fx.themeRoot, fx.outThemeRoot]) {
      for (const slug of ['home', 'about']) {
        const pattern = readFileSync(join(root, 'patterns', `page-${slug}.php`), 'utf8');
        expect(pattern).toContain(STYLE_ATTRS);
        expect(pattern).not.toContain('is-style-lib-group-');
      }
    }
  });

  it('skips the hoist when the block-fixer is unavailable (no desynced comment attrs)', async () => {
    const fx = makeFixture('fixer-down');
    fixerState.ready = false;
    const result = await reconstructPagesHandler(
      { outputDir: fx.outputDir, studioSitePath: fx.studioSitePath, themeSlug: fx.themeSlug, pages: PAGES },
      ctx,
    );
    const text = result.content[0].text;

    // No variation files were written anywhere.
    for (const root of [fx.themeRoot, fx.outThemeRoot]) {
      expect(existsSync(join(root, 'styles', 'blocks'))).toBe(false);
    }
    // Markup is untouched: original style attrs intact, no is-style classes —
    // in what reached fix() AND in the written pattern files.
    const fixed = fixCalls.join('\n');
    expect(fixed).toContain(STYLE_ATTRS);
    expect(fixed).not.toContain('is-style-lib-');
    for (const slug of ['home', 'about']) {
      const pattern = readFileSync(join(fx.themeRoot, 'patterns', `page-${slug}.php`), 'utf8');
      expect(pattern).toContain(STYLE_ATTRS);
      expect(pattern).not.toContain('is-style-lib-');
    }
    // The skip is surfaced as a warning, not a silent no-op.
    expect(text).toContain('"variationsHoisted": 0');
    expect(text).toContain('"variationInstances": 0');
    expect(text).toContain('skipped: block-fixer unavailable (comment-attr edits require canonicalization)');
  });

  it('variationHoist: false leaves markup unchanged and writes no variation files', async () => {
    const fx = makeFixture('escape-hatch');
    const result = await reconstructPagesHandler(
      { outputDir: fx.outputDir, studioSitePath: fx.studioSitePath, themeSlug: fx.themeSlug, pages: PAGES, variationHoist: false },
      ctx,
    );
    const text = result.content[0].text;

    for (const root of [fx.themeRoot, fx.outThemeRoot]) {
      expect(existsSync(join(root, 'styles', 'blocks'))).toBe(false);
    }
    const fixed = fixCalls.join('\n');
    expect(fixed).toContain(STYLE_ATTRS); // original style attrs intact
    expect(fixed).not.toContain('is-style-lib-');
    expect(text).toContain('"variationsHoisted": 0');
    expect(text).toContain('"variationInstances": 0');
  });

  // NOTE: round-trip canonicalization (real BlockFixerClient sidecar) is not tested
  // here — the sidecar node_modules are absent in CI, so fix() falls back to identity
  // pass-through, making such a test vacuous. See block-fixer-client integration tests.
  it.todo('round-trip via real BlockFixerClient sidecar (vacuous in CI — sidecar node_modules absent)');
});
