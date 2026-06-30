const CUSTOM_HTML_BLOCK_RE = /<!--\s*\/?\s*wp:(?:core\/)?html(?:\s|\/?-->)/i;

export function containsCustomHtmlBlock(markup: string): boolean {
  return CUSTOM_HTML_BLOCK_RE.test(markup);
}

export function customHtmlBlockError(context: string): string {
  return `${context} contains a Custom HTML block. Use existing WordPress core blocks first; create a custom block when needed, and move CSS into style.css instead of wp:html.`;
}

//
// Pipeline-emitted coverage islands
// ---------------------------------
// The reconstruction pipeline legitimately emits `core/html` fallback islands
// when a section's structured render drops content (engine coverage island). Those
// islands carry a deterministic `metadata.name` marker in the block delimiter
// so the install-time wp:html ban can tell them apart from hand-authored
// Custom HTML blocks. This is a QUALITY gate, not a security boundary against
// the operator — the marker is recognizable, not unforgeable, which is
// sufficient: the ban exists to stop an agent from dumping raw HTML instead
// of composing blocks, and agents are instructed never to emit wp:html at all.
// (metadata.name is a WP-supported block attribute — it round-trips through
// @wordpress/blocks and labels the island in the editor List View.)
//

export const PIPELINE_ISLAND_NAME = 'lib-coverage-island';

/** The exact opening delimiter the pipeline emits for a coverage island. */
export const PIPELINE_ISLAND_OPENER = `<!-- wp:html {"metadata":{"name":"${PIPELINE_ISLAND_NAME}"}} -->`;

// Opening wp:html delimiters only (a leading `/` closer never matches `wp:`),
// with optional attribute JSON, matched to the first `-->` (or end of input
// for a broken, unclosed opener — which counts as unmarked, the safe side).
const HTML_BLOCK_OPENER_RE = /<!--\s*wp:(?:core\/)?html(?=[\s/]|-->)[\s\S]*?(?:-->|$)/gi;

/**
 * True when the markup contains a `wp:html` OPENING delimiter that does NOT
 * bear the pipeline island marker. Marked islands (pipeline-emitted coverage
 * fallbacks) are allowed; any other Custom HTML block is treated as
 * hand-authored and rejected by callers via {@link customHtmlBlockError}.
 */
export function containsUnmarkedCustomHtmlBlock(markup: string): boolean {
  for (const m of markup.matchAll(HTML_BLOCK_OPENER_RE)) {
    if (!m[0].includes(`"name":"${PIPELINE_ISLAND_NAME}"`)) return true;
  }
  return false;
}
