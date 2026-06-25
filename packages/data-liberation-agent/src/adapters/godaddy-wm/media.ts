import { IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';

// ---------------------------------------------------------------------------
// W+M isteam CDN URL upgrade
// ---------------------------------------------------------------------------
//
// W+M serves images via `img1.wsimg.com/isteam/<type>/<id>[/<filename>]` with
// an optional `/:/<transforms>` suffix (`rs=w:370,cg:true,m`, `cr=w:600,h:300`,
// etc.). URLs harvested from the live DOM almost always include a small
// transform (370/740/1110 wide), and URLs with no transform at all default to
// a ~600px thumbnail. To preserve max-fidelity media, rewrite every isteam URL
// to request the CDN's largest served variant — `/:/rs=w:4000,cg:true`
// preserves aspect ratio on user-uploaded images (`/ip/<uuid>/...`) and caps
// stock images (`/getty/<id>`, `/stock/<id>`) at their square 3840×3840 max.
//
// This must be applied consistently everywhere a URL is either (a) added to
// the media download list or (b) embedded in body HTML, because the WP
// importer rewrites media URLs via exact string match.
// ---------------------------------------------------------------------------

export function upgradeIsteamUrl(raw: string): string {
  if (!raw) return raw;
  let url = raw.trim();
  // Protocol-relative URLs show up in Draft.js and some HTML attrs
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https?:\/\/img1\.wsimg\.com\/isteam\//i.test(url)) return raw;
  // Strip any existing /:/... transform suffix
  const [base] = url.split('/:/');
  // Request max CDN-served width with aspect preserved
  return `${base}/:/rs=w:4000,cg:true`;
}

// ---------------------------------------------------------------------------
// Media URL extraction
// ---------------------------------------------------------------------------

export function extractWmMediaUrls(html: string): string[] {
  const urls = new Set<string>();

  // Scoop up every img1.wsimg.com/isteam URL found in the page source —
  // catches lazy-load attrs (data-srclazy, data-srcsetlazy), srcset, inline
  // styles, and raw references we might otherwise miss.
  const cdnPattern = /https?:\/\/img1\.wsimg\.com\/isteam\/[^\s"'<>)]+/g;
  const protocolRelativeCdn = /\/\/img1\.wsimg\.com\/isteam\/[^\s"'<>)]+/g;
  for (const m of html.match(cdnPattern) || []) urls.add(m);
  for (const m of html.match(protocolRelativeCdn) || []) urls.add(`https:${m}`);

  const imgSrcMatches = html.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
  for (const match of imgSrcMatches) {
    const src = match.match(/src=["']([^"']+)["']/i);
    if (src?.[1] && !src[1].startsWith('data:')) {
      const resolved = src[1].startsWith('//') ? `https:${src[1]}` : src[1];
      if (resolved.startsWith('http')) urls.add(resolved);
    }
  }

  const nonImageExtensions = /\.(css|js|json|xml|txt|map|woff2?|ttf|eot|pdf)$/i;
  return [...urls]
    .map(upgradeIsteamUrl)
    .filter((u) => {
      try {
        const parsed = new URL(u);
        if (/\/favicon\//i.test(parsed.pathname)) return false;
        // For isteam URLs the path may have no extension (e.g. /getty/<id>) —
        // accept anyway since we know it's an image.
        if (/^img1\.wsimg\.com$/i.test(parsed.hostname)) return true;
        if (nonImageExtensions.test(parsed.pathname)) return false;
        return IMAGE_EXTENSIONS.test(parsed.pathname);
      } catch {
        return false;
      }
    });
}
