import type { Page } from 'playwright';
import { chromeKey, type ChromeKeyParts } from '../replicate/chrome-key.js';
import {
  CHROME_FIDELITY_SCHEMA,
  type ChromeFidelity,
  type ChromeFidelityEntry,
  type ChromeRegion,
} from '../replicate/chrome-audit-types.js';
import { writeChromeFidelity } from '../replicate/chrome-fidelity-store.js';
import { builtSelectorFor, type BuiltRow } from '../replicate/carry-chrome-audit.js';

export interface ChromeRow extends ChromeKeyParts {
  props: ChromeFidelityEntry['props'];
  box: { w: number; h: number };
}

/** Pure: turn raw browser-emitted rows into a keyed, region-grouped ChromeFidelity. */
export function assembleChromeFidelity(sourceUrl: string, rows: ChromeRow[]): ChromeFidelity {
  const regions: ChromeFidelity['regions'] = {};
  for (const r of rows) {
    const entry: ChromeFidelityEntry = { key: chromeKey(r), props: r.props, box: r.box };
    (regions[r.region as ChromeRegion] ??= []).push(entry);
  }
  return { schema: CHROME_FIDELITY_SCHEMA, sourceUrl, regions };
}

/**
 * Run in-browser to walk top-level header/footer/nav chrome elements and return
 * a flat array of rows with computed styles + bounding-box dimensions.
 *
 * Nested chrome roots (e.g. a <nav> inside a <header>) are NOT treated as
 * independent regions — only roots that have no chrome ancestor are processed,
 * avoiding double-counting. The root element itself is recorded as pathIndex [].
 *
 * Cap: 400 elements per chrome root so the serialization stays bounded even on
 * heavily-nested nav trees.
 *
 * Integration-tested via the screenshotter; no unit test (would require a real
 * browser).
 */
export async function extractChromeRows(
  page: Page,
  properties: readonly string[],
): Promise<ChromeRow[]> {
  const propsArr = [...properties];
  // page.evaluate serializes the return value via structured-clone.
  // Using `as unknown` to avoid overly-strict TS inference on the raw result
  // from the browser evaluate; we guard with Array.isArray before use.
  const raw = (await page.evaluate(
    (props: string[]) => {
      const CHROME_TAGS = new Set(['header', 'footer', 'nav']);
      // html-carry.ts strips exactly these non-rendered tags from the source HTML;
      // excluding them here keeps source/built pathIndex values aligned so that
      // the same element gets the same chromeKey on both sides.
      const SKIP_TAGS: Record<string, number> = { script:1, style:1, noscript:1, template:1, base:1, link:1, meta:1 };

      // Collect all chrome roots
      const allRoots = Array.from(
        document.querySelectorAll('header, footer, nav'),
      ) as HTMLElement[];

      // Keep only top-level roots (not nested inside another chrome root).
      // A root is top-level when no ancestor has a chrome tag name.
      const topRoots = allRoots.filter((root) => {
        let el = root.parentElement;
        while (el) {
          if (CHROME_TAGS.has(el.tagName.toLowerCase())) return false;
          el = el.parentElement;
        }
        return true;
      });

      const rows: {
        region: string;
        pathIndex: number[];
        tag: string;
        className: string;
        props: Record<string, string>;
        box: { w: number; h: number };
      }[] = [];

      for (const root of topRoots) {
        const region = root.tagName.toLowerCase();
        let count = 0;
        const MAX = 400;

        function walk(el: HTMLElement, pathIndex: number[]): void {
          if (count >= MAX) return;
          count++;

          const style = window.getComputedStyle(el);
          const elProps: Record<string, string> = {};
          for (const p of props) {
            elProps[p] = style.getPropertyValue(p).trim();
          }

          const rect = el.getBoundingClientRect();
          rows.push({
            region,
            pathIndex,
            tag: el.tagName.toLowerCase(),
            className: typeof el.className === 'string' ? el.className : '',
            props: elProps,
            box: { w: Math.round(rect.width), h: Math.round(rect.height) },
          });

          const children = (Array.from(el.children) as HTMLElement[]).filter(
            (c) => !SKIP_TAGS[c.tagName.toLowerCase()],
          );
          for (let i = 0; i < children.length; i++) {
            if (count >= MAX) break;
            walk(children[i], [...pathIndex, i]);
          }
        }

        walk(root, []);
      }

      return rows;
    },
    propsArr,
  )) as unknown;

  // Guard: in tests the mock may return a non-array; treat that as no rows.
  return Array.isArray(raw) ? (raw as ChromeRow[]) : [];
}

/**
 * Node-side wrapper: extract chrome rows from the live page, assemble a
 * ChromeFidelity document, and persist it atomically to outputDir.
 * Returns the number of rows captured.
 */
export async function captureChromeFidelity(
  page: Page,
  sourceUrl: string,
  outputDir: string,
  properties: readonly string[],
): Promise<number> {
  const rows = await extractChromeRows(page, properties);
  const fid = assembleChromeFidelity(sourceUrl, rows);
  writeChromeFidelity(outputDir, fid);
  return rows.length;
}

/**
 * Extract chrome rows from the BUILT carry site page.
 *
 * Key difference from `extractChromeRows` (source-side): WordPress wraps
 * template-part chrome in `wp-block-template-part` container elements. The
 * UNWRAP step removes these wrappers so the region root is the SAME real
 * chrome element (footer/header/nav) as on the source page — ensuring that
 * `pathIndex` paths and `chromeKey` values match those captured at source
 * extraction time.
 *
 * UNWRAP logic (both shapes are handled):
 *
 *   Case 1 — `<footer class="wp-block-template-part"><footer class="footer">…`
 *     querySelectorAll finds both footers. The outer footer (no chrome ancestor)
 *     passes the top-level filter. It has `wp-block-template-part` → unwrap →
 *     inner `<footer class="footer">` is the region root with pathIndex [].
 *
 *   Case 2 — `<div class="wp-block-template-part"><footer class="footer">…`
 *     querySelectorAll finds only the inner footer (div is not a chrome tag).
 *     The inner footer has no chrome ancestor → passes the filter. It does NOT
 *     have `wp-block-template-part` → no unwrap needed. pathIndex [] already.
 *
 * Both shapes yield pathIndex [] at the real footer/header/nav. ✓
 *
 * Selectors are built Node-side (after the eval returns) via `builtSelectorFor`
 * to keep the browser payload simple.
 *
 * Integration-tested via the audit driver; no unit test (requires a real browser).
 */
export async function extractBuiltChromeRows(
  page: Page,
  properties: readonly string[],
): Promise<BuiltRow[]> {
  const propsArr = [...properties];
  const raw = (await page.evaluate(
    (props: string[]) => {
      const CHROME_TAGS = new Set(['header', 'footer', 'nav']);
      const TEMPLATE_PART_CLASS = 'wp-block-template-part';
      // html-carry.ts strips exactly these non-rendered tags from the source HTML;
      // excluding them here keeps source/built pathIndex values aligned so that
      // the same element gets the same chromeKey on both sides.
      const SKIP_TAGS: Record<string, number> = { script:1, style:1, noscript:1, template:1, base:1, link:1, meta:1 };

      // Collect all top-level chrome elements.
      const allRoots = Array.from(
        document.querySelectorAll('header, footer, nav'),
      ) as HTMLElement[];

      // Keep only roots that have no chrome ancestor (prevents double-counting
      // nested chrome, e.g. a <nav> inside a <header>).
      const topRoots = allRoots.filter((root) => {
        let el: HTMLElement | null = root.parentElement;
        while (el) {
          if (CHROME_TAGS.has(el.tagName.toLowerCase())) return false;
          el = el.parentElement;
        }
        return true;
      });

      const rows: Array<{
        anchor: string;
        region: string;
        pathIndex: number[];
        tag: string;
        className: string;
        props: Record<string, string>;
      }> = [];

      for (const outerRoot of topRoots) {
        const outerTag = outerRoot.tagName.toLowerCase();

        // UNWRAP: descend through wp-block-template-part wrappers to the real
        // chrome element. Handles multi-level nesting (while, not if).
        let root: HTMLElement = outerRoot;
        while (root.classList.contains(TEMPLATE_PART_CLASS) && root.firstElementChild) {
          root = root.firstElementChild as HTMLElement;
        }

        const realTag = root.tagName.toLowerCase();
        // Derive region from the real element's tag; fall back to outer chrome tag.
        const region = CHROME_TAGS.has(realTag)
          ? realTag
          : CHROME_TAGS.has(outerTag)
            ? outerTag
            : realTag;

        // Build region-root anchor selector: tag + first class (if any).
        // E.g. 'footer.footer', 'header.site-header', 'nav' (no class).
        // Only use the class when it's a safe CSS identifier — class names can
        // legally contain metacharacters ({ } : >) that would corrupt the emitted
        // selector in site.css; fall back to the bare tag in that case.
        const rawFirstClass = root.classList.length > 0 ? root.classList[0] : '';
        const firstClass = /^[A-Za-z_-][\w-]*$/.test(rawFirstClass) ? rawFirstClass : '';
        const anchor = firstClass ? `${realTag}.${firstClass}` : realTag;

        let count = 0;
        const MAX = 400;

        const walk = (el: HTMLElement, pathIndex: number[]): void => {
          if (count >= MAX) return;
          count++;

          const style = window.getComputedStyle(el);
          const elProps: Record<string, string> = {};
          for (const p of props) {
            elProps[p] = style.getPropertyValue(p).trim();
          }

          rows.push({
            anchor,
            region,
            pathIndex,
            tag: el.tagName.toLowerCase(),
            className: typeof el.className === 'string' ? el.className : '',
            props: elProps,
          });

          const children = (Array.from(el.children) as HTMLElement[]).filter(
            (c) => !SKIP_TAGS[c.tagName.toLowerCase()],
          );
          for (let i = 0; i < children.length; i++) {
            if (count >= MAX) break;
            walk(children[i], [...pathIndex, i]);
          }
        };

        walk(root, []);
      }

      return rows;
    },
    propsArr,
  )) as unknown;

  // Guard: non-array result (e.g. test mock) → no rows.
  if (!Array.isArray(raw)) return [];

  // Build BuiltRow[] Node-side: add the deterministic selector.
  return (
    raw as Array<{
      anchor: string;
      region: string;
      pathIndex: number[];
      tag: string;
      className: string;
      props: Record<string, string>;
    }>
  ).map((r) => ({
    region: r.region as 'header' | 'footer' | 'nav',
    pathIndex: r.pathIndex,
    tag: r.tag,
    className: r.className,
    props: r.props,
    selector: builtSelectorFor(r.anchor, r.pathIndex),
  }));
}
