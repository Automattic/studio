// src/lib/replicate/normalize/styling-conservation.ts
//
// Styling-conservation diagnostic: a deterministic, render-free check that a
// section's source CSS classes survive into its emitted block markup. The block
// conversion can silently DROP a class the carried stylesheet targets — a leaf
// `.stat-num` flattened to a bare <p>, a styling hook unwrapped — and the loss
// is invisible until someone eyeballs the rendered site. This is the safety net:
// any source class missing from the output is surfaced as a WARNING so the whole
// drop-category is caught on the first run, on every site, not rediscovered one
// dogfood at a time.
//
// Scope is deliberately CLASS-level (the dominant, lowest-noise styling hook in
// owned sources). Element-tag and inline-style conservation are noisier
// (container tags legitimately convert to core/group <div>) and left to a deeper
// follow-up; the specific tag/inline-style fixes have their own unit tests.
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

/** A section whose emitted block markup dropped one or more source classes. */
export interface SectionStylingDrop {
  sectionId: string;
  droppedClasses: string[];
}

/** Non-rendering tags whose classes are never styling hooks. */
const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript']);
/** Block-markup `"className":"…"` attrs live inside HTML comments cheerio skips. */
const CLASS_NAME_ATTR_RE = /"className"\s*:\s*"([^"]*)"/g;

/**
 * All CSS class tokens in `html` — from element `class=` attributes AND from
 * block-markup `"className":"…"` attrs — so a class carried only on a block
 * comment still counts as present. Classes on non-rendering tags are ignored.
 */
export function extractClassTokens(html: string): Set<string> {
  const out = new Set<string>();
  const $ = cheerio.load(html);
  $('[class]').each((_, node) => {
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName?.toLowerCase() ?? '')) return;
    for (const tok of ($(el).attr('class') ?? '').split(/\s+/)) if (tok) out.add(tok);
  });
  for (const m of html.matchAll(CLASS_NAME_ATTR_RE)) {
    for (const tok of m[1].split(/\s+/)) if (tok) out.add(tok);
  }
  return out;
}

/**
 * Source classes absent from the emitted block markup — dropped styling hooks
 * the carried CSS targeted (`.stat .stat-num`, `.quote .quote-by`). Returns a
 * sorted, de-duplicated list; `[]` when every source class survives.
 */
export function findDroppedClasses(sourceHtml: string, emittedMarkup: string): string[] {
  const present = extractClassTokens(emittedMarkup);
  const dropped = new Set<string>();
  for (const cls of extractClassTokens(sourceHtml)) if (!present.has(cls)) dropped.add(cls);
  return [...dropped].sort();
}
