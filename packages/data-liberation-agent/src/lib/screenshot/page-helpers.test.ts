import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import {
  waitForStable,
  triggerLazyLoad,
  withEvaluateTimeout,
  waitForFonts,
  waitForImages,
  waitForAnimations,
  waitForRenderIdle,
  waitForDomQuiescence,
} from './page-helpers.js';

type MockPage = {
  waitForLoadState: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
};

function makePage(): MockPage {
  return {
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
  };
}

describe('waitForStable', () => {
  it('waits for load then settles', async () => {
    const page = makePage();
    await waitForStable(page as never, 10);
    expect(page.waitForLoadState).toHaveBeenCalledWith('load');
  });

  it('swallows networkidle failures (chatty analytics)', async () => {
    const page = makePage();
    page.waitForLoadState = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('networkidle timeout'));
    await expect(waitForStable(page as never, 10)).resolves.toBeUndefined();
  });

  it('waits for fonts to resolve FOIT before returning', async () => {
    const page = makePage();
    await waitForStable(page as never, 10);
    // the fonts wait evaluates document.fonts.ready in the page
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('waits for DOM mutations to quiesce after fonts settle, bounded by domTimeoutMs', async () => {
    // Regression for a truncated SPA capture: a page whose deferred content
    // (e.g. an async data-driven section) mounts well after 'load' and after
    // networkidle has given up must still be waited for — see
    // waitForDomQuiescence below for the actual mechanism.
    const page = makePage();
    await waitForStable(page as never, 10, 250);
    const quiescenceCall = page.evaluate.mock.calls.find(
      (call) => typeof call[1] === 'object' && call[1] !== null && 'quietMs' in call[1],
    );
    expect(quiescenceCall).toBeTruthy();
    expect(quiescenceCall?.[1]).toMatchObject({ timeoutMs: 250 });
  });

  it('does not hang when the page never stops mutating (bounded readiness, not a fixed sleep)', async () => {
    const page = makePage();
    page.evaluate = vi.fn().mockImplementation((_fn: unknown, args?: { quietMs?: number }) => {
      // Only the quiescence call ever hangs; fonts.ready resolves normally.
      if (args && 'quietMs' in args) return new Promise(() => {});
      return Promise.resolve(true);
    });
    await expect(waitForStable(page as never, 0, 30)).resolves.toBeUndefined();
  });
});

describe('waitForFonts', () => {
  it('awaits document.fonts.ready via page.evaluate', async () => {
    const page = makePage();
    await waitForFonts(page as never);
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('does not throw when the font wait rejects (blocked CDN)', async () => {
    const page = makePage();
    page.evaluate = vi.fn().mockRejectedValue(new Error('font load failed'));
    await expect(waitForFonts(page as never)).resolves.toBeUndefined();
  });

  it('does not throw when the font wait exceeds its timeout', async () => {
    const page = makePage();
    page.evaluate = vi.fn().mockImplementation(() => new Promise(() => {}));
    await expect(waitForFonts(page as never, 30)).resolves.toBeUndefined();
  });
});

describe('waitForAnimations', () => {
  it('awaits in-flight animations via page.evaluate', async () => {
    const page = makePage();
    await waitForAnimations(page as never);
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('does not throw when the animation wait rejects', async () => {
    const page = makePage();
    page.evaluate = vi.fn().mockRejectedValue(new Error('evaluate failed'));
    await expect(waitForAnimations(page as never)).resolves.toBeUndefined();
  });

  it('does not throw (and resolves) when a stuck animation exceeds the timeout', async () => {
    const page = makePage();
    page.evaluate = vi.fn().mockImplementation(() => new Promise(() => {}));
    await expect(waitForAnimations(page as never, 30)).resolves.toBeUndefined();
  });
});

describe('waitForDomQuiescence', () => {
  it('asks the page to observe mutations with the given quiet/timeout budget', async () => {
    const page = makePage();
    await waitForDomQuiescence(page as never, 250, 2_000);
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), { quietMs: 250, timeoutMs: 2_000 });
  });

  it('does not throw when the page blocks the observer script', async () => {
    const page = makePage();
    page.evaluate = vi.fn().mockRejectedValue(new Error('evaluate blocked'));
    await expect(waitForDomQuiescence(page as never)).resolves.toBeUndefined();
  });

  it('does not hang when the page never stops mutating', async () => {
    // A page that mutates forever (a live ticker, a looping re-render) must
    // still let the capture proceed — bounded by timeoutMs, not indefinitely.
    const page = makePage();
    page.evaluate = vi.fn().mockImplementation(() => new Promise(() => {}));
    await expect(waitForDomQuiescence(page as never, 10, 30)).resolves.toBeUndefined();
  });
});

describe('triggerLazyLoad', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('scrolls and waits, does not throw', async () => {
    const page = makePage();
    await triggerLazyLoad(page as never);
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('all in-page scrollTo calls are explicit-instant (smooth-scroll glide immunity)', async () => {
    // html{scroll-behavior:smooth} makes a bare scrollTo GLIDE: the restore
    // scrollTo(0,0) was still mid-glide (y=4, is-scrolled on) when the snap
    // fired — scroll-reactive chrome captured compressed. Explicit
    // behavior:'instant' overrides the css per spec. Lock all three call
    // sites (step loop, bottom jump, top restore) via the evaluate-arg source.
    const page = makePage();
    await triggerLazyLoad(page as never);
    const sources = page.evaluate.mock.calls.map((c) => String(c[0])).join('\n');
    const instants = sources.match(/behavior:\s*['"]instant['"]/g) ?? [];
    expect(instants.length).toBeGreaterThanOrEqual(3);
    // No bare two-arg form may remain — it would re-inherit the css behavior.
    expect(sources).not.toContain('scrollTo(0,');
  });

  it('does not throw on networkidle hang', async () => {
    const page = makePage();
    page.waitForLoadState = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(triggerLazyLoad(page as never)).resolves.toBeUndefined();
  });

  it('does not throw on page.evaluate failure', async () => {
    const page = makePage();
    page.evaluate = vi.fn().mockRejectedValue(new Error('page crashed'));
    await expect(triggerLazyLoad(page as never)).resolves.toBeUndefined();
  });

  it('preserves network idle before responsive geometry learning', async () => {
    const page = makePage();
    await triggerLazyLoad(page as never, true);
    expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 5_000 });
  });

  it('waits for decoded images before the capture continues', async () => {
    const page = await browser.newPage();
    await page.setContent('<img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22/%3E">');
    await waitForImages(page);
    expect(await page.locator('img').count()).toBe(1);
    const image = await page.locator('img').evaluate((element) => ({
      complete: (element as HTMLImageElement).complete,
      naturalWidth: (element as HTMLImageElement).naturalWidth,
    }));
    expect(image).toEqual({ complete: true, naturalWidth: 10 });
    await page.close();
  });

  // Regression coverage for the stale-`total` scroll-reveal bug: a document
  // whose height grows as it is scrolled (lazy images, an IntersectionObserver
  // reveal that adds an "in" class) must have every element revealed, the same
  // way, every time — not whatever fraction the sweep happened to reach before
  // it fell behind the growing page. Fictional content only (no source-site
  // data): plain `<figure>` stubs that grow from a small placeholder to full
  // size and gain the "in" class once an IntersectionObserver reports them
  // entering the viewport, after a short async delay standing in for a real
  // image fetch.
  function growingRevealFixture(count: number, delayMs: number): string {
    const figures = Array.from(
      { length: count },
      (_, i) => `<figure class="reveal" data-idx="${i}"></figure>`,
    ).join('\n');
    return `<!doctype html><html><head><style>
      body { margin: 0; }
      figure.reveal { height: 30px; margin: 0; opacity: 0; transform: translateY(22px); }
      figure.reveal.in { height: 300px; opacity: 1; transform: none; }
    </style></head><body>
      ${figures}
      <script>
        const io = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            io.unobserve(entry.target);
            // Stand-in for an async image fetch: the reveal (and the height
            // growth it carries) lands some time AFTER the element enters the
            // viewport, not synchronously with the scroll step that found it.
            setTimeout(() => entry.target.classList.add('in'), ${delayMs});
          }
        }, { threshold: 0.01 });
        document.querySelectorAll('figure.reveal').forEach((el) => io.observe(el));
      </script>
    </body></html>`;
  }

  const countRevealed = (page: import('playwright').Page) =>
    page.locator('figure.reveal.in').count();
  const countFigures = (page: import('playwright').Page) =>
    page.locator('figure.reveal').count();

  it('reveals every element even though the document grows as it scrolls', async () => {
    const page = await browser.newPage();
    await page.setContent(growingRevealFixture(50, 60));
    await triggerLazyLoad(page as never);
    expect(await countFigures(page)).toBe(50);
    expect(await countRevealed(page)).toBe(50);
    await page.close();
  });

  it('is stable across repeated captures of the same growing document', async () => {
    // Same fixture, captured fresh three times with a different (jittered)
    // per-element delay each run — standing in for real network variance
    // between two captures of the same source. Every run must reveal
    // everything; a stale-height sweep would reveal a different, timing-
    // dependent subset each time.
    for (let run = 0; run < 3; run++) {
      const page = await browser.newPage();
      const jitter = 40 + run * 35;
      await page.setContent(growingRevealFixture(40, jitter));
      await triggerLazyLoad(page as never);
      expect(await countFigures(page)).toBe(40);
      expect(await countRevealed(page)).toBe(40);
      await page.close();
    }
  }, 30_000);

  it('terminates on a page that grows without bound (infinite scroll)', async () => {
    // A sentinel at the bottom that appends more content every time it is
    // observed never lets the document finish growing. triggerLazyLoad must
    // still return — bounded by its internal settle budget — rather than
    // scrolling forever.
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>
      <div id="container"></div>
      <div id="sentinel" style="height:1px"></div>
      <script>
        let n = 0;
        const container = document.getElementById('container');
        const sentinel = document.getElementById('sentinel');
        function addBatch(count) {
          for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.style.height = '40px';
            el.textContent = 'item ' + (n++);
            container.appendChild(el);
          }
        }
        addBatch(20);
        const io = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) addBatch(10);
          }
        });
        io.observe(sentinel);
      </script>
    </body></html>`);

    const started = Date.now();
    await expect(triggerLazyLoad(page as never)).resolves.toBeUndefined();
    const elapsed = Date.now() - started;
    // Internal settle budget is ~20s; give generous headroom above that
    // without allowing it to degrade into an unbounded wait.
    expect(elapsed).toBeLessThan(28_000);
    await page.close();
  }, 30_000);
});

describe('waitForRenderIdle', () => {
  it('waits for render resources but not background fetches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime( new Date( '2026-08-29T00:00:00Z' ) );
    const page = Object.assign( new EventEmitter(), { url: () => 'https://example.com/page' } );
    const image = { resourceType: () => 'image' };
    const analytics = {
      resourceType: () => 'fetch',
      url: () => 'https://analytics.example/collect',
    };
    const waiting = waitForRenderIdle(
      page as never,
      async () => {
        page.emit( 'request', analytics );
        page.emit( 'request', image );
        page.emit( 'requestfinished', analytics );
        setTimeout( () => page.emit( 'requestfinished', image ), 100 );
      },
      500,
      5_000,
    );

    await vi.advanceTimersByTimeAsync( 599 );
    expect( vi.isFakeTimers() ).toBe( true );
    await vi.advanceTimersByTimeAsync( 1 );
    await expect( waiting ).resolves.toBeUndefined();
    expect( page.listenerCount( 'request' ) ).toBe( 0 );
    vi.useRealTimers();
  });
});

describe('withEvaluateTimeout', () => {
  it('resolves normal evaluates', async () => {
    const result = await withEvaluateTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it('rejects with timeout on slow promise', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5_000));
    await expect(withEvaluateTimeout(slow, 50)).rejects.toThrow(/timeout/i);
  });

  it('propagates non-timeout rejections unchanged', async () => {
    const failing = Promise.reject(new Error('custom error'));
    await expect(withEvaluateTimeout(failing, 1000)).rejects.toThrow('custom error');
  });
});
