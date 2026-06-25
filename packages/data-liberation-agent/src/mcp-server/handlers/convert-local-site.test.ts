// src/mcp-server/handlers/convert-local-site.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { HandlerContext, ToolResult } from '../handler-types.js';
import { JETPACK_FORM_PARITY_CSS } from '../../lib/replicate/local-theme/jetpack-form-parity-contract.js';
import {
  JETPACK_FORMS_COMMAND_SEQUENCE,
  JETPACK_FORMS_MODULE_ACTIVATE,
  JETPACK_FORMS_PLUGIN_INSTALL,
} from './convert-local-site-jetpack-contract.js';

// Mock BOTH exec seams before importing the handler:
// - node:child_process execFile → studio wp activation/option/meta commands
// - post-install installPost → page creation (it shells out internally)
// Per-test failure injection: a test sets execFailFor / installFailFor;
// beforeEach resets both so tests stay independent.

// Heavy design-capture + compare seams — mocked at the module level so the
// handler never invokes Playwright or the pixel-matcher in unit tests.
// capturedRuns tracks calls so tests can assert on source + replica invocations.
// force is tracked so repair-loop tests can assert re-capture uses force:true.
const capturedRuns: Array<{ urls: string[]; outputDir: string; force?: boolean }> = [];

// Repair-loop fixture seam: set per-test; cleared in beforeEach.
// When repairReplicaManifestEntries is non-empty, the captureScreenshots mock
// writes a proper manifest (pathname→slug) + red-pixel diff PNGs for the replica
// capture, so the repair loop can read them without real Playwright/pixelmatch.
let repairReplicaManifestEntries: Record<string, { slug: string }> = {};
let repairDiffPng: Buffer | null = null;
const buildJetpackFormParityCssMock = vi.hoisted(() => vi.fn(() => ({ css: '' })));
const regionCensusFailure = vi.hoisted(() => ({ throwOnExtract: false }));
const assembleLocalThemeCalls = vi.hoisted(
  () =>
    [] as Array<{
      interiorChromeTemplates?: Array<{
        partSlug: string;
        layoutWrapperTag?: string;
        layoutWrapperClasses?: string[];
        layoutWrapperRailPosition?: 'beforeMain' | 'afterMain';
      }>;
    }>,
);

// Passthrough the block fixer: convert calls the real ingest handler, which now
// canonicalizes each page through a jsdom HTTP subprocess (~2.5s/test + parallel
// flakiness). These tests assert orchestration, not @wordpress/blocks
// canonicalization (covered by blockFixer.smoke.test.js); the stub keeps the
// suite fast + deterministic. Passthrough → sidecars equal the composed markup.
vi.mock('../../lib/streaming/block-fixer-client.js', () => ({
  BlockFixerClient: class {
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async fix(items: string[]): Promise<Array<{ html: string; changed: boolean; fixedIssues: string[] }>> {
      return items.map((html) => ({ html, changed: false, fixedIssues: [] }));
    }
  },
}));

vi.mock('../../lib/screenshot/screenshotter.js', () => ({
  captureScreenshots: vi.fn(async (opts: { urls: string[]; outputDir: string; force?: boolean }) => {
    capturedRuns.push({ urls: opts.urls, outputDir: opts.outputDir, force: opts.force });
    // Fabricate aggregate files the handler reads after source capture.
    const { mkdirSync: md, writeFileSync: wf } = await import('node:fs');
    const { join: j } = await import('node:path');
    md(j(opts.outputDir, 'screenshots'), { recursive: true });
    wf(j(opts.outputDir, 'palette.json'), JSON.stringify({ version: 1, sampledUrls: 1, colors: [{ hex: '#0e2a30', count: 10, urls: 1 }, { hex: '#f7f2e9', count: 9, urls: 1 }, { hex: '#e2573b', count: 5, urls: 1 }] }));
    wf(j(opts.outputDir, 'typography.json'), JSON.stringify({ version: 1, sampledUrls: 1, bySelector: { body: [{ fontFamily: 'X', fontSize: '16px', fontWeight: '400', lineHeight: '24px', urls: 1 }] } }));
    wf(j(opts.outputDir, 'breakpoints.json'), JSON.stringify({ version: 1, sampledUrls: 1, minWidth: [], maxWidth: [] }));
    // Replica captures: write a proper manifest + diff PNGs when the repair seam is active.
    const hasRepairEntries = Object.keys(repairReplicaManifestEntries).length > 0;
    if (hasRepairEntries && opts.outputDir.endsWith('/replica')) {
      wf(j(opts.outputDir, 'screenshots', 'manifest.json'), JSON.stringify({ version: 1, entries: repairReplicaManifestEntries }));
      if (repairDiffPng) {
        md(j(opts.outputDir, 'screenshots', 'diff'), { recursive: true });
        for (const entry of Object.values(repairReplicaManifestEntries)) {
          for (const vp of ['desktop', 'mobile']) {
            wf(j(opts.outputDir, 'screenshots', 'diff', `${entry.slug}.${vp}.diff.png`), repairDiffPng);
          }
        }
      }
    } else {
      wf(j(opts.outputDir, 'screenshots', 'manifest.json'), JSON.stringify({ version: 1, entries: {} }));
    }
    return { captured: opts.urls.length, failed: 0, skipped: 0, browserRestarts: 0, durationMs: 0, manifestPath: j(opts.outputDir, 'screenshots', 'manifest.json') };
  }),
}));
vi.mock('../../lib/screenshot/compare.js', () => ({
  compareScreenshotDirs: vi.fn(async () => ({
    version: 1,
    comparedAt: 'TEST',
    results: [
      { pathname: '/', originUrl: 'o', replicaUrl: 'r', desktop: { status: 'ok', score: 0.91 }, mobile: { status: 'ok', score: 0.88 } },
      { pathname: '/about/', originUrl: 'o', replicaUrl: 'r', desktop: { status: 'ok', score: 0.95 }, mobile: { status: 'ok', score: 0.9 } },
    ],
  })),
}));
vi.mock('../../lib/replicate/local-theme/google-fonts.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  selfHostGoogleFonts: vi.fn(async () => ({ faces: [], errors: [] })),
}));
vi.mock('../../lib/replicate/local-theme/theme-files.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/replicate/local-theme/theme-files.js')>();
  return {
    ...actual,
    assembleLocalTheme: (opts: Parameters<typeof actual.assembleLocalTheme>[0]) => {
      assembleLocalThemeCalls.push(opts);
      return actual.assembleLocalTheme(opts);
    },
  };
});
vi.mock('../../lib/replicate/local-site/jetpack-form-css.js', () => ({
  buildJetpackFormParityCss: buildJetpackFormParityCssMock,
}));
vi.mock('../../lib/replicate/region-census.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/replicate/region-census.js')>();
  return {
    ...actual,
    extractSourceLandmarksFromHtml: (html: string) => {
      if (regionCensusFailure.throwOnExtract) throw new Error('synthetic region census failure');
      return actual.extractSourceLandmarksFromHtml(html);
    },
  };
});

// Repair-loop seam: mock probePair (heavy Playwright + CSS snapshot) while keeping
// FREEZE_MOTION_CSS real so the handler's freezeMotion helper stays functional.
vi.mock('../../lib/replicate/parity/parity-probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/replicate/parity/parity-probe.js')>();
  return { ...actual, probePair: vi.fn(async () => []) };
});

// Repair-loop seam: stub chromium.launch so the loop never opens a real browser.
// probePair is mocked so the browser stub only needs close() in the finally block.
vi.mock('playwright', async (importOriginal) => {
  const actual = await importOriginal<typeof import('playwright')>();
  return {
    ...actual,
    chromium: { ...actual.chromium, launch: vi.fn(async () => ({ close: vi.fn(async () => {}) })) },
  };
});

const execCalls: string[][] = [];
let execFailFor: string | null = null;
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((cmd: string, args: string[], _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
      execCalls.push([cmd, ...args]);
      const joined = [cmd, ...args].join(' ');
      if (execFailFor && joined.includes(execFailFor)) {
        cb(new Error(`synthetic exec failure: ${execFailFor}`), { stdout: '', stderr: '' });
        return;
      }
      // Studio assigns random ports — the handler resolves the replica base URL
      // via `wp option get siteurl`; a distinctive port here lets tests assert
      // the RESOLVED url (not a hardcoded default) drives replica capture.
      cb(null, { stdout: joined.includes('option get siteurl') ? 'http://localhost:7777\n' : '', stderr: '' });
    }),
  };
});
const installedPosts: Array<{ slug: string; sourceUrl: string; content: string }> = [];
let installFailFor: string | null = null;
vi.mock('../../lib/streaming/post-install.js', () => ({
  installPost: vi.fn(async ({ item }: { item: { slug: string; sourceUrl: string; content: string } }) => {
    if (installFailFor && item.slug === installFailFor) {
      throw new Error(`synthetic install failure: ${item.slug}`);
    }
    installedPosts.push({ slug: item.slug, sourceUrl: item.sourceUrl, content: item.content });
    return { sourceUrl: item.sourceUrl, postId: installedPosts.length, action: 'inserted' as const };
  }),
}));

// Site-finalize seam (mirrors the installPost mock): the handler consolidates
// blogname + _wp_page_template assigns + the front-page pair into ONE
// finalizeSite eval-file call (Studio IPC flakes on bursts of argv commands).
// finalizeCalls captures payloads for assertions; finalizeResultOverride lets
// a test inject per-item errors or a whole-call rejection.
interface FinalizePayloadLike {
  options: Record<string, string>;
  templateAssigns: Array<{ postId: number; slug: string; template: string }>;
  frontPageId?: number;
}
interface FinalizeResultLike {
  ok: boolean;
  applied: { options: string[]; templates: number[]; frontPage: boolean };
  errors: Array<{ item: string; error: string }>;
}
const finalizeCalls: Array<{ payload: FinalizePayloadLike; studioSitePath: string }> = [];
let finalizeResultOverride: ((payload: FinalizePayloadLike) => Promise<FinalizeResultLike>) | null = null;
vi.mock('../../lib/streaming/site-finalize.js', () => ({
  finalizeSite: vi.fn(async ({ payload, studioSitePath }: { payload: FinalizePayloadLike; studioSitePath: string }) => {
    finalizeCalls.push({ payload, studioSitePath });
    if (finalizeResultOverride) return finalizeResultOverride(payload);
    // Default: everything in the payload applied successfully.
    return {
      ok: true,
      applied: {
        options: Object.keys(payload.options),
        templates: payload.templateAssigns.map((t) => t.postId),
        frontPage: payload.frontPageId !== undefined,
      },
      errors: [],
    };
  }),
}));

import { convertLocalSiteHandler } from './convert-local-site.js';
import { ingestLocalSiteHandler } from './ingest-local-site.js';
// Resolves to the vi.mock above — imported so tests can inject one-shot failures.
import { captureScreenshots } from '../../lib/screenshot/screenshotter.js';
// Resolved vi.mocked instances for per-test once-value injection.
import { compareScreenshotDirs } from '../../lib/screenshot/compare.js';
import { probePair } from '../../lib/replicate/parity/parity-probe.js';
import { composedSidecarPath } from '../../lib/streaming/block-markup-validate.js';
import { EDITABLE_PLUGIN_SLUG } from '../../blocks/editable-html-plugin.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');

const ctx = {
  textResult: (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] }),
  errorResult: (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true }),
} as unknown as HandlerContext;

function makeSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-site-'));
  writeFileSync(
    join(dir, 'index.html'),
    // Footer anchor sits INSIDE the <p> — bare-<a> direct children hit emitChild's
    // catch-all downgrade (href dropped; known limitation, tracked separately) and
    // would mask the permalink-rewrite wiring this fixture exists to prove.
    // Stage 1d: includes <link> + <script> so collectSourceAssets has linked assets to carry.
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body><header><nav><a href="about.html">About</a></nav></header><main><section id="hero"><h1>Hi</h1></section></main><footer><p>foot <a href="about.html">About</a></p></footer><script src="site.js"></script></body></html>',
  );
  writeFileSync(
    join(dir, 'about.html'),
    '<html><head><title>About</title></head><body><main><section id="who"><h2>Who</h2><p>Us</p></section></main></body></html>',
  );
  // Stage 1d carry: linked CSS + JS the collector picks up from the index.html document order.
  writeFileSync(join(dir, 'styles.css'), 'body { background: #f7f2e9; }\n.hero h1 { font-size: 4rem; }');
  writeFileSync(join(dir, 'site.js'), "document.documentElement.classList.add('js');");
  return dir;
}

function makeEditableIslandSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-editable-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Editable</title></head><body><main>' +
      '<section id="cards"><div class="card"><svg viewBox="0 0 1 1"><path d="M0 0"/></svg><p>Hi</p></div></section>' +
      '</main></body></html>',
  );
  return dir;
}

function makeCarriedHeaderSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-carried-header-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body><header class="bp-header"><p><a href="reviews.html">Reviews</a></p></header><main><section id="hero"><h1>Hi</h1></section></main></body></html>',
  );
  writeFileSync(
    join(dir, 'reviews.html'),
    '<html><head><title>Reviews</title></head><body><main><section id="reviews"><h2>Reviews</h2><p>Five stars.</p></section></main></body></html>',
  );
  writeFileSync(join(dir, 'styles.css'), '.bp-header { display: flex; gap: 1rem; }');
  return dir;
}

function makeHeaderWithOverlayMountSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-header-overlay-mount-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
      '<header class="site-header"><nav><a href="intro.html">Intro</a><a href="api.html">API</a></nav></header>' +
      '<div id="nav-overlay" aria-hidden="true"></div>' +
      '<main><section id="overview"><h1>Overview</h1><p>Welcome.</p></section></main>' +
      '<script src="site.js"></script>' +
      '</body></html>',
  );
  writeFileSync(join(dir, 'intro.html'), '<html><head><title>Intro</title></head><body><main><section id="intro"><h1>Intro</h1></section></main></body></html>');
  writeFileSync(join(dir, 'api.html'), '<html><head><title>API</title></head><body><main><section id="api"><h1>API</h1></section></main></body></html>');
  writeFileSync(join(dir, 'styles.css'), '.site-header { display: flex; gap: 1rem; } #nav-overlay { position: fixed; inset: 0; }');
  writeFileSync(join(dir, 'site.js'), "document.documentElement.classList.add('js-ready');");
  return dir;
}

function makeEmptyHeaderMountOnlySite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-empty-header-mount-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
      '<div id="siteHeader" class="runtime-header"></div>' +
      '<main><section id="hero"><h1>Hi</h1></section></main>' +
      '<script src="site.js"></script>' +
      '</body></html>',
  );
  writeFileSync(join(dir, 'styles.css'), '.runtime-header { min-height: 1px; }');
  writeFileSync(join(dir, 'site.js'), "document.getElementById('siteHeader')?.setAttribute('data-rendered', '1');");
  return dir;
}

function makeSideRailSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-side-rail-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
      '<header class="site-header"><p><a href="intro.html">Docs</a></p></header>' +
      '<div class="docs-layout"><aside id="nav" class="docs-sidebar"><nav>' +
      '<a href="intro.html">Intro</a><a href="api.html">API</a>' +
      '</nav></aside><main><section id="overview"><h1>Overview</h1><p>Welcome.</p></section></main></div>' +
      '</body></html>',
  );
  writeFileSync(
    join(dir, 'intro.html'),
    '<html><head><title>Intro</title></head><body><main><section id="intro"><h1>Intro</h1></section></main></body></html>',
  );
  writeFileSync(
    join(dir, 'api.html'),
    '<html><head><title>API</title></head><body><main><section id="api"><h1>API</h1></section></main></body></html>',
  );
  writeFileSync(join(dir, 'styles.css'), '.docs-sidebar { position: sticky; top: 0; }');
  return dir;
}

function makeHeaderOverlaySideRailSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-header-overlay-side-rail-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
      '<header class="site-header"><nav><a href="intro.html">Docs Home</a><a href="api.html">API Home</a></nav></header>' +
      '<div id="nav-overlay" aria-hidden="true"></div>' +
      '<div class="docs-layout"><aside id="sidebar" class="docs-sidebar"><nav>' +
      '<a href="intro.html">Intro</a><a href="api.html">API</a>' +
      '</nav></aside><main><section id="overview"><h1>Overview</h1><p>Welcome.</p></section></main></div>' +
      '<script src="site.js"></script>' +
      '</body></html>',
  );
  writeFileSync(join(dir, 'intro.html'), '<html><head><title>Intro</title></head><body><main><section id="intro"><h1>Intro</h1></section></main></body></html>');
  writeFileSync(join(dir, 'api.html'), '<html><head><title>API</title></head><body><main><section id="api"><h1>API</h1></section></main></body></html>');
  writeFileSync(join(dir, 'styles.css'), '.site-header { display: flex; } .docs-sidebar { position: sticky; top: 0; }');
  writeFileSync(join(dir, 'site.js'), "document.documentElement.classList.add('js-ready');");
  return dir;
}

function makeNavOverlayMountSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-nav-overlay-mount-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
      '<nav id="primary-nav"><a href="intro.html">Intro</a><a href="api.html">API</a></nav>' +
      '<div id="nav-overlay" aria-hidden="true"></div>' +
      '<main><section id="overview"><h1>Overview</h1><p>Welcome.</p></section></main>' +
      '<script src="site.js"></script>' +
      '</body></html>',
  );
  writeFileSync(join(dir, 'intro.html'), '<html><head><title>Intro</title></head><body><main><section id="intro"><h1>Intro</h1></section></main></body></html>');
  writeFileSync(join(dir, 'api.html'), '<html><head><title>API</title></head><body><main><section id="api"><h1>API</h1></section></main></body></html>');
  writeFileSync(join(dir, 'styles.css'), '#primary-nav { display: flex; gap: 1rem; }');
  writeFileSync(join(dir, 'site.js'), "document.documentElement.classList.add('js-ready');");
  return dir;
}

function makeHeaderWithDroppedStandaloneNavSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-header-dropped-standalone-nav-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
      '<header class="site-header"><nav><a href="about.html">Header About</a><a href="docs.html">Header Docs</a></nav></header>' +
      '<nav id="standalone-nav"><a href="intro.html">Standalone Intro</a><a href="api.html">Standalone API</a></nav>' +
      '<main><section id="hero"><h1>Hi</h1><p>Body content survives.</p></section></main>' +
      '</body></html>',
  );
  writeFileSync(join(dir, 'about.html'), '<html><head><title>About</title></head><body><main><section id="about"><h1>About</h1></section></main></body></html>');
  writeFileSync(join(dir, 'docs.html'), '<html><head><title>Docs</title></head><body><main><section id="docs"><h1>Docs</h1></section></main></body></html>');
  writeFileSync(join(dir, 'intro.html'), '<html><head><title>Intro</title></head><body><main><section id="intro"><h1>Intro</h1></section></main></body></html>');
  writeFileSync(join(dir, 'api.html'), '<html><head><title>API</title></head><body><main><section id="api"><h1>API</h1></section></main></body></html>');
  writeFileSync(join(dir, 'styles.css'), '.site-header { display: flex; gap: 1rem; } #standalone-nav { display: flex; gap: 1rem; }');
  return dir;
}

function makeHeaderWithStandaloneNavSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-standalone-nav-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
      '<header class="site-header"><p><a href="about.html">Header About</a></p></header>' +
      '<nav id="standalone-nav"><a href="standalone.html">Standalone Nav</a></nav>' +
      '<main><section id="hero"><h1>Hi</h1></section></main>' +
      '</body></html>',
  );
  writeFileSync(
    join(dir, 'about.html'),
    '<html><head><title>About</title></head><body><main><section id="about"><h1>About</h1></section></main></body></html>',
  );
  writeFileSync(
    join(dir, 'standalone.html'),
    '<html><head><title>Standalone</title></head><body><main><section id="standalone"><h1>Standalone</h1></section></main></body></html>',
  );
  writeFileSync(join(dir, 'styles.css'), '.site-header { display: flex; gap: 1rem; }');
  return dir;
}

function makeInteriorRailLeakSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-conservation-leak-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
      '<header id="site-header"><nav><a href="reference.html">Reference</a></nav></header>' +
      '<main><section id="home-copy"><h1>Home</h1><p>The home body is present in the emitted page content.</p></section></main>' +
      '</body></html>',
  );
  writeFileSync(
    join(dir, 'reference.html'),
    '<html><head><title>Reference</title><link rel="stylesheet" href="styles.css"></head><body>' +
      '<header id="site-header"><nav><a href="index.html">Home</a></nav></header>' +
      '<nav id="reference-rail" class="side-rail"><a href="setup.html">Setup</a><a href="api.html">API</a></nav>' +
      '<div class="layout">' +
      '<main><section id="reference-copy"><h1>Reference</h1><p>The reference body is present in the emitted page content.</p></section></main>' +
      '</div>' +
      '</body></html>',
  );
  writeFileSync(join(dir, 'styles.css'), '.site-header { display: flex; } .side-rail { position: sticky; top: 0; }');
  return dir;
}

function makeInteriorChromeRailSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-interior-chrome-rail-'));
  const header = '<header id="site-header" class="site-header"><nav><a href="index.html">Home</a><a href="intro.html">Intro</a><a href="api.html">API</a></nav></header>';
  const sidebar = (toc: string) =>
    '<aside id="sidebar" class="sidebar">' +
    '<nav class="sidebar-nav"><a href="intro.html">Intro</a><a href="api.html">API</a></nav>' +
    `<ol class="toc-list"><li><a href="#start">${toc}</a></li></ol>` +
    '</aside>';
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
      header +
      '<main><section id="home-copy"><h1>Home</h1><p>The home body is present.</p></section></main>' +
      '</body></html>',
  );
  writeFileSync(
    join(dir, 'intro.html'),
    '<html><head><title>Intro</title><link rel="stylesheet" href="styles.css"></head><body>' +
      header +
      '<div class="docs-layout">' +
      sidebar('Intro start') +
      '<main><section id="intro-copy"><h1>Intro</h1><p>The intro body is present.</p></section></main>' +
      '</div>' +
      '</body></html>',
  );
  writeFileSync(
    join(dir, 'api.html'),
    '<html><head><title>API</title><link rel="stylesheet" href="styles.css"></head><body>' +
      header +
      '<div class="docs-layout">' +
      sidebar('API start') +
      '<main><section id="api-copy"><h1>API</h1><p>The API body is present.</p></section></main>' +
      '</div>' +
      '</body></html>',
  );
  writeFileSync(join(dir, 'styles.css'), '.site-header { display: flex; } .sidebar { position: fixed; top: 0; } .sidebar-nav { display: grid; }');
  return dir;
}

function makeInteriorLayoutWrapperRailSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-interior-layout-wrapper-'));
  const header = '<header id="site-header"><nav><a href="index.html">Home</a><a href="intro.html">Intro</a></nav></header>';
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
      header +
      '<main><section id="home-copy"><h1>Home</h1><p>Home body.</p></section></main>' +
      '</body></html>',
  );
  writeFileSync(
    join(dir, 'intro.html'),
    '<html><head><title>Intro</title><link rel="stylesheet" href="styles.css"></head><body>' +
      header +
      '<div class="docs-grid content-shell">' +
      '<aside id="docs-rail" class="sidebar"><nav><a href="intro.html">Intro</a><a href="api.html">API</a></nav></aside>' +
      '<main><section id="intro-copy"><h1>Intro</h1><p>The intro body is present.</p></section></main>' +
      '</div>' +
      '</body></html>',
  );
  writeFileSync(join(dir, 'styles.css'), '.docs-grid { display: grid; grid-template-columns: 16rem 1fr; } .sidebar { position: sticky; top: 0; }');
  return dir;
}

function makeInteriorRailWithoutSharedWrapperSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-interior-flat-rail-'));
  const header = '<header id="site-header"><nav><a href="index.html">Home</a><a href="intro.html">Intro</a></nav></header>';
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
      header +
      '<main><section id="home-copy"><h1>Home</h1><p>Home body.</p></section></main>' +
      '</body></html>',
  );
  writeFileSync(
    join(dir, 'intro.html'),
    '<html><head><title>Intro</title><link rel="stylesheet" href="styles.css"></head><body>' +
      header +
      '<div class="rail-shell">' +
      '<aside id="docs-rail" class="sidebar"><nav><a href="intro.html">Intro</a><a href="api.html">API</a></nav></aside>' +
      '</div>' +
      '<main><section id="intro-copy"><h1>Intro</h1><p>The intro body is present.</p></section></main>' +
      '</body></html>',
  );
  writeFileSync(join(dir, 'styles.css'), '.rail-shell { display: contents; } .sidebar { position: sticky; top: 0; }');
  return dir;
}

function makeHomeComplementaryRailSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-home-complementary-rail-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title></head><body>' +
      '<div role="complementary" id="docs-rail"><a href="intro.html">Intro</a><a href="api.html">API</a></div>' +
      '<main><section id="home-copy"><h1>Home</h1><p>The home body remains installed.</p></section></main>' +
      '</body></html>',
  );
  writeFileSync(join(dir, 'intro.html'), '<html><head><title>Intro</title></head><body><main><section id="intro"><h1>Intro</h1></section></main></body></html>');
  writeFileSync(join(dir, 'api.html'), '<html><head><title>API</title></head><body><main><section id="api"><h1>API</h1></section></main></body></html>');
  return dir;
}

function makeRepeatedComplementaryBodySite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-repeated-complementary-body-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title></head><body>' +
      '<div role="complementary"><section><h2>First rail</h2><a href="intro.html">Intro</a><a href="api.html">API</a></section></div>' +
      '<div role="complementary"><section><h2>Second rail</h2><a href="intro.html">Intro</a><a href="contact.html">Contact</a></section></div>' +
      '<section><h1>Home</h1><p>The home body remains installed.</p></section>' +
      '</body></html>',
  );
  writeFileSync(join(dir, 'intro.html'), '<html><head><title>Intro</title></head><body><section><h1>Intro</h1></section></body></html>');
  writeFileSync(join(dir, 'api.html'), '<html><head><title>API</title></head><body><section><h1>API</h1></section></body></html>');
  writeFileSync(join(dir, 'contact.html'), '<html><head><title>Contact</title></head><body><section><h1>Contact</h1></section></body></html>');
  return dir;
}

function makeHomePlainAsideSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-home-plain-aside-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Home</title></head><body>' +
      '<aside id="promo-note">This aside is standalone source text, but it is not a nav or complementary rail.</aside>' +
      '<main><section id="home-copy"><h1>Home</h1><p>The home body remains installed.</p></section></main>' +
      '</body></html>',
  );
  return dir;
}

function makeFormSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-form-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><title>Contact</title><link rel="stylesheet" href="styles.css"></head><body><main><section id="contact"><h1>Contact</h1>' +
      '<form id="contact-form" class="contact-form" action="/contact" method="post">' +
      '<label for="contact-name">Name</label>' +
      '<input id="contact-name" name="name" autocomplete="name" type="text" required placeholder="Jane Doe">' +
      '<label for="contact-email">Email</label>' +
      '<input id="contact-email" name="email" type="email" required placeholder="jane@example.com">' +
      '<label for="contact-message">Message</label>' +
      '<textarea id="contact-message" name="message" required placeholder="How can we help?"></textarea>' +
      '<button type="submit">Send message</button>' +
      '</form></section></main></body></html>',
  );
  writeFileSync(join(dir, 'styles.css'), '.contact-form label { display: block; }\n.contact-form button { background: #2255aa; }');
  return dir;
}

/** Like makeSite but WITHOUT index.html — no 'home' slug, so no front page. */
function makeSiteNoHome(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-nohome-'));
  writeFileSync(
    join(dir, 'about.html'),
    '<html><head><title>About</title></head><body><main><section id="who"><h2>Who</h2><p>Us</p></section></main></body></html>',
  );
  return dir;
}

function makeStudioSite(): string {
  const sitePath = mkdtempSync(join(FIXTURE_TMP, 'cls-studio-'));
  mkdirSync(join(sitePath, 'wp-content'), { recursive: true });
  return sitePath;
}

function wpArgsForExecCall(call: string[]): string[] {
  const pathIndex = call.indexOf('--path');
  return pathIndex >= 0 ? call.slice(pathIndex + 2) : [];
}

function jetpackWpCalls(): string[][] {
  return execCalls.filter((call) => wpArgsForExecCall(call).some((arg) => arg.toLowerCase().includes('jetpack')));
}

function jetpackInstallCalls(): string[][] {
  const expected = Array.from(JETPACK_FORMS_PLUGIN_INSTALL.wpArgs);
  return execCalls.filter((call) => {
    const wpArgs = wpArgsForExecCall(call);
    return wpArgs.length === expected.length && expected.every((arg, index) => wpArgs[index] === arg);
  });
}

// Base compareScreenshotDirs result — re-established each test so once-values
// from repair tests don't leak (repair tests chain mockResolvedValueOnce on top).
const BASE_COMPARE_RESULT = {
  version: 1,
  comparedAt: 'TEST',
  results: [
    { pathname: '/', originUrl: 'o', replicaUrl: 'r', desktop: { status: 'ok', score: 0.91 }, mobile: { status: 'ok', score: 0.88 } },
    { pathname: '/about/', originUrl: 'o', replicaUrl: 'r', desktop: { status: 'ok', score: 0.95 }, mobile: { status: 'ok', score: 0.9 } },
  ],
};

beforeEach(() => {
  execCalls.length = 0;
  installedPosts.length = 0;
  capturedRuns.length = 0;
  finalizeCalls.length = 0;
  execFailFor = null;
  installFailFor = null;
  finalizeResultOverride = null;
  assembleLocalThemeCalls.length = 0;
  // Repair seam: reset per-test; repair tests set these before calling handler.
  repairReplicaManifestEntries = {};
  repairDiffPng = null;
  regionCensusFailure.throwOnExtract = false;
  // Reset + re-establish base for compare and probePair so unconsumed once-values
  // from a failing repair test can't bleed into subsequent tests.
  vi.mocked(compareScreenshotDirs).mockReset().mockResolvedValue(BASE_COMPARE_RESULT as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>);
  vi.mocked(probePair).mockReset().mockResolvedValue([]);
  buildJetpackFormParityCssMock.mockReset().mockReturnValue({ css: '' });
});

describe('convertLocalSiteHandler', () => {
  it('editableIslands: ingest converts text islands into bindable blocks', async () => {
    const dir = makeEditableIslandSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-editable-out-'));
    try {
      const res = await ingestLocalSiteHandler({ dir, outputDir: outDir, editableIslands: true }, ctx);
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { islandsConverted?: number };
      expect(summary.islandsConverted).toBeGreaterThan(0);

      const sidecar = readFileSync(composedSidecarPath(outDir, 'home'), 'utf8');
      expect(sidecar).toContain('<!-- wp:dla/editable-html ');
      expect(sidecar).toContain('<p>Hi</p>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('editableIslands: convert ships and activates the bindable plugin when islands convert', async () => {
    const dir = makeEditableIslandSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-editable-convert-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true, editableIslands: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { islandsConverted?: number };
      expect(summary.islandsConverted).toBeGreaterThan(0);
      expect(existsSync(join(sitePath, 'wp-content', 'plugins', EDITABLE_PLUGIN_SLUG, 'plugin.php'))).toBe(true);
      expect(existsSync(join(sitePath, 'wp-content', 'plugins', EDITABLE_PLUGIN_SLUG, 'blocks', 'editable-html', 'editor.js'))).toBe(true);
      const flat = execCalls.map((c) => c.join(' '));
      expect(flat.some((c) => c.includes(`plugin activate ${EDITABLE_PLUGIN_SLUG}`))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('runs the full pipeline: sidecars → theme files on disk → pages installed → front page set', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-out-'));
    try {
      const res = await convertLocalSiteHandler(
        {
          dir,
          studioSitePath: sitePath,
          outputDir: outDir,
          themeSlug: 'acme-local',
          siteTitle: 'Acme',
          skipDesign: true,
        },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        pages: number; installed: number; themeSlug: string; frontPageSet: boolean; emptySidecars: string[];
        ingest: { lowConfidence: number; failedPageCount: number; failedPagesList: Array<{ slug: string; error: string }> };
      };
      expect(summary.pages).toBe(2);
      expect(summary.installed).toBe(2);
      expect(summary.themeSlug).toBe('acme-local');
      expect(summary.frontPageSet).toBe(true);
      expect(summary.emptySidecars).toEqual([]);
      // stage-1a quality signals forwarded into the summary
      expect(summary.ingest.lowConfidence).toBe(0);
      // theme written into the studio site
      expect(existsSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'theme.json'))).toBe(true);
      expect(existsSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'templates', 'page-local.html'))).toBe(true);
      // footer hrefs rewritten to WP permalinks (source-relative about.html 404s on WP)
      const footerHtml = readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'parts', 'footer.html'), 'utf8');
      expect(footerHtml).toContain('href="/about/"');
      expect(footerHtml).not.toContain('about.html');
      // pages installed via installPost with synthetic source urls
      expect(installedPosts.map((p) => p.slug).sort()).toEqual(['about', 'home']);
      expect(installedPosts[0].sourceUrl.startsWith('local-site:')).toBe(true);
      // studio wp argv calls remain ONLY for activate + cache flush (constant-arg
      // commands); blogname/template/front-page ride the finalize eval-file call.
      const flat = execCalls.map((c) => c.join(' '));
      expect(flat.some((c) => c.includes('theme activate acme-local'))).toBe(true);
      expect(flat.some((c) => c.includes('cache flush'))).toBe(true);
      expect(flat.some((c) => c.includes('option update blogname'))).toBe(false);
      expect(flat.some((c) => c.includes('_wp_page_template'))).toBe(false);
      expect(flat.some((c) => c.includes('show_on_front'))).toBe(false);
      expect(flat.some((c) => c.includes('page_on_front'))).toBe(false);
      // ONE consolidated finalize call carries blogname + template assigns +
      // front page (core/site-title renders blogname — wrong value = wrong brand).
      expect(finalizeCalls).toHaveLength(1);
      const { payload } = finalizeCalls[0];
      expect(payload.options).toEqual({ blogname: 'Acme' });
      const assigns = [...payload.templateAssigns].sort((a, b) => a.slug.localeCompare(b.slug));
      expect(assigns.map((a) => ({ slug: a.slug, template: a.template }))).toEqual([
        { slug: 'about', template: 'page-local' },
        { slug: 'home', template: 'page-local' },
      ]);
      // frontPageId is the HOME page's postId.
      const homeAssign = payload.templateAssigns.find((a) => a.slug === 'home');
      expect(payload.frontPageId).toBe(homeAssign?.postId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('normalizes a ~ studioSitePath to an absolute path at entry (belt-and-suspenders)', async () => {
    // Regression: a `~/Studio/x` site path (the canonical input the skill
    // documents) must be expanded ONCE at the handler entry so no downstream
    // path use — the studio CLI `--path`, the `.dla-scripts` host writes feeding
    // `wp eval-file`, the wp-root probe — ever sees a bare `~`. `path.resolve`
    // treats `~` as a literal segment, so an un-normalized tilde scattered the
    // install scripts into a junk `<cwd>/~/Studio/x` dir while `studio` expanded
    // the real path → every eval-file install failed with "does not exist".
    const dir = makeSite();
    const sitePath = makeStudioSite(); // absolute temp dir, under cwd (=> under $HOME)
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-out-'));
    // Precondition: the fixture tree is under $HOME, so it has a tilde form.
    expect(sitePath.startsWith(homedir() + '/')).toBe(true);
    const tildePath = '~' + sitePath.slice(homedir().length);
    const junkTildeDir = join(process.cwd(), '~');
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: tildePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      // No studio CLI call may carry a literal `~` argument.
      const tildeArgs = execCalls.filter((c) => c.some((a) => typeof a === 'string' && a.includes('~')));
      expect(tildeArgs).toEqual([]);
      // Every `--path` passed to studio must be the resolved ABSOLUTE site dir.
      const pathArgs = execCalls.flatMap((c) => {
        const i = c.indexOf('--path');
        return i >= 0 ? [c[i + 1]] : [];
      });
      expect(pathArgs.length).toBeGreaterThan(0);
      for (const p of pathArgs) expect(p).toBe(sitePath);
      // Direct proof of the actual bug: no literal-`~` junk dir in cwd.
      expect(existsSync(junkTildeDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
      rmSync(junkTildeDir, { recursive: true, force: true });
    }
  });

  it('continues with a warning (not isError) when theme activate fails', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-out-'));
    execFailFor = 'theme activate';
    try {
      const res = await convertLocalSiteHandler(
        {
          dir,
          studioSitePath: sitePath,
          outputDir: outDir,
          themeSlug: 'acme-local',
          siteTitle: 'Acme',
          skipDesign: true,
        },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { installed: number; warnings: string[] };
      expect(summary.warnings.length).toBeGreaterThan(0);
      expect(summary.warnings.some((w) => w.includes('theme activate failed'))).toBe(true);
      expect(summary.installed).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('isolates a per-page installPost failure into failedInstalls', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-out-'));
    installFailFor = 'about';
    try {
      const res = await convertLocalSiteHandler(
        {
          dir,
          studioSitePath: sitePath,
          outputDir: outDir,
          themeSlug: 'acme-local',
          siteTitle: 'Acme',
          skipDesign: true,
        },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        installed: number; failedInstalls: Array<{ slug: string; error: string }>;
      };
      expect(summary.installed).toBe(1);
      expect(summary.failedInstalls.map((f) => f.slug)).toEqual(['about']);
      expect(installedPosts.map((p) => p.slug)).toEqual(['home']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('skips front-page set when the site has no home page', async () => {
    const dir = makeSiteNoHome();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { installed: number; frontPageSet: boolean };
      expect(summary.installed).toBe(1);
      expect(summary.frontPageSet).toBe(false);
      // No home page → the finalize payload carries NO frontPageId (and the
      // mock's applied.frontPage=false flows into frontPageSet above).
      expect(finalizeCalls).toHaveLength(1);
      expect(finalizeCalls[0].payload.frontPageId).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('maps per-item finalize errors to the per-command warning prefixes', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-finerr-'));
    // Per-item granularity: blogname + the about template fail, front page
    // succeeds — frontPageSet must still come from applied.frontPage.
    finalizeResultOverride = async (payload) => ({
      ok: false,
      applied: {
        options: [],
        templates: payload.templateAssigns.filter((t) => t.slug !== 'about').map((t) => t.postId),
        frontPage: true,
      },
      errors: [
        { item: 'option:blogname', error: 'option verify failed after update_option' },
        { item: 'template:about', error: 'meta verify failed after update_post_meta' },
      ],
    });
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { frontPageSet: boolean; warnings: string[] };
      // Same prefixes the old per-command path emitted (log greps keep working).
      expect(summary.warnings).toContain('blogname set failed: option verify failed after update_option');
      expect(summary.warnings).toContain('template assign failed for about: meta verify failed after update_post_meta');
      expect(summary.frontPageSet).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('degrades a whole-call finalize failure to one warning and frontPageSet=false', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-finfail-'));
    // Transport-level failure (IPC timeout / garbage stdout) → finalizeSite rejects.
    finalizeResultOverride = async () => {
      throw new Error('Timeout waiting for response to message wp-cli-command: No activity for 120s');
    };
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { frontPageSet: boolean; warnings: string[]; installed: number };
      expect(summary.frontPageSet).toBe(false);
      expect(summary.installed).toBe(2); // pages still installed — finalize failure never aborts
      const finalizeWarnings = summary.warnings.filter((w) => w.startsWith('site finalize failed'));
      expect(finalizeWarnings).toHaveLength(1);
      // The single warning lists everything that was attempted.
      expect(finalizeWarnings[0]).toContain('option blogname');
      expect(finalizeWarnings[0]).toContain('template home');
      expect(finalizeWarnings[0]).toContain('template about');
      expect(finalizeWarnings[0]).toContain('front page');
      expect(finalizeWarnings[0]).toContain('No activity for 120s');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('errors when studioSitePath has no wp-content', async () => {
    const dir = makeSite();
    const bogus = mkdtempSync(join(FIXTURE_TMP, 'cls-nowp-'));
    try {
      const res = await convertLocalSiteHandler({ dir, studioSitePath: bogus, outputDir: dir }, ctx);
      expect(res.isError).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(bogus, { recursive: true, force: true });
    }
  });

  it('errors when dir is missing', async () => {
    const res = await convertLocalSiteHandler({ studioSitePath: '/x' }, ctx);
    expect(res.isError).toBe(true);
  });

  it('carries source css/js into the installed theme by default', async () => {
    const dir = makeSite(); // includes styles.css + site.js
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-carry-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { carried: { css: boolean; js: boolean } };
      expect(summary.carried).toEqual({ css: true, js: true });
      const themeDir = join(sitePath, 'wp-content', 'themes', 'acme-local');
      expect(existsSync(join(themeDir, 'assets', 'css', 'source.css'))).toBe(true);
      expect(existsSync(join(themeDir, 'assets', 'js', 'source.js'))).toBe(true);
      // carry mode strips theme.json styles — source CSS is the design authority
      const themeJson = JSON.parse(readFileSync(join(themeDir, 'theme.json'), 'utf8')) as { styles?: unknown };
      expect(themeJson.styles).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('writes Jetpack form parity CSS to the live theme and output mirror when forms converted and CSS is non-empty', async () => {
    const dir = makeFormSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-form-out-'));
    buildJetpackFormParityCssMock.mockReturnValue({ css: '.wp-block-jetpack-contact-form{gap:1rem}' });
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      expect(buildJetpackFormParityCssMock).toHaveBeenCalledTimes(1);
      const calls = buildJetpackFormParityCssMock.mock.calls as unknown as Array<[{ sourceCss: string; formsConverted: number }]>;
      const call = calls[0][0];
      expect(call.formsConverted).toBeGreaterThanOrEqual(1);
      expect(call.sourceCss).toContain('.contact-form');

      const themeDir = join(sitePath, 'wp-content', 'themes', 'acme-local');
      const themeAsset = join(themeDir, JETPACK_FORM_PARITY_CSS.themeRelativePath);
      expect(existsSync(themeAsset)).toBe(true);
      expect(readFileSync(themeAsset, 'utf8')).toBe('.wp-block-jetpack-contact-form{gap:1rem}\n');
      const outAsset = join(outDir, JETPACK_FORM_PARITY_CSS.outputFileName);
      expect(existsSync(outAsset)).toBe(true);
      expect(readFileSync(outAsset, 'utf8')).toBe('.wp-block-jetpack-contact-form{gap:1rem}\n');

      const fns = readFileSync(join(themeDir, 'functions.php'), 'utf8');
      expect(fns).toContain("wp_enqueue_style( 'acme-local-jetpack-form-parity'");
      expect(fns).toContain(
        "'assets/css/source.css', 'assets/css/instance-styles.css', 'assets/css/jetpack-form-parity.css', 'assets/css/parity-patch.css'",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('installs and activates Jetpack and the contact-form module when forms were converted', async () => {
    const dir = makeFormSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-form-jetpack-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      expect(buildJetpackFormParityCssMock).toHaveBeenCalledTimes(1);
      const calls = buildJetpackFormParityCssMock.mock.calls as unknown as Array<[{ formsConverted: number }]>;
      expect(calls[0][0].formsConverted).toBeGreaterThanOrEqual(1);
      expect(jetpackWpCalls().map(wpArgsForExecCall)).toEqual(JETPACK_FORMS_COMMAND_SEQUENCE.map((wpArgs) => Array.from(wpArgs)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('does not issue Jetpack wp-cli commands when no forms were converted', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-no-form-jetpack-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      expect(buildJetpackFormParityCssMock).not.toHaveBeenCalled();
      expect(jetpackWpCalls()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('continues with a warning when Jetpack install and activation fails', async () => {
    const dir = makeFormSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-form-jetpack-fail-out-'));
    execFailFor = JETPACK_FORMS_PLUGIN_INSTALL.wpArgs.join(' ');
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { installed: number; warnings: string[] };
      expect(summary.installed).toBe(1);
      expect(jetpackInstallCalls()).toHaveLength(1);
      expect(jetpackWpCalls().map(wpArgsForExecCall)).toEqual([Array.from(JETPACK_FORMS_PLUGIN_INSTALL.wpArgs)]);
      const warning = summary.warnings.find((w) => w.includes('Jetpack') && w.includes('WordPress.com connection'));
      expect(warning).toContain(JETPACK_FORMS_PLUGIN_INSTALL.warningPrefix);
      expect(warning).toContain(JETPACK_FORMS_PLUGIN_INSTALL.localFormsNote);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('continues with a warning when Jetpack contact-form module activation fails', async () => {
    const dir = makeFormSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-form-jetpack-module-fail-out-'));
    execFailFor = JETPACK_FORMS_MODULE_ACTIVATE.wpArgs.join(' ');
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { installed: number; warnings: string[] };
      expect(summary.installed).toBe(1);
      expect(jetpackWpCalls().map(wpArgsForExecCall)).toEqual(JETPACK_FORMS_COMMAND_SEQUENCE.map((wpArgs) => Array.from(wpArgs)));
      const warning = summary.warnings.find((w) => w.includes(JETPACK_FORMS_MODULE_ACTIVATE.warningPrefix));
      expect(warning).toContain(JETPACK_FORMS_MODULE_ACTIVATE.warningPrefix);
      expect(warning).toContain(JETPACK_FORMS_MODULE_ACTIVATE.localFormsNote);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('does not write or enqueue Jetpack form parity CSS when no forms were converted', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-no-form-out-'));
    buildJetpackFormParityCssMock.mockReturnValue({ css: '.wp-block-jetpack-contact-form{gap:1rem}' });
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      expect(buildJetpackFormParityCssMock).not.toHaveBeenCalled();
      const themeDir = join(sitePath, 'wp-content', 'themes', 'acme-local');
      expect(existsSync(join(themeDir, JETPACK_FORM_PARITY_CSS.themeRelativePath))).toBe(false);
      expect(existsSync(join(outDir, JETPACK_FORM_PARITY_CSS.outputFileName))).toBe(false);
      expect(readFileSync(join(themeDir, 'functions.php'), 'utf8')).not.toContain('jetpack-form-parity');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('does not write or enqueue Jetpack form parity CSS when the builder returns empty CSS', async () => {
    const dir = makeFormSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-form-empty-css-out-'));
    buildJetpackFormParityCssMock.mockReturnValue({ css: '' });
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      expect(buildJetpackFormParityCssMock).toHaveBeenCalledTimes(1);
      const themeDir = join(sitePath, 'wp-content', 'themes', 'acme-local');
      expect(existsSync(join(themeDir, JETPACK_FORM_PARITY_CSS.themeRelativePath))).toBe(false);
      expect(existsSync(join(outDir, JETPACK_FORM_PARITY_CSS.outputFileName))).toBe(false);
      expect(readFileSync(join(themeDir, 'functions.php'), 'utf8')).not.toContain('jetpack-form-parity');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('carries a static source header part when chrome is carried', async () => {
    const dir = makeCarriedHeaderSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-carried-header-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const headerHtml = readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'parts', 'header.html'), 'utf8');
      expect(headerHtml).toContain('bp-header');
      expect(headerHtml).toContain('href="/reviews/"');
      expect(headerHtml).not.toContain('wp:site-title');
      expect(headerHtml).not.toContain('wp:navigation');
      expect(headerHtml).not.toMatch(/<header\b/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('prefers a contentful source header over an empty aria-hidden mount', async () => {
    const dir = makeHeaderWithOverlayMountSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-header-overlay-mount-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const headerHtml = readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'parts', 'header.html'), 'utf8');
      expect(headerHtml).toContain('site-header');
      expect(headerHtml).toContain('Intro');
      expect(headerHtml).toContain('API');
      expect(headerHtml).not.toContain('nav-overlay');
      expect(headerHtml).not.toContain('wp:site-title');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('preserves the empty header mount path when no real source header exists', async () => {
    const dir = makeEmptyHeaderMountOnlySite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-empty-header-mount-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const headerHtml = readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'parts', 'header.html'), 'utf8');
      expect(headerHtml).toContain('"anchor":"siteHeader"');
      expect(headerHtml).toContain('<div id="siteHeader" class="wp-block-group runtime-header"></div>');
      expect(headerHtml).not.toContain('wp:site-title');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('carries a layout-level side rail into the source header part', async () => {
    const dir = makeSideRailSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-side-rail-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const headerHtml = readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'parts', 'header.html'), 'utf8');
      expect(headerHtml).toContain('site-header');
      expect(headerHtml).toContain('docs-sidebar');
      expect(headerHtml).toContain('Intro');
      expect(headerHtml).toContain('href="/api/"');
      const homeBody = readFileSync(join(outDir, 'composed', 'home.blocks.html'), 'utf8');
      expect(homeBody).toContain('Overview');
      expect(homeBody).not.toContain('docs-sidebar');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('carries a recognized layout rail into the rendered header part when a real header beats an empty mount', async () => {
    const dir = makeHeaderOverlaySideRailSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-header-overlay-side-rail-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const headerHtml = readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'parts', 'header.html'), 'utf8');
      expect(headerHtml).toContain('site-header');
      expect(headerHtml).toContain('docs-sidebar');
      expect(headerHtml).toContain('Intro');
      expect(headerHtml).toContain('API');
      expect(headerHtml).not.toContain('nav-overlay');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('does not fold a standalone body-direct nav into the carried header part', async () => {
    const dir = makeHeaderWithStandaloneNavSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-standalone-nav-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const headerHtml = readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'parts', 'header.html'), 'utf8');
      expect(headerHtml).toContain('site-header');
      expect(headerHtml).toContain('Header About');
      expect(headerHtml).not.toContain('standalone-nav');
      expect(headerHtml).not.toContain('Standalone Nav');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('bases local region audit on rendered header markup when chrome intent is dropped', async () => {
    const dir = makeNavOverlayMountSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-region-audit-rendered-drop-out-'));
    try {
      const res = await convertLocalSiteHandler(
        {
          dir,
          studioSitePath: sitePath,
          outputDir: outDir,
          themeSlug: 'acme-local',
          siteTitle: 'Acme',
          skipDesign: true,
          failOnConservationRailDrop: true,
        },
        ctx,
      );
      expect(res.isError).toBe(true);
      const summary = JSON.parse(res.content[0].text) as {
        conservation: { ok: boolean; status: string; unassignedRegions: number; hardFailRegions: number };
      };
      expect(summary.conservation).toMatchObject({
        ok: false,
        status: 'fail',
        unassignedRegions: 1,
        hardFailRegions: 1,
      });
      const report = JSON.parse(readFileSync(join(outDir, 'region-audit.json'), 'utf8')) as {
        pages: Array<{ assignments: Array<{ landmark: { selector: string; role: string }; kind: string }> }>;
      };
      expect(report.pages[0].assignments).toContainEqual({
        landmark: expect.objectContaining({ selector: 'nav#primary-nav', role: 'nav' }),
        kind: 'unassigned',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('does not let a rendered header mask a separate dropped standalone nav in region audit', async () => {
    const dir = makeHeaderWithDroppedStandaloneNavSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-region-audit-rendered-header-dropped-nav-out-'));
    try {
      const res = await convertLocalSiteHandler(
        {
          dir,
          studioSitePath: sitePath,
          outputDir: outDir,
          themeSlug: 'acme-local',
          siteTitle: 'Acme',
          skipDesign: true,
          failOnConservationRailDrop: true,
        },
        ctx,
      );
      expect(res.isError).toBe(true);
      const summary = JSON.parse(res.content[0].text) as {
        conservation: { ok: boolean; status: string; unassignedRegions: number; hardFailRegions: number };
      };
      expect(summary.conservation).toMatchObject({
        ok: false,
        status: 'fail',
        unassignedRegions: 1,
        hardFailRegions: 1,
      });
      const headerHtml = readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'parts', 'header.html'), 'utf8');
      expect(headerHtml).toContain('site-header');
      expect(headerHtml).not.toContain('standalone-nav');
      const report = JSON.parse(readFileSync(join(outDir, 'region-audit.json'), 'utf8')) as {
        pages: Array<{ assignments: Array<{ landmark: { selector: string; role: string }; kind: string }> }>;
      };
      expect(report.pages[0].assignments).toContainEqual({
        landmark: expect.objectContaining({ selector: 'header.site-header', role: 'header' }),
        kind: 'header_part',
      });
      expect(report.pages[0].assignments).toContainEqual({
        landmark: expect.objectContaining({ selector: 'nav#standalone-nav', role: 'nav' }),
        kind: 'unassigned',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('bases local region audit on rendered header markup when carried chrome is present', async () => {
    const dir = makeHeaderOverlaySideRailSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-region-audit-rendered-present-out-'));
    try {
      const res = await convertLocalSiteHandler(
        {
          dir,
          studioSitePath: sitePath,
          outputDir: outDir,
          themeSlug: 'acme-local',
          siteTitle: 'Acme',
          skipDesign: true,
          failOnConservationRailDrop: true,
        },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        conservation: { ok: boolean; status: string; unassignedRegions: number; hardFailRegions: number };
      };
      expect(summary.conservation).toMatchObject({
        ok: true,
        status: 'pass',
        unassignedRegions: 0,
        hardFailRegions: 0,
      });
      const report = JSON.parse(readFileSync(join(outDir, 'region-audit.json'), 'utf8')) as {
        pages: Array<{ assignments: Array<{ landmark: { selector: string; role: string }; kind: string }> }>;
      };
      expect(report.pages[0].assignments).toContainEqual({
        landmark: expect.objectContaining({ selector: 'header.site-header', role: 'header' }),
        kind: 'header_part',
      });
      expect(report.pages[0].assignments).toContainEqual({
        landmark: expect.objectContaining({ selector: 'aside#sidebar.docs-sidebar', role: 'aside' }),
        kind: 'header_part',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('reports conservation leaks in textResult and artifact without changing install results', async () => {
    const dir = makeInteriorRailLeakSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-conservation-leak-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        pages: number;
        installed: number;
        themeSlug: string;
        frontPageSet: boolean;
        conservationLeaks: { count: number; artifact: string };
      };
      expect(summary.pages).toBe(2);
      expect(summary.installed).toBe(2);
      expect(summary.themeSlug).toBe('acme-local');
      expect(summary.frontPageSet).toBe(true);
      expect(summary.conservationLeaks.count).toBe(1);
      expect(summary.conservationLeaks.artifact).toBe(join(outDir, 'conservation-leaks.json'));

      const report = JSON.parse(readFileSync(join(outDir, 'conservation-leaks.json'), 'utf8')) as {
        schema: number;
        site: string;
        leaks: Array<{ selector: string; role: string; pageSlug: string; reason: string }>;
      };
      expect(report.schema).toBe(1);
      expect(report.site).toBe(dir);
      expect(report.leaks).toEqual([
        {
          selector: 'nav#reference-rail.side-rail',
          role: 'nav',
          pageSlug: 'reference',
          reason: 'actionable_region_unplaced',
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('renders interior-only layout rails as page-scoped theme chrome and clears their leak', async () => {
    const dir = makeInteriorChromeRailSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-interior-chrome-rail-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        conservationLeaks: { count: number; artifact: string };
      };
      expect(summary.conservationLeaks.count).toBe(0);

      const themeDir = join(sitePath, 'wp-content', 'themes', 'acme-local');
      const headerHtml = readFileSync(join(themeDir, 'parts', 'header.html'), 'utf8');
      expect(headerHtml).toContain('site-header');
      expect(headerHtml).not.toContain('sidebar-nav');

      const introPart = readFileSync(join(themeDir, 'parts', 'interior-chrome-intro.html'), 'utf8');
      const apiPart = readFileSync(join(themeDir, 'parts', 'interior-chrome-api.html'), 'utf8');
      expect(introPart).toContain('class="sidebar"');
      expect(introPart).toContain('class="sidebar-nav"');
      expect(introPart).toContain('href="/api/"');
      expect(introPart).toContain('Intro start');
      expect(introPart).not.toContain('API start');
      expect(apiPart).toContain('API start');
      expect(apiPart).not.toContain('Intro start');

      const introTemplate = readFileSync(join(themeDir, 'templates', 'page-local-intro-chrome.html'), 'utf8');
      const apiTemplate = readFileSync(join(themeDir, 'templates', 'page-local-api-chrome.html'), 'utf8');
      expect(introTemplate).toContain('wp:template-part {"slug":"interior-chrome-intro","tagName":"aside"}');
      expect(apiTemplate).toContain('wp:template-part {"slug":"interior-chrome-api","tagName":"aside"}');
      expect(readFileSync(join(themeDir, 'templates', 'front-page.html'), 'utf8')).not.toContain('interior-chrome');
      expect(readFileSync(join(themeDir, 'templates', 'page-local.html'), 'utf8')).not.toContain('interior-chrome');

      const assigns = [...finalizeCalls[0].payload.templateAssigns].sort((a, b) => a.slug.localeCompare(b.slug));
      expect(assigns.map((a) => ({ slug: a.slug, template: a.template }))).toEqual([
        { slug: 'api', template: 'page-local-api-chrome' },
        { slug: 'home', template: 'page-local' },
        { slug: 'intro', template: 'page-local-intro-chrome' },
      ]);

      const introPost = installedPosts.find((p) => p.slug === 'intro')?.content ?? '';
      const apiPost = installedPosts.find((p) => p.slug === 'api')?.content ?? '';
      expect(introPost).toContain('The intro body is present.');
      expect(introPost).not.toContain('sidebar-nav');
      expect(introPost).not.toContain('Intro start');
      expect(apiPost).toContain('The API body is present.');
      expect(apiPost).not.toContain('sidebar-nav');
      expect(apiPost).not.toContain('API start');

      const report = JSON.parse(readFileSync(join(outDir, 'conservation-leaks.json'), 'utf8')) as {
        leaks: Array<{ pageSlug: string; selector: string }>;
      };
      expect(report.leaks).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('threads source layout wrapper metadata for interior layout rails', async () => {
    const dir = makeInteriorLayoutWrapperRailSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-interior-layout-wrapper-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();

      const templates = assembleLocalThemeCalls[0].interiorChromeTemplates ?? [];
      const intro = templates.find((t) => t.partSlug === 'interior-chrome-intro');
      expect(intro).toMatchObject({
        layoutWrapperTag: 'div',
        layoutWrapperClasses: ['docs-grid', 'content-shell'],
        layoutWrapperRailPosition: 'beforeMain',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('leaves interior layout rail metadata unset when the rail parent does not contain main', async () => {
    const dir = makeInteriorRailWithoutSharedWrapperSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-interior-flat-rail-out-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();

      const templates = assembleLocalThemeCalls[0].interiorChromeTemplates ?? [];
      const intro = templates.find((t) => t.partSlug === 'interior-chrome-intro');
      expect(intro).toMatchObject({ partSlug: 'interior-chrome-intro' });
      expect(intro?.layoutWrapperTag).toBeUndefined();
      expect(intro?.layoutWrapperClasses).toBeUndefined();
      expect(intro?.layoutWrapperRailPosition).toBeUndefined();

      const template = readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'templates', 'page-local-intro-chrome.html'), 'utf8');
      expect(template).toContain('wp:template-part {"slug":"interior-chrome-intro","tagName":"aside"}');
      expect(template).not.toContain('rail-shell');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('reports local region-audit conservation as warn by default without changing install summary fields', async () => {
    const dir = makeHomeComplementaryRailSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-region-audit-warn-out-'));
    try {
      const res = await convertLocalSiteHandler(
        {
          dir,
          studioSitePath: sitePath,
          outputDir: outDir,
          themeSlug: 'acme-local',
          siteTitle: 'Acme',
          skipDesign: true,
          carryCss: false,
        },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        pages: number;
        installed: number;
        themeSlug: string;
        frontPageSet: boolean;
        conservationLeaks: { count: number; artifact: string };
        conservation: { ok: boolean; status: string; unassignedRegions: number; hardFailRegions: number; artifact: string };
      };
      expect(summary.pages).toBe(3);
      expect(summary.installed).toBe(3);
      expect(summary.themeSlug).toBe('acme-local');
      expect(summary.frontPageSet).toBe(true);
      expect(summary.conservationLeaks.artifact).toBe(join(outDir, 'conservation-leaks.json'));
      expect(summary.conservation.status).toBe('warn');
      expect(summary.conservation.ok).toBe(true);
      expect(summary.conservation.unassignedRegions).toBe(1);
      expect(summary.conservation.hardFailRegions).toBe(0);
      expect(summary.conservation.artifact).toBe(join(outDir, 'region-audit.json'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('hard-fails only an opt-in unassigned real rail', async () => {
    const dir = makeHomeComplementaryRailSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-region-audit-fail-out-'));
    try {
      const res = await convertLocalSiteHandler(
        {
          dir,
          studioSitePath: sitePath,
          outputDir: outDir,
          themeSlug: 'acme-local',
          siteTitle: 'Acme',
          skipDesign: true,
          carryCss: false,
          failOnConservationRailDrop: true,
        },
        ctx,
      );
      expect(res.isError).toBe(true);
      const summary = JSON.parse(res.content[0].text) as {
        conservation: { ok: boolean; status: string; unassignedRegions: number; hardFailRegions: number };
      };
      expect(summary.conservation).toMatchObject({
        ok: false,
        status: 'fail',
        unassignedRegions: 1,
        hardFailRegions: 1,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('does not hard-fail an unassigned plain aside outside the hard-fail role set', async () => {
    const dir = makeHomePlainAsideSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-region-audit-aside-out-'));
    try {
      const res = await convertLocalSiteHandler(
        {
          dir,
          studioSitePath: sitePath,
          outputDir: outDir,
          themeSlug: 'acme-local',
          siteTitle: 'Acme',
          skipDesign: true,
          carryCss: false,
          failOnConservationRailDrop: true,
        },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        conservation: { ok: boolean; status: string; unassignedRegions: number; hardFailRegions: number };
      };
      expect(summary.conservation).toMatchObject({
        ok: true,
        status: 'warn',
        unassignedRegions: 1,
        hardFailRegions: 0,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('does not hard-fail a placed repeated classless complementary landmark with a positional selector', async () => {
    const dir = makeRepeatedComplementaryBodySite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-region-audit-positional-out-'));
    try {
      const res = await convertLocalSiteHandler(
        {
          dir,
          studioSitePath: sitePath,
          outputDir: outDir,
          themeSlug: 'acme-local',
          siteTitle: 'Acme',
          skipDesign: true,
          failOnConservationRailDrop: true,
        },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        conservation: { ok: boolean; status: string; unassignedRegions: number; hardFailRegions: number };
      };
      expect(summary.conservation).toMatchObject({
        ok: true,
        status: 'pass',
        unassignedRegions: 0,
        hardFailRegions: 0,
      });
      const report = JSON.parse(readFileSync(join(outDir, 'region-audit.json'), 'utf8')) as {
        pages: Array<{ assignments: Array<{ landmark: { selector: string; role: string }; kind: string }> }>;
      };
      const complementaryAssignments = report.pages[0].assignments.filter((a) => a.landmark.role === 'complementary');
      expect(complementaryAssignments.map((a) => [a.landmark.selector, a.kind])).toEqual([
        ['div:nth-of-type(1)', 'page_body_section'],
        ['div:nth-of-type(2)', 'page_body_section'],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('degrades local region-audit census failures to a warning without failing conversion', async () => {
    const dir = makeHomeComplementaryRailSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-region-audit-throw-out-'));
    regionCensusFailure.throwOnExtract = true;
    try {
      const res = await convertLocalSiteHandler(
        {
          dir,
          studioSitePath: sitePath,
          outputDir: outDir,
          themeSlug: 'acme-local',
          siteTitle: 'Acme',
          skipDesign: true,
          failOnConservationRailDrop: true,
        },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        conservation: { ok: boolean; status: string; unassignedRegions: number; hardFailRegions: number };
        warnings: string[];
      };
      expect(summary.conservation).toMatchObject({
        ok: true,
        status: 'pass',
        unassignedRegions: 0,
        hardFailRegions: 0,
      });
      expect(summary.warnings).toContain('region audit failed: synthetic region census failure');
    } finally {
      regionCensusFailure.throwOnExtract = false;
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('carryCss false skips the carry (tokens-only theme)', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-nocarry-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', skipDesign: true, carryCss: false },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { carried: { css: boolean; js: boolean } };
      expect(summary.carried.css).toBe(false);
      expect(existsSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'assets', 'css', 'source.css'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('runs design capture + compare and reports parity', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-design-'));
    try {
      const res = await convertLocalSiteHandler(
        // repair:false: keeps capturedRuns at 2 (source+replica); this test does
        // not exercise the repair loop — see the dedicated repair-loop tests below.
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', repair: false },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        parity?: {
          floor: number;
          allPass: boolean;
          avgDesktop: number;
          avgMobile: number;
          pages: Array<{ pathname: string; desktop: number | null; mobile: number | null; passes: boolean }>;
        };
        designCaptured?: boolean;
      };
      expect(summary.designCaptured).toBe(true);
      expect(summary.parity?.avgDesktop).toBeCloseTo(0.93, 2);
      expect(summary.parity?.pages).toHaveLength(2);
      expect(capturedRuns).toHaveLength(2);                       // source + replica
      expect(capturedRuns[0].urls.some((u) => u.endsWith('/about/'))).toBe(true); // clean URLs
      // replica capture targets the studio-resolved siteurl (mock returns :7777),
      // NOT a hardcoded default port — wrong port = capture of the wrong site.
      expect(capturedRuns[1].urls.length).toBeGreaterThan(0);
      expect(capturedRuns[1].urls.every((u) => u.startsWith('http://localhost:7777'))).toBe(true);
      // foundation → assemble → install end-to-end: the mock aggregates' accent
      // color lands in the INSTALLED theme.json palette.
      const themeJson = JSON.parse(
        readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'theme.json'), 'utf8'),
      ) as { settings?: { color?: { palette?: Array<{ slug: string; color: string }> } } };
      expect((themeJson.settings?.color?.palette ?? []).some((p) => p.color === '#e2573b')).toBe(true);
      expect(existsSync(join(outDir, 'parity-report.json'))).toBe(true);
      // Parity floor verdict (stage 1d): mock scores 0.91/0.88/0.95/0.9 are all below
      // the 0.99 floor — every page reports passes:false and allPass is false.
      expect(summary.parity?.floor).toBe(0.99);
      expect(summary.parity?.allPass).toBe(false);
      expect(summary.parity?.pages.every((p) => typeof p.passes === 'boolean')).toBe(true);
      expect(summary.parity?.pages.every((p) => p.passes === false)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('degrades to a warning (not isError) when design capture fails', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-capfail-'));
    vi.mocked(captureScreenshots).mockRejectedValueOnce(new Error('boom'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme' },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        designCaptured?: boolean; parity?: unknown; warnings: string[]; installed: number;
      };
      expect(summary.designCaptured).toBe(false);
      expect(summary.warnings.some((w) => w.includes('design capture failed'))).toBe(true);
      expect(summary.parity).toBeUndefined();
      // theme still written (default foundation) and pages still installed
      expect(existsSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'theme.json'))).toBe(true);
      expect(summary.installed).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('skipDesign skips capture/compare and uses the default foundation', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-skip-'));
    try {
      const before = capturedRuns.length;
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { designCaptured?: boolean; parity?: unknown };
      expect(summary.designCaptured).toBe(false);
      expect(summary.parity).toBeUndefined();
      expect(capturedRuns.length).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // Repair loop tests (Task 4)
  // ---------------------------------------------------------------------------

  /** Tiny red-pixel diff PNG: 10×100, row 20 fully red — gives 1 DiffRegion. */
  function makeRedDiffPng(): Buffer {
    const png = new PNG({ width: 10, height: 100 });
    png.data.fill(255); // white, alpha 255
    for (let x = 0; x < 10; x++) {
      const i = (20 * 10 + x) * 4;
      png.data[i] = 255; png.data[i + 1] = 0; png.data[i + 2] = 0; png.data[i + 3] = 255;
    }
    return PNG.sync.write(png);
  }

  const FAIL_COMPARE = {
    version: 1 as const, comparedAt: 'TEST',
    results: [{ pathname: '/', originUrl: 'o', replicaUrl: 'http://localhost:7777/', desktop: { status: 'ok', score: 0.85 }, mobile: { status: 'ok', score: 0.8 } }],
  };
  const PASS_COMPARE = {
    version: 1 as const, comparedAt: 'TEST',
    results: [{ pathname: '/', originUrl: 'o', replicaUrl: 'http://localhost:7777/', desktop: { status: 'ok', score: 1.0 }, mobile: { status: 'ok', score: 1.0 } }],
  };
  const MARGIN_DIV = {
    match: 'section.hero[0]', viewport: 'desktop' as const, kind: 'prop' as const,
    prop: 'marginBottom', source: '88px', replica: '0px', replicaOnlyClasses: ['wp-block-group'],
  };

  it('repair loop patches, re-compares, and converges', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-repair-'));
    try {
      // Arm the replica fixture seam: the captureScreenshots mock writes a proper
      // manifest (pathname→slug) + red-pixel diff PNGs for both viewports.
      repairReplicaManifestEntries = { 'http://localhost:7777/': { slug: 'home' } };
      repairDiffPng = makeRedDiffPng();
      // round 0: failing compare → triggers repair; round 1: passing → converged.
      vi.mocked(compareScreenshotDirs)
        .mockResolvedValueOnce(FAIL_COMPARE as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>)
        .mockResolvedValueOnce(PASS_COMPARE as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>);
      // probePair: desktop → 1 marginBottom divergence; mobile falls back to [] (base).
      vi.mocked(probePair).mockResolvedValueOnce([MARGIN_DIV]);

      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme' },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        parity?: {
          repair?: { rounds: number; overrides: number; unresolved: unknown[]; converged: boolean };
          allPass: boolean;
        };
        warnings: string[];
      };
      // Repair completed in 1 round with 1 override (marginBottom) and converged.
      expect(summary.parity?.repair?.rounds).toBe(1);
      expect(summary.parity?.repair?.overrides).toBe(1);
      expect(summary.parity?.repair?.converged).toBe(true);
      expect(summary.parity?.repair?.unresolved).toHaveLength(0);
      expect(summary.parity?.allPass).toBe(true);
      // parity-patch.css written into the live theme with the source-measured value.
      const themePatchPath = join(sitePath, 'wp-content', 'themes', 'acme-local', 'assets', 'css', 'parity-patch.css');
      expect(existsSync(themePatchPath)).toBe(true);
      expect(readFileSync(themePatchPath, 'utf8')).toContain('margin-bottom: 88px');
      // parity-patch.css also copied to outputDir (atomic rename convention).
      const outPatchPath = join(outDir, 'parity-patch.css');
      expect(existsSync(outPatchPath)).toBe(true);
      expect(readFileSync(outPatchPath, 'utf8')).toContain('margin-bottom: 88px');
      // captureScreenshots: source (0) + replica round-0 (1) + repair re-capture (2).
      expect(capturedRuns).toHaveLength(3);
      // Re-capture must use force:true so pngs regenerate over the stale round-0 files.
      expect(capturedRuns[2].force).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('repair loop: height-only failure breaks without clobbering a prior patch and is reported', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-heightonly-'));
    try {
      repairReplicaManifestEntries = { 'http://localhost:7777/': { slug: 'home' } };
      repairDiffPng = makeRedDiffPng();
      // A prior run left a WORKING patch in the live theme — the height-only
      // round must NOT overwrite it with empty bytes.
      const themePatchPath = join(sitePath, 'wp-content', 'themes', 'acme-local', 'assets', 'css', 'parity-patch.css');
      mkdirSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'assets', 'css'), { recursive: true });
      writeFileSync(themePatchPath, 'section.hero { margin-bottom: 88px; }\n');
      // Perfect pixel scores both viewports; desktop fails ONLY on height —
      // the dropped content sits below the min-crop, so there are no diff
      // pixels and nothing for the probe to measure.
      const HEIGHT_ONLY_COMPARE = {
        version: 1 as const, comparedAt: 'TEST',
        results: [{
          pathname: '/', originUrl: 'o', replicaUrl: 'http://localhost:7777/',
          desktop: { status: 'ok', score: 1.0, heightDelta: 40, heightPass: false },
          mobile: { status: 'ok', score: 1.0, heightDelta: 0, heightPass: true },
        }],
      };
      vi.mocked(compareScreenshotDirs)
        .mockResolvedValueOnce(HEIGHT_ONLY_COMPARE as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>);

      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme' },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        parity?: {
          allPass: boolean;
          repair?: { rounds: number; overrides: number; converged: boolean; heightOnly?: string[] };
        };
        warnings: string[];
      };
      // The page fails (height folds into passes) but nothing is probeable.
      expect(summary.parity?.allPass).toBe(false);
      expect(vi.mocked(probePair)).not.toHaveBeenCalled();
      // Loop broke before the patch write: the prior working patch survives
      // and no empty patch lands in outputDir.
      expect(readFileSync(themePatchPath, 'utf8')).toContain('margin-bottom: 88px');
      expect(existsSync(join(outDir, 'parity-patch.css'))).toBe(false);
      // Honest reporting: zero completed rounds, the failure named explicitly.
      expect(summary.parity?.repair?.converged).toBe(false);
      expect(summary.parity?.repair?.rounds).toBe(0);
      expect(summary.parity?.repair?.heightOnly).toEqual(['/ desktop']);
      expect(summary.warnings.some((w) => w.includes('height-only'))).toBe(true);
      // No wasted re-capture: source (0) + replica round-0 (1) only.
      expect(capturedRuns).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('repair loop stops on unchanged fingerprint and reports unresolved (stuck)', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-stuck-'));
    try {
      repairReplicaManifestEntries = { 'http://localhost:7777/': { slug: 'home' } };
      repairDiffPng = makeRedDiffPng();
      // Compare always failing — repair loop never reaches allPass.
      vi.mocked(compareScreenshotDirs)
        .mockResolvedValueOnce(FAIL_COMPARE as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>)
        .mockResolvedValueOnce(FAIL_COMPARE as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>);
      // probePair always returns the same divergence — fingerprint is stable →
      // loop detects it has stopped making progress and breaks.
      vi.mocked(probePair)
        .mockResolvedValueOnce([MARGIN_DIV])   // round 0 desktop
        .mockResolvedValueOnce([])             // round 0 mobile
        .mockResolvedValueOnce([MARGIN_DIV])   // round 1 desktop (fingerprint check)
        .mockResolvedValueOnce([]);            // round 1 mobile

      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme' },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        parity?: { repair?: { rounds: number; converged: boolean; unresolved: unknown[] }; allPass: boolean };
        warnings: string[];
      };
      // Loop ran 1 complete round (wrote patch + re-compared), then detected the
      // same fingerprint on round 2's probe and broke before writing a second patch.
      expect(summary.parity?.repair?.rounds).toBe(1);
      expect(summary.parity?.repair?.converged).toBe(false);
      expect(summary.parity?.allPass).toBe(false);
      // captureScreenshots: source + replica + 1 repair re-capture (no 2nd one — broke
      // before the re-capture on round 2).
      expect(capturedRuns).toHaveLength(3);
      // No infinite loop: exactly 4 probePair calls across 2 probe rounds.
      expect(vi.mocked(probePair).mock.calls).toHaveLength(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('repair loop retains earlier-round overrides in the patch (union across rounds)', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-union-'));
    try {
      repairReplicaManifestEntries = { 'http://localhost:7777/': { slug: 'home' } };
      repairDiffPng = makeRedDiffPng();
      // 3 compares: round-0 initial FAIL → after round-0 patch FAIL → after round-1 patch PASS.
      vi.mocked(compareScreenshotDirs)
        .mockResolvedValueOnce(FAIL_COMPARE as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>)
        .mockResolvedValueOnce(FAIL_COMPARE as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>)
        .mockResolvedValueOnce(PASS_COMPARE as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>);
      // Round 0 yields overrides A (margin-bottom) + B (font-size); round 1 yields
      // C (different selector|prop key). Different divergence sets → different
      // fingerprints, so the loop continues rather than breaking as stuck.
      const DIV_B = {
        match: 'p.lede[0]', viewport: 'desktop' as const, kind: 'prop' as const,
        prop: 'fontSize', source: '17px', replica: '14px', replicaOnlyClasses: [],
      };
      const DIV_C = {
        match: 'div.cards[0]', viewport: 'desktop' as const, kind: 'prop' as const,
        prop: 'paddingTop', source: '24px', replica: '0px', replicaOnlyClasses: ['wp-block-columns'],
      };
      vi.mocked(probePair)
        .mockResolvedValueOnce([MARGIN_DIV, DIV_B])  // round 0 desktop → A + B
        .mockResolvedValueOnce([])                   // round 0 mobile
        .mockResolvedValueOnce([DIV_C]);             // round 1 desktop → C (mobile falls to base [])

      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', maxRepairRounds: 2 },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        parity?: {
          repair?: { rounds: number; overrides: number; converged: boolean };
          allPass: boolean; avgDesktop: number; avgMobile: number;
        };
      };
      expect(summary.parity?.repair?.rounds).toBe(2);
      expect(summary.parity?.repair?.overrides).toBe(3);
      expect(summary.parity?.repair?.converged).toBe(true);
      // The round-2 patch (final write into the live theme) must contain the UNION:
      // A and B retained from round 1, C added — not replaced by C alone.
      const patch = readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'assets', 'css', 'parity-patch.css'), 'utf8');
      expect(patch).toContain('margin-bottom: 88px');  // A retained
      expect(patch).toContain('font-size: 17px');      // B retained
      expect(patch).toContain('padding-top: 24px');    // C added
      // Averages reflect the FINAL round's compare (PASS_COMPARE = 1.0), not round 0.
      expect(summary.parity?.avgDesktop).toBe(1.0);
      expect(summary.parity?.avgMobile).toBe(1.0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('repair loop keeps per-viewport source values distinct in the union (no value collapse)', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-vpvalues-'));
    try {
      repairReplicaManifestEntries = { 'http://localhost:7777/': { slug: 'home' } };
      repairDiffPng = makeRedDiffPng();
      vi.mocked(compareScreenshotDirs)
        .mockResolvedValueOnce(FAIL_COMPARE as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>)
        .mockResolvedValueOnce(PASS_COMPARE as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>);
      // SAME selector|occurrence|prop diverging to DIFFERENT source values per
      // viewport (responsive hero type scale). classify keys on the source value
      // too, yielding TWO overrides; the cross-round union must NOT collapse them
      // into one bare rule that forces the desktop value onto mobile.
      const FONT_DESK = {
        match: 'section.hero[0]', viewport: 'desktop' as const, kind: 'prop' as const,
        prop: 'fontSize', source: '64px', replica: '40px', replicaOnlyClasses: [],
      };
      const FONT_MOB = {
        match: 'section.hero[0]', viewport: 'mobile' as const, kind: 'prop' as const,
        prop: 'fontSize', source: '32px', replica: '40px', replicaOnlyClasses: [],
      };
      vi.mocked(probePair)
        .mockResolvedValueOnce([FONT_DESK])  // round 0 desktop
        .mockResolvedValueOnce([FONT_MOB]);  // round 0 mobile

      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme' },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        parity?: { repair?: { rounds: number; overrides: number; converged: boolean } };
      };
      expect(summary.parity?.repair?.overrides).toBe(2);
      expect(summary.parity?.repair?.converged).toBe(true);
      const patch = readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'assets', 'css', 'parity-patch.css'), 'utf8');
      // Each viewport keeps ITS source value inside its media block…
      expect(patch).toContain('@media (min-width: 768px) {\n  section.hero { font-size: 64px; }\n}');
      expect(patch).toContain('@media (max-width: 767px) {\n  section.hero { font-size: 32px; }\n}');
      // …and no bare (viewport-unscoped) rule leaks the desktop value to mobile.
      expect(patch).not.toMatch(/^section\.hero/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('height-gate failure folds into passes: perfect score + heightPass:false fails the page', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-heightfail-'));
    try {
      // Score 1.0 on both viewports but the desktop height gate failed -- the
      // min-crop hid a 300px height loss. passes must AND in heightPass.
      vi.mocked(compareScreenshotDirs).mockResolvedValueOnce({
        version: 1,
        comparedAt: 'TEST',
        results: [{
          pathname: '/',
          originUrl: 'o',
          replicaUrl: 'r',
          desktop: { status: 'ok', score: 1.0, heightDelta: 300, heightPass: false },
          mobile: { status: 'ok', score: 1.0, heightDelta: 0, heightPass: true },
        }],
      } as unknown as Awaited<ReturnType<typeof compareScreenshotDirs>>);
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', repair: false },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        parity?: { allPass: boolean; pages: Array<{ passes: boolean }> };
      };
      expect(summary.parity?.pages[0].passes).toBe(false);
      expect(summary.parity?.allPass).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('repair:false skips the loop entirely', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-norepair-'));
    try {
      // compare returns failing scores (base mock) but repair is off.
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', repair: false },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        parity?: { repair?: unknown; allPass: boolean };
        warnings: string[];
      };
      // Repair field is absent — loop was never entered.
      expect(summary.parity?.repair).toBeUndefined();
      expect(summary.parity?.allPass).toBe(false); // base compare has scores < 0.99
      // probePair must never be called when repair:false.
      expect(vi.mocked(probePair).mock.calls).toHaveLength(0);
      // captureScreenshots: source + replica only (no re-capture).
      expect(capturedRuns).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('repair skips with a warning when source css is not carried (patch would never load)', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-skipcarry-'));
    try {
      // Failing compare (base mock) + repair default ON, but carryCss:false means
      // functions.php never enqueues parity-patch.css — looping would burn every
      // round with zero on-page effect, so the handler must skip with a warning.
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', carryCss: false },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        parity?: { repair?: unknown };
        warnings: string[];
      };
      expect(summary.warnings).toContain('repair skipped: requires carried source css (carryCss)');
      expect(summary.parity?.repair).toBeUndefined();
      // The loop never ran: no probes, no re-capture.
      expect(vi.mocked(probePair).mock.calls).toHaveLength(0);
      expect(capturedRuns).toHaveLength(2); // source + replica only
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // nativeBehaviors tests (interactivity blocks)
  // ---------------------------------------------------------------------------

  /** Fixture whose css/js trigger reveal + sticky + exactly ONE gap — same
   * fictional shapes as detect-behaviors.test.ts (nav-highlight = the gap). */
  function makeBehaviorSite(): string {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-behave-'));
    writeFileSync(
      join(dir, 'index.html'),
      '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body><header><nav><a href="about.html">About</a></nav></header><main><section id="hero"><h1>Hi</h1></section></main><script src="site.js"></script></body></html>',
    );
    writeFileSync(
      join(dir, 'about.html'),
      '<html><head><title>About</title></head><body><main><section id="who"><h2>Who</h2><p>Us</p></section></main></body></html>',
    );
    writeFileSync(
      join(dir, 'styles.css'),
      'html.js section { opacity: 0; transform: translateY(18px); transition: opacity 600ms ease, transform 600ms ease; }\n' +
        'html.js section.is-visible { opacity: 1; transform: none; }\n' +
        'header.is-scrolled { box-shadow: 0 2px 12px rgba(0,0,0,0.08); }\n',
    );
    writeFileSync(
      join(dir, 'site.js'),
      'const obs = new IntersectionObserver((entries) => {\n' +
        "  entries.forEach((e) => e.isIntersecting && e.target.classList.add('is-visible'));\n" +
        '}, { threshold: 0.12 });\n' +
        "document.querySelectorAll('section').forEach((s) => obs.observe(s));\n" +
        "window.addEventListener('scroll', () => {\n" +
        "  document.querySelector('header').classList.toggle('is-scrolled', window.scrollY > 24);\n" +
        '});\n' +
        "document.querySelectorAll('nav a').forEach((a) => {\n" +
        "  if (a.getAttribute('href') === location.pathname) a.style.color = 'red';\n" +
        '});\n',
    );
    return dir;
  }

  /** Fixture bearing ALL catalog patterns: reveal + sticky (global), tabs
   * (services), slider (index), modal (contact), plus the nav-highlight gap. */
  function makeAllBehaviorsSite(): string {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'cls-allbehave-'));
    writeFileSync(
      join(dir, 'index.html'),
      '<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head><body>' +
        '<header><nav><a href="services.html">Services</a></nav></header><main>' +
        '<section id="hero"><h1>Hi</h1></section>' +
        '<section id="quotes"><div class="track">' +
        '<figure class="slide is-current"><blockquote>One</blockquote></figure>' +
        '<figure class="slide"><blockquote>Two</blockquote></figure></div>' +
        '<button class="prev">Prev</button><button class="next">Next</button></section>' +
        '</main><script src="site.js"></script></body></html>',
    );
    writeFileSync(
      join(dir, 'services.html'),
      '<html><head><title>Services</title><link rel="stylesheet" href="styles.css"></head><body><main>' +
        '<section id="plans"><div role="tablist">' +
        '<button role="tab" aria-selected="true" aria-controls="p-a" class="tab is-active">A</button>' +
        '<button role="tab" aria-selected="false" aria-controls="p-b" class="tab">B</button></div>' +
        '<div role="tabpanel" id="p-a"><p>Alpha</p></div>' +
        '<div role="tabpanel" id="p-b" hidden><p>Beta</p></div></section>' +
        '</main><script src="site.js"></script></body></html>',
    );
    writeFileSync(
      join(dir, 'contact.html'),
      '<html><head><title>Contact</title></head><body><main>' +
        '<section id="book"><button class="open-details">Details</button>' +
        '<dialog aria-modal="true"><p>Info</p><button class="close">Close</button></dialog></section>' +
        '</main></body></html>',
    );
    writeFileSync(
      join(dir, 'styles.css'),
      'html.js section { opacity: 0; transform: translateY(18px); transition: opacity 600ms ease, transform 600ms ease; }\n' +
        'html.js section.is-visible { opacity: 1; transform: none; }\n' +
        'header.is-scrolled { box-shadow: 0 2px 12px rgba(0,0,0,0.08); }\n',
    );
    writeFileSync(
      join(dir, 'site.js'),
      'const obs = new IntersectionObserver((entries) => {\n' +
        "  entries.forEach((e) => e.isIntersecting && e.target.classList.add('is-visible'));\n" +
        '}, { threshold: 0.12 });\n' +
        "document.querySelectorAll('section').forEach((s) => obs.observe(s));\n" +
        "window.addEventListener('scroll', () => {\n" +
        "  document.querySelector('header').classList.toggle('is-scrolled', window.scrollY > 24);\n" +
        '});\n' +
        'document.querySelectorAll(\'[role="tab"]\').forEach((t) => t.addEventListener(\'click\', () => {\n' +
        "  t.classList.add('is-active');\n" +
        '}));\n' +
        'setInterval(() => { advance(); }, 6000);\n' +
        "document.querySelector('.next').addEventListener('click', () => {\n" +
        "  document.querySelector('.slide.is-current').classList.remove('is-current');\n" +
        '});\n' +
        "document.querySelector('.open-details').addEventListener('click', () => {\n" +
        "  document.querySelector('dialog').showModal();\n" +
        '});\n' +
        "document.querySelectorAll('nav a').forEach((a) => {\n" +
        "  if (a.getAttribute('href') === location.pathname) a.style.color = 'red';\n" +
        '});\n',
    );
    return dir;
  }

  it('nativeBehaviors: per-section counts in the summary + fired-kind drivers claimed out of gaps', async () => {
    const dir = makeAllBehaviorsSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-nball-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true, nativeBehaviors: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        behaviors?: { reveal: boolean; sticky: boolean; tabs: number; slider: number; modal: number; gaps: number };
      };
      expect(summary.behaviors).toEqual({ reveal: true, sticky: true, tabs: 1, slider: 1, modal: 1, gaps: 1 });
      // Sidecars carry the per-section wrappers (verbatim inner).
      expect(readFileSync(join(outDir, 'composed', 'services.blocks.html'), 'utf8')).toContain('data-wp-interactive="dla/tabs"');
      expect(readFileSync(join(outDir, 'composed', 'home.blocks.html'), 'utf8')).toContain('data-wp-interactive="dla/slider"');
      expect(readFileSync(join(outDir, 'composed', 'contact.blocks.html'), 'utf8')).toContain('data-wp-interactive="dla/modal"');
      // Claiming: the fired kinds' driver js is OUT of the gap report — only
      // the nav-highlight residue remains.
      const gaps = JSON.parse(readFileSync(join(outDir, 'behavior-gaps.json'), 'utf8')) as {
        gaps: Array<{ jsExcerpt: string }>;
      };
      expect(gaps.gaps).toHaveLength(1);
      expect(gaps.gaps[0].jsExcerpt).toContain('location.pathname');
      expect(gaps.gaps[0].jsExcerpt).not.toContain('showModal');
      expect(gaps.gaps[0].jsExcerpt).not.toContain('setInterval');
      expect(gaps.gaps[0].jsExcerpt).not.toContain('role="tab"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('nativeBehaviors: forces carryJs off, installs + activates the plugin, writes behavior-gaps', async () => {
    const dir = makeBehaviorSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-nb-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true, nativeBehaviors: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        carried: { css: boolean; js: boolean };
        behaviors?: { reveal: boolean; sticky: boolean; gaps: number };
      };
      expect(summary.carried.js).toBe(false); // source js NOT carried
      expect(summary.behaviors).toEqual({ reveal: true, sticky: true, tabs: 0, slider: 0, modal: 0, gaps: 1 });
      const themeDir = join(sitePath, 'wp-content', 'themes', 'acme-local');
      // No carried source.js in the live theme — the blocks replace it.
      expect(existsSync(join(themeDir, 'assets', 'js', 'source.js'))).toBe(false);
      // Reveal threads through ingest → sidecar markup.
      expect(readFileSync(join(outDir, 'composed', 'home.blocks.html'), 'utf8')).toContain('wp:dla/reveal');
      // Sticky state block lands in the (plain carry) header part.
      expect(readFileSync(join(themeDir, 'parts', 'header.html'), 'utf8')).toContain('wp:dla/sticky');
      // Plugin written to the host (real writeReplicaFilesToHost) + activated.
      expect(existsSync(join(sitePath, 'wp-content', 'plugins', 'dla-interactivity', 'plugin.php'))).toBe(true);
      expect(existsSync(join(sitePath, 'wp-content', 'plugins', 'dla-interactivity', 'blocks', 'reveal', 'view.asset.php'))).toBe(true);
      const flat = execCalls.map((c) => c.join(' '));
      expect(flat.some((c) => c.includes('plugin activate dla-interactivity'))).toBe(true);
      // Gaps artifact written atomically next to the other reports.
      const gaps = JSON.parse(readFileSync(join(outDir, 'behavior-gaps.json'), 'utf8')) as {
        schema: number; site: string; gaps: Array<{ pattern: string; jsExcerpt: string }>;
      };
      expect(gaps.schema).toBe(1);
      expect(gaps.gaps).toHaveLength(1);
      expect(gaps.gaps[0].pattern).toBe('uncatalogued-js');
      expect(gaps.gaps[0].jsExcerpt).toContain('location.pathname');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('nativeBehaviors + explicit carryJs:true keeps carryJs off and warns', async () => {
    const dir = makeBehaviorSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-nbwarn-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true, nativeBehaviors: true, carryJs: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { carried: { js: boolean }; warnings: string[] };
      expect(summary.carried.js).toBe(false);
      expect(summary.warnings.join('\n')).toContain('nativeBehaviors forces carryJs off');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('sticky detected but chrome not carried: reports sticky:false + a warning (honesty)', async () => {
    const dir = makeBehaviorSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-nbsticky-'));
    try {
      // carryCss:false → chromeCarried false → header is NOT plain → the
      // dla/sticky state block never emits. The summary must report what
      // LANDED, not what detection found.
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true, nativeBehaviors: true, carryCss: false },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        behaviors?: { reveal: boolean; sticky: boolean; gaps: number };
        warnings: string[];
      };
      expect(summary.behaviors).toEqual({ reveal: true, sticky: false, tabs: 0, slider: 0, modal: 0, gaps: 1 });
      expect(summary.warnings).toContain('sticky behavior detected but not emitted (requires carried chrome header)');
      expect(readFileSync(join(sitePath, 'wp-content', 'themes', 'acme-local', 'parts', 'header.html'), 'utf8')).not.toContain('dla/sticky');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('nativeBehaviors: deletes a stale source.js left by a PRIOR carry convert', async () => {
    const dir = makeBehaviorSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-nbstale-'));
    // Pre-seed the live theme with a prior carry run's source.js —
    // writeReplicaFilesToHost overwrites but never deletes, and the enqueue
    // guard makes any leftover ACTIVE (E2E: old source JS re-armed alongside
    // the Interactivity blocks).
    const themeDir = join(sitePath, 'wp-content', 'themes', 'acme-local');
    mkdirSync(join(themeDir, 'assets', 'js'), { recursive: true });
    writeFileSync(join(themeDir, 'assets', 'js', 'source.js'), '/* stale prior-run carry js */');
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true, nativeBehaviors: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      // Stale js deleted (this run carries no js)…
      expect(existsSync(join(themeDir, 'assets', 'js', 'source.js'))).toBe(false);
      // …while this run's own carried css stays (carryCss default on).
      expect(existsSync(join(themeDir, 'assets', 'css', 'source.css'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('default carry re-convert keeps source.js (overwrite, never delete) (regression)', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-restale-'));
    const themeDir = join(sitePath, 'wp-content', 'themes', 'acme-local');
    mkdirSync(join(themeDir, 'assets', 'js'), { recursive: true });
    writeFileSync(join(themeDir, 'assets', 'js', 'source.js'), '/* stale prior-run carry js */');
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      // Default carry writes its own source.js over the stale one — present,
      // with THIS run's content.
      const js = readFileSync(join(themeDir, 'assets', 'js', 'source.js'), 'utf8');
      expect(js).not.toContain('stale prior-run carry js');
      expect(js.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('default (no flag): no behaviors key, no plugin, carried js intact (regression)', async () => {
    const dir = makeSite();
    const sitePath = makeStudioSite();
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'cls-nbdefault-'));
    try {
      const res = await convertLocalSiteHandler(
        { dir, studioSitePath: sitePath, outputDir: outDir, themeSlug: 'acme-local', siteTitle: 'Acme', skipDesign: true },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        behaviors?: unknown; carried: { js: boolean };
      };
      expect(summary.behaviors).toBeUndefined();
      expect(summary.carried.js).toBe(true);
      expect(existsSync(join(sitePath, 'wp-content', 'plugins', 'dla-interactivity'))).toBe(false);
      expect(existsSync(join(outDir, 'behavior-gaps.json'))).toBe(false);
      const flat = execCalls.map((c) => c.join(' '));
      expect(flat.some((c) => c.includes('plugin activate'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sitePath, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
