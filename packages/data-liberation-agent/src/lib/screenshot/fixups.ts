/**
 * src/lib/screenshot/fixups.ts
 * ============================
 * Modular registry of in-page DOM fixups for captured site chrome.
 *
 * Each fixup is a standalone function intended to run INSIDE the browser
 * via `page.evaluate` (or similar). Fixups are documented, independently
 * exportable, and composable into a named registry so additional per-builder
 * fixups are easy to add without touching callers.
 *
 * Integration pattern
 * -------------------
 * Because fixups run inside the browser, they cannot be imported directly as
 * live functions. Instead the caller serialises each fixup body via
 * `.toString()`, injects it into a `page.evaluate` string, and reconstructs
 * the call there. The `CHROME_FIXUP_SOURCE` export packages the source strings
 * for the two bundled fixups so callers have a single import point:
 *
 *   import { CHROME_FIXUP_SOURCE } from './fixups.js';
 *   page.evaluate(`
 *     const depinFixedSticky = ${CHROME_FIXUP_SOURCE.depinFixedSticky};
 *     const bakeComputedLayout = ${CHROME_FIXUP_SOURCE.bakeComputedLayout};
 *     // ... use them
 *   `);
 *
 * `applyChromeFixups` is the high-level convenience that composes both
 * fixups in the correct order (de-pin → bake). It is separately exported so
 * other callers can use it without importing the registry.
 *
 * Dual-viewport responsive chrome bake
 * -------------------------------------
 * The marker-keyed approach replaces the old single-viewport inline bake:
 *
 *   1. `assignChromeMarkers(root)` — depth-first traversal, assigns stable
 *      `dla-fx-N` classes to every element under root. DOM-order stable.
 *   2. `collectBakedLayout(root)` — returns a { [marker]: { prop: value } }
 *      map. De-pins fixed/sticky → static in the returned values. No inline
 *      style mutation (unlike the old bakeComputedLayout).
 *   3. `generateChromeCss(desktopMap, mobileMap)` — emits `@media` blocks:
 *      `min-width:768px` for desktop props and `max-width:767px` for mobile.
 *      Mobile block only contains props that DIFFER from desktop (lean output).
 */

// ---------------------------------------------------------------------------
// 1. depinFixedSticky — un-pin JS-managed fixed / sticky elements
// ---------------------------------------------------------------------------

/**
 * For `root` and every descendant whose computed `position` is `fixed` or
 * `sticky`, write `position:static; top:auto; left:auto; transform:none` as
 * inline styles.
 *
 * Rationale: navigation menus and announcement bars on JS-heavy sites (Wix,
 * Webflow, …) are positioned by JavaScript at capture time. Once JS is
 * stripped in the replica they collapse to 0×0. De-pinning before extraction
 * makes them flow in the document like regular block elements.
 *
 * NOTE: This function is designed to run INSIDE the browser. Export it for
 * use both in tests (via a jsdom-style environment) and for serialisation into
 * `page.evaluate`. Do NOT call it in Node process code directly.
 */
export function depinFixedSticky(root: Element): void {
  const els = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of els) {
    const p = getComputedStyle(el as HTMLElement).position;
    if (p === 'fixed' || p === 'sticky') {
      (el as HTMLElement).style.position = 'static';
      (el as HTMLElement).style.top = 'auto';
      (el as HTMLElement).style.left = 'auto';
      (el as HTMLElement).style.transform = 'none';
    }
  }
}

// ---------------------------------------------------------------------------
// 2. bakeComputedLayout — freeze JS-computed layout as inline styles
// ---------------------------------------------------------------------------

/**
 * Curated set of layout-related CSS properties to bake. The set is intentionally
 * bounded to avoid bloating the HTML with hundreds of properties per element.
 * Covers: box model, flex, grid, sizing, positioning, text flow, visibility.
 */
const BAKED_PROPS = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'box-sizing',
  'float',
  'clear',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-self',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'transform',
  'transform-origin',
  'overflow-x',
  'overflow-y',
  'z-index',
  'text-align',
  'vertical-align',
  'white-space',
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'visibility',
  'opacity',
] as const;

/**
 * For `root` and every descendant, copy a curated set of computed layout
 * properties to inline `style` so the JS-computed layout is frozen and
 * renders pixel-identically without JS.
 *
 * IMPORTANT: when baking `position`, if the computed value is `fixed` or
 * `sticky` it is written as `static` instead — de-pinning is integrated so
 * baking a fixed element does not re-pin it. This means calling
 * `bakeComputedLayout` alone is sufficient; `depinFixedSticky` only needs to
 * be called separately when you want de-pin WITHOUT a full layout bake.
 *
 * Baked properties are appended to any existing inline `style` attribute (via
 * the element's `.style` property) so hand-authored inline styles are not
 * silently discarded.
 *
 * NOTE: This function is designed to run INSIDE the browser. Do NOT call it
 * in Node process code directly.
 */
export function bakeComputedLayout(root: Element): void {
  const props: readonly string[] = [
    'display',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'box-sizing',
    'float',
    'clear',
    'flex-grow',
    'flex-shrink',
    'flex-basis',
    'flex-direction',
    'flex-wrap',
    'justify-content',
    'align-items',
    'align-self',
    'gap',
    'grid-template-columns',
    'grid-template-rows',
    'grid-column',
    'grid-row',
    'transform',
    'transform-origin',
    'overflow-x',
    'overflow-y',
    'z-index',
    'text-align',
    'vertical-align',
    'white-space',
    'font-size',
    'font-weight',
    'line-height',
    'color',
    'visibility',
    'opacity',
  ];
  const els = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of els) {
    const cs = getComputedStyle(el as HTMLElement);
    for (const prop of props) {
      let value = cs.getPropertyValue(prop);
      // De-pin: never bake fixed/sticky — write static instead so the element
      // flows in the replica without JS to manage its position.
      if (prop === 'position' && (value === 'fixed' || value === 'sticky')) {
        value = 'static';
        // Clear offset/transform so the now-static element doesn't inherit
        // stale JS-written offsets.
        (el as HTMLElement).style.setProperty('top', 'auto');
        (el as HTMLElement).style.setProperty('left', 'auto');
        (el as HTMLElement).style.setProperty('transform', 'none');
      }
      if (value) {
        (el as HTMLElement).style.setProperty(prop, value);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. applyChromeFixups — composite fixup for the extracted chrome
// ---------------------------------------------------------------------------

/**
 * Apply the chrome fixup pipeline to a single root element:
 *   1. `depinFixedSticky(root)` — un-pin fixed/sticky descendants
 *   2. `bakeComputedLayout(root)` — freeze JS-computed layout as inline styles
 *      (bakeComputedLayout also handles de-pin for position, so the explicit
 *      depinFixedSticky pass covers transform/top/left on elements where bake
 *      might not reach before serialisation race conditions on some browsers)
 *
 * This is the single entry point for chrome extraction callers. The function
 * is designed to run INSIDE the browser.
 */
export function applyChromeFixups(root: Element): void {
  depinFixedSticky(root);
  bakeComputedLayout(root);
}

// ---------------------------------------------------------------------------
// 4. assignChromeMarkers — assign stable dla-fx-N marker classes (DOM order)
// ---------------------------------------------------------------------------

/**
 * Assign a stable `dla-fx-<n>` class to every element under `root`
 * (depth-first DOM order, including root itself). The same element gets the
 * same marker at BOTH viewport captures as long as the chrome DOM structure is
 * identical at both widths.
 *
 * The marker prefix is deliberately unique (`dla-fx-`) to avoid collisions with
 * source-site classes. The counter starts at 0 (root = dla-fx-0).
 *
 * NOTE: Designed to run INSIDE the browser. Do NOT call in Node process code.
 *
 * Limitation — Wix mobile hamburger: Wix (and similar JS-heavy platforms) may
 * render a completely different chrome DOM at mobile viewport (hamburger menu
 * replaces the desktop nav). When the mobile chrome DOM differs from desktop
 * (different element count / structure), we fall back gracefully: the HTML
 * carries the desktop markers, and `collectBakedLayout` is called independently
 * at each viewport. The `generateChromeCss` function then emits rules only for
 * markers found in each map. Markers present at only one viewport get that
 * viewport's rule only. The mobile hamburger is JS-interactive and will not open
 * in the static replica — this is a known limitation, documented here.
 */
export function assignChromeMarkers(root: Element): string[] {
  const markers: string[] = [];
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (let i = 0; i < all.length; i++) {
    const cls = `dla-fx-${i}`;
    (all[i] as HTMLElement).classList.add(cls);
    markers.push(cls);
  }
  return markers;
}

// ---------------------------------------------------------------------------
// 5. collectBakedLayout — collect per-marker computed layout (no mutation)
// ---------------------------------------------------------------------------

/** Layout props map returned by collectBakedLayout. */
export type BakedLayoutMap = Record<string, Record<string, string>>;

/**
 * For `root` and every descendant that carries a `dla-fx-N` marker class,
 * collect the curated LAYOUT_PROPS computed values into a map keyed on the
 * marker class name.
 *
 * De-pins fixed/sticky: if computed `position` is `fixed` or `sticky`, the
 * returned value is `static` (same semantics as `bakeComputedLayout`, but
 * applied to the returned map rather than inline styles — the HTML is NOT
 * mutated).
 *
 * Returns `{}` when no markers are found (graceful degradation).
 *
 * NOTE: Designed to run INSIDE the browser. Do NOT call in Node process code.
 */
export function collectBakedLayout(root: Element): BakedLayoutMap {
  const props = [
    'display',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'box-sizing',
    'float',
    'clear',
    'flex-grow',
    'flex-shrink',
    'flex-basis',
    'flex-direction',
    'flex-wrap',
    'justify-content',
    'align-items',
    'align-self',
    'gap',
    'grid-template-columns',
    'grid-template-rows',
    'grid-column',
    'grid-row',
    'transform',
    'transform-origin',
    'overflow-x',
    'overflow-y',
    'z-index',
    'text-align',
    'vertical-align',
    'white-space',
    'font-size',
    'font-weight',
    'line-height',
    'color',
    'visibility',
    'opacity',
  ];
  const result: BakedLayoutMap = {};
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    // Find which dla-fx-N class this element carries
    let marker: string | undefined;
    for (const cls of Array.from((el as HTMLElement).classList)) {
      if (cls.startsWith('dla-fx-')) { marker = cls; break; }
    }
    if (!marker) continue;
    const cs = getComputedStyle(el as HTMLElement);
    const entry: Record<string, string> = {};
    for (const prop of props) {
      let value = cs.getPropertyValue(prop);
      if (!value) continue;
      // De-pin: never record fixed/sticky — map static instead.
      if (prop === 'position' && (value === 'fixed' || value === 'sticky')) {
        value = 'static';
        // Also clear offset props so the static element flows correctly.
        entry['top'] = 'auto';
        entry['left'] = 'auto';
        entry['transform'] = 'none';
      }
      entry[prop] = value;
    }
    result[marker] = entry;
  }
  return result;
}

// ---------------------------------------------------------------------------
// 6. generateChromeCss — emit responsive media-query CSS from dual maps
// ---------------------------------------------------------------------------

/**
 * Breakpoint used for desktop/mobile split. Desktop rules apply at ≥768px;
 * mobile rules apply at <768px (max-width: 767px).
 */
const CHROME_BREAKPOINT_PX = 768;

/**
 * Given a desktop layout map and an optional mobile layout map (both from
 * `collectBakedLayout`), emit responsive CSS using `@media` blocks keyed on
 * `.dla-fx-N` selectors.
 *
 * Strategy:
 *   - Desktop block: `@media (min-width: 768px) { .dla-fx-N { … } }` for every
 *     marker in the desktop map.
 *   - Mobile block: `@media (max-width: 767px) { .dla-fx-N { … } }` — only
 *     emitted when the mobile value DIFFERS from the desktop value for that
 *     prop, keeping the output lean. Markers only present in the mobile map
 *     (different DOM) still get emitted — see limitation note in
 *     `assignChromeMarkers`.
 *   - Uses `!important` on desktop rules so they win over any responsive rules
 *     in site.css (which may include the source platform's own media queries
 *     that the baked layout needs to override at desktop widths).
 *   - Mobile rules do NOT use `!important` so site.css responsive rules at
 *     mobile widths can still apply where the baked value matches.
 *
 * When `mobileMap` is undefined or empty, emits desktop-only rules (graceful
 * degradation — current behavior preserved).
 */
export function generateChromeCss(
  desktopMap: BakedLayoutMap,
  mobileMap?: BakedLayoutMap,
): string {
  const lines: string[] = [];

  // --- desktop block --------------------------------------------------------
  for (const [marker, props] of Object.entries(desktopMap)) {
    const declarations = Object.entries(props)
      .map(([prop, value]) => `    ${prop}: ${value} !important;`)
      .join('\n');
    if (!declarations) continue;
    lines.push(
      `@media (min-width: ${CHROME_BREAKPOINT_PX}px) {`,
      `  .${marker} {`,
      declarations,
      `  }`,
      `}`,
    );
  }

  // --- mobile block ---------------------------------------------------------
  if (mobileMap && Object.keys(mobileMap).length > 0) {
    // Collect ALL markers from both maps to handle different-DOM case.
    const allMobileMarkers = new Set([
      ...Object.keys(mobileMap),
    ]);

    for (const marker of allMobileMarkers) {
      const mobileProps = mobileMap[marker] ?? {};
      const desktopProps = desktopMap[marker] ?? {};

      // Only emit mobile props that differ from desktop (or are mobile-only).
      const diffEntries = Object.entries(mobileProps).filter(
        ([prop, value]) => desktopProps[prop] !== value,
      );
      if (diffEntries.length === 0) continue;

      const declarations = diffEntries
        .map(([prop, value]) => `    ${prop}: ${value};`)
        .join('\n');
      lines.push(
        `@media (max-width: ${CHROME_BREAKPOINT_PX - 1}px) {`,
        `  .${marker} {`,
        declarations,
        `  }`,
        `}`,
      );
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Source strings for browser injection
// ---------------------------------------------------------------------------

/**
 * Individual function source strings, keyed by name.
 *
 * Used by tests and for documentation. For browser injection prefer
 * `CHROME_FIXUP_FACTORY_SOURCE` which is self-contained.
 */
export const CHROME_FIXUP_SOURCE = {
  depinFixedSticky: depinFixedSticky.toString(),
  bakeComputedLayout: bakeComputedLayout.toString(),
  applyChromeFixups: applyChromeFixups.toString(),
} as const;

/**
 * Source strings for the marker-based dual-viewport approach.
 * Used by dom-capture.ts for browser injection.
 */
export const CHROME_MARKER_SOURCE = {
  assignChromeMarkers: assignChromeMarkers.toString(),
  collectBakedLayout: collectBakedLayout.toString(),
} as const;

/**
 * A self-contained factory source string.
 *
 * When evaluated with `new Function('return (' + factorySrc + '')()')` in
 * the browser, it returns a ready-to-call `applyChromeFixups(root)` function
 * with all dependencies embedded in its closure — no external names needed.
 *
 * `dom-capture.ts` passes this string as an argument to `page.evaluate` and
 * reconstructs the applier inside the browser via `new Function`. This keeps
 * `fixups.ts` as the single source of truth while avoiding serialisation
 * problems with closures that reference Node-side module exports.
 *
 * Usage:
 *   const { factorySrc } = CHROME_FIXUP_FACTORY_SOURCE;
 *   await page.evaluate(({ factorySrc }) => {
 *     const applyChromeFixups = new Function('return (' + factorySrc + ')')()();
 *     applyChromeFixups(document.querySelector('header'));
 *   }, { factorySrc });
 */

// Build the factory source by embedding the individual function source strings
// so the resulting string is fully self-contained in the browser context.
const _depinSrc = depinFixedSticky.toString();
const _bakeSrc = bakeComputedLayout.toString();

// The factory is an IIFE that captures the helper functions and returns the
// composite applier. It is designed to be evaluated as:
//   new Function('return (' + factorySrc + ')')()
// which returns the factory function; calling it returns the applier:
//   new Function('return (' + factorySrc + ')')()()
const _factorySrc = `(function() {
  var depinFixedSticky = (${_depinSrc});
  var bakeComputedLayout = (${_bakeSrc});
  return function applyChromeFixups(root) {
    depinFixedSticky(root);
    bakeComputedLayout(root);
  };
})`;

export const CHROME_FIXUP_FACTORY_SOURCE: { factorySrc: string } = {
  factorySrc: _factorySrc,
};

// Build the marker factory source embedding assignChromeMarkers + collectBakedLayout.
const _markerSrc = assignChromeMarkers.toString();
const _collectSrc = collectBakedLayout.toString();

/**
 * Self-contained factory for the marker-based dual-viewport chrome capture.
 * Evaluated in the browser via `new Function('return (' + factorySrc + ')')()`.
 * Returns an object `{ assignChromeMarkers, collectBakedLayout }`.
 */
const _markerFactorySrc = `(function() {
  var assignChromeMarkers = (${_markerSrc});
  var collectBakedLayout = (${_collectSrc});
  return { assignChromeMarkers: assignChromeMarkers, collectBakedLayout: collectBakedLayout };
})`;

export const CHROME_MARKER_FACTORY_SOURCE: { factorySrc: string } = {
  factorySrc: _markerFactorySrc,
};

// ---------------------------------------------------------------------------
// 7. stripCoverImageDimensions — remove inline width/height from cover images
// ---------------------------------------------------------------------------

/**
 * For every `<img>` within `root` whose computed `object-fit` is `cover`:
 *   - Remove `width` and `height` from the element's inline `style` (preserving
 *     all other inline style properties such as `object-fit` and `object-position`).
 *   - Remove the legacy HTML `width` and `height` attributes if present.
 *
 * Rationale: Wix (and similar platforms) use JavaScript at runtime to size
 * images. The captured static HTML contains `<img>` elements with
 * `object-fit: cover` AND explicit inline `width`/`height` px values set by
 * that JS. Without Wix's JS running, those fixed dimensions prevent the image
 * from filling its container. Removing them lets the container/CSS control
 * the size, which is the correct behaviour for `object-fit: cover` images.
 *
 * Images NOT rendered with `object-fit: cover` are left completely untouched.
 *
 * NOTE: Designed to run INSIDE the browser via `page.evaluate`. Do NOT call
 * in Node process code directly.
 */
export function stripCoverImageDimensions(root: Element): void {
  const imgs = Array.from(root.querySelectorAll('img'));
  for (const img of imgs) {
    if (getComputedStyle(img).objectFit === 'cover') {
      img.style.removeProperty('width');
      img.style.removeProperty('height');
      img.removeAttribute('width');
      img.removeAttribute('height');
    }
  }
}

// Build the cover-image fixup factory source so it is self-contained for
// browser injection (mirrors CHROME_FIXUP_FACTORY_SOURCE / CHROME_MARKER_FACTORY_SOURCE).
const _coverSrc = stripCoverImageDimensions.toString();

/**
 * Self-contained factory source for `stripCoverImageDimensions`.
 *
 * Usage in page.evaluate:
 *   const { factorySrc } = COVER_IMAGE_FIXUP_FACTORY_SOURCE;
 *   await page.evaluate(({ factorySrc }) => {
 *     const stripCoverImageDimensions = new Function('return (' + factorySrc + ')')()();
 *     stripCoverImageDimensions(document.body);
 *   }, { factorySrc });
 */
const _coverFactorySrc = `(function() {
  var stripCoverImageDimensions = (${_coverSrc});
  return stripCoverImageDimensions;
})`;

export const COVER_IMAGE_FIXUP_FACTORY_SOURCE: { factorySrc: string } = {
  factorySrc: _coverFactorySrc,
};

// Re-export the property list so tests can verify the exact set.
export { BAKED_PROPS };
