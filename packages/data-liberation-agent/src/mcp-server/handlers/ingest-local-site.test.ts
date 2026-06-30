import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingestLocalSiteHandler } from './ingest-local-site.js';
import type { HandlerContext, ToolResult } from '../handler-types.js';
import type { MountSpec } from '../../lib/replicate/local-data/types.js';

// Per-page isolation: composePage has no externally-triggerable failure path
// via html input today (it only throws on roundtrip failure / compose misfit),
// so the failure leg is simulated — the mock throws for the sentinel slug
// "boom" and delegates to the real implementation for every other page.
// Passthrough the block fixer: ingest tests assert composition + artifacts, not
// @wordpress/blocks canonicalization (covered by the fixer's own tests). The
// real client spawns a jsdom HTTP subprocess (~2.5s/test + parallel-run
// flakiness); the stub keeps these tests fast and deterministic, and passthrough
// means each sidecar equals its composed markup (matches the empty-sidecar etc.
// assertions below).
vi.mock('../../lib/streaming/block-fixer-client.js', () => ({
  BlockFixerClient: class {
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async fix(items: string[]): Promise<Array<{ html: string; changed: boolean; fixedIssues: string[] }>> {
      return items.map((html) => ({ html, changed: false, fixedIssues: [] }));
    }
  },
}));

vi.mock('../../lib/replicate/normalize/compose-page.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/replicate/normalize/compose-page.js')>();
  return {
    ...actual,
    // Forward ALL args — the wrapper must not drop the ComposePageOpts second
    // param (reveal tagging would silently vanish in these tests otherwise).
    composePage: (...cpArgs: Parameters<typeof actual.composePage>) => {
      if (cpArgs[0].slug === 'boom') throw new Error('synthetic compose failure');
      return actual.composePage(...cpArgs);
    },
  };
});

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');

const ctx = {
  textResult: (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] }),
  errorResult: (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true }),
} as unknown as HandlerContext;

describe('ingestLocalSiteHandler', () => {
  it('composes pages and writes artifacts', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out-'));
    writeFileSync(join(siteDir, 'index.html'), '<body><main><section id="hero"><h1>Hi</h1></section></main></body>');
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir }, ctx);
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { pages: number };
      expect(summary.pages).toBe(1);
      expect(existsSync(join(outDir, 'composed', 'home.blocks.html'))).toBe(true);
      const report = JSON.parse(readFileSync(join(outDir, 'normalize-report.json'), 'utf8')) as { entries: unknown[]; contractIssues: unknown[] };
      expect(report.entries.length).toBe(1);
      // Block-contract issues ride the report as a warning-level array
      // (empty on clean output) + a count in the summary.
      expect(report.contractIssues).toEqual([]);
      expect((JSON.parse(res.content[0].text) as { contractIssues: number }).contractIssues).toBe(0);
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('converts local contact forms to Jetpack form blocks and reports formsConverted', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site-form-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out-form-'));
    writeFileSync(
      join(siteDir, 'index.html'),
      '<body><main><section id="contact"><h1>Contact</h1>' +
        '<form id="contact-form" class="contact-form" action="/contact" method="post">' +
        '<label for="contact-name">Name</label>' +
        '<input id="contact-name" name="name" autocomplete="name" type="text" required placeholder="Jane Doe">' +
        '<label for="contact-email">Email</label>' +
        '<input id="contact-email" name="email" type="email" required placeholder="jane@example.com">' +
        '<label for="contact-message">Message</label>' +
        '<textarea id="contact-message" name="message" required placeholder="How can we help?"></textarea>' +
        '<button type="submit">Send message</button>' +
        '</form></section></main></body>',
    );
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir }, ctx);
      expect(res.isError).toBeFalsy();
      const sidecar = readFileSync(join(outDir, 'composed', 'home.blocks.html'), 'utf8');
      expect(sidecar).toContain('wp:jetpack/contact-form');
      expect(sidecar).not.toContain('<!-- wp:html -->');
      expect(sidecar).not.toMatch(
        /<!-- wp:html -->\s*<form\b[^>]*(?:id="contact-form"|class="contact-form")[\s\S]*?<!-- \/wp:html -->/,
      );
      const summary = JSON.parse(res.content[0].text) as { formsConverted: number };
      expect(summary.formsConverted).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('returns an error result for a dir with no html', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'empty-'));
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: siteDir }, ctx);
      expect(res.isError).toBe(true);
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
    }
  });

  it('summary and report include failure/empty fields on happy path', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site2-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out2-'));
    writeFileSync(join(siteDir, 'index.html'), '<body><main><section id="s1"><h1>Page One</h1></section></main></body>');
    writeFileSync(join(siteDir, 'about.html'), '<body><main><section id="s2"><h2>About</h2></section></main></body>');
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir }, ctx);
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        pages: number; failedPageCount: number; failedPagesList: unknown[]; emptyPages: unknown[];
      };
      expect(summary.pages).toBe(2);
      expect(summary.failedPageCount).toBe(0);
      expect(summary.failedPagesList).toEqual([]);
      expect(summary.emptyPages).toEqual([]);
      const report = JSON.parse(readFileSync(join(outDir, 'normalize-report.json'), 'utf8')) as {
        failedPages: unknown[]; emptyPages: unknown[];
      };
      expect(report.failedPages).toEqual([]);
      expect(report.emptyPages).toEqual([]);
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('filters static-card mounts to their source page before neutralizing', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site-card-scope-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out-card-scope-'));
    const mount: MountSpec = {
      selector: '#dla-cards-index',
      sourceSelector: '.ledger-grid',
      sourcePage: 'index.html',
      sourceCall: 'html-cards:.ledger-grid',
      query: { postType: 'post', perPage: -1, orderBy: 'date', order: 'ASC' },
    };
    writeFileSync(
      join(siteDir, 'index.html'),
      '<body><main><section><h1>Journal</h1><div class="ledger-grid">' +
        '<article><h2><a href="p1.html">Alpha</a></h2><p>Alpha card text long enough.</p></article>' +
        '<article><h2><a href="p2.html">Beta</a></h2><p>Beta card text long enough.</p></article>' +
        '<article><h2><a href="p3.html">Gamma</a></h2><p>Gamma card text long enough.</p></article>' +
        '</div></section></main></body>',
    );
    writeFileSync(
      join(siteDir, 'about.html'),
      '<body><main><section><h1>About</h1><div class="ledger-grid">' +
        '<article><h2>Mission</h2><p>Studio mission text that should remain prose.</p></article>' +
        '<article><h2>Process</h2><p>Studio process text that should remain prose.</p></article>' +
        '<article><h2>Team</h2><p>Studio team text that should remain prose.</p></article>' +
        '</div></section></main></body>',
    );
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir, cardMounts: [mount] }, ctx);
      expect(res.isError).toBeFalsy();
      const homeSidecar = readFileSync(join(outDir, 'composed', 'home.blocks.html'), 'utf8');
      const aboutSidecar = readFileSync(join(outDir, 'composed', 'about.blocks.html'), 'utf8');
      expect(homeSidecar).toContain('id="dla-cards-index"');
      expect(aboutSidecar).not.toContain('id="dla-cards-index"');
      expect(aboutSidecar).toContain('Mission');
      expect(aboutSidecar).toContain('Process');
      expect(aboutSidecar).toContain('Team');
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('does not apply a top-level index mount to a nested same-basename page', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site-card-basename-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out-card-basename-'));
    const mount: MountSpec = {
      selector: '#dla-cards-index',
      sourceSelector: '.ledger-grid',
      sourcePage: 'index.html',
      sourceCall: 'html-cards:.ledger-grid',
      query: { postType: 'post', perPage: -1, orderBy: 'date', order: 'ASC' },
    };
    mkdirSync(join(siteDir, 'blog'), { recursive: true });
    writeFileSync(
      join(siteDir, 'index.html'),
      '<body><main><section><h1>Journal</h1><div class="ledger-grid">' +
        '<article><h2><a href="p1.html">Alpha</a></h2><p>Alpha card text long enough.</p></article>' +
        '<article><h2><a href="p2.html">Beta</a></h2><p>Beta card text long enough.</p></article>' +
        '<article><h2><a href="p3.html">Gamma</a></h2><p>Gamma card text long enough.</p></article>' +
        '</div></section></main></body>',
    );
    writeFileSync(
      join(siteDir, 'blog', 'index.html'),
      '<body><main><section><h1>Blog</h1><div class="ledger-grid">' +
        '<article><h2>Nested Editorial Alpha</h2><p>Nested editorial alpha must survive untouched.</p></article>' +
        '<article><h2>Nested Editorial Beta</h2><p>Nested editorial beta must survive untouched.</p></article>' +
        '<article><h2>Nested Editorial Gamma</h2><p>Nested editorial gamma must survive untouched.</p></article>' +
        '</div></section></main></body>',
    );
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir, cardMounts: [mount] }, ctx);
      expect(res.isError).toBeFalsy();
      const homeSidecar = readFileSync(join(outDir, 'composed', 'home.blocks.html'), 'utf8');
      const blogSidecar = readFileSync(join(outDir, 'composed', 'blog.blocks.html'), 'utf8');
      expect(homeSidecar).toContain('id="dla-cards-index"');
      expect(blogSidecar).not.toContain('id="dla-cards-index"');
      expect(blogSidecar).toContain('Nested Editorial Alpha');
      expect(blogSidecar).toContain('Nested editorial beta must survive untouched.');
      expect(blogSidecar).toContain('Nested Editorial Gamma');
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('isolates a per-page compose failure: other pages still compose', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site3-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out3-'));
    writeFileSync(join(siteDir, 'index.html'), '<body><main><section id="ok"><h1>Fine</h1></section></main></body>');
    writeFileSync(join(siteDir, 'boom.html'), '<body><main><section id="x"><h1>Kaboom</h1></section></main></body>');
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir }, ctx);
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as {
        pages: number; failedPageCount: number; failedPagesList: Array<{ slug: string; error: string }>;
      };
      expect(summary.pages).toBe(2);
      expect(summary.failedPageCount).toBe(1);
      expect(summary.failedPagesList).toEqual([{ slug: 'boom', error: 'synthetic compose failure' }]);
      expect(existsSync(join(outDir, 'composed', 'home.blocks.html'))).toBe(true);
      expect(existsSync(join(outDir, 'composed', 'boom.blocks.html'))).toBe(false);
      const report = JSON.parse(readFileSync(join(outDir, 'normalize-report.json'), 'utf8')) as {
        failedPages: Array<{ slug: string; error: string }>;
      };
      expect(report.failedPages).toEqual([{ slug: 'boom', error: 'synthetic compose failure' }]);
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('rejects an outputDir containing .. traversal', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site4-'));
    writeFileSync(join(siteDir, 'index.html'), '<body><main><section id="hero"><h1>Hi</h1></section></main></body>');
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: '../escape' }, ctx);
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/traversal/);
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
    }
  });

  it('reports pages that compose to nothing in emptyPages and still writes their sidecar', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site5-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out5-'));
    writeFileSync(join(siteDir, 'index.html'), '<body><main><section id="hero"><h1>Hi</h1></section></main></body>');
    writeFileSync(join(siteDir, 'bare.html'), '<body><header><p>chrome only</p></header><main></main></body>');
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir }, ctx);
      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text) as { pages: number; emptyPages: string[] };
      expect(summary.pages).toBe(2);
      expect(summary.emptyPages).toEqual(['bare']);
      expect(existsSync(join(outDir, 'composed', 'bare.blocks.html'))).toBe(true);
      expect(readFileSync(join(outDir, 'composed', 'bare.blocks.html'), 'utf8')).toBe('');
      const report = JSON.parse(readFileSync(join(outDir, 'normalize-report.json'), 'utf8')) as { emptyPages: string[] };
      expect(report.emptyPages).toEqual(['bare']);
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('nativeBehaviors: detects reveal from source assets and tags sidecar sections', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site-nb-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out-nb-'));
    writeFileSync(
      join(siteDir, 'index.html'),
      '<html><head><link rel="stylesheet" href="styles.css"></head><body><main><section id="hero"><h1>Hi</h1></section></main><script src="site.js"></script></body></html>',
    );
    writeFileSync(
      join(siteDir, 'styles.css'),
      'html.js section { opacity: 0; transform: translateY(18px); transition: opacity 600ms ease, transform 600ms ease; }',
    );
    writeFileSync(
      join(siteDir, 'site.js'),
      "const obs = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('is-visible')), { threshold: 0.12 });\n" +
        "document.querySelectorAll('section').forEach((s) => obs.observe(s));\n",
    );
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir, nativeBehaviors: true }, ctx);
      expect(res.isError).toBeFalsy();
      const sidecar = readFileSync(join(outDir, 'composed', 'home.blocks.html'), 'utf8');
      expect(sidecar).toContain('wp:dla/reveal');
      expect(sidecar).toContain('data-wp-interactive="dla/reveal"');
      expect(sidecar).not.toContain('wp:group');
      const report = JSON.parse(readFileSync(join(outDir, 'normalize-report.json'), 'utf8')) as {
        entries: Array<{ blockType: string }>;
      };
      expect(report.entries.every((e) => e.blockType === 'dla/reveal')).toBe(true);
      // Standalone observability: the summary surfaces what detection found
      // (no artifact write — behavior-gaps.json stays the convert stage's).
      const summary = JSON.parse(res.content[0].text) as { behaviors?: { reveal: boolean; gaps: number } };
      expect(summary.behaviors).toEqual({ reveal: true, tabs: 0, slider: 0, modal: 0, gaps: 0 });
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('nativeBehaviors: per-section detection tags tabs sidecars and counts ride the summary', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site-nbtabs-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out-nbtabs-'));
    writeFileSync(
      join(siteDir, 'index.html'),
      '<html><head><link rel="stylesheet" href="styles.css"></head><body><main>' +
        '<section id="hero"><h1>Hi</h1></section>' +
        '<section id="plans"><div role="tablist">' +
        '<button role="tab" aria-selected="true" aria-controls="p-a" class="tab is-active">A</button>' +
        '<button role="tab" aria-selected="false" aria-controls="p-b" class="tab">B</button></div>' +
        '<div role="tabpanel" id="p-a"><p>Alpha</p></div>' +
        '<div role="tabpanel" id="p-b" hidden><p>Beta</p></div></section>' +
        '</main><script src="site.js"></script></body></html>',
    );
    writeFileSync(
      join(siteDir, 'styles.css'),
      'html.js section { opacity: 0; transform: translateY(18px); transition: opacity 600ms ease, transform 600ms ease; }',
    );
    writeFileSync(
      join(siteDir, 'site.js'),
      "const obs = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('is-visible')), { threshold: 0.12 });\n" +
        "document.querySelectorAll('section').forEach((s) => obs.observe(s));\n" +
        "document.querySelectorAll('[role=\"tab\"]').forEach((t) => t.addEventListener('click', () => {\n" +
        "  t.classList.add('is-active');\n" +
        '}));\n',
    );
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir, nativeBehaviors: true }, ctx);
      expect(res.isError).toBeFalsy();
      const sidecar = readFileSync(join(outDir, 'composed', 'home.blocks.html'), 'utf8');
      expect(sidecar).toContain('data-wp-interactive="dla/tabs"'); // specific section
      expect(sidecar).toContain('data-wp-interactive="dla/reveal"'); // uniform fallback
      expect(sidecar).toContain('role="tab"'); // verbatim inner
      // Counts from the compose reports; the tabs driver js is CLAIMED once
      // its section fired, so it does not inflate gaps.
      const summary = JSON.parse(res.content[0].text) as { behaviors?: Record<string, unknown> };
      expect(summary.behaviors).toEqual({ reveal: true, tabs: 1, slider: 0, modal: 0, gaps: 0 });
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('nativeBehaviors with no catalog match leaves sections as group', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site-nbnone-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out-nbnone-'));
    // No reveal css gate, no observer js — detection finds nothing to map.
    writeFileSync(join(siteDir, 'index.html'), '<body><main><section id="hero"><h1>Hi</h1></section></main></body>');
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir, nativeBehaviors: true }, ctx);
      expect(res.isError).toBeFalsy();
      const sidecar = readFileSync(join(outDir, 'composed', 'home.blocks.html'), 'utf8');
      expect(sidecar).toContain('wp:group');
      expect(sidecar).not.toContain('dla/reveal');
      // No-match shape: key present (flag on), nothing found.
      const summary = JSON.parse(res.content[0].text) as { behaviors?: { reveal: boolean; gaps: number } };
      expect(summary.behaviors).toEqual({ reveal: false, tabs: 0, slider: 0, modal: 0, gaps: 0 });
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('default ingest (no flag) never tags (regression)', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site-nboff-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out-nboff-'));
    // Source HAS the reveal patterns, but the flag is off — no detection runs.
    writeFileSync(
      join(siteDir, 'index.html'),
      '<html><head><link rel="stylesheet" href="styles.css"></head><body><main><section id="hero"><h1>Hi</h1></section></main><script src="site.js"></script></body></html>',
    );
    writeFileSync(join(siteDir, 'styles.css'), 'html.js section { opacity: 0; }');
    writeFileSync(
      join(siteDir, 'site.js'),
      "const obs = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.add('is-visible')));\ndocument.querySelectorAll('section').forEach((s) => obs.observe(s));\n",
    );
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir }, ctx);
      expect(res.isError).toBeFalsy();
      const sidecar = readFileSync(join(outDir, 'composed', 'home.blocks.html'), 'utf8');
      expect(sidecar).toContain('wp:group');
      expect(sidecar).not.toContain('dla/reveal');
      // Flag off → key absent (default summary byte-stable).
      const summary = JSON.parse(res.content[0].text) as { behaviors?: unknown };
      expect(summary.behaviors).toBeUndefined();
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('carry ingest (no flag): interactive scaffolding survives VERBATIM in a group wrapper', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const siteDir = mkdtempSync(join(FIXTURE_TMP, 'site-carrytabs-'));
    const outDir = mkdtempSync(join(FIXTURE_TMP, 'out-carrytabs-'));
    // Tabs DOM pattern + its JS driver, flag OFF: the carry path must keep the
    // scaffolding byte-true (emitChild's catch-all destroyed it — carry E2E
    // unresolved missing tab/panel structural divergences) inside a plain
    // group wrapper with no plugin dependency.
    writeFileSync(
      join(siteDir, 'index.html'),
      '<html><head></head><body><main>' +
        '<section id="plans"><div role="tablist">' +
        '<button role="tab" aria-selected="true" aria-controls="p-a" class="tab is-active">A</button>' +
        '<button role="tab" aria-selected="false" aria-controls="p-b" class="tab">B</button></div>' +
        '<div role="tabpanel" id="p-a"><p>Alpha</p></div>' +
        '<div role="tabpanel" id="p-b" hidden><p>Beta</p></div></section>' +
        '</main><script src="site.js"></script></body></html>',
    );
    writeFileSync(
      join(siteDir, 'site.js'),
      'document.querySelectorAll(\'[role="tab"]\').forEach((t) => t.addEventListener(\'click\', () => {\n' +
        "  t.classList.add('is-active');\n" +
        '}));\n',
    );
    try {
      const res = await ingestLocalSiteHandler({ dir: siteDir, outputDir: outDir }, ctx);
      expect(res.isError).toBeFalsy();
      const sidecar = readFileSync(join(outDir, 'composed', 'home.blocks.html'), 'utf8');
      expect(sidecar).toContain('role="tab"');
      expect(sidecar).toContain('aria-controls="p-a"');
      expect(sidecar).toContain('wp:group');
      // editable-html islands are the default now: the verbatim interactive scaffolding
      // survives inside a dla/editable-html block (static save = byte-identical HTML), so
      // role/aria above are still present. nativeBehaviors stays flag-gated: no behavior blocks.
      expect(sidecar).not.toContain('dla/reveal');
      expect(sidecar).not.toContain('dla/sticky');
      expect(sidecar).not.toContain('data-wp-interactive');
      // Summary stays flag-gated.
      const summary = JSON.parse(res.content[0].text) as { behaviors?: unknown };
      expect(summary.behaviors).toBeUndefined();
    } finally {
      rmSync(siteDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
