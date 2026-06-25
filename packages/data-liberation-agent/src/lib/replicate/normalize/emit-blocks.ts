// src/lib/replicate/normalize/emit-blocks.ts
import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import { isTag, isText } from 'domhandler';
import type { Element } from 'domhandler';
import type { ModalBehavior, Section, SliderBehavior, TabsBehavior } from '../local-site/types.js';
import { InstanceStyleSheet } from './instance-styles.js';
import { emitJetpackForm } from './jetpack-form.js';

import { escapeHtmlAttr as escapeHtml } from '../../html-escape.js';
export { escapeHtml };

/** JSON-encode a block-attribute string with WP's '--' escaping so values can
 * never terminate the surrounding block comment. Shared by all emitters. */
export function attrJson(value: string): string {
  return JSON.stringify(value).replace(/--/g, '\\u002d\\u002d');
}

/** class attr of an element as a single className string ('' when none). */
function classNameOf($el: Cheerio<Element>): string {
  return ($el.attr('class') ?? '').split(/\s+/).filter(Boolean).join(' ');
}

/** Build the {…} attr fragment merging optional className into existing pairs. */
function blockAttrs(pairs: string[], className: string): string {
  const all = className ? [...pairs, `"className":${attrJson(className)}`] : pairs;
  return all.length ? ` {${all.join(',')}}` : '';
}

/** className for an element WITH its per-instance inline style folded in: source
 * classes plus a deterministic `lib-i<hash>` class registered in the sheet when
 * the element has an inline `style=`. The inline style is NEVER emitted as a
 * `style=` attr — @wordpress/blocks canonicalization (the fixer) strips inline
 * style from core blocks (core/heading allows only [class]) and silently drops
 * the source's per-instance design. The lib-i class + carried stylesheet rule
 * is fixer-safe and renders identically. */
function classNameWithInstance($el: Cheerio<Element>, sheet: InstanceStyleSheet): string {
  const base = classNameOf($el);
  const instance = sheet.classFor($el.attr('style'));
  return [base, instance].filter(Boolean).join(' ');
}

/** Wrap RAW (non-block) inner HTML in a core/html block so it can live inside a
 * core/group without the fixer deleting it: core/group expects inner BLOCKS, so
 * raw inline content (kicker span runs, verbatim interactive scaffolding) placed
 * directly inside the group div is "unexpected content" and gets stripped on a
 * fixer/editor pass. core/html is freeform — its content survives verbatim and
 * renders inline on the frontend exactly as authored. Empty inner → '' (an
 * empty group, nothing to wrap). */
function htmlBlock(inner: string): string {
  return inner ? `<!-- wp:html -->\n${inner}\n<!-- /wp:html -->` : '';
}

const HEADING = /^h([1-6])$/;

/** Inline tags preserved verbatim in rich-text content (a keeps only an escaped
 * href; span keeps its class — owned sources use span class hooks like .num /
 * .it as styling anchors, so unwrapping them to bare text drops source styling). */
const INLINE_ALLOWED = new Set(['a', 'strong', 'em', 'b', 'i', 'br', 'span']);

/**
 * Serialize an element's inline content: allowed inline tags kept (anchors
 * keep only an escaped href — other attributes dropped), text nodes escaped,
 * any other tag transparently unwrapped (recursed) so nested allowed tags
 * survive. Links are content ("never lose source content") — a paragraph's
 * <a href> must survive emission, even wrapped in a <span>.
 */
function inlineHtml($: CheerioAPI, el: Element): string {
  let out = '';
  for (const node of $(el).contents().get()) {
    if (isText(node)) {
      out += escapeHtml(node.data);
    } else if (isTag(node)) {
      const tag = node.tagName?.toLowerCase() ?? '';
      if (tag === 'br') {
        out += '<br/>';
        continue;
      }
      const cls = ($(node).attr('class') ?? '').trim();
      const styleA = ($(node).attr('style') ?? '').trim();
      // Keep every allowed inline tag verbatim — INCLUDING a classless, styleless
      // <span>. A bare span looks inert but contextual source selectors target it
      // (`.pull span{color:…}`, `.marquee span{…}`); unwrapping it drops that
      // styling. Spans carrying a class (.num/.it) or inline style are styling
      // anchors and are likewise preserved. Keeping the wrapper never loses nested
      // content — a link inside the span still survives.
      if (INLINE_ALLOWED.has(tag)) {
        const inner = inlineHtml($, node);
        const clsAttr = cls ? ` class="${escapeHtml(cls)}"` : '';
        if (tag === 'a') {
          const href = escapeHtml($(node).attr('href') ?? '');
          out += `<a${clsAttr} href="${href}">${inner}</a>`;
        } else {
          const styleAttr = styleA ? ` style="${escapeHtml(styleA)}"` : '';
          out += `<${tag}${clsAttr}${styleAttr}>${inner}</${tag}>`;
        }
      } else {
        // Transparent unwrap: recurse so nested allowed tags (e.g. a link
        // inside a <span>) survive instead of flattening to bare text.
        out += inlineHtml($, node);
      }
    }
  }
  return out;
}

function imageBlock($: CheerioAPI, imgEl: Element, sheet: InstanceStyleSheet): string {
  const src = escapeHtml($(imgEl).attr('src') ?? '');
  const alt = escapeHtml($(imgEl).attr('alt') ?? '');
  // Fold the img's source class AND its inline style (a background backdrop,
  // aspect-ratio, object-fit…) into the className: classNameWithInstance hashes
  // the inline style into a lib-i class + carried rule. A raw style= attr would
  // be stripped by the fixer (core/image keeps only [class]); the class survives.
  // The rule lands on the wp-block-image figure, which wraps the img tightly, so
  // a carried `background` paints exactly behind the image.
  const cls = classNameWithInstance($(imgEl), sheet);
  const attrs = blockAttrs([], cls);
  const figCls = ['wp-block-image', cls].filter(Boolean).join(' ');
  return `<!-- wp:image${attrs} -->\n<figure class="${escapeHtml(figCls)}"><img src="${src}" alt="${alt}"/></figure>\n<!-- /wp:image -->`;
}

function paragraphBlock(inner: string): string {
  return `<!-- wp:paragraph -->\n<p>${inner}</p>\n<!-- /wp:paragraph -->`;
}

function listItemBlock($: CheerioAPI, li: Element, sheet: InstanceStyleSheet): string {
  const $li = $(li);
  // Preserve the <li> class (+ per-instance inline style) — owned sources hang
  // styling/animation hooks on list items (a .reveal scroll animation); core/
  // list-item carries a className, so the carried CSS keeps matching.
  const cls = classNameWithInstance($li, sheet);
  const attrs = blockAttrs([], cls);
  const clsPart = cls ? ` class="${escapeHtml(cls)}"` : '';
  const nestedLists = $li.children('ul, ol').toArray() as Element[];
  if (nestedLists.length === 0) {
    return `<!-- wp:list-item${attrs} -->\n<li${clsPart}>${inlineHtml($, li).trim()}</li>\n<!-- /wp:list-item -->`;
  }

  const leadingClone = $li.clone();
  leadingClone.children('ul, ol').remove();
  leadingClone.find('button svg').remove();
  const leadingEl = leadingClone.get(0);
  const leading = leadingEl && isTag(leadingEl) ? inlineHtml($, leadingEl).trim() : '';
  const nested = nestedLists.map((nestedList) => listBlock($, nestedList, sheet)).join('\n');
  const body = [leading, nested].filter(Boolean).join('\n');
  return `<!-- wp:list-item${attrs} -->\n<li${clsPart}>${body}</li>\n<!-- /wp:list-item -->`;
}

function listBlock($: CheerioAPI, listEl: Element, sheet: InstanceStyleSheet): string {
  const tag = listEl.tagName?.toLowerCase() ?? '';
  const $list = $(listEl);
  const items = $list
    .children('li')
    .map((_, li) => listItemBlock($, li as Element, sheet))
    .get()
    .join('\n');
  const cls = classNameWithInstance($list, sheet);
  const orderedPairs = tag === 'ol' ? ['"ordered":true'] : [];
  const listAttrs = blockAttrs(orderedPairs, cls);
  const ulTag = tag === 'ol' ? 'ol' : 'ul';
  const listCls = ['wp-block-list', cls].filter(Boolean).join(' ');
  return `<!-- wp:list${listAttrs} -->\n<${ulTag} class="${escapeHtml(listCls)}">${items}</${ulTag}>\n<!-- /wp:list -->`;
}

interface ChildResult {
  markup: string;
  clean: boolean;
}

interface EmitChildOpts {
  verbatimInteractive?: boolean;
  jetpackForms?: boolean;
  onJetpackForm?: (fieldCount: number) => void;
}

/** An interactive/icon subtree the block conversion cannot represent without
 * loss: a <button>-toggled dropdown nav, a search/form control, or an inline
 * <svg> icon. core/list strips `button svg` + unwraps the <button> to bare
 * text + drops the <li> class; the structural-wrapper recursion downgrades a
 * bare <svg>/<input> to an empty paragraph. Detection searches descendants so
 * the HIGHEST enclosing element is caught (whole nav, whole form). */
const INTERACTIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'svg']);
function isInteractiveSubtree($: CheerioAPI, el: Element): boolean {
  const tag = el.tagName?.toLowerCase() ?? '';
  if (INTERACTIVE_TAGS.has(tag)) return true;
  return $(el).find('button, input, select, textarea, svg').length > 0;
}

/** A `<a class="btn|button">` CTA — the native-button emitter (the `tag === 'a'`
 * branch below) keys off this same class signal. It is detected here too so the
 * structural-wrapper branch can recognize a wrapper of pure CTAs and recurse
 * them into core/button instead of freezing them in a verbatim core/html island
 * (the inline-safe short-circuit otherwise swallows a lone wrapped button). */
const BUTTON_CLASS_RE = /\b(button|btn)\b/i;
function isButtonAnchor($: CheerioAPI, el: Element): boolean {
  if ((el.tagName ?? '').toLowerCase() !== 'a') return false;
  return BUTTON_CLASS_RE.test($(el).attr('class') ?? '');
}

/** An EMPTY element that carries a class is a pure styling hook — a CSS
 * background logo/icon (`<a class="brand-logo">` filled by background:url(svg)),
 * a divider, a spacer. The normal emitters downgrade it to an empty <p>,
 * dropping the class and killing the visual. Preserve it verbatim so the
 * class (and the carried CSS that paints it) survives. */
function isStylingHook($: CheerioAPI, el: Element): boolean {
  const $el = $(el);
  // id-bearing empty elements are JS/query-loop MOUNTS (`<div id="latestGrid"
  // class="…"></div>`), handled by the structural-wrapper branch as an empty
  // anchor-group that injectQueryLoops replaces — islandifying them would break
  // that splice. Only classed, id-less empties are styling hooks.
  if ($el.attr('id')) return false;
  if (!($el.attr('class') ?? '').trim()) return false;
  return $el.children().length === 0 && !$el.text().trim();
}

/** Does this subtree CONTAIN an empty id-bearing div — a query-loop/JS mount?
 * Islandifying an ancestor (because it also holds an inline <svg> — e.g. a
 * section whose pagination nav carries arrow icons) would trap the mount in raw
 * HTML where injectQueryLoops can't find the anchor-group, leaving the loop
 * empty. So such a subtree must stay structured; its interactive descendants
 * (the pagination icons) islandify individually on recursion instead. */
function containsMount($: CheerioAPI, el: Element): boolean {
  return $(el)
    .find('[id]')
    .toArray()
    .some((d) => {
      const $d = $(d as Element);
      return $d.children().length === 0 && !$d.text().trim();
    });
}

function containsConvertibleJetpackForm($: CheerioAPI, el: Element, sheet: InstanceStyleSheet): boolean {
  if ((el.tagName ?? '').toLowerCase() === 'form') return false;
  return ($(el).find('form').toArray() as Element[]).some((form) => emitJetpackForm($, form, sheet) !== null);
}

/** Map a single child element to a core block. clean=false when downgraded.
 * vi (verbatimInteractive) routes interactive subtrees to a verbatim core/html
 * island instead of the lossy list/group path — passed only by the carried
 * chrome parts, where the island is later unwrapped to raw HTML. */
function emitChild($: CheerioAPI, el: Element, sheet: InstanceStyleSheet, opts: EmitChildOpts = {}): ChildResult {
  const tag = el.tagName?.toLowerCase() ?? '';
  const $el = $(el);

  if (opts.jetpackForms) {
    const emitted = emitJetpackForm($, el, sheet);
    if (emitted) {
      opts.onJetpackForm?.(emitted.fieldCount);
      return { markup: emitted.markup, clean: true };
    }
  }
  const shouldRecurseForJetpackForm = opts.jetpackForms && containsConvertibleJetpackForm($, el, sheet);

  // verbatimInteractive (chrome carry): keep the whole interactive subtree
  // byte-true as a core/html island so the carried CSS (:hover/.is-open) and
  // site JS (button toggles, submenu reveal) keep matching the real DOM. The
  // chrome part unwraps the island to raw markup; theme policy then sees plain
  // HTML, not a custom-html block. "never lose source content".
  if (
    opts.verbatimInteractive &&
    !shouldRecurseForJetpackForm &&
    !containsMount($, el) &&
    (isInteractiveSubtree($, el) || isStylingHook($, el))
  ) {
    return { markup: htmlBlock(($.html(el) ?? '').trim()), clean: true };
  }

  // Source inline style is per-instance authority — the owned source overrides
  // class defaults inline (h1.display is a big clamp default, each heading
  // dials it down inline; dropping it makes every heading fall back to the
  // default and reflow). It is carried as a lib-i<hash> class + a stylesheet
  // rule (classNameWithInstance) rather than an inline style= attr, because the
  // block fixer strips inline style from core blocks; the class is fixer-safe.

  const h = HEADING.exec(tag);
  if (h) {
    const level = Number(h[1]);
    const cls = classNameWithInstance($el, sheet);
    const attrs = blockAttrs(level === 2 ? [] : [`"level":${level}`], cls);
    const htmlCls = ['wp-block-heading', cls].filter(Boolean).join(' ');
    const inner = inlineHtml($, el).trim();
    return {
      markup: `<!-- wp:heading${attrs} -->\n<h${level} class="${escapeHtml(htmlCls)}">${inner}</h${level}>\n<!-- /wp:heading -->`,
      clean: true,
    };
  }

  if (tag === 'p') {
    const cls = classNameWithInstance($el, sheet);
    const attrs = blockAttrs([], cls);
    const inner = inlineHtml($, el).trim();
    const clsPart = cls ? ` class="${escapeHtml(cls)}"` : '';
    const open = `<p${clsPart}>`;
    return { markup: `<!-- wp:paragraph${attrs} -->\n${open}${inner}</p>\n<!-- /wp:paragraph -->`, clean: true };
  }

  if (tag === 'img') {
    return { markup: imageBlock($, el, sheet), clean: true };
  }

  if (tag === 'a' && isButtonAnchor($, el)) {
    const href = escapeHtml($el.attr('href') ?? '');
    // Button labels are plain text — no inline markup inside the link.
    const label = escapeHtml($el.text().trim());
    const cls = classNameWithInstance($el, sheet);
    // The source button class + a `lib-cta` marker ride core/button's className
    // ATTRIBUTE, so canonicalization (@wordpress/blocks) keeps them on the
    // .wp-block-button WRAPPER — the only place a custom class survives the
    // fixer (it strips arbitrary classes off the inner __link anchor). The
    // carried source `.btn`/`.btn-*` rules therefore style the wrapper pill;
    // `lib-cta` scopes the WP_COMPAT reset that strips the inner anchor's own
    // default WP button chrome (fill bg + padding) so it doesn't paint a second
    // pill inside the source one.
    const buttonCls = [cls, 'lib-cta'].filter(Boolean).join(' ');
    const buttonAttrs = blockAttrs([], buttonCls);
    const divCls = ['wp-block-button', buttonCls].filter(Boolean).join(' ');
    // Source class is also written to the inner anchor for the pre-fixer sidecar
    // (a.button { … } sites) even though canonicalization later drops it — the
    // surviving styling is the wrapper class above + the lib-cta reset.
    const aCls = ['wp-block-button__link', 'wp-element-button', cls].filter(Boolean).join(' ');
    return {
      markup:
        `<!-- wp:buttons -->\n<div class="wp-block-buttons">` +
        `<!-- wp:button${buttonAttrs} -->\n<div class="${escapeHtml(divCls)}"><a class="${escapeHtml(aCls)}" href="${href}">${label}</a></div>\n<!-- /wp:button -->` +
        `</div>\n<!-- /wp:buttons -->`,
      clean: true,
    };
  }

  if (tag === 'ul' || tag === 'ol') {
    return { markup: listBlock($, el, sheet), clean: true };
  }

  if (tag === 'table') {
    // core/table: rebuild thead/tbody rows with text-only cells (inline markup
    // inside cells flattens to text — matches the emitter's v1 cell model).
    // Source `table {}` / `th, td {}` element rules keep applying; the source
    // table class rides along via className.
    const cls = classNameOf($el);
    const rowHtml = (rowEl: Element): string => {
      const cells = $(rowEl)
        .children('th, td')
        .map((_, c) => {
          const cellTag = (c as Element).tagName?.toLowerCase() === 'th' ? 'th' : 'td';
          return `<${cellTag}>${escapeHtml($(c).text().trim())}</${cellTag}>`;
        })
        .get()
        .join('');
      return `<tr>${cells}</tr>`;
    };
    const headRows = $el.find('thead tr').map((_, r) => rowHtml(r as Element)).get();
    // cheerio normalizes bare <tr> children into an implicit <tbody>, so a
    // source table with no explicit <thead> lands its header row here too —
    // promote a leading all-<th> row to thead (matches WP's table block shape).
    let bodyRowEls = $el.find('tbody tr').toArray();
    if (bodyRowEls.length === 0) bodyRowEls = $el.find('tr').toArray();
    if (headRows.length === 0 && bodyRowEls.length > 0) {
      const first = bodyRowEls[0];
      const firstIsHeader = $(first).children('td').length === 0 && $(first).children('th').length > 0;
      if (firstIsHeader) {
        headRows.push(rowHtml(first as Element));
        bodyRowEls = bodyRowEls.slice(1);
      }
    }
    const bodyRows = bodyRowEls.map((r) => rowHtml(r as Element));
    const attrs = blockAttrs([], cls);
    // DELIBERATELY no wp-block-table class on the figure: block-library's
    // `.wp-block-table td/th { border/padding }` class rules out-rank the
    // source's element rules (td, th { … }) and inflate every row — there is
    // no specificity slot that beats the WP class yet defers to the source
    // element selectors. Without the class the WP table css never matches and
    // the source owns the table entirely. Editor re-save restores the class
    // (documented canonicalization drift, accepted for parity).
    const figCls = cls;
    const figAttr = figCls ? ` class="${escapeHtml(figCls)}"` : '';
    const thead = headRows.length ? `<thead>${headRows.join('')}</thead>` : '';
    const tbody = `<tbody>${bodyRows.join('')}</tbody>`;
    return {
      markup: `<!-- wp:table${attrs} -->\n<figure${figAttr}><table>${thead}${tbody}</table></figure>\n<!-- /wp:table -->`,
      clean: true,
    };
  }

  // Structural wrapper preservation: unknown wrappers that carry an id OR
  // have element children survive as group divs — id, classes, AND inline
  // style attr intact — with children recursed through the normal emitters.
  // The owned-source contracts all depend on it: ids are JS mount targets
  // (`<div id="newestGrid">` filled by a carried mount script), classes are
  // the carried-CSS selectors (.wrap layout containers), and inline styles
  // hold per-element grid/padding the source authored directly (maison-clouet
  // dogfood: text-downgrading .wrap wrappers mushed entire designed pages
  // into paragraph runs). The style attr rides the ELEMENT only (not block
  // attrs) — same accepted editor-resave drift as the classless table figure.
  // Empty id-mounts stay empty (and clean: nothing was lost).
  const elId = $el.attr('id');
  const elementChildren = $el.children().toArray();
  if (elId || elementChildren.length > 0) {
    // Inline-only content (kicker label runs: <span class="num">01</span> · …)
    // is serialized VERBATIM as inline markup, not recursed: recursion downgrades
    // each inline <span> to a classless block <p> — dropping the source class
    // (.num color) AND adding UA paragraph margins, which reflows the page
    // vertically (maison kicker: h1 pushed down 28px on mobile). The group div
    // keeps the source class so `.kicker{display:inline-flex}` still renders it.
    // A child counts as inline ONLY if it is an inline tag AND carries no
    // block-level descendants — a block-containing <a> (a card link wrapping
    // divs) is inline-tagged but structurally block, and serializing it inline
    // would destroy its block descendants (the .ph image placeholder).
    const isInlineSafe = (c: Element): boolean => {
      const t = (c.tagName ?? '').toLowerCase();
      if (!INLINE_ALLOWED.has(t)) return false;
      return $(c)
        .find('*')
        .toArray()
        .every((d) => INLINE_ALLOWED.has(((d as Element).tagName ?? '').toLowerCase()));
    };
    const allInline = elementChildren.length > 0 && elementChildren.every((c) => isInlineSafe(c as Element));
    // A wrapper whose children are ALL button-anchors is a CTA row, not inline
    // content to freeze: recurse so each anchor reaches the core/button emitter
    // (otherwise allInline traps the lone wrapped button in a verbatim html
    // island). Mixed wrappers (button + spans/text) keep the inline path so
    // their span class hooks survive verbatim — only pure-CTA wrappers divert.
    const allButtons = elementChildren.length > 0 && elementChildren.every((c) => isButtonAnchor($, c as Element));
    let body: string;
    let clean: boolean;
    if (allInline && !allButtons) {
      // Inline body rides a core/html INNER block: placed raw inside the group
      // the fixer would delete it (core/group expects inner BLOCKS); core/html
      // preserves it verbatim and renders the spans inline (.num/.ph__tag).
      body = htmlBlock(inlineHtml($, el).trim());
      clean = true;
    } else {
      const childResults = elementChildren.map((c) => emitChild($, c, sheet, opts));
      const inner = childResults.map((r) => r.markup).filter(Boolean).join('\n');
      const looseText = $el.clone().children().remove().end().text().trim();
      const loosePara = looseText && childResults.length === 0 ? paragraphBlock(escapeHtml(looseText)) : '';
      body = [inner, loosePara].filter(Boolean).join('\n');
      clean = childResults.every((r) => r.clean) && !(looseText && childResults.length > 0);
    }
    // Wrapper inline style (per-element grid/padding the source authored
    // directly) rides a lib-i<hash> class + stylesheet rule, not a style= attr
    // the fixer would strip.
    const cls = classNameWithInstance($el, sheet);
    const wrapPairs = ['"tagName":"div"'];
    if (elId) wrapPairs.unshift(`"anchor":${attrJson(elId)}`);
    const wrapAttrs = blockAttrs(wrapPairs, cls);
    const divCls = ['wp-block-group', cls].filter(Boolean).join(' ');
    const idPart = elId ? ` id="${escapeHtml(elId)}"` : '';
    return {
      markup:
        `<!-- wp:group ${wrapAttrs} -->\n` +
        `<div${idPart} class="${escapeHtml(divCls)}">${body ? `\n${body}\n` : ''}</div>\n` +
        `<!-- /wp:group -->`,
      clean,
    };
  }

  // Rescue img descendants before the catch-all downgrade — an unknown
  // wrapper (e.g. <figure>) flattened to a text paragraph would silently
  // lose its image URLs ("never lose source content").
  const imgs = $el.find('img');
  if (imgs.length > 0) {
    const imgMarkup = imgs
      .map((_, imgEl) => imageBlock($, imgEl, sheet))
      .get()
      .join('\n');
    const text = escapeHtml($el.text().trim());
    const textPara = text ? `\n${paragraphBlock(text)}` : '';
    return { markup: imgMarkup + textPara, clean: false };
  }

  // Leaf element (no element children, no id) reached the fallback. Preserve its
  // styling instead of flattening to a bare <p>, which silently drops the class
  // the carried CSS targets (`.stat .stat-num`, `.quote .quote-by`), the element
  // tag a selector targets (`.gallery figcaption`), and any inline style.
  const text = $el.text().trim();
  if (tag === 'div' || tag === 'span') {
    if (text) {
      // Generic text container with content → a core/paragraph carrying the
      // source class + a per-instance style class. Class-targeted CSS matches the
      // className; the <p> tag is immaterial (the source styles by class, not
      // element). Nested inline markup (a <strong>/<a>) survives via inlineHtml.
      // Stays natively editable.
      const cls = classNameWithInstance($el, sheet);
      const attrs = blockAttrs([], cls);
      const clsPart = cls ? ` class="${escapeHtml(cls)}"` : '';
      return {
        markup: `<!-- wp:paragraph${attrs} -->\n<p${clsPart}>${inlineHtml($, el).trim()}</p>\n<!-- /wp:paragraph -->`,
        clean: true,
      };
    }
    // An EMPTY classed div/span is a CSS-painted styling hook (a decorative
    // overlay, a divider, a spacer): preserve it verbatim so the class — and the
    // carried rule that paints it — survives. Empty + classless → nothing to keep.
    const verbatimHook = ($el.attr('class') ?? '').trim() ? ($.html(el) ?? '').trim() : '';
    if (verbatimHook) return { markup: htmlBlock(verbatimHook), clean: true };
    return { markup: paragraphBlock(escapeHtml(text)), clean: false };
  }
  // A semantic leaf (figcaption, cite, time, address, small…): the source may
  // select it by ELEMENT, so a <p> would break the selector. Preserve it verbatim
  // (tag + class + inline style + inline content) as an html island.
  const verbatim = ($.html(el) ?? '').trim();
  if (verbatim) return { markup: htmlBlock(verbatim), clean: true };
  return { markup: paragraphBlock(escapeHtml(text)), clean: false };
}

export interface EmitSectionOpts {
  /** Wrapper element for the group. Body sections default to 'section' so
   * carried source `section { … }` rules keep matching; chrome consumers
   * (footer part) pass 'div' — a footer's content is NOT a body section and
   * must not attract section margins (walrus probe: +88px inside footer). */
  wrapper?: 'section' | 'div';
  /** Wrapper for behavior-tagged (tabs/slider/modal) sections. 'dla'
   * (default, nativeBehaviors path) = the custom Interactivity block with
   * root directives; 'group' (carry/default path) = a plain core/group around
   * the SAME verbatim inner — content survival with no plugin dependency, the
   * carried source JS drives the intact DOM. */
  behaviorWrapper?: 'dla' | 'group';
  /** Shared instance-style sheet (carry path): per-element inline `style=` is
   * hashed into a `lib-i<hash>` class registered here and emitted as a carried
   * stylesheet rule, instead of a fixer-invalid inline style attr. Omit and a
   * local sheet is used (returned on the result; callers that don't carry CSS
   * discard it). Pass a shared sheet to dedupe rules across sections/pages. */
  instanceStyles?: InstanceStyleSheet;
  /** Carried-chrome path: emit interactive subtrees (button-dropdown navs,
   * search/forms, inline-svg icons) VERBATIM as core/html islands rather than
   * converting to core/list|group, which silently drops <button>/<svg>/controls
   * and the <li> classes the carried CSS + JS key off. The chrome parts unwrap
   * the islands to raw HTML. Default false (body sections blockify normally). */
  verbatimInteractive?: boolean;
  /** Local compose path: convert eligible source forms to Jetpack Forms blocks
   * before the verbatim-interactive fallback. Default false. */
  jetpackForms?: boolean;
}

/** Fail-closed insurance shared by both verbatim wrappers: an inner HTML
 * comment SHAPED like a block delimiter would confuse the WP parser (pair
 * form throws at the roundtrip gate; void form silently re-parents). Strip
 * just those; plain comments stay (realistic exposure ~0, research-verified). */
function stripBlockShapedComments(html: string): string {
  return html.replace(/<!--\s*\/?wp:[\s\S]*?-->/g, '');
}

/**
 * B1 verbatim-wrap (tabs/slider/modal): the custom Interactivity wrapper
 * around the section's UNCONVERTED inner HTML. Root directives only —
 * view.js wires the verbatim descendants imperatively from callbacks.init
 * (the dla/sticky precedent), so no descendant directives are injected.
 * Context keys match the landed view.js reads: tabs {activeClass}, slider
 * {activeClass, intervalMs?}, modal EMPTY (no data-wp-context attribute at
 * all — native <dialog> semantics need no params).
 */
function verbatimBehaviorMarkup(
  section: Section,
  b: TabsBehavior | SliderBehavior | ModalBehavior,
  inner: string,
): string {
  const cls = (section.classes ?? []).join(' ');
  const pairs = [`"anchor":${attrJson(section.id)}`];
  const ctxPairs: string[] = [];
  if (b.kind === 'tabs' || b.kind === 'slider') {
    pairs.push(`"activeClass":${attrJson(b.activeClass)}`);
    ctxPairs.push(`"activeClass":${attrJson(b.activeClass)}`);
    // TRUTHY gate (not !== undefined): detection can yield intervalMs 0
    // (SET_INTERVAL_RE matches setInterval(poll, 0) anywhere in source js);
    // view.js treats 0 as no-autoplay and the editor save() omits falsy
    // intervalMs — emitting 0 here would drift save() from this markup and
    // invalidate the block (B2 review residual).
    if (b.kind === 'slider' && b.intervalMs) {
      pairs.push(`"intervalMs":${JSON.stringify(b.intervalMs)}`);
      ctxPairs.push(`"intervalMs":${JSON.stringify(b.intervalMs)}`);
    }
  }
  const attrs = blockAttrs(pairs, cls);
  // The context JSON sits in a single-quoted HTML attribute: attrJson covers
  // the kses '--' trap; the ' escape is belt-and-braces (classes are
  // capture-constrained upstream) — mirrors the sticky state block.
  const ctx = ctxPairs.length ? `{${ctxPairs.join(',')}}`.replace(/'/g, '\\u0027') : '';
  const ctxAttr = ctx ? ` data-wp-context='${ctx}'` : '';
  const wrapCls = [`wp-block-dla-${b.kind}`, cls].filter(Boolean).join(' ');
  return (
    `<!-- wp:dla/${b.kind}${attrs} -->\n` +
    `<section id="${escapeHtml(section.id)}" class="${escapeHtml(wrapCls)}"` +
    ` data-wp-interactive="dla/${b.kind}"${ctxAttr} data-wp-init="callbacks.init">${inner}</section>\n` +
    `<!-- /wp:dla/${b.kind} -->`
  );
}

export function emitSectionBlocks(
  section: Section,
  opts: EmitSectionOpts = {},
): { markup: string; confidence: number; instanceStyles: InstanceStyleSheet; formsConverted: number } {
  const sheet = opts.instanceStyles ?? new InstanceStyleSheet();
  const $ = cheerio.load(section.html);
  let formsConverted = 0;
  // Include 'main' so that segmentPage's main-fallback case (which emits a
  // <main> outerHTML as one Section) resolves its container correctly.
  // DEVIATION from plan: plan's selector was 'section, article, div' — that
  // misses <main>, causing the fallback section to hit $('body') and then
  // emitChild on the whole <main> element, which downgrades to a paragraph.
  // TODO(root mis-slice hardening): tag-agnostic resolution — $('body')
  // .children().first() — so a section rooted in a NON-listed tag (e.g.
  // <aside>) resolves to itself instead of a nested descendant; pre-existing
  // limitation shared by all branches, higher stakes for verbatim sections.
  const root = $('section, article, main, div').first();
  const container = root.length ? root : $('body');

  // B1 verbatim-wrap: a tabs/slider/modal section SKIPS the emitChild
  // conversion entirely — interactive scaffolding (role/aria attrs, buttons,
  // panels, slides) must survive byte-true so source CSS and the driving JS
  // keep matching; the conversion pipeline would downgrade it ("never lose
  // source content" — carry E2E: tab/panel ids went structurally MISSING).
  // confidence 1: nothing is converted, so nothing can degrade. Like the
  // reveal branch, opts.wrapper is deliberately ignored (behavior tags only
  // arrive on body sections).
  if (section.behavior && section.behavior.kind !== 'reveal') {
    const inner = stripBlockShapedComments(container.html() ?? '');
    if ((opts.behaviorWrapper ?? 'dla') === 'group') {
      // Carry/default path: SAME verbatim inner, plain core/group wrapper —
      // no directives, no plugin dependency; the carried source JS drives the
      // intact DOM. The verbatim inner rides a core/html INNER block so it
      // survives the fixer (core/group expects inner BLOCKS — raw scaffolding
      // placed directly inside the group div is stripped as unexpected content).
      const cls = (section.classes ?? []).join(' ');
      const attrs = blockAttrs([`"anchor":${attrJson(section.id)}`, '"tagName":"section"'], cls);
      const divCls = ['wp-block-group', cls].filter(Boolean).join(' ');
      const wrapped = htmlBlock(inner);
      return {
        markup:
          `<!-- wp:group${attrs} -->\n` +
          `<section id="${escapeHtml(section.id)}" class="${escapeHtml(divCls)}">${wrapped ? `\n${wrapped}\n` : ''}</section>\n` +
          `<!-- /wp:group -->`,
        confidence: 1,
        instanceStyles: sheet,
        formsConverted,
      };
    }
    return {
      markup: verbatimBehaviorMarkup(section, section.behavior, inner),
      confidence: 1,
      instanceStyles: sheet,
      formsConverted,
    };
  }

  const childOpts: EmitChildOpts = {
    verbatimInteractive: opts.verbatimInteractive ?? false,
    jetpackForms: opts.jetpackForms ?? false,
    onJetpackForm: () => {
      formsConverted += 1;
    },
  };
  const childMarkup: string[] = [];
  let downgrades = 0;
  let total = 0;

  // Iterate contents() (not children()) so loose text nodes at the section
  // root survive as paragraphs instead of being silently dropped.
  for (const node of container.contents().get()) {
    if (isTag(node)) {
      total += 1;
      const res = emitChild($, node, sheet, childOpts);
      if (!res.clean) downgrades += 1;
      childMarkup.push(res.markup);
    } else if (isText(node)) {
      const text = node.data.trim();
      if (!text) continue;
      total += 1;
      childMarkup.push(paragraphBlock(escapeHtml(text)));
    }
  }

  const inner = childMarkup.join('\n');
  const cls = (section.classes ?? []).join(' ');
  const confidence = total === 0 ? 0 : 1 - downgrades / total;

  // nativeBehaviors: a tagged section swaps core/group for the custom
  // Interactivity wrapper. SAME inner markup, same semantic <section> +
  // identity classes (carried css keeps matching, stage 1d constraints:
  // NO layout attribute, tagName stays section). Behavior params ride
  // data-wp-context (runtime) + inline custom properties (css animation),
  // both per-site; the plugin files (src/blocks/) are static. Deliberately
  // ignores opts.wrapper — behavior tags only arrive on body sections, which
  // use the default <section> wrapper (chrome consumers never tag).
  if (section.behavior?.kind === 'reveal') {
    const b = section.behavior;
    const pairs = [
      `"anchor":${attrJson(section.id)}`,
      `"threshold":${JSON.stringify(b.threshold)}`,
      `"translateY":${attrJson(b.translateY)}`,
      `"durationMs":${JSON.stringify(b.durationMs)}`,
    ];
    const attrs = blockAttrs(pairs, cls);
    // The context JSON sits in a single-quoted HTML attribute: numbers and
    // booleans only, so no single quote can break out; the '--' escape mirrors
    // attrJson (kses -- trap) — a number cannot contain '--' today, but the
    // contract is enforced here so a future string key cannot regress it.
    const ctx = `{"visible":false,"threshold":${JSON.stringify(b.threshold)}}`.replace(
      /--/g,
      '\\u002d\\u002d',
    );
    const wrapCls = ['wp-block-dla-reveal', cls].filter(Boolean).join(' ');
    const markup =
      `<!-- wp:dla/reveal${attrs} -->\n` +
      `<section id="${escapeHtml(section.id)}" class="${escapeHtml(wrapCls)}"` +
      ` style="--dla-reveal-y:${escapeHtml(b.translateY)};--dla-reveal-ms:${b.durationMs}ms"` +
      ` data-wp-interactive="dla/reveal" data-wp-context='${ctx}'` +
      ` data-wp-init="callbacks.init" data-wp-class--is-visible="context.visible">${inner}</section>\n` +
      `<!-- /wp:dla/reveal -->`;
    return { markup, confidence, instanceStyles: sheet, formsConverted };
  }

  const anchorPair = `"anchor":${attrJson(section.id)}`;
  // tagName:section so carried source CSS element-selectors (section { … })
  // keep matching the block DOM — core/group supports semantic tagNames and
  // serializes <section class="wp-block-group …"> (stage 1d parity).
  const tagPair = '"tagName":"section"';
  // NO layout attribute at all: any layout type (constrained OR flow) makes WP
  // emit per-container css — child max-widths, margin zeroing, blockGap — that
  // fights the carried source rhythm (probe: replica h1 margin-bottom forced to
  // 0, uniform 24px gaps replacing the source's 16px/1.5em cadence). Without
  // the attr there is no is-layout-* class and no injected rules; the source
  // stylesheet owns spacing entirely.
  const wrapper = opts.wrapper ?? 'section';
  // The section's own inline style (owned sources author per-section
  // padding/grid inline) rides a lib-i<hash> class + carried rule, folded into
  // the section classes — not a style= attr the fixer would strip.
  const sectionInstance = sheet.classFor(container.attr('style'));
  const wrapperCls = [cls, sectionInstance].filter(Boolean).join(' ');
  const wrapperPairs = wrapper === 'section' ? [anchorPair, tagPair] : [anchorPair];
  const attrs = blockAttrs(wrapperPairs, wrapperCls);
  const divCls = ['wp-block-group', wrapperCls].filter(Boolean).join(' ');
  const markup =
    `<!-- wp:group${attrs} -->\n` +
    `<${wrapper} id="${escapeHtml(section.id)}" class="${escapeHtml(divCls)}">${inner}</${wrapper}>\n` +
    `<!-- /wp:group -->`;
  return { markup, confidence, instanceStyles: sheet, formsConverted };
}
