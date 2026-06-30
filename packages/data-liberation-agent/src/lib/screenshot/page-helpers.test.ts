import { describe, it, expect, vi } from 'vitest';
import {
  waitForStable,
  triggerLazyLoad,
  withEvaluateTimeout,
  waitForFonts,
  waitForAnimations,
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

describe('triggerLazyLoad', () => {
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
