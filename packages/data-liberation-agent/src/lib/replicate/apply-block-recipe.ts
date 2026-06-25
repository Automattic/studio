import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { AdapterBlocks, BlockRecipe, BlockRecipeContext } from '../../adapters/page-actions.js';
import { sanitize } from './html-fallback.js';
import { genericBlockCatalog } from './generic-block-catalog.js';
import { PIPELINE_ISLAND_OPENER } from '../wordpress/block-policy.js';

/**
 * Seam 2: turn platform-structured source HTML into Gutenberg block markup via
 * the adapter's declared recipe. Order: whole-body htmlToBlocks first, then the
 * recipes table. Returns null when the adapter has no blocks capability or
 * produced nothing — the caller falls through to the generic renderer / core/html
 * floor (nothing is ever dropped). Called ONLY on the blocks reconstruct path.
 */
export function applyBlockRecipe(html: string, blocks: AdapterBlocks | undefined, ctx: BlockRecipeContext): string | null {
  if (blocks?.htmlToBlocks) {
    const out = blocks.htmlToBlocks(html, ctx);
    if (out != null && out.trim()) return out;
  }
  if (blocks?.recipes && blocks.recipes.length > 0) {
    const out = composeFromRecipes(html, blocks.recipes, ctx);
    if (out != null && out.trim()) return out;
  }
  // Universal generic catalog — last attempt before the caller's core/html floor.
  // Runs even when the adapter declares no blocks, so every adapter benefits.
  const generic = genericBlockCatalog.htmlToBlocks!(html, ctx);
  if (generic != null && generic.trim()) return generic;
  return null;
}

function composeFromRecipes(html: string, recipes: BlockRecipe[], ctx: BlockRecipeContext): string | null {
  // Idempotency guard: already-blockified content (e.g. a second blockify run)
  // would otherwise have its bare elements re-wrapped as core/html islands,
  // losing block semantics. Block comments aren't matched by the table, so skip.
  if (/<!--\s*wp:/.test(html)) return null;
  const $ = cheerio.load(html, null, false);
  const out: string[] = [];
  $.root().children().each((_, node) => {
    if ((node as Element).type !== 'tag') return;
    const el = node as Element;
    const recipe = recipes.find((r) => $(el).is(r.match));
    out.push(recipe ? emitRecipeBlock($, el, recipe, ctx) : coreHtmlIsland($.html(el)));
  });
  const result = out.filter((b) => b && b.trim());
  return result.length ? result.join('\n\n') : null;
}

/** Strip the `core/` namespace prefix for core blocks — WP serialises them as `<!-- wp:heading -->`, not `<!-- wp:core/heading -->`. */
function blockTag(block: string): string {
  return block.startsWith('core/') ? block.slice('core/'.length) : block;
}

function emitRecipeBlock($: CheerioAPI, el: Element, recipe: BlockRecipe, ctx: BlockRecipeContext): string {
  const tag = blockTag(recipe.block);
  // Escape `-->` inside attr JSON per WP block-comment serialization — a value
  // containing `-->` would otherwise close the comment early and corrupt markup.
  const attrs = recipe.attrs && Object.keys(recipe.attrs).length ? ` ${JSON.stringify(recipe.attrs).replace(/-->/g, '--\\u003e')}` : '';
  const open = `<!-- wp:${tag}${attrs} -->`;
  const close = `<!-- /wp:${tag} -->`;
  const mode = recipe.inner ?? 'innerHtml';
  const $el = $(el);
  if (recipe.block === 'core/image' || mode === 'images') {
    const img = $el.is('img') ? $el : $el.find('img').first();
    const rawSrc = img.attr('src') || '';
    // No <img> under a core/image match → don't emit a broken src=""; keep the
    // element losslessly as a core/html island instead.
    if (!rawSrc) return coreHtmlIsland($.html(el));
    const src = ctx.mediaMap?.[rawSrc] ?? rawSrc;
    return `${open}\n<figure class="wp-block-image"><img src="${escapeAttr(src)}" alt="${escapeAttr(img.attr('alt') || '')}"/></figure>\n${close}`;
  }
  if (mode === 'drop') return `${open}\n${close}`;
  const inner = mode === 'text' ? escapeHtml($el.text().trim()) : ($el.html() ?? '');
  return `${open}\n${inner}\n${close}`;
}

// Strip active/unsafe content (script/style/php/comments/on*) before wrapping
// raw source HTML in a core/html island — matches buildHtmlFallbackBlock (same
// sanitize, same PIPELINE_ISLAND_OPENER marker) so a recipe island degrades
// gracefully instead of failing the whole page at the gate, and passes the
// install-time wp:html ban on theme reinstall.
function coreHtmlIsland(html: string): string { return `${PIPELINE_ISLAND_OPENER}\n${sanitize(html)}\n<!-- /wp:html -->`; }
import { escapeHtmlText as escapeHtml, escapeHtmlAttr as escapeAttr } from '../html-escape.js';
