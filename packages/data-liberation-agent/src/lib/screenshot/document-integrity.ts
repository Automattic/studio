// src/lib/screenshot/document-integrity.ts
//
// A faithfully-captured page is ONE HTML document — exactly one <body>. A capture
// bug (the interaction/scroll loop interacting with a site's AJAX page-loader)
// can nest the whole document into itself N times, so the saved html/<slug>.html
// carries N <body> elements. Downstream that duplicates every section and, against
// the extractor's section cap, both inflates and TRUNCATES the reconstruction.
//
// This was observed at exactly 11× across Squarespace, Wix, and GoDaddy captures —
// the identical count across platforms is why it's our capture, not a platform
// quirk. Detection is generic (count top-level document markers), so it flags any
// future stacking artifact and is reused both by the segmentation fixture corpus
// (to quarantine corrupted fixtures) and by the capture phase (to refuse/clean a
// corrupted snapshot rather than persist it).

/** Number of `<body>` open tags — a clean document has exactly one. */
export function countBodyTags(html: string): number {
  return (html.match(/<body[\s>]/gi) ?? []).length;
}

/**
 * True when the HTML nests more than one document (>1 `<body>`), i.e. the capture
 * stacked the page into itself. Such a snapshot is not a faithful single-page
 * render and must not be used as a parity fixture or persisted as output.
 */
export function isStackingArtifact(html: string): boolean {
  return countBodyTags(html) > 1;
}
