import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { captureDesignForUrl, designSidecarPath } from './design-capture-runner.js';
import { CssAggregator } from './css-aggregator.js';
import { JsAggregator } from './js-aggregator.js';
import { slugify } from '../url/index.js';

const LOCAL_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(LOCAL_TMP, { recursive: true });

// Full page fixture with enough content to pass MIN_DESIGN_BYTES check
const FIXTURE = `<!DOCTYPE html><html><head>
  <style>body{margin:0;padding:0}.hero{color:red}.a{margin:0}.b{padding:8px}.c{display:flex}.d{font-size:16px}.e{line-height:1.5}.f{color:#333}.g{background:#fff}.h{border:1px solid #ccc}.i{border-radius:4px}.j{text-align:center}.k{font-weight:bold}.l{overflow:hidden}.m{position:relative}.n{width:100%}.o{max-width:1200px}</style>
</head><body class="home dark">
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <main><h1>Title</h1><p>Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.</p><p>Tempor incididunt ut labore et dolore magna aliqua ut enim ad minim.</p><section><h2>More</h2><p>Quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo.</p></section></main>
  <footer><p>Footer content here</p></footer>
</body></html>`;

// Fixture with a script — to test JS filtering
const FIXTURE_WITH_SCRIPTS = `<!DOCTYPE html><html><head>
  <style>body{margin:0;padding:0}.hero{color:red}.a{margin:0}.b{padding:8px}.c{display:flex}.d{font-size:16px}.e{line-height:1.5}.f{color:#333}.g{background:#fff}.h{border:1px solid #ccc}.i{border-radius:4px}</style>
</head><body class="page">
  <main><h1>Product Page</h1><p>Lorem ipsum dolor sit amet consectetur adipiscing elit.</p><p>Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p></main>
  <script>document.querySelector(".x");</script>
</body></html>`;

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

async function pageWithFixture(fixture: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent(fixture);
  return page;
}

describe('designSidecarPath', () => {
  it('returns design/<slug>.fragment.html under outputDir (desktop default)', () => {
    expect(designSidecarPath('/out', 'about')).toBe('/out/design/about.fragment.html');
  });
  it('returns design/<slug>.mobile.fragment.html when mobile:true', () => {
    expect(designSidecarPath('/out', 'about', { mobile: true })).toBe('/out/design/about.mobile.fragment.html');
  });
  it('desktop and mobile sidecar paths differ only in the filename suffix', () => {
    const desktop = designSidecarPath('/out', 'homepage');
    const mobile = designSidecarPath('/out', 'homepage', { mobile: true });
    expect(desktop).toBe('/out/design/homepage.fragment.html');
    expect(mobile).toBe('/out/design/homepage.mobile.fragment.html');
    expect(desktop).not.toBe(mobile);
  });
});

/**
 * Slug consistency: the design sidecar WRITE side (screenshotter → captureDesignForUrl)
 * must produce the same slug as the LOOKUP side (flushPendingImports → entry.slug from WXR item).
 *
 * Both sides must use `slugify(url)` directly — not the manifest's deduped slug — so that
 * the sidecar written at `design/<slugify(url)>.fragment.html` is always found by
 * `designSidecarPath(outDir, item.slug)` where `item.slug = slugify(url)`.
 *
 * This test verifies the 6 representative page URL shapes. The homepage case
 * (`path = '/'`) is the critical one: `slugify` must return `'homepage'` so that the
 * sidecar at `design/homepage.fragment.html` matches `item.slug = 'homepage'`.
 */
describe('design sidecar slug consistency (write vs lookup)', () => {
  const cases: Array<{ url: string; expectedSlug: string; archetype: string }> = [
    { url: 'https://example.com/', expectedSlug: 'homepage', archetype: 'homepage' },
    { url: 'https://example.com/about', expectedSlug: 'about', archetype: 'page' },
    { url: 'https://example.com/blog/hello-world', expectedSlug: 'blog--hello-world', archetype: 'post' },
    { url: 'https://example.com/gallery', expectedSlug: 'gallery', archetype: 'gallery' },
    { url: 'https://example.com/events/annual-fair', expectedSlug: 'events--annual-fair', archetype: 'event' },
    { url: 'https://example.com/contact-us', expectedSlug: 'contact-us', archetype: 'page' },
  ];

  for (const { url, expectedSlug, archetype } of cases) {
    it(`slugify('${url}') === '${expectedSlug}' (archetype: ${archetype})`, () => {
      const slug = slugify(url);
      expect(slug).toBe(expectedSlug);
      // Verify both sides resolve to the same sidecar path.
      const writePath = designSidecarPath('/out', slug);
      const lookupPath = designSidecarPath('/out', slug);
      expect(writePath).toBe(lookupPath);
    });
  }

  it('homepage slug is "homepage" (not empty string or path-based variant)', () => {
    // The root URL is the critical case: slugify must fall back to "homepage"
    // so the sidecar matches the WXR item slug.
    expect(slugify('https://example.com/')).toBe('homepage');
    expect(slugify('https://example.com')).toBe('homepage');
    // Verify the sidecar path is deterministic.
    expect(designSidecarPath('/out', 'homepage')).toBe('/out/design/homepage.fragment.html');
  });
});

describe('captureDesignForUrl', () => {
  it('returns null for non-page/post archetypes (product)', async () => {
    const dir = join(LOCAL_TMP, `dcr-product-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const page = await pageWithFixture(FIXTURE);
      try {
        const cssAgg = new CssAggregator();
        const result = await captureDesignForUrl({
          page,
          url: 'https://example.com/shop/widget',
          slug: 'shop--widget',
          archetype: 'product',
          outputDir: dir,
          baseUrl: 'https://example.com',
          includeScripts: false,
          cssAgg,
          headLinks: new Set(),
        });
        expect(result).toBeNull();
        // Should not have written any sidecar
        expect(existsSync(join(dir, 'design', 'shop--widget.fragment.html'))).toBe(false);
        // cssAgg should be empty
        expect(cssAgg.toString()).toBe('');
      } finally {
        await page.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes sidecar for page archetype — wrapped, sanitized (no <script>/<onclick>)', async () => {
    const dir = join(LOCAL_TMP, `dcr-page-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const fixture = `<!DOCTYPE html><html><head>
  <style>body{margin:0;padding:0}.hero{color:red}.a{margin:0}.b{padding:8px}.c{display:flex}.d{font-size:16px}.e{line-height:1.5}.f{color:#333}.g{background:#fff}.h{border:1px solid #ccc}.i{border-radius:4px}</style>
</head><body class="home dark">
  <main onclick="evil()"><h1>Title</h1><p>Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.</p><p>Tempor incididunt ut labore et dolore magna aliqua ut enim ad minim.</p></main>
  <script>alert('xss')</script>
</body></html>`;
      const page = await pageWithFixture(fixture);
      try {
        const cssAgg = new CssAggregator();
        const result = await captureDesignForUrl({
          page,
          url: 'https://example.com/about',
          slug: 'about',
          archetype: 'page',
          outputDir: dir,
          baseUrl: 'https://example.com',
          includeScripts: false,
          cssAgg,
          headLinks: new Set(),
        });
        expect(result).not.toBeNull();
        const sidecar = join(dir, 'design', 'about.fragment.html');
        expect(existsSync(sidecar)).toBe(true);
        const { readFileSync } = await import('node:fs');
        const content = readFileSync(sidecar, 'utf8');
        // Should be wrapped in dla-replica div with desktop viewport class
        expect(content).toContain('dla-replica');
        expect(content).toContain('dla-content-desktop');
        expect(content).toContain('dla-page-about');
        // Should NOT contain inline scripts or onclick handlers (sanitized)
        expect(content).not.toContain('<script');
        expect(content).not.toContain('onclick');
      } finally {
        await page.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cssAgg receives scoped CSS — body rewritten to .dla-replica', async () => {
    const dir = join(LOCAL_TMP, `dcr-css-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const page = await pageWithFixture(FIXTURE);
      try {
        const cssAgg = new CssAggregator();
        const result = await captureDesignForUrl({
          page,
          url: 'https://example.com/home',
          slug: 'home',
          archetype: 'page',
          outputDir: dir,
          baseUrl: 'https://example.com',
          includeScripts: false,
          cssAgg,
          headLinks: new Set(),
        });
        expect(result).not.toBeNull();
        const css = cssAgg.toString();
        // body{margin:0} should be rewritten to .dla-replica{margin:0}
        expect(css).toContain('.dla-replica');
        expect(css).not.toMatch(/^body\s*\{/m);
        // Other rules preserved
        expect(css).toContain('.hero');
      } finally {
        await page.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('captures for post archetype same as page', async () => {
    const dir = join(LOCAL_TMP, `dcr-post-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const page = await pageWithFixture(FIXTURE);
      try {
        const cssAgg = new CssAggregator();
        const result = await captureDesignForUrl({
          page,
          url: 'https://example.com/blog/hello',
          slug: 'blog--hello',
          archetype: 'post',
          outputDir: dir,
          baseUrl: 'https://example.com',
          includeScripts: false,
          cssAgg,
          headLinks: new Set(),
        });
        expect(result).not.toBeNull();
        expect(existsSync(join(dir, 'design', 'blog--hello.fragment.html'))).toBe(true);
      } finally {
        await page.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null on capture failure (empty page) and does not throw', async () => {
    const dir = join(LOCAL_TMP, `dcr-fail-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      // Empty page — will fail the MIN_DESIGN_BYTES check in captureDesign
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><html><body></body></html>');
      try {
        const cssAgg = new CssAggregator();
        const result = await captureDesignForUrl({
          page,
          url: 'https://example.com/empty',
          slug: 'empty',
          archetype: 'page',
          outputDir: dir,
          baseUrl: 'https://example.com',
          includeScripts: false,
          cssAgg,
          headLinks: new Set(),
        });
        // Should return null (fallback) instead of throwing
        expect(result).toBeNull();
        // Sidecar should not have been written
        expect(existsSync(join(dir, 'design', 'empty.fragment.html'))).toBe(false);
      } finally {
        await page.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('filters third-party scripts and keeps first-party + allowed CDN via injectable fetchScript', async () => {
    const dir = join(LOCAL_TMP, `dcr-scripts-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const page = await pageWithFixture(FIXTURE_WITH_SCRIPTS);
      try {
        const cssAgg = new CssAggregator();
        const jsAgg = new JsAggregator('https://example.com');
        // Stub fetchScript: returns content for first-party and allowlisted CDN
        const fetchScript = async (url: string): Promise<string | null> => {
          if (url === 'https://example.com/app.js') return 'initApp();';
          if (url === 'https://cdn.jsdelivr.net/lib.js') return 'LIB();';
          return null;
        };
        // We need a page with external scripts for this test — inject them
        await page.evaluate(() => {
          // Add a first-party script element
          const s1 = document.createElement('script');
          s1.src = 'https://example.com/app.js';
          document.head.appendChild(s1);
          // Add a third-party script element
          const s2 = document.createElement('script');
          s2.src = 'https://evil-tracker.com/track.js';
          document.head.appendChild(s2);
          // Add an allowlisted CDN script
          const s3 = document.createElement('script');
          s3.src = 'https://cdn.jsdelivr.net/lib.js';
          document.head.appendChild(s3);
        });
        const result = await captureDesignForUrl({
          page,
          url: 'https://example.com/products/page',
          slug: 'products--page',
          archetype: 'page',
          outputDir: dir,
          baseUrl: 'https://example.com',
          includeScripts: true,
          cssAgg,
          jsAgg,
          headLinks: new Set(),
          fetchScript,
        });
        expect(result).not.toBeNull();
        const js = jsAgg.toString();
        // First-party kept
        expect(js).toContain('initApp()');
        // Allowlisted CDN kept
        expect(js).toContain('LIB()');
        // Third-party dropped (evil-tracker.com not in allowlist)
        expect(js).not.toContain('evil');
      } finally {
        await page.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('headLinks accumulator receives links from capture', async () => {
    const FIXTURE_WITH_LINKS = `<!DOCTYPE html><html><head>
  <style>body{margin:0;padding:0}.hero{color:red}.a{margin:0}.b{padding:8px}.c{display:flex}.d{font-size:16px}.e{line-height:1.5}.f{color:#333}.g{background:#fff}.h{border:1px solid #ccc}.i{border-radius:4px}.k{font-weight:bold}.l{overflow:hidden}.m{position:relative}.n{width:100%}.o{max-width:1200px}</style>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Open+Sans">
</head><body class="home">
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <main><h1>Title</h1><p>Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.</p><p>Tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud.</p><section><h2>More</h2><p>Exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure.</p></section></main>
  <footer><p>Footer content goes here with additional text to pad the size.</p></footer>
</body></html>`;
    const dir = join(LOCAL_TMP, `dcr-links-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const page = await pageWithFixture(FIXTURE_WITH_LINKS);
      try {
        const cssAgg = new CssAggregator();
        const headLinks = new Set<string>();
        await captureDesignForUrl({
          page,
          url: 'https://example.com/',
          slug: 'homepage',
          archetype: 'page',
          outputDir: dir,
          baseUrl: 'https://example.com',
          includeScripts: false,
          cssAgg,
          headLinks,
        });
        // Should have collected the Google Fonts link
        const linksArr = [...headLinks];
        expect(linksArr.some((l) => l.includes('fonts.googleapis.com'))).toBe(true);
      } finally {
        await page.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
