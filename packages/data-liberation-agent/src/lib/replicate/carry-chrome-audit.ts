import { CHROME_AUDIT_PROPERTIES, type ChromeCorrection, type ChromeFidelity, type ChromeRegion } from './chrome-audit-types.js';
import { chromeKey, type ChromeKeyParts } from './chrome-key.js';

/**
 * Build a deterministic CSS selector for an element in the built carry site.
 * The selector anchors at the real region root (after unwrapping
 * wp-block-template-part wrappers in the browser walk) and descends via
 * `> *:nth-child(i+1)` for each pathIndex step.
 *
 * Pure — no DOM access.
 *
 * @example builtSelectorFor('footer.footer', [0, 1]) → 'footer.footer > *:nth-child(1) > *:nth-child(2)'
 * @example builtSelectorFor('header.site-header', []) → 'header.site-header'
 */
export function builtSelectorFor(regionRootSelector: string, pathIndex: number[]): string {
  if (pathIndex.length === 0) return regionRootSelector;
  return regionRootSelector + pathIndex.map((i) => ` > *:nth-child(${i + 1})`).join('');
}

export interface BuiltChromeEntry { key: string; selector: string; props: Record<string, string>; }
export type BuiltChrome = Partial<Record<ChromeRegion, BuiltChromeEntry[]>>;
export interface ChromeAuditResult { corrections: ChromeCorrection[]; unmatched: number; droppedChrome: number; }

/** Raw built row from the browser walk (same shape as capture's ChromeRow + a concrete selector). */
export interface BuiltRow extends ChromeKeyParts { selector: string; props: Record<string, string>; }

const LENGTH_PROPS = new Set(['font-size', 'line-height', 'letter-spacing', 'margin', 'padding']);

function diverges(prop: string, built: string, source: string): boolean {
  if (built === source) return false;
  // Single-value lengths get a 0.5px epsilon (sub-pixel rounding). Multi-value
  // shorthands (e.g. `margin: 10px 20px`) fall through to exact match — parseFloat
  // would only read the first value and miss asymmetric drift.
  if (LENGTH_PROPS.has(prop) && !/\s/.test(built.trim()) && !/\s/.test(source.trim())) {
    const a = parseFloat(built), b = parseFloat(source);
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) > 0.5;
  }
  return true; // multi-value/enumerated/color: exact match required
}

/** Key built rows via the SAME chromeKey used at capture time (so keys match by construction). */
export function buildBuiltChrome(rows: BuiltRow[]): BuiltChrome {
  const out: BuiltChrome = {};
  for (const r of rows) {
    const entry: BuiltChromeEntry = { key: chromeKey(r), selector: r.selector, props: r.props };
    (out[r.region as ChromeRegion] ??= []).push(entry);
  }
  return out;
}

export function diffChromeFidelity(source: ChromeFidelity, built: BuiltChrome): ChromeAuditResult {
  const corrections: ChromeCorrection[] = [];
  let unmatched = 0, droppedChrome = 0;
  for (const region of Object.keys(source.regions) as ChromeRegion[]) {
    const builtEntries = built[region] ?? [];
    const builtByKey = new Map(builtEntries.map((e) => [e.key, e]));
    const sourceKeys = new Set<string>();
    for (const src of source.regions[region] ?? []) {
      // Tiny/zero-size source elements are non-actionable (e.g. invisible 0×0
      // wrappers injected by Wix/Shopify). Skip them entirely so they don't
      // inflate droppedChrome when absent from the built carry.
      if (src.box.w <= 1 || src.box.h <= 1) continue;
      sourceKeys.add(src.key);
      const b = builtByKey.get(src.key);
      if (!b) { droppedChrome++; continue; }
      for (const prop of CHROME_AUDIT_PROPERTIES) {
        const want = src.props[prop];
        const got = b.props[prop];
        if (want == null || got == null || want === 'auto') continue;
        if (diverges(prop, got, want)) corrections.push({ region, selector: b.selector, property: prop, from: got, to: want });
      }
    }
    for (const b of builtEntries) if (!sourceKeys.has(b.key)) unmatched++;
  }
  return { corrections, unmatched, droppedChrome };
}

/** Stable marker prefixing the appended correction block — lets the driver strip a
 *  prior block before re-appending so re-runs stay idempotent (no accumulation). */
export const CHROME_CORRECTION_MARKER = '/* carry-chrome-audit: corrections copied from the source render */';

export function emitChromeCorrectionCss(corrections: ChromeCorrection[], scope: string): string {
  if (corrections.length === 0) return '';
  // Escape any `*/` in the prior value so a pathological computed value can't break the CSS comment.
  const rules = corrections.map((c) => `:where(${scope}) ${c.selector}{${c.property}:${c.to}!important} /* was ${c.from.replace(/\*\//g, '* /')} */`);
  return `\n${CHROME_CORRECTION_MARKER}\n${rules.join('\n')}\n`;
}
