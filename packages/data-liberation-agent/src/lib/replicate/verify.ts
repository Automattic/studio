//
// Replica Verify
// ==============
// Captures screenshots of a running replica WP install and pairs each with the
// corresponding source screenshot from the original liberation extraction.
// The result is a structured manifest the calling agent (vision-capable) uses
// to compare side-by-side and produce qualitative observations.
//
// Why pairing-only instead of numeric scoring?
// ============================================
// The skill's verification.md spec defines structuralScore / paletteScore /
// typographyScore as ideal outputs, but iteration-1 visual verification ran
// fine without them — vision comparison surfaced the load-bearing issues
// (slug mismatch, patterns not reaching post_content) that no numeric metric
// would catch. So this tool does the deterministic part (capture + pair) and
// hands the perceptual judgement to the agent. Numeric scoring can be a
// follow-up when we have evidence vision is insufficient.
//
// Replica screenshots land at <outputDir>/replica-screenshots/<slug>.png so
// the side-by-side pairs sit alongside the source set.
//
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { connectBrowser } from '../browser-kit/index.js';
import { mapPool } from '../concurrency.js';
import type { ReplicaSectionMeasure } from './section-parity.js';

/**
 * Read per-section layout metrics from the LIVE replica DOM at desktop width. Runs in the
 * page context (serialized by Playwright — must be self-contained, no imports). Walks the
 * content root's top-level sections in document order and, per section, returns the
 * rendered column count (columns in the largest single horizontal row — so a CSS-collapsed
 * grid reads as 1, mirroring `largestRowGroupSize`), the resolved background color, and
 * whether it carries media. Paired to the source spec sections BY INDEX by the caller.
 */
function measureReplicaSectionsInBrowser(): ReplicaSectionMeasure[] {
  const TOL = 6;
  const isTransparent = (c: string) => !c || c === 'transparent' || /,\s*0\s*\)$/.test(c);
  const resolveBg = (el: Element): string => {
    let node: Element | null = el;
    while (node) {
      const c = getComputedStyle(node).backgroundColor;
      if (!isTransparent(c)) return c;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };
  const hasMediaIn = (el: Element): boolean => {
    if (el.querySelector('img, video, svg image, picture')) return true;
    for (const n of [el, ...Array.from(el.querySelectorAll('*'))]) {
      const bi = getComputedStyle(n as Element).backgroundImage;
      if (bi && bi !== 'none' && bi.includes('url(')) return true;
    }
    return false;
  };
  const columnCount = (section: Element): number => {
    const colsEl = section.querySelector('.wp-block-columns');
    if (!colsEl) return 1;
    const cols = Array.from(colsEl.children).filter((c) => c.classList.contains('wp-block-column'));
    if (cols.length === 0) return 1;
    const tops = cols.map((c) => Math.round(c.getBoundingClientRect().top));
    let best = 1;
    for (const a of tops) {
      const n = tops.filter((t) => Math.abs(t - a) <= TOL).length;
      if (n > best) best = n;
    }
    return best;
  };
  const root =
    document.querySelector('.entry-content') ||
    document.querySelector('main .wp-block-post-content') ||
    document.querySelector('main') ||
    document.body;
  const SKIP = new Set(['HEADER', 'FOOTER', 'NAV']);
  const sections = Array.from(root.children).filter((el) => {
    const role = el.getAttribute('role');
    return !SKIP.has(el.tagName) && role !== 'banner' && role !== 'contentinfo';
  });
  return sections.map((s) => ({ columnCount: columnCount(s), bg: resolveBg(s), hasMedia: hasMediaIn(s) }));
}

/**
 * Count leaf CONTENT elements (text nodes / images) whose box extends beyond the
 * viewport. Uses `getBoundingClientRect`, which reports the LAYOUT rect and so
 * ignores `overflow-x: clip/hidden` — closing the gate blind spot where a
 * fixed-width R4b styled island keeps `scrollWidth == viewport` (an ancestor
 * clips it) while its content is amputated off-screen. Runs at the mobile
 * viewport. A non-zero count fails responsiveness → the section must be rebuilt
 * via R4a (reflowing core blocks), not left on the desktop-only styled floor.
 */
function measureContentPastFoldInBrowser(): number {
  const vw = document.documentElement.clientWidth;
  const TOL = 1;
  let count = 0;
  const all = document.querySelectorAll('body *');
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as HTMLElement;
    if (el.children.length > 0) continue; // leaf content only
    const isImg = el.tagName === 'IMG';
    const txt = (el.textContent || '').trim();
    if (!isImg && !txt) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // not rendered
    if (r.right > vw + TOL || r.left > vw + TOL) count++;
  }
  return count;
}

export type Viewport = 'desktop' | 'mobile';

/** One viewport's worth of capture + pairing for a single URL. */
export interface ViewportCapture {
  viewport: Viewport;
  /** Path relative to outputDir for the replica screenshot just captured. */
  replicaScreenshot: string;
  /** Path relative to outputDir for the matching source screenshot — null when no manifest entry was found. */
  sourceScreenshot: string | null;
  /** HTTP status returned by the replica navigation. */
  httpStatus: number | null;
  /** Errors encountered for this viewport (capture failed, navigation timed out, etc.). */
  errors: string[];
  /** Mobile viewport only: count of leaf content elements rendering past the fold
   *  (measured ignoring overflow clipping). Feeds `ResponsiveMetrics.contentPastFoldCount`
   *  so a clipped fixed-layout styled island fails the responsiveness gate. */
  contentPastFold?: number;
}

export interface VerifyPair {
  /** URL path that was navigated against the replica (e.g. "/blog/post-1"). */
  urlPath: string;
  /** Slug used to write the replica screenshot files. */
  slug: string;
  /** One ViewportCapture per requested viewport (default: desktop + mobile). */
  captures: ViewportCapture[];
  /** Per-section layout metrics read from the live replica DOM at desktop, in document
   *  order. Paired to the source spec sections BY INDEX by the QA loop to score visual
   *  parity. Empty when the desktop read failed or desktop wasn't a requested viewport. */
  sections?: ReplicaSectionMeasure[];
}

export interface VerifyResult {
  ok: boolean;
  outputDir: string;
  replicaBaseUrl: string;
  capturedAt: string;
  pairs: VerifyPair[];
  /** URLs in `urls` that had no corresponding source manifest entry — surfaced for the agent to know coverage is incomplete. */
  unmatchedUrls: string[];
  errors: string[];
}

export interface VerifyOpts {
  /** Directory containing the original liberation output (palette.json, screenshots/manifest.json, etc.). */
  outputDir: string;
  /** Base URL of the running replica (e.g. "http://localhost:8881"). No trailing slash. */
  replicaBaseUrl: string;
  /** Path-only URLs to verify (e.g. ["/", "/blog/post-1"]). */
  urls: string[];
  /** Subdirectory under outputDir to write replica screenshots. Default: "replica-screenshots". */
  outputSubdir?: string;
  /** Viewports to capture. Default: ['desktop', 'mobile'] — matches the source screenshotter. */
  viewports?: Viewport[];
  /** Per-page navigation timeout in ms. Default: 30_000. */
  timeoutMs?: number;
  /** Optional CDP port — if provided, connect to an existing Chrome instead of launching a new one. */
  cdpPort?: number;
  /** Max pages captured+measured concurrently. Pages are independent, so the per-URL loop
   *  fans out (mirrors the screenshot stage). Default 6, clamped to [1, 10]. */
  concurrency?: number;
}

/** Viewport dimensions matched to the source screenshotter's defaults. */
const VIEWPORT_DIMENSIONS: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

interface ManifestEntry {
  slug?: string;
  desktop?: string;
  desktopScrolled?: string;
  mobile?: string;
  mobileScrolled?: string;
  html?: string;
}

interface Manifest {
  version?: number;
  entries?: Record<string, ManifestEntry>;
}

const DEFAULT_VIEWPORTS: Viewport[] = ['desktop', 'mobile'];
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OUTPUT_SUBDIR = 'replica-screenshots';
const DEFAULT_CONCURRENCY = 6;

/** Strip query/hash and trailing slash for matching. */
function canonical(url: string): string {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${path}`;
  } catch {
    return url.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  }
}

/** Convert a URL path into a filesystem-safe slug ("/blog/post-1" → "blog--post-1"). */
function slugFromPath(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return 'homepage';
  return trimmed.replace(/[?#].*$/, '').replace(/\//g, '--').replace(/[^a-zA-Z0-9._-]/g, '-');
}

function loadManifest(outputDir: string): Manifest {
  const path = join(outputDir, 'screenshots', 'manifest.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  } catch {
    return {};
  }
}

/**
 * Find the source manifest entry whose URL canonically matches `urlPath`.
 * Strategy:
 *  1. Build a canonical-path → entry index from the manifest
 *  2. Compare path-only — manifest URLs are full origins, but the agent passes
 *     replica-relative paths. The match is on the path component.
 */
function findSourceEntry(
  manifest: Manifest,
  urlPath: string,
): { url: string; entry: ManifestEntry } | null {
  const entries = manifest.entries ?? {};
  const targetPath = canonical(`http://placeholder${urlPath.startsWith('/') ? urlPath : '/' + urlPath}`).replace('http://placeholder', '');
  for (const [fullUrl, entry] of Object.entries(entries)) {
    let path: string;
    try {
      path = canonical(fullUrl).replace(new URL(fullUrl).origin, '');
    } catch {
      continue;
    }
    if (path === targetPath || (path === '' && targetPath === '/')) {
      return { url: fullUrl, entry };
    }
  }
  return null;
}

/**
 * Capture replica screenshots (one per viewport) and produce a side-by-side
 * pairing for each. Throws only on infra failures (browser launch). Per-URL
 * or per-viewport failures populate captures[].errors and the function
 * returns a result with ok=false.
 *
 * Replica screenshots land at:
 *   <outputDir>/<outputSubdir>/<viewport>/<slug>.png
 *
 * Source screenshots are looked up via screenshots/manifest.json — `desktop`
 * for desktop viewport, `mobile` for mobile viewport. URLs without a manifest
 * entry are surfaced in unmatchedUrls so the agent knows coverage is partial.
 */
export async function verifyReplica(opts: VerifyOpts): Promise<VerifyResult> {
  const outputDir = resolve(opts.outputDir);
  if (!existsSync(outputDir)) {
    throw new Error(`outputDir not found: ${outputDir}`);
  }
  const replicaBaseUrl = opts.replicaBaseUrl.replace(/\/+$/, '');
  const subdir = opts.outputSubdir ?? DEFAULT_OUTPUT_SUBDIR;
  const viewports = opts.viewports ?? DEFAULT_VIEWPORTS;
  // Pre-create the per-viewport output dirs.
  for (const vp of viewports) {
    mkdirSync(join(outputDir, subdir, vp), { recursive: true });
  }

  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const manifest = loadManifest(outputDir);

  const pairs: VerifyPair[] = [];
  const errors: string[] = [];
  const unmatchedUrls: string[] = [];
  // Replica manifest entries (standard {version,entries} shape) so liberate_compare
  // can join this dir against the source screenshots dir. KEY by the matched
  // SOURCE url when available — compare joins on `new URL(url).pathname`, and the
  // source manifest's urls lack the trailing slash the replica paths carry, so
  // reusing the source url string guarantees the pathnames align.
  const manifestEntries: Record<string, { slug: string; desktop?: string; mobile?: string }> = {};

  let browser: Browser | null = null;
  try {
    browser = await connectBrowser({ cdpPort: opts.cdpPort });
  } catch (err) {
    return {
      ok: false,
      outputDir,
      replicaBaseUrl,
      capturedAt: new Date().toISOString(),
      pairs: [],
      unmatchedUrls: opts.urls.slice(),
      errors: [`Browser launch failed: ${(err as Error).message}`],
    };
  }

  const activeBrowser = browser;
  // One URL's full capture (all viewports + the desktop section read). Pure of shared
  // mutable state — returns its contribution so the batched loop can aggregate in input
  // order regardless of which page finished first.
  const captureOne = async (
    urlPath: string,
  ): Promise<{
    pair: VerifyPair;
    unmatched: string | null;
    manifestKey: string;
    manifestEntry: { slug: string; desktop?: string; mobile?: string };
  }> => {
      const slug = slugFromPath(urlPath);
      const fullUrl = `${replicaBaseUrl}${urlPath.startsWith('/') ? urlPath : '/' + urlPath}`;
      const sourceMatch = findSourceEntry(manifest, urlPath);

      const captures: ViewportCapture[] = [];
      let sectionMeasures: ReplicaSectionMeasure[] | undefined;
      for (const vp of viewports) {
        const dimensions = VIEWPORT_DIMENSIONS[vp];
        const replicaPath = join(outputDir, subdir, vp, `${slug}.png`);
        const replicaRel = join(subdir, vp, `${slug}.png`);
        const sourceFromManifest = sourceMatch
          ? (vp === 'desktop' ? sourceMatch.entry.desktop : sourceMatch.entry.mobile)
          : undefined;
        const capture: ViewportCapture = {
          viewport: vp,
          replicaScreenshot: replicaRel,
          sourceScreenshot: sourceFromManifest ?? null,
          httpStatus: null,
          errors: [],
        };

        // Each viewport gets its own context — Playwright doesn't let us
        // resize a context's viewport mid-flight, and reusing pages across
        // viewports leaks state in some cases (CSS hover, scroll position).
        let context: BrowserContext | null = null;
        let page: Page | null = null;
        try {
          context = await activeBrowser.newContext({ viewport: dimensions });
          // Polyfill tsx/esbuild's `__name` helper inside the page (mirrors section-extract):
          // a named function passed to `page.evaluate` (measureReplicaSectionsInBrowser) is
          // serialized WITH esbuild's `__name(fn,...)` instrumentation, which is undefined in
          // the browser → "__name is not defined". The init script defines it before any eval.
          await context.addInitScript(
            `if (typeof globalThis.__name === 'undefined') { globalThis.__name = function (fn) { return fn; }; }`,
          );
          context.on('page', (p: Page) => {
            p.on('dialog', (d) => {
              d.dismiss().catch(() => undefined);
            });
          });
          page = await context.newPage();
          const resp = await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout });
          capture.httpStatus = resp ? resp.status() : null;
          await page
            .waitForLoadState('networkidle', { timeout: Math.min(timeout, 15_000) })
            .catch(() => undefined);
          await page.screenshot({ path: replicaPath, fullPage: true });
          // Read per-section layout metrics once, at desktop width (the parity gate's
          // structural comparison is a desktop concern; mobile is the responsiveness gate).
          if (vp === 'desktop') {
            try {
              sectionMeasures = await page.evaluate(measureReplicaSectionsInBrowser);
            } catch (err) {
              capture.errors.push(`section-metrics: ${(err as Error).message}`);
            }
          }
          // Mobile is the responsiveness gate: measure content past the fold here
          // (catches clipped fixed-layout islands that scrollWidth alone misses).
          if (vp === 'mobile') {
            try {
              capture.contentPastFold = await page.evaluate(measureContentPastFoldInBrowser);
            } catch (err) {
              capture.errors.push(`content-past-fold: ${(err as Error).message}`);
            }
          }
        } catch (err) {
          capture.errors.push((err as Error).message);
        } finally {
          if (page) await page.close().catch(() => undefined);
          if (context) await context.close().catch(() => undefined);
        }
        captures.push(capture);
      }

      const entry: { slug: string; desktop?: string; mobile?: string } = { slug };
      if (viewports.includes('desktop')) entry.desktop = `desktop/${slug}.png`;
      if (viewports.includes('mobile')) entry.mobile = `mobile/${slug}.png`;
      return {
        pair: { urlPath, slug, captures, ...(sectionMeasures ? { sections: sectionMeasures } : {}) },
        unmatched: sourceMatch ? null : urlPath,
        manifestKey: sourceMatch?.url ?? fullUrl,
        manifestEntry: entry,
      };
  };

  // Fan out across pages with a concurrency-bounded worker pool (shared mapPool) — no
  // per-batch barrier, so a slow heavy page never stalls the others. mapPool returns
  // results in INPUT order, so `pairs`/`unmatchedUrls` stay deterministic regardless of
  // which page settled first.
  const concurrency = Math.max(1, Math.min(10, opts.concurrency ?? DEFAULT_CONCURRENCY));
  try {
    const results = await mapPool(opts.urls, concurrency, (url) => captureOne(url));
    for (const r of results) {
      pairs.push(r.pair);
      if (r.unmatched) unmatchedUrls.push(r.unmatched);
      manifestEntries[r.manifestKey] = r.manifestEntry;
    }
  } finally {
    await activeBrowser.close().catch(() => undefined);
  }

  // Write the replica manifest so `liberate_compare` can join this dir to the
  // source screenshots dir (it reads {version:1, entries:{url:{slug}}} and builds
  // <dir>/<viewport>/<slug>.png paths itself). Best-effort — a write failure must
  // not fail the capture (the agent's vision review is the gate, not the score).
  try {
    writeFileSync(
      join(outputDir, subdir, 'manifest.json'),
      JSON.stringify({ version: 1, entries: manifestEntries }, null, 2),
    );
  } catch {
    /* best-effort */
  }

  const ok =
    errors.length === 0 &&
    pairs.every((p) => p.captures.every((c) => c.errors.length === 0));

  return {
    ok,
    outputDir,
    replicaBaseUrl,
    capturedAt: new Date().toISOString(),
    pairs,
    unmatchedUrls,
    errors,
  };
}
