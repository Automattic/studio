import { describe, it, expect, vi } from 'vitest';
import * as cheerio from 'cheerio';
import { neutralizeStaticCards } from './neutralize-static-cards.js';
import { scaffoldDataModel } from './scaffold-model.js';

const HTML = `<main><div class="obj-grid obj-grid--4" id="newestGrid"></div></main>`;
const JS = `
  const OBJETS = [
    { id: 'opaline-1965', title: 'Opaline Vase', story: 'A sufficiently long provenance description that reads as body content here.', category: 'glass', price: 120 },
    { id: 'boutis-quilt', title: 'Boutis Coverlet', story: 'Another long provenance description well past the content length threshold value.', category: 'textiles', price: 240 },
  ];
  function objCard(o){ return '<article class="obj-card"></article>'; }
  function open(id){ return OBJETS.find(x => x.id === id); }
  mountGrid('#newestGrid', newestObjets(4));
`;

describe('scaffoldDataModel', () => {
  it('fills items, taxonomy, fields, mounts, sourceArrays deterministically', () => {
    const { model, discovered } = scaffoldDataModel({ html: HTML, js: JS });
    expect(model.items.map((i) => i.id)).toEqual(['opaline-1965', 'boutis-quilt']);
    expect(model.items[0].meta).toEqual({ price: 120 });
    expect(model.items[0].content).toContain('provenance');
    expect(model.taxonomy.terms.map((t) => t.slug).sort()).toEqual(['glass', 'textiles']);
    expect(model.fields).toContainEqual({ key: 'price', type: 'integer' });
    expect(model.mounts[0]).toMatchObject({
      selector: '#newestGrid',
      wrapperClass: 'obj-grid obj-grid--4',
      query: { postType: model.cpt.slug, perPage: 4 },
    });
    expect(model.sourceArrays).toContain('OBJETS');
    expect(discovered.arrays.find((a) => a.name === 'OBJETS')?.recordCount).toBe(2);
  });

  it('leaves card.template empty with a todo', () => {
    const { model, skillTodos } = scaffoldDataModel({ html: HTML, js: JS });
    expect(model.card?.template).toBe('');
    expect(skillTodos.some((t) => t.path === 'card.template')).toBe(true);
  });

  it('derives mount order confidence from per-page and source-call signals', () => {
    const html = `
      <main>
        <div class="obj-grid" id="allGrid"></div>
        <div class="obj-grid" id="newestGrid"></div>
        <div class="obj-grid" id="featuredGrid"></div>
      </main>
    `;
    const js = `
      const OBJETS = [
        { id: 'opaline-1965', title: 'Opaline Vase', story: 'A sufficiently long provenance description that reads as body content here.', category: 'glass', price: 120 },
        { id: 'boutis-quilt', title: 'Boutis Coverlet', story: 'Another long provenance description well past the content length threshold value.', category: 'textiles', price: 240 },
      ];
      mountGrid('#allGrid', OBJETS);
      mountGrid('#newestGrid', newestObjets(4));
      mountGrid('#featuredGrid', OBJETS, 3);
    `;

    const { model, skillTodos } = scaffoldDataModel({ html, js });

    expect(model.mounts[0].selector).toBe('#allGrid');
    expect(model.mounts[0].query).toMatchObject({ perPage: -1, order: 'ASC' });
    expect(skillTodos.some((t) => t.path === 'mounts[0].query.order')).toBe(false);

    expect(model.mounts[1].selector).toBe('#newestGrid');
    expect(model.mounts[1].query).toMatchObject({ perPage: 4, order: 'DESC' });
    expect(skillTodos.some((t) => t.path === 'mounts[1].query.order')).toBe(false);

    expect(model.mounts[2].selector).toBe('#featuredGrid');
    expect(model.mounts[2].query).toMatchObject({ perPage: 3, order: 'DESC' });
    expect(skillTodos.some((t) => t.path === 'mounts[2].query.order')).toBe(true);
  });

  it('emits an items[].id todo when id inference is low-confidence', () => {
    const js = `const A = [{ ref: { x: 1 } }, { ref: { x: 2 } }]; mount('#g', A);`;
    const { skillTodos } = scaffoldDataModel({ html: `<div id="g"></div>`, js });
    expect(skillTodos.some((t) => t.path === 'items[].id')).toBe(true);
  });

  it('degrades to an items todo (never invents) when no static array is found', () => {
    const { model, skillTodos } = scaffoldDataModel({ html: '<div id="g"></div>', js: `fetch('/api').then(r=>r.json());` });
    expect(model.items).toEqual([]);
    expect(skillTodos.some((t) => t.path === 'items')).toBe(true);
  });

  it('chooses the content array over config arrays and filters orphan containers out of mounts', () => {
    const html = `
      <main>
        <div class="obj-grid obj-grid--featured" id="featuredGrid"></div>
        <div class="obj-grid obj-grid--archive" id="archiveGrid"></div>
        <div class="obj-grid obj-grid--market" id="marketGrid"></div>
        <div id="emptyFilterSlot"></div>
        <div id="emptyModalSlot"></div>
        <div id="emptyPromoSlot"></div>
        <div id="emptyFooterSlot"></div>
        <div id="notEmpty"><span>static</span></div>
      </main>
    `;
    const js = `
      const OBJET_CATS = [
        { id: 'all', label: 'Everything' },
        { id: 'glass', label: 'Glass' },
        { id: 'textiles', label: 'Textiles' },
        { id: 'lighting', label: 'Lighting' },
        { id: 'ceramics', label: 'Ceramics' },
        { id: 'prints', label: 'Prints' },
        { id: 'metal', label: 'Metal' },
      ];
      const OBJETS = [
        { id: 'opaline-1965', title: 'Opaline Vase', story: 'A sufficiently long provenance description that reads as body content here.', category: 'glass', price: 120 },
        { id: 'boutis-quilt', title: 'Boutis Coverlet', story: 'Another long provenance description well past the content length threshold value.', category: 'textiles', price: 240 },
        { id: 'anglepoise-1934', title: 'Anglepoise Lamp', story: 'Collected from a small atelier with enough narrative body text to become content.', category: 'lighting', price: 410 },
        { id: 'raku-bowl', title: 'Raku Bowl', story: 'Smoke-fired ceramic with a long descriptive note about condition and origin.', category: 'ceramics', price: 95 },
        { id: 'atelier-print', title: 'Atelier Print', story: 'Numbered print with framing notes and enough prose to be imported as content.', category: 'prints', price: 180 },
        { id: 'brass-candlestick', title: 'Brass Candlestick', story: 'Patinated brass object with a durable story field for the scaffold body.', category: 'metal', price: 75 },
        { id: 'murano-dish', title: 'Murano Dish', story: 'Layered glass dish with source copy that should stay attached to the item.', category: 'glass', price: 130 },
        { id: 'linen-panel', title: 'Linen Panel', story: 'Handwoven panel with source copy that should become item content.', category: 'textiles', price: 205 },
      ];
      const NAV = [
        { id: 'home', label: 'Home', href: '/' },
        { id: 'shop', label: 'Shop', href: '/shop' },
      ];
      function objetCard(o){ return '<article class="obj-card"></article>'; }
      function openObjet(id){ return OBJETS.find((objet) => objet.id === id); }
      mountGrid('#featuredGrid', OBJETS, 3);
      mountGrid('#archiveGrid', OBJETS.filter((objet) => objet.category !== 'lighting'));
      mountGrid('#marketGrid', OBJETS.map(objetCard));
    `;

    const result = scaffoldDataModel({ html, js });

    expect(result.model.cpt.slug).toBe('objet');
    expect(result.model.items.map((item) => item.id)).toEqual([
      'opaline-1965',
      'boutis-quilt',
      'anglepoise-1934',
      'raku-bowl',
      'atelier-print',
      'brass-candlestick',
      'murano-dish',
      'linen-panel',
    ]);
    expect(result.model.taxonomy.terms.length).toBeGreaterThanOrEqual(5);
    expect(result.model.mounts.map((mount) => mount.selector).sort()).toEqual(['#archiveGrid', '#featuredGrid', '#marketGrid']);
    expect(result.discovered.unmatchedContainers?.sort()).toEqual(['#emptyFilterSlot', '#emptyFooterSlot', '#emptyModalSlot', '#emptyPromoSlot']);
    expect(result.discovered.arrays.map((array) => array.name)).toEqual(expect.arrayContaining(['OBJET_CATS', 'OBJETS', 'NAV']));
  });
});

const CARD_HTML = `
<main>
  <div class="cluster">
    <article class="tile"><div class="thumb"><img src="a.png"></div>
      <div class="meat"><a class="kicker" href="cat-news.html">News</a>
      <h3><a href="p1.html">Alpha</a></h3><p>Body alpha here, long enough.</p><time>Jan 1, 2024</time></div></article>
    <article class="tile"><div class="thumb"><img src="b.png"></div>
      <div class="meat"><a class="kicker" href="cat-news.html">News</a>
      <h3><a href="p2.html">Beta</a></h3><p>Body beta here, long enough.</p><time>Jan 2, 2024</time></div></article>
    <article class="tile"><div class="thumb"><img src="c.png"></div>
      <div class="meat"><a class="kicker" href="cat-reviews.html">Reviews</a>
      <h3><a href="p3.html">Gamma</a></h3><p>Body gamma here, long enough.</p><time>Jan 3, 2024</time></div></article>
  </div>
</main>`;

const FEATURED_CARD_HTML = `
<main>
  <section>
    <div class="feature-shell">
      <article class="story story--lead">
        <div class="visual"><a href="lead.html"><img src="lead.png" alt=""></a></div>
        <div class="copy">
          <a class="topic" href="archive.html">Letters</a>
          <h3><a href="lead.html">Lead dispatch</a></h3>
          <p>Lead dispatch excerpt with enough detail to qualify as a rich card.</p>
          <time>Mar 01, 2024</time>
        </div>
      </article>
      <div class="story-column">
        ${[1, 2, 3].map(
          (index) => `
          <article class="story story--row">
            <div class="visual"><a href="row-${index}.html"><img src="row-${index}.png" alt=""></a></div>
            <div class="copy">
              <a class="topic" href="archive.html">Notes</a>
              <h3><a href="row-${index}.html">Row dispatch ${index}</a></h3>
              <time>Mar 0${index + 1}, 2024</time>
            </div>
          </article>`
        ).join('')}
      </div>
    </div>
  </section>
</main>`;

function featuredCardHtmlWithCategories(categories: [string, string, string, string]): string {
  return `
<main>
  <section>
    <div class="feature-shell">
      <article class="story story--lead">
        <div class="visual"><a href="lead.html"><img src="lead.png" alt=""></a></div>
        <div class="copy">
          <a class="topic" href="archive.html">${categories[0]}</a>
          <h3><a href="lead.html">Lead dispatch</a></h3>
          <p>Lead dispatch excerpt with enough detail to qualify as a rich card.</p>
          <time>Mar 01, 2024</time>
        </div>
      </article>
      <div class="story-column">
        ${[1, 2, 3].map(
          (index) => `
          <article class="story story--row">
            <div class="visual"><a href="row-${index}.html"><img src="row-${index}.png" alt=""></a></div>
            <div class="copy">
              <a class="topic" href="archive.html">${categories[index]}</a>
              <h3><a href="row-${index}.html">Row dispatch ${index}</a></h3>
              <time>Mar 0${index + 1}, 2024</time>
            </div>
          </article>`
        ).join('')}
      </div>
    </div>
  </section>
</main>`;
}

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

function duplicateSlugCard(title: string, date: string): string {
  return `
    <article>
      <div><a href="${title}.html"><img src="${title}.png" alt=""></a></div>
      <div>
        <a href="archive.html">Updates</a>
        <h3><a href="${title}.html">${title}</a></h3>
        <p>Excerpt for ${title} with enough detail to qualify as static-card content.</p>
        <span>${date}</span>
      </div>
    </article>`;
}

const DUPLICATE_ID_HTML = `
<main>
  <div>
    ${duplicateSlugCard('Alpha!', 'Jan 01, 2024')}
    ${duplicateSlugCard('Alpha?', 'Jan 02, 2024')}
    ${duplicateSlugCard('Beta', 'Jan 03, 2024')}
  </div>
</main>`;

const SAME_TITLE_DUPLICATE_ID_HTML = `
<main>
  <div>
    ${duplicateSlugCard('Alpha!', 'Jan 01, 2024')}
    ${duplicateSlugCard('Alpha!', 'Jan 02, 2024')}
    ${duplicateSlugCard('Beta', 'Jan 03, 2024')}
  </div>
</main>`;

describe('scaffoldDataModel — records-source chain', () => {
  it('reports source=js-array and ignores HTML cards when a JS array exists', () => {
    const js = `const ITEMS=[{id:'a',title:'A',cat:'x'},{id:'b',title:'B',cat:'y'}]; mountGrid('#grid', ITEMS);`;
    const r = scaffoldDataModel({ html: `<div id="grid"></div>${CARD_HTML}`, js });
    expect(r.discovered.source).toBe('js-array');
    expect(r.model.items).toHaveLength(2); // the JS records, not the 3 cards
  });

  it('falls back to HTML cards (core post + native category) when no JS array exists', () => {
    const r = scaffoldDataModel({ html: CARD_HTML, js: '' });
    expect(r.discovered.source).toBe('html-cards');
    expect(r.model.items).toHaveLength(3);
    expect(r.model.items.map((i) => i.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    // core post + native category (DECISION 3)
    expect(r.model.cpt.slug).toBe('post');
    expect(r.model.taxonomy.slug).toBe('category');
    expect(r.model.taxonomy.terms.map((t) => t.slug).sort()).toEqual(['news', 'reviews']);
    // mounts carry the original container selector + a synthetic #id (DECISION 1)
    expect(r.model.mounts[0].selector).toMatch(/^#dla-cards-/);
    expect(r.model.mounts[0].sourceSelector).toBeTruthy();
    // perPage = the count of cards baked into the source grid (3 here), in
    // document order (ASC) — NOT -1 (all) and NOT reordered to date/DESC. A
    // curated source grid stays its own size instead of rendering the full pool.
    expect(r.model.mounts[0].query).toMatchObject({ perPage: 3, order: 'ASC' });
    expect(r.skillTodos.some((t) => t.path.startsWith('mounts[') && t.path.endsWith('.query.order'))).toBe(false);
    // mounts carry the source grid container's class so the query loop's
    // post-template keeps the source grid layout CSS (else cards stack vertically)
    expect(r.model.mounts[0].wrapperClass).toBe('cluster');
    // deterministic template means NO card.template todo
    expect(r.skillTodos.some((t) => t.path === 'card.template')).toBe(false);
    expect(r.model.card?.template).toContain('data-dla-text');
    expect(r.model.card).not.toHaveProperty('variants');
    expect(r.model.mounts[0]).not.toHaveProperty('featured');
  });

  it('wires featured HTML-card grids into row card variants and mount metadata', () => {
    const r = scaffoldDataModel({ html: FEATURED_CARD_HTML, js: '' });

    expect(r.discovered.source).toBe('html-cards');
    expect(r.model.items.map((item) => item.title)).toEqual([
      'Lead dispatch',
      'Row dispatch 1',
      'Row dispatch 2',
      'Row dispatch 3',
    ]);
    expect(r.model.card?.template).toContain('story--lead');
    expect(r.model.card?.variants?.row).toContain('story--row');
    expect(r.model.card?.variants?.row).not.toContain('data-dla-text="content"');
    expect(r.model.mounts[0].featured).toEqual({
      columnWrapperClass: 'story-column',
      leadPerPage: 1,
      columnPerPage: 3,
      variant: 'row',
    });
  });

  it('threads homogeneous featured category term metadata onto the mount', () => {
    const r = scaffoldDataModel({
      html: featuredCardHtmlWithCategories(['Reviews', 'Reviews', 'Reviews', 'Reviews']),
      js: '',
    });

    expect(r.model.mounts[0].featured).toMatchObject({
      termSlug: 'reviews',
      taxonomy: 'category',
    });
  });

  it('does not thread term metadata onto mixed featured mounts', () => {
    const r = scaffoldDataModel({
      html: featuredCardHtmlWithCategories(['Reviews', 'News', 'Reviews', 'Reviews']),
      js: '',
    });

    expect(r.model.mounts[0].featured).not.toHaveProperty('termSlug');
    expect(r.model.mounts[0].featured).not.toHaveProperty('taxonomy');
  });

  it('does not add variants or featured metadata for uniform-only HTML-card grids', () => {
    const r = scaffoldDataModel({ html: CARD_HTML, js: '' });

    expect(r.model.card).not.toHaveProperty('variants');
    expect(r.model.mounts.every((mount) => !('featured' in mount))).toBe(true);
  });

  it('uses resolved card page bodies as post content without registering content meta', () => {
    const r = scaffoldDataModel({
      html: CARD_HTML,
      js: '',
      resolvePage: (href) => `<main><article><p>FULL BODY ${href}</p></article></main>`,
    });

    expect(r.discovered.source).toBe('html-cards');
    expect(r.model.items[0].content).toContain('FULL BODY p1.html');
    expect(r.model.items[0].content).not.toContain('Body alpha here, long enough.');
    expect(r.model.items[1].content).toContain('FULL BODY p2.html');
    expect(r.model.fields.map((field) => field.key)).not.toContain('content');
    expect(r.model.fields.map((field) => field.key)).toContain('excerpt');
    expect(r.model.items[0].meta.excerpt).toContain('Body alpha here, long enough.');
  });

  it('reports source=none when neither yields records', () => {
    const r = scaffoldDataModel({ html: '<main><p>just prose</p></main>', js: '' });
    expect(r.discovered.source).toBe('none');
    expect(r.model.items).toHaveLength(0);
  });

  it('preserves stacked single-card band content when neutralizing discovered mounts', () => {
    const result = scaffoldDataModel({
      html: '',
      htmlFiles: [{ name: 'index.html', text: STACKED_SINGLE_CARD_BANDS }],
      js: '',
    });
    const titles = result.model.items.map((item) => item.title);

    expect(result.discovered.source).toBe('html-cards');
    expect(result.model.items).toHaveLength(3);
    expect(titles).toEqual(expect.arrayContaining(STACKED_SINGLE_CARD_TITLES));
    expect(titles.some((title) => STACKED_SINGLE_CARD_HEADINGS.includes(title))).toBe(false);

    const neutralized = neutralizeStaticCards(STACKED_SINGLE_CARD_BANDS, result.model.mounts);
    const $ = cheerio.load(neutralized.html);
    const text = $('body').text();

    for (const title of STACKED_SINGLE_CARD_TITLES) expect(text).toContain(title);
  });

  it('warns only when dropping duplicate html-card ids with different titles', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      scaffoldDataModel({ html: DUPLICATE_ID_HTML, js: '' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('[local-data] dropping duplicate card id "alpha"');
      expect(warn.mock.calls[0]?.[0]).toContain('title "Alpha?"');

      warn.mockClear();
      scaffoldDataModel({ html: SAME_TITLE_DUPLICATE_ID_HTML, js: '' });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
