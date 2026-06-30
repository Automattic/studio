import * as cheerio from 'cheerio';

/** Resolve a src against the page URL; drop empties and inline data: URIs. */
function absolutize(src: string | undefined, baseUrl: string): string | null {
  const s = (src ?? '').trim();
  if (!s || s.startsWith('data:')) return null;
  try {
    return new URL(s, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Pull the URL out of each `srcset` candidate (URL + optional descriptor). */
function srcsetUrls(srcset: string): string[] {
  return srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/**
 * Generic media discovery for the `default` adapter — trusts element semantics
 * rather than a platform CDN pattern. Pulls <img src/srcset>, <picture><source
 * srcset>, and og:image, absolutized against the page URL and deduplicated.
 */
export function extractMediaUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  const add = (raw: string | undefined) => {
    const abs = absolutize(raw, baseUrl);
    if (abs) urls.add(abs);
  };

  $('img').each((_, el) => {
    add($(el).attr('src'));
    for (const u of srcsetUrls($(el).attr('srcset') || '')) add(u);
  });
  $('source').each((_, el) => {
    for (const u of srcsetUrls($(el).attr('srcset') || '')) add(u);
  });
  add($('meta[property="og:image"]').attr('content'));

  return [...urls];
}
