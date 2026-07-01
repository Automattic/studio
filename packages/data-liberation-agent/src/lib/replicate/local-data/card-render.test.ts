// src/lib/replicate/local-data/card-render.test.ts
import { describe, it, expect } from 'vitest';
import { load } from 'cheerio';
import { renderCard, resolveExpr, evalCond, type CardRenderContext } from './card-render.js';
import type { DataCard, DataItem, DataTaxonomy } from './types.js';

// Fictional widget catalog — never real source-site content.
const TAX: DataTaxonomy = {
  slug: 'widget_cat',
  label: 'Kinds',
  hierarchical: true,
  terms: [
    { slug: 'round', label: 'Round Things' },
    { slug: 'flat', label: 'Flat Things' },
  ],
};

const CARD: DataCard = {
  maps: { TONE: { round: 'tone-a', flat: 'tone-b' } },
  template: `
  <article class="card" data-dla-attr="data-cat:cat.slug,data-id:id">
    <div class="card__media">
      <div class="ph" data-dla-class="map.TONE.cat.slug"><span class="tag" data-dla-text="gallery.0.caption"></span></div>
      <span class="badge" data-dla-if="meta.status=='reserved'">Reserved</span>
      <span class="badge" data-dla-if="meta.status=='sold'">Sold</span>
    </div>
    <div class="card__cat" data-dla-text="cat.label"></div>
    <h3 class="card__title" data-dla-text="title"></h3>
    <div class="card__row">
      <span class="price" data-dla-if="meta.status!='sold'">$<span data-dla-text="meta.price"></span></span>
      <span class="price" data-dla-if="meta.status=='sold'"><span class="sold">$<span data-dla-text="meta.price"></span></span></span>
      <button class="more" data-dla-attr="data-more:id">More</button>
    </div>
  </article>`,
};

const CARD_WITH_ROW_VARIANT: DataCard = {
  ...CARD,
  variants: {
    row: `
    <article class="card-row" data-dla-attr="data-id:id">
      <h4 class="card-row__title" data-dla-text="title"></h4>
      <span class="card-row__price" data-dla-text="meta.price"></span>
    </article>`,
  },
};

const ITEM: DataItem = {
  id: 'gizmo-7',
  title: 'The Gizmo',
  terms: ['round'],
  meta: { price: 42, status: 'available' },
  gallery: [{ caption: 'front view' }, { caption: 'side view' }],
};

const ctx = (over: Partial<DataItem> = {}): CardRenderContext => ({
  card: CARD,
  taxonomy: TAX,
  item: { ...ITEM, ...over },
});

describe('resolveExpr', () => {
  it('resolves literals, id/title, meta, cat.slug/label, gallery, maps', () => {
    const c = ctx();
    expect(resolveExpr("'hi'", c)).toBe('hi');
    expect(resolveExpr('id', c)).toBe('gizmo-7');
    expect(resolveExpr('title', c)).toBe('The Gizmo');
    expect(resolveExpr('meta.price', c)).toBe('42');
    expect(resolveExpr('cat.slug', c)).toBe('round');
    expect(resolveExpr('cat.label', c)).toBe('Round Things');
    expect(resolveExpr('gallery.0.caption', c)).toBe('front view');
    expect(resolveExpr('gallery.1.caption', c)).toBe('side view');
    expect(resolveExpr('map.TONE.cat.slug', c)).toBe('tone-a');
  });

  it('missing values resolve to empty string, not undefined', () => {
    const c = ctx({ meta: {}, gallery: [], terms: [] });
    expect(resolveExpr('meta.nope', c)).toBe('');
    expect(resolveExpr('gallery.0.caption', c)).toBe('');
    expect(resolveExpr('cat.label', c)).toBe('');
    expect(resolveExpr('map.TONE.cat.slug', c)).toBe('');
  });

  it('permalink / cat.url resolve off the render item (empty when absent)', () => {
    const c = ctx({ permalink: 'https://x.test/?p=7', catUrl: 'https://x.test/cat/round/' });
    expect(resolveExpr('permalink', c)).toBe('https://x.test/?p=7');
    expect(resolveExpr('cat.url', c)).toBe('https://x.test/cat/round/');
    expect(resolveExpr('permalink', ctx())).toBe(''); // not set → empty, not undefined
    expect(resolveExpr('cat.url', ctx())).toBe('');
  });
});

describe('evalCond', () => {
  it('handles ==, !=, and bare truthiness', () => {
    expect(evalCond("meta.status=='available'", ctx())).toBe(true);
    expect(evalCond("meta.status=='sold'", ctx())).toBe(false);
    expect(evalCond("meta.status!='sold'", ctx())).toBe(true);
    expect(evalCond('title', ctx())).toBe(true);
    expect(evalCond('content', ctx())).toBe(false); // no content
  });
});

describe('renderCard', () => {
  it('binds attrs, classes, text and drops false conditionals', () => {
    const html = renderCard(ctx());
    const $ = load(html, null, false);
    const card = $('.card');
    expect(card.attr('data-cat')).toBe('round');
    expect(card.attr('data-id')).toBe('gizmo-7');
    expect($('.ph').hasClass('tone-a')).toBe(true);
    expect($('.tag').text()).toBe('front view');
    expect($('.card__cat').text()).toBe('Round Things');
    expect($('.card__title').text()).toBe('The Gizmo');
    expect($('.more').attr('data-more')).toBe('gizmo-7');
    // available → no badge, normal (non-sold) price
    expect($('.badge').length).toBe(0);
    expect($('.price').length).toBe(1);
    expect($('.price .sold').length).toBe(0);
    expect($('.price').text().replace(/\s+/g, '')).toBe('$42');
    // directives stripped from output
    expect(html).not.toContain('data-dla-');
  });

  it('sold → sold badge + struck price variant', () => {
    const $ = load(renderCard(ctx({ meta: { price: 99, status: 'sold' } })), null, false);
    expect($('.badge').text()).toBe('Sold');
    expect($('.price .sold').length).toBe(1);
  });

  it('reserved → reserved badge, normal price kept', () => {
    const $ = load(renderCard(ctx({ meta: { price: 5, status: 'reserved' } })), null, false);
    expect($('.badge').text()).toBe('Reserved');
    expect($('.price .sold').length).toBe(0);
  });

  it('escapes interpolated values (no markup injection)', () => {
    const html = renderCard(ctx({ title: '<script>x</script>' }));
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a named variant and falls back to the base template when absent or unknown', () => {
    const variantCtx = { ...ctx(), card: CARD_WITH_ROW_VARIANT };

    const row = load(renderCard(variantCtx, 'row'), null, false);
    expect(row('.card-row').length).toBe(1);
    expect(row('.card-row').attr('data-id')).toBe('gizmo-7');
    expect(row('.card-row__title').text()).toBe('The Gizmo');
    expect(row('.card-row__price').text()).toBe('42');

    const base = load(renderCard(variantCtx), null, false);
    expect(base('.card').length).toBe(1);
    expect(base('.card-row').length).toBe(0);

    const unknown = load(renderCard(variantCtx, 'missing'), null, false);
    expect(unknown('.card').length).toBe(1);
    expect(unknown('.card-row').length).toBe(0);
  });
});
