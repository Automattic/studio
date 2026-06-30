// src/lib/replicate/local-data/discover-html-cards.ts
//
// The static-HTML analog of discover-js-data: find repeated content-card grids
// authored directly in HTML (a blog/archive index of post-preview cards) and
// turn them into the same `records[]` shape the scaffold consumes. Pure (cheerio
// + an injected page resolver for body extraction).
//
// GENERICITY CONTRACT: detection is structural ONLY. No class name, id, or fixed
// nesting depth is ever matched. A "card" is recognized by its tag + direct-child
// tag shape and content richness — so `bp-card`, `tile`, `post-preview`, … all
// work identically, and a class-keyed shortcut would fail the tests.
//
//   document
//     │  every element with children → structuralSignature (tag + sorted child tags)
//     ▼
//   signatures occurring >= MIN_CARDS  ── frequency, not position
//     │  clusterToGrids: group by parent, lift lone cards into the nested grid
//     ▼                                   they share an ancestor with (mixed depth)
//   grid (cards + container)
//     │  richness gate (heading + image|link + text) → reject nav/footer/pagination
//     ▼
//   sibling-diff → fields (title/excerpt/image/category/date/link + synth id)
//     │  deterministic data-dla-* template from card[0]'s own markup
//     ▼  body: follow link via resolvePage → extractMainContent (shared target → excerpt)
//   DiscoveredCardGrid
import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { extractMainContent } from '../../../adapters/default/content.js';

/** Minimum sibling cards for a run to count as a grid. */
const MIN_CARDS = 3;
const CATEGORY_MAX_LEN = 30;
const DATE_RE = /\b(\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2})\b/i;

export interface DiscoveredCardGrid {
  /** The grid container → becomes a mount / core/query loop. Unique in the document. */
  containerSelector: string;
  /**
   * The container's own class attribute (verbatim), carried onto the query
   * loop's post-template so the source's layout CSS (e.g. a `display:grid`
   * rule on `.bp-featured`) keeps laying the cards out. Class-agnostic: we
   * carry whatever classes the source container has rather than matching any.
   * Empty string when the container has no class.
   */
  containerClass: string;
  /** One per card, in document order. Shape the scaffold's records pipeline consumes. */
  records: Array<Record<string, unknown>>;
  /** Diffed skeleton with data-dla-* bindings (deterministic). */
  cardTemplate: string;
  /**
   * Present when the grid is a "featured" layout: one (or few) lead card(s) as
   * direct children of the container + the remaining cards nested under a single
   * common wrapper element. Drives a two-loop reconstruction downstream. Absent
   * for uniform grids.
   */
  featured?: {
    /** Cards that are direct children of the container (the lead group), in doc order. Count = the lead/column offset boundary. */
    leadCount: number;
    /** The common wrapper element's verbatim class attribute (carried CSS hook for the column layout); '' if none. */
    columnWrapperClass: string;
    /** data-dla-* template built from the FIRST lead card (typically carries the excerpt). */
    leadTemplate: string;
    /** data-dla-* template built from the FIRST column (row) card (typically omits the excerpt; carries the row modifier class verbatim). */
    rowTemplate: string;
    /** Slugified category shared by ALL cards in the section (lead + column); set only when homogeneous. Drives a per-section term filter. Absent when the section mixes categories. */
    termSlug?: string;
  };
  confidence: 'high' | 'low';
  /** Human-readable note: why it qualified / which roles were ambiguous. */
  evidence: string;
}

export interface DiscoverHtmlCardsOptions {
  /** Resolve a card link href → the linked local page's HTML (or null). Injected; keeps this module pure. */
  resolvePage?: (href: string) => string | null;
}

interface CardFields {
  id: string;
  title: string;
  excerpt: string;
  image: string;
  category: string;
  date: string;
  link: string;
  meta: Record<string, string>;
}

interface Candidate {
  cards: Element[];
  sig: string;
}

interface RichCandidate extends Candidate {
  richCards: Element[];
}

interface RichCandidateGroup {
  sig: string;
  candidates: RichCandidate[];
  richCards: Element[];
}

type OneToOneNestingClassification = 'part' | 'wrapper' | 'none';

const UNSAFE_MOUNT_CONTAINER_SELECTOR = 'html,body,main,section';

/** Structural signature: tag + sorted direct-child element tag names. CLASS-AGNOSTIC. */
export function structuralSignature($: CheerioAPI, el: Element): string {
  const childTags = $(el)
    .children()
    .toArray()
    .map((c) => (c as Element).tagName?.toLowerCase())
    .filter((t): t is string => Boolean(t))
    .sort();
  return `${el.tagName.toLowerCase()}>${childTags.join(',')}`;
}

/** All element descendants of root, in document order. */
function descendants($: CheerioAPI, root: Element): Element[] {
  const out: Element[] = [];
  const visit = (node: Element): void => {
    for (const child of $(node).children().toArray() as Element[]) {
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

function isDescendant(maybeChild: Element, maybeAncestor: Element): boolean {
  let cur = maybeChild.parent as Element | null;
  while (cur) {
    if (cur === maybeAncestor) return true;
    cur = cur.parent as Element | null;
  }
  return false;
}

function lowestCommonAncestor(a: Element, b: Element): Element | null {
  const ancestorsOf = (el: Element): Element[] => {
    const chain: Element[] = [];
    let cur: Element | null = el;
    while (cur && cur.type === 'tag') {
      chain.push(cur);
      cur = cur.parent as Element | null;
    }
    return chain;
  };
  const aSet = new Set(ancestorsOf(a));
  for (const anc of ancestorsOf(b)) if (aSet.has(anc)) return anc;
  return null;
}

/** Cluster same-signature card elements into grids by ancestry (handles mixed depth). */
function clusterToGrids($: CheerioAPI, cards: Element[]): Element[][] {
  // 1. group by direct parent
  const byParent = new Map<Element, Element[]>();
  for (const card of cards) {
    const parent = card.parent as Element | null;
    if (!parent || parent.type !== 'tag') continue;
    const list = byParent.get(parent) ?? [];
    list.push(card);
    byParent.set(parent, list);
  }
  // 2. parent groups with >= MIN_CARDS are seed grids
  const grids: Array<{ cards: Element[]; container: Element }> = [];
  const orphans: Element[] = [];
  for (const [parent, group] of byParent) {
    if (group.length >= MIN_CARDS) grids.push({ cards: [...group], container: parent });
    else orphans.push(...group);
  }
  if (grids.length === 0) {
    // No parent reached the threshold: fall back to the single run if big enough.
    return cards.length >= MIN_CARDS ? [cards] : [];
  }
  // 3. lift each orphan into the seed grid it shares the closest ancestor with
  for (const orphan of orphans) {
    let best: { grid: (typeof grids)[number]; ancestor: Element } | null = null;
    for (const grid of grids) {
      const ancestor = lowestCommonAncestor(orphan, grid.container);
      if (!ancestor) continue;
      if (!best || isDescendant(ancestor, best.ancestor)) best = { grid, ancestor };
    }
    if (best) {
      best.grid.cards.push(orphan);
      best.grid.container = best.ancestor; // lift the container to the shared ancestor
    }
  }
  // 4. document order within each grid
  const ordered = $('*').toArray() as Element[];
  const indexOf = new Map(ordered.map((el, i) => [el, i] as const));
  return grids.map((g) => g.cards.sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0)));
}

/** Build a selector that uniquely matches `el` in the document. */
export function uniqueSelector($: CheerioAPI, el: Element): string {
  const id = $(el).attr('id');
  if (id && $(`#${cssEscape(id)}`).length === 1) return `#${id}`;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.type === 'tag') {
    const ownId = $(cur).attr('id');
    if (ownId) {
      parts.unshift(`#${ownId}`);
      break;
    }
    const tag = cur.tagName.toLowerCase();
    const idx = $(cur).prevAll(tag).length + 1;
    parts.unshift(`${tag}:nth-of-type(${idx})`);
    cur = cur.parent as Element | null;
  }
  return parts.join(' > ');
}

function cssEscape(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// --- richness gate --------------------------------------------------------

/** A card is content-rich iff: heading-like AND (image OR text-link) AND non-trivial text. */
function isRichCard($: CheerioAPI, el: Element): boolean {
  const $el = $(el);
  const hasHeading =
    $el.find('h1,h2,h3,h4,h5,h6').length > 0 ||
    $el.find('[class*="title" i],[class*="headline" i]').length > 0;
  const hasImage =
    $el.find('img[src],source[srcset]').length > 0 ||
    Boolean($el.find('[style*="background-image" i]').attr('style'));
  const textLink = $el.find('a[href]').toArray().some((a) => $(a).text().trim().length > 0);
  const textLen = $el.text().replace(/\s+/g, ' ').trim().length;
  return hasHeading && (hasImage || textLink) && textLen >= 20;
}

// --- field/role extraction ------------------------------------------------

function firstHeadingText($el: Cheerio<Element>): string {
  const h = $el.find('h1,h2,h3,h4,h5,h6').first();
  if (h.length && h.text().trim()) return h.text().replace(/\s+/g, ' ').trim();
  const titled = $el.find('[class*="title" i],[class*="headline" i]').first();
  return titled.text().replace(/\s+/g, ' ').trim();
}

function ownHeadingText($: CheerioAPI, el: Element): string {
  return $(el).children('h1,h2,h3,h4,h5,h6').first().text().replace(/\s+/g, ' ').trim();
}

function imageUrl($el: Cheerio<Element>): string {
  const img = $el.find('img[src]').first().attr('src');
  if (img) return img;
  const styled = $el.find('[style*="background-image" i]').first().attr('style') ?? '';
  const m = styled.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  return m ? m[1] : '';
}

function categoryAnchorScore($: CheerioAPI, el: Element): number {
  const $el = $(el);
  return $el.is('[class*="cat" i],[class*="tag" i]') || $el.closest('[class*="cat" i],[class*="tag" i]').length > 0 ? 1 : 0;
}

function extractCardFields($: CheerioAPI, el: Element, index: number): CardFields {
  const $el = $(el);
  const title = firstHeadingText($el);
  // Primary link: the title's anchor if present, else the first non-empty anchor.
  const titleAnchor = $el.find('h1,h2,h3,h4,h5,h6').first().find('a[href]').first().attr('href');
  const firstAnchor = $el.find('a[href]').toArray().map((a) => $(a).attr('href')).find(Boolean);
  const link = titleAnchor ?? firstAnchor ?? '';
  const image = imageUrl($el);
  const excerpt = $el.find('p').first().text().replace(/\s+/g, ' ').trim();
  const time = $el.find('time').first().text().trim();
  const date = (time || ($el.text().match(DATE_RE)?.[0] ?? '')).trim();
  // Category: a short label anchor that is NOT the title/link target.
  const categoryCandidates = $el
    .find('a[href]')
    .toArray()
    .map((a, order) => ({
      href: $(a).attr('href') ?? '',
      text: $(a).text().replace(/\s+/g, ' ').trim(),
      order,
      score: categoryAnchorScore($, a as Element),
    }))
    .filter((a) => a.text && a.text !== title && a.href !== link && a.text.length <= CATEGORY_MAX_LEN)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  const category = categoryCandidates[0]?.text ?? '';
  const id = slugify(title) || slugify(link.replace(/\.[a-z]+$/i, '')) || `card-${index + 1}`;
  return { id, title, excerpt, image, category, date, link, meta: {} };
}

// --- deterministic data-dla-* template ------------------------------------

/** Build the card template by annotating a CLONE of the source card with data-dla-* bindings. */
function buildCardTemplate($: CheerioAPI, card: Element, fields: CardFields): string {
  const $c = cheerio.load($.html(card), undefined, false);
  const root = $c.root().children().first();

  // title — the heading (text lives on it or its inner anchor)
  if (fields.title) {
    const h = root.find('h1,h2,h3,h4,h5,h6').first();
    const target = h.find('a[href]').first().length ? h.find('a[href]').first() : h;
    if (target.length) target.attr('data-dla-text', 'title').text('');
  }
  // excerpt → content
  if (fields.excerpt) {
    const node = root.find('p').toArray().find((n) => $c(n).text().replace(/\s+/g, ' ').trim() === fields.excerpt);
    if (node) $c(node).attr('data-dla-text', 'content').text('');
  }
  // category → cat.label
  if (fields.category) {
    const catNode = root
      .find('a[href]')
      .toArray()
      .find((n) => $c(n).text().replace(/\s+/g, ' ').trim() === fields.category);
    if (catNode) $c(catNode).attr('data-dla-text', 'cat.label').text('');
  }
  // date → meta.date
  if (fields.date) {
    const t = root.find('time').first();
    if (t.length) {
      t.attr('data-dla-text', 'meta.date').text('');
    } else {
      const node = root.find('span').toArray().find((n) => $c(n).text().replace(/\s+/g, ' ').trim() === fields.date);
      if (node) $c(node).attr('data-dla-text', 'meta.date').text('');
    }
  }
  // image → meta.image
  if (fields.image) {
    const img = root.find('img[src]').first();
    if (img.length) img.attr('data-dla-attr', 'src:meta.image').removeAttr('src');
  }
  // Append a binding to an element's data-dla-attr (preserving any existing one).
  const addAttr = (node: cheerio.Cheerio<Element>, spec: string): void => {
    const prev = node.attr('data-dla-attr');
    node.attr('data-dla-attr', prev ? `${prev},${spec}` : spec);
  };
  // Post-detail links → this post's permalink. The source mockup points every
  // card at one static detail page (fields.link); rebind every anchor that
  // targets it so each card links to its own post.
  if (fields.link) {
    root
      .find('a[href]')
      .toArray()
      .forEach((n) => {
        if (($c(n).attr('href') ?? '') === fields.link) addAttr($c(n), 'href:permalink');
      });
  }
  // Category anchor → its term archive (was a static archive href).
  if (fields.category) {
    const cat = root.find('[data-dla-text="cat.label"]').first();
    if (cat.length && cat.is('a[href]')) addAttr(cat, 'href:cat.url');
  }
  return ($c.html(root) ?? '').trim();
}

function detectFeaturedGrid(
  $: CheerioAPI,
  container: Element,
  richCards: Element[]
): DiscoveredCardGrid['featured'] | undefined {
  const leadCards = richCards.filter((card) => card.parent === container);
  const rest = richCards.filter((card) => card.parent !== container);
  const byParent = new Map<Element, Element[]>();
  for (const card of rest) {
    const parent = card.parent as Element | null;
    if (!parent || parent.type !== 'tag') continue;
    const group = byParent.get(parent) ?? [];
    group.push(card);
    byParent.set(parent, group);
  }
  if (leadCards.length < 1 || byParent.size !== 1) return undefined;
  const [[wrapper, columnCards]] = [...byParent.entries()];
  if (columnCards.length < 2) return undefined;
  if (leadCards.length + columnCards.length !== richCards.length) return undefined;
  if (!isDescendant(wrapper, container)) return undefined;
  if (richCards.includes(wrapper)) return undefined;

  const sectionTermSlugs = [...leadCards, ...columnCards]
    .map((card) => slugify(extractCardFields($, card, 0).category))
    .filter(Boolean);
  const termSlug =
    sectionTermSlugs.length > 0 && sectionTermSlugs.every((slug) => slug === sectionTermSlugs[0])
      ? sectionTermSlugs[0]
      : undefined;

  return {
    leadCount: leadCards.length,
    columnWrapperClass: ($(wrapper).attr('class') ?? '').trim(),
    leadTemplate: buildCardTemplate($, leadCards[0], extractCardFields($, leadCards[0], 0)),
    rowTemplate: buildCardTemplate($, columnCards[0], extractCardFields($, columnCards[0], 0)),
    ...(termSlug ? { termSlug } : {}),
  };
}

// --- assembly -------------------------------------------------------------

function buildGrid(
  $: CheerioAPI,
  cards: Element[],
  signature: string,
  opts: DiscoverHtmlCardsOptions
): DiscoveredCardGrid {
  const container = safeGridContainer($, cards);
  const containerSelector = uniqueSelector($, container);
  const containerClass = ($(container).attr('class') ?? '').trim();
  const richCards = cards.filter((c) => isRichCard($, c));
  if (richCards.length < MIN_CARDS) {
    return {
      containerSelector,
      containerClass,
      records: [],
      cardTemplate: '',
      confidence: 'low',
      evidence: `rejected by richness gate: ${richCards.length}/${cards.length} content-rich :: ${signature}`,
    };
  }
  const fields = richCards.map((c, i) => extractCardFields($, c, i));
  const records: Array<Record<string, unknown>> = fields.map((f) => {
    const rec: Record<string, unknown> = { id: f.id, title: f.title, link: f.link, excerpt: f.excerpt };
    if (f.image) rec.image = f.image;
    if (f.category) rec.category = f.category;
    if (f.date) rec.date = f.date;
    for (const [k, v] of Object.entries(f.meta)) rec[`meta_${k}`] = v;
    return rec;
  });

  // Body sourcing: follow links. Count target frequency to detect shared targets.
  const targetCount = new Map<string, number>();
  for (const f of fields) if (f.link) targetCount.set(f.link, (targetCount.get(f.link) ?? 0) + 1);
  for (let i = 0; i < records.length; i++) {
    const link = fields[i].link;
    const shared = link ? (targetCount.get(link) ?? 0) > 1 : false;
    let body = fields[i].excerpt; // default: excerpt
    if (opts.resolvePage && link && !shared) {
      try {
        const linkedHtml = opts.resolvePage(link);
        if (linkedHtml) {
          const extracted = extractMainContent(linkedHtml);
          if (extracted && extracted.trim()) body = extracted;
        }
      } catch {
        // resolver is best-effort; keep the excerpt body
      }
    }
    records[i].content = body;
  }

  const sharedTargets = [...targetCount.entries()].filter(([, n]) => n > 1).map(([t]) => t);
  const sharedNote = sharedTargets.length ? ` shared-target(single-template)=${sharedTargets.join(',')}` : '';
  const titlesOk = fields.every((f) => f.title);
  const template = buildCardTemplate($, richCards[0], fields[0]);
  const featured = detectFeaturedGrid($, container, richCards);
  return {
    containerSelector,
    containerClass,
    records,
    cardTemplate: template,
    ...(featured ? { featured } : {}),
    confidence: titlesOk && template ? 'high' : 'low',
    evidence: `signature=${signature} cards=${richCards.length} roles=title,excerpt,image,category,date,link${sharedNote}`,
  };
}

function groupRichCandidates(candidates: RichCandidate[]): RichCandidateGroup[] {
  const bySig = new Map<string, RichCandidateGroup>();
  for (const candidate of candidates) {
    const group = bySig.get(candidate.sig) ?? { sig: candidate.sig, candidates: [], richCards: [] };
    group.candidates.push(candidate);
    for (const card of candidate.richCards) {
      if (!group.richCards.includes(card)) group.richCards.push(card);
    }
    bySig.set(candidate.sig, group);
  }
  return [...bySig.values()];
}

function containmentCounts(outerCards: Element[], innerCards: Element[]): number[] {
  return outerCards.map((outerCard) => innerCards.filter((innerCard) => isDescendant(innerCard, outerCard)).length);
}

function classifyOneToOneNesting($: CheerioAPI, outerCards: Element[], innerCards: Element[]): OneToOneNestingClassification {
  let coveredOuterCount = 0;
  let sawDifferentHeadings = false;
  for (const outerCard of outerCards) {
    const contained = innerCards.filter((innerCard) => isDescendant(innerCard, outerCard));
    if (contained.length === 0) continue;
    if (contained.length !== 1) return 'none';
    const outerTitle = firstHeadingText($(outerCard));
    const innerTitle = firstHeadingText($(contained[0]));
    if (outerTitle && innerTitle && outerTitle !== innerTitle) sawDifferentHeadings = true;
    coveredOuterCount += 1;
  }
  if (coveredOuterCount < MIN_CARDS || coveredOuterCount !== innerCards.length) return 'none';
  return sawDifferentHeadings ? 'wrapper' : 'part';
}

function selectCardLevelCandidates($: CheerioAPI, candidates: RichCandidate[]): RichCandidate[] {
  const dropCandidates = new Set<RichCandidate>();
  const dropSignatures = new Set<string>();
  const groups = groupRichCandidates(candidates);
  for (const outer of candidates) {
    for (const inner of groups) {
      if (outer.sig === inner.sig) continue;
      const counts = containmentCounts(outer.richCards, inner.richCards);
      if (counts.every((count) => count >= MIN_CARDS)) dropCandidates.add(outer);
    }
  }
  for (const outer of groups) {
    for (const inner of groups) {
      if (outer === inner) continue;
      const counts = containmentCounts(outer.richCards, inner.richCards);
      const covered = counts.reduce((sum, count) => sum + count, 0);
      if (covered !== inner.richCards.length) continue;
      const classification = classifyOneToOneNesting($, outer.richCards, inner.richCards);
      if (classification === 'part') {
        dropSignatures.add(inner.sig);
      } else if (classification === 'wrapper') {
        outer.candidates.forEach((candidate) => dropCandidates.add(candidate));
      }
    }
  }
  return candidates.filter((candidate) => !dropCandidates.has(candidate) && !dropSignatures.has(candidate.sig));
}

function safeGridContainer($: CheerioAPI, cards: Element[]): Element {
  const parent = cards[0].parent as Element | null;
  if (parent && parent.type === 'tag' && !$(parent).is(UNSAFE_MOUNT_CONTAINER_SELECTOR)) return parent;
  if (shouldUseCardRootFallback($, cards)) return cards[0];
  return parent ?? cards[0];
}

function shouldUseCardRootFallback($: CheerioAPI, cards: Element[]): boolean {
  if (cards.length < MIN_CARDS || cards[0].tagName?.toLowerCase() !== 'article') return false;
  const parents = [...new Set(cards.map((card) => card.parent as Element | null).filter((parent): parent is Element => Boolean(parent)))];
  if (parents.length < MIN_CARDS || parents.some((parent) => parent.tagName?.toLowerCase() !== 'section')) return false;
  if (parents.some((parent) => cards.filter((card) => card.parent === parent).length !== 1)) return false;
  return cards.some((card) => {
    const wrapperHeading = ownHeadingText($, card.parent as Element);
    const cardHeading = firstHeadingText($(card));
    return Boolean(wrapperHeading && cardHeading && wrapperHeading !== cardHeading);
  });
}

export function discoverHtmlCards(html: string, opts: DiscoverHtmlCardsOptions = {}): DiscoveredCardGrid[] {
  const $ = cheerio.load(html);
  const body = $('body')[0] as Element | undefined;
  const allEls = body ? descendants($, body) : [];
  const bySig = new Map<string, Element[]>();
  for (const el of allEls) {
    if ($(el).children().length === 0) continue; // leaf elements can't be cards
    const sig = structuralSignature($, el);
    const list = bySig.get(sig) ?? [];
    list.push(el);
    bySig.set(sig, list);
  }
  // Collect candidate grids across every frequent signature.
  const candidates: Candidate[] = [];
  for (const [sig, els] of bySig) {
    if (els.length < MIN_CARDS) continue;
    for (const gridCards of clusterToGrids($, els)) {
      if (gridCards.length >= MIN_CARDS) candidates.push({ cards: gridCards, sig });
    }
  }
  const richCandidates = candidates
    .map((candidate) => ({ ...candidate, richCards: candidate.cards.filter((card) => isRichCard($, card)) }))
    .filter((candidate) => candidate.richCards.length >= MIN_CARDS);
  const cardLevel = selectCardLevelCandidates($, richCandidates);

  const out: DiscoveredCardGrid[] = [];
  for (const { cards, sig } of cardLevel) {
    const grid = buildGrid($, cards, sig, opts);
    if (grid.records.length > 0) out.push(grid);
  }
  return out;
}
