// src/lib/replicate/normalize/instance-styles.ts
//
// Per-instance inline styles, carried into a block theme WITHOUT inline style=
// attributes. The carry emitter used to ride the source's inline `style=` on
// the element verbatim — but @wordpress/blocks canonicalization (the block
// fixer) STRIPS inline style from core blocks (core/heading allows only
// [class]), so an editor save / fixer pass silently drops the source's
// per-instance sizing and the page reflows.
//
// Instead, each unique inline style is hashed into a deterministic, content-
// addressed class (`lib-i<hash>`) added to the block's `className` — the
// editor's "Additional CSS class(es)" Advanced field, a VALID attribute that
// survives the fixer untouched — and the declarations are emitted as a
// stylesheet rule (`.lib-i<hash>{…}`) into a carried CSS asset loaded on BOTH
// the frontend (wp_enqueue_scripts) and the editor canvas (add_editor_style).
//
// className+rule beats mapping to core attrs (style.typography.*): core attrs
// only cover the WP-supported subset, but owned sources author arbitrary CSS
// core attributes cannot express (aspect-ratio, display:grid, max-width:46ch).
// A generated class+rule carries ALL of it.
import { createHash } from 'node:crypto';

/**
 * Canonicalize a CSS declaration string for content-addressed dedup: split on
 * ';', trim each declaration, collapse internal whitespace, normalize the
 * `prop: value` spacing, drop empties, rejoin with ';'. So 'a: 1px ;  b:2px'
 * and 'a:1px;b:2px' produce the SAME key (and therefore the same class + rule).
 */
export function normalizeDeclarations(style: string): string {
  return style
    .split(';')
    .map((decl) => decl.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((decl) => {
      const i = decl.indexOf(':');
      if (i < 0) return decl;
      return `${decl.slice(0, i).trim()}:${decl.slice(i + 1).trim()}`;
    })
    .join(';');
}

/**
 * Collects per-instance inline styles, mapping each unique declaration set to a
 * deterministic content-addressed class so identical styles dedupe to a single
 * rule. The class is fixer-safe block markup; the emitted rule is the carried
 * design authority for that instance.
 */
export class InstanceStyleSheet {
  private readonly rules = new Map<string, string>(); // class -> normalized declarations

  /**
   * Register an inline style; return its deterministic `lib-i<hash>` class, or
   * `null` when the style is empty after normalization (nothing to carry, so
   * no class is added and no rule emitted).
   */
  classFor(style: string | undefined | null): string | null {
    const decls = normalizeDeclarations(style ?? '');
    if (!decls) return null;
    // sha1 over the canonical declarations: content-addressed (equal decls →
    // equal class → one rule) and collision-safe at 10 hex chars for the
    // handful of distinct inline styles a site carries.
    const cls = `lib-i${createHash('sha1').update(decls).digest('hex').slice(0, 10)}`;
    this.rules.set(cls, decls);
    return cls;
  }

  /** Number of distinct rules registered. */
  get size(): number {
    return this.rules.size;
  }

  /**
   * Emit the stylesheet: one rule per unique declaration set, sorted by class
   * for byte-stable output (so re-runs produce an identical instance-styles.css
   * and don't churn the theme / bust caches needlessly).
   *
   * No `!important`: the carried sheet is enqueued AFTER the source stylesheet
   * (theme-files cascade order), so a `lib-i` rule already outranks a competing
   * source single-class rule (e.g. an inline `background:…` override of
   * `.sticker{background:…}`) on load order. `!important` is reserved for cases
   * where that genuinely doesn't suffice (a higher-specificity source selector).
   */
  toCss(): string {
    return [...this.rules.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([cls, decls]) => `.${cls}{${decls}}`)
      .join('\n');
  }
}

/**
 * Union several instance-style CSS chunks into one byte-stable sheet: each rule
 * is one `.lib-i<hash>{…}` line, content-addressed, so dedup by line then sort
 * is safe (identical classes carry identical declarations by construction). Used
 * to merge the page-body rules (emitted by ingest) with chrome (footer) rules
 * built in a later stage, without double-counting shared declarations.
 */
export function mergeInstanceStyleCss(...chunks: Array<string | undefined>): string {
  const lines = new Set<string>();
  for (const chunk of chunks) {
    for (const line of (chunk ?? '').split('\n')) {
      const trimmed = line.trim();
      if (trimmed) lines.add(trimmed);
    }
  }
  return [...lines].sort().join('\n');
}
