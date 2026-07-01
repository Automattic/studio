//
// Product marketing reconstruction (carry path)
// =============================================
// A Shopify product page is a long rich marketing page (gallery + buy box, then
// press logos, comparison tables, app screenshots, FAQ, "you may also like"). The
// carry path imports the PRODUCT as a WooCommerce item, so it gets a functional
// buy box (gallery + add-to-cart + variants) — but the rich marketing below the
// buy box was being thrown away, leaving a generic page with only the short
// Shopify blurb ([[project_shopify_liberate_findings]]).
//
// This module rebuilds that marketing from the section specs already captured
// during the screenshot/fidelity walk (`sections/<slug>.json`). It DROPS the
// sections WooCommerce reproduces itself — the gallery/hero (Woo renders a
// functional buy box), the related-products band (Woo renders `related-products`),
// and footer/nav chrome — then hands the remaining marketing sections to the BLOCK
// path's deterministic reconstructor (`reconstructPagePattern`). That emits real
// CORE blocks (media-text, columns, heading/paragraph, image rows, wp:details FAQ
// accordions, review/cell grids) and only falls back to a per-section `core/html`
// island when block reconstruction would drop content (coverage gate) — so we get
// responsive, theme-styled, editable blocks where faithful and verbatim islands
// only where necessary ([[feedback_never_lose_source_content]]).
//
// Color/font fidelity of the core blocks depends on the theme's palette + font
// tokens, so the carry scaffold must register the captured palette/typography in
// theme.json (see theme-scaffold-carry) and the caller passes the same tokens here.
//
import { rewriteThroughMediaMap, type SectionSpec } from './section-extract.js';
import { reconstructPagePattern } from './page-reconstruct.js';
import type { PaletteToken } from './footer-color.js';
import type { FontFamilyToken } from '@automattic/blocks-engine/theme';

/** Shape of a persisted `sections/<slug>.json` capture (see SectionSpecsStore). */
export interface SectionSpecFile {
  schema?: number;
  sourceUrl?: string;
  capturedAt?: string;
  viewport?: { width: number; height: number };
  sections: SectionSpec[];
}

export interface DroppedSection {
  sectionIndex: number;
  reason: 'buybox' | 'footer' | 'nav';
}

export interface BuildProductMarketingOpts {
  patternSlug?: string;
  title?: string;
  paletteTokens?: PaletteToken[];
  fontFamilies?: FontFamilyToken[];
  mediaUrlMap?: Map<string, string>;
}

export interface ProductMarketingResult {
  /** Block markup for the product's marketing — core blocks, with a per-section
   *  `core/html` fallback where reconstruction would have lost content. Suitable as
   *  the product post_content (rendered full-width by `core/post-content`). Empty
   *  when no marketing sections remained. */
  postContent: string;
  /** sectionIndex values reconstructed, in document order. */
  keptIndices: number[];
  dropped: DroppedSection[];
  /** SVG icon assets the blocks reference — caller writes these into the theme. */
  iconAssets: Array<{ path: string; svg: string }>;
  /** Provenance from the reconstructor (e.g. which sections fell back to core/html). */
  provenanceFlags: string[];
  sectionsRendered: number;
}

/**
 * Select the marketing sections to reconstruct, dropping only the parts the product
 * template renders itself. Pure + cheap — split out from the (heavier) reconstruction
 * so the drop logic is unit-testable on its own.
 *
 * Drops: the TOPMOST content section (the gallery/hero — the modern Woo buy box
 * reproduces it; detecting it by "add to cart" text is wrong because the captured
 * hero often omits the buy-box column while the related grid's quick-add cards carry
 * that text, see getsnooz 2026-06-04) and footer/nav chrome. The "you may also like"
 * band is KEPT: the standalone `woocommerce/related-products` block doesn't render on
 * this template, so the source's own related grid is the reliable related section.
 */
export function selectMarketingSections(specFile: SectionSpecFile): {
  kept: SectionSpec[];
  dropped: DroppedSection[];
} {
  const sections = [...(specFile.sections ?? [])].sort((a, b) => a.sectionIndex - b.sectionIndex);
  const firstContent = sections.find((s) => s.interactionModel !== 'footer' && s.interactionModel !== 'nav');
  const heroIndex = firstContent?.sectionIndex ?? -1;

  const kept: SectionSpec[] = [];
  const dropped: DroppedSection[] = [];
  for (const s of sections) {
    if (s.interactionModel === 'footer') dropped.push({ sectionIndex: s.sectionIndex, reason: 'footer' });
    else if (s.interactionModel === 'nav') dropped.push({ sectionIndex: s.sectionIndex, reason: 'nav' });
    else if (s.sectionIndex === heroIndex) dropped.push({ sectionIndex: s.sectionIndex, reason: 'buybox' });
    else kept.push(s);
  }
  return { kept, dropped };
}

/** Clone the sections with foreground + cell image URLs rewritten through the
 *  CDN→library map. Uses `rewriteThroughMediaMap` (exact → size-param-stripped →
 *  basename fallback), so a captured `?v=…&width=1800` Shopify variant still
 *  resolves to the installed library asset — the same join the block path uses.
 *  Returns the input untouched when no map is given. */
function rewriteSpecMedia(sections: SectionSpec[], map?: Map<string, string>): SectionSpec[] {
  if (!map || map.size === 0) return sections;
  const rec = Object.fromEntries(map);
  const local = (u: string | undefined): string => (u ? rewriteThroughMediaMap(u, rec) : (u ?? ''));
  return sections.map((s) => ({
    ...s,
    images: (s.images ?? []).map((im) => ({ ...im, url: local(im.sourceUrl || im.url) })),
    cells: (s.cells ?? []).map((c) =>
      c.image ? { ...c, image: { ...c.image, url: local(c.image.sourceUrl || c.image.url) } } : c,
    ),
  }));
}

/**
 * Drop `<img>` whose src did NOT resolve to the local media library — an unjoined CDN
 * url, often a DEAD source image (e.g. a stale "you may also like" recommendation whose
 * CDN file 404s) that otherwise renders as a broken-image icon. Reconstructed blocks only
 * ever emit local (`/wp-content/uploads/`) imgs, so this only strips dead refs left in the
 * verbatim core/html island sections — keeping every joined image. A broken icon is a
 * broken reference, not viewable content, so removing it loses nothing on screen.
 */
export function dropDeadImages(html: string): string {
  // Match the whole <img> tag while RESPECTING quoted attribute values, so a `>` inside
  // an attribute (e.g. Shopify alt text "a > b") doesn't truncate the match and corrupt
  // the surrounding markup.
  return html.replace(/<img\b(?:"[^"]*"|'[^']*'|[^"'>])*>/gi, (tag) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/i.exec(tag);
    const url = (src?.[1] ?? src?.[2] ?? src?.[3] ?? '').trim();
    return /\/wp-content\/uploads\//i.test(url) ? tag : '';
  });
}

/**
 * Build a product's marketing block markup (post_content) from its captured section
 * specs by reusing the block path's `reconstructPagePattern`. Pure: no I/O. Pass
 * `opts.paletteTokens` / `opts.fontFamilies` (from the carry theme.json / captured
 * design tokens) for faithful color + type, and `opts.mediaUrlMap` to point images
 * at the imported media library.
 */
export function buildProductMarketing(
  specFile: SectionSpecFile,
  opts: BuildProductMarketingOpts = {},
): ProductMarketingResult {
  const { kept, dropped } = selectMarketingSections(specFile);
  if (kept.length === 0) {
    return { postContent: '', keptIndices: [], dropped, iconAssets: [], provenanceFlags: [], sectionsRendered: 0 };
  }
  // Structured renderers read image URLs straight off the spec (the mediaUrlMap only
  // covers the core/html fallback), so rewrite the kept sections' foreground/cell
  // image URLs to the imported library here — on clones, so we don't mutate the
  // caller's spec. Mirrors the block handler's applyMediaMap.
  const sections = rewriteSpecMedia(kept, opts.mediaUrlMap);
  const result = reconstructPagePattern(sections, {
    patternSlug: opts.patternSlug ?? 'carry/product-marketing',
    title: opts.title ?? 'Product marketing',
    paletteTokens: opts.paletteTokens,
    fontFamilies: opts.fontFamilies,
    mediaUrlMap: opts.mediaUrlMap,
  });
  return {
    postContent: dropDeadImages(result.body),
    keptIndices: kept.map((s) => s.sectionIndex),
    dropped,
    iconAssets: result.iconAssets,
    provenanceFlags: result.provenanceFlags,
    sectionsRendered: result.sectionsRendered,
  };
}
