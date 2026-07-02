import { describe, expect, it } from 'vitest';
import { segmentPage, type Section } from '@automattic/blocks-engine/theme';

interface SectionSignature {
  id: string;
  role: Section['role'];
  html: string;
  classes?: string[];
  chromeSource?: Section['chromeSource'];
  layoutWrapperTag?: string;
  layoutWrapperClasses?: string[];
  layoutWrapperRailPosition?: Section['layoutWrapperRailPosition'];
}

function signatures(html: string): SectionSignature[] {
  return segmentPage(html).map((section) => {
    const signature: SectionSignature = {
      id: section.id,
      role: section.role,
      html: section.html,
    };
    if (section.classes?.length) signature.classes = section.classes;
    if (section.chromeSource) signature.chromeSource = section.chromeSource;
    if (section.layoutWrapperTag) signature.layoutWrapperTag = section.layoutWrapperTag;
    if (section.layoutWrapperClasses?.length) signature.layoutWrapperClasses = section.layoutWrapperClasses;
    if (section.layoutWrapperRailPosition) signature.layoutWrapperRailPosition = section.layoutWrapperRailPosition;
    return signature;
  });
}

describe('engine segmentPage adopt guard', () => {
  it('preserves header/nav/body/footer segmentation', () => {
    expect(
      signatures(
        '<body><header id="mast"><nav><a href="/">Home</a></nav></header><nav id="topnav"><a href="/a">A</a><a href="/b">B</a></nav><main><section id="hero" class="hero"><h1>Hero</h1><p>Lead copy.</p></section><article id="story" class="story"><h2>Story</h2><p>Enough story copy.</p></article></main><footer id="foot">Footer copy</footer></body>',
      ),
    ).toEqual([
      {
        id: 'header',
        role: 'header',
        html: '<header id="mast"><nav><a href="/">Home</a></nav></header>',
      },
      {
        id: 'nav',
        role: 'nav',
        html: '<nav id="topnav"><a href="/a">A</a><a href="/b">B</a></nav>',
      },
      {
        id: 'footer',
        role: 'footer',
        html: '<footer id="foot">Footer copy</footer>',
      },
      {
        id: 'hero',
        role: 'body',
        html: '<section id="hero" class="hero"><h1>Hero</h1><p>Lead copy.</p></section>',
        classes: ['hero'],
      },
      {
        id: 'story',
        role: 'body',
        html: '<article id="story" class="story"><h2>Story</h2><p>Enough story copy.</p></article>',
        classes: ['story'],
      },
    ]);
  });

  it('preserves no-chrome body segmentation', () => {
    expect(
      signatures(
        '<body><main><section id="solo" class="intro"><h1>No Chrome</h1></section><div id="details"><p>Details</p></div></main></body>',
      ),
    ).toEqual([
      {
        id: 'solo',
        role: 'body',
        html: '<section id="solo" class="intro"><h1>No Chrome</h1></section>',
        classes: ['intro'],
      },
      {
        id: 'details',
        role: 'body',
        html: '<div id="details"><p>Details</p></div>',
      },
    ]);
  });

  it('preserves layout rail metadata and body content', () => {
    expect(
      signatures(
        '<body><div class="shell two-col"><aside id="resource-rail" class="rail"><a href="/one">One</a><a href="/two">Two</a></aside><main><section id="content"><h1>Main</h1><p>Main content stays in body.</p></section></main></div></body>',
      ),
    ).toEqual([
      {
        id: 'resource-rail',
        role: 'nav',
        html: '<aside id="resource-rail" class="rail"><a href="/one">One</a><a href="/two">Two</a></aside>',
        classes: ['rail'],
        chromeSource: 'layout-rail',
        layoutWrapperTag: 'div',
        layoutWrapperClasses: ['shell', 'two-col'],
        layoutWrapperRailPosition: 'beforeMain',
      },
      {
        id: 'content',
        role: 'body',
        html: '<section id="content"><h1>Main</h1><p>Main content stays in body.</p></section>',
      },
    ]);
  });

  it('preserves loose body siblings around main', () => {
    expect(
      signatures(
        '<body><div id="grain" class="grain"></div><header id="mast">Header</header><div id="marquee" class="marquee">Ticker</div><main><section id="hero"><h1>Hi</h1></section></main><footer id="foot">Footer</footer></body>',
      ),
    ).toEqual([
      {
        id: 'header',
        role: 'header',
        html: '<header id="mast">Header</header>',
      },
      {
        id: 'footer',
        role: 'footer',
        html: '<footer id="foot">Footer</footer>',
      },
      {
        id: 'grain',
        role: 'body',
        html: '<div id="grain" class="grain"></div>',
        classes: ['grain'],
      },
      {
        id: 'marquee',
        role: 'body',
        html: '<div id="marquee" class="marquee">Ticker</div>',
        classes: ['marquee'],
      },
      {
        id: 'hero',
        role: 'body',
        html: '<section id="hero"><h1>Hi</h1></section>',
      },
    ]);
  });

  it('keeps nested article header as body content', () => {
    expect(
      signatures(
        '<body><main><article id="post"><header><h1>Article Title</h1></header><p>Article body content.</p></article></main></body>',
      ),
    ).toEqual([
      {
        id: 'post',
        role: 'body',
        html: '<article id="post"><header><h1>Article Title</h1></header><p>Article body content.</p></article>',
      },
    ]);
  });

  it('preserves body sections when no main exists', () => {
    expect(
      signatures('<body><section id="alpha"><p>Alpha</p></section><section id="beta"><p>Beta</p></section></body>'),
    ).toEqual([
      {
        id: 'alpha',
        role: 'body',
        html: '<section id="alpha"><p>Alpha</p></section>',
      },
      {
        id: 'beta',
        role: 'body',
        html: '<section id="beta"><p>Beta</p></section>',
      },
    ]);
  });
});
