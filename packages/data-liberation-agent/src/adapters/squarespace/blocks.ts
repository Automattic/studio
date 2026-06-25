/**
 * Convert Squarespace 7.1 block HTML to Gutenberg block markup.
 *
 * Squarespace's per-post `item.body` is a deeply-nested layout of
 * `<div class="sqs-layout"><div class="row"><div class="col"><div class="sqs-block …">`
 * containing the actual content. When this HTML is dropped into a WordPress
 * post body as-is, the block editor wraps the whole thing in a single Classic
 * block: the user can read the post but can't edit individual images, can't
 * use core's gallery lightbox, and can't reorder blocks without first
 * "Converting to blocks" (which produces messy output).
 *
 * This module walks the Squarespace HTML, recognises each `sqs-block` variant,
 * and emits the equivalent Gutenberg block markup so the import lands as
 * proper, editable blocks. Recognised mappings:
 *
 *   | Squarespace class                                | Emitted Gutenberg block             |
 *   | ------------------------------------------------ | ----------------------------------- |
 *   | `sqs-block image-block`                          | `core/image`                        |
 *   | `sqs-block gallery-block`                        | `core/gallery` (linkTo:media)       |
 *   | `sqs-block html-block`                           | `core/paragraph` / `core/heading` / |
 *   |                                                  | `core/list` / `core/quote`          |
 *   | `sqs-block embed-block` / `video-block`          | `core/embed`                        |
 *   | `sqs-block quote-block`                          | `core/quote`                        |
 *   | `sqs-block horizontal-rule-block` / `line-block` | `core/separator`                    |
 *   | `sqs-block spacer-block`                         | dropped (Gutenberg handles spacing) |
 *   | unrecognised `sqs-block …`                       | `core/html` (lossless fallback)     |
 *
 * The output is safe to drop into `<content:encoded>` in a WXR file: WordPress
 * will recognise the `<!-- wp:* -->` delimiters during import and create
 * editable blocks. When the input doesn't contain any `sqs-block` markers the
 * function returns null so this is safe to call on every body.
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import type { AdapterBlocks, BlockRecipeContext } from '../page-actions.js';
import { sanitize } from '../../lib/replicate/html-fallback.js';
import { buildEmbedBlock } from '../../lib/replicate/embed-block.js';
import { PIPELINE_ISLAND_OPENER } from '../../lib/wordpress/block-policy.js';

const SQS_BLOCK_MARKER = /\bsqs-block\b/;

/** Public entry point — fires at reconstruct time, not extraction time. */
function squarespaceHtmlToGutenberg(html: string, _ctx: BlockRecipeContext): string | null {
  if (!html || !SQS_BLOCK_MARKER.test(html)) return null;
  const $ = cheerio.load(html, null, false);
  const out: string[] = [];

  // Walk every top-level `sqs-block` element in document order. A "top-level"
  // sqs-block is one whose ancestor chain has no other sqs-block — i.e. it
  // doesn't sit inside another block.
  $('.sqs-block').each((_, el) => {
    const node = $(el);
    if (node.parents('.sqs-block').length > 0) return;
    const block = convertSqsBlock($, node);
    if (block) out.push(block);
  });

  if (out.length === 0) return null;
  return out.join('\n\n');
}

function convertSqsBlock($: CheerioAPI, node: Cheerio<Element>): string | null {
  const classAttr = node.attr('class') || '';
  if (/\bimage-block\b/.test(classAttr)) return emitImage($, node);
  if (/\bgallery-block\b/.test(classAttr)) return emitGallery($, node);
  if (/\b(?:embed-block|video-block)\b/.test(classAttr)) return emitEmbed($, node);
  if (/\bquote-block\b/.test(classAttr)) return emitQuote($, node);
  if (/\b(?:horizontal-rule-block|line-block)\b/.test(classAttr)) {
    return '<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->';
  }
  if (/\bspacer-block\b/.test(classAttr)) return null;
  if (/\bhtml-block\b/.test(classAttr)) return emitHtmlBlock($, node);
  return emitFallback($, node);
}

function pickImage(node: Cheerio<Element>): { src: string; alt: string; caption: string } | null {
  const img = node.find('img').first();
  if (img.length === 0) return null;
  const dataImage = img.attr('data-image') || img.attr('data-src') || '';
  const src = /^https?:\/\//.test(dataImage) ? dataImage : (img.attr('src') || '');
  if (!src) return null;
  const alt = (img.attr('alt') || '').trim();
  const figcap = node.find('figcaption, .image-caption-wrapper').first();
  const caption = figcap.length ? figcap.text().trim() : '';
  return { src, alt, caption };
}

function emitImage(_$: CheerioAPI, node: Cheerio<Element>): string | null {
  const pick = pickImage(node);
  if (!pick) return null;
  const inner = pick.caption
    ? `<figure class="wp-block-image size-large"><img src="${escapeAttr(pick.src)}" alt="${escapeAttr(pick.alt)}"/><figcaption class="wp-element-caption">${escapeHtml(pick.caption)}</figcaption></figure>`
    : `<figure class="wp-block-image size-large"><img src="${escapeAttr(pick.src)}" alt="${escapeAttr(pick.alt)}"/></figure>`;
  return `<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->\n${inner}\n<!-- /wp:image -->`;
}

function emitGallery($: CheerioAPI, node: Cheerio<Element>): string | null {
  const items: Array<{ src: string; alt: string }> = [];
  node.find('img').each((_, im) => {
    const img = $(im);
    const dataImage = img.attr('data-image') || img.attr('data-src') || '';
    const src = /^https?:\/\//.test(dataImage) ? dataImage : (img.attr('src') || '');
    if (!src) return;
    items.push({ src, alt: (img.attr('alt') || '').trim() });
  });
  if (items.length === 0) return null;

  const inner: string[] = [];
  for (const it of items) {
    inner.push(
      `<!-- wp:image {"sizeSlug":"large","linkDestination":"media"} -->\n` +
      `<figure class="wp-block-image size-large"><a href="${escapeAttr(it.src)}"><img src="${escapeAttr(it.src)}" alt="${escapeAttr(it.alt)}"/></a></figure>\n` +
      `<!-- /wp:image -->`
    );
  }
  return `<!-- wp:gallery {"linkTo":"media"} -->\n<figure class="wp-block-gallery has-nested-images">\n${inner.join('\n')}\n</figure>\n<!-- /wp:gallery -->`;
}

function emitEmbed(_$: CheerioAPI, node: Cheerio<Element>): string | null {
  const iframe = node.find('iframe').first();
  const url = iframe.attr('src') || node.find('a[href]').first().attr('href') || '';
  if (!/^https?:\/\//.test(url)) return null;
  // Provider detection + embed markup are shared with the generic block catalog
  // (src/lib/replicate/embed-block.ts) so coverage stays in one place.
  return buildEmbedBlock(url);
}

function emitQuote(_$: CheerioAPI, node: Cheerio<Element>): string | null {
  const text = node.find('blockquote, .quote-content, p').first().text().trim();
  if (!text) return null;
  const cite = node.find('cite, .source').first().text().trim();
  const inner = cite
    ? `<blockquote class="wp-block-quote"><p>${escapeHtml(text)}</p><cite>${escapeHtml(cite)}</cite></blockquote>`
    : `<blockquote class="wp-block-quote"><p>${escapeHtml(text)}</p></blockquote>`;
  return `<!-- wp:quote -->\n${inner}\n<!-- /wp:quote -->`;
}

function emitHtmlBlock($: CheerioAPI, node: Cheerio<Element>): string | null {
  const inner = node.find('.html-block-html').first().length
    ? node.find('.html-block-html').first()
    : node;
  const out: string[] = [];
  inner.children().each((_, el) => {
    const tag = (el.tagName || '').toLowerCase();
    const $el = $(el);
    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag.slice(1), 10);
      const text = $el.html() || '';
      out.push(`<!-- wp:heading {"level":${level}} -->\n<${tag}>${text}</${tag}>\n<!-- /wp:heading -->`);
    } else if (tag === 'ul' || tag === 'ol') {
      const ordered = tag === 'ol';
      const items: string[] = [];
      $el.children('li').each((_, li) => {
        items.push(`<!-- wp:list-item -->\n<li>${$(li).html() || ''}</li>\n<!-- /wp:list-item -->`);
      });
      const wrapper = ordered ? '<ol>' : '<ul>';
      const closer  = ordered ? '</ol>' : '</ul>';
      out.push(`<!-- wp:list${ordered ? ' {"ordered":true}' : ''} -->\n${wrapper}\n${items.join('\n')}\n${closer}\n<!-- /wp:list -->`);
    } else if (tag === 'blockquote') {
      out.push(`<!-- wp:quote -->\n<blockquote class="wp-block-quote">${$el.html() || ''}</blockquote>\n<!-- /wp:quote -->`);
    } else if (tag === 'hr') {
      out.push('<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->');
    } else if (tag === 'p') {
      const innerHtml = ($el.html() || '').trim();
      if (innerHtml) out.push(`<!-- wp:paragraph -->\n<p>${innerHtml}</p>\n<!-- /wp:paragraph -->`);
    } else {
      // Pipeline-marked island (same opener as buildHtmlFallbackBlock) so the
      // degraded element passes the install-time wp:html ban on theme reinstall.
      out.push(`${PIPELINE_ISLAND_OPENER}\n${sanitize($.html(el))}\n<!-- /wp:html -->`);
    }
  });
  if (out.length === 0) {
    const text = inner.text().trim();
    if (text) out.push(`<!-- wp:paragraph -->\n<p>${escapeHtml(text)}</p>\n<!-- /wp:paragraph -->`);
  }
  return out.length ? out.join('\n\n') : null;
}

function emitFallback($: CheerioAPI, node: Cheerio<Element>): string | null {
  const inner = $.html(node);
  if (!inner.trim()) return null;
  return `${PIPELINE_ISLAND_OPENER}\n${sanitize(inner)}\n<!-- /wp:html -->`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

import { escapeHtmlText as escapeHtml } from '../../lib/html-escape.js';

export const blocks: AdapterBlocks = { htmlToBlocks: squarespaceHtmlToGutenberg };
