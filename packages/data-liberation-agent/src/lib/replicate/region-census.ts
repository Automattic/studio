import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { isTag } from 'domhandler';
import type { Element } from 'domhandler';
import { buildSelector, type SelectorParts } from './section-selector.js';
import type { SourceLandmark } from './section-extract.js';

const LANDMARK_TAGS = new Set(['main', 'nav', 'header', 'footer', 'section', 'article', 'aside']);
const LANDMARK_SELECTOR = 'main,nav,header,footer,section,article,aside,[role="complementary"]';

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function roleOf($: CheerioAPI, el: Element): SourceLandmark['role'] {
  const ariaRole = ($(el).attr('role') ?? '').trim().toLowerCase();
  if (ariaRole === 'complementary') return 'complementary';
  const tag = el.tagName?.toLowerCase() ?? 'section';
  if (
    tag === 'main' || tag === 'nav' || tag === 'header' || tag === 'footer' ||
    tag === 'section' || tag === 'article' || tag === 'aside'
  ) {
    return tag;
  }
  return 'section';
}

function isLandmark($: CheerioAPI, el: Element): boolean {
  const tag = el.tagName?.toLowerCase() ?? '';
  return LANDMARK_TAGS.has(tag) || roleOf($, el) === 'complementary';
}

function hasLandmarkAncestor($: CheerioAPI, el: Element): boolean {
  for (let a = el.parent; a && isTag(a); a = a.parent) {
    if (isLandmark($, a as Element)) return true;
  }
  return false;
}

function isProbablyVisible($: CheerioAPI, el: Element): boolean {
  const $el = $(el);
  if ($el.attr('hidden') !== undefined) return false;
  if (($el.attr('aria-hidden') ?? '').trim().toLowerCase() === 'true') return false;
  const style = ($el.attr('style') ?? '').replace(/\s+/g, '').toLowerCase();
  return !/display:none|visibility:hidden/.test(style);
}

function selectorParts($: CheerioAPI, el: Element): SelectorParts {
  const tag = el.tagName.toLowerCase();
  let nthOfType = 1;
  for (let prev = el.prev; prev; prev = prev.prev) {
    if (isTag(prev) && (prev as Element).tagName?.toLowerCase() === tag) nthOfType += 1;
  }
  const $el = $(el);
  return {
    tag,
    id: ($el.attr('id') ?? '').trim() || null,
    classes: ($el.attr('class') ?? '').split(/\s+/).filter(Boolean),
    nthOfType,
  };
}

export function selectorForHtmlRoot(html: string): string | undefined {
  const $ = cheerio.load(html);
  const el = $('body').children().first().get(0) ?? $.root().children().first().get(0);
  if (!el || !isTag(el)) return undefined;
  return buildSelector(selectorParts($, el as Element));
}

export function landmarkRoleForHtmlRoot(html: string): SourceLandmark['role'] | undefined {
  const $ = cheerio.load(html);
  const el = $('body').children().first().get(0) ?? $.root().children().first().get(0);
  if (!el || !isTag(el)) return undefined;
  const element = el as Element;
  return isLandmark($, element) ? roleOf($, element) : undefined;
}

export function extractSourceLandmarksFromHtml(html: string): SourceLandmark[] {
  const $ = cheerio.load(html);
  const landmarks: SourceLandmark[] = [];
  const seen = new Set<Element>();

  $(LANDMARK_SELECTOR).each((_, node) => {
    if (!isTag(node)) return;
    const el = node as Element;
    if (seen.has(el)) return;
    seen.add(el);
    if (hasLandmarkAncestor($, el)) return;
    if (!isProbablyVisible($, el)) return;

    const $el = $(el);
    landmarks.push({
      role: roleOf($, el),
      tag: el.tagName.toLowerCase(),
      selector: buildSelector(selectorParts($, el)),
      textLength: normalizeText($el.text()).length,
      mediaCount: $el.find('img,video,picture').length,
      linkCount: $el.find('a[href]').length,
    });
  });

  return landmarks;
}
