// src/lib/replicate/validate-block-markup.ts
//
// Structural oracle for generated block markup. Our pattern renderer
// (page-reconstruct.ts) hand-builds `<!-- wp:NAME -->…<!-- /wp:NAME -->`
// strings, which nothing currently validates for well-formedness. This runs
// that markup through the SAME parser WordPress/Gutenberg uses
// (@wordpress/block-serialization-default-parser — a no-DOM JS port of the PHP
// WP_Block_Parser) and asserts two things the parser otherwise *silently
// tolerates*:
//
//   1. No content sits outside a block delimiter (freeform leak) and every
//      block's attribute JSON parses — both surfaced by the official parser
//      (freeform → blockName === null; bad JSON → attrs === null, no throw).
//   2. Delimiters are balanced. The default parser does NOT flag a missing or
//      mismatched closing delimiter — it silently re-parents the next sibling
//      as a child (verified: `wp:columns` with no `/wp:columns` swallows the
//      following paragraph). So we add a deterministic stack check that reuses
//      the parser's own delimiter grammar.
//
// Returns a list of human-readable violation messages ([] = clean), matching
// the `scanForInjection` convention so it folds into `validateArtifacts`.

import { parse } from '@wordpress/block-serialization-default-parser';

// ParsedBlock isn't exported by the package; derive it from parse()'s return type.
type ParsedBlock = ReturnType<typeof parse>[number];

// The exact delimiter grammar from @wordpress/block-serialization-default-parser.
// Groups: 1 = leading "/" (closer), 2 = "namespace/", 3 = name, 4 = attrs, 5 = trailing "/" (void).
const DELIMITER =
  /<!--\s+(\/)?wp:([a-z][a-z0-9_-]*\/)?([a-z][a-z0-9_-]*)\s+({(?:(?!}\s+\/?-->).)*?}\s+)?(\/)?-->/g;

/** Drop a leading `<?php … ?>` pattern-file header so it isn't seen as a freeform leak. */
function stripPhpHeader(markup: string): string {
  return markup.replace(/^﻿?\s*<\?php[\s\S]*?\?>\n?/, '');
}

/** `core/paragraph` → `paragraph`; leaves an already-short name untouched. */
function shortName(blockName: string): string {
  return blockName.startsWith('core/') ? blockName.slice('core/'.length) : blockName;
}

/** Layer 1: walk the official parse tree for freeform leaks + unparseable attrs. */
function checkParseTree(blocks: ParsedBlock[], issues: string[]): void {
  for (const b of blocks) {
    if (b.blockName === null) {
      if ((b.innerHTML ?? '').trim() !== '') {
        const snippet = b.innerHTML.trim().replace(/\s+/g, ' ').slice(0, 60);
        issues.push(`content outside any block delimiter (freeform leak): "${snippet}"`);
      }
    } else if (b.attrs === null) {
      // The parser sets attrs to null when the comment's JSON fails to parse.
      issues.push(`invalid block-attribute JSON in wp:${shortName(b.blockName)}`);
    }
    if (b.innerBlocks && b.innerBlocks.length > 0) {
      checkParseTree(b.innerBlocks, issues);
    }
  }
}

/** Layer 2: stack-based delimiter balance the default parser silently tolerates. */
function checkBalance(markup: string, issues: string[]): void {
  const stack: string[] = [];
  for (const m of markup.matchAll(DELIMITER)) {
    const name = (m[2] ?? '') + m[3];
    const isCloser = Boolean(m[1]);
    const isVoid = Boolean(m[5]);
    if (isCloser) {
      const open = stack.pop();
      if (open === undefined) {
        issues.push(`closing delimiter with no open block: /wp:${name}`);
      } else if (open !== name) {
        issues.push(`mismatched closing delimiter: expected /wp:${open}, found /wp:${name}`);
      }
    } else if (!isVoid) {
      stack.push(name);
    }
  }
  for (const unclosed of stack) {
    issues.push(`unclosed block delimiter: wp:${unclosed}`);
  }
}

/**
 * Validate generated WordPress block markup. Accepts either a raw block-markup
 * string or a full pattern-file `php` field (a leading `<?php … ?>` header is
 * stripped before validation). Returns violation messages; [] means clean.
 */
export function validateBlockMarkup(markup: string): string[] {
  const body = stripPhpHeader(markup);
  const issues: string[] = [];
  checkParseTree(parse(body), issues);
  checkBalance(body, issues);
  return issues;
}
