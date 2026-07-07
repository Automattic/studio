import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server as HttpServer } from 'node:http';
import { captureScreenshots } from './screenshotter.js';
import {
  scoreOverlay,
  OVERLAY_THRESHOLD,
  isConsentBanner,
  selectOverlayTargets,
  dismissOverlays,
  type OverlayCandidate,
  type ScrollLockState,
  type OverlayDetection,
} from './page-helpers.js';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

// A fully benign fixed/sticky element (e.g. a sticky site header).
const benign = (over: Partial<OverlayCandidate> = {}): OverlayCandidate => ({
  idx: 0,
  selector: 'header.site',
  role: null,
  ariaModal: false,
  zIndex: 100,
  coverageRatio: 0.08,
  hasBackdrop: false,
  vendorHint: false,
  text: 'home about contact',
  ariaLabel: null,
  hasCloseAffordance: false,
  ...over,
});
const noLock: ScrollLockState = { active: false };
const lock: ScrollLockState = { active: true };

describe('scoreOverlay', () => {
  it('scores a klaviyo-shaped modal above the takeover threshold', () => {
    const modal = benign({
      selector: 'div.klaviyo-form',
      role: 'dialog',
      ariaModal: true,
      zIndex: 10000001,
      coverageRatio: 0.7,
      vendorHint: true,
    });
    const { score, signals } = scoreOverlay(modal, lock);
    // dialog(3) + scroll-lock(3) + coverage>=50(2) + z>=1e5(2) + vendor(1) = 11
    expect(score).toBe(11);
    expect(score).toBeGreaterThanOrEqual(OVERLAY_THRESHOLD);
    expect(signals).toEqual(
      expect.arrayContaining(['dialog', 'scroll-lock', 'coverage>=50', 'z>=1e5', 'vendor']),
    );
  });

  it('keeps a benign sticky header below threshold even when scroll is locked elsewhere', () => {
    // scroll-lock alone (+3) must not push generic chrome over the line.
    expect(scoreOverlay(benign(), lock).score).toBe(3);
    expect(scoreOverlay(benign(), lock).score).toBeLessThan(OVERLAY_THRESHOLD);
  });

  it('keeps a bare role=dialog tooltip (no lock, small, low z) below threshold', () => {
    const tip = benign({ role: 'dialog', coverageRatio: 0.05, zIndex: 50 });
    expect(scoreOverlay(tip, noLock).score).toBe(3);
  });

  it('keeps a fixed full-screen parallax background below threshold without scroll-lock', () => {
    const bg = benign({ coverageRatio: 1, zIndex: 0 });
    expect(scoreOverlay(bg, noLock).score).toBe(3); // coverage>=90 only
  });
});

describe('isConsentBanner', () => {
  it('flags a banner by consent keyword in its text', () => {
    expect(isConsentBanner(benign({ text: 'we use cookies to improve your experience' }))).toBe(true);
  });

  it('flags a banner by a known consent vendor in its selector', () => {
    expect(isConsentBanner(benign({ selector: 'div#onetrust-banner-sdk', text: 'manage preferences' }))).toBe(true);
  });

  it('does not flag a generic newsletter modal as a consent banner', () => {
    expect(isConsentBanner(benign({ text: 'join our list for 10 percent off', selector: 'div.popup' }))).toBe(false);
  });

  it('flags a banner by the singular cookie keyword', () => {
    expect(isConsentBanner(benign({ text: 'this site uses a cookie' }))).toBe(true);
  });
});

describe('selectOverlayTargets', () => {
  it('returns takeovers (highest score first) then consent banners, dropping benign chrome', () => {
    const detection: OverlayDetection = {
      scrollLock: { active: true },
      candidates: [
        benign({ idx: 0, selector: 'header.site' }),                       // benign → dropped
        benign({ idx: 1, selector: 'div.klaviyo', role: 'dialog', ariaModal: true, coverageRatio: 0.7, zIndex: 10000001, vendorHint: true }), // strong takeover
        benign({ idx: 2, selector: 'div.cookie-bar', text: 'we use cookies', coverageRatio: 0.09, zIndex: 50 }), // consent (score 3, below threshold)
        benign({ idx: 3, selector: 'div.modal', role: 'dialog', coverageRatio: 0.6 }), // weaker takeover (3+3+2=8 with lock)
      ],
    };
    const targets = selectOverlayTargets(detection);
    expect(targets.map((t) => t.idx)).toEqual([1, 3, 2]); // takeovers by score desc, then consent
    expect(targets[0].kind).toBe('takeover');
    expect(targets[2].kind).toBe('consent');
    expect(targets[2].signals).toContain('consent');
  });

  it('returns nothing for a page of only benign fixed chrome', () => {
    const detection: OverlayDetection = {
      scrollLock: { active: false },
      candidates: [benign({ idx: 0 }), benign({ idx: 1, selector: 'footer.site' })],
    };
    expect(selectOverlayTargets(detection)).toEqual([]);
  });

  it('routes an above-threshold candidate that also reads as consent to takeovers (not consent)', () => {
    const detection: OverlayDetection = {
      scrollLock: { active: true },
      candidates: [
        benign({ idx: 0, selector: 'div.gdpr-wall', text: 'we use cookies', role: 'dialog', coverageRatio: 0.95 }),
      ],
    };
    const targets = selectOverlayTargets(detection);
    expect(targets).toHaveLength(1);
    expect(targets[0].kind).toBe('takeover');
  });

  it('drops thin sticky chrome that only reaches threshold via scroll-lock + a sibling backdrop', () => {
    // score = scroll-lock(3) + backdrop(1) = 4 (== threshold), but no modal role and
    // tiny coverage → NOT a takeover. (This is the false-positive the gate guards.)
    const detection: OverlayDetection = {
      scrollLock: { active: true },
      candidates: [benign({ idx: 0, selector: 'header.site', hasBackdrop: true, coverageRatio: 0.08 })],
    };
    expect(selectOverlayTargets(detection)).toEqual([]);
  });

  it('keeps a small scroll-locking modal that carries its own dialog semantics', () => {
    // score = dialog(3) + scroll-lock(3) = 6; coverage only 0.09 but aria-modal → takeover.
    const detection: OverlayDetection = {
      scrollLock: { active: true },
      candidates: [benign({ idx: 0, selector: 'div.age-gate', ariaModal: true, coverageRatio: 0.09 })],
    };
    const targets = selectOverlayTargets(detection);
    expect(targets).toHaveLength(1);
    expect(targets[0].kind).toBe('takeover');
  });
});

// A scroll-locking newsletter modal with a working close button, a backdrop, and
// — crucially — a benign sticky header that must survive dismissal untouched.
const MODAL_CLOSE_FIXTURE = `<!doctype html><html><head><style>
  body.locked { overflow: hidden; }
  #hdr { position: sticky; top: 0; height: 60px; z-index: 100; background: #eee; }
  #bg  { position: fixed; inset: 0; z-index: 2147482000; background: rgba(0,0,0,.5); }
  #m   { position: fixed; inset: 0; z-index: 2147483000; background: #fff; }
</style></head><body class="locked">
  <header id="hdr">site nav</header>
  <div id="bg"></div>
  <div id="m" role="dialog" aria-modal="true">
    <button aria-label="Close" id="x">×</button>
    <p>Join our fictional newsletter</p>
  </div>
  <main style="height:3000px">content</main>
  <script>
    document.getElementById('x').addEventListener('click', function () {
      document.getElementById('m').remove();
      document.getElementById('bg').remove();
      document.body.classList.remove('locked');
    });
  </script>
</body></html>`;

describe('dismissOverlays — Tier 1 graceful close (Playwright)', () => {
  it('clicks the modal close button, restoring scroll and leaving chrome + no stamps', async () => {
    const page = await browser.newPage();
    await page.setContent(MODAL_CLOSE_FIXTURE);
    try {
      const dismissed = await dismissOverlays(page);

      expect(dismissed).toHaveLength(1);
      expect(dismissed[0].method).toBe('close-click');
      expect(dismissed[0].kind).toBe('takeover');

      // modal + backdrop gone, scroll restored
      expect(await page.locator('#m').count()).toBe(0);
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
      // benign sticky header untouched
      expect(await page.locator('#hdr').count()).toBe(1);
      // no detection stamps leaked into the DOM (would otherwise be captured)
      expect(await page.evaluate(() =>
        document.querySelectorAll('[data-lib-overlay],[data-lib-overlay-close]').length)).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('returns [] (never throws) on a page with no overlays', async () => {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><body><main style="height:2000px">plain</main></body>');
    try {
      expect(await dismissOverlays(page)).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// A scroll-locking modal with NO close control that closes on Escape.
const MODAL_ESCAPE_FIXTURE = `<!doctype html><html><head><style>
  body.locked { overflow: hidden; }
  #m { position: fixed; inset: 0; z-index: 999999; background: #fff; }
</style></head><body class="locked">
  <div id="m" role="dialog" aria-modal="true"><p>No close button here</p></div>
  <main style="height:3000px">content</main>
  <script>
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.getElementById('m').remove();
        document.body.classList.remove('locked');
      }
    });
  </script>
</body></html>`;

describe('dismissOverlays — Tier 2 Escape (Playwright)', () => {
  it('falls back to Escape when there is no close control', async () => {
    const page = await browser.newPage();
    await page.setContent(MODAL_ESCAPE_FIXTURE);
    try {
      const dismissed = await dismissOverlays(page);
      expect(dismissed).toHaveLength(1);
      expect(dismissed[0].method).toBe('escape');
      expect(await page.locator('#m').count()).toBe(0);
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
    } finally {
      await page.close();
    }
  });
});

// A bottom cookie strip (no scroll-lock) with Reject + Accept; each records the
// choice so we can assert reject is preferred, and removes the strip.
const CONSENT_FIXTURE = `<!doctype html><html><head><style>
  #c { position: fixed; left: 0; right: 0; bottom: 0; height: 90px; z-index: 5000; background: #222; color: #fff; }
</style></head><body>
  <div id="c">
    <span>We use cookies to improve your experience.</span>
    <button id="acc">Accept</button>
    <button id="rej">Reject</button>
  </div>
  <main style="height:3000px">content</main>
  <script>
    function done(which){ window.__consent = which; document.getElementById('c').remove(); }
    document.getElementById('acc').addEventListener('click', function(){ done('accept'); });
    document.getElementById('rej').addEventListener('click', function(){ done('reject'); });
  </script>
</body></html>`;

describe('dismissOverlays — consent banner (Playwright)', () => {
  it('dismisses a cookie banner, preferring reject', async () => {
    const page = await browser.newPage();
    await page.setContent(CONSENT_FIXTURE);
    try {
      const dismissed = await dismissOverlays(page);
      expect(dismissed).toHaveLength(1);
      expect(dismissed[0].kind).toBe('consent');
      expect(dismissed[0].method).toBe('close-click');
      expect(await page.locator('#c').count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as { __consent?: string }).__consent)).toBe('reject');
    } finally {
      await page.close();
    }
  });
});

// Closing modal A injects modal B (a second scroll-locking dialog). Only a
// re-detect round can catch B — a single pass would leave it captured.
const STACKED_FIXTURE = `<!doctype html><html><head><style>
  body.locked { overflow: hidden; }
  .ov { position: fixed; inset: 0; z-index: 999999; background: #fff; }
</style></head><body class="locked">
  <div id="a" class="ov" role="dialog" aria-modal="true">
    <button aria-label="Close" id="ax">×</button>A
  </div>
  <main style="height:3000px">content</main>
  <script>
    document.getElementById('ax').addEventListener('click', function () {
      document.getElementById('a').remove();
      var b = document.createElement('div');
      b.id = 'b'; b.className = 'ov'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-modal', 'true');
      b.innerHTML = '<button aria-label="Close" id="bx">×</button>B';
      document.body.appendChild(b);
      document.getElementById('bx').addEventListener('click', function () {
        document.getElementById('b').remove();
        document.body.classList.remove('locked');
      });
    });
  </script>
</body></html>`;

describe('dismissOverlays — stacked overlays (Playwright)', () => {
  it('clears a second overlay that only appears after the first is dismissed', async () => {
    const page = await browser.newPage();
    await page.setContent(STACKED_FIXTURE);
    try {
      const dismissed = await dismissOverlays(page);
      expect(dismissed.length).toBe(2);
      expect(await page.locator('.ov').count()).toBe(0);
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
    } finally {
      await page.close();
    }
  });

  it('respects maxRounds: a single round leaves the late overlay', async () => {
    const page = await browser.newPage();
    await page.setContent(STACKED_FIXTURE);
    try {
      const dismissed = await dismissOverlays(page, { maxRounds: 1 });
      expect(dismissed.length).toBe(1); // only A; B surfaced after round 1 ended
      expect(await page.locator('#b').count()).toBe(1);
    } finally {
      await page.close();
    }
  });
});

// An un-closeable scroll-locking modal: no close control, no Escape handler.
const MODAL_STUBBORN_FIXTURE = `<!doctype html><html><head><style>
  body.locked { overflow: hidden; }
  #bg { position: fixed; inset: 0; z-index: 999998; background: rgba(0,0,0,.6); }
  #m  { position: fixed; inset: 0; z-index: 999999; background: #fff; }
</style></head><body class="locked">
  <div id="bg"></div>
  <div id="m" role="dialog" aria-modal="true"><p>You cannot close me</p></div>
  <main style="height:3000px">content</main>
</body></html>`;

describe('dismissOverlays — Tier 3 force remove (Playwright)', () => {
  it('removes the overlay + backdrop and force-unlocks scroll as a last resort', async () => {
    const page = await browser.newPage();
    await page.setContent(MODAL_STUBBORN_FIXTURE);
    try {
      const dismissed = await dismissOverlays(page);
      expect(dismissed).toHaveLength(1);
      expect(dismissed[0].method).toBe('remove');
      expect(await page.locator('#m').count()).toBe(0);
      expect(await page.locator('#bg').count()).toBe(0); // backdrop removed too
      // The `body.locked` class is NOT a recognized scroll-lock name, so it
      // legitimately survives — we force scroll open via an important inline
      // override instead of removing site classes. Assert the real contract:
      // scroll is restored.
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
    } finally {
      await page.close();
    }
  });
});

// A cookie banner whose Accept button has NO dismiss handler (so it falls
// through to Tier 3 force-remove), sharing <body> with a real full-viewport
// fixed element that must NOT be deleted as a "backdrop".
const CONSENT_STUBBORN_FIXTURE = `<!doctype html><html><head><style>
  #hero { position: fixed; inset: 0; z-index: 1; background: #ddd; }
  #c { position: fixed; left: 0; right: 0; bottom: 0; height: 80px; z-index: 5000; background: #222; color: #fff; }
</style></head><body>
  <div id="hero">full-screen background content</div>
  <div id="c"><span>We use cookies.</span><button id="acc">Accept</button></div>
  <main style="height:3000px">content</main>
</body></html>`;

describe('dismissOverlays — consent reaching Tier 3 does not delete a full-screen sibling (Playwright)', () => {
  it('force-removes only the consent strip, preserving an unrelated full-viewport fixed element', async () => {
    const page = await browser.newPage();
    await page.setContent(CONSENT_STUBBORN_FIXTURE);
    try {
      const dismissed = await dismissOverlays(page);
      expect(dismissed).toHaveLength(1);
      expect(dismissed[0].kind).toBe('consent');
      expect(dismissed[0].method).toBe('remove'); // dead Accept button → fell through to Tier 3
      expect(await page.locator('#c').count()).toBe(0);    // strip removed
      expect(await page.locator('#hero').count()).toBe(1); // full-screen sibling PRESERVED
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: captureScreenshots dismisses overlays before capture
// ---------------------------------------------------------------------------

const TMP_ROOT = join(process.cwd(), '.tmp-test');

const MODAL_PAGE = `<!doctype html><html><head><style>
  body.locked { overflow: hidden; }
  #m { position: fixed; inset: 0; z-index: 2147483000; background: #fff; }
</style></head><body class="locked">
  <div id="m" role="dialog" aria-modal="true">
    <button aria-label="Close" id="x">×</button>
    <p data-modal-marker>FICTIONAL POPUP TEXT</p>
  </div>
  <h1>Real Page Heading</h1>
  <div style="height:3000px;background:linear-gradient(#fff,#000)">tall content</div>
  <script>
    document.getElementById('x').addEventListener('click', function () {
      document.getElementById('m').remove();
      document.body.classList.remove('locked');
    });
  </script>
</body></html>`;

describe('captureScreenshots integration — overlay dismissed before capture (real Chromium)', () => {
  it.skipIf(process.env.SKIP_BROWSER_TESTS)('captures the page without the modal markup', async () => {
    mkdirSync(TMP_ROOT, { recursive: true });
    const outputDir = mkdtempSync(join(TMP_ROOT, 'overlay-int-'));
    const server: HttpServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(MODAL_PAGE);
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/`;
    try {
      await captureScreenshots({ urls: [url], outputDir });

      // Desktop HTML was captured (html/<slug>.html) and is modal-free.
      const htmlPath = join(outputDir, 'html', 'homepage.html');
      expect(existsSync(htmlPath)).toBe(true);
      const html = readFileSync(htmlPath, 'utf8');
      expect(html).toContain('Real Page Heading');
      expect(html).not.toContain('data-modal-marker');
      expect(html).not.toContain('data-lib-overlay');

      // Manifest recorded the dismissal.
      const manifest = JSON.parse(readFileSync(join(outputDir, 'screenshots', 'manifest.json'), 'utf8'));
      expect(manifest.entries[url].dismissed?.[0]?.method).toBe('close-click');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60_000);
});
