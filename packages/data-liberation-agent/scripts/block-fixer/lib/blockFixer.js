//
// Block fixer — ported from
// https://github.com/Automattic/telex (server/scripts/block-fixer/lib/blockFixer.js).
//
// parse() applies validation-fixes automatically; createBlock() + serialize()
// re-emits canonical WordPress markup. Even "valid" blocks get re-serialized
// because subtle structural differences (attribute order, missing data-attrs,
// CSS property order) can still fail WordPress's block validator.
//

const {
  parse,
  serialize,
  createBlock,
  getBlockAttributes,
} = require('@wordpress/blocks');
const {
  parse: parseBlockGrammar,
} = require('@wordpress/block-serialization-default-parser');
const { registerCoreBlocks } = require('@wordpress/block-library');
const { fixNestedParagraphs } = require('./paragraphFixer');

let initialized = false;

function initializeBlockRegistry() {
  if (initialized) return;
  try {
    registerCoreBlocks();
    initialized = true;
    console.error('[BlockFixer] Block registry initialized with core blocks');
  } catch (error) {
    console.error('[BlockFixer] Failed to initialize block registry:', error);
    initialized = true;
  }
}

// Did parse() alter or drop any attribute the document's comment delimiter
// declared? Comment attrs are plain JSON, so stringify equality is exact.
function commentAttrsAltered(parsedAttrs, rawAttrs) {
  return Object.keys(rawAttrs).some(
    (key) => JSON.stringify(parsedAttrs[key]) !== JSON.stringify(rawAttrs[key]),
  );
}

//
// Comment-delimiter attrs are authoritative (this mirrors what WordPress
// persists for the block). parse() can silently lose them on two paths:
//
//   1. Invalid blocks: built-in "validation fixes" (fixCustomClassname /
//      ariaLabel / anchor) re-derive those attrs from the STALE inner HTML —
//      deleting author-intent values that only exist in the comment attrs
//      (e.g. a hoisted "is-style-lib-*" className whose inner HTML still
//      carries the pre-hoist inline styles).
//   2. Deprecation hijack: an eligible deprecated version (core/paragraph)
//      can "successfully migrate" the block — marking it VALID while eating
//      comment attrs absent from the deprecated schema (className,
//      fontFamily) and swallowing the whole outer markup into `content`.
//
// `rawBlock` is this block's counterpart from the grammar-level parser
// (verbatim comment attrs, untouched by either path). When parse() altered
// any declared attr, re-derive the attribute set from the original inner
// HTML + raw comment attrs via getBlockAttributes() — the same call
// parse() itself makes BEFORE validation fixes / deprecations run. Sourced
// attributes (content etc.) never appear in comment attrs, so author intent
// can't clobber them; createBlock() drops keys unknown to the current schema.
//
function fixBlockRecursively(block, rawBlock) {
  const fixedInnerBlocks = [];

  if (block.innerBlocks && block.innerBlocks.length > 0) {
    const rawInner = (rawBlock && rawBlock.innerBlocks) || [];
    let rawIndex = 0;
    for (const innerBlock of block.innerBlocks) {
      // Align the raw pointer: parse() drops raw nodes that produce no block
      // (whitespace-only freeform, unregistered types), so pair strictly by
      // block name and skip raw nodes that have no parsed counterpart. If
      // alignment is lost we simply stop pairing — same behavior as before.
      while (
        rawIndex < rawInner.length &&
        rawInner[rawIndex].blockName !== innerBlock.name
      ) {
        rawIndex++;
      }
      const rawInnerBlock =
        rawIndex < rawInner.length ? rawInner[rawIndex++] : undefined;
      const result = fixBlockRecursively(innerBlock, rawInnerBlock);
      fixedInnerBlocks.push(result.block);
    }
  }

  if (!block.name) {
    return { block, wasFixed: false };
  }

  let attributes = block.attributes;
  const rawCommentAttrs =
    (rawBlock && rawBlock.blockName === block.name && rawBlock.attrs) ||
    (block.__unstableBlockSource && block.__unstableBlockSource.attrs) ||
    null;
  if (rawCommentAttrs && commentAttrsAltered(block.attributes, rawCommentAttrs)) {
    const sourceHtml =
      typeof block.originalContent === 'string'
        ? block.originalContent
        : ((rawBlock && rawBlock.innerHTML) || '');
    attributes = getBlockAttributes(block.name, sourceHtml, rawCommentAttrs);
  }

  const fixedBlock = createBlock(
    block.name,
    attributes,
    fixedInnerBlocks.length > 0 ? fixedInnerBlocks : undefined,
  );

  return { block: fixedBlock, wasFixed: true };
}

function fixBlocksInTemplate(htmlContent) {
  initializeBlockRegistry();

  try {
    const preFixedContent = fixNestedParagraphs(htmlContent);
    const blocks = parse(preFixedContent);
    // Grammar-level parse of the same content: verbatim comment attrs,
    // untouched by validation fixes or deprecation migrations.
    const rawBlocks = parseBlockGrammar(preFixedContent);

    const fixedIssues = [];
    const collectIssues = (blockList) => {
      for (const block of blockList) {
        if (!block.isValid) {
          const blockName = block.name || 'unknown';
          const blockIssues = block.validationIssues || [];
          if (blockIssues.length > 0) {
            for (const i of blockIssues) {
              let msg;
              if (typeof i === 'string') {
                msg = i;
              } else if (typeof i.message === 'string') {
                msg = i.message;
              } else if (Array.isArray(i.args) && typeof i.args[0] === 'string') {
                const template = i.args[0];
                const values = i.args.slice(1).map((v) => {
                  if (typeof v === 'string') return v;
                  if (Array.isArray(v) && v.every(Array.isArray)) {
                    return '[' + v.map((attr) => attr[0]).join(', ') + ']';
                  }
                  if (typeof v === 'object' && v !== null) return '{...}';
                  return String(v);
                });
                msg = template;
                values.forEach((v) => {
                  msg = msg.replace(/%[os]/, v);
                });
              } else {
                msg = JSON.stringify(i);
              }
              fixedIssues.push(`${blockName}: ${msg}`);
            }
          } else {
            fixedIssues.push(`${blockName}: Block marked as invalid`);
          }
        }
        if (block.innerBlocks && block.innerBlocks.length > 0) {
          collectIssues(block.innerBlocks);
        }
      }
    };
    collectIssues(blocks);

    let rawIndex = 0;
    const fixedBlocks = blocks.map((block) => {
      while (
        rawIndex < rawBlocks.length &&
        rawBlocks[rawIndex].blockName !== block.name
      ) {
        rawIndex++;
      }
      const rawBlock =
        rawIndex < rawBlocks.length ? rawBlocks[rawIndex++] : undefined;
      return fixBlockRecursively(block, rawBlock).block;
    });

    let fixedHtml = serialize(fixedBlocks);

    const beforeParaFix = fixedHtml;
    fixedHtml = fixNestedParagraphs(fixedHtml);
    if (preFixedContent !== htmlContent || fixedHtml !== beforeParaFix) {
      fixedIssues.push('core/paragraph: Nested paragraph tags detected and removed');
    }

    const wasChanged = fixedHtml !== preFixedContent;

    if (fixedIssues.length > 0) {
      console.error(`[BlockFixer] Found ${fixedIssues.length} invalid block(s)`);
      for (const issue of fixedIssues) {
        console.error(`  - ${issue}`);
      }
    }

    if (wasChanged) {
      console.error(`[BlockFixer] HTML normalized (re-serialized ${blocks.length} block(s))`);
    }

    return {
      html: fixedHtml,
      changed: wasChanged,
      fixedIssues,
    };
  } catch (error) {
    console.error('[BlockFixer] Error fixing blocks:', error);
    return {
      html: htmlContent,
      changed: false,
      fixedIssues: [],
    };
  }
}

module.exports = {
  initializeBlockRegistry,
  fixBlocksInTemplate,
  fixNestedParagraphs,
};
