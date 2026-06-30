/**
 * fixups.test.ts
 * ==============
 * Playwright fixture tests for the modular chrome fixup registry (fixups.ts).
 *
 * Covers:
 *   - `bakeComputedLayout`: layout/box/flex/grid/text properties are frozen as
 *     inline styles; `position:fixed` children become `position:static`.
 *   - `depinFixedSticky`: standalone de-pin without layout bake.
 *   - `CHROME_FIXUP_FACTORY_SOURCE`: the self-contained factory string produces
 *     a working applier in the browser (composite de-pin + bake).
 *   - `BAKED_PROPS`: exported property list matches the expected set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import {
  BAKED_PROPS,
  CHROME_FIXUP_FACTORY_SOURCE,
  CHROME_FIXUP_SOURCE,
  CHROME_MARKER_FACTORY_SOURCE,
  COVER_IMAGE_FIXUP_FACTORY_SOURCE,
  depinFixedSticky,
  bakeComputedLayout,
  applyChromeFixups,
  generateChromeCss,
  stripCoverImageDimensions,
  type BakedLayoutMap,
} from './fixups.js';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

// ---------------------------------------------------------------------------
// Fixture: a flex container with known CSS + a position:fixed child.
// We use inline/class CSS so getComputedStyle returns predictable values.
// ---------------------------------------------------------------------------
const FIXTURE = `<!DOCTYPE html><html><head>
  <style>
    #container {
      display: flex;
      width: 960px;
      height: 80px;
      align-items: center;
      gap: 16px;
      background: #111;
    }
    #fixed-child {
      position: fixed;
      top: 0;
      left: 0;
      width: 200px;
      height: 40px;
    }
    #normal-child {
      font-size: 18px;
      font-weight: 700;
    }
  </style>
</head><body style="margin:0">
  <div id="container">
    <div id="fixed-child">Fixed nav item</div>
    <div id="normal-child">Normal nav item</div>
  </div>
</body></html>`;

// ---------------------------------------------------------------------------
// BAKED_PROPS export
// ---------------------------------------------------------------------------
describe('BAKED_PROPS', () => {
  it('includes the required layout/box/flex/text properties', () => {
    const required = [
      'display', 'position', 'width', 'height',
      'flex-direction', 'justify-content', 'align-items', 'gap',
      'grid-template-columns', 'grid-template-rows',
      'font-size', 'font-weight', 'color', 'visibility', 'opacity',
    ];
    for (const prop of required) {
      expect((BAKED_PROPS as readonly string[]).includes(prop), `BAKED_PROPS must include "${prop}"`).toBe(true);
    }
  });

  it('is bounded (<=60 properties) and excludes non-layout decorative properties', () => {
    expect(BAKED_PROPS.length).toBeLessThanOrEqual(60);
    const excluded = ['background-color', 'border', 'outline', 'cursor', 'list-style'];
    for (const prop of excluded) {
      expect((BAKED_PROPS as readonly string[]).includes(prop), `BAKED_PROPS must NOT include "${prop}"`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// exported fixup function shapes (Node-side — no browser needed)
// ---------------------------------------------------------------------------
describe('exported fixup function shapes', () => {
  it('depinFixedSticky is a named function', () => {
    expect(typeof depinFixedSticky).toBe('function');
    expect(depinFixedSticky.name).toBe('depinFixedSticky');
  });

  it('bakeComputedLayout is a named function', () => {
    expect(typeof bakeComputedLayout).toBe('function');
    expect(bakeComputedLayout.name).toBe('bakeComputedLayout');
  });

  it('applyChromeFixups is a named function', () => {
    expect(typeof applyChromeFixups).toBe('function');
    expect(applyChromeFixups.name).toBe('applyChromeFixups');
  });

  it('CHROME_FIXUP_SOURCE contains non-empty string for each fixup', () => {
    expect(typeof CHROME_FIXUP_SOURCE.depinFixedSticky).toBe('string');
    expect(CHROME_FIXUP_SOURCE.depinFixedSticky.length).toBeGreaterThan(100);
    expect(typeof CHROME_FIXUP_SOURCE.bakeComputedLayout).toBe('string');
    expect(CHROME_FIXUP_SOURCE.bakeComputedLayout.length).toBeGreaterThan(100);
    expect(typeof CHROME_FIXUP_SOURCE.applyChromeFixups).toBe('string');
    expect(CHROME_FIXUP_SOURCE.applyChromeFixups.length).toBeGreaterThan(50);
  });

  it('CHROME_FIXUP_FACTORY_SOURCE.factorySrc is a non-empty self-contained string', () => {
    expect(typeof CHROME_FIXUP_FACTORY_SOURCE.factorySrc).toBe('string');
    expect(CHROME_FIXUP_FACTORY_SOURCE.factorySrc.length).toBeGreaterThan(200);
    // The factory must be self-contained: it should embed the helper sources.
    expect(CHROME_FIXUP_FACTORY_SOURCE.factorySrc).toContain('depinFixedSticky');
    expect(CHROME_FIXUP_FACTORY_SOURCE.factorySrc).toContain('bakeComputedLayout');
    expect(CHROME_FIXUP_FACTORY_SOURCE.factorySrc).toContain('applyChromeFixups');
  });
});

// ---------------------------------------------------------------------------
// bakeComputedLayout — in-browser via CHROME_FIXUP_FACTORY_SOURCE
// ---------------------------------------------------------------------------
describe('bakeComputedLayout (via factory, Playwright fixture)', () => {
  it('bakes display, width, height from computed style onto the flex container', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    try {
      const { factorySrc } = CHROME_FIXUP_FACTORY_SOURCE;
      const containerStyle = await page.evaluate(({ factorySrc }: { factorySrc: string }) => {
        const makeApplier = new Function('return (' + factorySrc + ')')() as () => (root: Element) => void;
        const applyChromeFixups = makeApplier();
        const container = document.getElementById('container') as HTMLElement;
        applyChromeFixups(container);
        return container.getAttribute('style') ?? '';
      }, { factorySrc });

      expect(containerStyle).toMatch(/display:/);
      expect(containerStyle).toMatch(/width:\s*960px/);
      expect(containerStyle).toMatch(/height:\s*80px/);
      expect(containerStyle).toMatch(/align-items:/);
    } finally {
      await page.close();
    }
  });

  it('rewrites position:fixed on a child to position:static and clears top/left', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    try {
      const { factorySrc } = CHROME_FIXUP_FACTORY_SOURCE;
      const fixedChildStyle = await page.evaluate(({ factorySrc }: { factorySrc: string }) => {
        const makeApplier = new Function('return (' + factorySrc + ')')() as () => (root: Element) => void;
        const applyChromeFixups = makeApplier();
        const container = document.getElementById('container') as HTMLElement;
        applyChromeFixups(container);
        const fixedChild = document.getElementById('fixed-child') as HTMLElement;
        return fixedChild.getAttribute('style') ?? '';
      }, { factorySrc });

      // Fixed child must be de-pinned.
      expect(fixedChildStyle).toMatch(/position:\s*static/);
      // Chromium serialises top/right/bottom/left as the `inset` shorthand in
      // some versions; accept either the longhand or the shorthand form.
      const hasTopAuto = /top:\s*auto/.test(fixedChildStyle) || /inset:\s*auto/.test(fixedChildStyle);
      expect(hasTopAuto, 'top should be auto (or inset shorthand)').toBe(true);
      const hasLeftAuto = /left:\s*auto/.test(fixedChildStyle) || /inset:\s*auto/.test(fixedChildStyle);
      expect(hasLeftAuto, 'left should be auto (or inset shorthand)').toBe(true);
    } finally {
      await page.close();
    }
  });

  it('does NOT rewrite position to fixed/sticky on a statically-positioned child', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    try {
      const { factorySrc } = CHROME_FIXUP_FACTORY_SOURCE;
      const positionValue = await page.evaluate(({ factorySrc }: { factorySrc: string }) => {
        const makeApplier = new Function('return (' + factorySrc + ')')() as () => (root: Element) => void;
        const applyChromeFixups = makeApplier();
        const container = document.getElementById('container') as HTMLElement;
        applyChromeFixups(container);
        const normalChild = document.getElementById('normal-child') as HTMLElement;
        const style = normalChild.getAttribute('style') ?? '';
        const match = style.match(/position:\s*([^;]+)/);
        return match ? match[1].trim() : null;
      }, { factorySrc });

      expect(positionValue).not.toBe('fixed');
      expect(positionValue).not.toBe('sticky');
    } finally {
      await page.close();
    }
  });

  it('bakes font-size and font-weight onto text children', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    try {
      const { factorySrc } = CHROME_FIXUP_FACTORY_SOURCE;
      const normalChildStyle = await page.evaluate(({ factorySrc }: { factorySrc: string }) => {
        const makeApplier = new Function('return (' + factorySrc + ')')() as () => (root: Element) => void;
        const applyChromeFixups = makeApplier();
        const container = document.getElementById('container') as HTMLElement;
        applyChromeFixups(container);
        const normalChild = document.getElementById('normal-child') as HTMLElement;
        return normalChild.getAttribute('style') ?? '';
      }, { factorySrc });

      expect(normalChildStyle).toMatch(/font-size:\s*18px/);
      expect(normalChildStyle).toMatch(/font-weight:\s*700/);
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// depinFixedSticky — standalone de-pin (CHROME_FIXUP_SOURCE injection)
// ---------------------------------------------------------------------------
describe('depinFixedSticky standalone (CHROME_FIXUP_SOURCE, Playwright fixture)', () => {
  it('de-pins fixed elements WITHOUT baking other layout props on the container', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    try {
      const depinSrc = CHROME_FIXUP_SOURCE.depinFixedSticky;
      const result = await page.evaluate(({ depinSrc }: { depinSrc: string }) => {
        const depinFixedSticky = new Function('return (' + depinSrc + ')')() as (root: Element) => void;
        const container = document.getElementById('container') as HTMLElement;
        depinFixedSticky(container);
        const fixedChild = document.getElementById('fixed-child') as HTMLElement;
        return {
          fixedChildStyle: fixedChild.getAttribute('style') ?? '',
          containerStyle: container.getAttribute('style') ?? '',
        };
      }, { depinSrc });

      // Fixed child is de-pinned.
      expect(result.fixedChildStyle).toMatch(/position:\s*static/);
      expect(result.fixedChildStyle).toMatch(/top:\s*auto/);
      expect(result.fixedChildStyle).toMatch(/left:\s*auto/);
      expect(result.fixedChildStyle).toMatch(/transform:\s*none/);
      // Container has no layout bake — width/height must NOT be in inline style.
      expect(result.containerStyle).not.toMatch(/width:/);
      expect(result.containerStyle).not.toMatch(/height:/);
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// assignChromeMarkers + collectBakedLayout — via CHROME_MARKER_FACTORY_SOURCE
// ---------------------------------------------------------------------------

describe('assignChromeMarkers (via marker factory, Playwright fixture)', () => {
  it('assigns dla-fx-0 to root and dla-fx-N to each descendant in DOM order', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    try {
      const { factorySrc } = CHROME_MARKER_FACTORY_SOURCE;
      const result = await page.evaluate(({ factorySrc }: { factorySrc: string }) => {
        const { assignChromeMarkers } = new Function('return (' + factorySrc + ')')()() as {
          assignChromeMarkers: (root: Element) => string[];
          collectBakedLayout: (root: Element) => Record<string, Record<string, string>>;
        };
        const container = document.getElementById('container') as HTMLElement;
        const markers = assignChromeMarkers(container);
        // Return class list of each element in DOM order to verify marker assignment
        const all = [container, ...Array.from(container.querySelectorAll('*'))];
        const classesByOrder = all.map((el) =>
          Array.from((el as HTMLElement).classList).filter((c) => c.startsWith('dla-fx-'))
        );
        return { markers, classesByOrder };
      }, { factorySrc });

      // Root gets dla-fx-0
      expect(result.markers[0]).toBe('dla-fx-0');
      // Children get sequential markers
      expect(result.markers[1]).toBe('dla-fx-1');
      expect(result.markers[2]).toBe('dla-fx-2');
      // Each element should have exactly one dla-fx marker class
      for (const classes of result.classesByOrder) {
        expect(classes.length).toBe(1);
        expect(classes[0]).toMatch(/^dla-fx-\d+$/);
      }
    } finally {
      await page.close();
    }
  });

  it('markers are stable: same element gets same dla-fx-N in DOM order', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    try {
      const { factorySrc } = CHROME_MARKER_FACTORY_SOURCE;
      const result = await page.evaluate(({ factorySrc }: { factorySrc: string }) => {
        const { assignChromeMarkers } = new Function('return (' + factorySrc + ')')()() as {
          assignChromeMarkers: (root: Element) => string[];
          collectBakedLayout: (root: Element) => Record<string, Record<string, string>>;
        };
        const container = document.getElementById('container') as HTMLElement;
        const markers = assignChromeMarkers(container);
        // Verify that fixed-child is the 2nd element (index 1) in DOM order
        const fixedChild = document.getElementById('fixed-child') as HTMLElement;
        const fixedChildMarker = Array.from(fixedChild.classList).find((c) => c.startsWith('dla-fx-'));
        return { markers, fixedChildMarker };
      }, { factorySrc });

      // fixed-child is the first child of container → should be dla-fx-1
      expect(result.fixedChildMarker).toBe('dla-fx-1');
      expect(result.markers[1]).toBe('dla-fx-1');
    } finally {
      await page.close();
    }
  });
});

describe('collectBakedLayout (via marker factory, Playwright fixture)', () => {
  it('returns a marker→props map with layout values for each marked element', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    try {
      const { factorySrc } = CHROME_MARKER_FACTORY_SOURCE;
      const layoutMap = await page.evaluate(({ factorySrc }: { factorySrc: string }) => {
        const { assignChromeMarkers, collectBakedLayout } = new Function('return (' + factorySrc + ')')()() as {
          assignChromeMarkers: (root: Element) => string[];
          collectBakedLayout: (root: Element) => Record<string, Record<string, string>>;
        };
        const container = document.getElementById('container') as HTMLElement;
        assignChromeMarkers(container);
        return collectBakedLayout(container);
      }, { factorySrc });

      // Container (dla-fx-0) should have display, width, height
      expect(layoutMap['dla-fx-0']).toBeDefined();
      expect(layoutMap['dla-fx-0']['display']).toBeTruthy();
      expect(layoutMap['dla-fx-0']['width']).toBeTruthy();
      expect(layoutMap['dla-fx-0']['height']).toBeTruthy();

      // Some markers should exist for children
      expect(Object.keys(layoutMap).length).toBeGreaterThan(1);
    } finally {
      await page.close();
    }
  });

  it('de-pins fixed/sticky → static in the returned map (no inline style mutation)', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    try {
      const { factorySrc } = CHROME_MARKER_FACTORY_SOURCE;
      const result = await page.evaluate(({ factorySrc }: { factorySrc: string }) => {
        const { assignChromeMarkers, collectBakedLayout } = new Function('return (' + factorySrc + ')')()() as {
          assignChromeMarkers: (root: Element) => string[];
          collectBakedLayout: (root: Element) => Record<string, Record<string, string>>;
        };
        const container = document.getElementById('container') as HTMLElement;
        assignChromeMarkers(container);
        const layoutMap = collectBakedLayout(container);
        // Get the marker for fixed-child (should be dla-fx-1)
        const fixedChild = document.getElementById('fixed-child') as HTMLElement;
        const marker = Array.from(fixedChild.classList).find((c) => c.startsWith('dla-fx-'));
        // Check the computed style is still "fixed" (inline style NOT mutated)
        const computedPos = getComputedStyle(fixedChild).position;
        // Return both the map value and the live computed style
        return {
          mapPosition: marker ? (layoutMap[marker]?.['position'] ?? null) : null,
          marker,
          liveComputedPosition: computedPos,
        };
      }, { factorySrc });

      // Map should say static (de-pinned in the map)
      expect(result.mapPosition).toBe('static');
      // The live computed style should still be fixed (no inline mutation)
      expect(result.liveComputedPosition).toBe('fixed');
    } finally {
      await page.close();
    }
  });

  it('returns {} when no dla-fx markers are present on any element', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    try {
      const { factorySrc } = CHROME_MARKER_FACTORY_SOURCE;
      const layoutMap = await page.evaluate(({ factorySrc }: { factorySrc: string }) => {
        const { collectBakedLayout } = new Function('return (' + factorySrc + ')')()() as {
          assignChromeMarkers: (root: Element) => string[];
          collectBakedLayout: (root: Element) => Record<string, Record<string, string>>;
        };
        // Don't assign markers first — collectBakedLayout should return {}
        const container = document.getElementById('container') as HTMLElement;
        return collectBakedLayout(container);
      }, { factorySrc });

      expect(Object.keys(layoutMap).length).toBe(0);
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// generateChromeCss — Node-side (pure function, no browser needed)
// ---------------------------------------------------------------------------

describe('generateChromeCss (Node-side)', () => {
  it('emits @media (min-width: 768px) desktop rules for each marker', () => {
    const desktopMap: BakedLayoutMap = {
      'dla-fx-0': { display: 'flex', width: '1440px', height: '80px' },
      'dla-fx-1': { display: 'block', position: 'static' },
    };
    const css = generateChromeCss(desktopMap);
    expect(css).toContain('@media (min-width: 768px)');
    expect(css).toContain('.dla-fx-0');
    expect(css).toContain('.dla-fx-1');
    expect(css).toContain('display: flex !important');
    expect(css).toContain('width: 1440px !important');
    expect(css).toContain('height: 80px !important');
  });

  it('emits @media (max-width: 767px) mobile rules with only differing props', () => {
    const desktopMap: BakedLayoutMap = {
      'dla-fx-0': { display: 'flex', width: '1440px', height: '80px' },
    };
    const mobileMap: BakedLayoutMap = {
      'dla-fx-0': { display: 'flex', width: '390px', height: '56px' },
    };
    const css = generateChromeCss(desktopMap, mobileMap);

    // Mobile block should exist
    expect(css).toContain('@media (max-width: 767px)');
    // Mobile block should have width and height (they differ)
    expect(css).toContain('width: 390px');
    expect(css).toContain('height: 56px');
    // Mobile block should NOT have display (it's the same: flex)
    // Extract the max-width block
    const mobileBlock = css.split('@media (max-width: 767px)')[1] ?? '';
    expect(mobileBlock).not.toContain('display: flex');
  });

  it('mobile block omitted when mobile values are identical to desktop', () => {
    const desktopMap: BakedLayoutMap = {
      'dla-fx-0': { display: 'flex', width: '1440px' },
    };
    const mobileMap: BakedLayoutMap = {
      'dla-fx-0': { display: 'flex', width: '1440px' },
    };
    const css = generateChromeCss(desktopMap, mobileMap);
    expect(css).toContain('@media (min-width: 768px)');
    expect(css).not.toContain('@media (max-width: 767px)');
  });

  it('desktop-only output when mobileMap is undefined', () => {
    const desktopMap: BakedLayoutMap = {
      'dla-fx-0': { display: 'flex', width: '1440px' },
    };
    const css = generateChromeCss(desktopMap, undefined);
    expect(css).toContain('@media (min-width: 768px)');
    expect(css).not.toContain('@media (max-width:');
  });

  it('desktop-only output when mobileMap is empty', () => {
    const desktopMap: BakedLayoutMap = {
      'dla-fx-0': { display: 'flex' },
    };
    const css = generateChromeCss(desktopMap, {});
    expect(css).toContain('@media (min-width: 768px)');
    expect(css).not.toContain('@media (max-width:');
  });

  it('mobile-only markers (different DOM) still get mobile rules emitted', () => {
    const desktopMap: BakedLayoutMap = {
      'dla-fx-0': { display: 'flex' },
    };
    // Mobile DOM has different elements (e.g. hamburger) — only new markers
    const mobileMap: BakedLayoutMap = {
      'dla-fx-0': { display: 'flex' },
      'dla-fx-99': { display: 'block', width: '100%' },
    };
    const css = generateChromeCss(desktopMap, mobileMap);
    // dla-fx-99 is mobile-only, should appear in mobile block
    expect(css).toContain('.dla-fx-99');
    expect(css).toContain('@media (max-width: 767px)');
    // dla-fx-0 has same display value, should NOT appear in mobile block
    const mobileBlock = css.split('@media (max-width: 767px)')[1] ?? '';
    expect(mobileBlock).not.toContain('.dla-fx-0');
  });

  it('returns empty string for empty desktop map', () => {
    const css = generateChromeCss({}, {});
    expect(css.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// stripCoverImageDimensions — Wix cover-image inline dimension fixup
// ---------------------------------------------------------------------------

/**
 * Fixture: one cover image (object-fit:cover with explicit inline w/h + HTML
 * attrs) and one non-cover image (plain w/h only). After the fixup:
 *   - The cover image: NO inline width/height, NO width/height attrs, but
 *     object-fit and object-position are preserved.
 *   - The non-cover image: completely unchanged.
 */
const COVER_FIXTURE = `<!DOCTYPE html><html><head>
  <style>
    #cover-img { object-fit: cover; object-position: 50% 50%; }
    #plain-img { display: block; }
  </style>
</head><body>
  <img id="cover-img"
       style="object-fit:cover;object-position:50% 50%;width:480px;height:320px"
       width="480" height="320"
       src="https://example.com/hero.jpg">
  <img id="plain-img"
       style="width:100px;height:100px"
       width="100" height="100"
       src="https://example.com/thumb.jpg">
</body></html>`;

describe('stripCoverImageDimensions (via factory, Playwright fixture)', () => {
  it('is a named function', () => {
    expect(typeof stripCoverImageDimensions).toBe('function');
    expect(stripCoverImageDimensions.name).toBe('stripCoverImageDimensions');
  });

  it('COVER_IMAGE_FIXUP_FACTORY_SOURCE.factorySrc is a non-empty self-contained string', () => {
    expect(typeof COVER_IMAGE_FIXUP_FACTORY_SOURCE.factorySrc).toBe('string');
    expect(COVER_IMAGE_FIXUP_FACTORY_SOURCE.factorySrc.length).toBeGreaterThan(100);
    expect(COVER_IMAGE_FIXUP_FACTORY_SOURCE.factorySrc).toContain('stripCoverImageDimensions');
    expect(COVER_IMAGE_FIXUP_FACTORY_SOURCE.factorySrc).toContain('objectFit');
  });

  it('removes inline width/height from a cover image, preserves object-fit/object-position', async () => {
    const page = await browser.newPage();
    await page.setContent(COVER_FIXTURE);
    try {
      const { factorySrc } = COVER_IMAGE_FIXUP_FACTORY_SOURCE;
      const result = await page.evaluate(({ factorySrc }: { factorySrc: string }) => {
        const strip = new Function('return (' + factorySrc + ')')()() as (root: Element) => void;
        strip(document.body);
        const img = document.getElementById('cover-img') as HTMLImageElement;
        return {
          inlineStyle: img.getAttribute('style') ?? '',
          widthAttr: img.getAttribute('width'),
          heightAttr: img.getAttribute('height'),
        };
      }, { factorySrc });

      // Inline width/height must be gone
      expect(result.inlineStyle).not.toMatch(/\bwidth\s*:/);
      expect(result.inlineStyle).not.toMatch(/\bheight\s*:/);
      // HTML attributes must be gone
      expect(result.widthAttr).toBeNull();
      expect(result.heightAttr).toBeNull();
      // object-fit and object-position must be preserved
      expect(result.inlineStyle).toMatch(/object-fit\s*:\s*cover/);
      expect(result.inlineStyle).toMatch(/object-position\s*:/);
    } finally {
      await page.close();
    }
  });

  it('leaves a non-cover image completely unchanged', async () => {
    const page = await browser.newPage();
    await page.setContent(COVER_FIXTURE);
    try {
      const { factorySrc } = COVER_IMAGE_FIXUP_FACTORY_SOURCE;
      const result = await page.evaluate(({ factorySrc }: { factorySrc: string }) => {
        const strip = new Function('return (' + factorySrc + ')')()() as (root: Element) => void;
        strip(document.body);
        const img = document.getElementById('plain-img') as HTMLImageElement;
        return {
          inlineStyle: img.getAttribute('style') ?? '',
          widthAttr: img.getAttribute('width'),
          heightAttr: img.getAttribute('height'),
        };
      }, { factorySrc });

      // The plain image's inline style must still have width and height
      expect(result.inlineStyle).toMatch(/width\s*:\s*100px/);
      expect(result.inlineStyle).toMatch(/height\s*:\s*100px/);
      // HTML attributes must still be present
      expect(result.widthAttr).toBe('100');
      expect(result.heightAttr).toBe('100');
    } finally {
      await page.close();
    }
  });
});
