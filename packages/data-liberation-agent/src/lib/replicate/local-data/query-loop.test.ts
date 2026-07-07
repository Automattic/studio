// src/lib/replicate/local-data/query-loop.test.ts
import { describe, it, expect } from 'vitest';
import { parse } from '@wordpress/block-serialization-default-parser';
import { blockMarkupRoundtrips } from '../../streaming/block-markup-validate.js';
import { buildQueryLoop, DATA_CARD_BLOCK } from './query-loop.js';
import type { MountSpec } from './types.js';

const NEWEST: MountSpec = {
  selector: '#newestGrid',
  sourceCall: "mountGrid('#newestGrid', newestObjets(4))",
  query: { postType: 'objet', perPage: 4, orderBy: 'date', order: 'DESC' },
  wrapperClass: 'obj-grid obj-grid--4',
};

const SHOP: MountSpec = {
  selector: '#shopGrid',
  sourceCall: "mountGrid('#shopGrid', OBJETS)",
  query: { postType: 'objet', perPage: -1, orderBy: 'date', order: 'ASC' },
  wrapperClass: 'obj-grid obj-grid--4',
};

const FEATURED: MountSpec = {
  selector: '#m0',
  sourceCall: "mountGrid('#m0', ITEMS)",
  query: { postType: 'objet', perPage: 4, orderBy: 'date', order: 'DESC' },
  wrapperClass: 'feat-grid',
  featured: {
    columnWrapperClass: 'col-wrap',
    leadPerPage: 1,
    columnPerPage: 3,
    variant: 'row',
  },
};

const FEATURED_WITH_TERM: MountSpec = {
  ...FEATURED,
  featured: {
    ...FEATURED.featured!,
    termSlug: 'reviews',
    taxonomy: 'category',
  },
};

const EXPECTED_NEWEST_MARKUP =
  `<!-- wp:query {"queryId":0,"query":{"perPage":4,"pages":0,"offset":0,"postType":"objet","order":"desc","orderBy":"date","inherit":false},"anchor":"newestGrid"} -->\n` +
  `<div class="wp-block-query" id="newestGrid"><!-- wp:post-template {"className":"obj-grid obj-grid--4"} -->\n` +
  `<!-- wp:${DATA_CARD_BLOCK} /-->\n` +
  `<!-- /wp:post-template --></div>\n` +
  `<!-- /wp:query -->`;

describe('buildQueryLoop', () => {
  it('emits a core/query > core/post-template > dla/data-card tree', () => {
    const { markup } = buildQueryLoop(NEWEST);
    const blocks = parse(markup).filter((b) => b.blockName);
    expect(blocks).toHaveLength(1);
    const query = blocks[0];
    expect(query.blockName).toBe('core/query');
    const tmpl = query.innerBlocks[0];
    expect(tmpl.blockName).toBe('core/post-template');
    expect(tmpl.innerBlocks[0].blockName).toBe(DATA_CARD_BLOCK);
  });

  it('anchors the mount id on the query wrapper (kept JS selectors keep binding)', () => {
    const { markup } = buildQueryLoop(NEWEST);
    expect(markup).toContain('"anchor":"newestGrid"');
    expect(markup).toContain('<div class="wp-block-query" id="newestGrid">');
  });

  it('puts the grid wrapper class on the post-template <ul>', () => {
    const { markup } = buildQueryLoop(NEWEST);
    const tmpl = parse(markup)[0].innerBlocks[0];
    expect(tmpl.attrs!.className).toBe('obj-grid obj-grid--4');
  });

  it('translates the query (postType, perPage, order) onto core/query', () => {
    const q = parse(buildQueryLoop(NEWEST).markup)[0].attrs!.query as Record<string, unknown>;
    expect(q.postType).toBe('objet');
    expect(q.perPage).toBe(4);
    expect(q.order).toBe('desc');
    expect(q.orderBy).toBe('date');
    expect(q.inherit).toBe(false);
  });

  it('clamps the -1 "all" sentinel to a finite perPage', () => {
    const q = parse(buildQueryLoop(SHOP).markup)[0].attrs!.query as Record<string, unknown>;
    expect(q.perPage).toBe(100);
    expect(q.order).toBe('asc');
  });

  it('emits a li-flatten rule scoped to the mount id', () => {
    expect(buildQueryLoop(NEWEST).css).toBe(
      '#newestGrid .wp-block-post-template > li{display:contents}',
    );
  });

  it('disambiguates multiple loops via queryId', () => {
    expect(buildQueryLoop(NEWEST, 0).markup).toContain('"queryId":0');
    expect(buildQueryLoop(SHOP, 1).markup).toContain('"queryId":1');
  });

  it('non-id selectors get no anchor and no li-flatten css', () => {
    const r = buildQueryLoop({ ...NEWEST, selector: '.obj-grid' });
    expect(r.markup).not.toContain('"anchor"');
    expect(r.markup).toContain('<div class="wp-block-query">');
    expect(r.css).toBe('');
  });

  it('keeps non-featured output byte-identical', () => {
    expect(buildQueryLoop(NEWEST)).toEqual({
      markup: EXPECTED_NEWEST_MARKUP,
      css: '#newestGrid .wp-block-post-template > li{display:contents}',
    });
  });

  it('emits a featured two-loop composite inside the mount group', () => {
    const { markup, css } = buildQueryLoop(FEATURED);

    expect(markup).toContain('<div id="m0" class="wp-block-group feat-grid">');
    expect(markup).toContain('<div class="wp-block-group col-wrap">');

    const queryIds = [...markup.matchAll(/"queryId":(\d+)/g)].map((m) => Number(m[1]));
    expect(queryIds).toHaveLength(2);
    expect(new Set(queryIds).size).toBe(2);

    expect(markup).toContain('"perPage":1,"pages":0,"offset":0');
    expect(markup).toContain('"perPage":3,"pages":0,"offset":1');
    expect(markup).toContain(`<!-- wp:${DATA_CARD_BLOCK} /-->`);
    expect(markup).toContain(`<!-- wp:${DATA_CARD_BLOCK} {"variant":"row"} /-->`);

    expect(css).toBe(
      '#m0 .wp-block-query,\n' +
      '#m0 .wp-block-post-template{display:contents}\n' +
      '#m0 .wp-block-post-template > li{display:contents}',
    );
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('adds term filter attrs to both featured post-template blocks when the section is homogeneous', () => {
    const { markup } = buildQueryLoop(FEATURED_WITH_TERM);

    const queryOpenings = [...markup.matchAll(/<!-- wp:query \{[^\n]+ -->/g)].map((m) => m[0]);
    const templateOpenings = [...markup.matchAll(/<!-- wp:post-template(?: \{[^\n]+)? -->/g)].map(
      (m) => m[0],
    );

    expect(queryOpenings).toHaveLength(2);
    expect(templateOpenings).toHaveLength(2);
    for (const opening of queryOpenings) {
      expect(opening).not.toContain('dlaTermSlug');
      expect(opening).not.toContain('dlaTaxonomy');
    }
    for (const opening of templateOpenings) {
      expect(opening).toContain('"dlaTermSlug":"reviews"');
      expect(opening).toContain('"dlaTaxonomy":"category"');
    }
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('omits term filter attrs from featured query blocks without a term slug', () => {
    const { markup } = buildQueryLoop(FEATURED);

    expect(markup).not.toContain('dlaTermSlug');
    expect(markup).not.toContain('dlaTaxonomy');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('omits extra featured group classes when source classes are empty', () => {
    const { markup } = buildQueryLoop({
      ...FEATURED,
      wrapperClass: '',
      featured: { ...FEATURED.featured!, columnWrapperClass: '' },
    });

    expect(markup).toContain('<div id="m0" class="wp-block-group">');
    expect(markup).toContain('<div class="wp-block-group">');
    expect(markup).not.toContain('class="wp-block-group "');
  });
});
