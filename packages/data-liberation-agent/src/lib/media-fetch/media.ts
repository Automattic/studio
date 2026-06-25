import { createWriteStream, mkdirSync, readFileSync, statSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { basename, extname, join, resolve } from 'path';
import { pipeline } from 'stream/promises';
import {
  assertPublicHttpUrl,
  BodyTooLargeError,
  MAX_DOWNLOAD_BYTES,
  MAX_REDIRECTS,
} from './safe-fetch.js';
import { Transform } from 'stream';
import { isRiskySvg, rasterizeSvg } from './svg-raster.js';

export interface DownloadResult {
  url: string;
  localPath: string | null;
  filename: string | null;
  error: string | null;
  bytes: number;
  /** True when a fetched SVG contains <use>/<defs> (Safe SVG sanitizer risk). Only set with opts.svgRaster. */
  svgRisky?: boolean;
  /** Local path of the rasterized PNG sibling for a fetched SVG. Only set with opts.svgRaster. */
  rasterPath?: string;
  /** Why PNG rasterization failed (non-fatal — the SVG download itself succeeded). */
  rasterError?: string;
}

export interface DownloadMediaOpts {
  /**
   * Rasterize a PNG sibling (and run the risky <use>/<defs> scan) for fetched
   * SVGs. Opt-in: only the media-LIBRARY download path (extraction loop in
   * adapters/shared.ts) wants this — theme-asset/CSS fetchers (carry paths,
   * watch-runner) bypass the WP media library and must not pay a Chromium
   * launch per run.
   */
  svgRaster?: boolean;
}

export function safeFilename(filename: string, seenNames: Map<string, number>): string {
  if (!filename) {
    filename = `image-${Date.now()}`;
  }

  if (!seenNames.has(filename)) {
    seenNames.set(filename, 1);
    return filename;
  }

  const ext = extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;

  let count = (seenNames.get(filename) as number) + 1;
  let candidate = ext ? `${base}-${count}${ext}` : `${base}-${count}`;

  // Ensure generated name doesn't collide with an existing original filename
  while (seenNames.has(candidate)) {
    count++;
    candidate = ext ? `${base}-${count}${ext}` : `${base}-${count}`;
  }

  seenNames.set(filename, count);
  seenNames.set(candidate, 1);
  return candidate;
}

export function resolveMediaPath(filename: string, outputDir: string): string {
  const resolvedDir = resolve(outputDir) + '/';
  const resolved = resolve(outputDir, filename);
  if (!resolved.startsWith(resolvedDir) && resolved !== resolve(outputDir)) {
    throw new Error(`Path traversal detected: ${filename}`);
  }
  return resolved;
}

// Some CDNs encode image transforms directly in the URL path after a `/:/`
// segment marker (e.g. GoDaddy W+M's img1.wsimg.com: `/isteam/ip/<uuid>/
// <filename>.jpg/:/rs=w:4000,cg:true`). The real filename lives in the segment
// *before* `/:/`, not after. basename(pathname) returns the transform spec
// which is useless as a filename. Detect the marker and use the preceding
// segment instead.
// Make a derived filename safe for the download→WP-upload→serve→rewrite chain.
// Spaces and %-encoding (common in Wix CDN paths like `logo%20white.png`) break
// the served path and the source→local rewrite match, so slugify the base
// (decode first, then spaces/unsafe chars → '-') while preserving the extension.
export function sanitizeMediaFilename(name: string): string {
  if (!name) return name;
  let decoded = name;
  try { decoded = decodeURIComponent(name); } catch { /* malformed escape — keep raw */ }
  const ext = extname(decoded);
  const base = ext ? decoded.slice(0, -ext.length) : decoded;
  const safeBase = base
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '') || 'image';
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '');
  return `${safeBase}${safeExt}`;
}

export function deriveFilenameFromUrl(urlObj: URL): string {
  const path = urlObj.pathname;
  const marker = path.indexOf('/:/');
  const effectivePath = marker >= 0 ? path.slice(0, marker) : path;
  return sanitizeMediaFilename(basename(effectivePath));
}

/** Cap on an upgraded image's longest edge — keeps retina upscaling from pulling
 *  multi-megapixel originals for a small slot. */
const MEDIA_UPGRADE_MAX_DIM = 2000;

/**
 * Upgrade a CDN image URL to a higher-resolution variant for crisp (retina)
 * rendering, WITHOUT changing the derived filename or the URL's identity as a
 * map key (the caller still keys media on the ORIGINAL url; only the fetched
 * BYTES are higher-res). Returns the url unchanged when no rule applies.
 *
 * Platform rule — Wix (`static.wixstatic.com`): the served size is encoded in the
 * `/v1/{fill,fit,crop}/…w_W,h_H,…/` transform, and the captured URL carries the
 * small DISPLAY size (e.g. w_679,h_381), so the downloaded file is low-res and
 * looks soft when shown at 1× on a HiDPI display. We scale w_/h_ by 2× (both by
 * the SAME factor so the fill aspect/crop is preserved), capped at
 * MEDIA_UPGRADE_MAX_DIM. NOTE: stripping the transform does NOT help — the bare
 * media URL serves a small default variant, so a larger fill is required.
 */
export function upgradeMediaUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('wixstatic.com')) return url;
    // Target the LAST w_/h_ pair — the OUTPUT (fill/fit) dimensions. In a
    // `/v1/crop/x,y,w,h/fill/w,h/` URL the FIRST w_/h_ are the crop REGION
    // coords (relative to the master); scaling those pushes the crop out of
    // bounds and the CDN returns a garbage fragment. The output dims are always
    // last in Wix's path order, and for a plain `/fill/w,h/` URL the last pair
    // is the only pair, so this is correct in both shapes.
    const wMatches = [...u.pathname.matchAll(/\bw_(\d+)/g)];
    const hMatches = [...u.pathname.matchAll(/\bh_(\d+)/g)];
    if (wMatches.length === 0 && hMatches.length === 0) return url;
    const w = wMatches.length ? Number(wMatches[wMatches.length - 1][1]) : 0;
    const h = hMatches.length ? Number(hMatches[hMatches.length - 1][1]) : 0;
    const longest = Math.max(w, h);
    if (!longest) return url;
    const scale = Math.min(2, MEDIA_UPGRADE_MAX_DIM / longest);
    if (scale <= 1) return url; // already at/above the cap — leave it
    // Replace only the LAST occurrence of each (greedy `.*` consumes earlier
    // crop-region coords, leaving them untouched).
    u.pathname = u.pathname
      .replace(/^(.*)\bw_(\d+)/, (_m, pre: string, d: string) => `${pre}w_${Math.round(Number(d) * scale)}`)
      .replace(/^(.*)\bh_(\d+)/, (_m, pre: string, d: string) => `${pre}h_${Math.round(Number(d) * scale)}`);
    return u.toString();
  } catch {
    return url;
  }
}

// Map common image content-types to file extensions. Used when the URL
// provides no extension (e.g. `/isteam/getty/<numeric-id>`).
export function extensionFromContentType(contentType: string): string {
  const ct = contentType.toLowerCase().split(';')[0].trim();
  switch (ct) {
    case 'image/jpeg': case 'image/jpg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    case 'image/avif': return '.avif';
    case 'image/svg+xml': return '.svg';
    case 'image/bmp': return '.bmp';
    case 'image/tiff': return '.tiff';
    case 'image/x-icon': case 'image/vnd.microsoft.icon': return '.ico';
    default: return '';
  }
}

const FONT_EXT_RE = /\.(woff2|woff|ttf|otf|eot)(?:[?#]|$)/i;

/**
 * Whether a URL points at a font file (by extension or a Wix `/ufonts/` path).
 * Fonts belong in the reconstructed theme's `assets/fonts/` (the carry path downloads
 * them there), not the WP media library — so the extraction media loop skips them.
 * Letting fonts into the media pipeline also mangles their CSS `url()` into
 * localhost-absolute uploads URLs via the media rewrite (the leak carry-fonts.ts then
 * has to copy back out).
 */
export function isFontUrl(url: string): boolean {
  return FONT_EXT_RE.test(url) || /\/ufonts\//i.test(url);
}

/**
 * SSRF-safe media fetch: validates the (attacker-controlled) media URL and
 * every redirect target against internal hosts, follows redirects manually
 * (capped), and returns the final Response for streaming. Throws on a blocked
 * host or too-many-redirects.
 */
async function fetchMediaResponse(rawUrl: string): Promise<Response> {
  let currentUrl = assertPublicHttpUrl(rawUrl).toString();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(currentUrl, {
      signal: AbortSignal.timeout(30000),
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (!location) throw new Error(`redirect ${res.status} with no Location header`);
      if (hop === MAX_REDIRECTS) throw new Error(`too many redirects (> ${MAX_REDIRECTS})`);
      // Re-validate every redirect target so a public URL can't 302 internal.
      currentUrl = assertPublicHttpUrl(new URL(location, currentUrl).toString()).toString();
      continue;
    }
    return res;
  }
  throw new Error(`too many redirects (> ${MAX_REDIRECTS})`);
}

/**
 * Raster outcome per downloaded SVG local path, so a later byte-identical
 * duplicate (content-hash dedup) can inherit the ORIGINAL's PNG-sibling fields
 * instead of leaving its stub raster-blind. Module-level on purpose: the
 * seenHashes map is caller-owned and string-valued, and entries are a few
 * hundred bytes per unique SVG per process — bounded by run size.
 */
const svgExtrasByLocalPath = new Map<string, Pick<DownloadResult, 'svgRisky' | 'rasterPath' | 'rasterError'>>();

export async function downloadMedia(
  url: string,
  outputDir: string,
  seenNames: Map<string, number>,
  seenHashes?: Map<string, string>,
  opts?: DownloadMediaOpts,
): Promise<DownloadResult> {
  try {
    // assertPublicHttpUrl (inside fetchMediaResponse) is the SSRF gate; parse
    // here only to derive the filename. Reject non-http(s)/internal up front so
    // the filename derivation never runs on a blocked URL.
    const urlObj = assertPublicHttpUrl(url);
    let rawFilename = deriveFilenameFromUrl(urlObj) || `image-${Date.now()}.jpg`;

    mkdirSync(outputDir, { recursive: true });

    // Fetch a higher-resolution variant when the CDN URL carries a small display
    // size (e.g. Wix fill transforms), but keep the filename/key derived from the
    // ORIGINAL url so the source→local rewrite map stays consistent. No-op for
    // URLs without a known upgrade rule.
    const response = await fetchMediaResponse(upgradeMediaUrl(url));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Reject an over-size body via Content-Length before streaming a byte.
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
        try { await response.body?.cancel(); } catch { /* ignore */ }
        throw new BodyTooLargeError(
          `media body ${declared} bytes exceeds max ${MAX_DOWNLOAD_BYTES} (Content-Length)`,
        );
      }
    }

    // If the derived filename has no extension, add one from the response
    // content-type. Skipped entirely for URLs that already carried a real
    // filename like `follow_guidelines.jpg`.
    //
    // Extension-less URLs are how page-builder CDNs (Replo's
    // assets.replocdn.com, Shogun, image-resizing proxies) serve images — the
    // path is a bare id with the format negotiated via content-type. We accept
    // those, but REJECT an extension-less response whose content-type is NOT an
    // image so a stray HTML/redirect page can't land in the media library as
    // junk bytes. (URLs that already carry a real image extension are trusted.)
    if (!extname(rawFilename)) {
      const ct = response.headers.get('content-type') || '';
      const ext = extensionFromContentType(ct);
      if (!ext) {
        await response.body?.cancel();
        throw new Error(`non-image content-type "${ct || 'unknown'}" for extension-less URL`);
      }
      rawFilename = `${rawFilename}${ext}`;
    }

    const filename = safeFilename(rawFilename, seenNames);
    const destPath = resolveMediaPath(filename, outputDir);

    // Stream to disk with a running byte counter so a body that lies about (or
    // omits) Content-Length still can't fill the disk — abort + delete the
    // partial file if the cap is exceeded.
    let written = 0;
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        if (written > MAX_DOWNLOAD_BYTES) {
          cb(new BodyTooLargeError(`media body exceeds max ${MAX_DOWNLOAD_BYTES} bytes (streamed)`));
          return;
        }
        cb(null, chunk);
      },
    });
    const fileStream = createWriteStream(destPath);
    try {
      await pipeline(response.body as unknown as NodeJS.ReadableStream, sizeGuard, fileStream);
    } catch (streamErr) {
      // Remove the partial file on any streaming failure (size cap or otherwise).
      try { unlinkSync(destPath); } catch { /* ignore */ }
      throw streamErr;
    }

    // Deduplicate byte-identical files by content hash. The buffer is kept so
    // the SVG raster step below can scan it without a second disk read.
    let fileBytes: Buffer | null = null;
    if (seenHashes) {
      fileBytes = readFileSync(destPath);
      const hash = createHash('sha256').update(fileBytes).digest('hex');
      const existing = seenHashes.get(hash);
      if (existing) {
        // Duplicate — remove the new file and return the existing path. No NEW
        // raster needed: the first download of these bytes already produced
        // the PNG sibling — carry its raster fields onto THIS result too, so
        // the deduped URL's stub records the REAL sibling path. (Install-time
        // basename derivation cannot be trusted instead: a name collision can
        // suffix-bump the original's sibling to `-2.png`, and deriving
        // `<base>.png` then silently picks up an unrelated asset's file.)
        try { unlinkSync(destPath); } catch { /* ignore */ }
        const original = svgExtrasByLocalPath.get(existing);
        return { url, localPath: existing, filename: basename(existing), error: null, bytes: 0, ...original };
      }
      seenHashes.set(hash, destPath);
    }

    // SVG survival (opt-in, media-library path only): scan for Safe-SVG-risky
    // <use>/<defs> constructs and rasterize a PNG sibling that install-time
    // routing can substitute when the SVG can't land in the library. Wrapped
    // so NO failure here (read, scan, raster) can fail the completed fetch.
    let svgExtras: Pick<DownloadResult, 'svgRisky' | 'rasterPath' | 'rasterError'> | undefined;
    if (opts?.svgRaster && extname(filename).toLowerCase() === '.svg') {
      try {
        const svgBytes = fileBytes ?? readFileSync(destPath);
        const svgRisky = isRiskySvg(svgBytes);
        // Sibling name: same basename + .png, deduped through the shared
        // seenNames map so a DIFFERENT asset already named `<base>.png` pushes
        // the sibling to the standard -2 suffix.
        const ext = extname(filename);
        const pngFilename = safeFilename(`${filename.slice(0, -ext.length)}.png`, seenNames);
        const pngPath = resolveMediaPath(pngFilename, outputDir);
        const raster = await rasterizeSvg(destPath, pngPath);
        svgExtras = raster.ok
          ? { svgRisky, rasterPath: pngPath }
          : { svgRisky, rasterError: raster.error };
      } catch (rasterErr) {
        svgExtras = { rasterError: (rasterErr as Error).message };
      }
      // Remember the raster outcome by local path so a later byte-identical
      // duplicate (dedup hit above) inherits the original's sibling fields.
      if (svgExtras) svgExtrasByLocalPath.set(destPath, svgExtras);
    }

    const bytes = statSync(destPath).size;
    return { url, localPath: destPath, filename, error: null, bytes, ...svgExtras };
  } catch (err) {
    return { url, localPath: null, filename: null, error: (err as Error).message, bytes: 0 };
  }
}
