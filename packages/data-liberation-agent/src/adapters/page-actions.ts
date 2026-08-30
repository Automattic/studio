// src/adapters/page-actions.ts
import type { Page } from 'playwright';

/** Capture-phase DOM mutations, applied to the live page before capture. */
export interface AdapterCapture {
  /** CSS selectors removed from the DOM before screenshots/HTML/specs. */
  removeSelectors?: string[];
  /** Imperative escape hatch (wait-for-app, conditional removal). Runs AFTER
   *  removeSelectors. Best-effort: a throw is swallowed and capture continues. */
  prepare?(page: Page, ctx: CaptureContext): Promise<void>;
  /**
   * Collect the image variants this platform's runtime swapped in at the
   * current viewport, as {stable media id → variant URL}.
   *
   * Platforms serve per-viewport crops from their own CDNs under their own URL
   * shapes, so recognising them is adapter knowledge. The capture path only
   * knows that a source may have viewport-specific variants worth recording;
   * it must not know what any particular CDN looks like.
   *
   * Best-effort: a throw is swallowed and capture continues.
   */
  responsiveImages?(page: Page, ctx: CaptureContext): Promise<Record<string, string>>;
}

export interface CaptureContext {
  url: string;
  viewport: 'desktop' | 'mobile';
}
