// src/lib/replicate/normalize/segment.test.ts
import { describe, it, expect } from 'vitest';
import { segmentPage } from './segment.js';

describe('segmentPage', () => {
  it('splits chrome from body sections under <main>', () => {
    const html = `<body>
      <header id="masthead"><nav><a href="x.html">X</a></nav></header>
      <main>
        <section id="hero"><h1>Hi</h1></section>
        <section class="features"><h2>Feat</h2></section>
      </main>
      <footer><p>(c)</p></footer>
    </body>`;
    const sections = segmentPage(html);
    expect(sections.find((s) => s.role === 'header')).toBeTruthy();
    expect(sections.find((s) => s.role === 'footer')).toBeTruthy();
    const body = sections.filter((s) => s.role === 'body');
    // 'hero' from the id attr; 'feat' from the h2 slug (heading beats class).
    expect(body.map((s) => s.id)).toEqual(['hero', 'feat']);
  });

  it('derives a stable, deterministic id when no id/class is present', () => {
    const html = '<main><section><h2>Pricing Plans</h2></section></main>';
    const a = segmentPage(html);
    const b = segmentPage(html);
    expect(a[0].id).toBe(b[0].id); // deterministic
    expect(a[0].id.length).toBeGreaterThan(0);
  });

  it('dedups duplicate class-derived body ids with ordinal suffixes', () => {
    const html = `<main>
      <section class="card"><p>One</p></section>
      <section class="card"><p>Two</p></section>
    </main>`;
    const body = segmentPage(html).filter((s) => s.role === 'body');
    expect(body.map((s) => s.id)).toEqual(['card', 'card-2']);
  });

  it('does not treat a nested header as page chrome', () => {
    const html = `<body>
      <main>
        <article class="post"><header><h2>Post Title</h2></header><p>Body text</p></article>
      </main>
    </body>`;
    const sections = segmentPage(html);
    expect(sections.find((s) => s.role === 'header')).toBeUndefined();
    const body = sections.filter((s) => s.role === 'body');
    expect(body).toHaveLength(1);
    expect(body[0].html).toContain('<header>');
  });

  it('prefers a heading slug over utility-first classes for the id', () => {
    const html = '<main><div class="flex mt-8"><h2>About Us</h2></div></main>';
    const body = segmentPage(html).filter((s) => s.role === 'body');
    expect(body.map((s) => s.id)).toEqual(['about-us']);
  });

  it('avoids a section id that collides with a descendant heading id', () => {
    // <h2 id="features"> would make slug "features" duplicate the heading's own id.
    const html = '<main><section><h2 id="features">Features</h2><p>x</p></section></main>';
    const body = segmentPage(html).filter((s) => s.role === 'body');
    expect(body[0].id).toBe('features-section');
    // no descendant collision → plain heading slug
    const html2 = '<main><section><h2>Features</h2><p>x</p></section></main>';
    expect(segmentPage(html2).filter((s) => s.role === 'body')[0].id).toBe('features');
  });

  it('captures a body-direct nav as a chrome section', () => {
    const html = `<body>
      <nav id="main-nav"><a href="a.html">A</a></nav>
      <main><section id="s1"><h2>S</h2></section></main>
    </body>`;
    const navs = segmentPage(html).filter((s) => s.role === 'nav');
    expect(navs).toHaveLength(1);
    expect(navs[0].html).toContain('main-nav');
  });

  it('recognizes a layout-level aside rail outside content as chrome', () => {
    const html = `<body>
      <div class="docs-layout">
        <aside class="docs-sidebar"><nav><a href="intro.html">Intro</a><a href="api.html">API</a></nav></aside>
        <main><section id="overview"><h1>Overview</h1></section></main>
      </div>
    </body>`;
    const sections = segmentPage(html);
    const rails = sections.filter((s) => s.role === 'nav' && s.id === 'docs-sidebar');
    expect(rails).toHaveLength(1);
    expect(rails[0].html).toContain('docs-sidebar');
    expect(rails[0].html).toContain('api.html');
    expect(sections.filter((s) => s.role === 'body').map((s) => s.id)).toEqual(['overview']);
  });

  it('removes a captured layout rail from no-main wrapper body sections', () => {
    const html = `<body>
      <div class="layout">
        <aside class="sidebar"><nav><a href="intro.html">Intro</a><a href="api.html">API</a></nav></aside>
        <div class="content"><h1>Guide</h1><p>Read the docs.</p></div>
      </div>
    </body>`;
    const sections = segmentPage(html);
    const rails = sections.filter((s) => s.role === 'nav' && s.id === 'sidebar');
    expect(rails).toHaveLength(1);
    expect(rails[0].chromeSource).toBe('layout-rail');
    const body = sections.filter((s) => s.role === 'body');
    expect(body).toHaveLength(1);
    expect(body[0].html).toContain('content');
    expect(body[0].html).toContain('Guide');
    expect(body[0].html).not.toContain('sidebar');
    expect(body[0].html).not.toContain('intro.html');
    expect(body[0].html).not.toContain('api.html');
  });

  it('does not remove a layout wrapper that contains content landmarks', () => {
    const html = `<body>
      <aside class="docs-shell">
        <nav id="rail-nav"><a href="intro.html">Intro</a><a href="api.html">API</a></nav>
        <main><section id="guide"><h1>Guide</h1><p>Read the docs.</p></section></main>
      </aside>
    </body>`;
    const sections = segmentPage(html);
    const rails = sections.filter((s) => s.role === 'nav');
    expect(rails).toHaveLength(1);
    expect(rails[0].id).toBe('rail-nav');
    const body = sections.filter((s) => s.role === 'body');
    expect(body).toHaveLength(1);
    expect(body[0].html).toContain('Read the docs.');
    expect(body[0].html).not.toContain('intro.html');
    expect(body[0].html).not.toContain('api.html');
  });

  it('does not remove a role wrapper that contains aria content landmarks', () => {
    const html = `<body>
      <div role="complementary" class="docs-shell">
        <nav id="rail-nav"><a href="intro.html">Intro</a><a href="api.html">API</a></nav>
        <div role="main"><div id="guide"><h1>Guide</h1><p>Read the docs.</p></div></div>
      </div>
    </body>`;
    const sections = segmentPage(html);
    const rails = sections.filter((s) => s.role === 'nav');
    expect(rails).toHaveLength(1);
    expect(rails[0].id).toBe('rail-nav');
    const body = sections.filter((s) => s.role === 'body');
    expect(body).toHaveLength(1);
    expect(body[0].html).toContain('Read the docs.');
    expect(body[0].html).not.toContain('intro.html');
    expect(body[0].html).not.toContain('api.html');
  });

  it('keeps navigation inside aria content landmarks as body content', () => {
    const html = `<body>
      <div role="main" class="article-shell">
        <nav id="local-toc"><a href="#one">One</a><a href="#two">Two</a></nav>
        <div class="content"><h1>Guide</h1><p>Read the docs.</p></div>
      </div>
    </body>`;
    const sections = segmentPage(html);
    expect(sections.find((s) => s.role === 'nav')).toBeUndefined();
    const body = sections.filter((s) => s.role === 'body');
    expect(body).toHaveLength(1);
    expect(body[0].html).toContain('local-toc');
    expect(body[0].html).toContain('Read the docs.');
  });

  it('keeps a pull-quote aside inside article body content', () => {
    const html = `<body>
      <main><article class="post"><p>Body copy</p><aside class="pull-quote">Pull quote</aside></article></main>
    </body>`;
    const sections = segmentPage(html);
    expect(sections.find((s) => s.role === 'nav')).toBeUndefined();
    const body = sections.filter((s) => s.role === 'body');
    expect(body).toHaveLength(1);
    expect(body[0].html).toContain('pull-quote');
  });

  it('recognizes role complementary outside content when actionable', () => {
    const html = `<body>
      <div class="layout">
        <div role="complementary" class="resource-rail">
          <a href="guide.html">Guide</a><a href="reference.html">Reference</a>
        </div>
        <main><section id="article"><h1>Article</h1></section></main>
      </div>
    </body>`;
    const rails = segmentPage(html).filter((s) => s.role === 'nav' && s.id === 'resource-rail');
    expect(rails).toHaveLength(1);
    expect(rails[0].html).toContain('role="complementary"');
  });

  it('does not over-capture a short decorative aside as chrome (it becomes loose body content)', () => {
    const html = `<body>
      <aside class="badge">New</aside>
      <main><section id="content"><h1>Content</h1></section></main>
    </body>`;
    const sections = segmentPage(html);
    // The aside is NOT chrome (not a nav/rail)...
    expect(sections.find((s) => s.role === 'nav')).toBeUndefined();
    // ...but as a loose body-level sibling of <main> it is carried as body
    // content (never-lose-content), not dropped.
    expect(sections.filter((s) => s.role === 'body').map((s) => s.id)).toEqual(['badge', 'content']);
  });

  it('avoids dedup suffix collision with a pre-existing literal id', () => {
    const html = `<main>
      <section id="card-2"><p>Literal</p></section>
      <section class="card"><p>One</p></section>
      <section class="card"><p>Two</p></section>
    </main>`;
    const body = segmentPage(html).filter((s) => s.role === 'body');
    // The second class-derived "card" must skip the taken "card-2" slot.
    expect(body.map((s) => s.id)).toEqual(['card-2', 'card', 'card-3']);
    expect(new Set(body.map((s) => s.id)).size).toBe(body.length);
  });

  it('captures loose <main> children as individual body sections', () => {
    const html = '<body><main><h1>Welcome</h1><p>Intro para</p></main></body>';
    const body = segmentPage(html).filter((s) => s.role === 'body');
    expect(body).toHaveLength(2);
    expect(body[0].html).toContain('<h1>Welcome</h1>');
    expect(body[1].html).toContain('<p>Intro para</p>');
  });

  it('captures mixed top-level main children (wrappers AND loose elements)', () => {
    const html = `<main>
      <section id="intro"><p>Sec text</p></section>
      <figure><img src="photo.jpg" alt="P"/></figure>
      <h1>Page Title</h1>
    </main>`;
    const body = segmentPage(html).filter((s) => s.role === 'body');
    expect(body).toHaveLength(3);
    expect(body[0].id).toBe('intro');
    expect(body[0].html).toContain('Sec text');
    expect(body[1].html).toContain('photo.jpg');
    expect(body[2].html).toContain('Page Title');
  });

  it('wraps a loose top-level text node as a paragraph section', () => {
    const html = '<main>Hello<section id="s"><p>S text</p></section></main>';
    const body = segmentPage(html).filter((s) => s.role === 'body');
    expect(body).toHaveLength(2);
    expect(body[0].html).toBe('<p>Hello</p>');
    expect(body[1].id).toBe('s');
  });

  it('skips non-rendering top-level tags (script/style)', () => {
    const html =
      '<main><script>var x=1;</script><style>.a{color:red}</style><section id="s"><p>S text</p></section></main>';
    const body = segmentPage(html).filter((s) => s.role === 'body');
    expect(body.map((s) => s.id)).toEqual(['s']);
  });

  it('captures the section class list', () => {
    const html = '<main><section id="hero" class="hero splash"><h1>Hi</h1></section><div class="cards"><p>x</p></div></main>';
    const sections = segmentPage(html).filter((s) => s.role === 'body');
    expect(sections[0].classes).toEqual(['hero', 'splash']);
    expect(sections[1].classes).toEqual(['cards']);
  });

  it('captures loose body siblings outside <main> (decorative/sticky bars) as body sections', () => {
    // A .grain overlay before <header> and a sticky .marquee between header and
    // <main> are body-level siblings of <main> — carry them, do not drop them.
    const html = `<body>
      <div class="grain" aria-hidden="true"></div>
      <header id="masthead"><nav><a href="x.html">X</a></nav></header>
      <div class="marquee"><span>Ticker</span></div>
      <main>
        <section id="hero"><h1>Hi</h1></section>
      </main>
      <footer><p>(c)</p></footer>
    </body>`;
    const sections = segmentPage(html);
    expect(sections.find((s) => s.role === 'header')).toBeTruthy();
    expect(sections.find((s) => s.role === 'footer')).toBeTruthy();
    const body = sections.filter((s) => s.role === 'body');
    // DOM order: grain + marquee (both before <main>) then main's hero.
    expect(body.map((s) => s.id)).toEqual(['grain', 'marquee', 'hero']);
    expect(body.find((s) => s.id === 'marquee')?.html).toContain('Ticker');
  });

  it('captures a loose body sibling AND still expands a wrapped <main> in place', () => {
    // The loose-sibling capture must descend to <main>'s children when main is
    // nested in a layout wrapper — emit the hero, not the whole .page wrapper.
    const html = `<body>
      <div class="marquee"><span>Ticker</span></div>
      <div class="page"><main><section id="hero"><h1>Hi</h1></section></main></div>
    </body>`;
    const body = segmentPage(html).filter((s) => s.role === 'body');
    expect(body.map((s) => s.id)).toEqual(['marquee', 'hero']);
  });
});
