import { describe, it, expect, vi } from 'vitest';
import { applyCaptureRemovals } from './apply-removals.js';

const fakePage = () => ({ evaluate: vi.fn(async (_fn: unknown, _arg: unknown) => undefined) });

describe('applyCaptureRemovals', () => {
  it('passes the selector list to page.evaluate', async () => {
    const page = fakePage();
    await applyCaptureRemovals(page as never, {
      removeSelectors: ['#upCart', '.kl-teaser'], ctx: { url: 'https://x.test/', viewport: 'desktop' },
    });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.evaluate.mock.calls[0][1]).toEqual(['#upCart', '.kl-teaser']);
  });
  it('does nothing with no selectors and no prepare hook', async () => {
    const page = fakePage();
    await applyCaptureRemovals(page as never, { ctx: { url: 'https://x.test/', viewport: 'desktop' } });
    expect(page.evaluate).not.toHaveBeenCalled();
  });
  it('swallows a page.evaluate failure (best-effort)', async () => {
    const page = { evaluate: vi.fn(async () => { throw new Error('detached'); }) };
    await expect(applyCaptureRemovals(page as never, {
      removeSelectors: ['#upCart'], ctx: { url: 'https://x.test/', viewport: 'desktop' },
    })).resolves.toBeUndefined();
  });
  it('runs prepare after removals and swallows its errors', async () => {
    const page = fakePage();
    const prepare = vi.fn(async () => { throw new Error('boom'); });
    await expect(applyCaptureRemovals(page as never, {
      removeSelectors: ['#a'], prepare, ctx: { url: 'https://x.test/', viewport: 'mobile' },
    })).resolves.toBeUndefined();
    expect(prepare).toHaveBeenCalledOnce();
  });
});
