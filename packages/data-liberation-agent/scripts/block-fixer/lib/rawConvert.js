//
// General HTML → native blocks (rawHandler)
// =========================================
// WordPress's paste parser (`@wordpress/blocks` rawHandler) is the general,
// semantic-tag-driven HTML→blocks engine — it reads <h2>/<table>/<blockquote>
// and emits core blocks regardless of source platform. It runs HERE (not in the
// main process) only because @wordpress/blocks needs React 18 while the CLI
// hoists React 19 from Ink — they can't share a process (see block-fixer-client.ts).
//
// Three render-save normalizations precede the parse — they fix HTML that any
// RENDERED page carries, and do NOT read wp-block-* to decide block identity
// (that's rawHandler's tag-driven job):
//   1. Unwrap non-semantic layout/template wrappers — else the whole section
//      collapses into one wp:html.
//   2. Unwrap figure.wp-block-table → bare <table> — the table transform's
//      selector is 'table', so the figure wrapper matches nothing → wp:html;
//      the bare table → clean wp:table.
//   3. Native-emit spacers — core/spacer has no raw transform, so a spacer div
//      → wp:html; we splice a real wp:spacer (source height) after serialize.
//
const { JSDOM } = require('jsdom');
const { rawHandler, serialize } = require('@wordpress/blocks');
const { registerCoreBlocks } = require('@wordpress/block-library');

let initialized = false;
function init() {
  if (initialized) return;
  try {
    registerCoreBlocks();
  } catch (e) {
    console.error('[rawConvert] registerCoreBlocks failed:', e && e.message);
  }
  initialized = true;
}

// Keep in sync with src/lib/replicate/semantic-html.ts (UNWRAP_SELECTOR).
const UNWRAP_SELECTOR =
  'main, div.wp-block-group, div.wp-block-post-content, div.entry-content, div.wp-block-group__inner-container';

function spacerBlock(height) {
  const h = height || '50px';
  return `<!-- wp:spacer {"height":"${h}"} -->\n<div style="height:${h}" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->`;
}

// WordPress post-meta DYNAMIC blocks that rawHandler can't convert from rendered
// HTML (they'd become wp:html residue) and that belong in the post TEMPLATE, not
// post_content. A capture that bundled them into the content section (e.g. a poem
// post carrying its title/date/author/tags/prev-next nav) is stripped here so the
// real content converts native; the replica single.html renders this meta instead.
// Keep in sync with the meta blocks emitted by buildSingleTemplate() in
// src/lib/replicate/theme-scaffold.ts.
const POST_META_CHROME =
  '.wp-block-post-date, .wp-block-post-author, .wp-block-post-author-name, ' +
  '.wp-block-post-author-biography, .wp-block-post-terms, .wp-block-post-navigation-link, ' +
  '.wp-block-post-navigation, .wp-block-template-part, .wp-block-post-comments, .wp-block-comments, ' +
  '.wp-block-post-excerpt, .wp-block-read-more';
// Indicators that a section is a single-POST body (vs a page/home hero): the full
// post-meta set. Used to gate the post-title strip — post-title is duplicated meta
// on a post (single.html renders it) but the load-bearing HERO HEADING on the home
// front page (front-page.html renders no title), so it must only be stripped on posts.
const POST_BODY_SIGNAL =
  '.wp-block-post-date, .wp-block-post-author-name, .wp-block-post-terms, .wp-block-post-navigation-link';

function preprocess(html) {
  const d = new JSDOM(`<body>${html}</body>`).window.document.body;
  // 0. Strip post-meta dynamic-block chrome — it's template-level meta, not content,
  //    and rawHandler can't convert it (→ wp:html residue). The replica single.html
  //    renders this meta instead.
  // 0a. Detect a single-post body BEFORE removing anything (the signal blocks get
  //     stripped below, so the check must come first).
  const isPostBody = !!d.querySelector(POST_BODY_SIGNAL);
  // 0b. The prev/next post-navigation wrapper is a <nav> holding post-navigation-link
  //     blocks. Target it precisely (a content <nav> — should it ever appear — survives).
  for (const nav of [...d.querySelectorAll('nav')]) {
    if (nav.querySelector('.wp-block-post-navigation-link')) nav.remove();
  }
  // 0c. post-title only on a post body (see POST_BODY_SIGNAL) — never on the home hero.
  if (isPostBody) for (const el of [...d.querySelectorAll('.wp-block-post-title')]) el.remove();
  // 0d. The rest of the post-meta chrome (unambiguous on any context).
  for (const el of [...d.querySelectorAll(POST_META_CHROME)]) el.remove();
  // 1. Unwrap non-semantic wrappers, repeatedly, until stable (NOT spacers).
  let changed = true;
  while (changed) {
    changed = false;
    for (const el of [...d.querySelectorAll(UNWRAP_SELECTOR)]) {
      if (el.classList.contains('wp-block-spacer')) continue;
      while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
      el.remove();
      changed = true;
    }
  }
  // 2. Unwrap figure.wp-block-table → bare <table>.
  for (const fig of [...d.querySelectorAll('figure.wp-block-table')]) {
    const table = fig.querySelector('table');
    if (table) fig.parentNode.replaceChild(table, fig);
  }
  // 3. Replace spacers with sentinel paragraphs spliced back post-serialize.
  const spacers = [];
  for (const sp of [...d.querySelectorAll('.wp-block-spacer')]) {
    const m = (sp.getAttribute('style') || '').match(/height:\s*([0-9.]+px)/);
    spacers.push(m ? m[1] : '50px');
    const marker = d.ownerDocument.createElement('p');
    marker.textContent = `@@SPACER_${spacers.length - 1}@@`;
    sp.parentNode.replaceChild(marker, sp);
  }
  return { html: d.innerHTML, spacers };
}

/**
 * Convert one section's (already-sanitized) HTML into native block markup.
 * Returns { html, wpHtmlResidue }. Never throws — on parser error returns
 * { html: '', wpHtmlResidue: Infinity } so the caller falls back.
 */
function convertHtmlToBlocks(sectionHtml) {
  if (!sectionHtml || !sectionHtml.trim()) return { html: '', wpHtmlResidue: 0 };
  init();
  try {
    const { html, spacers } = preprocess(sectionHtml);
    let markup = serialize(rawHandler({ HTML: html }));
    markup = markup.replace(
      /<!-- wp:paragraph -->\s*<p>@@SPACER_(\d+)@@<\/p>\s*<!-- \/wp:paragraph -->/g,
      (_, i) => spacerBlock(spacers[+i]),
    );
    if (markup.includes('@@SPACER_')) {
      console.error('[rawConvert] spacer sentinel survived serialization — forcing fallback');
      return { html: '', wpHtmlResidue: Infinity };
    }
    const wpHtmlResidue = (markup.match(/<!-- wp:html/g) || []).length;
    return { html: markup, wpHtmlResidue };
  } catch (e) {
    console.error('[rawConvert] convert failed:', e && e.message);
    return { html: '', wpHtmlResidue: Infinity };
  }
}

module.exports = { convertHtmlToBlocks };
