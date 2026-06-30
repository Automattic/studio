// src/lib/replicate/generic-block-catalog.ts
//
// Generic, platform-agnostic content->blocks catalog.
// ==================================================
// Recognises common semantic WRAPPERS that WP's rawHandler flattens to
// core/html (accordion, callout/card, media-text, pullquote, button groups) and
// emits the equivalent native block. Runs on the blocks reconstruct path as the
// last attempt before the core/html floor (see apply-block-recipe.ts), so every
// adapter — and the default fallback — benefits, at both firing points
// (per-section reconstruct + bulk WXR bodies).
//
// Lossless: the body is only "claimed" when at least one wrapper converts;
// otherwise we return null and the caller's existing path owns the markup
// unchanged. Unmatched siblings of a matched wrapper degrade to core/html
// islands (same contract as composeFromRecipes), so nothing is ever dropped.

import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import type { AdapterBlocks, BlockRecipeContext } from '../../adapters/page-actions.js';
import { sanitize } from '@automattic/blocks-engine/theme';
import { guessEmbedProvider, buildEmbedBlock } from './embed-block.js';
import { PIPELINE_ISLAND_OPENER } from '../wordpress/block-policy.js';

interface Converted {
  matched: boolean;
  markup: string;
}

function genericHtmlToBlocks(html: string, ctx: BlockRecipeContext): string | null {
  if (!html || !html.trim()) return null;
  // Idempotency guard: never re-wrap already-blockified content.
  if (/<!--\s*wp:/.test(html)) return null;

  const $ = cheerio.load(html, null, false);
  const out: string[] = [];
  let matchedAny = false;

  $.root().children().each((_, node) => {
    if ((node as Element).type !== 'tag') return;
    const el = node as Element;
    const c = convertElement($, el, ctx);
    if (c.matched) matchedAny = true;
    if (c.markup.trim()) out.push(c.markup);
  });

  if (!matchedAny) return null; // claim nothing unless we recognized a wrapper
  return out.length ? out.join('\n\n') : null;
}

function convertElement($: CheerioAPI, el: Element, ctx: BlockRecipeContext): Converted {
  // Embeds run first: a provider iframe is often wrapped in a figure/div that a
  // later recipe (callout/media-text) could otherwise mis-claim.
  const embed = tryEmbed($, el);
  if (embed) return { matched: true, markup: embed };
  const details = tryDetails($, el, ctx);
  if (details) return { matched: true, markup: details };
  const detailsPairs = tryDetailsPairs($, el, ctx);
  if (detailsPairs) return { matched: true, markup: detailsPairs };
  const callout = tryCallout($, el, ctx);
  if (callout) return { matched: true, markup: callout };
  const pull = tryPullquote($, el);
  if (pull) return { matched: true, markup: pull };
  const buttons = tryButtons($, el);
  if (buttons) return { matched: true, markup: buttons };
  const mediaText = tryMediaText($, el, ctx);
  if (mediaText) return { matched: true, markup: mediaText };
  return { matched: false, markup: coreHtmlIsland($.html(el)) };
}

// --- provider iframe -> core/embed -------------------------------------------

const EMBED_WRAPPER_TAGS = new Set(['figure', 'div', 'p', 'span']);

function tryEmbed($: CheerioAPI, el: Element): string | null {
  const $el = $(el);
  let src: string | undefined;

  if (el.tagName === 'iframe') {
    src = $el.attr('src');
  } else if (EMBED_WRAPPER_TAGS.has(el.tagName)) {
    const iframes = $el.find('iframe');
    if (iframes.length !== 1) return null;
    // Only claim a thin wrapper around the iframe. If the wrapper carries its
    // own text (e.g. a paragraph that merely contains an iframe), leave it for
    // the caller so nothing is swallowed.
    const clone = $el.clone();
    clone.find('iframe').remove();
    if (clone.text().trim()) return null;
    src = iframes.first().attr('src');
  } else {
    return null;
  }

  if (!src || !/^https?:\/\//i.test(src)) return null;
  // Known providers only: an unrecognised iframe is left untouched so the
  // working embed survives (as a core/html island) rather than becoming a
  // broken oEmbed that resolves to nothing.
  if (!guessEmbedProvider(src)) return null;
  return buildEmbedBlock(src);
}

// --- details / accordion -> core/details -------------------------------------

function tryDetails($: CheerioAPI, el: Element, ctx: BlockRecipeContext): string | null {
  const $el = $(el);
  const isDetails = el.tagName === 'details';
  const isAccordionClass = /\b(accordion|faq-item)\b/.test($el.attr('class') || '');
  if (!isDetails && !isAccordionClass) return null;

  const summary =
    $el.find('summary').first().text().trim() ||
    $el.children('h1,h2,h3,h4,h5,h6,.accordion-title,.faq-question').first().text().trim();
  if (!summary) return null;

  // Body = everything except the summary/title node, recursed through the walk.
  const bodyHtml = bodyExcludingSummary($, $el);
  const inner = recurseInner(bodyHtml, ctx);
  return (
    `<!-- wp:details -->\n` +
    `<details class="wp-block-details"><summary>${escapeHtml(summary)}</summary>${inner}</details>\n` +
    `<!-- /wp:details -->`
  );
}

function bodyExcludingSummary($: CheerioAPI, $el: Cheerio<Element>): string {
  const clone = $el.clone();
  clone.find('summary').first().remove();
  clone.children('h1,h2,h3,h4,h5,h6,.accordion-title,.faq-question').first().remove();
  return clone.html() ?? '';
}

/** Recurse the catalog over inner HTML; fall back to a sanitized passthrough. */
function recurseInner(html: string, ctx: BlockRecipeContext): string {
  const nested = genericHtmlToBlocks(html, ctx);
  if (nested && nested.trim()) return `\n${nested}\n`;
  const clean = sanitize(html).trim();
  return clean ? clean : '';
}

// --- heading + hidden-content pairs -> core/details (BDC ladder) -------------
//
// Disclosure evidence is REQUIRED: every content node must be hidden ([hidden],
// aria-hidden="true", or display:none) — a visible heading+div pair is normal
// page structure, and claiming it would change appearance. All headings must
// pair (no orphans), so partial matches fall through untouched.

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function isHiddenContent($: CheerioAPI, el: Element): boolean {
  const $el = $(el);
  return (
    $el.attr('hidden') !== undefined ||
    $el.attr('aria-hidden') === 'true' ||
    /display\s*:\s*none/.test($el.attr('style') ?? '')
  );
}

function tryDetailsPairs($: CheerioAPI, el: Element, ctx: BlockRecipeContext): string | null {
  const kids = $(el).children().toArray();
  if (kids.length < 2 || kids.length % 2 !== 0) return null;
  const pairs: Array<{ summary: string; bodyHtml: string }> = [];
  for (let i = 0; i < kids.length; i += 2) {
    const head = kids[i];
    const body = kids[i + 1];
    if (!HEADING_TAGS.has(head.tagName)) return null;
    if (HEADING_TAGS.has(body.tagName) || !isHiddenContent($, body)) return null;
    const summary = $(head).text().trim();
    if (!summary) return null;
    pairs.push({ summary, bodyHtml: $(body).html() ?? '' });
  }
  if (pairs.length === 0) return null;
  return pairs
    .map(
      (p) =>
        `<!-- wp:details -->\n` +
        `<details class="wp-block-details"><summary>${escapeHtml(p.summary)}</summary>${recurseInner(p.bodyHtml, ctx)}</details>\n` +
        `<!-- /wp:details -->`,
    )
    .join('\n\n');
}

// --- callout / card / notice / alert -> core/group --------------------------

const CALLOUT_RE = /\b(callout|notice|alert|card)\b/;

function tryCallout($: CheerioAPI, el: Element, ctx: BlockRecipeContext): string | null {
  const $el = $(el);
  const cls = $el.attr('class') || '';
  if (!CALLOUT_RE.test(cls)) return null;
  const inner = recurseInner($el.html() ?? '', ctx);
  if (!inner.trim()) return null;
  const matchedClass = (cls.match(CALLOUT_RE) || [])[0] ?? 'callout';
  const className = `wp-block-group is-style-${matchedClass}`;
  return (
    `<!-- wp:group {"className":${JSON.stringify(className)},"layout":{"type":"constrained"}} -->\n` +
    `<div class="${escapeAttr(className)}">${inner}</div>\n` +
    `<!-- /wp:group -->`
  );
}

// --- pullquote -> core/pullquote ---------------------------------------------

function tryPullquote($: CheerioAPI, el: Element): string | null {
  const $el = $(el);
  const cls = $el.attr('class') || '';
  const isPull =
    (el.tagName === 'blockquote' && /\bpull/.test(cls)) ||
    (el.tagName === 'aside' && $el.find('blockquote').length > 0);
  if (!isPull) return null;
  const $quote = $el.is('blockquote') ? $el : $el.find('blockquote').first();
  const text = $quote.find('p').first().text().trim() || $quote.text().trim();
  if (!text) return null;
  const cite = $el.find('cite').first().text().trim();
  const citeHtml = cite ? `<cite>${escapeHtml(cite)}</cite>` : '';
  return (
    `<!-- wp:pullquote -->\n` +
    `<figure class="wp-block-pullquote"><blockquote><p>${escapeHtml(text)}</p>${citeHtml}</blockquote></figure>\n` +
    `<!-- /wp:pullquote -->`
  );
}

// --- button link(s) -> core/buttons ------------------------------------------

const BTN_RE = /\b(button|btn)\b/;

function isButtonLink($: CheerioAPI, el: Element): boolean {
  return el.tagName === 'a' && BTN_RE.test($(el).attr('class') || '') && Boolean($(el).attr('href'));
}

function tryButtons($: CheerioAPI, el: Element): string | null {
  const $el = $(el);
  let links: Element[];
  if (isButtonLink($, el)) {
    links = [el];
  } else {
    links = $el.children('a').toArray().filter((a) => isButtonLink($, a));
    if (links.length === 0) return null;
  }
  const buttonBlocks = links.map((a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    const label = $a.text().trim();
    return (
      `<!-- wp:button -->\n` +
      `<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${escapeAttr(href)}">${escapeHtml(label)}</a></div>\n` +
      `<!-- /wp:button -->`
    );
  });
  return (
    `<!-- wp:buttons -->\n` +
    `<div class="wp-block-buttons">\n${buttonBlocks.join('\n')}\n</div>\n` +
    `<!-- /wp:buttons -->`
  );
}

// --- media + text -> core/media-text -----------------------------------------

const MEDIA_TEXT_RE = /\b(media-text|media-object|image-text|text-image)\b/;
// Structural matching needs LAYOUT EVIDENCE on top of the two-child shape —
// claiming a stacked [image, text] wrapper as media-text would CHANGE the
// layout to side-by-side (BDC ladder: never guess geometry). Evidence = a
// row-ish class name or an inline flex/grid display.
const LAYOUT_HINT_CLASS_RE = /\b(split(?:-\w+)?|two-col(?:umn)?s?|cols?-2|grid|row|flex)\b/;
const LAYOUT_HINT_STYLE_RE = /display\s*:\s*(flex|grid)\b/;

function isMediaChild($: CheerioAPI, el: Element): boolean {
  if (el.tagName === 'img' || el.tagName === 'picture' || el.tagName === 'figure') {
    return $(el).find('img').length > 0 || el.tagName === 'img';
  }
  // An element that is just a thin image holder (one img, no own text).
  return $(el).find('img').length === 1 && !$(el).text().trim();
}

function tryMediaText($: CheerioAPI, el: Element, ctx: BlockRecipeContext): string | null {
  const $el = $(el);
  const classNamed = MEDIA_TEXT_RE.test($el.attr('class') || '');

  // Structural route (BDC ladder): exactly two element children — one media,
  // one text — plus layout evidence; media order decides mediaPosition.
  let mediaOnRight = false;
  if (!classNamed) {
    const kids = $el.children().toArray();
    if (kids.length !== 2) return null;
    const hasLayoutHint =
      LAYOUT_HINT_CLASS_RE.test($el.attr('class') || '') ||
      LAYOUT_HINT_STYLE_RE.test($el.attr('style') || '');
    if (!hasLayoutHint) return null;
    const [first, second] = kids;
    const firstIsMedia = isMediaChild($, first);
    const secondIsMedia = isMediaChild($, second);
    if (firstIsMedia === secondIsMedia) return null; // need exactly one media side
    const textChild = firstIsMedia ? second : first;
    if ($(textChild).find('img').length > 0) return null; // text side must be image-free
    mediaOnRight = secondIsMedia;
  }

  const img = $el.find('img').first();
  if (img.length === 0) return null;
  const rawSrc = img.attr('src') || '';
  if (!rawSrc) return null;
  const src = ctx.mediaMap?.[rawSrc] ?? rawSrc;
  const alt = img.attr('alt') || '';
  const textNode = $el.children().toArray().find((c) => {
    const t = c.tagName;
    return t && t !== 'figure' && t !== 'img' && t !== 'picture' && $(c).find('img').length === 0;
  });
  const textHtml = textNode ? ($(textNode).html() ?? '') : '';
  const innerText =
    recurseInner(textHtml, ctx).trim() ||
    `<!-- wp:paragraph -->\n<p>${escapeHtml($el.text().trim())}</p>\n<!-- /wp:paragraph -->`;
  const attrs = mediaOnRight ? `{"mediaType":"image","mediaPosition":"right"}` : `{"mediaType":"image"}`;
  const cls = `wp-block-media-text is-stacked-on-mobile${mediaOnRight ? ' has-media-on-the-right' : ''}`;
  return (
    `<!-- wp:media-text ${attrs} -->\n` +
    `<div class="${cls}">` +
    `<figure class="wp-block-media-text__media"><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"/></figure>` +
    `<div class="wp-block-media-text__content">${innerText}</div>` +
    `</div>\n` +
    `<!-- /wp:media-text -->`
  );
}

// --- shared helpers ----------------------------------------------------------

// Pipeline-marked island (same opener as buildHtmlFallbackBlock) so degraded
// siblings pass the install-time wp:html ban on theme reinstall.
function coreHtmlIsland(html: string): string {
  return `${PIPELINE_ISLAND_OPENER}\n${sanitize(html)}\n<!-- /wp:html -->`;
}
import { escapeHtmlText as escapeHtml, escapeHtmlAttr as escapeAttr } from '../html-escape.js';

export const genericBlockCatalog: AdapterBlocks = { htmlToBlocks: genericHtmlToBlocks };
