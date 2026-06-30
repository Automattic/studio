import { rewriteMediaUrls } from './media-url-rewrite.js';

export interface PrepareInstallContentOpts {
  /** Raw extracted post/page HTML from the adapter payload. */
  sourceContent: string;
  /** Optional block/raw override produced by compose, cache, or heuristics. */
  contentOverride?: string;
  /** Source media URL -> local Studio upload URL mapping. */
  mediaUrlMap: Map<string, string>;
}

export interface PrepareInstallContentResult {
  /**
   * Content to pass to installPost. Undefined preserves installPost's native
   * fallback to item.content when no rewrite is needed.
   */
  contentOverride?: string;
  /** True when at least one URL was replaced. */
  rewritten: boolean;
  /** True when sourceContent was promoted into contentOverride for rewriting. */
  usedSourceContent: boolean;
  /** Source URLs found in the installed content without a local upload URL. */
  missing: string[];
}

/**
 * Ensure the exact content sent to Studio has local media URLs.
 *
 * Compose/block paths already pass contentOverride; raw/no-agent paths do not.
 * When media mappings exist, promote sourceContent into contentOverride so the
 * same rewrite guarantee applies before installPost serializes the payload.
 */
export function prepareInstallContentWithMediaUrls(
  opts: PrepareInstallContentOpts,
): PrepareInstallContentResult {
  const { sourceContent, contentOverride, mediaUrlMap } = opts;
  if (mediaUrlMap.size === 0) {
    return {
      contentOverride,
      rewritten: false,
      usedSourceContent: false,
      missing: [],
    };
  }

  const input = contentOverride ?? sourceContent;
  const missing: string[] = [];
  const rewrittenContent = rewriteMediaUrls(input, mediaUrlMap, {
    onMissing: (url) => missing.push(url),
  });

  return {
    contentOverride: rewrittenContent,
    rewritten: rewrittenContent !== input,
    usedSourceContent: contentOverride === undefined,
    missing,
  };
}
