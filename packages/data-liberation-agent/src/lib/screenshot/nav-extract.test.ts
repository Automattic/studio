import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { extractNav, NAV_EXTRACT_FACTORY_SOURCE } from './nav-extract.js';
import type { ExtractedNav } from './nav-extract.js';

// Fixture: a realistic header with logo img, 4 nav links, a button-styled CTA.
const FIXTURE_HEADER = `<!DOCTYPE html><html><head>
  <style>
    header { display: flex; width: 100%; height: 64px; background: rgb(30, 30, 30); align-items: center; padding: 0 24px; }
    nav { display: flex; gap: 24px; }
    nav a { color: rgb(255, 255, 255); text-decoration: none; font-family: 'Inter'; }
    .cta-btn { background: rgb(0, 122, 255); color: rgb(255, 255, 255); border-radius: 6px; padding: 8px 16px; text-decoration: none; font-family: 'Inter'; }
    img { height: 40px; }
    main { padding: 40px; }
    footer { height: 60px; background: #111; }
  </style>
</head><body style="margin:0">
  <header>
    <img src="https://example.com/logo.svg" alt="Acme Corp">
    <nav>
      <a href="/about">About</a>
      <a href="/services">Services</a>
      <a href="/portfolio">Portfolio</a>
      <a href="/blog">Blog</a>
    </nav>
    <a href="/contact" class="cta-btn">Contact Us</a>
  </header>
  <main><h1>Welcome</h1><p>Lorem ipsum dolor sit amet consectetur adipiscing elit.</p></main>
  <footer><p>&copy; 2025 Acme Corp</p></footer>
</body></html>`;

// Fixture: Wix-style nested DOM — header has transparent background, the dark
// background lives on a full-size descendant div (colorUnderlay), and nav item
// text color + font live on a label <div> INSIDE the <a>, not the <a> itself.
const FIXTURE_WIX_NESTED = `<!DOCTYPE html><html><head>
  <style>
    body { margin: 0; }
    header { display: flex; position: relative; width: 100%; height: 70px; background: rgba(0,0,0,0); align-items: center; }
    .bg-layers { position: absolute; inset: 0; width: 100%; height: 100%; }
    .color-underlay { width: 100%; height: 100%; background-color: rgb(25, 25, 35); }
    .nav-container { display: flex; gap: 16px; position: relative; z-index: 1; align-items: center; padding: 0 24px; width: 100%; }
    .nav-container a { color: rgba(0,0,0,0); text-decoration: none; font-family: serif; }
    .menu-item-label { color: rgb(255, 255, 255); font-family: Georgia, serif; }
    img.logo { height: 40px; }
  </style>
</head><body>
  <header>
    <div class="bg-layers">
      <div data-testid="colorUnderlay" class="color-underlay"></div>
    </div>
    <div class="nav-container">
      <img class="logo" src="https://example.com/wix-logo.png" alt="Wix Site">
      <nav>
        <a href="/home"><div class="menu-item-label" style="color: rgb(255, 255, 255); font-family: Georgia, serif;">HOME</div></a>
        <a href="/about"><div class="menu-item-label" style="color: rgb(255, 255, 255); font-family: Georgia, serif;">ABOUT</div></a>
        <a href="/contact"><div class="menu-item-label" style="color: rgb(255, 255, 255); font-family: Georgia, serif;">CONTACT</div></a>
      </nav>
    </div>
  </header>
  <main><p>Content goes here with some text to fill the page properly.</p></main>
  <footer><p>Footer</p></footer>
</body></html>`;

// Fixture: header whose effective background is a CSS gradient (background-image),
// not a solid color — tests the backgroundImage extraction path.
const FIXTURE_GRADIENT_BG = `<!DOCTYPE html><html><head>
  <style>
    body { margin: 0; }
    header { display: flex; width: 100%; height: 64px; background: rgba(0,0,0,0); align-items: center; padding: 0 24px; }
    .header-bg { position: absolute; inset: 0; width: 100%; height: 100%; background-image: linear-gradient(90deg, rgb(10, 10, 80) 0%, rgb(80, 10, 80) 100%); background-color: rgba(0,0,0,0); }
    nav a { color: rgb(255,255,255); font-family: Arial, sans-serif; }
  </style>
</head><body>
  <header style="position:relative">
    <div class="header-bg"></div>
    <nav style="position:relative;z-index:1">
      <a href="/home">Home</a>
      <a href="/about">About</a>
    </nav>
  </header>
  <main><p>Content here.</p></main>
  <footer><p>ft</p></footer>
</body></html>`;

// Fixture: header with no logo (site title only), no explicit CTA
const FIXTURE_NO_LOGO = `<!DOCTYPE html><html><head>
  <style>
    header { display: flex; width: 100%; height: 56px; background: rgb(255, 255, 255); align-items: center; padding: 0 24px; }
    a { color: rgb(20, 20, 20); font-family: Georgia, serif; }
    main { padding: 40px; }
    footer { height: 40px; background: #eee; }
  </style>
</head><body style="margin:0">
  <header>
    <a href="/" style="font-weight:bold;font-size:1.5rem">My Site</a>
    <nav>
      <a href="/about">About</a>
      <a href="/work">Work</a>
      <a href="/contact">Contact</a>
    </nav>
  </header>
  <main><h1>Hello</h1><p>Content here that is long enough to pass size checks in other tests.</p></main>
  <footer><p>Footer here</p></footer>
</body></html>`;

// Fixture: Wix-style header with explicit typography tokens (letter-spacing,
// text-transform, font-size) on nav labels, and a "CALL US" CTA button
// that is NOT in the nav menu — mirrors the real-world Wix StylableButton pattern.
const FIXTURE_TYPOGRAPHY_AND_CTA = `<!DOCTYPE html><html><head>
  <style>
    body { margin: 0; }
    header { display: flex; position: relative; width: 100%; height: 70px;
             background: rgb(23, 82, 54); align-items: center; padding: 0 24px; }
    nav { display: flex; gap: 20px; }
    nav a { text-decoration: none; }
    .menu-label {
      color: rgb(255, 255, 255);
      font-family: 'Helvetica Neue', sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 2.6px;
      text-transform: uppercase;
    }
    .call-us-btn {
      background: rgb(23, 82, 54);
      color: rgb(255, 255, 255);
      border: 2px solid rgb(255, 255, 255);
      border-radius: 4px;
      padding: 8px 16px;
      text-decoration: none;
      font-size: 13px;
    }
    img { height: 40px; }
  </style>
</head><body>
  <header>
    <img src="https://example.com/logo.png" alt="Brand">
    <nav>
      <a href="/home"><div class="menu-label">HOME</div></a>
      <a href="/about"><div class="menu-label">ABOUT</div></a>
      <a href="/services"><div class="menu-label">SERVICES</div></a>
      <a href="/contact"><div class="menu-label">CONTACT</div></a>
    </nav>
    <a href="/call-us" class="call-us-btn">CALL US</a>
  </header>
  <main><p>Content here.</p></main>
  <footer><p>Footer</p></footer>
</body></html>`;

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

/** Run extractNav inside the browser against a given fixture, returning ExtractedNav. */
async function runExtractNav(fixture: string): Promise<ExtractedNav | null> {
  const page = await browser.newPage();
  try {
    await page.setContent(fixture);
    const navFactorySrc = NAV_EXTRACT_FACTORY_SOURCE.factorySrc;
    return await page.evaluate(({ navFactorySrc }: { navFactorySrc: string }) => {
      // eslint-disable-next-line no-new-func
      const { extractNav } = (new Function('return (' + navFactorySrc + ')')()() as {
        extractNav: (el: Element) => ExtractedNav;
      });
      const header = document.querySelector('header, [role="banner"]');
      if (!header) return null;
      return extractNav(header);
    }, { navFactorySrc });
  } finally {
    await page.close();
  }
}

// Fixture: sticky (overlay) header — used to test isOverlay detection.
const FIXTURE_STICKY_HEADER = `<!DOCTYPE html><html><head>
  <style>
    body { margin: 0; }
    header { display: flex; position: sticky; top: 0; width: 100%; height: 64px;
             background: rgb(10, 20, 30); align-items: center; padding: 0 24px; z-index: 100; }
    nav a { color: rgb(255, 255, 255); font-family: Arial, sans-serif; }
  </style>
</head><body>
  <header>
    <nav>
      <a href="/home">Home</a>
      <a href="/about">About</a>
    </nav>
  </header>
  <main><p>Content here.</p></main>
  <footer><p>ft</p></footer>
</body></html>`;

// Fixture: static (solid) header — used to test isOverlay:false detection.
const FIXTURE_STATIC_HEADER = `<!DOCTYPE html><html><head>
  <style>
    body { margin: 0; }
    header { display: flex; position: static; width: 100%; height: 64px;
             background: rgb(20, 30, 40); align-items: center; padding: 0 24px; }
    nav a { color: rgb(10, 10, 10); font-family: Arial, sans-serif; }
  </style>
</head><body>
  <header>
    <nav>
      <a href="/home">Home</a>
      <a href="/about">About</a>
    </nav>
  </header>
  <main><p>Content here.</p></main>
  <footer><p>ft</p></footer>
</body></html>`;

// Fixture: transparent header (no opaque bg) — isOverlay can be anything,
// background must come back as 'transparent'.
const FIXTURE_TRANSPARENT_HEADER = `<!DOCTYPE html><html><head>
  <style>
    body { margin: 0; background: url(hero.jpg) center/cover; }
    header { display: flex; position: fixed; top: 0; width: 100%; height: 64px;
             background: rgba(0, 0, 0, 0); align-items: center; padding: 0 24px; }
    nav a { color: rgb(255, 255, 255); font-family: Arial, sans-serif; }
  </style>
</head><body>
  <header>
    <nav>
      <a href="/home">Home</a>
      <a href="/about">About</a>
    </nav>
  </header>
  <main><p>Content here that is long enough to pass size checks.</p></main>
  <footer><p>ft</p></footer>
</body></html>`;

describe('extractNav (browser fixture)', { timeout: 20000 }, () => {
  it('extracts logo src, alt, and 4 nav items from the fixture header', async () => {
    const nav = await runExtractNav(FIXTURE_HEADER);
    expect(nav).not.toBeNull();
    expect(nav!.logoSrc).toBe('https://example.com/logo.svg');
    expect(nav!.logoAlt).toBe('Acme Corp');
    expect(nav!.items).toHaveLength(4);
    expect(nav!.items[0]).toEqual({ label: 'About', href: '/about' });
    expect(nav!.items[1]).toEqual({ label: 'Services', href: '/services' });
    expect(nav!.items[2]).toEqual({ label: 'Portfolio', href: '/portfolio' });
    expect(nav!.items[3]).toEqual({ label: 'Blog', href: '/blog' });
  });

  it('detects the button-styled CTA link separately from nav items', async () => {
    const nav = await runExtractNav(FIXTURE_HEADER);
    expect(nav).not.toBeNull();
    expect(nav!.cta).not.toBeNull();
    expect(nav!.cta!.label).toBe('Contact Us');
    expect(nav!.cta!.href).toBe('/contact');
    // CTA should NOT also appear in items
    expect(nav!.items.every((item) => item.label !== 'Contact Us')).toBe(true);
  });

  it('captures style tokens: background, textColor, fontFamily, height', async () => {
    const nav = await runExtractNav(FIXTURE_HEADER);
    expect(nav).not.toBeNull();
    // Background = rgb(30, 30, 30) from header CSS
    expect(nav!.style.background).toMatch(/rgb\(30,\s*30,\s*30\)/);
    // textColor from nav <a> = rgb(255, 255, 255)
    expect(nav!.style.textColor).toMatch(/rgb\(255,\s*255,\s*255\)/);
    // fontFamily = Inter (first family from the stack)
    expect(nav!.style.fontFamily.toLowerCase()).toContain('inter');
    // height = 64px
    expect(nav!.style.height).toBeGreaterThan(0);
    // CTA colors extracted
    expect(nav!.style.ctaBackground).toMatch(/rgb\(0,\s*122,\s*255\)/);
    expect(nav!.style.ctaTextColor).toMatch(/rgb\(255,\s*255,\s*255\)/);
  });

  it('falls back to siteTitle when no logo img present', async () => {
    const nav = await runExtractNav(FIXTURE_NO_LOGO);
    expect(nav).not.toBeNull();
    expect(nav!.logoSrc).toBeNull();
    expect(nav!.siteTitle).toBeTruthy();
    // 3 nav items
    expect(nav!.items).toHaveLength(3);
    expect(nav!.items.some((i) => i.label === 'About')).toBe(true);
    // No CTA (no button-styled link)
    expect(nav!.cta).toBeNull();
  });

  it('skips pure # anchors and dedupes label+href', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<!DOCTYPE html><html><head>
  <style>header{display:flex;width:100%;height:60px;background:#fff;}nav a{color:#000;}</style>
</head><body>
  <header>
    <nav>
      <a href="#">Skip me</a>
      <a href="/page1">Page 1</a>
      <a href="/page1">Page 1</a>
      <a href="/page2">Page 2</a>
    </nav>
  </header>
  <main><p>content here content here content here content here content here</p></main>
  <footer><p>footer</p></footer>
</body></html>`);
      const navFactorySrc = NAV_EXTRACT_FACTORY_SOURCE.factorySrc;
      const nav = await page.evaluate(({ navFactorySrc }: { navFactorySrc: string }) => {
        // eslint-disable-next-line no-new-func
        const { extractNav } = (new Function('return (' + navFactorySrc + ')')()() as { extractNav: (el: Element) => ExtractedNav });
        const header = document.querySelector('header');
        return header ? extractNav(header) : null;
      }, { navFactorySrc });
      expect(nav).not.toBeNull();
      // # link skipped; page1 deduped to 1
      expect(nav!.items).toHaveLength(2);
      expect(nav!.items[0].label).toBe('Page 1');
      expect(nav!.items[1].label).toBe('Page 2');
      expect(nav!.items.some((i) => i.label === 'Skip me')).toBe(false);
    } finally {
      await page.close();
    }
  });

  it('caps nav items at 8', async () => {
    const page = await browser.newPage();
    try {
      const links = Array.from({ length: 12 }, (_, i) => `<a href="/page${i}">Page ${i}</a>`).join('\n');
      await page.setContent(`<!DOCTYPE html><html><head>
  <style>header{display:flex;width:100%;height:60px;background:#fff;}nav a{color:#000;}</style>
</head><body><header><nav>${links}</nav></header><main><p>body</p></main><footer><p>ft</p></footer></body></html>`);
      const navFactorySrc = NAV_EXTRACT_FACTORY_SOURCE.factorySrc;
      const nav = await page.evaluate(({ navFactorySrc }: { navFactorySrc: string }) => {
        // eslint-disable-next-line no-new-func
        const { extractNav } = (new Function('return (' + navFactorySrc + ')')()() as { extractNav: (el: Element) => ExtractedNav });
        const header = document.querySelector('header');
        return header ? extractNav(header) : null;
      }, { navFactorySrc });
      expect(nav).not.toBeNull();
      expect(nav!.items.length).toBeLessThanOrEqual(8);
    } finally {
      await page.close();
    }
  });

  it('extracts effective background from Wix-style nested colorUnderlay descendant (NOT transparent header)', async () => {
    const nav = await runExtractNav(FIXTURE_WIX_NESTED);
    expect(nav).not.toBeNull();
    // The dark background lives on .color-underlay, NOT the header itself.
    // Extraction must NOT return transparent — it must find rgb(25, 25, 35).
    expect(nav!.style.background).toMatch(/rgb\(25,\s*25,\s*35\)/);
    expect(nav!.style.background).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
    expect(nav!.style.background).not.toBe('transparent');
  });

  it('extracts text color + fontFamily from deepest label element inside <a> (not the <a> itself)', async () => {
    const nav = await runExtractNav(FIXTURE_WIX_NESTED);
    expect(nav).not.toBeNull();
    // The <a> itself has transparent color; the <div class="menu-item-label"> has white.
    expect(nav!.style.textColor).toMatch(/rgb\(255,\s*255,\s*255\)/);
    // Font is Georgia on the label div, not the generic serif on the <a>.
    expect(nav!.style.fontFamily.toLowerCase()).toContain('georgia');
  });

  it('extracts background-image when effective background is a gradient, not a solid color', async () => {
    const nav = await runExtractNav(FIXTURE_GRADIENT_BG);
    expect(nav).not.toBeNull();
    // Should capture background-image (gradient) not fall through to transparent.
    expect(nav!.style.backgroundImage).toBeDefined();
    expect(nav!.style.backgroundImage).toMatch(/linear-gradient/i);
  });

  it('captures fontSize, letterSpacing, textTransform from representative nav label element', async () => {
    const nav = await runExtractNav(FIXTURE_TYPOGRAPHY_AND_CTA);
    expect(nav).not.toBeNull();
    // fontSize should be captured from the .menu-label div (13px)
    expect(nav!.style.fontSize).toBeDefined();
    expect(nav!.style.fontSize).toMatch(/13px/);
    // letterSpacing should be captured (2.6px — non-zero/non-normal)
    expect(nav!.style.letterSpacing).toBeDefined();
    expect(nav!.style.letterSpacing).toBeTruthy();
    // textTransform should be 'uppercase'
    expect(nav!.style.textTransform).toBe('uppercase');
  });

  it('detects "CALL US" CTA button that is NOT in nav menu items', async () => {
    const nav = await runExtractNav(FIXTURE_TYPOGRAPHY_AND_CTA);
    expect(nav).not.toBeNull();
    // CTA should be populated with the "CALL US" link
    expect(nav!.cta).not.toBeNull();
    expect(nav!.cta!.label).toBe('CALL US');
    expect(nav!.cta!.href).toBe('/call-us');
    // CTA should NOT appear in nav items
    expect(nav!.items.every((item) => item.label !== 'CALL US')).toBe(true);
    // Nav items should include the real menu items
    expect(nav!.items.some((i) => i.label === 'HOME')).toBe(true);
  });

  it('captures bg and color on the cta object', async () => {
    const nav = await runExtractNav(FIXTURE_TYPOGRAPHY_AND_CTA);
    expect(nav).not.toBeNull();
    expect(nav!.cta).not.toBeNull();
    // The CTA has a background (border-radius > 0 makes it qualify)
    // and color should be white
    expect(nav!.cta!.color).toMatch(/rgb\(255,\s*255,\s*255\)/);
  });

  // ── isOverlay detection ────────────────────────────────────────────────────

  it('sticky header → isOverlay: true', async () => {
    const nav = await runExtractNav(FIXTURE_STICKY_HEADER);
    expect(nav).not.toBeNull();
    expect(nav!.style.isOverlay).toBe(true);
    // Also verify background is captured (not transparent)
    expect(nav!.style.background).toMatch(/rgb\(10,\s*20,\s*30\)/);
  });

  it('static header with solid background → isOverlay: false + background captured', async () => {
    const nav = await runExtractNav(FIXTURE_STATIC_HEADER);
    expect(nav).not.toBeNull();
    expect(nav!.style.isOverlay).toBe(false);
    expect(nav!.style.background).toMatch(/rgb\(20,\s*30,\s*40\)/);
  });

  it('fixed/transparent header → isOverlay: true + background is transparent', async () => {
    const nav = await runExtractNav(FIXTURE_TRANSPARENT_HEADER);
    expect(nav).not.toBeNull();
    // fixed position → isOverlay: true
    expect(nav!.style.isOverlay).toBe(true);
    // rgba(0,0,0,0) transparent bg — ancestors have no opaque bg either
    // so background should be transparent (not a color)
    const bg = nav!.style.background;
    const isTransparent = bg === 'transparent' || /rgba\(0,\s*0,\s*0,\s*0\)/.test(bg);
    expect(isTransparent).toBe(true);
  });

  it('original fixture header (position:flex/static by default) → isOverlay: false', async () => {
    // FIXTURE_HEADER uses `header { display: flex; }` — no explicit position: computed=static
    const nav = await runExtractNav(FIXTURE_HEADER);
    expect(nav).not.toBeNull();
    expect(nav!.style.isOverlay).toBe(false);
  });
});

describe('extractNav (Node unit test via source string)', () => {
  it('NAV_EXTRACT_FACTORY_SOURCE.factorySrc is a non-empty string', () => {
    expect(typeof NAV_EXTRACT_FACTORY_SOURCE.factorySrc).toBe('string');
    expect(NAV_EXTRACT_FACTORY_SOURCE.factorySrc.length).toBeGreaterThan(0);
    expect(NAV_EXTRACT_FACTORY_SOURCE.factorySrc).toContain('extractNav');
  });

  it('extractNav function is exported and callable', () => {
    // Smoke test: the function exists and is callable (node does not have DOM so
    // we just verify the export shape, not browser behavior)
    expect(typeof extractNav).toBe('function');
  });
});
