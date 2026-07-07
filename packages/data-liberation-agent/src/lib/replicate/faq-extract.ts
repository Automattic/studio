import * as cheerio from 'cheerio';

// ---------------------------------------------------------------------------
// faq-extract — deterministic extraction of source-verbatim FAQ question/answer
// pairs from a captured page's served HTML.
//
// WHY THIS EXISTS
// FAQ accordions render every answer into the served HTML (a JS toggle only
// shows/hides them), so the Q/A text is reachable with no browser and no
// synthesis. Without structured pairs, an FAQ section falls through to the
// generic text-band renderer, which dumps EVERY answer as one wall of prose
// followed by disconnected question labels — the pairing (and the accordion UX)
// is lost. This pulls ordered {question, answer} pairs so the renderer can emit
// a faithful `wp:details` accordion.
//
// Mirrors review-extract.ts: a pure function over the captured HTML string,
// fully unit-testable. Returns [] when no accordion structure is found — the
// caller then leaves the section as-is (answers are NEVER invented; an answer we
// cannot pair is left empty and the renderer emits a missing-content placeholder).
// ---------------------------------------------------------------------------

/** One source-captured FAQ pair. Both fields are verbatim from the served HTML. */
export interface ExtractedFaq {
  question: string;
  /** May be empty when the trigger has no resolvable answer panel. */
  answer: string;
}

/** Collapse whitespace + non-breaking spaces and trim. */
function clean(text: string): string {
  return text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

// Accordion-trigger selectors, broadest-useful-first. Scoped to sections the
// caller has already identified as FAQs, so a generic `button[aria-expanded]`
// is safe here.
const TRIGGER_SEL = [
  '[class*="faq-question"]',
  '[class*="faq__question"]',
  '[class*="accordion-trigger"]',
  '[class*="accordion__trigger"]',
  '[class*="accordion-header"]',
  '[class*="accordion__header"]',
  'button[aria-expanded]',
  '[role="button"][aria-expanded]',
].join(',');

/**
 * Extract all source-verbatim FAQ pairs from a captured section's HTML.
 *
 * Two strategies, native first:
 *   1. `<details>`/`<summary>` — question is the summary, answer is the rest.
 *   2. Accordion trigger + answer panel — question is the trigger's text; the
 *      answer is the `aria-controls` target, else a following sibling whose
 *      class names it an answer/panel/content, else the immediate next sibling.
 *
 * Pairs are de-duped by question (carousels/duplicated DOM) and returned in
 * source order.
 */
export function extractFaqsFromHtml(html: string): ExtractedFaq[] {
  if (!html || html.length === 0) return [];
  const $ = cheerio.load(html);
  const pairs: ExtractedFaq[] = [];
  const seen = new Set<string>();

  const push = (qRaw: string, aRaw: string): void => {
    const question = clean(qRaw);
    const answer = clean(aRaw);
    // A real FAQ question is a short-ish line; guard against grabbing a whole
    // panel as the "question" when the trigger nests its answer.
    if (!question || question.length > 240) return;
    const key = question.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ question, answer });
  };

  // 1. Native <details>/<summary>.
  $('details').each((_i, d) => {
    const $d = $(d);
    const q = $d.find('summary').first().text();
    const $clone = $d.clone();
    $clone.find('summary').remove();
    push(q, $clone.text());
  });
  if (pairs.length >= 2) return pairs;

  // 2. Accordion trigger + answer panel.
  $(TRIGGER_SEL).each((_i, t) => {
    const $t = $(t);
    const q = $t.text(); // chevron SVGs contribute no text
    if (!clean(q)) return;

    // Resolve the answer ELEMENT: aria-controls target, else a following sibling
    // whose class names it an answer/panel, else the immediate next sibling.
    let $ans = $t.filter(() => false); // empty selection
    const controls = $t.attr('aria-controls');
    if (controls) {
      const tgt = $(`[id="${controls}"]`);
      if (tgt.length) $ans = tgt;
    }
    if (!$ans.length) {
      let sib = $t.next();
      for (let hops = 0; sib.length && hops < 3; hops++) {
        const cls = (sib.attr('class') || '').toLowerCase();
        if (/answer|panel|content|body|collapse/.test(cls)) {
          $ans = sib;
          break;
        }
        sib = sib.next();
      }
      if (!$ans.length) $ans = $t.next();
    }

    // Skip GROUP / category headers: a collapsible category ("About Go 2") is
    // also an accordion trigger, but its "answer" is the CONTAINER of the real
    // question triggers — so it nests other triggers. Treating it as a question
    // would emit a bogus pair whose answer swallows the whole group.
    if ($ans.length && $ans.find(TRIGGER_SEL).length > 0) return;

    push(q, $ans.length ? $ans.text() : '');
  });

  return pairs;
}
