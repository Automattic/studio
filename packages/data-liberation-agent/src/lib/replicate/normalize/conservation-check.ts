import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { buildSelector } from '../section-selector.js';
import type { Section } from '../local-site/types.js';
import { segmentPage } from './segment.js';
import type { ConservationLeak, ConservationLeakRole } from './conservation-leak.js';

// Keep in lockstep with region-audit.ts. Exported for tests and future slice-3 reuse.
export const CONSERVATION_ACTIONABLE_TEXT_MIN = 24;

export interface ConservationRegion {
  selector: string;
  role: ConservationLeakRole;
  sectionId: string;
  html: string;
  text: string;
  linkCount: number;
  classes: string[];
}

export interface ConservationCheckInput {
  pageSlug: string;
  sourceHtml: string;
  postContent: string;
  partMarkup?: string[];
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function rootElement($: CheerioAPI): Element | null {
  const direct = $('body').children().first().get(0);
  if (direct) return direct as Element;
  return $.root().children().first().get(0) as Element | undefined ?? null;
}

function conservationRole(section: Section, $: CheerioAPI, el: Element): ConservationLeakRole {
  const tag = el.tagName?.toLowerCase() ?? '';
  const attrRole = ($(el).attr('role') ?? '').trim().toLowerCase();
  if (tag === 'header' || tag === 'nav' || tag === 'footer' || tag === 'aside') return tag;
  if (attrRole === 'navigation') return 'nav';
  if (attrRole === 'complementary') return 'complementary';
  if (attrRole) return 'region';
  if (section.role === 'header' || section.role === 'nav' || section.role === 'footer') return section.role;
  return 'body';
}

function isSemanticRegion(region: ConservationRegion): boolean {
  return region.role !== 'body';
}

function isActionable(region: ConservationRegion): boolean {
  return (
    isSemanticRegion(region) ||
    region.linkCount >= 2 ||
    region.text.length >= CONSERVATION_ACTIONABLE_TEXT_MIN
  );
}

function sectionRegion(section: Section): ConservationRegion {
  const $ = cheerio.load(section.html);
  const el = rootElement($);
  const tag = el?.tagName?.toLowerCase() || 'section';
  const $el = el ? $(el) : $('body');
  const id = ($el.attr('id') ?? '').trim() || null;
  const classes = (section.classes?.length ? section.classes : ($el.attr('class') ?? '').split(/\s+/)).filter(Boolean);
  return {
    selector: buildSelector({ tag, id, classes, nthOfType: 1 }),
    role: el ? conservationRole(section, $, el) : section.role,
    sectionId: section.id,
    html: section.html,
    text: normalizeText($el.text()),
    linkCount: $el.find('a[href]').length + (tag === 'a' && $el.attr('href') ? 1 : 0),
    classes,
  };
}

export function extractConservationRegions(sourceHtml: string): ConservationRegion[] {
  return segmentPage(sourceHtml)
    .map(sectionRegion)
    .filter(isActionable);
}

function placedIds($: CheerioAPI): Set<string> {
  const ids = new Set<string>();
  $('[id]').each((_, el) => {
    const id = $(el).attr('id');
    if (id) ids.add(id);
  });
  return ids;
}

function hasBlockAnchor(markup: string, sectionId: string): boolean {
  return markup.includes(`"anchor":${JSON.stringify(sectionId)}`);
}

function isPlaced(region: ConservationRegion, placedMarkup: string, $placed: CheerioAPI, placedText: string): boolean {
  const ids = placedIds($placed);
  if (ids.has(region.sectionId) || hasBlockAnchor(placedMarkup, region.sectionId)) return true;

  const selectorId = /#([A-Za-z0-9_-]+)/.exec(region.selector)?.[1];
  if (selectorId && ids.has(selectorId)) return true;

  if (region.role === 'body' && region.text.length >= CONSERVATION_ACTIONABLE_TEXT_MIN && placedText.includes(region.text)) return true;

  return false;
}

export function checkConservationLeaks(input: ConservationCheckInput): ConservationLeak[] {
  const placedMarkup = [input.postContent, ...(input.partMarkup ?? [])].filter(Boolean).join('\n');
  const $placed = cheerio.load(placedMarkup);
  const placedText = normalizeText($placed.text());
  return extractConservationRegions(input.sourceHtml)
    .filter((region) => !isPlaced(region, placedMarkup, $placed, placedText))
    .map((region) => ({
      selector: region.selector,
      role: region.role,
      pageSlug: input.pageSlug,
      reason: 'actionable_region_unplaced',
    }));
}
