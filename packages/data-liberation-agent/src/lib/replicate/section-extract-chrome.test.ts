/**
 * Browser-fixture tests for the body-section candidate exclusions in
 * extractFull's page.evaluate walk, and for the saved-HTML replay path.
 *
 * The leak these guard against (getsnooz dogfood 2026-06-11): a header
 * mega-menu dropdown hides via visibility/opacity — NOT display:none — so
 * offsetParent stays non-null, isVisible() passes, and the dropdown wins a
 * Y-band → a junk product strip renders atop every reconstructed page. Body
 * sections must never come from inside header/footer/nav; chrome is supplied
 * by the theme scaffold parts. The landmark elements themselves stay eligible
 * (stripChrome handles them downstream).
 *
 * Fictional content only (no source-site data — see repo test rules).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { extractFull, extractFullFromSavedHtml, type SectionSpec } from './section-extract.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  if (browser) await browser.close();
});

async function walk(html: string): Promise<SectionSpec[]> {
  const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(100);
    const { specs } = await extractFull(page, {}, 20_000);
    return specs;
  } finally {
    await page.close();
  }
}

const allText = (specs: SectionSpec[]): string =>
  specs.map((s) => [...s.headings, ...(s.bodyText ?? [])].join(' ')).join(' ');

/** A page with a header whose mega-menu dropdown is visibility-hidden (boxes
 *  still laid out), two real content bands, and a footer with a big link grid. */
const MEGA_MENU_FIXTURE = `<!doctype html><html><head><style>
  * { margin: 0; }
  body { width: 1440px; font-family: sans-serif; }
  header { position: relative; height: 90px; background: #fff; }
  #mega-dropdown { position: absolute; top: 90px; left: 0; width: 1440px; height: 360px;
    visibility: hidden; opacity: 0; background: #eee; }
  .band { width: 1440px; height: 480px; }
</style></head><body>
  <header>
    <nav>
      <a href="/shop">Shop</a><a href="/about">About</a>
      <div id="mega-dropdown">
        <h3>Widget Alpha</h3><p>The premier widget for daytime use and more text here.</p>
        <h3>Widget Beta</h3><p>The premier widget for nighttime use and more text here.</p>
        <h3>Widget Gamma</h3><p>A third widget with even more descriptive text inside.</p>
      </div>
    </nav>
  </header>
  <main>
    <section class="band" style="background:#cde">
      <h1>Sleep better with widgets</h1>
      <p>A real hero band with enough text to qualify as a content section for the walk.</p>
    </section>
    <section class="band" style="background:#fed">
      <h2>Why widgets work</h2>
      <p>Another genuine content band with prose that the extractor should keep verbatim.</p>
    </section>
  </main>
  <footer style="height:300px;background:#222;color:#fff">
    <div style="height:280px;width:1440px">
      <h4>Browse</h4><p>Alpha Beta Gamma Delta Epsilon link farm text for the footer grid.</p>
    </div>
  </footer>
</body></html>`;

describe('extractFull chrome-descendant exclusion', () => {
  it('never emits a body section from inside header/footer/nav (hidden mega-menu leak)', async () => {
    const specs = await walk(MEGA_MENU_FIXTURE);
    const text = allText(specs);
    expect(text).toContain('Sleep better with widgets');
    expect(text).toContain('Why widgets work');
    // The mega-menu dropdown content must not surface as body-section content.
    expect(text).not.toContain('Widget Alpha');
    // The footer's inner grid must not be picked as a standalone body band
    // (the <footer> landmark itself may appear — stripChrome owns that case).
    const footerInner = specs.filter(
      (s) => (s.headings ?? []).includes('Browse') && !/footer/i.test(s.selector ?? ''),
    );
    expect(footerInner).toHaveLength(0);
  }, 60_000);

  it('excludes aria-hidden overlay subtrees (closed drawers/modals)', async () => {
    const drawerFixture = MEGA_MENU_FIXTURE.replace(
      '<main>',
      `<div aria-hidden="true" style="position:absolute;top:0;left:0;width:1440px;height:600px;background:#fff">
         <h2>Your basket is empty</h2>
         <p>Drawer prose long enough to qualify as a band were it not aria-hidden entirely.</p>
       </div><main>`,
    );
    const specs = await walk(drawerFixture);
    expect(allText(specs)).not.toContain('Your basket is empty');
  }, 60_000);
});

describe('extractFullFromSavedHtml', () => {
  it('walks the saved DOM with scripts stripped and resolves the original base URL', async () => {
    // The inline script would blank the page if it ran — proving scripts are
    // stripped. The img src is relative — proving the doc is served at the
    // original URL so baseURI resolves source-relative references.
    const saved = `<!doctype html><html><head><style>*{margin:0}</style></head><body>
      <script>document.body.innerHTML = '';</script>
      <main>
        <section style="width:1440px;height:480px;background:#cde">
          <h1>Snapshot hero heading</h1>
          <p>Body text captured at settle time, long enough to count as content.</p>
          <img src="/assets/pic.png" width="400" height="300" alt="fictional">
        </section>
        <section style="width:1440px;height:480px;background:#fed">
          <h2>Second snapshot band</h2>
          <p>More prose so the second band also qualifies for the section walk.</p>
        </section>
      </main>
    </body></html>`;
    const { specs, landmarks } = await extractFullFromSavedHtml(saved, 'https://example.com/pages/demo', {});
    const text = allText(specs);
    expect(text).toContain('Snapshot hero heading');
    expect(text).toContain('Second snapshot band');
    expect(landmarks.some((l) => l.role === 'main')).toBe(true);
    const img = specs.flatMap((s) => s.images ?? []).find((i) => i.url.includes('pic.png'));
    expect(img?.url).toBe('https://example.com/assets/pic.png');
  }, 60_000);
});

describe('extractFull — span-wrapped semantic headings (rich-text pattern)', () => {
  // Page builders (Wix rich-text) wrap EVERY heading's text in a <span>:
  // <h1><span>GALLERY</span></h1>. The heading collector's direct-text-node
  // requirement dropped any such heading under the 28px styled-text floor —
  // the swiftlumber projects GALLERY eyebrow (16px h1) vanished from every
  // capture and had to be hand-restored. Semantic h1–h6 must qualify by their
  // textContent; the inner span must not double-capture.
  const RICH_TEXT_FIXTURE = `<!doctype html><html><head><style>
    * { margin: 0; }
    body { width: 1440px; font-family: sans-serif; }
    .band { width: 1440px; height: 480px; background: #def; }
    .eyebrow { font-size: 16px; letter-spacing: 2px; }
    .headline { font-size: 54px; }
  </style></head><body>
    <main>
      <section class="band">
        <h1 class="eyebrow"><span>FICTIONAL GALLERY</span></h1>
        <p class="headline"><span>We Forge Fictional Things</span></p>
        <p>Supporting prose long enough to make this band count as content.</p>
      </section>
    </main>
  </body></html>`;

  it('captures a sub-28px span-wrapped h1 as a heading', async () => {
    const specs = await walk(RICH_TEXT_FIXTURE);
    const headings = specs.flatMap((s) => s.headings);
    expect(headings).toContain('FICTIONAL GALLERY');
  }, 60_000);

  it('does not double-capture a big styled span inside an already-captured heading', async () => {
    const specs = await walk(`<!doctype html><html><head><style>
      * { margin: 0; } body { width: 1440px; font-family: sans-serif; }
      .band { width: 1440px; height: 480px; background: #fed; }
    </style></head><body><main>
      <section class="band">
        <h2><span style="font-size:54px">One Big Fictional Headline</span></h2>
        <p>Prose so the band qualifies as a content section for the walk.</p>
      </section>
    </main></body></html>`);
    const headings = specs.flatMap((s) => s.headings);
    expect(headings.filter((h) => h === 'One Big Fictional Headline')).toHaveLength(1);
  }, 60_000);
});
