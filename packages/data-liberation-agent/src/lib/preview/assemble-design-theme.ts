// src/lib/preview/assemble-design-theme.ts
//
// Run-end blank-theme assembly for html-first design capture.
//
// Takes the run-level CSS aggregate (from CssAggregator.toString()), the
// optional JS aggregate (from JsAggregator.toString()), the accumulated
// mediaUrlMap, and the CDN head-links collected during the capture pass, and
// produces a ReplicaFile[] that can be handed directly to
// writeReplicaFilesToHost + wp theme activate.
//
// This is the final step of the html-first pipeline:
//   captureDesign (per-URL) → CssAggregator / JsAggregator (run-level)
//     → assembleDesignTheme (run-end) → writeReplicaFilesToHost → activate
//
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBlankTheme } from './blank-theme.js';
import { buildBlockHeader } from './block-header.js';
import { pickBrandDark } from './brand-color.js';
import { rewriteMediaUrls } from '../streaming/media-url-rewrite.js';
import type { ReplicaFile } from './types.js';
import type { ExtractedNav } from '../screenshot/nav-extract.js';
import type { PaletteFile } from '../screenshot/aggregator.js';

export interface AssembleDesignThemeOpts {
  outputDir: string;
  cssText: string;                      // CssAggregator.toString()
  jsText?: string;                      // JsAggregator.toString() (undefined → no JS)
  mediaUrlMap: Map<string, string>;     // source URL → local upload URL
  headLinks: string[];                  // CDN/cross-origin <link>s to re-link
  themeSlug?: string;                   // default 'dla-replica'
  /**
   * Structured nav data captured from the source header.
   * Used to generate a native WP Navigation block header with a responsive
   * hamburger via do_blocks(). Replaces the old headerHtml field.
   */
  nav?: ExtractedNav;
  /**
   * Local (uploaded) URL for the logo image, derived from nav.logoSrc after
   * media pipeline rewrite. When present, overrides nav.logoSrc in the block.
   */
  logoLocalUrl?: string;
  /** Sanitized site footer HTML to bake into the blank theme. */
  footerHtml?: string;
  /**
   * Responsive chrome CSS from generateChromeCss (dual-viewport bake).
   * When present, emitted as chrome.css alongside site.css and enqueued
   * after it in functions.php. Uses @media breakpoints at 768px to apply
   * desktop/mobile .dla-fx-N rules that override site.css responsive rules.
   */
  chromeCssText?: string;
  /**
   * Base URL of the source site (e.g. "https://www.swiftlumber.com").
   * When present, nav hrefs in the block header are rewritten to local
   * WordPress page paths (e.g. "/about-us/"), with the homepage becoming
   * "/" and external links left unchanged.
   */
  siteUrl?: string;
}

/**
 * Assemble the blank design theme for html-first mode.
 *
 * Returns the ReplicaFile[] for the blank theme (style.css, functions.php,
 * index.php, page.php, singular.php, parts/header.html) plus the run-level
 * site.css (media-URL-rewritten) and, when jsText is non-empty, site.js.
 */
export function assembleDesignTheme(opts: AssembleDesignThemeOpts): ReplicaFile[] {
  const themeSlug = opts.themeSlug ?? 'dla-replica';
  const hasJs = !!(opts.jsText && opts.jsText.trim());
  const hasChromeCss = !!(opts.chromeCssText && opts.chromeCssText.trim());

  // Rewrite CSS url() refs to local uploads (the second rewrite surface —
  // first is per-URL markup rewrites in flushPendingImports).
  const siteCss = opts.mediaUrlMap.size > 0
    ? rewriteMediaUrls(opts.cssText, opts.mediaUrlMap)
    : opts.cssText;

  // ── Read palette.json and pick brand-dark color ───────────────────────────
  // Guard: missing / corrupt file → null (no fallback applied).
  let brandDark: string | undefined;
  try {
    const palettePath = join(opts.outputDir, 'palette.json');
    if (existsSync(palettePath)) {
      const raw = readFileSync(palettePath, 'utf8');
      const palette = JSON.parse(raw) as PaletteFile;
      if (Array.isArray(palette?.colors)) {
        brandDark = pickBrandDark(palette.colors) ?? undefined;
      }
    }
  } catch {
    // Corrupt or unreadable palette — degrade gracefully.
    brandDark = undefined;
  }

  // Build the WP block header markup from nav data.
  // The logo URL is rewritten to its local upload URL when available.
  let headerBlockMarkup: string | undefined;
  if (opts.nav) {
    // Rewrite nav.logoSrc to the local URL if available in the mediaUrlMap.
    const logoLocalUrl = opts.logoLocalUrl
      ?? (opts.nav.logoSrc ? (opts.mediaUrlMap.get(opts.nav.logoSrc) ?? undefined) : undefined);
    headerBlockMarkup = buildBlockHeader(opts.nav, { logoLocalUrl, brandDark, siteUrl: opts.siteUrl });
  }

  // hasDesignCapture: true when the dual-viewport mobile canvas was captured
  // (nav is present, indicating the design pipeline ran). Gates the mobile
  // scale CSS and fit script that shrink the fixed-width mobile canvas to fit
  // the viewport width.
  const hasDesignCapture = !!(opts.nav || headerBlockMarkup);

  const files = buildBlankTheme({
    themeSlug,
    hasJs,
    headLinks: opts.headLinks,
    headerBlockMarkup,
    footerHtml: opts.footerHtml,
    hasChromeCss,
    hasDesignCapture,
  });
  files.push({ relativePath: 'site.css', content: siteCss });
  if (hasChromeCss) {
    files.push({ relativePath: 'chrome.css', content: opts.chromeCssText! });
  }
  if (hasJs) {
    files.push({ relativePath: 'site.js', content: opts.jsText! });
  }
  return files;
}
