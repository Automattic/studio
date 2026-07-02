import * as cheerio from 'cheerio';
import type { NavLink } from '../lib/html-extract/index.js';
import type { WxrBuilder, WxrItem } from '../lib/wxr/index.js';
import type { ExtractionLog } from '../lib/resume-state/index.js';
import type { ImportSession } from '../lib/resume-state/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { classifyUrl } from '../lib/extraction/sitemap.js';
import { closeSvgRasterizer, downloadMedia, isFontUrl } from '../lib/media-fetch/index.js';
import { MediaStubStore } from '../lib/resume-state/index.js';
import type { WooProductCsvBuilder, WooProduct } from '../lib/woo-csv/index.js';
import { AdaptiveTuner, TUNER_DEFAULTS } from '../lib/extraction/adaptive-tuner.js';
import type { AdaptiveTunerConfig, TunerState } from '../lib/extraction/adaptive-tuner.js';
import { claimSlug, pageSlugFromUrl } from '../lib/url/index.js';

// ---------------------------------------------------------------------------
// Strip non-content tags from HTML
// ---------------------------------------------------------------------------

function stripNonContentTags(html: string): string {
  const $ = cheerio.load(html, null, false);
  // Remove whole subtrees we never want in post content.
  $('script, style, form').remove();
  // Strip inline style attributes — source sites typically emit absolute
  // pixel sizes, fonts, and colors that fight the WordPress theme. WP block
  // editor and theme CSS handle presentation once the content is imported.
  $('[style]').removeAttr('style');
  return $.html();
}

// ---------------------------------------------------------------------------
// Shared sleep helper
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Generic product detection from HTML (JSON-LD Product schema)
// ---------------------------------------------------------------------------

export function extractProductFromHtml(html: string, sourceUrl: string): WooProduct | null {
  const $ = cheerio.load(html);
  const ldBlocks: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    ldBlocks.push($(el).html() || '');
  });

  for (const jsonStr of ldBlocks) {
    try {
      const ld = JSON.parse(jsonStr);
      if (ld['@type'] === 'Product' && ld.name) {
        const offers = Array.isArray(ld.offers) ? ld.offers : ld.offers ? [ld.offers] : [];
        const price = offers[0]?.price ? String(offers[0].price) : '';
        const images: string[] = [];
        if (typeof ld.image === 'string') images.push(ld.image);
        else if (Array.isArray(ld.image)) {
          for (const img of ld.image) {
            if (typeof img === 'string') images.push(img);
            else if (img?.url) images.push(img.url);
          }
        }
        return {
          name: ld.name,
          description: ld.description || '',
          regularPrice: price,
          sku: ld.sku || '',
          images,
          inStock: offers[0]?.availability?.includes('InStock') ?? true,
          sourceUrl,
        };
      }
    } catch {
      // invalid JSON-LD
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared types for the extraction loop
// ---------------------------------------------------------------------------

export interface InventoryUrl {
  url: string;
  type: string;
}

/**
 * Cap a typed URL list to `limit` entries while keeping the sample
 * *representative* across content types.
 *
 * A naive `urls.slice(0, limit)` follows sitemap/inventory order, which on
 * multi-type sites (notably Shopify stores, where `/pages/*` sort before
 * `/products/*`) can exhaust the cap on a single type and silently drop
 * products entirely. A limited extraction of a *store* that contains zero
 * products is not a useful sample.
 *
 * Strategy:
 *   1. The homepage (if present) is always included first.
 *   2. PINNED urls (e.g. primary-nav targets) come next — they MUST survive the
 *      cap so the reconstructed menu never points at an uncaptured page.
 *   3. The remaining slots are filled round-robin across the type buckets,
 *      in each type's first-appearance order, so every content type that
 *      exists gets proportional representation.
 *   4. Relative order within a type is preserved.
 *
 * Returns exactly `min(limit, urls.length)` entries.
 *
 * @param pinnedUrls - Optional set of URL strings to prioritize immediately
 *   after the homepage. Entries whose `.url` is in this set are pulled to the
 *   front of the slice (in their original order) so a small `--limit` still
 *   includes every primary-nav destination.
 */
export function stratifiedUrlSlice<T extends { type: string; url?: string }>(
  urls: T[],
  limit: number,
  pinnedUrls?: Set<string>,
): T[] {
  if (limit < 0) return [];
  if (urls.length <= limit) return urls.slice();
  if (limit === 0) return [];

  // Bucket by type, preserving first-appearance order of both types and members.
  const buckets = new Map<string, T[]>();
  for (const u of urls) {
    const bucket = buckets.get(u.type);
    if (bucket) bucket.push(u);
    else buckets.set(u.type, [u]);
  }

  const result: T[] = [];
  const taken = new Set<T>();

  // 1. Homepage(s) first — the source's primary page anchors the design.
  const homepageBucket = buckets.get('homepage');
  if (homepageBucket) {
    for (const u of homepageBucket) {
      if (result.length >= limit) break;
      result.push(u);
      taken.add(u);
    }
    buckets.delete('homepage');
  }

  // 2. Pinned URLs (primary-nav targets) — pull them to the front, in original
  //    order, so the cap can't strand a menu link on an uncaptured page. We
  //    leave the taken entries in their type buckets and skip them in the
  //    round-robin below via `taken`.
  if (pinnedUrls && pinnedUrls.size > 0) {
    for (const u of urls) {
      if (result.length >= limit) break;
      if (taken.has(u)) continue;
      if (u.url && pinnedUrls.has(u.url)) {
        result.push(u);
        taken.add(u);
      }
    }
  }

  // 3. Round-robin across remaining type buckets until the limit is hit.
  //    Skip entries already taken as pinned nav targets so they aren't
  //    double-counted.
  const cursors = new Map<string, number>();
  for (const type of buckets.keys()) cursors.set(type, 0);
  let progressed = true;
  while (result.length < limit && progressed) {
    progressed = false;
    for (const [type, bucket] of buckets) {
      if (result.length >= limit) break;
      let idx = cursors.get(type)!;
      // Advance past any pinned entries already in the result.
      while (idx < bucket.length && taken.has(bucket[idx])) idx++;
      if (idx < bucket.length) {
        result.push(bucket[idx]);
        taken.add(bucket[idx]);
        cursors.set(type, idx + 1);
        progressed = true;
      } else {
        cursors.set(type, idx);
      }
    }
  }

  return result;
}

/**
 * Resolve captured primary-nav hrefs to the matching inventory URL strings, so
 * they can be pinned into a `--limit` slice. Matching is by same-origin
 * pathname (ignoring trailing slash, query, hash): a nav href
 * `https://site/pages/about-us` pins the inventory URL `https://site/pages/about-us`
 * (or `.../about-us/`). Off-site nav hrefs match nothing and are omitted.
 */
export function navTargetInventoryUrls(
  navigation: NavLink[],
  inventory: Array<{ url: string }>,
): Set<string> {
  const pinned = new Set<string>();
  if (navigation.length === 0) return pinned;

  // Index inventory by normalized pathname → original URL.
  const byPath = new Map<string, string>();
  for (const inv of inventory) {
    const p = normalizeUrlPath(inv.url);
    if (p !== null && !byPath.has(p)) byPath.set(p, inv.url);
  }

  for (const nav of navigation) {
    const p = normalizeUrlPath(nav.href);
    if (p === null) continue;
    const match = byPath.get(p);
    if (match) pinned.add(match);
  }
  return pinned;
}

/** Normalize an absolute URL to its pathname without trailing slash / query / hash. Null if unparseable or root. */
function normalizeUrlPath(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const stripped = parsed.pathname.replace(/\/+$/, '');
  return stripped || null; // root → null (homepage handled separately)
}

export interface ExtractedPage {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  date: string;
  seoTitle: string;
  seoDescription: string;
  mediaUrls: string[];
  qualityScore: 'high' | 'medium' | 'low';
  categories?: string[];
  tags?: string[];
  /** Author display name (e.g. from JSON-LD, platform API, or HTML meta) */
  author?: string;
  /** Override URL-based type classification (e.g. from structured data / JSON-LD) */
  detectedType?: 'product' | 'post' | 'page';
  /** Parsed JSON-LD objects from the page. Used by the fallback type detector. */
  jsonLd?: unknown[];
}

export interface PageExtractedEvent {
  url: string;
  slug: string;
  type: 'product' | 'post' | 'page' | 'homepage' | 'gallery' | 'event';
  items: WxrItem[];
  mediaUrls: string[];
}

export interface ExtractionLoopOpts {
  urls: InventoryUrl[];
  navigation: NavLink[];
  wxr: WxrBuilder;
  log: ExtractionLog;
  outputDir: string;
  delay: number;
  dryRun: boolean;
  resume: boolean;
  verbose?: boolean;
  server?: Server;
  csvBuilder?: WooProductCsvBuilder;
  /** Optional higher-level resume state; counters & stage are updated automatically */
  session?: ImportSession;
  extractPage: (url: string) => Promise<ExtractedPage>;
  /** Optional platform-specific product extractor — called before the generic JSON-LD fallback */
  extractProduct?: (url: string, html: string) => WooProduct | null;
  /**
   * Optional streaming callback fired after one URL has been fetched,
   * media-downloaded, and added to WXR/products. Used by watch mode to
   * update the running preview without re-entering adapters one URL at a time.
   */
  onPageExtracted?: (event: PageExtractedEvent) => void | Promise<void>;
  /**
   * Cap the number of URLs to process. Useful for sampling a real extraction
   * (with full WXR output) without committing to the entire site. When unset,
   * processes all URLs in the inventory. Takes precedence over dryRun's
   * implicit 3-URL cap.
   */
  limit?: number;
  /** Optional per-adapter tuner configuration overrides */
  tunerConfig?: AdaptiveTunerConfig;
}

// ---------------------------------------------------------------------------
// Shared extraction loop — iterate-extract-flush pattern
// ---------------------------------------------------------------------------

export interface ExtractionLoopResult {
  pagesExtracted: number;
  postsExtracted: number;
  productsExtracted: number;
  failed: number;
  mediaCollected: number;
}

export async function runExtractionLoop(opts: ExtractionLoopOpts): Promise<ExtractionLoopResult> {
  // The SVG rasterizer's shared Chromium is lazily launched inside the media
  // download loop; close it on ALL exit paths — the MCP server is a long-lived
  // process, so a throw mid-loop would otherwise leak the Chromium child for
  // the lifetime of the server. (No-op when the run fetched no SVGs.)
  try {
    return await runExtractionLoopInner(opts);
  } finally {
    await closeSvgRasterizer();
  }
}

async function runExtractionLoopInner(opts: ExtractionLoopOpts): Promise<ExtractionLoopResult> {
  const {
    urls: inventoryUrls,
    navigation,
    wxr,
    log,
    outputDir,
    delay,
    dryRun,
    resume,
    verbose,
    server,
    csvBuilder,
    session,
    extractPage,
    extractProduct,
    onPageExtracted,
    limit,
    tunerConfig,
  } = opts;

  // Seed discovered counts from the inventory so the session reflects
  // what the adapter found before extraction began.
  if (session) {
    const discoveredByType: Record<string, number> = {};
    for (const u of inventoryUrls) {
      discoveredByType[u.type] = (discoveredByType[u.type] || 0) + 1;
    }
    session.setDiscovered(discoveredByType);
    session.setStage('extracting');
  }

  const savedTunerState = session?.getCursor<TunerState>('adaptive-tuner');
  const tuner = new AdaptiveTuner({ pageDelayStart: delay, config: tunerConfig }, savedTunerState);

  const mediaDir = outputDir ? `${outputDir}/media` : null;

  // Fresh start: purge old media and logs unless resuming.
  // Note: output.wxr is NOT deleted here — the caller manages WXR via
  // openStream() which truncates the file, or serialize() which overwrites.
  if (!resume && outputDir) {
    const { rmSync, writeFileSync } = await import('fs');
    try { rmSync(`${outputDir}/media`, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(`${outputDir}/redirect-map.json`, { force: true }); } catch { /* ignore */ }
    try { rmSync(`${outputDir}/media-stubs.json`, { force: true }); } catch { /* ignore */ }
    try { writeFileSync(log.logPath, ''); } catch { /* ignore */ }
  }

  if (mediaDir) {
    const { mkdirSync } = await import('fs');
    mkdirSync(mediaDir, { recursive: true });
  }

  const seenMediaNames = new Map<string, number>();
  const seenMediaHashes = new Map<string, string>();
  const downloadedMediaUrls = new Set<string>();
  // Per-asset status survives across runs: permanent failures stop retrying,
  // user-marked `ignored` URLs are skipped forever.
  const mediaStubs = outputDir ? MediaStubStore.load(outputDir) : null;
  /** Map from local file path to WXR media ID — used to deduplicate byte-identical files */
  const mediaPathToId = new Map<string, number>();

  // On resume, rebuild the hash map from existing media files
  if (resume && mediaDir) {
    const { readdirSync, readFileSync: readFs } = await import('fs');
    const { createHash } = await import('crypto');
    try {
      for (const file of readdirSync(mediaDir)) {
        const filePath = `${mediaDir}/${file}`;
        const hash = createHash('sha256').update(readFs(filePath)).digest('hex');
        seenMediaHashes.set(hash, filePath);
        seenMediaNames.set(file, 1);
      }
    } catch {
      // media dir may not exist yet
    }
  }

  // Determine which URLs to process
  const totalUrls = inventoryUrls.length;
  let typedUrls = inventoryUrls.slice();
  let alreadyProcessed = 0;
  if (resume) {
    const processed = log.getProcessedUrls();
    alreadyProcessed = processed.size;
    typedUrls = typedUrls.filter((u) => !processed.has(u.url));
  }
  // Apply URL cap. Explicit `limit` wins over dryRun's implicit 3-URL cap so
  // a `--limit N` (with or without --dry-run) processes exactly N URLs.
  // The cap is *stratified* across content types (see stratifiedUrlSlice) so a
  // limited extraction of a multi-type site (e.g. a Shopify store) still
  // includes products/posts rather than exhausting the budget on `/pages/*`.
  //
  // Primary-nav targets are PINNED into the slice so the reconstructed menu
  // never points at a page the cap dropped. We match captured nav hrefs to
  // inventory URLs by same-origin pathname (nav hrefs are absolutized in
  // extractNavLinks; off-site nav links won't match any inventory URL and are
  // simply not pinned).
  const navTargetUrls = navTargetInventoryUrls(navigation, typedUrls);
  const effectiveLimit = limit ?? (dryRun ? 3 : undefined);
  if (effectiveLimit !== undefined && effectiveLimit >= 0) {
    typedUrls = stratifiedUrlSlice(typedUrls, effectiveLimit, navTargetUrls);
  }
  let urls = typedUrls.map((u) => u.url);

  if (urls.length === 0) {
    return { pagesExtracted: 0, postsExtracted: 0, productsExtracted: 0, failed: 0, mediaCollected: 0 };
  }

  let pagesExtracted = 0;
  let postsExtracted = 0;
  let productsExtracted = 0;
  let failed = 0;

  // Track authors by name to avoid duplicates
  const authorSlugs = new Set<string>();

  // Source-faithful page/post slug claiming. The loop is the SINGLE owner of
  // the WP `post_name` so the redirect map and WXR slug never diverge: the
  // adapter's `pageData.slug` (often `slugify(url)` = `pages--about-us`) is
  // overridden with the last-path-segment slug (`about-us`), collision-suffixed.
  // This is intentionally distinct from the screenshot/manifest `slugify`
  // filename convention, which stays untouched.
  const claimedSlugs = new Map<string, number>();

  const sendLog = (message: string) => {
    try {
      server?.sendLoggingMessage?.({ level: 'info', data: message });
    } catch {
      // logging not available
    }
  };

  interface FetchResult {
    url: string;
    pageData: ExtractedPage | null;
    elapsedMs: number;
    error: string | null;
  }

  let cursor = 0;
  while (cursor < urls.length) {
    const batchSize = tuner.getPageConcurrency();
    const batch = urls.slice(cursor, cursor + batchSize);

    // Phase 1: Log what we're about to fetch
    for (let j = 0; j < batch.length; j++) {
      sendLog(`[${alreadyProcessed + cursor + j + 1}/${alreadyProcessed + urls.length}] Extracting: ${batch[j]}`);
    }

    // Phase 2: Concurrent page fetches
    const fetchResults: FetchResult[] = await Promise.all(
      batch.map(async (url): Promise<FetchResult> => {
        const pageStart = Date.now();
        try {
          const pageData = await extractPage(url);
          return { url, pageData, elapsedMs: Date.now() - pageStart, error: null };
        } catch (err) {
          return { url, pageData: null, elapsedMs: Date.now() - pageStart, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );

    // Phase 3: Feed timing to tuner — treat batch errors as a single
    // compound event to avoid multiplicative backoff (N errors in one
    // batch would otherwise multiply the delay by 2^N).
    const batchHasErrors = fetchResults.some((r) => r.error);
    if (batchHasErrors) {
      tuner.recordPageError();
      if (verbose) {
        const errorCount = fetchResults.filter((r) => r.error).length;
        sendLog(`  [tuner] page delay: → ${tuner.getPageDelay()}ms (error backoff — ${errorCount}/${fetchResults.length} failed)`);
      }
    }
    for (const result of fetchResults) {
      if (!result.error) {
        const pageElapsed = result.elapsedMs / 1000;
        const pageDecision = tuner.recordPageResult({ elapsed: pageElapsed });
        if (verbose && tuner.lastDebug) {
          const d = tuner.lastDebug;
          sendLog(`  [tuner:debug] page: elapsed=${d.elapsed.toFixed(2)}s throughput=${d.throughput.toFixed(2)} ema=${d.ema?.toFixed(2) ?? 'null'} ratio=${d.ratio?.toFixed(2) ?? 'n/a'} → ${d.decision}`);
        }
        if (verbose && (pageDecision === 'increase' || pageDecision === 'decrease')) {
          sendLog(`  [tuner] page delay: → ${tuner.getPageDelay()}ms (${pageDecision})`);
        }
      }
    }

    // Phase 4: Process each page sequentially (media, WXR, logging)
    for (let j = 0; j < fetchResults.length; j++) {
      const { url, pageData, error: fetchError } = fetchResults[j];
      const i = cursor + j; // running index for checkpoints
      const startMs = Date.now();
      const itemCountBefore = wxr.items.length;

      if (fetchError || !pageData) {
        failed++;
        const errorMsg = fetchError || 'Unknown error';
        log.logFailed({ url, error: errorMsg });
        sendLog(`  FAILED: ${errorMsg}`);

        if (session) {
          const invEntry = inventoryUrls.find((u) => u.url === url);
          const failType = invEntry?.type || classifyUrl(url);
          const bumpType = failType === 'product' ? 'product' : (failType === 'post' || failType === 'blog-post') ? 'post' : 'page';
          session.bumpProgress(bumpType, 'failed');
          session.save();
        }
        continue;
      }

      // Download media for this page concurrently
      let featuredMediaId: number | undefined;
      if (!dryRun && mediaDir) {
        const mediaConcurrency = tuner.getMediaConcurrency();

        // Filter to new URLs and mark them as seen immediately to prevent
        // duplicates from other pages queueing the same URL
        const newMediaUrls: string[] = [];
        for (const mediaUrl of pageData.mediaUrls) {
          if (downloadedMediaUrls.has(mediaUrl)) continue;
          // Fonts belong in the reconstructed theme's assets/fonts/, not the WP media
          // library. Skip them here so they never enter the uploads/media pipeline (which
          // would mangle their CSS url() into localhost-absolute uploads paths). The carry
          // path self-hosts fonts independently (carry-fonts.ts).
          if (isFontUrl(mediaUrl)) { downloadedMediaUrls.add(mediaUrl); continue; }
          // Respect persistent stub state: skip permanently-failed / ignored
          // URLs so resume runs don't burn cycles retrying them.
          if (mediaStubs && !mediaStubs.shouldAttempt(mediaUrl)) {
            downloadedMediaUrls.add(mediaUrl);
            const prior = mediaStubs.get(mediaUrl);
            if (prior?.status === 'success' && prior.localPath) {
              // Reuse the existing file. If this run's WXR doesn't yet have a
              // media item for this path, register it now — otherwise resume
              // runs would emit WXR without any <wp:attachment> entries for
              // media downloaded on prior runs.
              let mediaId = mediaPathToId.get(prior.localPath);
              if (!mediaId) {
                mediaId = wxr.addMedia({
                  url: mediaUrl,
                  localPath: prior.localPath,
                  title: prior.localPath.split('/').pop() || '',
                });
                mediaPathToId.set(prior.localPath, mediaId);
                if (wxr.isStreaming) {
                  wxr.flushItem(wxr.items[wxr.items.length - 1]);
                }
              }
              if (!featuredMediaId) featuredMediaId = mediaId;
            }
            continue;
          }
          downloadedMediaUrls.add(mediaUrl);
          newMediaUrls.push(mediaUrl);
        }

        // Download media in batches
        for (let mBatch = 0; mBatch < newMediaUrls.length; mBatch += mediaConcurrency) {
          const chunk = newMediaUrls.slice(mBatch, mBatch + mediaConcurrency);
          const mediaBatchStart = Date.now();
          const results = await Promise.all(
            // svgRaster: this is the media-LIBRARY path, so fetched SVGs get a
            // PNG sibling + risky scan for install-time routing (fonts never
            // reach here — isFontUrl filtered them above).
            chunk.map((mediaUrl) => downloadMedia(mediaUrl, mediaDir, seenMediaNames, seenMediaHashes, { svgRaster: true })
              .then((r) => ({ mediaUrl, ...r })))
          );
          const mediaBatchElapsed = (Date.now() - mediaBatchStart) / 1000;
          // Exclude deduped files (bytes=0, no error) from throughput — they
          // resolve instantly from the hash cache and would skew the EMA.
          const mediaBatchBytes = results.reduce((sum, r) => sum + (r.bytes ?? 0), 0);
          const mediaBatchErrors = results.filter((r) => r.error).length;
          const mediaBatchActualDownloads = results.filter((r) => !r.error && (r.bytes ?? 0) > 0).length;
          if (
            mediaBatchErrors >= TUNER_DEFAULTS.mediaErrorMinCount &&
            mediaBatchErrors > chunk.length * TUNER_DEFAULTS.mediaErrorRatio
          ) {
            tuner.recordMediaError();
            if (verbose) {
              sendLog(`  [tuner] media concurrency: → ${tuner.getMediaConcurrency()} (error — ${mediaBatchErrors}/${chunk.length} failed)`);
            }
          } else if (mediaBatchActualDownloads > 0) {
            // Only feed throughput when real downloads occurred — skip
            // all-dedup batches to avoid skewing the EMA with instant results.
            const mediaDecision = tuner.recordMediaResult({ elapsed: mediaBatchElapsed, bytesDownloaded: mediaBatchBytes });
            if (verbose && tuner.lastDebug) {
              const d = tuner.lastDebug;
              sendLog(`  [tuner:debug] media: elapsed=${d.elapsed.toFixed(2)}s bytes=${d.workDone} throughput=${d.throughput.toFixed(0)} ema=${d.ema?.toFixed(0) ?? 'null'} ratio=${d.ratio?.toFixed(2) ?? 'n/a'} → ${d.decision}`);
            }
            if (verbose && (mediaDecision === 'increase' || mediaDecision === 'decrease')) {
              sendLog(`  [tuner] media concurrency: → ${tuner.getMediaConcurrency()} (${mediaDecision})`);
            }
          }

          // Process results sequentially — WXR builder and log are not concurrent-safe
          for (const result of results) {
            if (!result.error && result.localPath) {
              const existingId = mediaPathToId.get(result.localPath);
              if (existingId) {
                if (!featuredMediaId) featuredMediaId = existingId;
              } else {
                const mediaId = wxr.addMedia({
                  url: result.mediaUrl,
                  localPath: result.localPath,
                  title: result.filename || '',
                });
                mediaPathToId.set(result.localPath, mediaId);
                if (wxr.isStreaming) {
                  wxr.flushItem(wxr.items[wxr.items.length - 1]);
                }
                if (!featuredMediaId) featuredMediaId = mediaId;
              }
            }
            log.logMedia({
              url: result.mediaUrl,
              localPath: result.localPath,
              error: result.error,
            });
            if (mediaStubs) {
              if (result.error) {
                mediaStubs.markFailure(result.mediaUrl, result.error);
              } else if (result.localPath) {
                // Carry the SVG raster fields (PNG sibling path, risky scan,
                // raster error) onto the stub — install-time routing reads them.
                const svgExtra =
                  result.svgRisky !== undefined || result.rasterPath || result.rasterError
                    ? { svgRisky: result.svgRisky, rasterPath: result.rasterPath, rasterError: result.rasterError }
                    : undefined;
                mediaStubs.markSuccess(result.mediaUrl, result.localPath, svgExtra);
              }
            }
          }
        }
      }

      // Determine type: adapter signal > inventory > JSON-LD > URL pattern
      const invEntry = inventoryUrls.find((u) => u.url === url);
      let urlType = pageData.detectedType || invEntry?.type || classifyUrl(url);

      // If still classified as a page, check top-level JSON-LD for blog post
      // signals. We require a proper top-level @type of BlogPosting/Article
      // AND (when present) mainEntityOfPage matching the current URL. This
      // avoids promoting blog listing pages that embed BlogPosting cards for
      // each post they display.
      if (urlType === 'page' || urlType === 'homepage') {
        const BLOG_TYPES = new Set(['BlogPosting', 'NewsArticle', 'Article', 'SocialMediaPosting']);
        const isRealBlogPost = Array.isArray(pageData.jsonLd) && pageData.jsonLd.some((ld) => {
          if (!ld || typeof ld !== 'object') return false;
          const obj = ld as Record<string, unknown>;
          const atType = obj['@type'];
          if (typeof atType !== 'string' || !BLOG_TYPES.has(atType)) return false;
          const mep = obj.mainEntityOfPage;
          if (mep && typeof mep === 'object') {
            const mepRec = mep as Record<string, unknown>;
            const mepUrl = typeof mepRec.url === 'string' ? mepRec.url :
                           typeof mepRec['@id'] === 'string' ? mepRec['@id'] as string : null;
            if (mepUrl && mepUrl !== url) return false;
          }
          return true;
        });
        if (isRealBlogPost) urlType = 'post';
      }

      const isPost = urlType === 'post' || urlType === 'blog-post';
      const isProduct = urlType === 'product';

      // Product detection — try platform-specific extractor, then generic JSON-LD
      if (isProduct && csvBuilder && !dryRun) {
        const product = extractProduct?.(url, pageData.content)
          ?? extractProductFromHtml(pageData.content, url);
        if (product) {
          csvBuilder.addProduct(product);
          productsExtracted++;
        }
      }

      const cleanContent = stripNonContentTags(pageData.content);

      // Derive the source-faithful WP slug from the URL (last path segment),
      // collision-suffixed. Products are CSV-only (no WP post_name), so only
      // claim for pages/posts. The claimed slug is authoritative for the WXR
      // `post_name` and the redirect-map target.
      //
      // NOTE: `pageData.slug` (= `slugify(url)`, the `--`-joined path) is the
      // SCREENSHOT/MANIFEST filename convention and MUST stay that way for the
      // `onPageExtracted` callback and `log.logProcessed` below — the watch
      // loop joins those back to `html/<slug>.html` + `screenshots/.../<slug>.png`.
      const pageSlug = (isProduct && csvBuilder)
        ? pageData.slug
        : claimSlug(pageSlugFromUrl(url), claimedSlugs);

      // Register author if present
      let authorLogin: string | undefined;
      if (pageData.author) {
        authorLogin = pageData.author.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || undefined;
        if (authorLogin && !authorSlugs.has(authorLogin)) {
          authorSlugs.add(authorLogin);
          wxr.addAuthor({ login: authorLogin, displayName: pageData.author });
        }
      }

      if (isProduct && csvBuilder) {
        // Products are handled via WooCommerce CSV — don't also add as pages
      } else if (isPost) {
        wxr.addPost({
          title: pageData.title,
          slug: pageSlug,
          content: cleanContent,
          excerpt: pageData.excerpt,
          date: pageData.date,
          seoTitle: pageData.seoTitle,
          seoDescription: pageData.seoDescription,
          sourceUrl: url,
          featuredMediaId,
          categories: pageData.categories,
          tags: pageData.tags,
          author: authorLogin,
        });
        postsExtracted++;
      } else {
        wxr.addPage({
          title: pageData.title,
          slug: pageSlug,
          content: cleanContent,
          excerpt: pageData.excerpt,
          date: pageData.date,
          seoTitle: pageData.seoTitle,
          seoDescription: pageData.seoDescription,
          sourceUrl: url,
        });
        pagesExtracted++;
      }

      // Flush the page/post item to WXR immediately (skip for products — they're CSV-only)
      if (!(isProduct && csvBuilder)) {
        if (wxr.isStreaming) {
          wxr.flushItem(wxr.items[wxr.items.length - 1]);
        }

        // Add redirect (and source→local-permalink mapping) from the original
        // source path to the local WP permalink. `to` is the pretty-permalink
        // form `/<slug>/` so the nav-href remap (theme-scaffold) and WP's own
        // trailing-slash permalinks agree. This redirect-map.json doubles as
        // the source-URL → local-permalink map consumed by the header builder.
        try {
          const originalPath = new URL(url).pathname;
          const localPermalink = `/${pageSlug}/`;
          if (originalPath && originalPath !== '/' && originalPath !== localPermalink) {
            wxr.addRedirect({ from: originalPath, to: localPermalink });
          }
        } catch {
          // URL parsing failed
        }
      }

      const durationMs = Date.now() - startMs;
      log.logProcessed({
        url,
        slug: pageData.slug,
        durationMs,
        qualityScore: pageData.qualityScore,
      });

      if (session) {
        const bumpType = isProduct ? 'product' : isPost ? 'post' : 'page';
        session.bumpProgress(bumpType, 'extracted');
        if ((i + 1) % 10 === 0) {
          session.setCursor('adaptive-tuner', tuner.getState());
          session.save();
          mediaStubs?.flush();
        }
      }

      if (verbose) {
        sendLog(
          `  media: ${pageData.mediaUrls.length}, quality: ${pageData.qualityScore}, ${durationMs}ms`
        );
      }

      if (onPageExtracted) {
        // Streaming consumers install media from MediaStubStore, so make the
        // just-downloaded media visible on disk before firing the callback.
        mediaStubs?.flush();
        try {
          await onPageExtracted({
            url,
            slug: pageData.slug,
            type: urlType as PageExtractedEvent['type'],
            items: wxr.items.slice(itemCountBefore),
            mediaUrls: pageData.mediaUrls,
          });
        } catch (err) {
          sendLog(`  [warn] onPageExtracted failed for ${url}: ${(err as Error).message}`);
        }
      }
    }

    // Persist tuner state after each batch so short runs and crashes
    // don't lose learned pacing. The every-10-items checkpoint inside
    // Phase 4 covers long runs; this covers the tail.
    if (session) {
      session.setCursor('adaptive-tuner', tuner.getState());
    }

    // Delay once per batch (skip after last batch)
    const currentDelay = tuner.getPageDelay();
    if (cursor + batch.length < urls.length && currentDelay > 0) {
      await sleep(currentDelay);
    }

    cursor += batch.length;
  }

  // Add navigation as menu items
  for (let i = 0; i < navigation.length; i++) {
    const nav = navigation[i];
    wxr.addMenuItem({
      title: nav.text,
      url: nav.href,
      menuSlug: 'main-menu',
      order: i + 1,
    });
    if (wxr.isStreaming) {
      wxr.flushItem(wxr.items[wxr.items.length - 1]);
    }
  }

  if (session) {
    session.setStage('finalizing');
  }
  mediaStubs?.flush();

  sendLog(`[tuner] Final state: page delay=${tuner.getPageDelay()}ms, media concurrency=${tuner.getMediaConcurrency()}`);

  return {
    pagesExtracted,
    postsExtracted,
    productsExtracted,
    failed,
    mediaCollected: downloadedMediaUrls.size,
  };
}
