import { describe, it, expect } from 'vitest';
import { discoverHtmlCards, structuralSignature } from './discover-html-cards.js';
import { scaffoldDataModel } from './scaffold-model.js';
import * as cheerio from 'cheerio';

// Deliberately weird, non-semantic class names so a class-keyed shortcut fails.
const MIXED_DEPTH_GRID = `
<main>
  <section class="zone-7">
    <div class="cluster">
      <article class="tile tile--big">
        <div class="thumb"><a href="story-1.html"><img src="a.png" alt=""></a></div>
        <div class="meat">
          <a class="kicker" href="cat-news.html">News</a>
          <h3><a href="story-1.html">First headline here</a></h3>
          <p>An excerpt of the first story that is reasonably long.</p>
          <time>Dec 22, 2023</time>
        </div>
      </article>
      <div class="column">
        <article class="tile tile--row">
          <div class="thumb"><a href="story-2.html"><img src="b.png" alt=""></a></div>
          <div class="meat">
            <a class="kicker" href="cat-guides.html">Guides</a>
            <h3><a href="story-2.html">Second headline</a></h3>
            <time>Dec 19, 2023</time>
          </div>
        </article>
        <article class="tile tile--row">
          <div class="thumb"><a href="story-3.html"><img src="c.png" alt=""></a></div>
          <div class="meat">
            <a class="kicker" href="cat-reviews.html">Reviews</a>
            <h3><a href="story-3.html">Third headline</a></h3>
            <time>Dec 15, 2023</time>
          </div>
        </article>
        <article class="tile tile--row">
          <div class="thumb"><a href="story-4.html"><img src="d.png" alt=""></a></div>
          <div class="meat">
            <a class="kicker" href="cat-news.html">News</a>
            <h3><a href="story-4.html">Fourth headline</a></h3>
            <time>Dec 11, 2023</time>
          </div>
        </article>
      </div>
    </div>
  </section>
</main>`;

function featuredGridWithCategories(categories: [string, string, string, string]): string {
  return `
<main>
  <section>
    <div class="cluster">
      <article class="tile tile--big">
        <div class="thumb"><a href="story-1.html"><img src="a.png" alt=""></a></div>
        <div class="meat">
          <a class="kicker" href="cat-${categories[0].toLowerCase()}.html">${categories[0]}</a>
          <h3><a href="story-1.html">Lead feature story</a></h3>
          <p>An excerpt of the lead story that is reasonably long.</p>
          <time>Dec 22, 2023</time>
        </div>
      </article>
      <div class="column">
        ${[1, 2, 3].map(
          (index) => `
          <article class="tile tile--row">
            <div class="thumb"><a href="story-${index + 1}.html"><img src="${index + 1}.png" alt=""></a></div>
            <div class="meat">
              <a class="kicker" href="cat-${categories[index].toLowerCase()}.html">${categories[index]}</a>
              <h3><a href="story-${index + 1}.html">Feature row ${index}</a></h3>
              <time>Dec ${20 - index}, 2023</time>
            </div>
          </article>`
        ).join('')}
      </div>
    </div>
  </section>
</main>`;
}

const NAV_AND_FOOTER = `
<body>
  <nav><ul>
    <li><a href="a.html">Home</a></li>
    <li><a href="b.html">News</a></li>
    <li><a href="c.html">Reviews</a></li>
    <li><a href="d.html">Guides</a></li>
  </ul></nav>
  <footer><div class="cols">
    <div class="col"><a href="x.html">Link</a></div>
    <div class="col"><a href="y.html">Link</a></div>
    <div class="col"><a href="z.html">Link</a></div>
  </div></footer>
</body>`;

const BASEPLATE_TITLES = Array.from({ length: 13 }, (_, i) => `Card title ${String(i + 1).padStart(2, '0')}`);
const BASEPLATE_CATEGORIES = ['Alpha', 'Beta', 'Gamma'];
const BASEPLATE_SECTION_HEADINGS = ['A Days of thunder on the plain', 'Reviews', 'All Updates'];

function baseplateCard(index: number): string {
  const title = BASEPLATE_TITLES[index - 1];
  const category = BASEPLATE_CATEGORIES[(index - 1) % BASEPLATE_CATEGORIES.length];
  return `
    <article class="bp-card">
      <div class="m"><a href="single.html"><img src="x.png" alt=""></a></div>
      <div class="b">
        <a class="c" href="archive.html">${category}</a>
        <h3><a href="single.html">${title}</a></h3>
        <p>Excerpt for ${title} with enough text to qualify as a rich static card.</p>
        <span>Jan ${String(index).padStart(2, '0')}, 2024</span>
      </div>
    </article>`;
}

const BASEPLATE_SHAPED_PAGE = `
<main>
  <section>
    <h2>${BASEPLATE_SECTION_HEADINGS[0]}</h2>
    <div class="section-wrap">
      ${baseplateCard(1)}
      <div class="column">
        ${baseplateCard(2)}
        ${baseplateCard(3)}
        ${baseplateCard(4)}
      </div>
    </div>
  </section>
  <section>
    <h2>${BASEPLATE_SECTION_HEADINGS[1]}</h2>
    <div class="section-wrap">
      ${baseplateCard(5)}
      <div class="column">
        ${baseplateCard(6)}
        ${baseplateCard(7)}
        ${baseplateCard(8)}
      </div>
    </div>
  </section>
  <section>
    <h2>${BASEPLATE_SECTION_HEADINGS[2]}</h2>
    <div class="section-wrap">
      ${baseplateCard(9)}
      ${baseplateCard(10)}
      ${baseplateCard(11)}
      ${baseplateCard(12)}
      ${baseplateCard(13)}
    </div>
  </section>
</main>`;

const TWO_PER_WRAPPER_TITLES = Array.from({ length: 6 }, (_, i) => `Two-up card ${i + 1}`);
const TWO_PER_WRAPPER_PAGE = `
<main>
  ${[0, 1, 2]
    .map(
      (sectionIndex) => `
      <section>
        <h2>Wrapper heading ${sectionIndex + 1}</h2>
        <div>
          ${[1, 2]
            .map((offset) => {
              const index = sectionIndex * 2 + offset;
              return `
                <article>
                  <div><a href="two-${index}.html"><img src="two-${index}.png" alt=""></a></div>
                  <div>
                    <a class="cat" href="archive.html">Updates</a>
                    <h3><a href="two-${index}.html">${TWO_PER_WRAPPER_TITLES[index - 1]}</a></h3>
                    <p>Excerpt for two-up card ${index} with enough text to count as content.</p>
                    <span>Jan ${String(index).padStart(2, '0')}, 2024</span>
                  </div>
                </article>`;
            })
            .join('')}
        </div>
      </section>`
    )
    .join('')}
</main>`;

const ONE_PER_SECTION_ARTICLE_TITLES = Array.from({ length: 3 }, (_, i) => `Nested article ${i + 1}`);
const ONE_PER_SECTION_PAGE = `
<main>
  ${ONE_PER_SECTION_ARTICLE_TITLES.map(
    (title, i) => `
    <section>
      <h2>Section heading ${i + 1}</h2>
      <article>
        <div><a href="nested-${i + 1}.html"><img src="nested-${i + 1}.png" alt=""></a></div>
        <div>
          <a class="cat" href="archive.html">Updates</a>
          <h3><a href="nested-${i + 1}.html">${title}</a></h3>
          <p>Excerpt for nested article ${i + 1} with enough text to count as content.</p>
          <span>Jan ${String(i + 1).padStart(2, '0')}, 2024</span>
        </div>
      </article>
    </section>`
  ).join('')}
</main>`;

const STACKED_SINGLE_CARD_TITLES = ['Stacked card One', 'Stacked card Two', 'Stacked card Three'];
const STACKED_SINGLE_CARD_HEADINGS = ['Featured', 'Popular', 'Latest'];
const STACKED_SINGLE_CARD_CATEGORIES = ['Alpha', 'Beta', 'Gamma'];

function stackedSingleCard(index: number): string {
  const title = STACKED_SINGLE_CARD_TITLES[index];
  const category = STACKED_SINGLE_CARD_CATEGORIES[index];
  return `
    <article>
      <div class="m"><a href="single.html"><img src="x.png" alt=""></a></div>
      <div class="b">
        <a class="c" href="archive.html">${category}</a>
        <h3><a href="single.html">${title}</a></h3>
        <p>Excerpt for ${title} with enough text to qualify as a rich card.</p>
        <span>Jan 0${index + 1}, 2024</span>
      </div>
    </article>`;
}

const STACKED_SINGLE_CARD_BANDS = `<!doctype html>
<html>
  <body>
    <main>
      ${STACKED_SINGLE_CARD_HEADINGS.map(
        (heading, index) => `
        <section>
          <h2>${heading}</h2>
          ${stackedSingleCard(index)}
        </section>`
      ).join('')}
    </main>
  </body>
</html>`;

const WRAPPER_WITH_INDEPENDENT_TITLES = Array.from({ length: 12 }, (_, i) => `Independent mix card ${i + 1}`);
const WRAPPER_WITH_INDEPENDENT_HEADINGS = ['Wrapper Alpha', 'Wrapper Beta', 'Wrapper Gamma'];

function independentMixCard(index: number): string {
  const title = WRAPPER_WITH_INDEPENDENT_TITLES[index - 1];
  return `
    <article>
      <div><a href="mix-${index}.html"><img src="mix-${index}.png" alt=""></a></div>
      <div>
        <a class="cat" href="archive.html">Mix</a>
        <h3><a href="mix-${index}.html">${title}</a></h3>
        <p>Excerpt for ${title} with enough text to count as a rich card.</p>
        <span>Jan ${String(index).padStart(2, '0')}, 2024</span>
      </div>
    </article>`;
}

const WRAPPER_WITH_INDEPENDENT_GRID_PAGE = `
<main>
  ${[0, 1, 2]
    .map(
      (sectionIndex) => `
      <section>
        <h2>${WRAPPER_WITH_INDEPENDENT_HEADINGS[sectionIndex]}</h2>
        <div>
          ${[1, 2, 3].map((offset) => independentMixCard(sectionIndex * 3 + offset)).join('')}
        </div>
      </section>`
    )
    .join('')}
  <div class="independent-grid">
    ${independentMixCard(10)}
    ${independentMixCard(11)}
    ${independentMixCard(12)}
  </div>
</main>`;

const GENERIC_LIST_TITLES = Array.from({ length: 4 }, (_, i) => `Generic list card ${i + 1}`);
const GENERIC_LIST_PAGE = `
<main>
  <ul>
    ${GENERIC_LIST_TITLES.map(
      (title, i) => `
      <li class="shape-${i + 1}">
        <div class="media-${i + 1}">
          <a href="list-${i + 1}.html"><img src="list-${i + 1}.png" alt=""></a>
        </div>
        <div class="copy-${i + 1}">
          <a href="archive.html">Topic ${i + 1}</a>
          <h3><a href="list-${i + 1}.html">${title}</a></h3>
          <p>Excerpt for ${title} with enough detail to qualify as a rich content card.</p>
          <span>Jan ${String(i + 1).padStart(2, '0')}, 2024</span>
        </div>
      </li>`
    ).join('')}
  </ul>
</main>`;

const UNIFORM_DIRECT_GRID_PAGE = `
<main>
  <section>
    <div class="lattice-frame">
      ${[1, 2, 3].map(
        (index) => `
        <article class="story-shell story-shell--plain">
          <div class="story-visual"><a href="plain-${index}.html"><img src="plain-${index}.png" alt=""></a></div>
          <div class="story-copy">
            <a href="archive.html">Plain ${index}</a>
            <h3><a href="plain-${index}.html">Uniform card ${index}</a></h3>
            <p>Uniform card ${index} excerpt with enough detail to qualify as rich content.</p>
            <time>Feb ${String(index).padStart(2, '0')}, 2024</time>
          </div>
        </article>`
      ).join('')}
    </div>
  </section>
</main>`;

describe('structuralSignature', () => {
  it('is class-agnostic: tag + sorted direct-child tag names', () => {
    const $ = cheerio.load(`<article class="x"><div></div><span></span></article>`);
    const $$ = cheerio.load(`<article class="totally-different"><span></span><div></div></article>`);
    const a = structuralSignature($, $('article')[0]);
    const b = structuralSignature($$, $$('article')[0]);
    expect(a).toBe(b); // class names ignored; child order normalized
    expect(a).toBe('article>div,span');
  });
});

describe('discoverHtmlCards — candidate clustering', () => {
  it('clusters mixed-depth cards into ONE grid (featured + nested rows)', () => {
    const grids = discoverHtmlCards(MIXED_DEPTH_GRID);
    expect(grids).toHaveLength(1);
    expect(grids[0].records).toHaveLength(4);
    expect(grids[0].containerSelector).toBeTruthy();
  });

  it('selects article cards instead of repeated section wrappers or card bodies', () => {
    const grids = discoverHtmlCards(BASEPLATE_SHAPED_PAGE);
    const records = grids.flatMap((grid) => grid.records);
    const titles = records.map((record) => record.title);
    const $ = cheerio.load(BASEPLATE_SHAPED_PAGE);

    expect(records).toHaveLength(13);
    expect(titles.every((title) => BASEPLATE_TITLES.includes(String(title)))).toBe(true);
    expect(titles.some((title) => BASEPLATE_SECTION_HEADINGS.includes(String(title)))).toBe(false);
    expect(grids.every((grid) => !$(grid.containerSelector).is('main,section'))).toBe(true);
  });

  it('does not treat two inner cards per wrapper as a one-part-per-card relationship', () => {
    const grids = discoverHtmlCards(TWO_PER_WRAPPER_PAGE);
    const titles = grids.flatMap((grid) => grid.records.map((record) => String(record.title)));

    expect(TWO_PER_WRAPPER_TITLES.every((title) => titles.includes(title))).toBe(true);
  });

  it('does not drop nested article cards when one section wrapper contains one real card', () => {
    const grids = discoverHtmlCards(ONE_PER_SECTION_PAGE);
    const titles = grids.flatMap((grid) => grid.records.map((record) => String(record.title)));

    expect(ONE_PER_SECTION_ARTICLE_TITLES.every((title) => titles.includes(title))).toBe(true);
  });

  it('selects real cards from stacked single-card bands (case D)', () => {
    const grids = discoverHtmlCards(STACKED_SINGLE_CARD_BANDS);
    const records = grids.flatMap((grid) => grid.records);
    const titles = records.map((record) => String(record.title));
    const $ = cheerio.load(STACKED_SINGLE_CARD_BANDS);

    expect(records).toHaveLength(3);
    expect(titles).toEqual(expect.arrayContaining(STACKED_SINGLE_CARD_TITLES));
    expect(titles.some((title) => STACKED_SINGLE_CARD_HEADINGS.includes(title))).toBe(false);
    expect(grids.every((grid) => !$(grid.containerSelector).is('html,body,main,section'))).toBe(true);
  });

  it('drops wrapper candidates even when matching article cards also appear in an independent grid', () => {
    const grids = discoverHtmlCards(WRAPPER_WITH_INDEPENDENT_GRID_PAGE);
    const records = grids.flatMap((grid) => grid.records);
    const titles = records.map((record) => String(record.title));

    expect(records).toHaveLength(12);
    expect(WRAPPER_WITH_INDEPENDENT_TITLES.every((title) => titles.includes(title))).toBe(true);
    expect(titles.some((title) => WRAPPER_WITH_INDEPENDENT_HEADINGS.includes(title))).toBe(false);
  });

  it('detects arbitrary list-item cards without article tags or semantic class names', () => {
    const grids = discoverHtmlCards(GENERIC_LIST_PAGE);
    const records = grids.flatMap((grid) => grid.records);
    const titles = records.map((record) => String(record.title));

    expect(records).toHaveLength(4);
    expect(GENERIC_LIST_TITLES.every((title) => titles.includes(title))).toBe(true);
    expect(grids.every((grid) => grid.containerSelector.endsWith('ul:nth-of-type(1)'))).toBe(true);
  });
});

describe('discoverHtmlCards — richness gate', () => {
  it('rejects nav link lists and footer link columns (no heading+image+text)', () => {
    expect(discoverHtmlCards(NAV_AND_FOOTER)).toHaveLength(0);
  });
});

describe('discoverHtmlCards — field roles', () => {
  it('assigns title/excerpt/image/category/date/link + synthesized id', () => {
    const [grid] = discoverHtmlCards(MIXED_DEPTH_GRID);
    const first = grid.records[0];
    expect(first.title).toBe('First headline here');
    expect(first.excerpt).toContain('excerpt of the first story');
    expect(first.image).toBe('a.png');
    expect(first.category).toBe('News');
    expect(first.date).toBe('Dec 22, 2023');
    expect(first.link).toBe('story-1.html');
    expect(typeof first.id).toBe('string');
    expect((first.id as string).length).toBeGreaterThan(0);
  });

  it('groups variant cards even when one lacks the excerpt (optional field)', () => {
    const [grid] = discoverHtmlCards(MIXED_DEPTH_GRID);
    const rowCard = grid.records[1]; // a tile--row, no <p>
    expect(rowCard.title).toBe('Second headline');
    expect(rowCard.excerpt ?? '').toBe(''); // missing field, not dropped/guessed
    expect(rowCard.image).toBe('b.png');
  });
});

describe('discoverHtmlCards — container class capture', () => {
  // The grid container's own class must be surfaced verbatim so the scaffold can
  // carry it onto the query-loop post-template (keeps the source's grid CSS).
  const GRID_WITH_CONTAINER_CLASS = `
<main><section><div class="post-grid post-grid--3">
  <article class="card"><div class="m"><a href="1.html"><img src="1.png" alt=""></a></div>
    <div class="b"><a class="cat" href="x.html">News</a><h3><a href="1.html">Card one title</a></h3><p>Body of card one here.</p></div></article>
  <article class="card"><div class="m"><a href="2.html"><img src="2.png" alt=""></a></div>
    <div class="b"><a class="cat" href="x.html">News</a><h3><a href="2.html">Card two title</a></h3><p>Body of card two here.</p></div></article>
  <article class="card"><div class="m"><a href="3.html"><img src="3.png" alt=""></a></div>
    <div class="b"><a class="cat" href="x.html">News</a><h3><a href="3.html">Card three title</a></h3><p>Body of card three here.</p></div></article>
</div></section></main>`;

  it('surfaces the grid container class verbatim', () => {
    const [grid] = discoverHtmlCards(GRID_WITH_CONTAINER_CLASS);
    expect(grid.containerClass).toBe('post-grid post-grid--3');
  });
});

describe('discoverHtmlCards — featured layout descriptor', () => {
  it('detects one direct lead card plus row cards under one wrapper', () => {
    const [grid] = discoverHtmlCards(MIXED_DEPTH_GRID);

    expect(grid.featured).toBeDefined();
    expect(grid.featured?.leadCount).toBe(1);
    expect(grid.featured?.columnWrapperClass).toBe('column');
    expect(grid.featured?.leadTemplate).toContain('data-dla-text="content"');
    expect(grid.featured?.rowTemplate).not.toContain('data-dla-text="content"');
    expect(grid.featured?.rowTemplate).toContain('class="tile tile--row"');
  });

  it('does not mark a uniform direct-child grid as featured', () => {
    const [grid] = discoverHtmlCards(UNIFORM_DIRECT_GRID_PAGE);

    expect(grid.featured).toBeUndefined();
  });

  it('detects featured sections in the baseplate-shaped fixture', () => {
    const featuredGrids = discoverHtmlCards(BASEPLATE_SHAPED_PAGE).filter((grid) => grid.featured);

    expect(featuredGrids).toHaveLength(2);
    expect(featuredGrids.every((grid) => grid.featured?.leadCount === 1)).toBe(true);
    expect(featuredGrids.every((grid) => grid.featured?.columnWrapperClass === 'column')).toBe(true);
  });

  it('sets a term slug when every featured card has the same category', () => {
    const [grid] = discoverHtmlCards(featuredGridWithCategories(['Reviews', 'Reviews', 'Reviews', 'Reviews']));

    expect(grid.featured?.termSlug).toBe('reviews');
  });

  it('does not set a term slug when featured cards mix categories', () => {
    const [grid] = discoverHtmlCards(featuredGridWithCategories(['Reviews', 'News', 'Reviews', 'Reviews']));

    expect(grid.featured?.termSlug).toBeUndefined();
  });
});

describe('discoverHtmlCards — deterministic template', () => {
  it('annotates the source card with data-dla-* bindings, preserving classes', () => {
    const [grid] = discoverHtmlCards(MIXED_DEPTH_GRID);
    const t = grid.cardTemplate;
    expect(t).toContain('class="tile'); // source classes preserved
    expect(t).toMatch(/data-dla-text="title"/);
    expect(t).toMatch(/data-dla-text="content"/); // excerpt → content
    expect(t).toMatch(/data-dla-text="cat\.label"/); // category label
    expect(t).toMatch(/data-dla-attr="src:meta\.image"/);
    expect(t).not.toContain('First headline here');
  });
});

describe('discoverHtmlCards — body extraction', () => {
  it('uses extractMainContent for a DISTINCT linked page', () => {
    const pages: Record<string, string> = {
      'story-1.html': '<main><article><p>Full body of story one, much longer than the excerpt.</p></article></main>',
      'story-2.html': '<main><article><p>Full body of story two.</p></article></main>',
      'story-3.html': '<main><article><p>Full body of story three.</p></article></main>',
      'story-4.html': '<main><article><p>Full body of story four.</p></article></main>',
    };
    const [grid] = discoverHtmlCards(MIXED_DEPTH_GRID, { resolvePage: (h) => pages[h] ?? null });
    expect(grid.records[0].content).toContain('Full body of story one');
  });

  it('dedups a SHARED target: bodies fall back to excerpt, not N identical bodies', () => {
    const sharedHtml = MIXED_DEPTH_GRID.replace(/story-\d\.html/g, 'single.html');
    const single = '<main><article><p>The single template body, shared by all cards.</p></article></main>';
    const [grid] = discoverHtmlCards(sharedHtml, { resolvePage: () => single });
    const bodies = grid.records.map((r) => r.content);
    expect(bodies.every((b) => b === 'The single template body, shared by all cards.')).toBe(false);
    expect(grid.records[0].content).toBe(grid.records[0].excerpt);
  });
});

describe('discoverHtmlCards — scaffold fidelity', () => {
  it('derives distinct title ids, per-card categories, and full month dates from shared-link cards', () => {
    const { model } = scaffoldDataModel({
      html: '',
      htmlFiles: [{ name: 'index.html', text: BASEPLATE_SHAPED_PAGE }],
      js: '',
    });
    const ids = model.items.map((item) => item.id);
    const titles = model.items.map((item) => item.title);

    expect(model.items).toHaveLength(13);
    expect(new Set(ids).size).toBe(new Set(BASEPLATE_TITLES).size);
    expect(new Set(ids)).not.toEqual(new Set(['single']));
    expect(titles.every((title) => BASEPLATE_TITLES.includes(title))).toBe(true);
    expect(model.taxonomy.terms.map((term) => term.slug).sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(model.items.some((item) => String(item.meta.date ?? '').includes('2024'))).toBe(true);
  });
});

describe('discoverHtmlCards — link bindings (permalink + category url)', () => {
  it('rebinds post-detail anchors to href:permalink and the category anchor to href:cat.url', () => {
    // Each card links to its OWN detail page (story-N) + a category page. The
    // derived template must rebind those static hrefs to dynamic bindings so the
    // live card links to its post and term archive, not the source mockup pages.
    const page = `
      <main><div class="grid">
        <article class="card">
          <div class="thumb"><a href="story-1.html"><img src="a.png" alt=""></a></div>
          <a class="kicker" href="cat-news.html">News</a>
          <h3><a href="story-1.html">First headline here is long enough</a></h3>
          <p>Some excerpt text that is sufficiently long to register.</p>
        </article>
        <article class="card">
          <div class="thumb"><a href="story-2.html"><img src="b.png" alt=""></a></div>
          <a class="kicker" href="cat-guides.html">Guides</a>
          <h3><a href="story-2.html">Second headline here is also long</a></h3>
          <p>Another excerpt that is also sufficiently long to register here.</p>
        </article>
        <article class="card">
          <div class="thumb"><a href="story-3.html"><img src="c.png" alt=""></a></div>
          <a class="kicker" href="cat-news.html">News</a>
          <h3><a href="story-3.html">Third headline here is long too</a></h3>
          <p>Yet another excerpt long enough to be a real excerpt field here.</p>
        </article>
      </div></main>`;
    const grids = discoverHtmlCards(page);
    expect(grids.length).toBeGreaterThan(0);
    const tpl = grids[0].cardTemplate;
    // post-detail anchors (thumb + title) bound to the permalink
    expect(tpl).toContain('href:permalink');
    // category anchor bound to its term archive
    expect(tpl).toContain('href:cat.url');
    // the static mockup hrefs are no longer the only thing driving the links
    expect((tpl.match(/href:permalink/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
