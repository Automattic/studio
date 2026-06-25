/**
 * Download carried-HTML images that extraction missed (carry-and-scope path).
 * ===========================================================================
 * The repoint pass (carry-responsive-assemble.ts) self-hosts every image whose
 * Wix media-id has SOME downloaded variant. But a rendered page can reference an
 * image the extraction media-collection never captured at all (e.g. a pro-gallery
 * lightbox/full-size asset only present in the carried DOM) — that asset has NO
 * local copy, so repoint has nothing to point at and the ref ships as a live CDN
 * dependency.
 *
 * This pre-pass closes that hole: it scans the carried page HTML for image URLs
 * whose media-id is not yet in the run's media store, downloads ONE variant per
 * missing id (downloadMedia upgrades small Wix transforms to a higher-res source),
 * and registers a success stub. Run BEFORE installRunMediaMap so the new assets are
 * installed and enter the CDN→local map, after which the normal rewrite repoints
 * every reference (incl. other transforms of the same id) to the local copy.
 *
 * `selectMissingMediaDownloads` is the pure, tested core (what to fetch);
 * `fetchMissingCarriedMedia` is the thin I/O glue (mirrors adapters/shared.ts).
 */
import { join, resolve } from 'node:path';
import { downloadMedia } from '../media-fetch/index.js';
import { MediaStubStore } from '../resume-state/index.js';
import { mediaIdOf } from './responsive-image-rewrite.js';

const HTTP_URL = /^https?:\/\//i;
/** http(s) URLs inside img src, img/source srcset. srcset is "url descriptor, url descriptor". */
const IMG_SRC = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const SRCSET = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
const URL_LIKE = /https?:\/\/[^\s"'<>\\]+/g;

/** All distinct http(s) image URLs referenced by carried HTML (img src + any srcset). */
function collectCarriedImageUrls(html: string): string[] {
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  IMG_SRC.lastIndex = 0;
  while ((m = IMG_SRC.exec(html)) !== null) {
    if (HTTP_URL.test(m[1])) urls.add(m[1]);
  }
  SRCSET.lastIndex = 0;
  while ((m = SRCSET.exec(html)) !== null) {
    // srcset packs multiple URLs (each followed by a 1x/2x/width descriptor); Wix
    // transform URLs embed commas in their param segment, so pull whole URLs via
    // URL_LIKE rather than splitting on commas.
    let u: RegExpExecArray | null;
    const re = new RegExp(URL_LIKE.source, 'g');
    while ((u = re.exec(m[1])) !== null) urls.add(u[0]);
  }
  return [...urls];
}

/**
 * Pure: pick the image URLs to download — those referenced in `htmls` whose Wix
 * media-id is NOT already downloaded (`knownMediaIds`) and whose exact URL isn't a
 * known store key (`knownUrls`). Collapses to ONE URL per missing media-id (any
 * variant — downloadMedia fetches a high-res source). Non-Wix image URLs (no
 * media-id) are kept per-URL. data:/relative refs are ignored.
 */
export function selectMissingMediaDownloads(
  htmls: string[],
  knownMediaIds: Set<string>,
  knownUrls: Set<string>,
): string[] {
  const out: string[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  for (const html of htmls) {
    for (const url of collectCarriedImageUrls(html)) {
      if (knownUrls.has(url) || seenUrls.has(url)) continue;
      const id = mediaIdOf(url);
      if (id) {
        if (knownMediaIds.has(id) || seenIds.has(id)) continue;
        seenIds.add(id);
      }
      seenUrls.add(url);
      out.push(url);
    }
  }
  return out;
}

export interface MissingMediaResult {
  downloaded: number;
  failed: Array<{ url: string; error: string }>;
}

/**
 * I/O glue: download the missing carried images into the run media dir and register
 * success/failure stubs. Best-effort — a failed download (e.g. CDN 403) is recorded
 * and skipped, never throws (the caller's install + rewrite proceed for the rest).
 */
export async function fetchMissingCarriedMedia(
  outputDir: string,
  htmls: string[],
): Promise<MissingMediaResult> {
  const stubs = MediaStubStore.load(outputDir);
  const knownMediaIds = new Set<string>();
  const knownUrls = new Set<string>();
  for (const [url, stub] of stubs.list()) {
    if (stub.status !== 'success') continue;
    knownUrls.add(url);
    const id = mediaIdOf(url);
    if (id) knownMediaIds.add(id);
  }

  const toDownload = selectMissingMediaDownloads(htmls, knownMediaIds, knownUrls);
  if (toDownload.length === 0) return { downloaded: 0, failed: [] };

  const mediaDir = join(resolve(outputDir), 'media');
  const seenNames = new Map<string, number>();
  const seenHashes = new Map<string, string>();
  let downloaded = 0;
  const failed: Array<{ url: string; error: string }> = [];
  for (const url of toDownload) {
    const r = await downloadMedia(url, mediaDir, seenNames, seenHashes);
    if (!r.error && r.localPath) {
      stubs.markSuccess(url, r.localPath);
      downloaded++;
    } else {
      const error = r.error ?? 'unknown download error';
      stubs.markFailure(url, error);
      failed.push({ url, error });
    }
  }
  stubs.flush();
  return { downloaded, failed };
}
