//
// Heuristic block transformer
// ===========================
// Pure function that recognises trivially-structured pages and emits valid
// WP block markup directly, sidestepping the AI compose path. Returning
// `{handled: false}` means "I'm not sure" — the caller falls through to the
// AI skill.
//
// Confidence floor: heuristic only claims `handled: true` when EVERY visible
// element fits one of the recognised shapes. Any unexpected element type
// (lists, tables, sections, divs with classes, custom elements, etc.) flips
// to `handled: false`.
//
// Recognised shapes (calibrated for the first eval pass):
//   1. Pure text page — only `<p>` and `<h2>`/`<h3>` elements.
//      Heading levels stay 2-3; we don't synthesise `<h1>` here because
//      `post_content` shouldn't repeat the post title.
//   2. Single image followed by paragraphs — leading `<img>` (or
//      `<figure><img></figure>`) then 1+ paragraphs.
//   3. Single section with a heading + text — one `<section>` containing
//      one `<h2>`/`<h3>` and 1+ paragraphs.
//
// Any other shape returns `{handled: false}`.
//

import * as cheerio from 'cheerio';

export interface HeuristicResult {
  handled: boolean;
  blocks?: string;
  /** Internal — surfaced for debugging / audit logs. */
  reason?: string;
}

const ALLOWED_TEXTISH = new Set(['p', 'h2', 'h3']);

import { escapeHtmlText as escapeHtml } from '../html-escape.js';

function paragraphBlock(html: string): string {
  return `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`;
}

function headingBlock(level: 2 | 3, html: string): string {
  const attrs = level === 2 ? '' : ` {"level":${level}}`;
  return `<!-- wp:heading${attrs} -->\n<h${level} class="wp-block-heading">${html}</h${level}>\n<!-- /wp:heading -->`;
}

function imageBlock(src: string, alt: string): string {
  const escapedSrc = escapeHtml(src);
  const escapedAlt = escapeHtml(alt);
  return `<!-- wp:image -->\n<figure class="wp-block-image"><img src="${escapedSrc}" alt="${escapedAlt}"/></figure>\n<!-- /wp:image -->`;
}

function groupBlock(inner: string): string {
  return `<!-- wp:group -->\n<div class="wp-block-group">\n${inner}\n</div>\n<!-- /wp:group -->`;
}

interface SimpleEl {
  tag: string;
  innerHtml: string;
  attrs: Record<string, string>;
  childTags: string[];
}

/**
 * Wrap input in a synthetic body so cheerio's `*` traversal sees the input
 * as siblings even when the user passed a fragment without a wrapping element.
 */
function topLevelChildren(html: string): SimpleEl[] {
  const $ = cheerio.load(`<body>${html}</body>`);
  const body = $('body').first();
  const elements: SimpleEl[] = [];
  body.contents().each((_, node) => {
    if (node.type === 'tag') {
      const $node = $(node);
      const attrs: Record<string, string> = {};
      const tagAttrs = (node as { attribs?: Record<string, string> }).attribs ?? {};
      for (const [k, v] of Object.entries(tagAttrs)) attrs[k] = v;
      const childTags: string[] = [];
      $node.children().each((__, c) => {
        if (c.type === 'tag') childTags.push((c as { tagName: string }).tagName.toLowerCase());
      });
      elements.push({
        tag: (node as { tagName: string }).tagName.toLowerCase(),
        innerHtml: $node.html() ?? '',
        attrs,
        childTags,
      });
    } else if (node.type === 'text') {
      const text = (node as { data: string }).data ?? '';
      if (text.trim()) {
        elements.push({ tag: '#textnode', innerHtml: text, attrs: {}, childTags: [] });
      }
    }
  });
  return elements;
}

interface ImageInfo {
  src: string;
  alt: string;
}

/** Parse a `<figure>` element to recognize a `<figure><img></figure>` (with optional <figcaption>). */
function pickFigureImage(figureInnerHtml: string): ImageInfo | null {
  const $ = cheerio.load(`<body>${figureInnerHtml}</body>`);
  const body = $('body').first();
  const childEls: Array<{ tag: string; src: string; alt: string }> = [];
  body.contents().each((_, node) => {
    if (node.type === 'tag') {
      const tagName = (node as { tagName: string }).tagName.toLowerCase();
      if (tagName === 'img' || tagName === 'figcaption') {
        const $n = $(node);
        childEls.push({
          tag: tagName,
          src: $n.attr('src') ?? '',
          alt: $n.attr('alt') ?? '',
        });
      } else {
        childEls.push({ tag: tagName, src: '', alt: '' });
      }
    }
  });
  const hasOnlyAllowed = childEls.every((c) => c.tag === 'img' || c.tag === 'figcaption');
  const img = childEls.find((c) => c.tag === 'img');
  if (!hasOnlyAllowed || !img) return null;
  return { src: img.src, alt: img.alt };
}

function pickLeadingImage(el: SimpleEl): ImageInfo | null {
  if (el.tag === 'img') {
    return { src: el.attrs.src ?? '', alt: el.attrs.alt ?? '' };
  }
  if (el.tag === 'figure') {
    return pickFigureImage(el.innerHtml);
  }
  return null;
}

function textishToBlock(el: SimpleEl): string {
  const inner = el.innerHtml.trim();
  if (el.tag === 'p') return paragraphBlock(inner);
  if (el.tag === 'h2') return headingBlock(2, inner);
  if (el.tag === 'h3') return headingBlock(3, inner);
  return paragraphBlock(escapeHtml(inner));
}

/**
 * Try to compose blocks from the input HTML using the trivial-shape rules
 * above. Returns `{handled: false}` whenever the structure isn't a perfect
 * match — the AI path will run instead.
 */
export function heuristicBlocks(html: string): HeuristicResult {
  if (!html || !html.trim()) {
    return { handled: false, reason: 'empty input' };
  }

  const children = topLevelChildren(html);
  if (children.length === 0) {
    return { handled: false, reason: 'no structured children' };
  }

  // Stray text directly between top-level blocks is unusual and risky to
  // synthesize — bail.
  if (children.some((c) => c.tag === '#textnode')) {
    return { handled: false, reason: 'top-level stray text' };
  }

  // Shape 3: single <section> with heading + paragraphs → wrap in wp:group
  if (children.length === 1 && children[0].tag === 'section') {
    const inner = topLevelChildren(children[0].innerHtml);
    const allTextish = inner.every((c) => ALLOWED_TEXTISH.has(c.tag));
    const hasHeading = inner.some((c) => c.tag === 'h2' || c.tag === 'h3');
    if (allTextish && hasHeading && inner.length > 0) {
      const innerBlocks = inner.map((c) => textishToBlock(c)).join('\n\n');
      return { handled: true, blocks: groupBlock(innerBlocks), reason: 'section-with-heading' };
    }
    return { handled: false, reason: 'section is not pure heading+paragraphs' };
  }

  // Shape 2: leading image (raw <img> or <figure><img>) followed by paragraphs
  const leadingImage = pickLeadingImage(children[0]);
  if (leadingImage) {
    const rest = children.slice(1);
    const restAllParagraphs = rest.every((c) => c.tag === 'p');
    if (restAllParagraphs && rest.length > 0) {
      const blocks = [imageBlock(leadingImage.src, leadingImage.alt)];
      for (const p of rest) blocks.push(paragraphBlock(p.innerHtml.trim()));
      return { handled: true, blocks: blocks.join('\n\n'), reason: 'image+paragraphs' };
    }
    return { handled: false, reason: 'leading image not followed by paragraphs only' };
  }

  // Shape 1: pure paragraphs / h2 / h3
  const allTextish = children.every((c) => ALLOWED_TEXTISH.has(c.tag));
  if (allTextish) {
    return {
      handled: true,
      blocks: children.map((c) => textishToBlock(c)).join('\n\n'),
      reason: 'paragraphs+headings',
    };
  }

  return { handled: false, reason: 'mixed structure outside heuristic shapes' };
}
