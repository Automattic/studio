import { readFileSync, renameSync, unlinkSync } from 'fs';
import { getPlaywright } from '../browser-kit/index.js';

/**
 * SVG → PNG raster sibling support for fetched media.
 *
 * Default WP rejects `image/svg+xml`, and the Safe SVG plugin's sanitizer
 * mangles `<use>`/`<defs>` reference graphs (Neptune's documented failure
 * mode). So at fetch time the media pipeline (a) scans each SVG for those
 * risky constructs and (b) rasterizes a PNG sibling that install-time routing
 * can substitute when the SVG itself can't safely land in the media library.
 */

/**
 * True when the SVG bytes contain a `<use>` or `<defs>` element — the
 * constructs Safe SVG's sanitizer is known to mangle. Case-insensitive;
 * matches the opening tag followed by whitespace, `>`, or `/` so plain words
 * like "used"/"defsX" in text content don't false-positive.
 */
export function isRiskySvg(bytes: Buffer | string): boolean {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes;
  return /<\s*(use|defs)[\s>/]/i.test(text);
}

export type RasterizeResult =
  | { ok: true; width: number; height: number }
  | { ok: false; error: string };

type CachedBrowser = Awaited<ReturnType<(typeof import('playwright'))['chromium']['launch']>>;

/**
 * Module-level lazily-launched Chromium, shared across rasterize calls so a
 * media batch with many SVGs pays ONE launch (the extraction media loop
 * downloads concurrently — each call still gets its own context/page).
 * Callers that drive batches should `closeSvgRasterizer()` when done
 * (runExtractionLoop does, at finalize). If a crash skips the close, the
 * Chromium child dies with the parent process — Playwright registers exit
 * handlers — so the leak is bounded by process lifetime.
 */
let browserPromise: Promise<CachedBrowser> | null = null;

async function getRasterBrowser(): Promise<CachedBrowser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const pw = await getPlaywright();
      return pw.chromium.launch({ headless: true });
    })().catch((err) => {
      // Failed launch must not poison the cache — let the next call retry.
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/** Close the shared rasterizer browser (idempotent; safe when never launched). */
export async function closeSvgRasterizer(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    await (await pending).close();
  } catch {
    // already closed / launch failed — nothing to do
  }
}

/** Probe timeout: an SVG that neither loads nor errors within this window fails. */
const SVG_LOAD_TIMEOUT_MS = 10000;

/**
 * Rasterize an SVG file to a PNG at `pngPath`, scaling the longest edge to
 * `maxEdge` while preserving aspect. Intrinsic dimensions come from
 * Chromium's image decode (an SVG declaring none falls back to 1024×1024 via
 * the zero-dimension guard). NEVER throws — failures return `{ok:false}` so a
 * raster problem can't fail the media fetch that triggered it. The PNG write
 * is atomic (unique tmp + rename).
 */
export async function rasterizeSvg(
  svgPath: string,
  pngPath: string,
  maxEdge = 1024,
): Promise<RasterizeResult> {
  let context: Awaited<ReturnType<CachedBrowser['newContext']>> | null = null;
  const tmpPath = `${pngPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    // data: URL (not file://) — a Playwright setContent page is about:blank,
    // which Chromium blocks from loading file:// subresources.
    const svgBytes = readFileSync(svgPath);
    const dataUrl = `data:image/svg+xml;base64,${svgBytes.toString('base64')}`;

    const browser = await getRasterBrowser();
    context = await browser.newContext({ viewport: { width: maxEdge, height: maxEdge } });
    // Polyfill tsx/esbuild's __name helper inside the page (mirrors screenshotter) —
    // page.evaluate closures serialized under tsx carry __name() instrumentation.
    await context.addInitScript(`
      if (typeof globalThis.__name === 'undefined') {
        globalThis.__name = function (fn) { return fn; };
      }
    `);
    const page = await context.newPage();

    // Probe intrinsic dimensions via an Image decode — onerror doubles as the
    // malformed-SVG detector (Chromium fires error for undecodable SVG bytes).
    const probe = await page.evaluate(
      ({ src, timeoutMs }) =>
        new Promise<{ loaded: boolean; w: number; h: number }>((resolve) => {
          const img = new Image();
          const timer = setTimeout(() => resolve({ loaded: false, w: 0, h: 0 }), timeoutMs);
          img.onload = () => {
            clearTimeout(timer);
            resolve({ loaded: true, w: img.naturalWidth, h: img.naturalHeight });
          };
          img.onerror = () => {
            clearTimeout(timer);
            resolve({ loaded: false, w: 0, h: 0 });
          };
          img.src = src;
        }),
      { src: dataUrl, timeoutMs: SVG_LOAD_TIMEOUT_MS },
    );
    if (!probe.loaded) {
      return { ok: false, error: 'SVG failed to decode in Chromium (malformed or unsupported)' };
    }

    // Fallback when the SVG declares no usable dimensions (decode reports 0).
    const intrinsicW = probe.w > 0 ? probe.w : maxEdge;
    const intrinsicH = probe.h > 0 ? probe.h : maxEdge;
    const scale = maxEdge / Math.max(intrinsicW, intrinsicH);
    const width = Math.max(1, Math.round(intrinsicW * scale));
    const height = Math.max(1, Math.round(intrinsicH * scale));

    await page.setViewportSize({ width, height });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;padding:0">` +
        `<img id="raster" src="${dataUrl}" style="display:block;width:${width}px;height:${height}px">` +
        `</body></html>`,
      { waitUntil: 'load' },
    );
    // omitBackground keeps SVG transparency (logos) instead of flattening to white.
    // Explicit type:'png' — the tmp path's suffix hides the .png extension, so
    // Playwright can't infer the format from the path.
    await page.locator('#raster').screenshot({ path: tmpPath, type: 'png', omitBackground: true });
    renameSync(tmpPath, pngPath);
    return { ok: true, width, height };
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* no partial tmp to clean */ }
    return { ok: false, error: (err as Error).message };
  } finally {
    try { await context?.close(); } catch { /* browser already gone */ }
  }
}
