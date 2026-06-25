import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { collectBodyFragment, collectStylesheets, collectHeadLinks, collectScripts, collectBodyAndChrome, collectBodyFragmentMobileOnly, collectMobileChromeLayout } from './dom-capture.js';

const FIXTURE = `<!DOCTYPE html><html><head>
  <style>.hero{color:red}</style>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=X">
</head><body class="home dark">
  <header>chrome</header>
  <main><h1>Title</h1><img src="https://src.test/a.png" srcset="https://src.test/a2.png 2x"></main>
  <script src="https://src.test/app.js"></script>
  <script>window.__x = 1;</script>
</body></html>`;

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

describe('dom-capture', () => {
  it('serializes the body fragment keeping image URLs', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    const frag = await collectBodyFragment(page);
    expect(frag).toContain('https://src.test/a.png');
    expect(frag).toContain('srcset="https://src.test/a2.png 2x"');
    expect(frag).not.toContain('<body');
    await page.close();
  });
  it('collects same-origin stylesheet cssText', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    const css = await collectStylesheets(page);
    expect(css).toContain('.hero');
    await page.close();
  });
  it('lists head <link> stylesheet hrefs', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    const links = await collectHeadLinks(page);
    expect(links.some((l) => l.includes('fonts.googleapis.com'))).toBe(true);
    await page.close();
  });
  it('lists scripts in order (external src + inline)', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    const scripts = await collectScripts(page);
    expect(scripts.some((s) => s.src && s.src.includes('src.test/app.js'))).toBe(true);
    expect(scripts.some((s) => s.inline && s.inline.includes('__x'))).toBe(true);
    await page.close();
  });
});

const CHROME_FIXTURE = `<!DOCTYPE html><html><head>
  <style>
    header { display: flex; width: 100%; height: 60px; background: #333; }
    footer { display: block; width: 100%; height: 40px; background: #222; }
  </style>
</head><body style="margin:0">
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <main><h1>Content</h1><p>Body text</p></main>
  <footer><p>foot &copy; 2025</p></footer>
</body></html>`;

// A fixture with a position:fixed header to verify de-pin behaviour.
const FIXED_CHROME_FIXTURE = `<!DOCTYPE html><html><head>
  <style>
    header { position: fixed; top: 0; left: 0; width: 100%; height: 60px; background: #333; }
    footer { display: block; width: 100%; height: 40px; background: #222; }
  </style>
</head><body style="margin:0;padding-top:60px">
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <main><h1>Content</h1><p>Body text</p></main>
  <footer><p>foot &copy; 2025</p></footer>
</body></html>`;

describe('collectBodyAndChrome', () => {
  it('extracts nav (header) + footer and removes them from the body fragment', async () => {
    const page = await browser.newPage();
    await page.setContent(CHROME_FIXTURE);
    const { bodyFragmentHtml, nav, footerHtml } = await collectBodyAndChrome(page);

    // Header was detected — nav data extracted (not baked HTML)
    expect(nav).not.toBeNull();
    // Nav items from the fixture: Home, About
    expect(nav!.items.some((item) => item.label === 'Home')).toBe(true);

    // Footer was detected and contains footer text (still baked)
    expect(footerHtml).not.toBeNull();
    expect(footerHtml).toContain('foot');

    // Chrome elements were removed from the body fragment
    expect(bodyFragmentHtml).not.toContain('Home');
    expect(bodyFragmentHtml).not.toContain('foot');

    // Main content is still present
    expect(bodyFragmentHtml).toContain('Content');
    await page.close();
  });

  it('footer HTML carries dla-fx-N marker classes and desktopLayoutMap has computed props', async () => {
    const page = await browser.newPage();
    await page.setContent(CHROME_FIXTURE);
    const { nav, footerHtml, desktopLayoutMap } = await collectBodyAndChrome(page);

    // nav is extracted data (no marker classes needed in nav object)
    expect(nav).not.toBeNull();
    expect(nav!.items.length).toBeGreaterThan(0);

    // Footer HTML still carries dla-fx-N classes (footer still uses bake path)
    expect(footerHtml).not.toBeNull();
    expect(footerHtml).toContain('dla-fx-');

    // desktopLayoutMap should have entries for the chrome elements.
    expect(desktopLayoutMap).not.toBeNull();
    expect(Object.keys(desktopLayoutMap!).length).toBeGreaterThan(0);

    // Root elements (dla-fx-0 = header root, later keys = footer) should have display + height.
    const headerRootMarker = Object.keys(desktopLayoutMap!)[0];
    expect(desktopLayoutMap![headerRootMarker]['display']).toBeTruthy();
    expect(desktopLayoutMap![headerRootMarker]['height']).toBeTruthy();
    await page.close();
  });

  it('desktopLayoutMap has position:static for originally-fixed header (de-pinned in map)', async () => {
    const page = await browser.newPage();
    await page.setContent(FIXED_CHROME_FIXTURE);
    const { nav, desktopLayoutMap } = await collectBodyAndChrome(page);

    // nav is extracted (header detected even when fixed)
    expect(nav).not.toBeNull();
    expect(desktopLayoutMap).not.toBeNull();

    // The header was position:fixed — the map should record static (de-pinned).
    // Find the header root marker (first key in the map is header's root).
    const headerRootMarker = Object.keys(desktopLayoutMap!)[0];
    expect(desktopLayoutMap![headerRootMarker]['position']).toBe('static');
    await page.close();
  });

  it('returns null nav + chrome when no header/footer elements exist', async () => {
    const page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><html><body><main><p>Only content</p></main></body></html>');
    const { bodyFragmentHtml, nav, footerHtml, desktopLayoutMap } = await collectBodyAndChrome(page);
    // No semantic header/footer — chrome should be null (heuristic requires score > 2)
    expect(nav).toBeNull();
    expect(footerHtml).toBeNull();
    expect(desktopLayoutMap).toBeNull();
    expect(bodyFragmentHtml).toContain('Only content');
    await page.close();
  });
});

describe('collectBodyFragmentMobileOnly', () => {
  it('returns chrome-removed body fragment without nav/footer content', async () => {
    const page = await browser.newPage();
    await page.setContent(CHROME_FIXTURE);
    const fragment = await collectBodyFragmentMobileOnly(page);
    // Header chrome (nav links) removed
    expect(fragment).not.toContain('Home');
    expect(fragment).not.toContain('About');
    // Footer chrome removed
    expect(fragment).not.toContain('foot');
    // Main content preserved
    expect(fragment).toContain('Content');
    await page.close();
  });

  it('does not include <body> tag in the result', async () => {
    const page = await browser.newPage();
    await page.setContent(CHROME_FIXTURE);
    const fragment = await collectBodyFragmentMobileOnly(page);
    expect(fragment).not.toContain('<body');
    await page.close();
  });

  it('returns body content unchanged when no chrome elements are present', async () => {
    const page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><html><body><main><p>Only content</p></main></body></html>');
    const fragment = await collectBodyFragmentMobileOnly(page);
    expect(fragment).toContain('Only content');
    await page.close();
  });
});

describe('collectMobileChromeLayout', () => {
  it('returns layout map for chrome elements at current viewport (assigns its own markers)', async () => {
    // Use a mobile-sized browser context to simulate the mobile viewport.
    const { chromium } = await import('playwright');
    const mobileBrowser = await chromium.launch();
    const ctx = await mobileBrowser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    try {
      await page.setContent(CHROME_FIXTURE);
      // collectMobileChromeLayout is called on a fresh mobile page (no prior marker pass).
      // It detects chrome and assigns its own markers, then returns the layout map.
      const mobileMap = await collectMobileChromeLayout(page);
      // Chrome is present → map should have entries.
      expect(mobileMap).not.toBeNull();
      expect(Object.keys(mobileMap!).length).toBeGreaterThan(0);
      // All keys should be dla-fx-N markers.
      for (const key of Object.keys(mobileMap!)) {
        expect(key).toMatch(/^dla-fx-\d+$/);
      }
    } finally {
      await ctx.close();
      await mobileBrowser.close();
    }
  });

  it('marker IDs in mobile map match desktop map for the same DOM structure', async () => {
    // Simulate the two-pass screenshotter: desktop and mobile are separate pages.
    // The marker IDs should match between the two passes when the DOM is the same.
    const { chromium } = await import('playwright');
    const testBrowser = await chromium.launch();
    try {
      // Desktop pass
      const desktopCtx = await testBrowser.newContext({ viewport: { width: 1440, height: 900 } });
      const desktopPage = await desktopCtx.newPage();
      await desktopPage.setContent(CHROME_FIXTURE);
      const { desktopLayoutMap } = await collectBodyAndChrome(desktopPage);
      await desktopCtx.close();

      // Mobile pass (separate context)
      const mobileCtx = await testBrowser.newContext({ viewport: { width: 390, height: 844 } });
      const mobilePage = await mobileCtx.newPage();
      await mobilePage.setContent(CHROME_FIXTURE);
      const mobileMap = await collectMobileChromeLayout(mobilePage);
      await mobileCtx.close();

      // Both maps should be non-null
      expect(desktopLayoutMap).not.toBeNull();
      expect(mobileMap).not.toBeNull();

      // Key sets should overlap (same DOM structure → same markers)
      const desktopKeys = new Set(Object.keys(desktopLayoutMap!));
      const mobileKeys = new Set(Object.keys(mobileMap!));
      const overlap = [...desktopKeys].filter((k) => mobileKeys.has(k));
      expect(overlap.length).toBeGreaterThan(0);
    } finally {
      await testBrowser.close();
    }
  });

  it('returns null when no header/footer chrome is found', async () => {
    const { chromium } = await import('playwright');
    const mobileBrowser = await chromium.launch();
    const ctx = await mobileBrowser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    try {
      // Page with no chrome elements (no header, footer, or nav with sufficient score)
      await page.setContent('<!DOCTYPE html><html><body><main><p>Only content</p></main></body></html>');
      const mobileMap = await collectMobileChromeLayout(page);
      // No chrome found → null
      expect(mobileMap).toBeNull();
    } finally {
      await ctx.close();
      await mobileBrowser.close();
    }
  });
});
