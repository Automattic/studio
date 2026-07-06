import { describe, expect, it } from 'vitest';
import { checkConservationLeaks } from './conservation-check.js';

describe('checkConservationLeaks', () => {
  it('reports one dropped actionable region and zero leaks when that region is placed', () => {
    const sourceHtml = `<html><body><main>
      <nav id="docs-nav"><a href="intro.html">Intro</a><a href="api.html">API</a></nav>
      <section id="article"><h1>Guide</h1><p>This article body is present in the emitted page content.</p></section>
    </main></body></html>`;

    const dropped = checkConservationLeaks({
      pageSlug: 'guide',
      sourceHtml,
      postContent: '<!-- wp:group {"anchor":"article"} --><section id="article">This article body is present in the emitted page content.</section><!-- /wp:group -->',
      partMarkup: [],
    });

    expect(dropped).toEqual([
      {
        selector: 'nav#docs-nav',
        role: 'nav',
        pageSlug: 'guide',
        reason: 'actionable_region_unplaced',
      },
    ]);

    const clean = checkConservationLeaks({
      pageSlug: 'guide',
      sourceHtml,
      postContent:
        '<!-- wp:group {"anchor":"docs-nav"} --><section id="docs-nav">Intro API</section><!-- /wp:group -->\n' +
        '<!-- wp:group {"anchor":"article"} --><section id="article">This article body is present in the emitted page content.</section><!-- /wp:group -->',
      partMarkup: [],
    });

    expect(clean).toEqual([]);
  });

  it('ignores decorative nodes and reports an interior-only rail missing from home-derived chrome', () => {
    const decorative = checkConservationLeaks({
      pageSlug: 'home',
      sourceHtml: `<html><body><main>
        <script>window.fictional = true;</script>
        <div class="spacer">New</div>
        <section id="copy"><p>This substantial body copy is safely present in the output.</p></section>
      </main></body></html>`,
      postContent: '<section id="copy">This substantial body copy is safely present in the output.</section>',
      partMarkup: [],
    });

    expect(decorative).toEqual([]);

    const interiorRail = checkConservationLeaks({
      pageSlug: 'reference',
      sourceHtml: `<html><body>
        <header id="site-header"><a href="index.html">Home</a></header>
        <div class="layout">
          <aside id="reference-rail" class="side-rail"><nav><a href="setup.html">Setup</a><a href="api.html">API</a></nav></aside>
          <main><section id="reference-copy"><p>The reference copy is present in the page body.</p></section></main>
        </div>
      </body></html>`,
      postContent: '<section id="reference-copy">The reference copy is present in the page body.</section>',
      partMarkup: ['<header id="site-header"><a href="/">Home</a></header>'],
    });

    expect(interiorRail).toEqual([
      {
        selector: 'aside#reference-rail.side-rail',
        role: 'aside',
        pageSlug: 'reference',
        reason: 'actionable_region_unplaced',
      },
    ]);
  });

  it('does not treat repeated link labels in body copy as semantic-region placement', () => {
    const leaks = checkConservationLeaks({
      pageSlug: 'reference',
      sourceHtml: `<html><body>
        <div class="layout">
          <aside class="side-rail"><nav><a href="setup.html">Setup</a><a href="api.html">API</a></nav></aside>
          <main><section id="article"><p>The article discusses Setup and API topics in ordinary body copy.</p></section></main>
        </div>
      </body></html>`,
      postContent: '<section id="article">The article discusses Setup and API topics in ordinary body copy.</section>',
      partMarkup: [],
    });

    expect(leaks).toEqual([
      {
        selector: 'aside.side-rail',
        role: 'aside',
        pageSlug: 'reference',
        reason: 'actionable_region_unplaced',
      },
    ]);
  });

  it('does not treat a shared class on unrelated output as semantic-region placement', () => {
    const leaks = checkConservationLeaks({
      pageSlug: 'reference',
      sourceHtml: `<html><body>
        <div class="layout">
          <aside class="shared-rail">Operational links and reference material for fictional docs.</aside>
          <main><section id="article"><p>The emitted article body survives independently.</p></section></main>
        </div>
      </body></html>`,
      postContent: '<section id="article" class="shared-rail">The emitted article body survives independently.</section>',
      partMarkup: [],
    });

    expect(leaks).toEqual([
      {
        selector: 'aside.shared-rail',
        role: 'aside',
        pageSlug: 'reference',
        reason: 'actionable_region_unplaced',
      },
    ]);
  });
});
