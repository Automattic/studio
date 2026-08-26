import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { slugify } from '../url/index.js';
import { connectBrowser } from '../browser-kit/index.js';
import { classifyUrl, type UrlType } from '../extraction/sitemap.js';
import {
  DEFAULT_VIEWPORTS,
  SCREENSHOT_DEVICE_SCALE_FACTOR,
  type ScreenshotOpts,
  type ScreenshotResult,
  type Viewport,
} from './types.js';
import { validateOutputDir, planArtifacts, type ArtifactPlan } from './output-layout.js';
import { enforceSameOrigin } from './same-origin.js';
import { ManifestQueue, type ManifestEntry, type FailureEntry } from './manifest-queue.js';
import { waitForStable, triggerLazyLoad, dismissOverlays } from './page-helpers.js';
import { applyCaptureRemovals } from './apply-removals.js';
import { countBodyTags, isStackingArtifact } from './document-integrity.js';
import { analyzePage } from './site-analysis.js';
import { SiteAnalysisAggregator } from './aggregator.js';
import { CssAggregator } from './css-aggregator.js';
import { JsAggregator } from './js-aggregator.js';
import { captureDesignForUrl, captureMobileBodyFragment } from './design-capture-runner.js';
import { collectMobileChromeLayout } from './dom-capture.js';
import { generateChromeCss, type BakedLayoutMap } from './fixups.js';
import type { ExtractedNav } from './nav-extract.js';
import { extractFull } from '../replicate/section-extract.js';
import { SectionSpecsStore } from '../replicate/section-specs-store.js';
import { captureChromeFidelity } from './capture-chrome-fidelity.js';
import { CHROME_AUDIT_PROPERTIES } from '../replicate/chrome-audit-types.js';

/**
 * Scroll offset multiplier for the scrolled-state screenshot: we scroll to
 * `viewport.height * SCROLL_OFFSET_RATIO` and clip a viewport-sized region
 * starting at that same Y. Both sites (the scroll and the clip origin) must
 * stay in lockstep; changing one changes the other.
 */
const SCROLL_OFFSET_RATIO = 1.5;
const ANALYSIS_SAMPLE_LIMIT = 1;

/**
 * Per-URL capture pipeline:
 *
 *   URL
 *    │
 *    ▼
 *   classifyUrl/slugify  ──▶  manifest.claimSlug  ──▶  planArtifacts
 *    │                                                 │
 *    │                         ┌───────── needsLoad? ──┤
 *    │                         ▼ no                    ▼ yes
 *    │                   skipped++                   for each viewport:
 *    │                                                 newContext(viewport)
 *    │                                                   │
 *    │                                                   ▼
 *    │                                                 newPage
 *    │                                                   │
 *    │                                                   ▼
 *    │                                                 goto ─── 4xx/throw ──▶ failures[goto]
 *    │                                                   │
 *    │                                                   ▼
 *    │                                                 waitForStable
 *    │                                                   │
 *    │                                                   ▼
 *    │                                                 dismissOverlays (early)
 *    │                                                   │
 *    │                                                   ▼
 *    │                                                 triggerLazyLoad
 *    │                                                   │
 *    │                                                   ▼
 *    │                                                 dismissOverlays (late)
 *    │                                                   │
 *    │                            desktop only          ▼
 *    │                         ┌────────── plan.captureHtml ──▶ page.content → html/<slug>.html
 *    │                         │                        │
 *    │                         │                        ▼
 *    │                         │                      screenshot(fullPage)     ──▶ screenshots/<vp>/<slug>.png
 *    │                         │                        │
 *    │                         │                        ▼
 *    │                         │                      scrollTo(vh*1.5) + clip  ──▶ screenshots/<vp>/<slug>.scrolled.png
 *    │                         │                        │
 *    │                         │         desktop only   ▼
 *    │                         └──────────── analyzePage ──▶ entry.metadata
 *    │                                                   │
 *    │                                                   ▼
 *    │                                                 context.close() (finally)
 *    │                                                   │
 *    ▼                                                   ▼
 *   manifest.updateEntry + recordFailure (batched)
 *
 * Browser restart runs at BATCH BOUNDARIES only — never mid-batch.
 */

/** Race a screenshot promise against a hard timeout. Mirrors withEvaluateTimeout. */
async function withScreenshotTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`screenshot timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Best-effort log forwarder — never throws into the capture loop. */
function sendLog(server: Server | undefined, message: string): void {
  if (!server) return;
  try {
    server.sendLoggingMessage({ level: 'info', data: message });
  } catch {
    /* logging transport not available */
  }
}

interface DesignCaptureContext {
  cssAgg: CssAggregator;
  jsAgg?: JsAggregator;
  headLinks: Set<string>;
  cssMediaUrls: Set<string>;
  baseUrl: string;
  includeScripts: boolean;
  /** Run-level accumulator: first non-null value wins. */
  chromeAccum: {
    /** Structured nav data extracted from the header (replaces headerHtml). */
    nav: ExtractedNav | null;
    footerHtml: string | null;
    /** Desktop baked layout map (marker → props). Set on first successful chrome capture. */
    desktopLayoutMap: BakedLayoutMap | null;
    /** Mobile baked layout map (marker → props). Collected during the mobile viewport pass. */
    mobileLayoutMap: BakedLayoutMap | null;
  };
}

interface CapturePerViewportArgs {
  page: Page;
  removeSelectors?: string[];
  prepareCapture?: (page: import('playwright').Page, ctx: import('../../adapters/page-actions.js').CaptureContext) => Promise<void>;
  viewport: Viewport;
  plan: ArtifactPlan;
  url: string;
  slug: string;
  archetype: string;
  settleMs: number;
  screenshotTimeoutMs: number;
  evaluateTimeoutMs: number;
  failures: FailureEntry[];
  entry: ManifestEntry;
  aggregator: SiteAnalysisAggregator;
  shouldAnalyze: boolean;
  designCtx?: DesignCaptureContext;  // present when design capture is enabled
  outputDir: string;
  /** Accumulates {wix-media-id → mobile-variant URL} from the mobile viewport, for
   *  responsive-image carry. Mutated in place; written once after all captures. */
  responsiveImages: Record<string, string>;
  /** Accumulates {slug → mobile-DOM scrollHeight} from the mobile viewport, for the
   *  alt path's iframe mobile-DOM carry. Mutated in place; written once at run end. */
  mobileHeights: Record<string, number>;
}

/** Sleep helper for navigation backoff. */
function navSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backoff before retrying a throttled / transiently-failed navigation. Honors a
 * numeric `Retry-After` (seconds) when the throttler supplies one; otherwise
 * exponential (1s, 2s, 4s…), capped at 15s.
 */
function navBackoffMs(attempt: number, retryAfter?: string): number {
  const cap = 15_000;
  const raSec = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(raSec) && raSec >= 0) return Math.min(raSec * 1000, cap);
  return Math.min(1000 * 2 ** (attempt - 1), cap);
}

async function capturePerViewport(args: CapturePerViewportArgs): Promise<void> {
  const {
    page, viewport, plan, url, slug, archetype,
    settleMs, screenshotTimeoutMs, evaluateTimeoutMs,
    failures, entry, aggregator, shouldAnalyze,
    designCtx, outputDir, responsiveImages, mobileHeights,
  } = args;
  const now = () => new Date().toISOString();
  const isDesktop = viewport.id === 'desktop';

  // --- navigation (with 429/503 backoff) ------------------------------------
  // Shopify and other CDNs rate-limit aggressive concurrent capture with HTTP 429
  // (and transient 503s). Without backoff one throttle cascades into wholesale
  // failure (see DISCOVERIES 2026-06-04 — getsnooz's 168-op cascade). Retry the
  // retryable statuses + transient nav errors, honoring Retry-After, before
  // recording the failure. Non-retryable 4xx fail immediately.
  const RETRYABLE_STATUS = new Set([429, 503]);
  const MAX_NAV_ATTEMPTS = 4;
  let navigated = false;
  for (let attempt = 1; attempt <= MAX_NAV_ATTEMPTS; attempt++) {
    try {
      const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      const status = response ? response.status() : 0;
      if (status >= 400) {
        if (RETRYABLE_STATUS.has(status) && attempt < MAX_NAV_ATTEMPTS) {
          await navSleep(navBackoffMs(attempt, response?.headers()['retry-after']));
          continue;
        }
        failures.push({ url, viewport: viewport.id, stage: 'goto', error: `HTTP ${status}`, timestamp: now(), attempt });
        return;
      }
      navigated = true;
      break;
    } catch (err) {
      if (attempt < MAX_NAV_ATTEMPTS) {
        await navSleep(navBackoffMs(attempt));
        continue;
      }
      failures.push({ url, viewport: viewport.id, stage: 'goto', error: err instanceof Error ? err.message : String(err), timestamp: now(), attempt });
      return;
    }
  }
  if (!navigated) return;

  // --- settle, dismiss overlays, lazy load ----------------------------------
  await waitForStable(page, settleMs);
  // Dismiss takeover modals / consent banners BEFORE lazy-load (a modal's
  // scroll-lock would defeat the scroll-through) and again AFTER (scrolling can
  // trigger exit-intent / scroll-depth popups). Best-effort: never fails capture.
  const dismissedEarly = await dismissOverlays(page);
  await triggerLazyLoad(page);
  const dismissedLate = await dismissOverlays(page);
  const dismissedHere = [...dismissedEarly, ...dismissedLate];
  if (dismissedHere.length > 0) {
    // Accumulates within one run (desktop + mobile both append); on a resumed
    // re-capture, updateEntry's shallow spread REPLACES the prior dismissed[] with
    // this run's — intended (we want the most-recent capture's dismissals, not a union).
    entry.dismissed = [...(entry.dismissed ?? []), ...dismissedHere];
  }

  // Seam 1: deterministic adapter-declared removals on the settled page, so they
  // pollute neither screenshot, carried HTML, mobile carry, nor SectionSpec.
  await applyCaptureRemovals(page, {
    removeSelectors: args.removeSelectors,
    prepare: args.prepareCapture,
    ctx: { url, viewport: isDesktop ? 'desktop' : 'mobile' },
  });

  // --- responsive image map (mobile only) -----------------------------------
  // At the mobile viewport, Wix's <wow-image> JS has swapped each image to its
  // mobile-cropped CDN variant. Record {media-id → mobile URL} so the alt
  // reconstruct can serve the mobile crop via <picture> (no JS) on narrow
  // viewports. Best-effort: a read failure must not fail the screenshot.
  if (!isDesktop) {
    try {
      const map = await page.evaluate(() => {
        const out: Record<string, string> = {};
        for (const im of Array.from(document.querySelectorAll('img'))) {
          const url = (im as HTMLImageElement).currentSrc || (im as HTMLImageElement).src || '';
          const idm = /([a-z0-9]{4,12}_[a-z0-9]{24,48})/i.exec(url);
          // Only Wix CDN fills (the JS-swapped responsive variants) are useful.
          if (idm && /static\.wixstatic\.com\/.+\/fill\/w_\d+,h_\d+/.test(url)) out[idm[1].toLowerCase()] = url;
        }
        return out;
      });
      Object.assign(responsiveImages, map);
    } catch {
      /* best-effort — never block capture on the responsive-image probe */
    }
  }

  // --- html (desktop only) --------------------------------------------------
  if (isDesktop && plan.captureHtml) {
    try {
      const html = await page.content();
      // Refuse to persist a corrupted capture: if the live DOM serialized more
      // than one document (e.g. an AJAX page-loader prefetched and nested whole
      // pages into the body), every section is duplicated + truncated downstream.
      // Record it as a content failure and skip the write rather than poison the
      // reference HTML that comparison/design tooling correlates by URL.
      if (isStackingArtifact(html)) {
        failures.push({
          url,
          viewport: viewport.id,
          stage: 'content',
          error: `nested document capture (${countBodyTags(html)} <body> in one page); HTML not persisted`,
          timestamp: now(),
          attempt: 1,
        });
      } else {
        mkdirSync(dirname(plan.paths.html), { recursive: true });
        writeFileSync(plan.paths.html, html);
        entry.html = `html/${slug}.html`;
      }
    } catch (err) {
      failures.push({
        url,
        viewport: viewport.id,
        stage: 'content',
        error: err instanceof Error ? err.message : String(err),
        timestamp: now(),
        attempt: 1,
      });
    }
  }

  // --- mobile-DOM carry (mobile only) ---------------------------------------
  // On the mobile pass, the mobile UA + isMobile emulation make JS builders like
  // Wix serve their SEPARATE ~320px mobile DOM (classic/adaptive sites; desktop-DOM
  // sites are identical, harmless). Persist that full document (scripts stripped, so
  // it renders statically) + its height to html-mobile/. The alt reconstruct carries
  // it in a viewport-isolated iframe to reproduce the mobile layout the desktop DOM
  // can't reflow to. Best-effort: a miss leaves the page desktop-only.
  if (!isDesktop && plan.captureMobileHtml) {
    try {
      const mhtml = (await page.content()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      if (!isStackingArtifact(mhtml)) {
        mkdirSync(dirname(plan.paths.htmlMobile), { recursive: true });
        writeFileSync(plan.paths.htmlMobile, mhtml);
        mobileHeights[slug] = await page.evaluate(() => document.documentElement.scrollHeight);
      }
    } catch {
      /* best-effort — desktop-only carry for this page on failure */
    }
  }

  // --- section specs (desktop only) -----------------------------------------
  // Capture extractFull from the SAME settled page so reconstruction can read
  // the specs from disk instead of re-running Playwright. Desktop 1440×900
  // matches the live-extract basis, so geometry/fullBleed agree. STRICTLY
  // best-effort: a spec-capture miss must NOT mark the (successful) screenshot
  // as failed — reconstruction falls back to a live extract when the cache is
  // absent. So this never touches `failures[]`; it just leaves `entry.sections`
  // unset.
  if (isDesktop && plan.captureSections) {
    try {
      const { specs, landmarks } = await extractFull(page, {}, evaluateTimeoutMs);
      SectionSpecsStore.load(outputDir).set(url, specs, landmarks, { width: viewport.width, height: viewport.height });
      // Point at the store's ACTUAL path (keyed by slugify(url)); the screenshot
      // `slug` may be a collision-deduped variant (`-2`), which the store doesn't use.
      entry.sections = `sections/${slugify(url)}.json`;
    } catch {
      /* best-effort — reconstruction live-extracts when the spec cache is missing */
    }
  }

  // --- fullpage screenshot --------------------------------------------------
  if (plan.captureFullpage) {
    try {
      const buf = await withScreenshotTimeout(
        page.screenshot({ fullPage: true, type: 'png' }),
        screenshotTimeoutMs,
      );
      mkdirSync(dirname(plan.paths.fullpage), { recursive: true });
      writeFileSync(plan.paths.fullpage, buf);
      const rel = `screenshots/${viewport.id}/${slug}.png`;
      if (isDesktop) entry.desktop = rel;
      else entry.mobile = rel;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({
        url,
        viewport: viewport.id,
        stage: /screenshot timeout/.test(msg) ? 'screenshot-timeout' : 'screenshot-fullpage',
        error: msg,
        timestamp: now(),
        attempt: 1,
      });
    }
  }

  // --- scrolled screenshot --------------------------------------------------
  if (plan.captureScrolled) {
    try {
      const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const scrollY = viewport.height * SCROLL_OFFSET_RATIO;
      if (docHeight < scrollY + viewport.height) {
        // Page is shorter than scroll-offset + viewport. No distinct scrolled
        // state to capture. Skip silently (not a failure).
      } else {
        // Explicit-instant: css scroll-behavior:smooth would GLIDE here and
        // the snap would clip mid-glide at the wrong scroll origin (see
        // page-helpers triggerLazyLoad for the full smooth-scroll rationale).
        await page.evaluate((y: number) => window.scrollTo({ top: y, left: 0, behavior: 'instant' }), scrollY);
        // Plain viewport-sized screenshot of the now-scrolled page.
        // fullPage:false captures the current viewport — no clip needed.
        // (A clip would have to be inside the 0..viewport.height image, not at
        // the page's absolute scroll position.)
        const buf = await withScreenshotTimeout(
          page.screenshot({ fullPage: false, type: 'png' }),
          screenshotTimeoutMs,
        );
        mkdirSync(dirname(plan.paths.scrolled), { recursive: true });
        writeFileSync(plan.paths.scrolled, buf);
        const rel = `screenshots/${viewport.id}/${slug}.scrolled.png`;
        if (isDesktop) entry.desktopScrolled = rel;
        else entry.mobileScrolled = rel;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({
        url,
        viewport: viewport.id,
        stage: /screenshot timeout/.test(msg) ? 'screenshot-timeout' : 'screenshot-scrolled',
        error: msg,
        timestamp: now(),
        attempt: 1,
      });
    }
  }

  // --- desktop-only site analysis -------------------------------------------
  if (isDesktop && shouldAnalyze) {
    try {
      const analysis = await analyzePage(page, evaluateTimeoutMs);
      entry.metadata = analysis.metadata;
      aggregator.add(url, analysis);
    } catch (err) {
      failures.push({
        url,
        viewport: viewport.id,
        stage: 'evaluate',
        error: err instanceof Error ? err.message : String(err),
        timestamp: now(),
        attempt: 1,
      });
    }
    // Best-effort: capture source chrome computed-style fingerprint for later
    // carry-vs-source fidelity audits. A failure here MUST NOT break the
    // screenshot run — the try/catch ensures this is never propagated.
    try {
      // Write into the screenshots dir — where the audit driver reads it from
      // (readChromeFidelity(join(outputDir, 'screenshots'))). Must stay in sync.
      const n = await captureChromeFidelity(page, url, join(outputDir, 'screenshots'), CHROME_AUDIT_PROPERTIES);
      console.info(`[chrome-fidelity] ${url} -> ${n} elements`);
    } catch (err) {
      console.error(`[chrome-fidelity] skipped ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- desktop-only design capture (page/post archetypes only) ---------------
  if (isDesktop && designCtx) {
    try {
      // The design sidecar slug MUST match the WXR item slug used by adapters
      // (item.slug = slugify(url)) so flushPendingImports can find the sidecar
      // by entry.slug. The manifest `slug` may have a collision suffix (-2, -3)
      // when multiple URLs share the same base, so we derive the design sidecar
      // slug directly from the URL — same derivation the adapters use.
      const designSlug = slugify(url);
      const designResult = await captureDesignForUrl({
        page,
        url,
        slug: designSlug,
        archetype,
        outputDir,
        baseUrl: designCtx.baseUrl,
        includeScripts: designCtx.includeScripts,
        cssAgg: designCtx.cssAgg,
        jsAgg: designCtx.jsAgg,
        headLinks: designCtx.headLinks,
        chromeAccum: designCtx.chromeAccum,
      });
      if (designResult) {
        for (const u of designResult.cssMediaUrls) designCtx.cssMediaUrls.add(u);
      }
    } catch (err) {
      // Non-fatal — design capture failure does not fail the screenshot run
      // (captureDesignForUrl already catches + logs internally; this guard
      // catches any unexpected throw from the orchestration layer itself)
      console.error(`[design] unexpected error for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- mobile-only chrome layout collection (dual-viewport bake) ------------
  // Collect the mobile computed layout for the chrome using the marker classes
  // assigned during the desktop pass. Only runs once — after the desktop pass
  // has established the chromeAccum with a desktopLayoutMap AND the mobile
  // layout hasn't been collected yet.
  //
  // Limitation: if Wix (or similar) renders a different chrome DOM at mobile
  // (hamburger menu), collectMobileChromeLayout returns null (no markers found)
  // and mobileLayoutMap stays null. generateChromeCss then emits desktop-only
  // rules. The static hamburger is not interactive — known limitation.
  if (!isDesktop && designCtx && designCtx.chromeAccum.desktopLayoutMap !== null && designCtx.chromeAccum.mobileLayoutMap === null) {
    try {
      const mobileMap = await collectMobileChromeLayout(page);
      if (mobileMap && Object.keys(mobileMap).length > 0) {
        designCtx.chromeAccum.mobileLayoutMap = mobileMap;
      }
    } catch (err) {
      // Non-fatal — mobile chrome layout collection failure degrades to desktop-only CSS.
      console.error(`[design] mobile chrome layout collection failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- mobile-only body fragment capture (dual-viewport page content) --------
  // Capture the chrome-stripped body fragment at the mobile viewport and write
  // design/<slug>.mobile.fragment.html. This is the counterpart to the desktop
  // sidecar written by captureDesignForUrl during the desktop pass. Both sidecars
  // are consumed by flushPendingImports to build the viewport-toggle contentOverride.
  //
  // Only run when:
  //   - this is the mobile viewport pass
  //   - design capture is active (designCtx present)
  //   - the archetype is a design-captured content type (same gate as desktop)
  //
  // The check against `archetype` uses the same DESIGN_CAPTURE_ARCHETYPES set logic.
  // We re-derive the slug the same way the desktop pass does: slugify(url).
  if (!isDesktop && designCtx) {
    const DESIGN_CAPTURE_ARCHETYPES = new Set(['homepage', 'page', 'post', 'gallery', 'event']);
    if (DESIGN_CAPTURE_ARCHETYPES.has(archetype)) {
      try {
        const designSlug = (await import('../url/index.js')).slugify(url);
        await captureMobileBodyFragment({
          page,
          slug: designSlug,
          outputDir,
          cssAgg: designCtx.cssAgg,
        });
      } catch (err) {
        // Non-fatal — mobile body capture failure means only desktop fragment is available.
        // flushPendingImports falls back to desktop-only wrapping.
        console.error(`[design] mobile body fragment capture failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

/**
 * Common homepage path slugs used by builders that DON'T serve the home page at
 * the bare root (e.g. a sitemap whose only "home" entry is `/home`). Matched
 * case-insensitively against the exact pathname (trailing slash tolerated).
 */
const HOMEPAGE_SLUGS = new Set(['/home', '/index', '/home-page', '/homepage']);

/**
 * Pick the URL that represents the site's home page. Prefers a URL that
 * `classifyUrl` recognizes as 'homepage' (path `/` or empty). When none exists
 * — some sites have no bare-root entry and serve home at `/home` — fall back to
 * the first URL whose path is a well-known homepage slug, and only then to
 * `urls[0]`. Returns null for an empty list.
 */
export function getHomepageUrl(urls: string[]): string | null {
  if (urls.length === 0) return null;
  const classified = urls.find((url) => classifyUrl(url) === 'homepage');
  if (classified) return classified;
  const slugMatch = urls.find((url) => {
    let path: string;
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch {
      path = url.toLowerCase();
    }
    return HOMEPAGE_SLUGS.has(path.replace(/\/$/, '') || '/');
  });
  return slugMatch ?? urls[0];
}

/**
 * Reduce `urls` to at most `limit` entries. When the truncation would drop
 * pages AND the filtered set spans more than one `UrlType`, sample EVENLY
 * across the present types (round-robin in stable first-seen order) instead of
 * taking the first N — a small sample of a sitemap that happens to lead with
 * dozens of one kind (e.g. news posts) would otherwise miss the design-defining
 * info pages entirely. The homepage URL is always included even if the
 * round-robin would have dropped it. When `limit >= count` or only one type is
 * present, the original order is preserved (still guaranteeing homepage
 * inclusion).
 */
function sampleUrlsByType(urls: string[], limit: number): string[] {
  if (urls.length <= limit) return urls;

  const homepage = getHomepageUrl(urls);

  // Group URLs by type, preserving first-seen type order and per-type order.
  const buckets = new Map<UrlType, string[]>();
  for (const url of urls) {
    const type = classifyUrl(url);
    const bucket = buckets.get(type);
    if (bucket) bucket.push(url);
    else buckets.set(type, [url]);
  }

  let selected: string[];
  if (buckets.size <= 1) {
    // Single type — first-N is already representative.
    selected = urls.slice(0, limit);
  } else {
    // Round-robin across the type buckets until we hit the limit.
    const order = [...buckets.keys()];
    const out: string[] = [];
    let added = true;
    while (out.length < limit && added) {
      added = false;
      for (const type of order) {
        if (out.length >= limit) break;
        const bucket = buckets.get(type)!;
        if (bucket.length > 0) {
          out.push(bucket.shift()!);
          added = true;
        }
      }
    }
    selected = out;
  }

  // Guarantee the homepage is present even if the sample dropped it. Swap it in
  // for the last slot rather than overflow `limit`.
  if (homepage && !selected.includes(homepage)) {
    if (selected.length < limit) selected.push(homepage);
    else selected[selected.length - 1] = homepage;
  }
  return selected;
}

function selectRepresentativeAnalysisUrl(urls: string[]): string | null {
  if (urls.length === 0 || ANALYSIS_SAMPLE_LIMIT <= 0) return null;
  return getHomepageUrl(urls);
}

function hasSingleUrlAggregate(outputDir: string): boolean {
  const files = ['palette.json', 'typography.json', 'breakpoints.json'];
  for (const file of files) {
    try {
      const path = join(outputDir, file);
      if (!existsSync(path)) return false;
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { sampledUrls?: unknown };
      if (parsed.sampledUrls !== ANALYSIS_SAMPLE_LIMIT) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Capture per-viewport screenshots + html + site metadata for a list of URLs.
 * Resumable via manifest.json / failures.json; same-origin enforced; output
 * directory validated against path traversal.
 */
export async function captureScreenshots(opts: ScreenshotOpts): Promise<ScreenshotResult> {
  const startTime = Date.now();

  // --- validate + filter ----------------------------------------------------
  validateOutputDir(opts.outputDir);

  const viewports = opts.viewports ?? DEFAULT_VIEWPORTS;
  const rawConcurrency = opts.concurrency ?? 6;
  const concurrency = Math.max(1, Math.min(10, rawConcurrency));
  const browserRestartEvery = opts.browserRestartEvery ?? 100;
  const screenshotTimeoutMs = opts.screenshotTimeoutMs ?? 30_000;
  const evaluateTimeoutMs = opts.evaluateTimeoutMs ?? 5_000;
  const settleMs = opts.settleMs ?? 1_000;
  const force = opts.force ?? false;
  const server = opts.server;

  let urls = opts.urls.slice();
  if (opts.types && opts.types.length > 0) {
    const allowed = new Set(opts.types);
    urls = urls.filter((u) => allowed.has(classifyUrl(u)));
  }
  if (typeof opts.limit === 'number' && opts.limit >= 0) {
    urls = sampleUrlsByType(urls, opts.limit);
  }
  const representativeAnalysisUrl = selectRepresentativeAnalysisUrl(urls);

  // --- same-origin ---------------------------------------------------------
  // Normalize `primaryUrl` to include a protocol — callers sometimes pass
  // the bare hostname the user typed (e.g. `maus.com`), matching the
  // forgiving convention in fetchSitemap.
  const primaryRef = opts.primaryUrl
    ? (opts.primaryUrl.includes('://') ? opts.primaryUrl : `https://${opts.primaryUrl}`)
    : null;
  enforceSameOrigin(primaryRef, urls);

  // --- output layout -------------------------------------------------------
  mkdirSync(join(opts.outputDir, 'screenshots', 'desktop'), { recursive: true });
  mkdirSync(join(opts.outputDir, 'screenshots', 'mobile'), { recursive: true });
  mkdirSync(join(opts.outputDir, 'html'), { recursive: true });

  // --- manifest -----------------------------------------------------------
  const manifestPath = join(opts.outputDir, 'screenshots', 'manifest.json');
  const manifest = new ManifestQueue(manifestPath);
  await manifest.init();
  if (force) await manifest.resetFailures();

  // Site-wide {wix-media-id → mobile-variant URL}, accumulated from each page's
  // mobile pass, written once at the end for the alt reconstruct to consume.
  const responsiveImages: Record<string, string> = existsSync(
    join(opts.outputDir, 'responsive-images.json'),
  )
    ? (JSON.parse(readFileSync(join(opts.outputDir, 'responsive-images.json'), 'utf8')) as Record<string, string>)
    : {};

  // {slug → mobile-DOM scrollHeight} for the alt path's iframe mobile-DOM carry.
  // Resume merges with a prior run (like responsiveImages); written at run end.
  const mobileHeights: Record<string, number> = existsSync(
    join(opts.outputDir, 'html-mobile', 'heights.json'),
  )
    ? (JSON.parse(readFileSync(join(opts.outputDir, 'html-mobile', 'heights.json'), 'utf8')) as Record<string, number>)
    : {};

  // --- site-analysis aggregator -------------------------------------------
  // Collects palette/typography/breakpoints for one representative URL
  // (homepage when present). The design-foundation fast path uses this as
  // directional evidence; full-page screenshots still get captured for
  // later per-page/template work.
  const aggregator = new SiteAnalysisAggregator();
  const aggregateAlreadyFresh = !force && hasSingleUrlAggregate(opts.outputDir);

  // --- design capture aggregators (run-level) --------------------------------
  // Constructed once per run; populated during the per-URL capture pass.
  // Only active when opts.captureDesign is true.
  const includeScripts = opts.includeScripts ?? false;
  // Derive a stable base URL from the URL list for first-party checks.
  // Fall back to a bare origin of the first URL if primaryUrl isn't provided.
  const baseUrl = opts.primaryUrl
    ? (opts.primaryUrl.includes('://') ? opts.primaryUrl : `https://${opts.primaryUrl}`)
    : (() => {
        try { const u = new URL(urls[0] ?? 'https://localhost'); return `${u.protocol}//${u.host}`; } catch { return 'https://localhost'; }
      })();
  const cssAgg = new CssAggregator();
  const jsAgg = includeScripts ? new JsAggregator(baseUrl) : undefined;
  const headLinks = new Set<string>();
  const cssMediaUrls = new Set<string>();
  if (opts.captureDesign) {
    cssAgg.init(opts.outputDir);
  }
  const chromeAccum = {
    nav: null as ExtractedNav | null,
    footerHtml: null as string | null,
    desktopLayoutMap: null as BakedLayoutMap | null,
    mobileLayoutMap: null as BakedLayoutMap | null,
  };
  const designCtx: DesignCaptureContext | undefined = opts.captureDesign
    ? { cssAgg, jsAgg, headLinks, cssMediaUrls, baseUrl, includeScripts, chromeAccum }
    : undefined;

  // --- browser -----------------------------------------------------------
  let browser: Browser = await connectBrowser({ cdpPort: opts.cdpPort }) as unknown as Browser;
  let browserRestarts = 0;
  let urlsSinceRestart = 0;

  let captured = 0;
  let skipped = 0;
  let completed = 0;
  const totalUrls = urls.length;
  const allFailures: FailureEntry[] = [];

  const capturedAt = () => new Date().toISOString();

  const processUrl = async (url: string): Promise<void> => {
    const base = slugify(url);
    // On resume the URL may already have an entry — reuse its slug so the
    // existing-artifact check hits the same files we wrote last run. Only
    // claim a new slug for first-time URLs.
    const existing = manifest.getEntry(url);
    const slug = existing ? existing.slug : await manifest.claimSlug(base);
    const plan = planArtifacts({ slug, outputDir: opts.outputDir, force });
    const shouldAnalyzeUrl = url === representativeAnalysisUrl && !aggregateAlreadyFresh;
    const desktopPlan = shouldAnalyzeUrl
      ? { ...plan.desktop, needsLoad: true }
      : plan.desktop;
    const effectivePlan = { ...plan, desktop: desktopPlan };

    if (!effectivePlan.desktop.needsLoad && !effectivePlan.mobile.needsLoad) {
      skipped++;
      sendLog(server, `[skip] ${url} (artifacts exist)`);
      completed++;
      opts.onProgress?.(completed, totalUrls, url);
      return;
    }

    const entry: ManifestEntry = { slug, capturedAt: capturedAt() };
    const urlFailures: FailureEntry[] = [];

    for (const viewport of viewports) {
      const vpPlan = viewport.id === 'desktop' ? effectivePlan.desktop : effectivePlan.mobile;
      if (!vpPlan.needsLoad) continue;

      let context: BrowserContext | undefined;
      try {
        // deviceScaleFactor < 1 reduces the OUTPUT pixel count of every
        // screenshot while keeping the rendered layout identical to a
        // standard desktop session — the browser still does its layout
        // pass at the logical viewport (so CSS media queries hit their
        // real desktop branch), but emits a smaller PNG. Mobile stays at
        // scale 1 because its viewport is already small enough that
        // further reduction loses layout detail. See types.ts for the
        // rationale.
        // The mobile viewport emulates a real mobile device (mobile UA + isMobile
        // + touch), not just a narrow desktop window. JS builders like Wix decide
        // desktop-vs-mobile layout from the user agent / device, NOT viewport
        // width alone — without emulation Wix serves its desktop DOM at 390px and
        // the captured "mobile" fragment never reflows. Chromium-only flags.
        const isMobileVp = viewport.id !== 'desktop';
        context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.id === 'desktop' ? SCREENSHOT_DEVICE_SCALE_FACTOR : 1,
          ignoreHTTPSErrors: true,
          ...(isMobileVp
            ? {
                isMobile: true,
                hasTouch: true,
                userAgent:
                  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
              }
            : {}),
        });
        // tsx/esbuild's keepNames transform wraps named const arrows with
        // `__name(fn, 'name')` calls; that helper doesn't exist in the browser
        // context. Polyfill as a no-op so our evaluate() closures can run.
        // String-form init script bypasses tsx transformation entirely.
        await context.addInitScript(`
          if (typeof globalThis.__name === 'undefined') {
            globalThis.__name = function (fn) { return fn; };
          }
        `);
        const page = await context.newPage();
        await capturePerViewport({
          page,
          viewport,
          plan: vpPlan,
          url,
          slug,
          archetype: classifyUrl(url),
          settleMs,
          screenshotTimeoutMs,
          evaluateTimeoutMs,
          failures: urlFailures,
          entry,
          aggregator,
          shouldAnalyze: shouldAnalyzeUrl,
          designCtx,
          outputDir: opts.outputDir,
          responsiveImages,
          mobileHeights,
          removeSelectors: opts.removeSelectors,
          prepareCapture: opts.prepareCapture,
        });
      } catch (err) {
        urlFailures.push({
          url,
          viewport: viewport.id,
          stage: 'goto',
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
          attempt: 1,
        });
      } finally {
        if (context) {
          try { await context.close(); } catch { /* best-effort */ }
        }
      }
    }

    for (const f of urlFailures) {
      await manifest.recordFailure(f);
      allFailures.push(f);
    }
    await manifest.updateEntry(url, entry);

    if (entry.dismissed && entry.dismissed.length > 0) {
      sendLog(server, `[overlay] ${url} dismissed ${entry.dismissed.length} (${entry.dismissed.map((d) => d.method).join(',')})`);
    }

    if (urlFailures.length === 0) {
      captured++;
      sendLog(server, `[ok] ${url}`);
    } else {
      sendLog(server, `[fail] ${url} (${urlFailures.length} failures)`);
    }
    completed++;
    opts.onProgress?.(completed, totalUrls, url);
  };

  try {
    // --- worker pool with browser restart at segment boundaries ----------
    // URLs are processed in segments of browserRestartEvery; WITHIN a segment a
    // continuous pool of `concurrency` workers drains a shared cursor, so a slow
    // page never stalls the others (the old slice loop waited for the slowest
    // URL in every group of `concurrency` before starting the next group). The
    // browser is restarted only between segments to bound memory, preserving the
    // restart-every-N invariant while keeping each worker on a stable browser.
    const segSize = browserRestartEvery > 0 ? browserRestartEvery : urls.length;
    for (let segStart = 0; segStart < urls.length; segStart += segSize) {
      const segment = urls.slice(segStart, segStart + segSize);
      let cursor = 0;
      const worker = async (): Promise<void> => {
        // `cursor++` is atomic on JS's single-threaded loop: each worker claims a
        // distinct index synchronously before awaiting, so no URL runs twice.
        for (let idx = cursor++; idx < segment.length; idx = cursor++) {
          await processUrl(segment[idx]);
        }
      };
      const poolSize = Math.max(1, Math.min(concurrency, segment.length));
      await Promise.all(Array.from({ length: poolSize }, () => worker()));
      urlsSinceRestart += segment.length;

      const moreWork = segStart + segSize < urls.length;
      if (moreWork) {
        sendLog(server, `[restart] closing browser after ${urlsSinceRestart} URLs`);
        try { await browser.close(); } catch { /* best-effort */ }
        browser = await connectBrowser({ cdpPort: opts.cdpPort }) as unknown as Browser;
        browserRestarts++;
        urlsSinceRestart = 0;
      }
    }
  } finally {
    await manifest.flush();
    // Persist the accumulated responsive-image map (mobile variants) for the
    // alt reconstruct. Best-effort; merge-on-resume already loaded any prior map.
    if (Object.keys(responsiveImages).length > 0) {
      try {
        writeFileSync(
          join(opts.outputDir, 'responsive-images.json'),
          JSON.stringify(responsiveImages, null, 2),
        );
      } catch (err) {
        sendLog(server, `[warn] responsive-images serialize failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Persist mobile-DOM heights (alt iframe carry). The html-mobile/<slug>.html
    // documents are written per-page during capture; this is their size sidecar.
    if (Object.keys(mobileHeights).length > 0) {
      try {
        mkdirSync(join(opts.outputDir, 'html-mobile'), { recursive: true });
        writeFileSync(
          join(opts.outputDir, 'html-mobile', 'heights.json'),
          JSON.stringify(mobileHeights, null, 2),
        );
      } catch (err) {
        sendLog(server, `[warn] mobile-heights serialize failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (aggregator.hasSamples()) {
      try { aggregator.serialize(opts.outputDir); } catch (err) {
        sendLog(server, `[warn] aggregator serialize failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Serialize design CSS aggregate if any pages/posts were captured
    if (designCtx && designCtx.cssAgg.toString().trim()) {
      try { designCtx.cssAgg.serialize(opts.outputDir); } catch (err) {
        sendLog(server, `[warn] design cssAgg serialize failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Serialize design JS aggregate when includeScripts=true and content was collected
    if (designCtx && designCtx.jsAgg) {
      const jsText = designCtx.jsAgg.toString().trim();
      if (jsText) {
        try {
          writeFileSync(join(opts.outputDir, 'site.js'), jsText, 'utf8');
        } catch (err) {
          sendLog(server, `[warn] design jsAgg serialize failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    try { await browser.close(); } catch { /* best-effort */ }
  }

  const siteCssPath = designCtx && designCtx.cssAgg.toString().trim()
    ? join(opts.outputDir, 'site.css')
    : undefined;

  const siteJsTextRaw = designCtx?.jsAgg?.toString().trim();
  const siteJsText = siteJsTextRaw || undefined;

  // --- generate responsive chrome.css from dual-viewport layout maps ----------
  // Emit @media min-width:768px (desktop) + @media max-width:767px (mobile)
  // rules keyed on .dla-fx-N marker classes. Gracefully degrades to desktop-only
  // when mobile layout was not collected (different DOM, mobile capture failed,
  // or captureDesign=false).
  let chromeCssText: string | undefined;
  if (designCtx?.chromeAccum.desktopLayoutMap) {
    const css = generateChromeCss(
      designCtx.chromeAccum.desktopLayoutMap,
      designCtx.chromeAccum.mobileLayoutMap ?? undefined,
    );
    if (css.trim()) {
      chromeCssText = css;
      try {
        writeFileSync(join(opts.outputDir, 'chrome.css'), css, 'utf8');
      } catch (err) {
        sendLog(server, `[warn] chrome.css write failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return {
    captured,
    skipped,
    failed: allFailures.length,
    browserRestarts,
    durationMs: Date.now() - startTime,
    manifestPath,
    siteCssPath,
    cssMediaUrls: designCtx ? [...designCtx.cssMediaUrls] : undefined,
    headLinks: designCtx ? [...designCtx.headLinks] : undefined,
    siteJsText,
    nav: designCtx?.chromeAccum.nav ?? undefined,
    footerHtml: designCtx?.chromeAccum.footerHtml ?? undefined,
    chromeCssText,
  };
}
