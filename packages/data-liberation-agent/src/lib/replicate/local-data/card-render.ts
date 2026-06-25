// src/lib/replicate/local-data/card-render.ts
//
// TS reference implementation of the data-card binding semantics. It renders a
// DataItem into the source-faithful card markup by applying the DataCard
// template's `data-dla-*` directives. This is the SAME contract the generated
// PHP renderer (card-render-php.ts) implements for the dla/data-card dynamic
// block; a php-execution parity test keeps the two from drifting.
//
// Keeping a TS mirror lets the binding rules be unit-tested fast + hermetically
// (no php, no WP) and documents the grammar in one place.
import { load } from 'cheerio';
import type { DataCard, DataItem, DataTaxonomy } from './types.js';

export interface CardRenderContext {
  item: DataItem;
  card: DataCard;
  taxonomy: DataTaxonomy;
}

/** label for a term slug (first match), or the slug itself if unknown. */
function termLabel(tax: DataTaxonomy, slug: string): string {
  return tax.terms.find((t) => t.slug === slug)?.label ?? slug;
}

/**
 * Resolve a binding <expr> against an item. Returns '' for anything missing so
 * the markup degrades to empty text rather than `undefined`.
 */
export function resolveExpr(
  expr: string,
  ctx: CardRenderContext,
): string {
  const e = expr.trim();
  const { item, card, taxonomy } = ctx;

  // 'literal'
  const lit = /^'([^']*)'$/.exec(e);
  if (lit) return lit[1];

  if (e === 'id') return item.id;
  if (e === 'title') return item.title;
  if (e === 'content') return item.content ?? '';
  if (e === 'cat.slug') return item.terms[0] ?? '';
  if (e === 'cat.label') return item.terms[0] ? termLabel(taxonomy, item.terms[0]) : '';
  // permalink/cat.url are populated per-post at render (PHP: get_permalink /
  // get_term_link); the TS mirror reads them off the item for preview/parity.
  if (e === 'permalink') return item.permalink ?? '';
  if (e === 'cat.url') return item.catUrl ?? '';

  const meta = /^meta\.(.+)$/.exec(e);
  if (meta) {
    const v = item.meta[meta[1]];
    return v === undefined || v === null ? '' : String(v);
  }

  const gal = /^gallery\.(\d+)\.caption$/.exec(e);
  if (gal) return item.gallery[Number(gal[1])]?.caption ?? '';

  // map.<name>.<sub-expr> — recurse on the remainder as the lookup key
  const map = /^map\.([^.]+)\.(.+)$/.exec(e);
  if (map) {
    const table = card.maps[map[1]] ?? {};
    const key = resolveExpr(map[2], ctx);
    return table[key] ?? '';
  }

  return '';
}

/** Evaluate a data-dla-if <cond>: `<expr>`, `<expr>=='lit'`, `<expr>!='lit'`. */
export function evalCond(cond: string, ctx: CardRenderContext): boolean {
  const neq = /^(.+?)!=('[^']*')$/.exec(cond);
  if (neq) return resolveExpr(neq[1], ctx) !== resolveExpr(neq[2], ctx);
  const eq = /^(.+?)==('[^']*')$/.exec(cond);
  if (eq) return resolveExpr(eq[1], ctx) === resolveExpr(eq[2], ctx);
  return resolveExpr(cond, ctx) !== '';
}

/**
 * Render a single item into card HTML by applying the template's bindings.
 * Conditionals are resolved first (outermost wins; a dropped element takes its
 * subtree), then text / attribute / class bindings.
 */
export function renderCard(ctx: CardRenderContext, variant?: string): string {
  const template = (variant && ctx.card.variants?.[variant]) || ctx.card.template;
  const $ = load(template, null, false);

  // data-dla-if: resolve one at a time so removing a parent invalidates its
  // (now-detached) descendants instead of us binding into dead nodes.
  for (;;) {
    const el = $('[data-dla-if]').first();
    if (el.length === 0) break;
    const keep = evalCond(el.attr('data-dla-if') ?? '', ctx);
    if (!keep) {
      el.remove();
    } else {
      el.removeAttr('data-dla-if');
    }
  }

  $('[data-dla-attr]').each((_, node) => {
    const el = $(node);
    const spec = el.attr('data-dla-attr') ?? '';
    el.removeAttr('data-dla-attr');
    for (const pair of spec.split(',')) {
      const idx = pair.indexOf(':');
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      const value = resolveExpr(pair.slice(idx + 1), ctx);
      if (name) el.attr(name, value);
    }
  });

  $('[data-dla-class]').each((_, node) => {
    const el = $(node);
    const cls = resolveExpr(el.attr('data-dla-class') ?? '', ctx);
    el.removeAttr('data-dla-class');
    if (cls) el.addClass(cls);
  });

  $('[data-dla-text]').each((_, node) => {
    const el = $(node);
    const text = resolveExpr(el.attr('data-dla-text') ?? '', ctx);
    el.removeAttr('data-dla-text');
    el.text(text);
  });

  return $.html().trim();
}
