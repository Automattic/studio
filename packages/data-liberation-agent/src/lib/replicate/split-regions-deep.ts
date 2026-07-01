//
// Deep region split for the carry-and-scope alt path
// ==================================================
// `splitRegions` only extracts a <header>/<footer> that is a TOP-LEVEL child of
// the body. Builder sites (Wix/Squarespace/Webflow) bury their semantic chrome
// deep inside a shared wrapper scaffold (`#SITE_CONTAINER > … > <header id=…>`),
// so that splitter finds nothing and the whole page — chrome included — rides in
// one island.
//
// This splitter finds the chrome at ANY depth and carves the body into the seven
// lossless byte-chunks the new template architecture needs:
//
//   openWrap | <header> | midBefore | [sections…] | midAfter | <footer> | closeWrap
//
// Concatenated they reproduce the original body exactly. The caller puts the
// wrapper chunks (openWrap/midBefore/midAfter/closeWrap) in the TEMPLATE as
// core/html, the header/footer in template parts (or patterns), and the sections
// in post_content — so the rendered stream rebuilds the identical DOM while the
// post holds only editable content blocks.
//
// Why string offsets, not cheerio: the split must be byte-exact (re-serializing
// through a DOM mutates whitespace/attributes and the concatenation would drift).

export interface DeepRegionSplit {
  /** True when a header OR footer was located. False → caller keeps the single-island path. */
  found: boolean;
  openWrap: string;
  headerHtml: string;
  midBefore: string;
  sectionsHtml: string[];
  midAfter: string;
  footerHtml: string;
  closeWrap: string;
}

/** Find the balanced span [start, end) of the FIRST (or LAST) `<tag …>…</tag>`. */
function balancedSpan(html: string, tag: string, which: 'first' | 'last'): [number, number] | null {
  // `(?![\w-])` after the tag name so a custom element whose name STARTS with the tag
  // (Shopify Dawn's `<header-drawer>` / `<header-menu>`) is not counted as a `<tag>` open.
  // `</header-drawer>` never matches the close below, so a `\b`-based open would inflate the
  // depth and the real `<header>` span would never balance — silently losing the whole header.
  const open = new RegExp(`<${tag}(?![\\w-])[^>]*>`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  // Tokenize opens/closes in order, track depth, collect every balanced top span.
  const toks: Array<{ i: number; end: number; open: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) toks.push({ i: m.index, end: m.index + m[0].length, open: true });
  while ((m = close.exec(html))) toks.push({ i: m.index, end: m.index + m[0].length, open: false });
  toks.sort((a, b) => a.i - b.i);
  const spans: Array<[number, number]> = [];
  let depth = 0;
  let start = -1;
  for (const t of toks) {
    if (t.open) {
      if (depth === 0) start = t.i;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) spans.push([start, t.end]);
    }
  }
  if (spans.length === 0) return null;
  return which === 'first' ? spans[0] : spans[spans.length - 1];
}

/** Char offset of the first attribute-id match `id="<id>"`, or -1. */
function idStart(html: string, id: string): number {
  const m = new RegExp(`<[a-zA-Z][^>]*\\bid="${id}"`, 'i').exec(html);
  return m ? m.index : -1;
}

/**
 * Locate the chrome element's balanced span. Prefers an explicit id (Wix
 * `SITE_HEADER`/`SITE_FOOTER`), then the semantic tag, then the ARIA role.
 */
function findChrome(html: string, opts: { tag: 'header' | 'footer'; id: string; which: 'first' | 'last' }): [number, number] | null {
  // 1. Explicit id: take the balanced <tag> span that contains that id.
  const idx = idStart(html, opts.id);
  if (idx >= 0) {
    // The id sits on a <tag …id=…> open — find its balanced close from idx.
    const span = balancedSpan(html.slice(idx), opts.tag, 'first');
    if (span) return [idx + span[0], idx + span[1]];
  }
  // 2. Semantic tag, first/last balanced span.
  return balancedSpan(html, opts.tag, opts.which);
}

/** Index just past the `</div>` that balances the `<div` whose `<` is at `start` (div-depth). */
function divSpanEnd(html: string, start: number): number {
  const re = /<div(?![\w-])|<\/div\s*>/gi;
  re.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') {
      if (--depth === 0) return m.index + m[0].length;
    } else depth++;
  }
  return html.length;
}

/**
 * The Shopify header is a GROUP of sibling sections — an announcement/utility bar then the nav
 * header, all marked `.shopify-section-group-header-group`. The bare `<header>` drops the
 * announcement bar AND the section-wrapper context its CSS relies on. When the located `<header>`
 * sits inside such a group, extend the span to the full CONTIGUOUS group run so the whole header
 * travels as one chrome region (→ globalizes via chromeCss, lifts out of content as a unit).
 * Falls back to the bare `<header>` span when no group marker is present (non-Shopify).
 */
function extendToHeaderGroup(html: string, header: [number, number]): [number, number] {
  const MARK = 'shopify-section-group-header-group';
  let firstStart = -1;
  let lastEnd = -1;
  let from = 0;
  for (;;) {
    const mi = html.indexOf(MARK, from);
    if (mi < 0) break;
    const lt = html.lastIndexOf('<', mi);
    if (lt < 0) break;
    const end = divSpanEnd(html, lt);
    if (firstStart < 0) firstStart = lt;
    else if (html.slice(lastEnd, lt).trim() !== '') break; // a non-group element breaks the run
    lastEnd = end;
    from = end;
  }
  // Only adopt the group span when it actually wraps the located <header>.
  if (firstStart >= 0 && firstStart <= header[0] && lastEnd >= header[1]) return [firstStart, lastEnd];
  return header;
}

/** Top-level `<section>` spans within a fragment (depth-counted; sections don't self-nest the page level). */
function topLevelSections(html: string): Array<[number, number]> {
  const re = /<\/?section\b[^>]*>/gi;
  const out: Array<[number, number]> = [];
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const isClose = m[0].startsWith('</');
    if (!isClose) {
      if (depth === 0) start = m.index;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) out.push([start, m.index + m[0].length]);
    }
  }
  return out;
}

export function splitRegionsDeep(bodyHtml: string): DeepRegionSplit {
  const empty: DeepRegionSplit = {
    found: false,
    openWrap: '',
    headerHtml: '',
    midBefore: '',
    sectionsHtml: [],
    midAfter: '',
    footerHtml: '',
    closeWrap: '',
  };

  const headerEl = findChrome(bodyHtml, { tag: 'header', id: 'SITE_HEADER', which: 'first' });
  // Extend a bare <header> to its full Shopify header group (announcement + nav) when present.
  const header = headerEl ? extendToHeaderGroup(bodyHtml, headerEl) : null;
  const footer = findChrome(bodyHtml, { tag: 'footer', id: 'SITE_FOOTER', which: 'last' });
  if (!header && !footer) return empty;

  // Bound the content region between header (or start) and footer (or end).
  const headerStart = header ? header[0] : 0;
  const headerEnd = header ? header[1] : 0;
  const footerStart = footer ? footer[0] : bodyHtml.length;
  const footerEnd = footer ? footer[1] : bodyHtml.length;
  // Guard against a footer that precedes the header (malformed) — bail to single-island.
  if (footerStart < headerEnd) return empty;

  const openWrap = bodyHtml.slice(0, headerStart);
  const headerHtml = header ? bodyHtml.slice(headerStart, headerEnd) : '';
  const middle = bodyHtml.slice(headerEnd, footerStart);
  const footerHtml = footer ? bodyHtml.slice(footerStart, footerEnd) : '';
  const closeWrap = bodyHtml.slice(footerEnd);

  const secs = topLevelSections(middle);
  if (secs.length === 0) {
    // No sections to peel out — the whole middle is the content block.
    return { found: true, openWrap, headerHtml, midBefore: '', sectionsHtml: middle ? [middle] : [], midAfter: '', footerHtml, closeWrap };
  }
  const midBefore = middle.slice(0, secs[0][0]);
  const midAfter = middle.slice(secs[secs.length - 1][1]);
  const sectionsHtml: string[] = [];
  for (let k = 0; k < secs.length; k++) {
    // Each block = the section plus any inter-section whitespace/siblings up to the next section.
    const end = k + 1 < secs.length ? secs[k + 1][0] : secs[k][1];
    sectionsHtml.push(middle.slice(secs[k][0], end));
  }
  return { found: true, openWrap, headerHtml, midBefore, sectionsHtml, midAfter, footerHtml, closeWrap };
}
