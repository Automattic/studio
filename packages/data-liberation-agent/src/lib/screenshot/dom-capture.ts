// src/lib/screenshot/dom-capture.ts
import type { Page } from 'playwright';
import { CHROME_FIXUP_FACTORY_SOURCE, CHROME_MARKER_FACTORY_SOURCE, COVER_IMAGE_FIXUP_FACTORY_SOURCE, type BakedLayoutMap } from './fixups.js';
import { NAV_EXTRACT_FACTORY_SOURCE, type ExtractedNav } from './nav-extract.js';

/** Inner HTML of <body>, image src/srcset preserved (no inlining). */
export async function collectBodyFragment(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerHTML);
}

export interface BodyAndChrome {
  bodyFragmentHtml: string;
  /**
   * Structured nav data extracted from the site header (logo, items, CTA,
   * style tokens). Replaces the old headerHtml bake. null when no header was
   * detected or nav extraction failed.
   */
  nav: ExtractedNav | null;
  footerHtml: string | null;
  /** Desktop baked layout map (marker → props). Populated by the new marker-keyed path. */
  desktopLayoutMap: BakedLayoutMap | null;
}

/**
 * Detect the site header + footer in the live (JS-rendered) DOM, assign stable
 * `dla-fx-N` marker classes to every element, collect the computed layout for
 * each marker (de-pinning fixed/sticky → static), remove chrome from the body,
 * and return the trimmed body HTML together with the extracted chrome HTML and
 * the desktop layout map.
 *
 * NEW (dual-viewport responsive bake): Unlike the old `applyChromeFixups` path
 * which baked computed styles as inline attributes (overriding all responsive
 * media queries), this function:
 *   1. Assigns stable `dla-fx-N` marker classes to the chrome elements.
 *   2. Calls `collectBakedLayout` to capture desktop layout values WITHOUT
 *      mutating inline styles.
 *   3. Returns `desktopLayoutMap` for use in `generateChromeCss`.
 *
 * The chrome HTML carries the marker classes but NO inline baked styles.
 * Responsive media queries in site.css are therefore preserved. The caller
 * (screenshotter.ts) will also call `collectMobileChromeLayout` at the mobile
 * viewport and pass both maps to `generateChromeCss` to emit chrome.css.
 *
 * Called once per page during design capture. The single `page.evaluate` keeps
 * round-trips minimal and ensures the DOM mutations happen atomically before
 * we read `document.body.innerHTML`.
 *
 * Fixup functions are defined in `fixups.ts` and injected as serialised source
 * so `fixups.ts` remains the single source of truth.
 */
export async function collectBodyAndChrome(page: Page): Promise<BodyAndChrome> {
  // Inject the marker factory (assignChromeMarkers + collectBakedLayout)
  // and the nav-extract factory (extractNav).
  // The old applier factory is kept as a fallback import but not used in the
  // primary chrome path — marker-based approach replaces inline baking.
  const { factorySrc } = CHROME_FIXUP_FACTORY_SOURCE;
  const markerFactorySrc = CHROME_MARKER_FACTORY_SOURCE.factorySrc;
  const navFactorySrc = NAV_EXTRACT_FACTORY_SOURCE.factorySrc;
  const coverFactorySrc = COVER_IMAGE_FIXUP_FACTORY_SOURCE.factorySrc;

  return page.evaluate(
    ({ factorySrc, markerFactorySrc, navFactorySrc, coverFactorySrc }: { factorySrc: string; markerFactorySrc: string; navFactorySrc: string; coverFactorySrc: string }): BodyAndChrome => {
      // Reconstruct the marker helpers from the self-contained factory.
      // eslint-disable-next-line no-new-func
      const markerHelpers = new Function('return (' + markerFactorySrc + ')')()() as {
        assignChromeMarkers: (root: Element) => string[];
        collectBakedLayout: (root: Element) => Record<string, Record<string, string>>;
      };
      const { collectBakedLayout } = markerHelpers;

      // Reconstruct the nav extraction helper.
      // eslint-disable-next-line no-new-func
      const navHelpers = new Function('return (' + navFactorySrc + ')')()() as {
        extractNav: (headerEl: Element) => import('./nav-extract.js').ExtractedNav;
      };
      const { extractNav } = navHelpers;

      // The old factory is available for potential future use. Not needed here —
      // depin is now folded into collectBakedLayout's return values.
      // eslint-disable-next-line no-new-func
      void new Function('return (' + factorySrc + ')')();

      // Reconstruct the cover-image fixup from the self-contained factory.
      // eslint-disable-next-line no-new-func
      const stripCoverImageDimensions = new Function('return (' + coverFactorySrc + ')')()() as (root: Element) => void;

      const vw = window.innerWidth || 1440;
      const docH = document.documentElement.scrollHeight;

      const pick = (atTop: boolean): Element | null => {
        let best: Element | null = null;
        let bestScore = 2; // require score > 2 to accept a computed candidate
        for (const el of document.querySelectorAll('div,section,header,footer,nav')) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (r.width < vw * 0.6 || r.height < 24 || r.height > 400) continue;
          const fixedish = cs.position === 'fixed' || cs.position === 'sticky';
          const hasNav = !!el.querySelector('nav, a, [role="navigation"]');
          const nearTop = r.top <= 80;
          const nearBottom = r.bottom >= docH - 160;
          let s = 0;
          if (fixedish) s += 2;
          if (hasNav) s += 2;
          if (atTop && nearTop) s += 3;
          if (!atTop && nearBottom) s += 3;
          if (s > bestScore) { bestScore = s; best = el; }
        }
        return best;
      };

      const header = document.querySelector('header, [role="banner"]') || pick(true);
      const footer = document.querySelector('footer, [role="contentinfo"]') || pick(false);

      // Assign markers using a global counter so header and footer elements
      // get non-overlapping dla-fx-N ids (header: 0..N, footer: N+1..M).
      // The same counter approach is used in collectMobileChromeLayout so
      // marker IDs are DOM-order stable across viewports when the DOM is identical.
      let globalCounter = 0;
      const assignMarkersGlobal = (root: Element): void => {
        const all = [root, ...Array.from(root.querySelectorAll('*'))];
        for (const el of all) {
          const cls = `dla-fx-${globalCounter++}`;
          (el as HTMLElement).classList.add(cls);
        }
      };

      // Nav is extracted from the header BEFORE marker assignment so
      // getComputedStyle sees the clean DOM. Footer still uses the bake path.
      let nav: import('./nav-extract.js').ExtractedNav | null = null;
      let footerHtml: string | null = null;
      let desktopLayoutMap: Record<string, Record<string, string>> = {};

      if (header) {
        // Extract structured nav data BEFORE modifying the header DOM.
        try {
          nav = extractNav(header);
        } catch {
          nav = null;
        }
        // Assign markers for chrome.css generation (footer still needs layout map).
        assignMarkersGlobal(header);
        const headerMap = collectBakedLayout(header);
        Object.assign(desktopLayoutMap, headerMap);
        // NOTE: We do NOT capture headerHtml. The nav data replaces it.
      }

      if (footer) {
        assignMarkersGlobal(footer);
        const footerMap = collectBakedLayout(footer);
        Object.assign(desktopLayoutMap, footerMap);
        footerHtml = (footer as HTMLElement).outerHTML;
      }

      // Only remove chrome elements when they are disjoint — avoid removing an
      // ancestor that contains the other.
      const safeRemove = (el: Element | null, other: Element | null): void => {
        if (el && !(other && (el.contains(other) || other.contains(el)))) el.remove();
      };
      safeRemove(header, footer);
      safeRemove(footer, header);

      // Strip inline width/height from object-fit:cover images (Wix JS-sizes them
      // at runtime; without JS the fixed px dimensions prevent images from filling
      // their containers).
      stripCoverImageDimensions(document.body);

      return {
        bodyFragmentHtml: document.body.innerHTML,
        nav,
        footerHtml,
        desktopLayoutMap: Object.keys(desktopLayoutMap).length > 0 ? desktopLayoutMap : null,
      };
    },
    { factorySrc, markerFactorySrc, navFactorySrc, coverFactorySrc },
  );
}

/**
 * Collect the baked layout map for the site chrome at the CURRENT viewport
 * (intended for use at mobile viewport width, on a FRESH page visit).
 *
 * Each viewport in the screenshotter uses a separate browser context + page.
 * This function runs on the mobile page, independently assigns `dla-fx-N`
 * marker classes to the detected chrome elements (same depth-first convention
 * as the desktop pass), and returns the computed layout map.
 *
 * Because DOM-order marker assignment is deterministic, the markers here will
 * match the desktop markers IF the mobile chrome DOM has the same element
 * structure. `generateChromeCss` merges the two maps by marker key, so
 * per-viewport rule pairing is automatic.
 *
 * Limitation — Wix mobile hamburger: Wix (and similar JS-heavy platforms) may
 * render a completely different chrome DOM at mobile viewport (hamburger menu
 * replaces the desktop nav). When the mobile chrome has a different element
 * count or structure, the marker keys will differ from the desktop keys. This
 * is handled gracefully in `generateChromeCss`: markers present in both maps
 * get desktop+mobile rules; markers only in one map get that viewport's rule
 * only. The mobile hamburger is JS-interactive and won't open in the static
 * replica — known limitation, documented here.
 *
 * Returns null when no chrome is detected at the current viewport (graceful
 * degradation — caller falls back to desktop-only chrome CSS).
 */
export async function collectMobileChromeLayout(page: Page): Promise<BakedLayoutMap | null> {
  const markerFactorySrc = CHROME_MARKER_FACTORY_SOURCE.factorySrc;

  return page.evaluate(
    ({ markerFactorySrc }: { markerFactorySrc: string }): Record<string, Record<string, string>> | null => {
      // eslint-disable-next-line no-new-func
      const { collectBakedLayout } = (new Function('return (' + markerFactorySrc + ')')()() as {
        assignChromeMarkers: (root: Element) => string[];
        collectBakedLayout: (root: Element) => Record<string, Record<string, string>>;
      });

      const vw = window.innerWidth || 390;
      const docH = document.documentElement.scrollHeight;

      const pick = (atTop: boolean): Element | null => {
        let best: Element | null = null;
        let bestScore = 2;
        for (const el of document.querySelectorAll('div,section,header,footer,nav')) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (r.width < vw * 0.6 || r.height < 24 || r.height > 400) continue;
          const fixedish = cs.position === 'fixed' || cs.position === 'sticky';
          const hasNav = !!el.querySelector('nav, a, [role="navigation"]');
          const nearTop = r.top <= 80;
          const nearBottom = r.bottom >= docH - 160;
          let s = 0;
          if (fixedish) s += 2;
          if (hasNav) s += 2;
          if (atTop && nearTop) s += 3;
          if (!atTop && nearBottom) s += 3;
          if (s > bestScore) { bestScore = s; best = el; }
        }
        return best;
      };

      const header = document.querySelector('header, [role="banner"]') || pick(true);
      const footer = document.querySelector('footer, [role="contentinfo"]') || pick(false);

      if (!header && !footer) return null;

      // Assign markers using the same global counter approach as the desktop pass
      // so marker IDs are DOM-order stable across viewports (when DOM is the same).
      let globalCounter = 0;
      const assignMarkersGlobal = (root: Element): void => {
        const all = [root, ...Array.from(root.querySelectorAll('*'))];
        for (const el of all) {
          // Only assign a marker if none is already present (idempotent on
          // pages where markers were pre-assigned by an earlier pass).
          const hasMark = Array.from((el as HTMLElement).classList).some((c) => c.startsWith('dla-fx-'));
          if (!hasMark) {
            (el as HTMLElement).classList.add(`dla-fx-${globalCounter}`);
          }
          globalCounter++;
        }
      };

      if (header) assignMarkersGlobal(header);
      if (footer) assignMarkersGlobal(footer);

      // Collect layout from both chrome roots.
      const combined: Record<string, Record<string, string>> = {};
      for (const root of [header, footer]) {
        if (!root) continue;
        const map = collectBakedLayout(root);
        if (Object.keys(map).length === 0) continue;
        Object.assign(combined, map);
      }

      return Object.keys(combined).length > 0 ? combined : null;
    },
    { markerFactorySrc },
  );
}

/**
 * Mobile-only body fragment capture: detect and remove the site chrome
 * (header + footer) from the body using the same heuristic as
 * `collectBodyAndChrome`, but WITHOUT the nav extraction, footer bake, or
 * layout-map collection. Returns the chrome-stripped `document.body.innerHTML`.
 *
 * This is the body-capture half of `collectBodyAndChrome`, extracted for use
 * in the mobile viewport pass where we only need the page body fragment.
 * Chrome (generated block header + baked footer) is shared and rendered once
 * from the desktop pass data; we only need the distinct mobile body content.
 */
export async function collectBodyFragmentMobileOnly(page: Page): Promise<string> {
  const coverFactorySrc = COVER_IMAGE_FIXUP_FACTORY_SOURCE.factorySrc;
  return page.evaluate(({ coverFactorySrc }: { coverFactorySrc: string }) => {
    const vw = window.innerWidth || 390;
    const docH = document.documentElement.scrollHeight;

    const pick = (atTop: boolean): Element | null => {
      let best: Element | null = null;
      let bestScore = 2;
      for (const el of document.querySelectorAll('div,section,header,footer,nav')) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.6 || r.height < 24 || r.height > 400) continue;
        const fixedish = cs.position === 'fixed' || cs.position === 'sticky';
        const hasNav = !!el.querySelector('nav, a, [role="navigation"]');
        const nearTop = r.top <= 80;
        const nearBottom = r.bottom >= docH - 160;
        let s = 0;
        if (fixedish) s += 2;
        if (hasNav) s += 2;
        if (atTop && nearTop) s += 3;
        if (!atTop && nearBottom) s += 3;
        if (s > bestScore) { bestScore = s; best = el; }
      }
      return best;
    };

    const header = document.querySelector('header, [role="banner"]') || pick(true);
    const footer = document.querySelector('footer, [role="contentinfo"]') || pick(false);

    // Only remove chrome elements when they are disjoint.
    const safeRemove = (el: Element | null, other: Element | null): void => {
      if (el && !(other && (el.contains(other) || other.contains(el)))) el.remove();
    };
    safeRemove(header, footer);
    safeRemove(footer, header);

    // Strip inline width/height from object-fit:cover images before serialising.
    // eslint-disable-next-line no-new-func
    const stripCoverImageDimensions = new Function('return (' + coverFactorySrc + ')')()() as (root: Element) => void;
    stripCoverImageDimensions(document.body);

    return document.body.innerHTML;
  }, { coverFactorySrc });
}

/** Concatenated cssText of all SAME-ORIGIN stylesheets. Cross-origin sheets
 *  throw on .cssRules and are skipped (their <link> is captured separately). */
export async function collectStylesheets(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) parts.push(rule.cssText);
      } catch { /* cross-origin — skip */ }
    }
    return parts.join('\n');
  });
}

/** href of every <head> <link rel=stylesheet>. */
export async function collectHeadLinks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('head link[rel="stylesheet"]'))
      .map((l) => (l as HTMLLinkElement).href)
      .filter(Boolean),
  );
}

/** Scripts in document order: {src} external, {inline} inline blocks. */
export async function collectScripts(page: Page): Promise<Array<{ src?: string; inline?: string }>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('script')).map((s) => {
      const el = s as HTMLScriptElement;
      return el.src ? { src: el.src } : { inline: el.textContent ?? '' };
    }),
  );
}
