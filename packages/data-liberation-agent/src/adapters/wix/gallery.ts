/**
 * Parse Pro Gallery (and general Wix page) content out of the *served HTML*
 * — the plain-GET response that's already present before any JS runs. This
 * is the last-resort fallback for when the live `page.evaluate` path fails
 * with an execution-context-destroyed error and can't be retried.
 *
 * Wix embeds the rendered page in two complementary places:
 *   - Full `https://static.wixstatic.com/media/...` image URLs in `<img>`
 *     tags, `srcset`, inline `style="background-image:url(...)"`, and the
 *     `wix-warmup-data` JSON blob.
 *   - Bare `<hash>~mv2.<ext>` media tokens inside the warmup JSON (gallery
 *     items that haven't been turned into full CDN URLs yet) — we promote
 *     these to canonical `static.wixstatic.com/media/<token>` URLs so the
 *     media downloader can fetch them.
 *
 * Returns the document title, the page's visible heading/paragraph text as
 * lightweight HTML, and the de-duplicated image URL list. Pure + synchronous
 * so it's unit-testable against a captured HTML fixture.
 */
export function extractGalleryFromHtml(html: string): {
  title: string;
  content: string;
  mediaUrls: string[];
} {
  const images = new Set<string>();

  // 1. Full wixstatic/wixmp media URLs anywhere in the markup (img src,
  //    srcset, background-image, JSON). Stop at the first quote, paren, or
  //    whitespace so we don't swallow trailing HTML.
  const fullUrlRe = /https?:\/\/[a-z0-9.-]*(?:wixstatic\.com|wixmp\.com)\/media\/[^\s"'()<>\\]+/gi;
  for (const m of html.match(fullUrlRe) || []) images.add(m);

  // 2. Bare Wix media tokens (gallery items in the warmup JSON that aren't
  //    yet full URLs). Promote to canonical CDN URLs. The token shape is
  //    `<accountHash>_<32 hex>~mv2.<ext>`.
  const tokenRe = /[a-z0-9]{4,}_[a-f0-9]{32}~mv2\.(?:jpe?g|png|gif|webp|avif)/gi;
  for (const tok of html.match(tokenRe) || []) {
    images.add(`https://static.wixstatic.com/media/${tok}`);
  }

  // De-dupe by media token so we don't keep both a resized variant and the
  // canonical URL for the same asset. Prefer the original (token-only) form.
  const byToken = new Map<string, string>();
  for (const url of images) {
    const tok = url.match(/\/media\/([a-z0-9]{4,}_[a-f0-9]{32}~mv2\.[a-z0-9]+)/i)?.[1];
    const key = tok ?? url;
    const existing = byToken.get(key);
    if (!existing) {
      byToken.set(key, url);
    } else if (tok && url.endsWith(tok)) {
      // canonical token-only URL wins over a resized variant
      byToken.set(key, `https://static.wixstatic.com/media/${tok}`);
    }
  }
  const mediaUrls = [...byToken.values()];

  // Title: prefer og:title, then <title>. Strip the " | Site Name" suffix.
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const docTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const rawTitle = (ogTitle || docTitle || '').trim();
  const pipeIdx = rawTitle.lastIndexOf(' | ');
  const title = pipeIdx > 0 ? rawTitle.slice(0, pipeIdx).trim() : rawTitle;

  // Content: headings + the og:description, as lightweight HTML. The served
  // markup's body text for a Pro Gallery is mostly chrome, so we keep this
  // intentionally small — the gallery's value is its images.
  const parts: string[] = [];
  const ogDesc = html
    .match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1]
    ?.trim();
  for (const hm of html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi) || []) {
    const text = hm.replace(/<[^>]+>/g, '').trim();
    const tag = hm.match(/<(h[1-3])/i)?.[1]?.toLowerCase() || 'h2';
    if (text && text.length < 200) parts.push(`<${tag}>${text}</${tag}>`);
    if (parts.length >= 12) break;
  }
  if (ogDesc && ogDesc.length > 0) parts.unshift(`<p>${ogDesc}</p>`);
  const content = parts.join('\n');

  return { title, content, mediaUrls };
}
