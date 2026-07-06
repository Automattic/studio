// src/lib/replicate/normalize/segment.ts
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import { isTag, isText } from 'domhandler';
import type { AnyNode, Element } from 'domhandler';
import { escapeHtml } from './emit-blocks.js';
import type { Section, SectionRole } from '../local-site/types.js';

/** Non-rendering top-level tags that never become body sections. */
const SKIP_TAGS = new Set(['script', 'style', 'link', 'template', 'noscript']);
const LANDMARK_TAGS = new Set(['main', 'nav', 'header', 'footer', 'section', 'article']);
const CONTENT_LANDMARK_TAGS = new Set(['main', 'article', 'section']);
const CONTENT_LANDMARK_ROLES = new Set(['main', 'article', 'region']);
const CHROME_LANDMARK_TAGS = new Set(['header', 'nav', 'footer']);
const ACTIONABLE_TEXT_MIN = 24;

type LayoutWrapperRailPosition = 'beforeMain' | 'afterMain';

interface LayoutRailWrapperMetadata {
  layoutWrapperTag: string;
  layoutWrapperClasses: string[];
  layoutWrapperRailPosition: LayoutWrapperRailPosition;
}

/** Slugify a short text run for use in an id. */
function textSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Hash-branch id — shared by stableId's fallback and synthetic text sections. */
function hashId(html: string, ordinal: number): string {
  const hash = createHash('sha1').update(html).digest('hex').slice(0, 8);
  return `section-${hash}-${ordinal}`;
}

/**
 * Stable id: existing id → heading-text slug → first class → content hash.
 * Heading slug beats class so utility-first markup (class="flex mt-8") yields
 * a meaningful, collision-resistant id instead of "flex".
 */
function stableId($: CheerioAPI, el: Element, ordinal: number): string {
  const $el = $(el);
  const existing = $el.attr('id');
  if (existing) return existing;
  const heading = $el.find('h1,h2,h3').first().text();
  const slug = heading.trim() ? textSlug(heading) : '';
  if (slug) {
    // Don't let the section anchor collide with a DESCENDANT id — a source
    // <h2 id="features">Features</h2> yields slug "features", which would
    // duplicate the heading's own id. Beyond invalid HTML, the duplicate shadows
    // the heading for any #id-keyed lookup: a parity/diff pass probing source
    // #features (the heading) but replica #features (the section) patches the
    // wrong element (e.g. forcing display/margin), collapsing the section.
    return $el.find(`[id="${slug}"]`).length > 0 ? `${slug}-section` : slug;
  }
  const cls = ($el.attr('class') ?? '').split(/\s+/).filter(Boolean)[0];
  if (cls) return cls;
  return hashId($.html(el) ?? '', ordinal);
}

function roleOf($el: Cheerio<Element>): string {
  return ($el.attr('role') ?? '').trim().toLowerCase();
}

function classList($el: { attr(name: string): string | undefined }): string[] {
  return ($el.attr('class') ?? '').split(/\s+/).filter(Boolean);
}

function nearestLandmarkAncestor(el: Element): string | null {
  for (let a = el.parent; a && a.type === 'tag'; a = a.parent) {
    const tag = (a as Element).tagName?.toLowerCase() ?? '';
    if (LANDMARK_TAGS.has(tag)) return tag;
  }
  return null;
}

function hasContentLandmarkAncestor($: CheerioAPI, el: Element): boolean {
  for (let a = el.parent; a && a.type === 'tag'; a = a.parent) {
    const ancestor = a as Element;
    const tag = ancestor.tagName?.toLowerCase() ?? '';
    if (CONTENT_LANDMARK_TAGS.has(tag) || CONTENT_LANDMARK_ROLES.has(roleOf($(ancestor)))) return true;
  }
  return false;
}

function isActionableComplementary($: CheerioAPI, el: Element): boolean {
  const $el = $(el);
  const textLength = $el.text().replace(/\s+/g, ' ').trim().length;
  const linkCount = $el.find('a[href]').length;
  return textLength >= ACTIONABLE_TEXT_MIN || linkCount >= 2;
}

function hasContentLandmarkDescendant($: CheerioAPI, el: Element): boolean {
  return ($(el).find('main,article,section,[role]').toArray() as Element[]).some((child) => {
    const tag = child.tagName?.toLowerCase() ?? '';
    return CONTENT_LANDMARK_TAGS.has(tag) || CONTENT_LANDMARK_ROLES.has(roleOf($(child)));
  });
}

function isLayoutChromeCandidate($: CheerioAPI, el: Element): boolean {
  const $el = $(el);
  const tag = el.tagName?.toLowerCase() ?? '';
  const role = roleOf($el);
  const isNav = tag === 'nav' || role === 'navigation';
  const isComplementary = tag === 'aside' || role === 'complementary';
  if (!isNav && !isComplementary) return false;
  if (hasContentLandmarkAncestor($, el)) return false;
  if (hasContentLandmarkDescendant($, el)) return false;
  const nearest = nearestLandmarkAncestor(el);
  if (nearest && CONTENT_LANDMARK_TAGS.has(nearest)) return false;
  if (nearest && CHROME_LANDMARK_TAGS.has(nearest)) return false;
  return isNav || isActionableComplementary($, el);
}

function findLayoutRailWrapper($: CheerioAPI, rail: Element): LayoutRailWrapperMetadata | null {
  if (!rail.parent || !isTag(rail.parent)) return null;
  const parent = rail.parent as Element;
  const tag = parent.tagName?.toLowerCase() ?? '';
  if (!tag || tag === 'body' || tag === 'html') return null;

  const pageMain = $('main').first().get(0);
  if (!pageMain || !isTag(pageMain)) return null;

  const descendants = $(parent).find('*').toArray() as Element[];
  const railIndex = descendants.findIndex((node) => node === rail);
  const mainIndex = descendants.findIndex((node) => node === pageMain);
  if (railIndex < 0 || mainIndex < 0 || railIndex === mainIndex) return null;

  return {
    layoutWrapperTag: tag,
    layoutWrapperClasses: classList($(parent)),
    layoutWrapperRailPosition: railIndex < mainIndex ? 'beforeMain' : 'afterMain',
  };
}

export function segmentPage(html: string): Section[] {
  const $ = cheerio.load(html);
  const sections: Section[] = [];

  // Track the exact elements captured as chrome so the body iteration (which
  // walks ALL top-level nodes when there is no <main>) never double-captures
  // them as body sections.
  const classesOf = (el: ReturnType<typeof $>): string[] =>
    classList(el);

  const chromeEls = new Set<Element>();
  const pushChrome = (selector: string, role: SectionRole): void => {
    const el = $(selector).first();
    if (el.length) {
      chromeEls.add(el.get(0) as Element);
      // classes unused by the native-block header path (buildHeaderPart builds
      // its own); footer path consumes them.
      sections.push({ id: role, role, html: $.html(el) ?? '', classes: classesOf(el) });
    }
  };
  // Strict body-direct landmarks only. A comma-fallback (bare `header`) would
  // grab nested landmarks — e.g. an <article>'s own <header> — misclassifying
  // them as page chrome AND double-capturing them inside the body section.
  // Missing chrome = emit nothing. A nav INSIDE the header stays embedded in
  // the header's html (not captured separately).
  pushChrome('body > header', 'header');
  pushChrome('body > nav', 'nav');
  pushChrome('body > footer', 'footer');

  let layoutChromeOrdinal = 0;
  for (const el of $('body').find('aside, nav, [role]').toArray() as Element[]) {
    if (chromeEls.has(el)) continue;
    if (($(el).parents().toArray() as Element[]).some((parent) => chromeEls.has(parent))) continue;
    if (!isLayoutChromeCandidate($, el)) continue;
    chromeEls.add(el);
    const $el = $(el);
    const section: Section & Partial<LayoutRailWrapperMetadata> = {
      id: stableId($, el, layoutChromeOrdinal),
      role: 'nav',
      chromeSource: 'layout-rail',
      html: $.html(el) ?? '',
      classes: classesOf($el),
    };
    Object.assign(section, findLayoutRailWrapper($, el) ?? {});
    sections.push(section);
    $el.remove();
    layoutChromeOrdinal += 1;
  }

  // Body content = EVERY top-level node — wrapper elements (section/article/div)
  // AND loose content (figure/h1/p/img/…) AND nonempty text nodes. When a <main>
  // exists its CHILDREN are the body (the <main> wrapper is unwrapped); loose
  // body-level SIBLINGS of <main> are carried TOO (a .grain overlay before
  // <header>, a sticky .marquee between header and main) — neither chrome nor
  // inside <main>, they were previously dropped. The <main> expands in place even
  // when nested in a layout wrapper, so the wrapper still yields main's children,
  // not the wrapper itself. No <main> → every top-level body node is a section.
  const mainEl = $('main').first().get(0) ?? null;
  // True when a body-level node IS <main> or is an ANCESTOR of it (the layout
  // wrapper holding <main>): that slot expands to main's own children.
  const isMainSlot = (node: Element): boolean => {
    if (!mainEl) return false;
    if (node === mainEl) return true;
    for (let p = mainEl.parent; p && isTag(p); p = p.parent) if (p === node) return true;
    return false;
  };
  // Flatten body's top-level nodes in DOM order, expanding the <main> slot to its
  // own children in place. Loose siblings keep their position relative to main.
  const bodyNodes: AnyNode[] = [];
  for (const node of $('body').contents().get()) {
    if (isTag(node) && isMainSlot(node)) {
      for (const child of $(mainEl as Element).contents().get()) bodyNodes.push(child);
    } else {
      bodyNodes.push(node);
    }
  }
  let ordinal = 0;
  for (const node of bodyNodes) {
    if (isTag(node)) {
      if (SKIP_TAGS.has(node.tagName?.toLowerCase() ?? '')) continue;
      if (chromeEls.has(node)) continue; // already captured as chrome
      sections.push({ id: stableId($, node, ordinal), role: 'body', html: $.html(node) ?? '', classes: classesOf($(node)) });
      ordinal += 1;
    } else if (isText(node)) {
      const text = node.data.trim();
      if (!text) continue;
      // node.data is entity-DECODED — wrap it RE-ESCAPED so tag-shaped display
      // text (a source showing "&lt;b&gt;bold&lt;/b&gt;") stays literal text
      // when the emitter re-parses the wrapper, instead of becoming real
      // markup (or, for "<script>…", getting eaten entirely). The emitter
      // decodes and re-escapes on extraction, so the final block markup is
      // identical for plain text and correct for tag-shaped text.
      const html = `<p>${escapeHtml(text)}</p>`;
      sections.push({ id: hashId(html, ordinal), role: 'body', html, classes: [] });
      ordinal += 1;
    }
    // Comments and other node types: skipped.
  }

  // Dedup duplicate body-section ids with ordinal suffixes (deterministic,
  // DOM order — matches the media filename-collision convention). Two
  // class="card" sections are normal; a silent pageContent[id] overwrite
  // downstream is not. The `used` set is seeded with ALL body ids so a
  // generated suffix never collides with a pre-existing literal id (e.g. a
  // source <section id="card-2"> alongside two class="card" sections).
  const used = new Set(sections.filter((s) => s.role === 'body').map((s) => s.id));
  const seen = new Map<string, number>();
  for (const s of sections) {
    if (s.role !== 'body') continue;
    const count = (seen.get(s.id) ?? 0) + 1;
    seen.set(s.id, count);
    if (count > 1) {
      let n = count;
      let candidate = `${s.id}-${n}`;
      while (used.has(candidate)) candidate = `${s.id}-${++n}`;
      used.add(candidate);
      s.id = candidate;
    }
  }

  return sections;
}
