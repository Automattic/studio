// src/lib/replicate/block-tree.ts
//
// Shared traversal for parsed block trees (the registration-free default
// parser's output). Both the style-usage audit and the block-contract check
// need the same depth-first walk — visit every NAMED block (skipping
// null/freeform whitespace between delimiters), descending into innerBlocks —
// differing only in what they do at each block. Keep the recursion in one place.
import type { parse } from '@wordpress/block-serialization-default-parser';

export type ParsedBlock = ReturnType<typeof parse>[number];

/**
 * Depth-first visit of every named block in the tree, innerBlocks included.
 * Freeform nodes (blockName === null) are skipped but still descended through.
 */
export function walkBlocks(blocks: ParsedBlock[], visit: (block: ParsedBlock) => void): void {
  for (const b of blocks) {
    if (b.blockName !== null) visit(b);
    if (b.innerBlocks && b.innerBlocks.length > 0) walkBlocks(b.innerBlocks, visit);
  }
}
