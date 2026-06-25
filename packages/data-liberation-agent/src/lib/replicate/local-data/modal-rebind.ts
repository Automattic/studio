// src/lib/replicate/local-data/modal-rebind.ts
//
// Rebind client lookups that used a source data array (e.g. `OBJETS`) onto the
// WordPress-driven per-card data islands emitted by dla/data-card. The detail
// modal in the source does `OBJETS.find(x => x.id === id)`; once the grids are
// server-rendered from the CPT, that array is no longer the source of truth.
//
// Two deterministic pieces live here:
//  - DLA_ITEM_HELPER_JS: a tiny generic reader, `window.dlaItem(id)`, that parses
//    the `<script class="dla-item" data-id=...>` island into the same object the
//    island carries (id, title, content, terms, termLabels, meta, gallery).
//  - rebindArrayLookups(): rewrites `<Array>.find(x => x.id === <expr>)` into
//    `window.dlaItem(<expr>)` for the named arrays, so the lookup reads WP data.
//
// The source-shape PROJECTION (mapping the island's WP fields onto whatever
// property names the source modal template expects, e.g. catLabel/images/price)
// is source-specific and authored by the model-local-data skill; this module
// owns only the generic, deterministic plumbing.

/** Generic island reader injected into the carried theme JS (frontend).
 * Returns the parsed island with its `meta` fields ALSO flattened to the top
 * level, so a source modal that read `o.price` / `o.story` off the original data
 * object keeps working when the model's meta keys mirror those source names. */
export const DLA_ITEM_HELPER_JS = `/* dla: read a WordPress-driven card record from its DOM data island */
window.dlaItem = function (id) {
  var sel = '.dla-item[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]';
  var el = document.querySelector(sel);
  if (!el) { return null; }
  try {
    var d = JSON.parse(el.textContent);
    if (d && d.meta && typeof d.meta === 'object') {
      for (var k in d.meta) { if (!(k in d)) { d[k] = d.meta[k]; } }
    }
    return d;
  } catch (e) { return null; }
};`;

export interface RebindResult {
  js: string;
  /** How many lookup sites were rewritten. */
  rewritten: number;
}

import { escapeRegExp as escapeRe } from './string-utils.js';

/**
 * Rewrite `<arrayName>.find( <p> => <p>.id === <expr> )` into
 * `window.dlaItem(<expr>)` for each array in `arrayNames`. Tolerant of `==` vs
 * `===`, reversed operands (`id === <expr>` or `<expr> === ... .id`) is NOT
 * handled (the canonical source form is `x.id === id`), and of whitespace. Other
 * uses of the array are left intact (the array definition can stay; only the
 * id-lookup is redirected to the WP island).
 */
export function rebindArrayLookups(js: string, arrayNames: string[]): RebindResult {
  let out = js;
  let rewritten = 0;
  for (const name of arrayNames) {
    // ARR.find( PARAM => PARAM.id === EXPR ) — EXPR may contain one level of
    // balanced parens (e.g. node.getAttribute('data-id')).
    const re = new RegExp(
      `${escapeRe(name)}\\.find\\(\\s*([\\w$]+)\\s*=>\\s*\\1\\.id\\s*===?\\s*((?:[^()]|\\([^()]*\\))+?)\\s*\\)`,
      'g',
    );
    out = out.replace(re, (_m, _param, expr) => {
      rewritten += 1;
      return `window.dlaItem(${expr.trim()})`;
    });
  }
  return { js: out, rewritten };
}
