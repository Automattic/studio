// src/lib/replicate/style-audit.ts
//
// Style-usage audit (BDC survey adoption — measurement only, blocks path
// only: carry mode's CSS-by-design makes the metric meaningless there).
// Answers ONE dial question about emitted block markup: how much styling
// rides block SUPPORTS (style.* attrs + presets — portable, editor-editable,
// survives re-serialization) vs raw theme CSS (invisible to the editor)?
//
// Parsed with the registration-free default parser — the same no-DOM parser
// the validate-block-markup oracle uses, so the walk sees exactly what
// WordPress would parse. Warning-level tally only; never a verdict input.
import { parse } from '@wordpress/block-serialization-default-parser';
import { walkBlocks } from './block-tree.js';

export interface StyleAuditResult {
  /** 0-100: styledViaSupports / total real blocks (0 when no blocks). */
  supportStyledPercent: number;
  /** Blocks carrying style.* attrs, preset attrs, or has-* preset classes. */
  styledViaSupports: number;
  /** The rest — bare blocks whose look depends entirely on theme CSS. */
  styledViaCss: number;
  /** Flattened style.* leaf paths → occurrence count (e.g. typography.fontSize). */
  stylePathHistogram: Record<string, number>;
  /** UTF-8 byte size of the theme css string. */
  cssBytes: number;
  /** Rule-ish count: comment-stripped `}` count. NAIVE on purpose — nested
   * at-rules (@media) count their closing brace as a "rule" too; the number
   * is a budget dial, not a parser. */
  cssRules: number;
}

/** Preset attrs that style a block through supports without a style object. */
const PRESET_ATTRS = ['fontSize', 'textColor', 'backgroundColor'] as const;

/** has-* preset classes (has-large-font-size, has-accent-primary-color, …). */
const PRESET_CLASS_RE = /(?:^|\s)has-[a-z0-9-]+(?:\s|$)/i;

/** Flatten a style object to leaf paths: {typography:{fontSize:'18px'}} → ['typography.fontSize']. */
function flattenStylePaths(style: unknown, prefix = ''): string[] {
  if (style === null || typeof style !== 'object' || Array.isArray(style)) {
    return prefix ? [prefix] : [];
  }
  const out: string[] = [];
  for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...flattenStylePaths(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/** True when the block's attrs style it via supports (style.*, presets, has-* classes). */
function isSupportStyled(attrs: Record<string, unknown>): boolean {
  if (attrs.style && typeof attrs.style === 'object') return true;
  for (const preset of PRESET_ATTRS) {
    if (typeof attrs[preset] === 'string' && attrs[preset] !== '') return true;
  }
  const className = attrs.className;
  if (typeof className === 'string' && PRESET_CLASS_RE.test(className)) return true;
  return false;
}

/** Comment-stripped `}` count — see the cssRules doc for the stated naivety. */
function countCssRules(css: string): number {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return (stripped.match(/\}/g) ?? []).length;
}

/**
 * Pure: audit emitted page markup + the theme css budget. Pages parse with
 * the registration-free default parser; counts include innerBlocks.
 */
export function auditStyleUsage(
  pages: Array<{ slug: string; markup: string }>,
  themeCss: string,
): StyleAuditResult {
  const state = { total: 0, styled: 0, histogram: {} as Record<string, number> };
  for (const page of pages) {
    walkBlocks(parse(page.markup), (b) => {
      state.total += 1;
      const attrs = (b.attrs ?? {}) as Record<string, unknown>;
      if (isSupportStyled(attrs)) {
        state.styled += 1;
      }
      for (const path of flattenStylePaths(attrs.style)) {
        state.histogram[path] = (state.histogram[path] ?? 0) + 1;
      }
    });
  }
  const supportStyledPercent = state.total === 0 ? 0 : Math.round((state.styled / state.total) * 100);
  return {
    supportStyledPercent,
    styledViaSupports: state.styled,
    styledViaCss: state.total - state.styled,
    stylePathHistogram: state.histogram,
    cssBytes: Buffer.byteLength(themeCss, 'utf8'),
    cssRules: countCssRules(themeCss),
  };
}
