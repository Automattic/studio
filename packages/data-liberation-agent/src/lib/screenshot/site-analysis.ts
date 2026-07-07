import type { Page } from 'playwright';
import { withEvaluateTimeout } from './page-helpers.js';

export interface PageAnalysis {
  palette: Array<{ hex: string; count: number }>;
  typography: Record<string, {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
  }>;
  computedStyles?: Record<string, {
    color: string;
    backgroundColor: string;
    borderColor: string;
    borderRadius: string;
    backgroundImage: string;
    fontFamily?: string;
    fontSize?: string;
    fontWeight?: string;
    lineHeight?: string;
    padding?: string;
    textTransform?: string;
  }>;
  metadata: {
    title: string;
    metaDescription: string;
    openGraph: Record<string, string>;
    jsonLdTypes: string[];
    htmlBytes: number;
  };
  /**
   * Integer px boundaries from `@media (min-width: Npx)` / `@media (max-width: Npx)`
   * rules in same-origin stylesheets. Cross-origin sheets throw on `.cssRules`
   * access; those are skipped silently, which means CDN-hosted CSS doesn't
   * contribute. Aggregated into `breakpoints.json` per site.
   */
  breakpoints: {
    minWidth: number[];
    maxWidth: number[];
  };
  /**
   * Named design tokens declared as CSS custom properties on `:root` / `html` /
   * `body` rules in same-origin stylesheets (e.g. `--brand-primary: #1d6f42`),
   * with each value RESOLVED off the document element. `isColor` is true when
   * the resolved value parses as a CSS color. Higher-fidelity and more editable
   * than pixel-sampled dominant colors; aggregated into `css-variables.json`
   * and consumed by the design-foundation scaffold. Optional for back-compat.
   */
  cssVariables?: Array<{ name: string; value: string; isColor: boolean }>;
}

function validate(value: unknown): asserts value is PageAnalysis {
  if (!value || typeof value !== 'object') throw new Error('analyzePage: bad shape');
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.palette)) throw new Error('analyzePage: palette must be array');
  if (!v.typography || typeof v.typography !== 'object') throw new Error('analyzePage: typography shape');
  if (!v.metadata || typeof v.metadata !== 'object') throw new Error('analyzePage: metadata shape');
  if (!v.breakpoints || typeof v.breakpoints !== 'object') throw new Error('analyzePage: breakpoints shape');
  const bp = v.breakpoints as Record<string, unknown>;
  if (!Array.isArray(bp.minWidth) || !Array.isArray(bp.maxWidth)) {
    throw new Error('analyzePage: breakpoints.minWidth / maxWidth must be arrays');
  }
  if (v.cssVariables !== undefined && !Array.isArray(v.cssVariables)) {
    throw new Error('analyzePage: cssVariables must be an array when present');
  }
}

/**
 * Extract palette, typography samples, and URL metadata in a single round-trip
 * to the browser. Runs inside page.evaluate so we share one DOM traversal.
 *
 *   enter page  ──▶ element background-color sampling ─┐
 *                ──▶ getComputedStyle on h1/h2/h3/body/button ─┤──▶ one serialized return
 *                ──▶ title/og-tags/json-ld/htmlBytes scan ─────┘
 */
export async function analyzePage(page: Page, timeoutMs = 5_000): Promise<PageAnalysis> {
  const result = await withEvaluateTimeout(page.evaluate(() => {
    // --- palette via background-color sampling ----------------------------
    // Pixel-perfect sampling would require rendering to a canvas (expensive
    // and CSP-fragile). Sampling computed background-color of major layout
    // elements gives a good dominant-color signal at near-zero cost.
    const bucketed = new Map<string, number>();
    const colorOf = (el: Element): string => {
      const c = getComputedStyle(el).backgroundColor;
      if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return '';
      return c;
    };
    const els = document.querySelectorAll('body, header, main, footer, section, article, nav, aside, div');
    let counted = 0;
    for (const el of Array.from(els)) {
      const c = colorOf(el);
      if (!c) continue;
      bucketed.set(c, (bucketed.get(c) ?? 0) + 1);
      counted++;
      if (counted > 500) break;
    }
    const palette = Array.from(bucketed.entries())
      .map(([color, count]) => {
        const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return { hex: color, count };
        const [, r, g, b] = m;
        const hex = '#' + [r, g, b].map((n) => parseInt(n).toString(16).padStart(2, '0')).join('');
        return { hex, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const toHex = (color: string): string => {
      const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return color || '';
      const [, r, g, b] = m;
      return '#' + [r, g, b].map((n) => parseInt(n).toString(16).padStart(2, '0')).join('');
    };

    // --- typography -------------------------------------------------------
    const typoTargets = ['h1', 'h2', 'h3', 'body', 'button'] as const;
    const typography: Record<string, { fontFamily: string; fontSize: string; fontWeight: string; lineHeight: string }> = {};
    for (const sel of typoTargets) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      typography[sel] = {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
      };
    }

    // --- computed component styles ---------------------------------------
    const styleTargets = [
      'body',
      'header',
      'nav',
      'main',
      'footer',
      'section',
      'article',
      'h1',
      'h2',
      'h3',
      'a',
      'button',
      'input',
      'textarea',
      'select',
      '[class*="hero"]',
      '[class*="card"]',
      '[class*="cta"]',
    ] as const;
    const computedStyles: Record<string, {
      color: string;
      backgroundColor: string;
      borderColor: string;
      borderRadius: string;
      backgroundImage: string;
      fontFamily: string;
      fontSize: string;
      fontWeight: string;
      lineHeight: string;
      padding: string;
      textTransform: string;
    }> = {};
    for (const sel of styleTargets) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      computedStyles[sel] = {
        color: toHex(cs.color),
        backgroundColor: toHex(cs.backgroundColor),
        borderColor: toHex(cs.borderColor),
        borderRadius: cs.borderRadius,
        backgroundImage: cs.backgroundImage,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        padding: cs.padding,
        textTransform: cs.textTransform,
      };
    }

    // --- metadata ---------------------------------------------------------
    const title = document.title;
    const metaDescription = (document.querySelector('meta[name="description"]') as HTMLMetaElement | null)?.content ?? '';
    const openGraph: Record<string, string> = {};
    for (const el of Array.from(document.querySelectorAll('meta[property^="og:"]'))) {
      const m = el as HTMLMetaElement;
      const prop = m.getAttribute('property');
      if (prop) openGraph[prop] = m.content;
    }
    const jsonLdTypes: string[] = [];
    for (const el of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const obj = JSON.parse((el as HTMLScriptElement).textContent ?? '');
        const stack: unknown[] = [obj];
        while (stack.length) {
          const v = stack.shift();
          if (!v) continue;
          if (Array.isArray(v)) stack.push(...v);
          else if (typeof v === 'object') {
            const rec = v as Record<string, unknown>;
            if (rec['@type']) jsonLdTypes.push(String(rec['@type']));
            stack.push(...Object.values(rec));
          }
        }
      } catch { /* skip malformed JSON-LD */ }
    }
    const htmlBytes = new Blob([document.documentElement.outerHTML]).size;

    // --- breakpoints from @media rules ------------------------------------
    // Same-origin stylesheets expose .cssRules; cross-origin sheets throw.
    // Skip them silently — CDN-hosted CSS won't contribute, which is OK for
    // a best-effort signal.
    // Same loop also harvests `:root`/`html`/`body` custom-property NAMES (the
    // authored design tokens) — values are resolved off the document element
    // afterward so var() chains and the cascade are honored.
    const minWidthSet = new Set<number>();
    const maxWidthSet = new Set<number>();
    const rootVarNames = new Set<string>();
    const rootSelector = /(^|,)\s*(:root|html|body)\s*($|,)/i;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) {
          for (const condition of rule.conditionText.split(',')) {
            const min = condition.match(/min-width:\s*(\d+)px/i);
            const max = condition.match(/max-width:\s*(\d+)px/i);
            if (min) minWidthSet.add(Number(min[1]));
            if (max) maxWidthSet.add(Number(max[1]));
          }
          continue;
        }
        if (rule instanceof CSSStyleRule && rootSelector.test(rule.selectorText)) {
          const style = rule.style;
          for (let i = 0; i < style.length; i++) {
            const prop = style.item(i);
            if (prop && prop.startsWith('--')) rootVarNames.add(prop);
          }
        }
      }
    }
    const breakpoints = {
      minWidth: Array.from(minWidthSet).sort((a, b) => a - b),
      maxWidth: Array.from(maxWidthSet).sort((a, b) => a - b),
    };

    // Resolve each token's final value off :root (falling back to body), and
    // classify color-valued tokens via CSS.supports (excluding var() chains,
    // which CSS.supports accepts for any property).
    const rootCS = getComputedStyle(document.documentElement);
    const bodyCS = document.body ? getComputedStyle(document.body) : null;
    const cssVariables: Array<{ name: string; value: string; isColor: boolean }> = [];
    for (const name of Array.from(rootVarNames).slice(0, 200)) {
      let value = rootCS.getPropertyValue(name).trim();
      if (!value && bodyCS) value = bodyCS.getPropertyValue(name).trim();
      if (!value) continue;
      let isColor = false;
      try {
        isColor = !value.startsWith('var(') && typeof CSS !== 'undefined' && CSS.supports('color', value);
      } catch {
        isColor = false;
      }
      cssVariables.push({ name, value, isColor });
    }

    return {
      palette,
      typography,
      computedStyles,
      metadata: { title, metaDescription, openGraph, jsonLdTypes, htmlBytes },
      breakpoints,
      cssVariables,
    };
  }), timeoutMs);

  validate(result);
  return result;
}
