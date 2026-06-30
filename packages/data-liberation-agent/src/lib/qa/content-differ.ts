import type { ContentModel } from '../extraction/content-parser.js';

export interface ContentDiff {
  textSimilarity: number;
  headingsMatch: { origin: number; wxr: number; missing: number };
  imagesMatch: { origin: number; wxr: number; missing: number };
  linksMatch: { origin: number; wxr: number; missing: number };
  missingHeadings: ContentModel['headings'];
  missingImages: ContentModel['images'];
  missingLinks: ContentModel['links'];
  grade: 'pass' | 'warn' | 'fail';
}

/**
 * @param postTitle - If provided, the page's h1 title is excluded from heading comparison
 *   since WXR stores the title separately from content.
 */
export function diffContent(origin: ContentModel, wxr: ContentModel, postTitle?: string): ContentDiff {
  const isEmpty =
    !origin.text &&
    origin.headings.length === 0 &&
    origin.images.length === 0 &&
    origin.links.length === 0;

  // `missing` semantics across this module: items present in the origin
  // that we failed to carry into the WXR output. This matches both the UI
  // label ("N missing images") and the test expectations. Detects extraction
  // loss — the thing users actually want to know about.
  const textSimilarity = isEmpty ? 1 : containment(origin.text, wxr.text);

  // Filter out the post title h1 from origin headings — WXR stores it as metadata, not content
  const originHeadings = postTitle
    ? origin.headings.filter((h) => !(h.level === 1 && normalize(h.text) === normalize(postTitle)))
    : origin.headings;

  // Headings: origin headings not carried over to WXR
  const wxrHeadingSet = new Set(wxr.headings.map((h) => `${h.level}:${normalize(h.text)}`));
  const missingHeadings = originHeadings.filter(
    (oh) => !wxrHeadingSet.has(`${oh.level}:${normalize(oh.text)}`),
  );

  // Images: origin images not carried over to WXR (match on filename so the
  // CDN query string / host rewrite doesn't produce false negatives)
  const wxrFilenames = new Set(wxr.images.map((img) => extractFilename(img.src)));
  const missingImages = origin.images.filter(
    (img) => !wxrFilenames.has(extractFilename(img.src)),
  );

  // Links: origin links not carried over to WXR
  const wxrHrefs = new Set(wxr.links.map((l) => l.href));
  const missingLinks = origin.links.filter((l) => !wxrHrefs.has(l.href));

  const headingsMatch = {
    origin: originHeadings.length,
    wxr: wxr.headings.length,
    missing: missingHeadings.length,
  };
  const imagesMatch = {
    origin: origin.images.length,
    wxr: wxr.images.length,
    missing: missingImages.length,
  };
  const linksMatch = {
    origin: origin.links.length,
    wxr: wxr.links.length,
    missing: missingLinks.length,
  };

  // Grade: weighted score — text 50%, headings 20%, images 20%, links 10%.
  // Each dimension measures "what fraction of origin content made it into WXR".
  const headingsScore = originHeadings.length === 0 ? 1 : 1 - missingHeadings.length / originHeadings.length;
  const imagesScore = origin.images.length === 0 ? 1 : 1 - missingImages.length / origin.images.length;
  const linksScore = origin.links.length === 0 ? 1 : 1 - missingLinks.length / origin.links.length;

  const overall = isEmpty
    ? 1
    : textSimilarity * 0.5 + headingsScore * 0.2 + imagesScore * 0.2 + linksScore * 0.1;

  let grade: ContentDiff['grade'];
  if (overall > 0.9) {
    grade = 'pass';
  } else if (overall >= 0.7) {
    grade = 'warn';
  } else {
    grade = 'fail';
  }

  return {
    textSimilarity,
    headingsMatch,
    imagesMatch,
    linksMatch,
    missingHeadings,
    missingImages,
    missingLinks,
    grade,
  };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/['']/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * What fraction of words in `subset` also appear in `superset`?
 * Called with `containment(origin, wxr)` to answer "how much of the origin
 * content was preserved in the WXR output".
 */
function containment(subset: string, superset: string): number {
  const subWords = wordSet(subset);
  const superWords = wordSet(superset);
  if (subWords.size === 0 && superWords.size === 0) return 1;
  if (subWords.size === 0) return 0;

  let found = 0;
  for (const w of subWords) {
    if (superWords.has(w)) found++;
  }
  return found / subWords.size;
}

function wordSet(text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return new Set(words);
}

function extractFilename(url: string): string {
  try {
    const pathname = new URL(url, 'https://placeholder.invalid').pathname;
    const segments = pathname.split('/');
    return segments[segments.length - 1] || '';
  } catch {
    return url;
  }
}
