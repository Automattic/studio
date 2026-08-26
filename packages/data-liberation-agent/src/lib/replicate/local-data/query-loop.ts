// src/lib/replicate/local-data/query-loop.ts
//
// Emit the native block markup that replaces an empty JS-mount <div> (e.g.
// `<div class="obj-grid obj-grid--4" id="newestGrid"></div>` that mountGrid()
// used to fill) with a real WordPress query loop:
//
//   core/query (anchor = mount id)         -> <div class="wp-block-query" id="newestGrid">
//     core/post-template (className = grid) -> <ul class="wp-block-post-template obj-grid obj-grid--4">
//       dla/data-card (dynamic)             -> <article class="obj-card" data-cat data-id>...</article>
//
// The mount id lands on the query wrapper (so `#newestGrid .obj-card` selectors
// in the kept filter/animation JS keep matching) and the grid class lands on the
// post-template <ul> (so the carried `.obj-grid` CSS lays the cards out).
//
// post-template wraps each item in an <li>, which would (a) leave the grid class
// one level above the cards and (b) leave empty grid cells when the client-side
// filter hides an .obj-card. Both are fixed by flattening the <li> with
// `display:contents` so the .obj-card itself becomes the grid item — emitted as
// the result `css` and folded into the theme's parity stylesheet.
import type { MountSpec } from './types.js';
import { anchorId as anchorFromSelector } from './string-utils.js';

/** The dynamic block name that renders one CPT post as a source-faithful card. */
export const DATA_CARD_BLOCK = 'dla/data-card';

/** WP query loop perPage cannot express "all"; clamp the model's -1 sentinel. */
const ALL_POSTS_PER_PAGE = 100;

/** Keep the featured column loop's queryId distinct from page-level loop ids. */
const FEATURED_COLUMN_QUERY_ID_OFFSET = 100000;

export interface QueryLoopResult {
  /** Serialized block markup that replaces the empty mount <div>. */
  markup: string;
  /**
   * CSS flattening the post-template <li> wrappers for this mount so the source
   * grid layout + client-side filtering keep binding to `.obj-card`. '' when the
   * mount has no id to anchor the rule.
   */
  css: string;
}

/** Lowercase the model's ASC/DESC into the query block's asc/desc. */
function normalizeOrder(order: 'ASC' | 'DESC' | undefined): 'asc' | 'desc' {
  return order === 'ASC' ? 'asc' : 'desc';
}

interface QueryBlockOpts {
  anchor?: string | null;
  perPage: number;
  offset: number;
  postType: string;
  order: 'ASC' | 'DESC' | undefined;
  orderBy: 'date' | 'title' | 'menu_order' | undefined;
  queryId: number;
  postTemplateClassName?: string;
  variant?: string;
  dlaTermSlug?: string;
  dlaTaxonomy?: string;
}

function blockAttrs(attrs: Record<string, unknown>): string {
  return Object.keys(attrs).length > 0 ? ` ${JSON.stringify(attrs)}` : '';
}

function groupClassAttr(className: string | undefined): string {
  return className ? `wp-block-group ${className}` : 'wp-block-group';
}

function buildSingleQueryLoop(opts: QueryBlockOpts): string {
  const perPage = opts.perPage === -1 ? ALL_POSTS_PER_PAGE : opts.perPage;

  // Mirror WP's query-attribute key order so the markup reads like editor output.
  const query: Record<string, unknown> = {
    perPage,
    pages: 0,
    offset: opts.offset,
    postType: opts.postType,
    order: normalizeOrder(opts.order),
    orderBy: opts.orderBy ?? 'date',
    inherit: false,
  };

  const queryAttrs: Record<string, unknown> = { queryId: opts.queryId, query };
  if (opts.anchor) queryAttrs.anchor = opts.anchor;

  const postTemplateAttrsObj: Record<string, unknown> = {};
  if (opts.postTemplateClassName) postTemplateAttrsObj.className = opts.postTemplateClassName;
  if (opts.dlaTaxonomy && opts.dlaTermSlug) {
    postTemplateAttrsObj.dlaTaxonomy = opts.dlaTaxonomy;
    postTemplateAttrsObj.dlaTermSlug = opts.dlaTermSlug;
  }

  const idAttr = opts.anchor ? ` id="${opts.anchor}"` : '';
  const templateAttrs = blockAttrs(postTemplateAttrsObj);
  const dataCardAttrs = opts.variant ? ` ${JSON.stringify({ variant: opts.variant })}` : '';

  return (
    `<!-- wp:query ${JSON.stringify(queryAttrs)} -->\n` +
    `<div class="wp-block-query"${idAttr}><!-- wp:post-template${templateAttrs} -->\n` +
    `<!-- wp:${DATA_CARD_BLOCK}${dataCardAttrs} /-->\n` +
    `<!-- /wp:post-template --></div>\n` +
    `<!-- /wp:query -->`
  );
}

/**
 * Build the query-loop block markup (+ li-flatten CSS) that replaces one empty
 * JS-mount div. `queryId` disambiguates multiple loops on the same page (the
 * block's queryId attribute); defaults to 0.
 */
export function buildQueryLoop(mount: MountSpec, queryId = 0): QueryLoopResult {
  const anchor = anchorFromSelector(mount.selector);

  if (mount.featured) {
    const outerAttrs: Record<string, unknown> = {};
    if (anchor) outerAttrs.anchor = anchor;
    outerAttrs.tagName = 'div';
    if (mount.wrapperClass) outerAttrs.className = mount.wrapperClass;

    const outerIdAttr = anchor ? ` id="${anchor}"` : '';
    const outerClassAttr = groupClassAttr(mount.wrapperClass);
    const columnAttrs: Record<string, unknown> = {};
    if (mount.featured.columnWrapperClass) {
      columnAttrs.className = mount.featured.columnWrapperClass;
    }
    const columnClassAttr = groupClassAttr(mount.featured.columnWrapperClass);
    const termFilter =
      mount.featured.termSlug && mount.featured.taxonomy
        ? { dlaTermSlug: mount.featured.termSlug, dlaTaxonomy: mount.featured.taxonomy }
        : {};

    const leadLoop = buildSingleQueryLoop({
      perPage: mount.featured.leadPerPage,
      offset: 0,
      postType: mount.query.postType,
      order: mount.query.order,
      orderBy: mount.query.orderBy,
      queryId,
      ...termFilter,
    });

    const columnLoop = buildSingleQueryLoop({
      perPage: mount.featured.columnPerPage,
      offset: mount.featured.leadPerPage,
      postType: mount.query.postType,
      order: mount.query.order,
      orderBy: mount.query.orderBy,
      queryId: queryId + FEATURED_COLUMN_QUERY_ID_OFFSET,
      variant: mount.featured.variant,
      ...termFilter,
    });

    const markup =
      `<!-- wp:group${blockAttrs(outerAttrs)} -->\n` +
      `<div${outerIdAttr} class="${outerClassAttr}">` +
      `${leadLoop}\n` +
      `<!-- wp:group${blockAttrs(columnAttrs)} -->\n` +
      `<div class="${columnClassAttr}">${columnLoop}</div>\n` +
      `<!-- /wp:group -->` +
      `</div>\n` +
      `<!-- /wp:group -->`;

    const css = anchor
      ? `#${anchor} .wp-block-query,\n` +
        `#${anchor} .wp-block-post-template{display:contents}\n` +
        `#${anchor} .wp-block-post-template > li{display:contents}`
      : '';

    return { markup, css };
  }

  const markup = buildSingleQueryLoop({
    anchor,
    perPage: mount.query.perPage,
    offset: 0,
    postType: mount.query.postType,
    order: mount.query.order,
    orderBy: mount.query.orderBy,
    queryId,
    postTemplateClassName: mount.wrapperClass,
  });

  // Flatten the post-template <li> so the .obj-card is the direct grid item:
  // keeps the carried grid CSS and the client-side filter (.obj-card.hidden)
  // working. Scoped to this mount's id so it can't leak to other lists.
  const css = anchor
    ? `#${anchor} .wp-block-post-template > li{display:contents}`
    : '';

  return { markup, css };
}
