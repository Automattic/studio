import * as cheerio from 'cheerio';

// Structural chrome that is never primary content. Removed from whatever region
// we settle on, so a breadcrumb <nav> or boilerplate <footer> nested inside the
// content area doesn't leak into the extracted body.
const CHROME = 'nav, header, footer, aside, iframe, form';
// Noise removed globally before any selection/scoring — script/style text would
// otherwise inflate a wrapper's density score and pollute the extracted prose.
const NOISE = 'script, style, noscript, template';

/** Strip chrome from an HTML fragment; return '' if nothing textual survives. */
function cleanHtml(innerHtml: string): string {
  const $ = cheerio.load(innerHtml, undefined, false);
  $(CHROME).remove();
  if (!$.root().text().trim()) return '';
  return ($.root().html() ?? '').trim();
}

/**
 * Platform-agnostic main-content extraction for the `default` (fallback) adapter.
 *
 * Unlike the platform adapters — which key off a known content container
 * (`.w-richtext`, `.sqs-block`, …) — this has no markup to rely on, so it:
 *   1. Honors the author's semantic signal: <main> → <article> → [role=main].
 *   2. Otherwise picks the densest block (text² / html length), which favors a
 *      prose-heavy article container over markup-heavy wrappers and link-heavy
 *      navigation rails.
 * The chosen region is then stripped of nested chrome.
 */
export function extractMainContent(html: string): string {
  const $ = cheerio.load(html);
  $(NOISE).remove();

  for (const sel of ['main', 'article', '[role="main"]']) {
    const el = $(sel).first();
    if (el.length && el.text().trim()) {
      const cleaned = cleanHtml(el.html() ?? '');
      if (cleaned) return cleaned;
    }
  }

  let bestScore = 0;
  let bestInner = '';
  $('div, section').each((_, node) => {
    const sel = $(node);
    const text = sel.text().trim();
    if (!text) return;
    const outerLen = ($.html(node) || '').length || 1;
    const score = (text.length * text.length) / outerLen;
    if (score > bestScore) {
      bestScore = score;
      bestInner = sel.html() ?? '';
    }
  });
  if (bestInner) {
    const cleaned = cleanHtml(bestInner);
    if (cleaned) return cleaned;
  }

  return cleanHtml($('body').html() ?? '');
}

// ---------------------------------------------------------------------------
// JSON-LD — drives content-type classification and the products path. The
// shared extraction loop reads Product schema out of `ExtractedPage.content`
// (via extractProductFromHtml), so the glue re-attaches a product script there.
// ---------------------------------------------------------------------------

/** Flatten a parsed JSON-LD value: unwrap arrays and `@graph` into a node list. */
function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) return (obj['@graph'] as unknown[]).flatMap(flattenJsonLd);
    return [obj];
  }
  return [];
}

/** Parse every `<script type="application/ld+json">` block; skip malformed ones. */
export function parseJsonLd(html: string): unknown[] {
  const $ = cheerio.load(html);
  const out: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, node) => {
    const raw = ($(node).html() ?? $(node).text() ?? '').trim();
    if (!raw) return;
    try {
      out.push(...flattenJsonLd(JSON.parse(raw)));
    } catch {
      // Malformed JSON-LD — skip this block, keep the rest.
    }
  });
  return out;
}

const POST_TYPES = new Set(['Article', 'NewsArticle', 'BlogPosting', 'Report', 'TechArticle', 'ScholarlyArticle']);

function typesOf(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const t = (node as Record<string, unknown>)['@type'];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  if (typeof t === 'string') return [t];
  return [];
}

/**
 * Classify a page from its JSON-LD. Product wins over article (a store page may
 * carry both). Returns undefined when nothing content-bearing is present, so the
 * caller can fall back to URL-based classification.
 */
export function detectTypeFromJsonLd(jsonLd: unknown[]): 'product' | 'post' | undefined {
  const allTypes = jsonLd.flatMap(typesOf);
  if (allTypes.includes('Product')) return 'product';
  if (allTypes.some((t) => POST_TYPES.has(t))) return 'post';
  return undefined;
}

/**
 * Serialize the first Product node back into an ld+json script tag, so it can be
 * appended to the extracted `content` for the shared loop's product extractor.
 * Returns null when there is no Product.
 */
export function productLdJsonScript(jsonLd: unknown[]): string | null {
  const product = jsonLd.find((n) => typesOf(n).includes('Product'));
  if (!product) return null;
  return `<script type="application/ld+json">${JSON.stringify(product)}</script>`;
}
