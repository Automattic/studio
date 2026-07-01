// src/lib/replicate/local-data/neutralize-mounts.ts
//
// Build-time adapt of the carried JS for the WordPress-driven data path: remove
// ONLY the data-injection calls (e.g. `mountGrid('#newestGrid', newestObjets(4))`)
// now that WP server-renders those grids via query loops. Everything else —
// styling, animation, category filtering, the detail modal, chrome rendering —
// is kept verbatim (the principle: JS for style/interaction, data from WP).
//
// Neutralization is selector-anchored: any call statement whose argument list
// contains one of the mount selector string literals is dropped. The mount
// FUNCTION definition is left intact (harmless if unused; other code may call
// it), only the data-filling invocations go.

import { escapeRegExp as escapeRe } from './string-utils.js';

export interface NeutralizeResult {
  js: string;
  /** How many call statements were removed (one per selector occurrence). */
  removed: number;
}

/**
 * Remove data-mount call statements referencing any of `selectors` (e.g.
 * '#newestGrid'). A call statement is `ident( … '#sel' … );` — matched
 * non-greedily up to the closing `)` and optional `;`, on the assumption mount
 * calls don't nest braces/semicolons in their arguments (true for the
 * `mountGrid('#sel', dataExpr())` shape). Returns the cleaned JS + a count.
 *
 * Only receiver-less calls are neutralized (the `mountGrid(...)` shape). A
 * method-chain member that happens to carry the same selector literal —
 * `document.querySelectorAll('[data-objet-embed]').forEach(...)` in the kept
 * embed/filter code — is LEFT INTACT: replacing just the method call with a
 * comment would orphan its `document.` receiver and `.forEach` suffix, a syntax
 * error that takes the entire carried bundle (chrome rendering and all) down
 * with it. The negative lookbehind `(?<![.\w$])` is what enforces "statement
 * call, not chain member"; such chained queries run harmlessly client-side
 * post-injection.
 */
export function neutralizeDataMounts(js: string, selectors: string[]): NeutralizeResult {
  let out = js;
  let removed = 0;
  for (const sel of selectors) {
    // (not . or ident char) ident ( ...no ; { } ... '#sel' ...no ; { } ... ) optional ;
    const re = new RegExp(
      `(?<![.\\w$])[\\w$]+\\s*\\([^;{}]*['"]${escapeRe(sel)}['"][^;{}]*\\)\\s*;?`,
      'g',
    );
    out = out.replace(re, () => {
      removed += 1;
      return `/* data-mount neutralized (WordPress-driven): ${sel} */`;
    });
  }
  return { js: out, removed };
}
