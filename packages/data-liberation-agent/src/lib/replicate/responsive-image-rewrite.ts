/**
 * Responsive-image carry (carry-and-scope path).
 * =============================================
 * Wix serves a DIFFERENT image crop per viewport via `<wow-image>` + JS (no
 * native srcset): at desktop the hero is e.g. a 1280×663 landscape fill; at
 * mobile Wix's CDN returns a 375×782 portrait fill cropped to the SAME focal
 * point. The carry froze the desktop variant, so on mobile the alt crops the
 * landscape image with `object-fit:cover` and shows a different region than the
 * source — the dominant residue on image-heavy mobile pages (the hero).
 *
 * This wraps each carried `<img>` whose Wix media-id has a captured mobile
 * variant in a `<picture>` with a `<source media="(max-width:750px)">`, so the
 * browser natively picks the mobile crop on narrow viewports — no JS. Desktop is
 * untouched (the `<img>` is the default source).
 *
 * Site-generic: keys on the stable Wix media-id (the `xxxxxx_<hash>` token shared
 * by every crop of an image, present in both the CDN URL and the rewritten local
 * filename). No-op for `<img>`s with no captured mobile variant.
 */

/** Wix media id, e.g. `e20b04_78c87aec087f40859a405e925d30d2f5`. */
const MEDIA_ID = /([a-z0-9]{4,12}_[a-z0-9]{24,48})/i;

/** Pull the Wix media id out of a CDN URL or a rewritten local filename. */
export function mediaIdOf(url: string): string | null {
  const m = MEDIA_ID.exec(url);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Wrap carried `<img>`s in `<picture>` with a mobile `<source>` for any image
 * whose media id appears in `mobileById` (id → mobile variant URL). Idempotent:
 * skips `<img>`s already inside a `<picture>` (avoids double-wrap on re-runs).
 */
export function rewriteResponsiveImages(html: string, mobileById: Record<string, string>): string {
  if (!html || Object.keys(mobileById).length === 0) return html;
  return html.replace(/<img\b[^>]*>/gi, (tag, offset: number, full: string) => {
    // Skip if this <img> is already the child of a <picture> (idempotent).
    const before = full.slice(Math.max(0, offset - 220), offset);
    if (/<picture\b[^>]*>\s*(?:<source\b[^>]*>\s*)*$/i.test(before)) return tag;
    const srcM = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!srcM) return tag;
    const id = mediaIdOf(srcM[1]);
    if (!id) return tag;
    const mobileUrl = mobileById[id];
    if (!mobileUrl) return tag;
    const esc = mobileUrl.replace(/"/g, '&quot;');
    return `<picture><source media="(max-width:750px)" srcset="${esc}"/>${tag}</picture>`;
  });
}
