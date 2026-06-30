import type { Page } from 'playwright';
import type { CaptureContext } from '../../adapters/page-actions.js';

export interface ApplyRemovalsOpts {
  removeSelectors?: string[];
  prepare?(page: Page, ctx: CaptureContext): Promise<void>;
  ctx: CaptureContext;
}

/**
 * Remove adapter-declared selectors from the live page, then run the optional
 * imperative hook. STRICTLY best-effort — mirrors dismissOverlays: a failure
 * here must never fail a screenshot. Runs in capturePerViewport after settle
 * and before any artifact (HTML/specs/screenshot) is captured.
 */
export async function applyCaptureRemovals(page: Page, opts: ApplyRemovalsOpts): Promise<void> {
  const { removeSelectors, prepare, ctx } = opts;
  if (removeSelectors && removeSelectors.length > 0) {
    await page.evaluate((sels: string[]) => {
      for (const sel of sels) for (const el of Array.from(document.querySelectorAll(sel))) el.remove();
    }, removeSelectors).catch(() => { /* best-effort */ });
  }
  if (prepare) await prepare(page, ctx).catch(() => { /* best-effort */ });
}
