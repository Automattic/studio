//
// Pure URL-rewrite for HTML / block markup
// ========================================
// Phase 3.5 hook: after compose-page-blocks emits markup, swap source-domain
// media URLs for the local upload URLs registered by `installMediaForUrl`.
//
// This is intentionally pure (no I/O): the caller builds the mapping from
// MediaStubStore and hands us a string. The same function is used for raw
// HTML and for serialized block markup — the regexes target attribute
// surfaces (`src=`, `srcset=`, `href=`) plus the JSON-shaped attributes that
// block markup carries inline (`"src":"..."`, `"url":"..."`).
//
// Rewrite rule: only URLs present in `mapping` get rewritten. URLs not in
// the map are left untouched and reported via the optional `onMissing`
// callback so the caller can log a warning.
//
// Patterns mirrored from src/lib/preview/media-url-map.ts:rewriteWxrAttachmentUrls.
// That function targets <wp:attachment_url> CDATA — this one targets the
// content surfaces a block-rendered post would expose.

export interface RewriteWarnings {
  /** Source URLs that appeared in the input but had no mapping. */
  missing: string[];
}

export interface RewriteOpts {
  /**
   * Optional logging callback fired for each unique source URL we found in
   * the input but couldn't rewrite. Useful for streaming-mode warning
   * surfaces (watch.log) without coupling this module to a logger.
   */
  onMissing?: (sourceUrl: string) => void;
}

/**
 * Rewrite source URLs in an HTML or block-markup string.
 *
 * @param input HTML or block markup to rewrite. Returned unchanged when
 *   `mapping` is empty.
 * @param mapping Map<sourceUrl, localUrl>. The local URL replaces the source
 *   URL verbatim wherever the source URL appears in any of the recognized
 *   attribute surfaces.
 * @param opts Optional handlers; see RewriteOpts.
 */
export function rewriteMediaUrls(
  input: string,
  mapping: Map<string, string>,
  opts: RewriteOpts = {},
): string {
  if (!input || mapping.size === 0) return input;

  const aliasIndex = buildMediaAliasIndex(mapping);
  const replacements = new Map(mapping);

  // Scan-and-replace strategy:
  //   - For each known source URL in the mapping, do a substring substitution.
  //     URLs in our domain are unlikely to be substrings of one another in
  //     practice (full origin + path), and we don't try to anchor on
  //     attribute boundaries — replacing the URL string itself catches every
  //     attribute surface (src/srcset/href/JSON value/etc.) without per-
  //     attribute regex maintenance.
  //   - For unknown URLs, run a final pass against typical attribute
  //     surfaces and report any that look like media references but aren't
  //     in our map. Avoids missing warnings on URLs that don't resemble
  //     media (random links, etc.).
  // Scan the *input* (pre-rewrite) for missing URLs so the local
  // replacement URL isn't itself reported as "missing" after the rewrite.
  const seen = new Set<string>();
  const candidates = collectMediaCandidates(input);
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const local = resolveLocalUrl(candidate, mapping, aliasIndex);
    if (local) {
      replacements.set(candidate, local);
    } else if (opts.onMissing) {
      opts.onMissing(candidate);
    }
  }

  let out = input;
  // Apply LONGEST source URLs first. A mapped BASE url (e.g. `…/<id>~mv2.jpg`)
  // is a substring-prefix of a carried transform url (`…/<id>~mv2.jpg/v1/fill/
  // …/img.jpg`). The alias index resolves that transform url to the same local
  // file and adds it to `replacements`, but if the shorter base entry runs
  // first it rewrites only the prefix — leaving `<local>/v1/fill/…/img.jpg`
  // (a 404). Longest-first guarantees the most-specific (full) url is replaced
  // before any shorter substring of it.
  const ordered = [...replacements.entries()]
    .filter(([source]) => source)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [source, local] of ordered) {
    // Escape the source URL for safe inclusion in a RegExp. This handles
    // querystring `?`, `&`, `+` and other regex metacharacters that often
    // appear in CDN URLs.
    const safe = escapeRegex(source);
    out = out.replace(new RegExp(safe, 'g'), () => local);
  }

  return out;
}

/**
 * Convert an extraction-log media URL map into the input expected by
 * rewriteMediaUrls. Builds Map<sourceUrl, `${localBase}/${filename}`>.
 *
 * Mirrors the caller pattern in src/lib/preview/studio.ts where
 * `buildMediaUrlMap(outputDir)` is paired with a `localBase` URL.
 */
export function toLocalUrlMapping(
  filenameMap: Map<string, string>,
  localBase: string,
): Map<string, string> {
  const trimmed = localBase.replace(/\/+$/, '');
  const out = new Map<string, string>();
  for (const [sourceUrl, filename] of filenameMap) {
    out.set(sourceUrl, `${trimmed}/${filename}`);
  }
  return out;
}

// NB: `)` is intentionally NOT excluded. Wix appends the human display filename
// to transform URLs (`…/Cornelius%20Holmes%20(1).png`), so stopping at `)` would
// truncate the URL at `(1`, and the rewrite would then swap only the prefix —
// leaving `<local>).png` (a 404). Candidates are extracted from quoted attribute
// surfaces / srcset (whitespace- and comma-delimited), so a literal `)` is part
// of the URL, never a delimiter.
const URL_LIKE = /https?:\/\/[^\s"'<>\\]+/g;

/**
 * Collect plausible media URLs from common attribute surfaces. We don't try
 * to be exhaustive — the goal is to flag obvious source-domain references
 * that didn't get rewritten so the caller can warn.
 */
function collectMediaCandidates(input: string): string[] {
  const candidates: string[] = [];
  // Direct attribute-style matches first — high signal.
  const attrPatterns: RegExp[] = [
    /<img[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi,
    /<a[^>]*\bhref\s*=\s*["']([^"']+\.(?:jpe?g|png|gif|webp|svg|avif|mp4|webm|pdf))["']/gi,
    /\bsrcset\s*=\s*["']([^"']+)["']/gi,
    /"src"\s*:\s*"([^"]+)"/g,
    /"url"\s*:\s*"([^"]+)"/g,
  ];
  for (const re of attrPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      const value = m[1];
      // srcset can contain multiple URLs — extract via URL_LIKE so that Wix
      // transform URLs (which embed commas in their parameter segments, e.g.
      // `/v1/fill/w_680,h_510,q_90,enc_avif,quality_auto/`) are captured
      // whole rather than split at each comma.  A naïve value.split(',') slices
      // those URLs mid-parameter, producing truncated keys like
      // `https://…/media/<HASH>~mv2.png/v1/fill/w_943` that match the alias
      // index (same asset-id prefix) and are then a substring of the real
      // transform URL — so the regex-replace swaps just the prefix, leaving the
      // transform tail appended to the local path (the "mangle").
      if (re.source.includes('srcset')) {
        let urlMatch: RegExpExecArray | null;
        const urlRe = new RegExp(URL_LIKE.source, 'g');
        while ((urlMatch = urlRe.exec(value)) !== null) {
          candidates.push(urlMatch[0]);
        }
      } else {
        candidates.push(value);
      }
    }
  }
  // Cheap sanity filter — only keep things that parse as URLs, drop relative
  // paths and `data:` URIs.
  return candidates
    .map((c) => c.match(URL_LIKE)?.[0] ?? c)
    .filter((c) => /^https?:\/\//i.test(c));
}

interface MediaAliasRecord {
  local: string;
  score: number;
}

function buildMediaAliasIndex(mapping: Map<string, string>): Map<string, MediaAliasRecord> {
  const out = new Map<string, MediaAliasRecord>();
  for (const [source, local] of mapping.entries()) {
    const score = mediaVariantScore(source);
    for (const key of mediaAliasKeys(source)) {
      const existing = out.get(key);
      if (!existing || score > existing.score) {
        out.set(key, { local, score });
      }
    }
  }
  return out;
}

function resolveLocalUrl(
  source: string,
  mapping: Map<string, string>,
  aliasIndex: Map<string, MediaAliasRecord>,
): string | undefined {
  const exact = mapping.get(source);
  if (exact) return exact;

  for (const key of mediaAliasKeys(source)) {
    const aliased = aliasIndex.get(key);
    if (aliased) return aliased.local;
  }

  return undefined;
}

function mediaAliasKeys(source: string): string[] {
  const keys: string[] = [];
  const parsed = parseHttpUrl(source);
  if (!parsed) return keys;

  if (parsed.hostname === 'static.wixstatic.com') {
    const asset = wixMediaAssetId(parsed);
    if (asset) keys.push(`wix:${asset}`);
  }

  return keys;
}

function wixMediaAssetId(url: URL): string | undefined {
  const parts = url.pathname.split('/').filter(Boolean);
  const mediaIndex = parts.indexOf('media');
  if (mediaIndex === -1 || mediaIndex + 1 >= parts.length) return undefined;
  return decodeURIComponent(parts[mediaIndex + 1]);
}

function mediaVariantScore(source: string): number {
  const match = source.match(/\bw_(\d+),h_(\d+)/i);
  if (!match) return 0;
  return Number(match[1]) * Number(match[2]);
}

function parseHttpUrl(source: string): URL | undefined {
  try {
    const parsed = new URL(source);
    if (!/^https?:$/i.test(parsed.protocol)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
