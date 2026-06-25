import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Maps origin media URLs (as they appear in WXR `<wp:attachment_url>`) to
 * the filename on disk under `<outputDir>/media/`. Built by replaying
 * extraction-log.jsonl's `media_downloaded` entries, so collision-resolved
 * filenames (`foo-2.jpg`) are correctly reflected.
 */
export type MediaUrlMap = Map<string, string>;

/**
 * Read `<outputDir>/extraction-log.jsonl` and build a URL → filename map from
 * the `media_downloaded` events. Silently ignores missing logs (returns empty
 * map) so callers can fall back to unrewritten URLs.
 */
export function buildMediaUrlMap(outputDir: string): MediaUrlMap {
  const map: MediaUrlMap = new Map();
  const logPath = join(outputDir, 'extraction-log.jsonl');
  if (!existsSync(logPath)) return map;

  const raw = readFileSync(logPath, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; url?: string; localPath?: string | null; error?: string | null };
      if (entry.type !== 'media_downloaded') continue;
      if (!entry.url || !entry.localPath) continue;
      if (entry.error) continue;
      map.set(entry.url, basename(entry.localPath));
    } catch {
      // Malformed line — skip. extraction-log is append-only so truncation
      // on crash can leave partial JSON; not fatal here.
    }
  }
  return map;
}

/**
 * Rewrite `<wp:attachment_url>` entries in a WXR file so they point at the
 * staged local copies instead of the origin CDN. Mutates the file in place.
 *
 * Rewrite rule: if the original URL is present in `map`, substitute
 * `${localBase}/${filename}`. URLs not in the map are left untouched — the
 * WXR import will try (and likely fail) to fetch them from the CDN, which
 * the caller should surface as a warning rather than an error.
 *
 * @returns count of URLs rewritten
 */
export function rewriteWxrAttachmentUrls(
  wxrPath: string,
  map: MediaUrlMap,
  localBase: string,
): number {
  if (map.size === 0) return 0;
  const original = readFileSync(wxrPath, 'utf8');
  let rewritten = 0;
  const out = original.replace(
    /<wp:attachment_url><!\[CDATA\[([^\]]+)\]\]><\/wp:attachment_url>/g,
    (whole, url: string) => {
      const filename = map.get(url);
      if (!filename) return whole;
      rewritten++;
      return `<wp:attachment_url><![CDATA[${localBase}/${filename}]]></wp:attachment_url>`;
    },
  );
  if (rewritten > 0) writeFileSync(wxrPath, out);
  return rewritten;
}
