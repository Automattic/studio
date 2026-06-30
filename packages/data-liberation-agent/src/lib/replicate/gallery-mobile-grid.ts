/**
 * Mobile gallery reconstruction (carry-and-scope path).
 * ======================================================
 * A Wix pro-gallery lays its items out with JS-computed ABSOLUTE coordinates,
 * frozen at the desktop capture into a multi-column grid. The static carry has no
 * JS to re-pack them for narrow viewports, so on mobile the items keep their
 * desktop coordinates and only the leftmost column is on screen — the dominant
 * residue on gallery pages (projects mobile parity ~0.30).
 *
 * The carried desktop widget is itself pixel-faithful on DESKTOP (the frozen
 * coordinates are correct at the capture width), so we DON'T touch it there.
 * Instead this emits an ADDITIVE sibling — a clean single-column responsive grid
 * of the SAME images — that is hidden on desktop and REPLACES the widget on mobile
 * (the paired CSS hides the widget and shows the grid below 750px). Zero desktop
 * regression, full-bleed single-column mobile that matches the source's own mobile
 * gallery (which is likewise a centered single column).
 *
 * Crop fidelity: where a captured mobile variant exists for an image's Wix media-id
 * (`responsive-images.json`), the grid uses that URL — the source serves a DIFFERENT
 * crop per viewport via `<wow-image>`/pro-gallery JS (no native srcset), and matching
 * the mobile crop is what takes the grid from ~0.55 (desktop crop, full width) to
 * ~0.74 (source mobile crop, source geometry). Falls back to the local desktop image
 * when no mobile variant was captured.
 *
 * Geometry (`GALLERY_MOBILE_GRID_CSS`) mirrors the measured source mobile gallery:
 * 350px-wide column centered in the 390px viewport (≈20px side margins), ~4px gaps,
 * uniform 350×281 cells (`object-fit:cover`). Pixel parity tops out around 0.74 for a
 * 25-photo page — the images are faithfully reproduced and aligned; the residue is
 * JPEG/sub-pixel photo noise (the DESKTOP gallery, with pixel-exact carried
 * positions, itself only reaches ~0.97 on the same photos).
 *
 * Site-generic: keys on the stable `pro-gallery` class + Wix media-id, no per-site
 * constants. No-op for HTML without a pro-gallery.
 */
import * as cheerio from 'cheerio';
import { mediaIdOf } from './responsive-image-rewrite.js';

/** Mobile-gated CSS: hide the carried widget (only where a grid was emitted) and
 *  show the reconstructed single-column grid. Lives in the theme's site.css. */
export const GALLERY_MOBILE_GRID_CSS =
  '.lib-carry-gallery-mobile{display:none}\n' +
  '@media screen and (max-width:750px){' +
  'body.lib-carry-site div.pro-gallery:has(+ .lib-carry-gallery-mobile){display:none!important}' +
  'body.lib-carry-site .lib-carry-gallery-mobile{display:grid!important;grid-template-columns:1fr;gap:4px;width:350px;max-width:100%;margin:0 auto;box-sizing:border-box}' +
  'body.lib-carry-site .lib-carry-gallery-mobile img{width:100%;aspect-ratio:350/281;object-fit:cover;display:block}' +
  '}\n';

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * For each top-level `div.pro-gallery` in `html`, append a sibling
 * `<div class="lib-carry-gallery-mobile">` containing one `<img>` per gallery image
 * (using the captured mobile-crop URL when available, else the local desktop src).
 * Idempotent: skips a gallery that already has a grid sibling. No-op when there is
 * no pro-gallery or no extractable images.
 */
export function appendGalleryMobileGrid(
  html: string,
  mobileById: Record<string, string> = {},
): string {
  if (!html || !/pro-gallery/.test(html)) return html;
  const $ = cheerio.load(html, null, false);
  let changed = false;
  // Only OUTERMOST pro-galleries (the widget root carries the same class token as
  // an inner wrapper, e.g. `pro-gallery inline-styles`; skip the nested one).
  $('div.pro-gallery')
    .filter((_, el) => $(el).parents('div.pro-gallery').length === 0)
    .each((_, el) => {
      const $gal = $(el);
      if ($gal.next('.lib-carry-gallery-mobile').length) return; // idempotent
      const items: Array<{ src: string; alt: string }> = [];
      $gal.find('img[data-hook="gallery-item-image-img"]').each((_i, im) => {
        const src = $(im).attr('src') || '';
        if (!src) return;
        const id = mediaIdOf(src);
        const mobileUrl = id ? mobileById[id] : undefined;
        items.push({ src: mobileUrl || src, alt: $(im).attr('alt') || '' });
      });
      if (!items.length) return;
      const grid =
        '<div class="lib-carry-gallery-mobile">' +
        items
          .map(
            (i) => `<img src="${escapeAttr(i.src)}" alt="${escapeAttr(i.alt)}" loading="lazy"/>`,
          )
          .join('') +
        '</div>';
      $gal.after(grid);
      changed = true;
    });
  return changed ? $.html() : html;
}
