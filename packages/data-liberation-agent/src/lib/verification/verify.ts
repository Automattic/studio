import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

export interface VerificationReport {
  outputDir: string;
  wxrFound: boolean;
  contentItems: number;
  pages: number;
  posts: number;
  mediaAttachments: number;
  mediaOnDisk: number;
  /**
   * Genuinely-risky CDN URLs: referenced in post/page CONTENT but with NO
   * locally-downloaded copy. Back-compat alias for `cdnInContentNoLocalCopy`.
   * These are the ones that may break when the source site changes.
   */
  staleCdnUrls: string[];
  /**
   * CDN URLs found in `<content:encoded>` that have NO successful media stub —
   * the real "images may break" set. Same as `staleCdnUrls`.
   */
  cdnInContentNoLocalCopy: string[];
  /**
   * CDN URLs found in `<content:encoded>` that DO have a successful media stub
   * (the asset is captured locally). This is a post_content rewrite gap, NOT a
   * breakage risk — the file exists in media/ and as a WXR attachment.
   */
  cdnInContentDownloadedNotRewritten: string[];
  failedUrls: Array<{ url: string; error: string }>;
  failedMedia: Array<{ url: string; error: string }>;
  redirectCount: number;
  qualityScores: { high: number; medium: number; low: number };
  manualAttentionItems: string[];
}

const STALE_CDN_PATTERNS = [
  /https?:\/\/[^\s"'<>]*wixstatic\.com[^\s"'<>]*/g,
  /https?:\/\/[^\s"'<>]*wixmp\.com[^\s"'<>]*/g,
  /https?:\/\/[^\s"'<>]*squarespace-cdn\.com[^\s"'<>]*/g,
  /https?:\/\/[^\s"'<>]*static\.squarespace\.com[^\s"'<>]*/g,
  /https?:\/\/[^\s"'<>]*assets\.squarespace\.com[^\s"'<>]*/g,
  /https?:\/\/[^\s"'<>]*cdn\.shopify\.com[^\s"'<>]*/g,
  /https?:\/\/[^\s"'<>]*assets-global\.website-files\.com[^\s"'<>]*/g,
];

/**
 * Collect CDN URLs that appear inside `<content:encoded>` (post/page bodies)
 * ONLY. Deliberately excludes `<wp:attachment_url>` — those are expected
 * provenance for downloaded-and-attached media, not a breakage risk. Scanning
 * the whole WXR (the old behavior) double-counted every downloaded image (once
 * as attachment_url, once as a content <img src>) and falsely flagged captured
 * assets as "may break".
 */
function scanContentForCdnUrls(wxrContent: string): string[] {
  const found = new Set<string>();
  const contentBlocks = wxrContent.match(/<content:encoded>\s*<!\[CDATA\[([\s\S]*?)\]\]>/g) || [];
  const allContent = contentBlocks.join('\n');
  for (const pattern of STALE_CDN_PATTERNS) {
    const matches = allContent.match(pattern) || [];
    for (const m of matches) found.add(m);
  }
  return [...found];
}

interface MediaStubFile {
  version?: number;
  stubs?: Record<string, { status?: string; localPath?: string }>;
}

/**
 * Set of media URLs that were successfully downloaded this run (a `success`
 * stub). Returns `null` when media-stubs.json is absent or unreadable — older
 * runs predate the store, so the caller degrades to "unknown" and keeps the
 * legacy behavior of treating every content CDN URL as potentially stale.
 */
function loadDownloadedMediaUrls(outputDir: string): Set<string> | null {
  const stubPath = join(outputDir, 'media-stubs.json');
  if (!existsSync(stubPath)) return null;
  try {
    const data = JSON.parse(readFileSync(stubPath, 'utf8')) as MediaStubFile;
    if (!data.stubs) return null;
    const downloaded = new Set<string>();
    for (const [url, stub] of Object.entries(data.stubs)) {
      if (stub?.status === 'success') downloaded.add(url);
    }
    return downloaded;
  } catch {
    return null;
  }
}

/**
 * Bucket content-referenced CDN URLs by whether the run captured a local copy.
 * - `noLocalCopy`: in content, NO success stub → genuine breakage risk.
 * - `downloadedNotRewritten`: in content, HAS a success stub → rewrite gap only.
 * When `downloaded` is null (no media-stubs.json), every URL is treated as
 * no-local-copy to preserve legacy behavior on older runs.
 */
function bucketContentCdnUrls(
  contentCdnUrls: string[],
  downloaded: Set<string> | null,
): { noLocalCopy: string[]; downloadedNotRewritten: string[] } {
  const noLocalCopy: string[] = [];
  const downloadedNotRewritten: string[] = [];
  for (const url of contentCdnUrls) {
    if (downloaded && downloaded.has(url)) downloadedNotRewritten.push(url);
    else noLocalCopy.push(url);
  }
  return { noLocalCopy, downloadedNotRewritten };
}

function parseExtractionLog(logPath: string): {
  failedUrls: Array<{ url: string; error: string }>;
  failedMedia: Array<{ url: string; error: string }>;
  qualityScores: { high: number; medium: number; low: number };
} {
  const failedUrls: Array<{ url: string; error: string }> = [];
  const failedMedia: Array<{ url: string; error: string }> = [];
  const qualityScores = { high: 0, medium: 0, low: 0 };
  if (!existsSync(logPath)) return { failedUrls, failedMedia, qualityScores };
  const content = readFileSync(logPath, 'utf8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type: string; url?: string; error?: string; qualityScore?: string; };
      if (entry.type === 'failed' && entry.url) failedUrls.push({ url: entry.url, error: entry.error || 'unknown' });
      if (entry.type === 'media_failed' && entry.url) failedMedia.push({ url: entry.url, error: entry.error || 'unknown' });
      if (entry.type === 'processed' && entry.qualityScore) {
        const score = entry.qualityScore as keyof typeof qualityScores;
        if (score in qualityScores) qualityScores[score]++;
      }
    } catch { /* skip malformed lines */ }
  }
  return { failedUrls, failedMedia, qualityScores };
}

function countWxrItems(wxrContent: string): { pages: number; posts: number; media: number } {
  // Match BOTH the CDATA-wrapped form (<wp:post_type><![CDATA[page]]></wp:post_type>)
  // AND the plain-text form (<wp:post_type>page</wp:post_type>) — the WXR builder
  // emits the plain form, so a CDATA-only regex counted 0 on real output.
  const countType = (type: string): number =>
    (wxrContent.match(new RegExp(`<wp:post_type>\\s*(?:<!\\[CDATA\\[)?${type}(?:\\]\\]>)?\\s*</wp:post_type>`, 'g')) || []).length;
  return { pages: countType('page'), posts: countType('post'), media: countType('attachment') };
}

export async function verifyExtraction(outputDir: string): Promise<VerificationReport> {
  const wxrPath = join(outputDir, 'output.wxr');
  const logPath = join(outputDir, 'extraction-log.jsonl');
  const redirectPath = join(outputDir, 'redirect-map.json');
  const mediaDir = join(outputDir, 'media');

  const wxrFound = existsSync(wxrPath);
  let wxrContent = '';
  let pages = 0, posts = 0, mediaAttachments = 0;
  let cdnInContentNoLocalCopy: string[] = [];
  let cdnInContentDownloadedNotRewritten: string[] = [];
  if (wxrFound) {
    wxrContent = readFileSync(wxrPath, 'utf8');
    const counts = countWxrItems(wxrContent);
    pages = counts.pages; posts = counts.posts; mediaAttachments = counts.media;
    const contentCdnUrls = scanContentForCdnUrls(wxrContent);
    const downloaded = loadDownloadedMediaUrls(outputDir);
    const buckets = bucketContentCdnUrls(contentCdnUrls, downloaded);
    cdnInContentNoLocalCopy = buckets.noLocalCopy;
    cdnInContentDownloadedNotRewritten = buckets.downloadedNotRewritten;
  }
  // Back-compat: staleCdnUrls is the genuinely-risky set (no local copy).
  const staleCdnUrls = cdnInContentNoLocalCopy;

  const { failedUrls, failedMedia, qualityScores } = parseExtractionLog(logPath);

  let redirectCount = 0;
  if (existsSync(redirectPath)) {
    try {
      const redirects = JSON.parse(readFileSync(redirectPath, 'utf8'));
      redirectCount = Array.isArray(redirects) ? redirects.length : 0;
    } catch { /* malformed */ }
  }

  let mediaOnDisk = 0;
  if (existsSync(mediaDir)) {
    try { mediaOnDisk = readdirSync(mediaDir).filter((f) => !f.startsWith('.')).length; } catch { /* ignore */ }
  }

  const manualAttentionItems: string[] = [];
  if (cdnInContentNoLocalCopy.length > 0) manualAttentionItems.push(`${cdnInContentNoLocalCopy.length} stale CDN URL(s) in content with NO local copy — images may break after source site changes`);
  if (cdnInContentDownloadedNotRewritten.length > 0) manualAttentionItems.push(`${cdnInContentDownloadedNotRewritten.length} content image(s) reference the source CDN but ARE downloaded locally — rewrite post_content to the local copies (not a breakage risk)`);
  if (failedUrls.length > 0) manualAttentionItems.push(`${failedUrls.length} page(s) failed extraction — re-run with --resume or extract manually`);
  if (failedMedia.length > 0) manualAttentionItems.push(`${failedMedia.length} media file(s) failed to download — check URLs and retry`);
  if (qualityScores.low > 0) manualAttentionItems.push(`${qualityScores.low} page(s) with low quality scores — review content manually`);

  return {
    outputDir, wxrFound, contentItems: pages + posts, pages, posts,
    mediaAttachments, mediaOnDisk, staleCdnUrls,
    cdnInContentNoLocalCopy, cdnInContentDownloadedNotRewritten,
    failedUrls, failedMedia,
    redirectCount, qualityScores, manualAttentionItems,
  };
}
