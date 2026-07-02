//
// Block-output verifier (post-skill defense layer 2)
// ==================================================
// After the `compose-page-blocks` skill emits block markup, confirm every
// text node in that markup is also present in the source HTML's plain text.
// This is an anti-hallucination check: an LLM that "helpfully" rewrites
// "Foo Industries" to "Bar Inc" gets caught here, and the apply pipeline
// preserves the raw post_content instead of overwriting with hallucinated
// copy.
//
// Strategy:
//   1. Strip block-comment delimiters (`<!-- wp:... -->` / `<!-- /wp:... -->`)
//      from the markup. The block-attribute JSON blob inside the open
//      comment is metadata, not user-facing copy — verifying its slugs
//      against source text would be wrong.
//   2. Tokenize the remaining HTML into text nodes (between tags). Treat any
//      whitespace-collapsed chunk as a "candidate text node."
//   3. For each non-trivial text node, check it appears as a substring of
//      the whitespace-normalized, lowercased plain text of the source HTML.
//   4. Return the list of nodes that didn't match (`hallucinated`).
//
// Trivial nodes (single punctuation, numbers shorter than 3 chars, etc.)
// are skipped because LLM outputs commonly include emoji-like glyphs or
// stylistic markers (—, ›) that aren't always present in source.
//
// Comparison:
//   - Case-insensitive (lowercase both)
//   - Whitespace-normalized (collapse runs of whitespace to single spaces)
//   - Substring match (allows source "Welcome to Foo Industries, Inc." to
//     accept output text "Foo Industries, Inc.")
//

export interface VerifyResult {
  valid: boolean;
  /** Text nodes from the block markup that are NOT present in the source. */
  hallucinated: string[];
}

/** Strip the open and close `<!-- wp:... -->` comments from block markup. */
function stripBlockComments(markup: string): string {
  // Block opens: `<!-- wp:foo -->` or `<!-- wp:foo {"attrs":...} -->`
  // Block closes: `<!-- /wp:foo -->`
  // We deliberately only strip wp: comments — generic HTML comments would
  // already have been removed by the pre-skill sanitizer, but if any survive
  // they should NOT be treated as text content (they're metadata).
  return markup
    .replace(/<!--\s*\/?wp:[^>]*-->/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

/** Strip all HTML tags, returning whitespace-collapsed plain text. */
function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull each text node (chunk between tags / block comments) out of the markup. */
function extractTextNodes(markup: string): string[] {
  const stripped = stripBlockComments(markup);
  const nodes: string[] = [];
  // Split on tag boundaries; each piece between tags is a candidate text node.
  // We keep punctuation-and-whitespace nodes out of the result because they
  // would always trivially match (and obscure real hallucinations).
  const parts = stripped.split(/<[^>]+>/);
  for (const raw of parts) {
    const text = htmlToPlainText(raw);
    if (!text) continue;
    // Skip trivial chunks (single short tokens like dates, numbers, punctuation).
    // We require at least 3 alphanumeric characters to avoid matching against
    // common stylistic adornments.
    const alnum = text.replace(/[^a-zA-Z0-9]/g, '');
    if (alnum.length < 3) continue;
    nodes.push(text);
  }
  return nodes;
}

/** Normalize for substring comparison: lowercase + collapse internal whitespace. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Verify every textual chunk emitted by the skill is grounded in the source
 * HTML's plain text. Returns `valid: false` plus the offending chunks if any
 * text was hallucinated (i.e. doesn't appear as a substring of the source).
 */
export function verifyComposedOutput(
  blocksMarkup: string,
  sourceHtmlPlainText: string,
): VerifyResult {
  // Allow callers to pass either raw HTML or pre-extracted plain text — we
  // run the same plain-text extraction either way so tags don't trip the
  // substring search.
  const sourceText = normalize(htmlToPlainText(sourceHtmlPlainText));
  const nodes = extractTextNodes(blocksMarkup);
  const hallucinated: string[] = [];

  for (const node of nodes) {
    const needle = normalize(node);
    if (!needle) continue;
    if (!sourceText.includes(needle)) {
      hallucinated.push(node);
    }
  }

  return {
    valid: hallucinated.length === 0,
    hallucinated,
  };
}
