// src/lib/screenshot/css-url-media.ts
//
// Scan CSS for url(...) media refs to feed media discovery: returns absolute
// http(s) background/font URLs, skipping data:/blob:, relative refs, and
// known CDN font hosts (which are re-linked, not uploaded). Deduped.
//
const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

export function extractCssMediaUrls(css: string, cdnFontHosts: string[]): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(css))) {
    const u = m[2].trim();
    if (!/^https?:\/\//i.test(u)) continue;
    try {
      if (cdnFontHosts.some((h) => new URL(u).hostname.endsWith(h))) continue;
    } catch { continue; }
    out.add(u);
  }
  return [...out];
}
