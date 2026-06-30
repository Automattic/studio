import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

// ---------------------------------------------------------------------------
// review-extract — deterministic extraction of REAL customer reviews from a
// captured page's served HTML.
//
// WHY THIS EXISTS
// Replica review/testimonial bands MUST carry source-verbatim review text. A
// prior pass synthesized plausible-sounding review quotes when the reviews
// "looked" JS-rendered — they were not. Page-builder review carousels (Replo,
// and similar) render every slide's category + star run + quote + byline
// directly into the served HTML; a JS widget only animates them. So the real
// reviews are reachable from the saved `html/<slug>.html` with no browser and
// no third-party API.
//
// This mirrors the Wix `extractGalleryFromHtml` pattern (src/adapters/wix.ts):
// a pure function over the captured HTML string, fully unit-testable, that the
// orchestrator and the generating-patterns skill consume to build the review
// grid VERBATIM. When this returns [], the section MUST fall back to the
// missing-content treatment (sized placeholders + run-report flag) — callers
// must NEVER invent review prose.
// ---------------------------------------------------------------------------

/** One source-captured review. All text is verbatim from the served HTML. */
export interface ExtractedReview {
  /** Category / context label (e.g. "TRAVEL", "TINNITUS"), if the unit has one. */
  category: string | null;
  /** Star count 1-5, derived from the rendered star run (filled glyphs/SVGs). */
  stars: number;
  /** The review quote, VERBATIM (surrounding quote marks preserved). */
  quote: string;
  /** Attribution / byline (e.g. "-Kayla"), if present. */
  author: string | null;
}

// A run of 1-5 stars usually renders as repeated <svg> with a star path, or a
// run of star glyphs, or a rating-class element. We count the filled stars.
const STAR_GLYPH_RE = /[★⭐✰✪]/g;
// Quote-shaped text: a sentence wrapped in typographic or straight quotes that
// is long enough to be a real testimonial (not a stray quoted word). Replo
// review carousels wrap quotes in plain <p>, not <blockquote>.
const QUOTE_MIN_LEN = 30;

/** Collapse whitespace + non-breaking spaces and trim. */
function clean(text: string): string {
  return text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * True when text reads like a verbatim review quote: long enough to be a
 * testimonial AND wrapped in (or opening with) quote marks. We deliberately do
 * NOT accept bare long sentences — hero subheads and product blurbs are
 * quote-shaped but unquoted, and treating them as reviews is exactly the
 * synthesis-adjacent error this module exists to prevent. A quote-marked
 * testimonial is the unambiguous signal; the star-run anchor in the caller is
 * the second gate.
 */
function looksLikeQuote(text: string): boolean {
  const t = clean(text);
  if (t.length < QUOTE_MIN_LEN) return false;
  // Opens with a typographic / straight double-quote (the common case), or is
  // fully wrapped in quote marks somewhere in the string.
  if (/^[“"”]/.test(t)) return true;
  if (/[“"][^“”"]{20,}[”"]/.test(t)) return true;
  return false;
}

/**
 * Count filled stars inside an element subtree. Recognizes (in priority order):
 *  1. star glyphs (★ runs) in the text,
 *  2. an explicit aria-label / data-rating ("4.5 out of 5", "5"),
 *  3. a run of small same-shape <svg>/<i> star icons (Replo's anonymous paths).
 * Returns 0 when no star signal is present.
 */
function countStars($: CheerioAPI, el: Cheerio<Element>): number {
  // 1. glyphs
  const glyphs = (el.text().match(STAR_GLYPH_RE) || []).length;
  if (glyphs >= 1) return Math.min(glyphs, 5);

  // 2. aria-label / data-rating "N out of 5" or bare "N"
  let labelled = 0;
  el.find('[aria-label],[data-rating],[data-score]').each((_i, node) => {
    const e = $(node);
    const lbl = (e.attr('aria-label') || e.attr('data-rating') || e.attr('data-score') || '').trim();
    const m = lbl.match(/([0-5](?:\.\d)?)\s*(?:out of\s*5|\/\s*5|stars?)?/i);
    if (m) labelled = Math.max(labelled, Math.round(parseFloat(m[1])));
  });
  if (labelled >= 1) return Math.min(labelled, 5);

  // 3. a horizontal run of small same-tag icon elements (svg/i with a star-ish
  //    path or class). Count the icons that look "filled" — a `fill` attr that
  //    isn't none/transparent, or a fill/full class — falling back to the run
  //    length when no fill marker distinguishes filled from empty.
  const ICON_SEL = 'svg, i';
  // Group candidate icons by their direct parent so a real star ROW is one run,
  // not the whole card's scattered icons.
  const byParent = new Map<AnyNode, Element[]>();
  el.find(ICON_SEL).each((_i, node) => {
    const parent = node.parent;
    if (!parent) return;
    const arr = byParent.get(parent) || [];
    arr.push(node as Element);
    byParent.set(parent, arr);
  });
  let best = 0;
  for (const icons of byParent.values()) {
    if (icons.length < 1 || icons.length > 6) continue;
    const looksStar = icons.every((node) => {
      const e = $(node);
      const cls = (e.attr('class') || '').toLowerCase();
      const html = $.html(node).toLowerCase();
      // Star path heuristic: the well-known bootstrap-ish star path "d=..l4.73"
      // or a class/aria that names a star.
      return (
        /star|rating/.test(cls) ||
        /star/.test(e.attr('aria-label') || '') ||
        /m3\.612|l\.83|4\.73|polygon|star/.test(html)
      );
    });
    if (!looksStar) continue;
    const filled = icons.filter((node) => {
      const e = $(node);
      const fill = (e.attr('fill') || '').trim().toLowerCase();
      const cls = (e.attr('class') || '').toLowerCase();
      if (/fill|full|active|on\b/.test(cls)) return true;
      if (fill && fill !== 'none' && fill !== 'transparent' && !/^rgba?\([^)]*,\s*0\)$/.test(fill))
        return true;
      return false;
    }).length;
    best = Math.max(best, filled > 0 ? filled : icons.length);
  }
  return Math.min(best, 5);
}

/**
 * Within a candidate review unit, find the category label, the quote, and the
 * author byline. Categories/bylines are short headings; the quote is the long
 * quote-shaped paragraph. Returns null when no quote is present (so a non-review
 * unit can't masquerade as one).
 */
function parseReviewUnit($: CheerioAPI, unit: Cheerio<Element>): ExtractedReview | null {
  // The quote: the FULL text of the smallest quote-bearing element (so nested
  // <strong>/<em> inside the testimonial paragraph is preserved verbatim). The
  // category + byline: short labels rendered as their own headings/leaf nodes.
  let quote: string | null = null;
  const shortTexts: string[] = [];

  // 1. Quote — prefer a <p>/<blockquote>/<q> whose FULL text is quote-shaped.
  unit.find('p, blockquote, q').each((_i, node) => {
    if (quote) return;
    const full = clean($(node).text());
    if (looksLikeQuote(full)) quote = full;
  });
  // Fallback: any element whose full text is quote-shaped (some builders use a
  // styled <div>/<span> for the quote).
  if (!quote) {
    unit.find('span, div').each((_i, node) => {
      if (quote) return;
      const full = clean($(node).text());
      // Guard against grabbing the whole card (which would include the byline);
      // require the element to contain no nested heading.
      if ($(node).find('h1,h2,h3,h4,h5,h6').length === 0 && looksLikeQuote(full)) quote = full;
    });
  }
  if (!quote) return null;

  // 2. Short labels — leaf-ish headings / short own-text nodes (category, byline).
  unit.find('h1,h2,h3,h4,h5,h6,p,span,div,cite').each((_i, node) => {
    const own = clean(
      $(node)
        .contents()
        .filter((_j, c) => c.type === 'text')
        .text(),
    );
    if (!own || own.length > 60) return;
    if (looksLikeQuote(own)) return;
    if (clean(own).toLowerCase() === clean(quote as string).toLowerCase()) return;
    shortTexts.push(own);
  });

  // Heuristic mapping: the first short label that PRECEDES the quote (and isn't
  // a byline) is the category; a short label that looks like a byline ("-Name",
  // "— Name", "Name, City", "Verified Buyer") is the author. The quote string
  // is excluded.
  const isByline = (t: string): boolean =>
    /^[-–—~]\s*\S/.test(t) || /verified|buyer|customer/i.test(t);
  let category: string | null = null;
  let author: string | null = null;
  for (const t of shortTexts) {
    if (t === quote) continue;
    if (isByline(t) && !author) {
      author = t;
      continue;
    }
    if (!category && !isByline(t)) category = t;
  }

  const stars = countStars($, unit);
  return { category, stars, quote, author };
}

/**
 * Extract all source-verbatim reviews from a captured page's served HTML.
 *
 * Strategy: locate repeated review "units" — DOM subtrees that each contain a
 * quote-shaped paragraph (and usually a star run + a byline). We gather the
 * smallest enclosing block per quote so units don't bleed into each other, then
 * de-dupe by quote text (page-builder carousels clone slides for infinite
 * scroll, so the same review appears several times in the markup).
 *
 * Returns reviews in source order. Empty array means NO real review text was
 * found — the caller MUST then use the missing-content fallback, NEVER invent.
 */
export function extractReviewsFromHtml(html: string): ExtractedReview[] {
  if (!html || html.length === 0) return [];
  const $ = cheerio.load(html);

  // 1. Find every text node that reads like a verbatim quote, and walk up to
  //    the smallest ancestor that ALSO contains a short label / star run — that
  //    ancestor is the review "unit". We cap the walk so a quote in body prose
  //    (e.g. a blog post) doesn't pull in a whole article.
  const quoteNodes: Element[] = [];
  $('p, blockquote, q').each((_i, node) => {
    // Full text (incl. nested <strong>/<em>) — page builders bold the opening
    // sentence of a testimonial, so own-text alone would miss the quote mark.
    if (looksLikeQuote(clean($(node).text()))) quoteNodes.push(node as Element);
  });

  const reviews: ExtractedReview[] = [];
  const seenQuotes = new Set<string>();

  for (const qn of quoteNodes) {
    // A real review carries a STAR RUN. Walk up from the quote to the smallest
    // ancestor that contains a star signal — that ancestor is the review
    // "unit". Anchoring on stars (not just any heading) is what separates a
    // testimonial from marketing prose / hero subheads / product blurbs, which
    // are quote-shaped but carry no rating. We also keep climbing a couple of
    // hops past the star ancestor so the unit encloses the category label and
    // the byline that page builders render as sibling subtrees of the quote.
    let starUnit: Cheerio<Element> | null = null;
    let cur: AnyNode | null = qn.parent;
    let hops = 0;
    while (cur && cur.type === 'tag' && hops < 8) {
      const c = $(cur as Element);
      if (countStars($, c) > 0) {
        starUnit = c;
        // climb one or two more levels to scoop up a sibling category/byline,
        // but stop before the whole section (which holds OTHER reviews' stars).
        let parent: AnyNode | null = (cur as Element).parent;
        let extra = 0;
        while (parent && parent.type === 'tag' && extra < 2) {
          const p = $(parent as Element);
          // Stop expanding if the parent would absorb a second quote — that
          // means we've reached the grid host, not a single card.
          const quoteCount = p
            .find('p, blockquote, q')
            .toArray()
            .filter((n) => looksLikeQuote(clean($(n).text()))).length;
          if (quoteCount > 1) break;
          starUnit = p;
          parent = (parent as Element).parent;
          extra++;
        }
        break;
      }
      cur = (cur as Element).parent;
      hops++;
    }

    // No star run anywhere above the quote → not a review. NEVER treat bare
    // quote-shaped marketing copy as a testimonial.
    if (!starUnit) continue;

    const review = parseReviewUnit($, starUnit);
    if (!review || review.stars < 1) continue;
    const key = clean(review.quote).toLowerCase();
    if (seenQuotes.has(key)) continue;
    seenQuotes.add(key);
    reviews.push(review);
  }

  return reviews;
}
