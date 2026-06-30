import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from 'playwright';
import { captureDesign, collectBodyFragmentOnly } from './capture-design.js';
import { wrapFragment, wrapMobileFragment, scopeCss } from './design-transform.js';
import { extractCssMediaUrls } from './css-url-media.js';
import { isFirstParty } from './first-party.js';
import { isAllowlistedCdn, type ScriptInput } from './js-aggregator.js';
import type { CssAggregator } from './css-aggregator.js';
import type { JsAggregator } from './js-aggregator.js';
import { sanitizeSourceHtml } from '../streaming/html-sanitize.js';
import type { BakedLayoutMap } from './fixups.js';
import type { ExtractedNav } from './nav-extract.js';

const CDN_FONT_HOSTS = ['fonts.gstatic.com', 'fonts.googleapis.com', 'use.typekit.net'];

export function designSidecarPath(outputDir: string, slug: string, opts?: { mobile?: boolean }): string {
  const suffix = opts?.mobile ? '.mobile.fragment.html' : '.fragment.html';
  return join(outputDir, 'design', `${slug}${suffix}`);
}

export interface DesignCaptureRunOpts {
  page: Page;
  url: string;
  slug: string;
  archetype: string;              // design-captured for content archetypes (homepage/page/post/gallery/event); 'product' stays structured
  outputDir: string;
  baseUrl: string;
  includeScripts: boolean;
  cssAgg: CssAggregator;
  jsAgg?: JsAggregator;           // present iff includeScripts
  headLinks: Set<string>;         // run-level accumulator of CDN/cross-origin <link> hrefs
  /**
   * Run-level accumulators for site chrome. First non-null value detected
   * across all captured pages wins and is stored for the blank-theme build.
   * Pass null cells so callers can use a simple `{ current: null }` box.
   *
   * Extended for dual-viewport: also accumulates the desktop layout map
   * (marker → computed props) so it can be paired with the mobile map
   * collected during the mobile pass to generate responsive chrome.css.
   *
   * nav replaces headerHtml: structured nav data used to generate a native
   * WP Navigation block header. Footer bake is unchanged.
   */
  chromeAccum?: {
    /** Structured nav data (replaces headerHtml). First non-null wins. */
    nav: ExtractedNav | null;
    footerHtml: string | null;
    /** Desktop baked layout map (marker → props). Set on first successful chrome capture. */
    desktopLayoutMap: BakedLayoutMap | null;
  };
  fetchScript?: (url: string) => Promise<string | null>; // injectable for tests; defaults to global fetch
}

// Content archetypes carry the html-first design; products keep the structured
// WooCommerce import (eng-review Q1). homepage/gallery/event are content pages —
// the homepage especially MUST be captured (it's the most important page).
const DESIGN_CAPTURE_ARCHETYPES = new Set(['homepage', 'page', 'post', 'gallery', 'event']);

/** Returns the source media URLs found in this page's CSS (for media discovery),
 *  or null when design wasn't captured (non-content archetype, or capture failed → caller falls back). */
export async function captureDesignForUrl(opts: DesignCaptureRunOpts): Promise<{ cssMediaUrls: string[] } | null> {
  if (!DESIGN_CAPTURE_ARCHETYPES.has(opts.archetype)) return null;
  let cap;
  try {
    cap = await captureDesign(opts.page, opts.baseUrl, { includeScripts: opts.includeScripts });
  } catch (e) {
    console.error(`[design] capture failed for ${opts.url}: ${(e as Error).message} — falling back to extracted content`);
    return null;
  }
  // fragment → sidecar (wrapped + sanitized)
  const wrapped = wrapFragment(cap.bodyFragmentHtml, opts.slug, cap.bodyClasses);
  const sidecar = designSidecarPath(opts.outputDir, opts.slug);
  mkdirSync(dirname(sidecar), { recursive: true });
  writeFileSync(sidecar, wrapped);
  // CSS → aggregator (body→.dla-replica; scopePage=false — at-rule-safe, per eng-review)
  await opts.cssAgg.add(opts.slug, scopeCss(cap.css, opts.slug, false));
  // head links → run-level set (theme re-links them)
  for (const l of cap.headLinks) opts.headLinks.add(l);
  // Chrome accumulators: homepage nav WINS (overwrite any prior capture); other
  // archetypes only fill an empty slot (first-non-null).  This ensures the nav
  // treatment is derived from the homepage — the most representative adaptive state —
  // not from a random inner page that may show a different scroll/variant color.
  // Footer still uses the bake path (sanitized HTML).
  if (opts.chromeAccum) {
    if (cap.nav) {
      if (opts.archetype === 'homepage') {
        // Homepage always wins — overwrite whatever was captured before.
        opts.chromeAccum.nav = cap.nav;
      } else if (opts.chromeAccum.nav === null) {
        // Non-homepage: fill empty slot only.
        opts.chromeAccum.nav = cap.nav;
      }
    }
    if (opts.chromeAccum.footerHtml === null && cap.footerHtml) {
      opts.chromeAccum.footerHtml = sanitizeSourceHtml(cap.footerHtml);
    }
    // Accumulate desktop layout map (first non-null wins, same as nav).
    if (opts.chromeAccum.desktopLayoutMap === null && cap.desktopLayoutMap) {
      opts.chromeAccum.desktopLayoutMap = cap.desktopLayoutMap;
    }
  }
  // scripts → aggregator (fetch external first-party/allowlisted bodies; inline already have content)
  if (opts.includeScripts && opts.jsAgg) {
    const fetcher = opts.fetchScript ?? (async (u: string) => {
      try { const r = await fetch(u); return r.ok ? await r.text() : null; } catch { return null; }
    });
    const inputs: ScriptInput[] = [];
    for (const s of cap.scripts) {
      if (s.inline !== undefined) { inputs.push({ content: s.inline }); continue; }
      if (s.src && (isFirstParty(s.src, opts.baseUrl) || isAllowlistedCdn(s.src))) {
        const body = await fetcher(s.src);
        if (body) inputs.push({ src: s.src, content: body });
      }
    }
    await opts.jsAgg.add(opts.slug, inputs);
  }
  // Include the logo URL in the media discovery set so it flows through
  // the same download + upload pipeline as CSS background images.
  // The rewritten local URL is then available in assembleDesignTheme via
  // mediaUrlMap.get(nav.logoSrc).
  const cssMediaUrls = extractCssMediaUrls(cap.css, CDN_FONT_HOSTS);
  if (cap.nav?.logoSrc && !cssMediaUrls.includes(cap.nav.logoSrc)) {
    cssMediaUrls.push(cap.nav.logoSrc);
  }
  return { cssMediaUrls };
}

export interface MobileBodyCaptureOpts {
  page: Page;
  /** slug derived from the URL (same slugify(url) convention as the desktop sidecar) */
  slug: string;
  outputDir: string;
  /** CSS aggregator — mobile pass collects stylesheets to merge with desktop CSS.
   * Desktop-captured same-origin stylesheets already include @media blocks for all
   * viewports (cssRules include media blocks regardless of viewport width), so the
   * desktop pass covers mobile rules. The mobile stylesheet merge is a safety net for
   * platforms that load viewport-specific stylesheets dynamically. The CssAggregator
   * dedupes by SHA-256 hash, so identical content added twice results in one entry. */
  cssAgg: CssAggregator;
}

/**
 * Capture the body fragment at the MOBILE viewport (chrome removed) and write
 * the mobile sidecar `design/<slug>.mobile.fragment.html`.
 *
 * Only the body fragment is captured — the chrome removal logic (header/footer
 * detection + safeRemove) is applied via `collectBodyFragmentOnly`, which reuses
 * the same heuristic as `collectBodyAndChrome` but skips the nav/footer extraction
 * and layout-map collection. The mobile sidecar is body-only; the generated block
 * header and baked footer are shared across viewports in the theme template.
 *
 * CSS safety net: stylesheets are also collected at mobile and merged into the
 * aggregator. Because same-origin CSS captured at desktop already includes all
 * @media blocks (cssRules are viewport-independent), this is mostly a safety net
 * for platforms that load mobile-specific stylesheets via JS. Deduplication is
 * handled by CssAggregator (hash-keyed map).
 *
 * Returns true when the sidecar was written successfully, false on failure (non-fatal).
 */
export async function captureMobileBodyFragment(opts: MobileBodyCaptureOpts): Promise<boolean> {
  try {
    const { bodyFragmentHtml, bodyClasses, css } = await collectBodyFragmentOnly(opts.page);
    if (!bodyFragmentHtml || bodyFragmentHtml.trim().length < 64) {
      // Suspiciously short — page likely didn't render at mobile. Skip silently.
      return false;
    }
    const wrapped = wrapMobileFragment(bodyFragmentHtml, opts.slug, bodyClasses);
    const sidecar = designSidecarPath(opts.outputDir, opts.slug, { mobile: true });
    mkdirSync(dirname(sidecar), { recursive: true });
    writeFileSync(sidecar, wrapped);
    // CSS safety net: merge mobile-viewport stylesheets (deduped by aggregator)
    if (css.trim()) {
      await opts.cssAgg.add(`${opts.slug}:mobile`, scopeCss(css, opts.slug, false));
    }
    return true;
  } catch (err) {
    console.error(`[design] mobile body capture failed for slug "${opts.slug}": ${(err as Error).message}`);
    return false;
  }
}
