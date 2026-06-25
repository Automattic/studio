import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { MountSpec } from './types.js';
import { structuralSignature } from './discover-html-cards.js';
import { anchorId } from './string-utils.js';

export interface NeutralizeStaticCardsResult {
  html: string;
  /** Mount selectors (#id) that were stamped onto a container in this page. */
  stamped: string[];
  /** Mount selectors (#id) skipped because neutralization would target an unsafe container. */
  skipped?: string[];
}

const LANDMARK_CONTAINER_TAGS = new Set(['html', 'body', 'main']);
const CARD_ROOT_CONTAINER_TAGS = new Set(['article']);
const MIN_REPEATED_CARD_SIGNATURE_COUNT = 3;

function isFullHtmlDocument(html: string): boolean {
  return /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html);
}

/**
 * For each static-card mount (carrying `sourceSelector`) whose container resolves
 * in `html`: empty the card-signature children (the dominant repeated child shape),
 * preserve any non-card siblings, and stamp the synthetic id from `mount.selector`.
 * Pure + best-effort: a mount whose container/anchor can't be resolved is skipped.
 */
export function neutralizeStaticCards(html: string, mounts: MountSpec[]): NeutralizeStaticCardsResult {
  const $ = isFullHtmlDocument(html) ? cheerio.load(html) : cheerio.load(html, undefined, false);
  const stamped: string[] = [];
  const skipped: string[] = [];
  for (const mount of mounts) {
    if (!mount.sourceSelector) continue;
    const id = anchorId(mount.selector);
    if (!id) continue;
    let container: Element | undefined;
    try {
      container = $(mount.sourceSelector).first()[0] as Element | undefined;
    } catch {
      continue;
    }
    if (!container) continue;
    const tagName = container.tagName?.toLowerCase();
    if (tagName && (LANDMARK_CONTAINER_TAGS.has(tagName) || CARD_ROOT_CONTAINER_TAGS.has(tagName))) {
      skipped.push(mount.selector);
      continue;
    }
    const cardSig = safeCardSignature($, container);
    if (!cardSig) {
      skipped.push(mount.selector);
      continue;
    }
    const allDesc = $(container).find('*').toArray() as Element[];
    for (const el of allDesc) {
      if (structuralSignature($, el) === cardSig) $(el).remove();
    }
    $(container).children().toArray().forEach((c) => {
      if ($(c).children().length === 0 && !$(c).text().trim()) $(c).remove();
    });
    $(container).attr('id', id);
    stamped.push(mount.selector);
  }
  return { html: stamped.length > 0 ? $.html() : html, stamped, skipped };
}

function safeCardSignature($: cheerio.CheerioAPI, container: Element): string | undefined {
  const direct = repeatedSignature($, $(container).children().toArray() as Element[]);
  if (direct) return direct;

  return repeatedSignature($, $(container).find('article').toArray() as Element[]);
}

function repeatedSignature($: cheerio.CheerioAPI, elements: Element[]): string | undefined {
  const freq = new Map<string, number>();
  for (const el of elements) {
    const sig = structuralSignature($, el);
    freq.set(sig, (freq.get(sig) ?? 0) + 1);
  }
  const [sig, count] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return typeof sig === 'string' && count >= MIN_REPEATED_CARD_SIGNATURE_COUNT ? sig : undefined;
}
