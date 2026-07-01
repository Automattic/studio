//
// Per-URL pipeline
// ================
// Single-URL wrapper around runExtractionLoop. Processes one URL through the
// adapter's extractPage closure, downloads media, appends to the WXR, and
// (optionally) captures screenshots + html.
//
// Used by both:
//   - The watch CLI, which calls processOneUrl in a loop
//   - The liberate_extract_one MCP tool, for agent-driven streaming
//
// The function defers to runExtractionLoop for the heavy lifting (media
// download, tuner, session updates) by passing a 1-URL inventory + resume:true
// so the existing per-URL logic runs without purging prior state.
//
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { runExtractionLoop, type ExtractedPage } from '../../adapters/shared.js';
import { ExtractionLog } from '../resume-state/index.js';
import { WxrBuilder } from '../wxr/index.js';
import { ImportSession } from '../resume-state/index.js';
import { classifyUrl, type UrlType } from '../extraction/sitemap.js';
import type { WooProduct, WooProductCsvBuilder } from '../woo-csv/index.js';

export interface ProcessOneUrlOpts {
  /** Absolute URL to extract. Must be a full URL (https://...). */
  url: string;
  /** Liberation output directory. */
  outputDir: string;
  /** WxrBuilder owned by the caller. processOneUrl appends one item to it. */
  wxr: WxrBuilder;
  /** ExtractionLog owned by the caller. */
  log: ExtractionLog;
  /** Optional ImportSession for stage + counter updates. */
  session?: ImportSession;
  /** Adapter's per-URL extractor closure. */
  extractPage: (url: string) => Promise<ExtractedPage>;
  /** Optional platform-specific product extractor. */
  extractProduct?: (url: string, html: string) => WooProduct | null;
  /** Optional CSV builder for Woo product output. */
  csvBuilder?: WooProductCsvBuilder;
  /** Per-page delay floor (ms). Defaults to 0. */
  delay?: number;
  /** Verbose logging during the per-URL run. */
  verbose?: boolean;
  /** MCP server for log-message routing. */
  server?: Server;
  /** Capture desktop+mobile screenshot + rendered HTML after extraction. Default: false. */
  screenshot?: boolean;
}

export interface ProcessOneUrlResult {
  url: string;
  /** Archetype classification at the URL level. */
  classifyUrl: UrlType;
  /** True when adapter.extractPage returned a non-null page. */
  extracted: boolean;
  /** Counters from the underlying loop (each is 0 or 1). */
  pagesExtracted: number;
  postsExtracted: number;
  productsExtracted: number;
  failed: number;
  mediaCollected: number;
  /** Wall-clock duration. */
  durationMs: number;
  /** Per-URL errors surfaced from extract or screenshot. */
  errors: string[];
  /** Path relative to outputDir for the captured desktop screenshot, when screenshot:true. */
  screenshotPath: string | null;
  /** Path relative to outputDir for the captured rendered HTML, when screenshot:true. */
  htmlPath: string | null;
}

export async function processOneUrl(opts: ProcessOneUrlOpts): Promise<ProcessOneUrlResult> {
  const start = Date.now();
  const errors: string[] = [];
  const archetype = classifyUrl(opts.url);

  // Run the existing extraction loop with an inventory of exactly one URL.
  // resume:true skips the fresh-start cleanup that would erase media + log.
  let loopResult = {
    pagesExtracted: 0,
    postsExtracted: 0,
    productsExtracted: 0,
    failed: 0,
    mediaCollected: 0,
  };
  try {
    loopResult = await runExtractionLoop({
      urls: [{ url: opts.url, type: archetype }],
      navigation: [],
      wxr: opts.wxr,
      log: opts.log,
      outputDir: opts.outputDir,
      delay: opts.delay ?? 0,
      dryRun: false,
      resume: true,
      verbose: opts.verbose,
      server: opts.server,
      csvBuilder: opts.csvBuilder,
      session: opts.session,
      extractPage: opts.extractPage,
      extractProduct: opts.extractProduct,
      limit: 1,
    });
  } catch (err) {
    errors.push((err as Error).message);
  }

  const extracted = loopResult.pagesExtracted + loopResult.postsExtracted + loopResult.productsExtracted > 0;

  let screenshotPath: string | null = null;
  let htmlPath: string | null = null;
  if (opts.screenshot && extracted) {
    try {
      const { captureScreenshots } = await import('../screenshot/screenshotter.js');
      await captureScreenshots({
        urls: [opts.url],
        outputDir: opts.outputDir,
        primaryUrl: opts.url,
        server: opts.server,
      });
      // The screenshotter writes manifest.json on the way out — read the
      // entry for this URL to surface the captured paths in our result.
      const manifestPath = join(opts.outputDir, 'screenshots', 'manifest.json');
      if (existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
            entries?: Record<string, { desktop?: string; html?: string }>;
          };
          const entry = manifest.entries?.[opts.url];
          screenshotPath = entry?.desktop ?? null;
          htmlPath = entry?.html ?? null;
        } catch {
          // manifest unreadable — leave paths null
        }
      }
    } catch (err) {
      errors.push(`screenshot: ${(err as Error).message}`);
    }
  }

  return {
    url: opts.url,
    classifyUrl: archetype,
    extracted,
    pagesExtracted: loopResult.pagesExtracted,
    postsExtracted: loopResult.postsExtracted,
    productsExtracted: loopResult.productsExtracted,
    failed: loopResult.failed,
    mediaCollected: loopResult.mediaCollected,
    durationMs: Date.now() - start,
    errors,
    screenshotPath,
    htmlPath,
  };
}
