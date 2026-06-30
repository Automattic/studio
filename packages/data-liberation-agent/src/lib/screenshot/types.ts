import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { UrlType } from '../extraction/sitemap.js';
import type { ExtractedNav } from './nav-extract.js';

export interface Viewport {
  id: 'desktop' | 'mobile';
  width: number;
  height: number;
}

// Desktop stays at 1440×900 — the browser renders the real desktop layout
// (responsive media queries kick in based on logical viewport, not output
// pixels). To keep PNG file size small for the agent's vision context, we
// pair this with `SCREENSHOT_DEVICE_SCALE_FACTOR` below: the browser
// outputs the screenshot at fewer real pixels even though the rendered
// layout is the full 1440×900. That's how to get "~2x fewer pixels"
// without changing what the page actually looks like.
export const DEFAULT_VIEWPORTS: Viewport[] = [
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'mobile', width: 390, height: 844 },
];

/**
 * Default deviceScaleFactor for screenshot capture. 0.7 gives ~49% fewer
 * output pixels (0.7² ≈ 0.49) while the browser keeps rendering at the
 * full logical viewport — so the agent sees the real desktop layout in a
 * smaller PNG. Mobile is already small (390×844 = 330 kpx) so we don't
 * scale it.
 */
export const SCREENSHOT_DEVICE_SCALE_FACTOR = 0.7;

export interface ScreenshotOpts {
  urls: string[];
  outputDir: string;
  primaryUrl?: string;               // reference for same-origin enforcement
  viewports?: Viewport[];
  concurrency?: number;              // default: 6
  browserRestartEvery?: number;      // default: 100
  cdpPort?: number;
  force?: boolean;
  types?: UrlType[];
  limit?: number;
  screenshotTimeoutMs?: number;      // default: 30_000
  evaluateTimeoutMs?: number;        // default: 5_000
  settleMs?: number;                 // default: 1_000
  server?: Server;
  verbose?: boolean;
  /**
   * Capture design fragment + CSS/JS aggregates for page/post archetypes.
   * Default: false. When true, writes design/<slug>.fragment.html and
   * accumulates site.css (and site.js when includeScripts=true) in outputDir.
   */
  captureDesign?: boolean;
  /**
   * Include first-party and allowlisted-CDN scripts in the JS aggregate.
   * Only effective when captureDesign=true. Default: false.
   * Full flag plumbing is Task 12; for now this opts into script capture.
   */
  includeScripts?: boolean;
  /**
   * Per-URL progress callback. Fired after each URL finishes (success,
   * fail, or skip). `current` is the count of completed URLs (1-indexed),
   * `total` is the total to capture. Used by the watch TUI so the
   * "discovery → extraction" gap stops looking like a hang.
   */
  onProgress?: (current: number, total: number, url: string) => void;
  /** Adapter-declared selectors removed from each page before capture (seam 1). */
  removeSelectors?: string[];
  /** Adapter imperative capture hook, run after removeSelectors. Best-effort. */
  prepareCapture?: (
    page: import('playwright').Page,
    ctx: import('../../adapters/page-actions.js').CaptureContext,
  ) => Promise<void>;
}

export interface ScreenshotResult {
  captured: number;
  skipped: number;
  failed: number;
  browserRestarts: number;
  durationMs: number;
  manifestPath: string;
  /** Absolute path to site.css when captureDesign=true and at least one page/post was captured. */
  siteCssPath?: string;
  /** CSS media URLs discovered across all captured page/post CSS. */
  cssMediaUrls?: string[];
  /**
   * Deduplicated <link> hrefs collected from all captured page <head> elements
   * during design capture (fonts, preconnects, etc.). Empty array when
   * captureDesign=false.
   */
  headLinks?: string[];
  /**
   * Aggregated first-party JS text from JsAggregator.toString() when
   * includeScripts=true and at least one script was collected. Undefined when
   * includeScripts=false or no first-party scripts were found.
   */
  siteJsText?: string;
  /**
   * Structured nav data extracted from the first captured page that yielded a
   * detectable header element. Replaces the old headerHtml field. Used to
   * generate a native WP Navigation block header (responsive hamburger).
   * Undefined when captureDesign=false or no header was detected.
   */
  nav?: ExtractedNav;
  /**
   * Sanitized site footer HTML extracted from the first captured page that
   * yielded a detectable footer element. Undefined when captureDesign=false or
   * no footer was detected across any captured page.
   */
  footerHtml?: string;
  /**
   * Responsive chrome CSS generated from dual-viewport (desktop + mobile) baked
   * layout maps. Uses `@media (min-width: 768px)` for desktop rules and
   * `@media (max-width: 767px)` for mobile rules keyed on `.dla-fx-N` marker
   * classes. Undefined when captureDesign=false, no chrome was detected, or only
   * desktop layout was available (falls back to desktop-only rules).
   */
  chromeCssText?: string;
}
