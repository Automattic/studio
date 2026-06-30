import { parse } from '@wordpress/block-serialization-default-parser';
import { walkBlocks } from '../block-tree.js';
import type { ParsedBlock } from '../block-tree.js';
import { analyzeIsland, emitEditableBlock } from './island-bindings.js';

interface Replacement {
  from: string;
  to: string;
}

function originalHtmlBlock(block: ParsedBlock): string {
  // Reconstruct the EXACT opening delimiter, including any block attributes. The carry
  // path names each island via `<!-- wp:html {"metadata":{"name":"…"}} -->` (page-
  // reconstruct-carry.ts), serialized with plain JSON.stringify — the same encoder the
  // parser's JSON.parse inverts — so this round-trips byte-for-byte and the string match
  // succeeds. With no attrs (the local path) this yields the bare `<!-- wp:html -->`,
  // unchanged. Without this, attributed islands never matched and converted=0.
  const attrs =
    block.attrs && Object.keys(block.attrs).length > 0 ? ` ${JSON.stringify(block.attrs)}` : '';
  return `<!-- wp:html${attrs} -->${block.innerHTML}<!-- /wp:html -->`;
}

function containsBlockDelimiter(html: string): boolean {
  return /<!--\s*\/?wp:/.test(html);
}

export function makeIslandsEditable(postContent: string): { content: string; converted: number } {
  const replacements: Replacement[] = [];

  walkBlocks(parse(postContent), (block) => {
    if (block.blockName !== 'core/html') return;
    // Safety guard ONLY: a core/html that wraps nested block delimiters is not a raw HTML
    // island — frame-flattening it would corrupt the inner blocks. Skip those. Every other
    // core/html island converts (editable-html is the default island representation), even
    // ones with no bindable leaves (svg/decorative): they still render unstyled inside the
    // editor's core/html SandBox, which is exactly what converting to the in-canvas block fixes.
    if (containsBlockDelimiter(block.innerHTML)) return;

    const island = analyzeIsland(block.innerHTML);

    // Carry the source island's block metadata (e.g. metadata.name — the editor label)
    // onto the editable block so the named islands keep their names in List View.
    const rawMeta = (block.attrs as Record<string, unknown> | undefined)?.metadata;
    const metadata =
      rawMeta && typeof rawMeta === 'object' ? (rawMeta as Record<string, unknown>) : undefined;

    replacements.push({
      from: originalHtmlBlock(block),
      to: emitEditableBlock(island, metadata),
    });
  });

  let content = postContent;
  let converted = 0;
  for (const replacement of replacements) {
    if (!content.includes(replacement.from)) continue;
    content = content.replace(replacement.from, () => replacement.to);
    converted += 1;
  }

  return { content, converted };
}
