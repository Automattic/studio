import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { HandlerContext, ToolResult } from '../handler-types.js';
import { dataModelScaffoldHandler } from './data-model-scaffold.js';
import { composePage } from '../../lib/replicate/normalize/compose-page.js';
import { injectQueryLoops } from '../../lib/replicate/local-data/inject-query-loops.js';
import { neutralizeStaticCards } from '../../lib/replicate/local-data/neutralize-static-cards.js';
import type { MountSpec } from '../../lib/replicate/local-data/types.js';
import type { LocalPage } from '../../lib/replicate/local-site/types.js';

const ctx = {
  textResult: (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] }),
  errorResult: (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true }),
} as unknown as HandlerContext;
const TMP = join(process.cwd(), '.tmp-test');

describe('dataModelScaffoldHandler', () => {
  it('scaffolds with NO assets/ dir and a malformed JS file present (skips, never aborts)', async () => {
    mkdirSync(TMP, { recursive: true });
    const dir = mkdtempSync(join(TMP, 'dms-'));
    const out = mkdtempSync(join(TMP, 'dms-out-'));
    try {
      writeFileSync(join(dir, 'shop.html'), `<div class="g" id="grid"></div>`);
      writeFileSync(join(dir, 'data.js'), `const ITEMS=[{id:'a',title:'A',cat:'x'},{id:'b',title:'B',cat:'y'}]; mount('#grid', ITEMS); function open(i){return ITEMS.find(x=>x.id===i);}`);
      writeFileSync(join(dir, 'broken.js'), `const x = {{{ not valid`);
      const res = await dataModelScaffoldHandler({ dir, outputDir: out }, ctx);
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(res.content[0].text) as { model: { items: unknown[] }; discovered: { skippedFiles: string[] } };
      expect(data.model.items).toHaveLength(2);
      expect(data.discovered.skippedFiles).toContain('broken.js');
      expect(existsSync(join(out, 'data-model.draft.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('scaffolds inline script data arrays and mount calls from HTML files', async () => {
    mkdirSync(TMP, { recursive: true });
    const dir = mkdtempSync(join(TMP, 'dms-inline-'));
    const out = mkdtempSync(join(TMP, 'dms-inline-out-'));
    try {
      writeFileSync(
        join(dir, 'shop.html'),
        `<div id="grid"></div><script>const ITEMS=[{id:'a',title:'A',cat:'x'},{id:'b',title:'B',cat:'y'}]; mountGrid('#grid', ITEMS); function open(i){return ITEMS.find(x=>x.id===i);}</script>`
      );
      const res = await dataModelScaffoldHandler({ dir, outputDir: out }, ctx);
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(res.content[0].text) as { model: { items: unknown[]; mounts: Array<{ selector: string }> } };
      expect(data.model.items).toHaveLength(2);
      expect(data.model.mounts.map((mount) => mount.selector)).toContain('#grid');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('scaffolds posts from a static-HTML card grid, extracting bodies from linked pages', async () => {
    mkdirSync(TMP, { recursive: true });
    const dir = mkdtempSync(join(TMP, 'dms-cards-'));
    const out = mkdtempSync(join(TMP, 'dms-cards-out-'));
    try {
      writeFileSync(join(dir, 'index.html'), `
      <main><div class="cluster">
        <article class="tile"><div class="thumb"><img src="a.png"></div><div class="meat">
          <a class="kicker" href="cat-news.html">News</a>
          <h3><a href="p1.html">Alpha</a></h3><p>Excerpt alpha here long enough.</p><time>Jan 1, 2024</time></div></article>
        <article class="tile"><div class="thumb"><img src="b.png"></div><div class="meat">
          <a class="kicker" href="cat-news.html">News</a>
          <h3><a href="p2.html">Beta</a></h3><p>Excerpt beta here long enough.</p><time>Jan 2, 2024</time></div></article>
        <article class="tile"><div class="thumb"><img src="c.png"></div><div class="meat">
          <a class="kicker" href="cat-reviews.html">Reviews</a>
          <h3><a href="p3.html">Gamma</a></h3><p>Excerpt gamma here long enough.</p><time>Jan 3, 2024</time></div></article>
      </div></main>`);
      writeFileSync(join(dir, 'p1.html'), `<main><article><p>The full body of Alpha, longer than its excerpt.</p></article></main>`);
      const res = await dataModelScaffoldHandler({ dir, outputDir: out }, ctx);
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(res.content[0].text) as {
        model: { items: Array<{ title: string; content?: string }> };
        discovered: { source: string };
      };
      expect(data.discovered.source).toBe('html-cards');
      expect(data.model.items).toHaveLength(3);
      const alpha = data.model.items.find((i) => i.title === 'Alpha')!;
      expect(alpha.content).toContain('The full body of Alpha');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('does not resolve card links outside the source directory', async () => {
    mkdirSync(TMP, { recursive: true });
    const dir = mkdtempSync(join(TMP, 'dms-cards-'));
    const sibling = `${dir}-sibling`;
    const out = mkdtempSync(join(TMP, 'dms-cards-out-'));
    try {
      mkdirSync(sibling, { recursive: true });
      writeFileSync(join(dir, 'index.html'), `
      <main><div class="cluster">
        <article class="tile"><div class="thumb"><img src="a.png"></div><div class="meat">
          <a class="kicker" href="cat-news.html">News</a>
          <h3><a href="../${basename(sibling)}/p1.html">Alpha</a></h3><p>Excerpt alpha here long enough.</p><time>Jan 1, 2024</time></div></article>
        <article class="tile"><div class="thumb"><img src="b.png"></div><div class="meat">
          <a class="kicker" href="cat-news.html">News</a>
          <h3><a href="p2.html">Beta</a></h3><p>Excerpt beta here long enough.</p><time>Jan 2, 2024</time></div></article>
        <article class="tile"><div class="thumb"><img src="c.png"></div><div class="meat">
          <a class="kicker" href="cat-reviews.html">Reviews</a>
          <h3><a href="p3.html">Gamma</a></h3><p>Excerpt gamma here long enough.</p><time>Jan 3, 2024</time></div></article>
      </div></main>`);
      writeFileSync(join(sibling, 'p1.html'), `<main><article><p>Escaped Alpha body should not be read.</p></article></main>`);
      const res = await dataModelScaffoldHandler({ dir, outputDir: out }, ctx);
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(res.content[0].text) as {
        model: { items: Array<{ title: string; content?: string }> };
        discovered: { source: string };
      };
      expect(data.discovered.source).toBe('html-cards');
      const alpha = data.model.items.find((i) => i.title === 'Alpha')!;
      expect(alpha.content).toContain('Excerpt alpha here long enough.');
      expect(alpha.content).not.toContain('Escaped Alpha body');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sibling, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('resolves card links when the source dir is the current directory', async () => {
    mkdirSync(TMP, { recursive: true });
    const dir = mkdtempSync(join(TMP, 'dms-cards-cwd-'));
    const out = mkdtempSync(join(TMP, 'dms-cards-cwd-out-'));
    const cwd = process.cwd();
    try {
      writeFileSync(join(dir, 'index.html'), `
      <main><div class="cluster">
        <article class="tile"><div class="thumb"><img src="a.png"></div><div class="meat">
          <a class="kicker" href="cat-news.html">News</a>
          <h3><a href="p1.html">Alpha</a></h3><p>Excerpt alpha here long enough.</p><time>Jan 1, 2024</time></div></article>
        <article class="tile"><div class="thumb"><img src="b.png"></div><div class="meat">
          <a class="kicker" href="cat-news.html">News</a>
          <h3><a href="p2.html">Beta</a></h3><p>Excerpt beta here long enough.</p><time>Jan 2, 2024</time></div></article>
        <article class="tile"><div class="thumb"><img src="c.png"></div><div class="meat">
          <a class="kicker" href="cat-reviews.html">Reviews</a>
          <h3><a href="p3.html">Gamma</a></h3><p>Excerpt gamma here long enough.</p><time>Jan 3, 2024</time></div></article>
      </div></main>`);
      writeFileSync(join(dir, 'p1.html'), `<main><article><p>The cwd Alpha body, longer than its excerpt.</p></article></main>`);
      process.chdir(dir);
      const res = await dataModelScaffoldHandler({ dir: '.', outputDir: out }, ctx);
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(res.content[0].text) as {
        model: { items: Array<{ title: string; content?: string }> };
        discovered: { source: string };
      };
      expect(data.discovered.source).toBe('html-cards');
      const alpha = data.model.items.find((i) => i.title === 'Alpha')!;
      expect(alpha.content).toContain('The cwd Alpha body');
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('scopes static-card neutralization to the page where the grid was discovered', async () => {
    mkdirSync(TMP, { recursive: true });
    const dir = mkdtempSync(join(TMP, 'dms-multipage-cards-'));
    const out = mkdtempSync(join(TMP, 'dms-multipage-cards-out-'));
    const aboutHtml = `<!DOCTYPE html>
    <html lang="en">
      <head><title>About the Studio</title></head>
      <body>
        <nav>
          <ul>
            <li><a href="index.html">Home</a></li>
            <li><a href="p1.html">Alpha</a></li>
            <li><a href="p2.html">Beta</a></li>
            <li><a href="p3.html">Gamma</a></li>
          </ul>
        </nav>
        <main>
          <h1>About the Studio</h1>
          <p>This page has prose and navigation only. It must not become a content-card source.</p>
        </main>
      </body>
    </html>`;
    const indexHtml = `<!DOCTYPE html>
    <html lang="en">
      <head><title>Signal Journal</title></head>
      <body>
        <main>
          <section class="journal-band">
            <h2>Latest Field Notes</h2>
            <div class="ledger-grid">
              <article class="dispatch-card">
                <img src="alpha.jpg" alt="Alpha image">
                <p><a href="cat-news.html">News</a></p>
                <h3><a href="p1.html">Alpha Dispatch</a></h3>
                <p>Alpha excerpt has enough detail for the card detector to treat it as content.</p>
              </article>
              <article class="dispatch-card">
                <img src="beta.jpg" alt="Beta image">
                <p><a href="cat-news.html">News</a></p>
                <h3><a href="p2.html">Beta Dispatch</a></h3>
                <p>Beta excerpt has enough detail for the card detector to treat it as content.</p>
              </article>
              <article class="dispatch-card">
                <img src="gamma.jpg" alt="Gamma image">
                <p><a href="cat-reviews.html">Reviews</a></p>
                <h3><a href="p3.html">Gamma Dispatch</a></h3>
                <p>Gamma excerpt has enough detail for the card detector to treat it as content.</p>
              </article>
            </div>
          </section>
        </main>
      </body>
    </html>`;

    try {
      writeFileSync(join(dir, 'about.html'), aboutHtml);
      writeFileSync(join(dir, 'index.html'), indexHtml);
      writeFileSync(join(dir, 'p1.html'), '<main><article><p>Full Alpha body from the local page.</p></article></main>');
      writeFileSync(join(dir, 'p2.html'), '<main><article><p>Full Beta body from the local page.</p></article></main>');
      writeFileSync(join(dir, 'p3.html'), '<main><article><p>Full Gamma body from the local page.</p></article></main>');

      const res = await dataModelScaffoldHandler({ dir, outputDir: out }, ctx);
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(res.content[0].text) as {
        model: { items: unknown[]; mounts: MountSpec[] };
        discovered: { source: string };
      };
      expect(data.discovered.source).toBe('html-cards');
      expect(data.model.items).toHaveLength(3);
      const mount = data.model.mounts.find((m) => m.sourceCall.startsWith('html-cards:'));
      expect(mount).toBeDefined();
      expect(mount!.sourcePage).toBe('index.html');

      const neutralizedIndex = neutralizeStaticCards(indexHtml, [mount!]);
      expect(neutralizedIndex.stamped).toHaveLength(1);
      expect(neutralizedIndex.stamped).toEqual([mount!.selector]);
      expect(neutralizeStaticCards(aboutHtml, [mount!]).stamped).toEqual([]);

      const page: LocalPage = {
        relPath: 'index.html',
        slug: 'home',
        html: neutralizedIndex.html,
        title: 'Signal Journal',
      };
      const composed = composePage(page, { pageSlugs: ['home'] });
      const injected = injectQueryLoops(composed.postContent, [mount!]);
      expect(injected.injected).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });
});
