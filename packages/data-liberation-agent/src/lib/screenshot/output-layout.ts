import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';

const VIEWPORTS = ['desktop', 'mobile'] as const;
export type ViewportId = (typeof VIEWPORTS)[number];

export interface ArtifactPlan {
  needsLoad: boolean;
  captureFullpage: boolean;
  captureScrolled: boolean;
  captureHtml: boolean;
  /** Capture the JS-built mobile DOM (full document) on the MOBILE pass, for the
   *  alt path's iframe mobile-DOM carry (classic/adaptive Wix). Mobile-only — the
   *  counterpart to `captureHtml`'s desktop-only gate. */
  captureMobileHtml: boolean;
  /** Capture per-page section specs (extractFull) on the desktop pass, so the
   *  reconstruction phase can read them instead of re-running Playwright. */
  captureSections: boolean;
  paths: {
    fullpage: string;
    scrolled: string;
    html: string;
    htmlMobile: string;
    sections: string;
  };
}

export interface CapturePlan {
  desktop: ArtifactPlan;
  mobile: ArtifactPlan;
}

/** Reject outputDir paths containing `..` traversal. (No longer cwd-pinned:
 *  the default base is now user-owned under ~/Studio, and explicit --output is
 *  trusted user intent. Per-file joins stay contained at their join sites —
 *  resolveMediaPath checks containment, slugs are separator-free.) */
export function validateOutputDir(outputDir: string): void {
  const norm = normalize(outputDir);
  if (norm.split('/').includes('..') || norm.split('\\').includes('..')) {
    throw new Error(`outputDir contains '..' traversal: ${outputDir}`);
  }
}

/** Claim a slug, appending -2, -3, ... on collision. Mutates `seen`. */
export function claimSlug(base: string, seen: Map<string, number>): string {
  const existing = seen.get(base);
  if (existing === undefined) {
    seen.set(base, 1);
    return base;
  }
  const next = existing + 1;
  seen.set(base, next);
  return `${base}-${next}`;
}

/**
 * Given an outputDir + slug, decide which artifacts we still need to capture
 * for each viewport and whether we need to load the page at all.
 *
 *   viewport.needsLoad = true if ANY of its artifacts are missing (or force)
 *   → we load the page once and capture whatever's missing
 */
export function planArtifacts(args: {
  slug: string;
  outputDir: string;
  force: boolean;
}): CapturePlan {
  const plan = (viewport: ViewportId): ArtifactPlan => {
    const fullpage = join(args.outputDir, 'screenshots', viewport, `${args.slug}.png`);
    const scrolled = join(args.outputDir, 'screenshots', viewport, `${args.slug}.scrolled.png`);
    const html = join(args.outputDir, 'html', `${args.slug}.html`);
    const htmlMobile = join(args.outputDir, 'html-mobile', `${args.slug}.html`);
    const sections = join(args.outputDir, 'sections', `${args.slug}.json`);
    const captureFullpage = args.force || !existsSync(fullpage);
    const captureScrolled = args.force || !existsSync(scrolled);
    // HTML + section specs are captured on the desktop pass only (specs are
    // viewport-relative; desktop 1440×900 matches the live-extract basis).
    const captureHtml = viewport === 'desktop' && (args.force || !existsSync(html));
    // The mobile DOM (full document) is captured on the MOBILE pass — Wix serves a
    // different layout to mobile UAs, so it must come from the emulated mobile pass.
    const captureMobileHtml = viewport === 'mobile' && (args.force || !existsSync(htmlMobile));
    const captureSections = viewport === 'desktop' && (args.force || !existsSync(sections));
    const needsLoad = captureFullpage || captureScrolled || captureHtml || captureMobileHtml || captureSections;
    return {
      needsLoad,
      captureFullpage,
      captureScrolled,
      captureHtml,
      captureMobileHtml,
      captureSections,
      paths: { fullpage, scrolled, html, htmlMobile, sections },
    };
  };
  return { desktop: plan('desktop'), mobile: plan('mobile') };
}
