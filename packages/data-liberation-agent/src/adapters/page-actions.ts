// src/adapters/page-actions.ts
import type { Page } from 'playwright';

/** Capture-phase DOM mutations, applied to the live page before capture. */
export interface AdapterCapture {
  /** CSS selectors removed from the DOM before screenshots/HTML/specs. */
  removeSelectors?: string[];
  /** Imperative escape hatch (wait-for-app, conditional removal). Runs AFTER
   *  removeSelectors. Best-effort: a throw is swallowed and capture continues. */
  prepare?(page: Page, ctx: CaptureContext): Promise<void>;
}

export interface CaptureContext {
  url: string;
  viewport: 'desktop' | 'mobile';
}

/** Content→blocks recipe, applied on the blocks path at reconstruction time. */
export interface AdapterBlocks {
  /** Declarative per-element mappings, tried in document order. */
  recipes?: BlockRecipe[];
  /** Whole-body transform escape hatch (e.g. the Squarespace sqs-block walk).
   *  Returns block markup, or null to fall through to recipes / generic render. */
  htmlToBlocks?(html: string, ctx: BlockRecipeContext): string | null;
}

export interface BlockRecipe {
  /** CSS selector matched against top-level elements of the source HTML. */
  match: string;
  /** Target core block, e.g. 'core/gallery'. */
  block: string;
  /** Static block attributes merged into the emitted block JSON. */
  attrs?: Record<string, unknown>;
  /** How inner content maps in. Default 'innerHtml'. */
  inner?: 'innerHtml' | 'images' | 'text' | 'drop';
}

export interface BlockRecipeContext {
  url: string;
  /** Media URL → local permalink map, so recipes can emit rewritten URLs. */
  mediaMap?: Record<string, string>;
}
