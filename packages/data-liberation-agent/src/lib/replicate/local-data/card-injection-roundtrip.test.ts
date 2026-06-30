import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { composePage } from '../normalize/compose-page.js';
import type { LocalPage } from '../local-site/types.js';
import { discoverHtmlCards } from './discover-html-cards.js';
import { injectQueryLoops } from './inject-query-loops.js';
import { neutralizeStaticCards } from './neutralize-static-cards.js';
import { syntheticCardAnchor } from './synthetic-anchor.js';
import type { MountSpec } from './types.js';

const FULL_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Signal Journal</title>
  </head>
  <body>
    <header><h1>Signal Journal</h1></header>
    <main>
      <section class="feature-band">
        <h2>Latest Field Notes</h2>
        <div class="ledger-grid">
          <article class="dispatch-card">
            <img src="/images/alpine-lab.jpg" alt="Alpine lab">
            <p><a href="/category/research.html">Research</a></p>
            <h3><a href="/posts/alpine-lab.html">Alpine Lab Opens Its Archive</a></h3>
            <time datetime="2026-01-03">Jan 3, 2026</time>
            <p>Field teams publish a careful look at ice-core notebooks, instrument drift, and recovery work.</p>
          </article>
          <article class="dispatch-card">
            <img src="/images/civic-maps.jpg" alt="Civic maps">
            <p><a href="/category/design.html">Design</a></p>
            <h3><a href="/posts/civic-maps.html">Civic Maps Return to the Studio Wall</a></h3>
            <time datetime="2026-01-11">Jan 11, 2026</time>
            <p>Researchers compare annotated neighborhood maps with oral histories from the planning desk.</p>
          </article>
          <article class="dispatch-card">
            <img src="/images/river-index.jpg" alt="River index">
            <p><a href="/category/places.html">Places</a></p>
            <h3><a href="/posts/river-index.html">River Index Tracks Spring Changes</a></h3>
            <time datetime="2026-01-19">Jan 19, 2026</time>
            <p>The seasonal index records repairs, public access points, and the archive's newest photographs.</p>
          </article>
        </div>
      </section>
    </main>
    <footer><p>Signal Journal archive</p></footer>
  </body>
</html>`;

describe('static-card query-loop injection round trip', () => {
  it('stamps a discovered full-document card grid before compose so injectQueryLoops swaps it', () => {
    const [grid] = discoverHtmlCards(FULL_HTML);
    expect(grid).toBeDefined();

    const mount: MountSpec = {
      selector: `#${syntheticCardAnchor(grid.containerSelector, '0')}`,
      sourceSelector: grid.containerSelector,
      sourceCall: `html-cards:${grid.containerSelector}`,
      query: { postType: 'post', perPage: -1, orderBy: 'date', order: 'ASC' },
    };

    const neutralized = neutralizeStaticCards(FULL_HTML, [mount]);
    expect(neutralized.stamped).toEqual([mount.selector]);

    const $ = cheerio.load(neutralized.html);
    expect($(mount.selector).length).toBe(1);
    expect($(`${mount.selector} article`).length).toBe(0);
    expect($('article').length).toBe(0);

    const page: LocalPage = {
      relPath: 'index.html',
      slug: 'home',
      title: 'Signal Journal',
      html: neutralized.html,
    };
    const composed = composePage(page, { pageSlugs: ['home'] });
    const injected = injectQueryLoops(composed.postContent, [mount]);

    expect(injected.injected.length).toBe(1);
    expect(injected.missing).toEqual([]);
    expect(injected.markup).toContain('<!-- wp:query');
  });
});
