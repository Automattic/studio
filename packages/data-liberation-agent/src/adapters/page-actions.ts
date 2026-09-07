// src/adapters/page-actions.ts
import type { Page } from 'playwright';

/** Platform-specific preparation applied while liberating a live page. */
export interface LiberationHooks {
  /** CSS selectors removed from the DOM before portable artifacts are produced. */
  removeSelectors?: string[];
  /** Imperative escape hatch (wait-for-app, conditional removal). Runs AFTER
   *  removeSelectors. Best-effort: a throw is swallowed and liberation continues. */
  prepare?(page: Page, ctx: LiberationContext): Promise<void>;
  /**
   * Collect the image variants this platform's runtime swapped in at the
   * current viewport, as {stable media id → variant URL}.
   *
   * Platforms serve per-viewport crops from their own CDNs under their own URL
   * shapes, so recognising them is adapter knowledge. The capture path only
   * knows that a source may have viewport-specific variants worth recording;
   * it must not know what any particular CDN looks like.
   *
   * Best-effort: a throw is swallowed and liberation continues.
   */
  responsiveImages?(page: Page, ctx: LiberationContext): Promise<Record<string, string>>;
}

export interface LiberationContext {
  url: string;
  viewport: 'desktop' | 'mobile';
}
