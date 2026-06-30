//
// Shared run media install → URL map
// ==================================
// Both reconstruct paths install the run's downloaded media into the target WP
// site and build a `sourceUrl (CDN) → localUrl (WP uploads)` map used to
// rewrite carried/reconstructed image URLs off the source CDN. They did this
// with identical inline code; extracted here so there's one implementation.
//
// This wraps the same `installMediaForUrl` the streaming/import paths use — no
// new install logic. The block path additionally pre-fetches section-background
// imagery (spec-driven) before calling this; that step stays in the block
// handler since the alt path has no specs.
//

import { installMediaForUrl, type MediaInstallOpts, type MediaInstallResult } from '../streaming/media-install.js';

export interface RunMediaMapResult {
  /** sourceUrl (CDN) → localUrl (WP uploads) for every installed/known asset. */
  mediaUrlMap: Map<string, string>;
  /** The underlying install result (installed / skipped / errors) for logging. */
  result: MediaInstallResult;
}

/**
 * Install the run's media into the target site and return the CDN→local URL
 * map. Identical to the inline sequence the block reconstruct used.
 */
export async function installRunMediaMap(opts: MediaInstallOpts): Promise<RunMediaMapResult> {
  const result = await installMediaForUrl(opts);
  const mediaUrlMap = new Map<string, string>();
  for (const it of result.installed) mediaUrlMap.set(it.sourceUrl, it.localUrl);
  return { mediaUrlMap, result };
}
