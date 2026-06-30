/**
 * Responsive-mobile assembly + self-host (carry-and-scope path).
 * ==============================================================
 * Runs the two mobile-fidelity inject steps — `rewriteResponsiveImages` (wraps
 * carried `<img>`s in a `<picture>` with a `(max-width:750px)` `<source>`) and
 * `appendGalleryMobileGrid` (adds a single-column mobile grid beside a Wix
 * pro-gallery) — then makes their output SELF-HOSTED.
 *
 * Both inject steps reference `responsive-images.json` mobile-crop URLs, which are
 * CDN-only: the capture recorded the mobile crop's URL but the extractor never
 * downloaded that variant (it downloaded the desktop sizes). Left as-is they ship a
 * live source-CDN dependency. This module repoints each injected mobile-crop URL to
 * the already-installed DESKTOP local copy of the same Wix media-id, via the run
 * media map's alias index (`rewriteMediaUrls`). Mobile then renders the desktop crop
 * downscaled, but EVERY image is self-hosted — the explicit project requirement,
 * chosen over preserving the distinct mobile crop.
 *
 * Keeping this composition in one tested unit makes the ordering invariant explicit:
 * the self-host rewrite MUST run AFTER the inject steps, or their freshly-injected
 * CDN URLs escape it (the bug this fixes).
 */
import { rewriteResponsiveImages } from './responsive-image-rewrite.js';
import { appendGalleryMobileGrid } from './gallery-mobile-grid.js';
import { rewriteMediaUrls } from '../streaming/media-url-rewrite.js';

export function assembleResponsiveMobile(
  html: string,
  responsiveImages: Record<string, string>,
  mediaUrlMap: Map<string, string>,
): string {
  const withResponsive = appendGalleryMobileGrid(
    rewriteResponsiveImages(html, responsiveImages),
    responsiveImages,
  );
  // Best-effort, like the rest of the carry: with no map there's nothing to repoint.
  return mediaUrlMap.size > 0 ? rewriteMediaUrls(withResponsive, mediaUrlMap) : withResponsive;
}
