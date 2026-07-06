//
// General semantic-HTML gate
// ==========================
// True when a captured section's HTML carries its OWN structure — its top-level
// content is predominantly semantic block elements (headings, paragraphs, tables,
// lists, blockquotes, figures). Such sections can be converted faithfully by
// rawHandler (HTML→blocks). Div-soup whose layout is CSS-inferred (Wix/Squarespace)
// returns false and stays on the structured visual render.
//
// Platform-agnostic and the GENERAL replacement for the WP-only isWpLayoutMarkup
// gate: it counts semantic TAGS, never reads wp-block-* for block identity. The
// unwrap list mirrors scripts/block-fixer/lib/rawConvert.js (kept in sync by hand —
// the sidecar is plain CJS and can't import this module).
//
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

const UNWRAP_SELECTOR =
  'main, div.wp-block-group, div.wp-block-post-content, div.entry-content, div.wp-block-group__inner-container';

// section/article/aside are intentionally NOT semantic tags here, nor in the
// unwrap list — a section wrapped solely in a single <section> yields false
// (conservative: stays on the structured visual render rather than risking a
// CSS-inferred-layout section through rawHandler).
const SEMANTIC_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'dl',
  'blockquote', 'table', 'pre', 'figure', 'hr', 'address',
]);

/** Fraction of non-presentational top-level children that must be semantic. */
const SEMANTIC_FLOOR = 0.6;

export function isSemanticHtml(html: string): boolean {
  if (!html || !html.trim()) return false;
  const $ = cheerio.load(html, null, false);

  // Unwrap non-semantic layout/template wrappers (NOT spacers), repeatedly.
  let changed = true;
  while (changed) {
    changed = false;
    $(UNWRAP_SELECTOR).each((_, el) => {
      const $el = $(el);
      // defensive: mirrors the sidecar; spacers don't actually match UNWRAP_SELECTOR
      if (($el.attr('class') || '').includes('wp-block-spacer')) return;
      $el.replaceWith($el.contents());
      changed = true;
    });
  }

  let semantic = 0;
  let nonSemantic = 0;
  $.root()
    .children()
    .each((_, el) => {
      if ((el as Element).type !== 'tag') return;
      const tag = ((el as Element).tagName || '').toLowerCase();
      const cls = $(el).attr('class') || '';
      if (cls.includes('wp-block-spacer')) return; // presentational — neutral
      if (SEMANTIC_TAGS.has(tag)) semantic++;
      else nonSemantic++;
    });

  const total = semantic + nonSemantic;
  return total > 0 && semantic >= 1 && semantic / total >= SEMANTIC_FLOOR;
}
