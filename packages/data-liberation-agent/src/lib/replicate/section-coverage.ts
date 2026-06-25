import * as cheerio from 'cheerio';

//
// Section coverage measurement
// ============================
// Measures how much of a section's CAPTURED content (text + media) actually
// survived the deterministic structured render. The per-section renderers in
// page-reconstruct.ts never "fail" — they always emit something — so the real
// failure mode is a partially-lossy render that silently drops content. This
// quantifies that loss so the caller can fall back to a verbatim `core/html`
// island (see html-fallback.ts) rather than ship the lossy blocks.
//
// Pure, no I/O. The "media-first" rule (per design): ANY dropped image is a
// loss; text loss is tolerated down to TEXT_FLOOR — minor copy reflow stays as
// clean editable blocks, but a missing gallery/avatar trips the fallback.
//
// TEXT trigger is deliberately CONSERVATIVE. A `core/html` island carries the
// source's HTML but NOT its CSS, so a CSS-styled section (cards / grids /
// columns) renders UNSTYLED inside the island — visually worse than the
// structured render even when the structured render missed some copy. Swiftlumber
// dogfood (2026-05-28): the homepage "Advantage" 3-card section rendered perfectly
// as structured blocks at 75% text coverage, but the 0.8 floor downgraded it to an
// unstyled island (giant stacked icons). So we only fall back when the structured
// render is BADLY broken — text coverage below half — where preserving content
// verbatim clearly beats an incomplete structured render. Missing images always
// trip it regardless (media-first).
//

/** Captured content for one section, used as the coverage denominator. */
export interface CapturedSectionContent {
  /** Verbatim text items (headings + body paragraphs + button labels). */
  texts: string[];
  /** Image URLs as they appear in the render (media-mapped local URLs). */
  imageUrls: string[];
}

export interface CoverageResult {
  /** Fraction (0..1) of captured text items found in the rendered markup. */
  textCoverage: number;
  /** Captured image URLs absent from the rendered markup. */
  missingImages: string[];
  /** True when the render lost enough to warrant the verbatim fallback. */
  lost: boolean;
}

/** A section falls back to a verbatim island only when its rendered text coverage
 *  drops BELOW this fraction (i.e. the structured render lost more than half the
 *  copy). Set conservatively (0.5, not 0.8) because the island carries no source
 *  CSS — see the file header. Missing images trip the fallback independently. */
const TEXT_FLOOR = 0.5;

/**
 * Measure coverage of a section's captured content against its rendered block
 * markup. Empty captured content is "fully covered" (nothing to lose).
 */
/** Fold typographic glyph variants + collapse whitespace + lowercase. Mirrors the
 *  provenance gate's glyph-folding so converted-path coverage agrees with it.
 *  Exported for page-reconstruct's promoted-heading echo check, which must fold
 *  the same way so the two source-text comparisons agree. */
export function foldText(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201b]/g, "'") // left/right single quotes, high-reversed-9
    .replace(/[\u201c\u201d]/g, '"') // left/right double quotes
    .replace(/[\u2013\u2014\u2012]/g, '-') // en-dash, em-dash, figure dash
    .replace(/\u2026/g, '...') // horizontal ellipsis
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Coverage for the rawHandler-CONVERTED path. `measureSectionCoverage` is built for
 * the structured render (text/images emitted FROM the captured fields → exact match
 * by construction). The converted markup is INDEPENDENTLY derived from sectionHtml,
 * so its forms legitimately differ: inline tags interleave the text, entities/smart-
 * quotes may be encoded, and an image may appear as a different URL form of the same
 * asset (CDN vs uploads). So match captured text against the markup's TRUE textContent
 * (cheerio — entities decoded, no spurious tag-boundary spaces) with glyph folding,
 * and match images by BASENAME. Same TEXT_FLOOR + missing-image rule as the structured
 * check, so the media-first "any dropped image is loss" guarantee is preserved.
 */
export function measureConvertedCoverage(
  captured: CapturedSectionContent,
  convertedMarkup: string,
): CoverageResult {
  const haystack = foldText(cheerio.load(convertedMarkup, null, false).root().text());
  const texts = captured.texts.map(foldText).filter((t) => t.length > 0);
  const present = texts.filter((t) => haystack.includes(t)).length;
  const textCoverage = texts.length === 0 ? 1 : present / texts.length;

  const basename = (u: string): string => (u.split(/[?#]/)[0].split('/').pop() || '').toLowerCase();
  const markupLc = convertedMarkup.toLowerCase();
  const missingImages = captured.imageUrls.filter((u) => {
    const b = basename(u);
    return b ? !markupLc.includes(b) : !!u && !markupLc.includes(u.toLowerCase());
  });

  const lost = missingImages.length > 0 || textCoverage < TEXT_FLOOR;
  return { textCoverage, missingImages, lost };
}

export function measureSectionCoverage(
  captured: CapturedSectionContent,
  renderedMarkup: string,
): CoverageResult {
  // Match captured text against the markup's DECODED text content, not the raw
  // markup string: the structured renderers emit text through escapeHtml, so the
  // markup carries &amp;/&#039;/&quot; where the captured text has &/'/". A raw
  // substring match read every such text as missing — a section whose texts ALL
  // contained an escapable char measured 0% and was demoted to an island the
  // render never warranted. cheerio decodes entities (and drops block comments);
  // foldText absorbs typographic glyph variants, mirroring the converted-path
  // check below so the two coverage measures agree.
  const haystack = foldText(cheerio.load(renderedMarkup, null, false).root().text());

  const texts = captured.texts.map(foldText).filter((t) => t.length > 0);
  const present = texts.filter((t) => haystack.includes(t)).length;
  const textCoverage = texts.length === 0 ? 1 : present / texts.length;

  const missingImages = captured.imageUrls.filter((url) => url && !renderedMarkup.includes(url));

  const lost = missingImages.length > 0 || textCoverage < TEXT_FLOOR;

  return { textCoverage, missingImages, lost };
}
