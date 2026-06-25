// src/lib/replicate/variation-hoist.ts
// Post-emit variation hoisting (Neptune technique #6): identical instance
// `style` constellations recurring across the page set are hoisted into theme
// block-style-variation files (<theme>/styles/blocks/lib-<slug>.json) and the
// instances swap to `is-style-lib-<slug>` classes. Rendered CSS is identical
// by construction — same properties, hoisted channel; the win is dedupe +
// editor-native named styles. Exact-constellation match only (no subset
// merging). Fail-open everywhere: anything unparseable is left untouched.
// See docs/superpowers/specs/2026-06-10-neptune-best-parts-design.md (section D).
import { serializeBlockAttrs } from './form-blocks.js';

export const HOIST_MIN_INSTANCES = 3;

/** Slugs become theme file names (<theme>/styles/blocks/<slug>.json) AND
 *  is-style-* classNames — both demand a tight charset. Style keys come from
 *  markup JSON, so guard rather than trust (a hostile/odd key must not become
 *  a path segment). Mirrors builder-envelope's VARIATION_SLUG_RE. */
const HOIST_SLUG_RE = /^lib-[a-z0-9][a-z0-9-]*$/;

export interface HoistedVariation {
  slug: string;
  title: string;
  blockTypes: string[];
  styles: Record<string, unknown>;
  count: number;
}

export interface HoistPage { slug: string; markup: string; }
export interface HoistResult { pages: HoistPage[]; variations: HoistedVariation[]; }

interface BlockHit {
  pageIndex: number;
  /** Offset of the attrs JSON within the page markup. */
  attrStart: number;
  attrEnd: number;
  blockName: string;
  attrs: Record<string, unknown>;
}

const OPEN_RE = /<!--\s+wp:([a-z0-9-]+\/)?([a-z0-9-]+)\s+\{/g;

/** Stable stringify: object keys sorted recursively. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Balanced-brace scan starting at `start` (which must point at '{'). */
function balancedEnd(s: string, start: number): number {
  let depth = 0, inString = false, escape = false;
  for (let j = start; j < s.length; j++) {
    const c = s[j]!;
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

function findStyledBlocks(pages: HoistPage[]): BlockHit[] {
  const hits: BlockHit[] = [];
  pages.forEach((p, pageIndex) => {
    OPEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = OPEN_RE.exec(p.markup)) !== null) {
      const ns = m[1] ?? 'core/';
      const blockName = ns + m[2];
      if (blockName === 'core/html') continue;
      // jetpack/* blocks are NEVER hoisted: Jetpack's forms renderer regexes
      // `is-style-(\S+)` off the contact-form block's className (get_form_style
      // in class-contact-form-field.php) and treats ANY unknown is-style-* as a
      // form style variation — render_label() then returns '' and every field
      // label silently vanishes. A hoist swap (style → is-style-lib-*) on any
      // jetpack block is therefore a rendering-behavior change, not a pure
      // CSS-channel move. Same guard style as core/html above; covers both
      // hoistVariations and applyHoistSwaps (shared scan).
      if (blockName.startsWith('jetpack/')) continue;
      const attrStart = OPEN_RE.lastIndex - 1; // points at '{'
      const attrEnd = balancedEnd(p.markup, attrStart);
      if (attrEnd === -1) continue;
      try {
        const attrs = JSON.parse(p.markup.slice(attrStart, attrEnd + 1)) as Record<string, unknown>;
        if (typeof attrs.style === 'object' && attrs.style !== null) {
          hits.push({ pageIndex, attrStart, attrEnd, blockName, attrs });
        }
      } catch { /* fail-open: malformed attrs stay as-is */ }
      OPEN_RE.lastIndex = attrEnd + 1;
    }
  });
  return hits;
}

function styleGroupsSlugPart(styles: Record<string, unknown>): string {
  return Object.keys(styles).sort().join('-');
}

export function hoistVariations(pagesIn: HoistPage[], opts: { minInstances?: number } = {}): HoistResult {
  const minInstances = opts.minInstances ?? HOIST_MIN_INSTANCES;
  const pages = pagesIn.map(p => ({ ...p }));
  const hits = findStyledBlocks(pages);

  // Group by blockName + canonical style JSON.
  const groups = new Map<string, BlockHit[]>();
  for (const h of hits) {
    const key = h.blockName + ' ' + canonicalJson(h.attrs.style);
    const list = groups.get(key) ?? [];
    list.push(h);
    groups.set(key, list);
  }

  const variations: HoistedVariation[] = [];
  const usedSlugs = new Set<string>();
  const edits: Array<{ hit: BlockHit; slug: string }> = [];

  for (const [, list] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (list.length < minInstances) continue;
    const sample = list[0]!;
    const styles = sample.attrs.style as Record<string, unknown>;
    const shortName = sample.blockName.split('/')[1]!;
    let slug = 'lib-' + shortName + '-' + styleGroupsSlugPart(styles);
    // Fail-open: a constellation whose derived slug fails the charset guard
    // (an unexpected style key) is simply not hoisted — never a bad filename.
    if (!HOIST_SLUG_RE.test(slug)) continue;
    let n = 2;
    while (usedSlugs.has(slug)) slug = 'lib-' + shortName + '-' + styleGroupsSlugPart(styles) + '-' + n++;
    usedSlugs.add(slug);
    variations.push({
      slug,
      title: shortName.charAt(0).toUpperCase() + shortName.slice(1) + ' ' + styleGroupsSlugPart(styles).replace(/-/g, ' '),
      blockTypes: [sample.blockName],
      styles,
      count: list.length,
    });
    for (const hit of list) edits.push({ hit, slug });
  }

  // Apply edits per page, descending by offset so earlier offsets stay valid.
  edits.sort((a, b) => b.hit.attrStart - a.hit.attrStart);
  for (const { hit, slug } of edits) {
    const page = pages[hit.pageIndex]!;
    page.markup = applyAttrEdit(page.markup, hit, slug);
  }

  return { pages, variations };
}

/** Swap one styled block's attrs JSON for the is-style-* form, in place.
 *  Re-serialize through serializeBlockAttrs, NOT plain JSON.stringify: the
 *  original attrs may carry @wordpress/blocks comment-safe escapes
 *  (unicode-escaped `--`) that JSON.parse decoded — re-emitting them raw
 *  could terminate the surrounding HTML comment delimiter. */
function applyAttrEdit(markup: string, hit: BlockHit, slug: string): string {
  const attrs = { ...hit.attrs };
  delete attrs.style;
  const existing = typeof attrs.className === 'string' ? attrs.className + ' ' : '';
  attrs.className = existing + 'is-style-' + slug;
  return markup.slice(0, hit.attrStart) + serializeBlockAttrs(attrs) + markup.slice(hit.attrEnd + 1);
}

/**
 * Apply ALREADY-DECIDED hoist swaps to a sibling copy of the markup (the
 * theme pattern file body, which embeds the same block markup as the page's
 * post_content modulo PHP↔literal asset-ref form in the inner HTML — block
 * comment attrs are identical between the two forms). This does NOT re-run
 * constellation counting: only instances whose blockName + exact style
 * constellation match a variation decided by `hoistVariations` are swapped,
 * so pattern copies can never inflate counts or mint new variations.
 * Fail-open like the hoist itself: no matches → markup returned unchanged.
 *
 * NOTE: currently unused by the reconstruct handler — pattern files are
 * written PRE-hoist because they never pass block-fixer canonicalization, and
 * a comment-attr-only swap without it leaves the pattern editor-invalid
 * (is-style attrs over pre-hoist inline HTML). Wire this back in only
 * together with pattern canonicalization.
 */
export function applyHoistSwaps(markup: string, variations: HoistedVariation[]): string {
  if (variations.length === 0) return markup;
  const slugBySig = new Map<string, string>();
  for (const v of variations) {
    for (const bt of v.blockTypes) slugBySig.set(bt + ' ' + canonicalJson(v.styles), v.slug);
  }
  const hits = findStyledBlocks([{ slug: '', markup }]);
  // Descending by offset so earlier offsets stay valid across edits.
  hits.sort((a, b) => b.attrStart - a.attrStart);
  let out = markup;
  for (const hit of hits) {
    const slug = slugBySig.get(hit.blockName + ' ' + canonicalJson(hit.attrs.style));
    if (slug === undefined) continue;
    out = applyAttrEdit(out, hit, slug);
  }
  return out;
}
