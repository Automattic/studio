// src/lib/screenshot/capture-design.ts
import type { Page } from 'playwright';
import { collectBodyAndChrome, collectBodyFragmentMobileOnly, collectStylesheets, collectHeadLinks, collectScripts } from './dom-capture.js';
import type { BakedLayoutMap } from './fixups.js';
import type { ExtractedNav } from './nav-extract.js';

const MIN_DESIGN_BYTES = 512;

export interface DesignCapture {
  bodyFragmentHtml: string;
  css: string;
  headLinks: string[];
  bodyClasses: string[];
  scripts: Array<{ src?: string; inline?: string }>;
  /**
   * Structured nav data extracted from the site header (logo, items, CTA,
   * style tokens). Replaces the old headerHtml field. null when no header
   * detected or extraction failed.
   */
  nav: ExtractedNav | null;
  /** Extracted + marker-keyed site footer HTML, or null when none detected. */
  footerHtml: string | null;
  /**
   * Desktop computed layout map for the chrome (marker → props).
   * Used with the mobile map to generate responsive chrome.css via generateChromeCss.
   * Null when no chrome was detected.
   */
  desktopLayoutMap: BakedLayoutMap | null;
}

export async function captureDesign(
  page: Page, _baseUrl: string, opts: { includeScripts: boolean },
): Promise<DesignCapture> {
  const [chrome, css, headLinks, bodyClasses] = await Promise.all([
    collectBodyAndChrome(page),
    collectStylesheets(page),
    collectHeadLinks(page),
    page.evaluate(() => document.body.className.split(/\s+/).filter(Boolean)),
  ]);
  const { bodyFragmentHtml, nav, footerHtml, desktopLayoutMap } = chrome;
  if (bodyFragmentHtml.length + css.length < MIN_DESIGN_BYTES) {
    throw new Error(`captureDesign: captured content too small (${bodyFragmentHtml.length + css.length}B) — page likely did not render`);
  }
  const scripts = opts.includeScripts ? await collectScripts(page) : [];
  return { bodyFragmentHtml, css, headLinks, bodyClasses, scripts, nav, footerHtml, desktopLayoutMap };
}

/**
 * Mobile-only body fragment capture: remove chrome, return the body-only
 * fragment (no nav/footer extraction, no layout map — those are desktop-only).
 * Used during the mobile viewport pass in the screenshotter.
 */
export async function collectBodyFragmentOnly(page: Page): Promise<{
  bodyFragmentHtml: string;
  bodyClasses: string[];
  css: string;
}> {
  const [bodyFragmentHtml, bodyClasses, css] = await Promise.all([
    collectBodyFragmentMobileOnly(page),
    page.evaluate(() => document.body.className.split(/\s+/).filter(Boolean)),
    collectStylesheets(page),
  ]);
  return { bodyFragmentHtml, bodyClasses, css };
}
