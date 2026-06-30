// src/lib/replicate/page-reconstruct.ts
//
// Deterministic spec -> block-pattern renderer for non-homepage content pages.
//
//   SectionSpec[] (from liberate_section_extract detail:"full")
//        │  @automattic/blocks-engine/theme reconstructNativeAggregate
//        │  DLA wrapper applies adapter block recipes and PHP assembly
//        ▼
//   { php, expectedText[], bodyText[], expectedAssets[], provenanceFlags[] }
//
// The renderer is PURE and SOURCE-FAITHFUL by construction:
//   - All emitted copy is the spec's captured headings / bodyText / reviews,
//     entity/whitespace-normalized only — NEVER paraphrased or synthesized.
//   - Image slots reference the spec image's already-mediaMapped WP URL; a
//     slot whose image never reached the WP library (still a remote CDN URL)
//     is replaced with the missing-media placeholder + a provenanceFlag, never
//     an unrelated stand-in.
//   - Colors/spacing emit theme token slugs, never raw hex.
//   - No raw <?php / <script> / on*= — the markup is core-block-comment only.
//
// The artifact this returns is consumed by:
//   - liberate_validate_artifacts (provenance + escaping + injection gate)
//   - the patterns/page-<slug>.php file written into the theme bundle
//   - the reconstructedPages scaffold option (wires page-<slug>.html -> pattern)
//
// This is the same contract the about-us reconstruction satisfied; this module
// generalizes it across the remaining content-page interaction models.

import type { SectionSpec } from './section-extract.js';
import type { PaletteToken } from './footer-color.js';
import {
  type FallbackDiagnostic,
  reconstructNativeAggregate,
  rewriteMediaUrls,
  structuredStrategy,
  sanitizePatternHeaderField,
  type FontFamilyToken,
  type NativeSectionDecision,
  type SectionRenderOptions,
} from '@automattic/blocks-engine/theme';
import { applyBlockRecipe } from './apply-block-recipe.js';

export interface ReconstructOptions {
  /** Fully-qualified pattern slug, e.g. "getsnooz-com-replica/page-go2". */
  patternSlug: string;
  /** Human-readable pattern title for the PHP doc-comment. */
  title: string;
  /**
   * Theme palette tokens ({slug, hex}) — used to map a captured card/cell
   * background color to the nearest token (the gate forbids inline hex, so card
   * surfaces must reference a token slug). When absent, feature cells render as
   * plain columns rather than styled cards.
   */
  paletteTokens?: PaletteToken[];
  /**
   * Registered theme fontFamily tokens ({slug, family}) from the theme.json. Used
   * to map each captured element's computed font-family to the nearest registered
   * token, so a source that mixes families (serif headline + sans eyebrow, or a
   * serif body on a sans-default theme) is reproduced per-element. When absent,
   * headings use the display family and body uses the theme body family.
   */
  fontFamilies?: FontFamilyToken[];
  /**
   * Source media URL -> local upload URL. Used ONLY to rewrite media inside a
   * coverage-gated `core/html` fallback island (the structured renderers already
   * receive media-mapped specs). Island internal links ride buildPageReconstruction's
   * existing link-rewrite post-pass, so no linkMap is threaded here.
   */
  mediaUrlMap?: Map<string, string>;
  /**
   * Adapter-declared block recipe (blocks reconstruct path only). When present,
   * the recipe gets first crack at a coverage-lost section before the opaque
   * core/html fallback island. Absent on the carry/theme path — that's the gate.
   */
  adapterBlocks?: import('../../adapters/page-actions.js').AdapterBlocks;
  /**
   * The source URL of the page being reconstructed. Passed through to the block
   * recipe context so recipes can emit rewritten media URLs keyed to the page.
   */
  sourceUrl?: string;
  /**
   * The bare page slug (e.g. "go2", NOT the slash-bearing patternSlug). Used as
   * the slash-free key component for fallback-diagnostic ids. Falls back to
   * patternSlug when absent.
   */
  slug?: string;
  /**
   * Pre-resolved general HTML→blocks conversions, keyed by SectionSpec.sectionIndex.
   * Supplied by the async handler (which owns the block-fixer client); absent →
   * every section uses the structured render (back-compat). `markup` is raw native
   * block markup (pre URL-rewrite), or null for a passthrough sentinel.
   */
  convertedSections?: Map<number, { markup: string | null; wpHtmlResidue: number }>;
}

export interface ReconstructResult {
  /** The pattern file body (PHP doc-comment header + block markup). */
  php: string;
  /** Just the block markup (no PHP doc-comment header) — the source for a page's
   *  post_content so the page is a real, editable block page. Asset refs still use
   *  the get_theme_file_uri PHP form here; the caller swaps them for literal theme
   *  URLs (post_content is not PHP-evaluated). */
  body: string;
  /** Verbatim headings + button labels + review quotes (provenance: headings). */
  expectedText: string[];
  /** Verbatim body prose (provenance: body <p> corpus). */
  bodyText: string[];
  /** WP-library asset URLs the pattern references. */
  expectedAssets: string[];
  /** Human-readable notes about missing-media / missing-content fallbacks. */
  provenanceFlags: string[];
  /** Structured fallback records (#1), one per core/html island emitted. */
  fallbackDiagnostics: FallbackDiagnostic[];
  /** Count of page-body sections rendered (after chrome strip). */
  sectionsRendered: number;
  /**
   * Theme SVG assets the pattern references via get_theme_file_uri() (feature /
   * comparison icons). The orchestrator/driver MUST write each `svg` to the
   * theme's `path` (e.g. assets/icon-0.svg) before install, or the core/image
   * references 404. Sanitized (no script/event handlers) — safe to write.
   */
  iconAssets: Array<{ path: string; svg: string }>;
  /** True when the first rendered section is a full-bleed wp:cover hero — the page
   *  template should wire the transparent OVERLAY header rather than the solid one. */
  heroIsCover: boolean;
}

// ---------------------------------------------------------------------------
// HTML escaping - re-exported for existing callers/tests.
// ---------------------------------------------------------------------------
export { escapeHtml } from '../html-escape.js';

/**
 * Reconstruct a full page pattern from its captured section specs.
 * Chrome (header/footer/nav) is stripped; only page-body sections are rendered.
 */
export function reconstructPagePattern(
  sections: SectionSpec[],
  opts: ReconstructOptions,
): ReconstructResult {
  const aggregate = reconstructNativeAggregate(sections, renderOptionsFrom(opts));

  const expectedText: string[] = [];
  const bodyText: string[] = [];
  const assets: string[] = [];
  const provenanceFlags: string[] = [];
  const fallbackDiagnostics: FallbackDiagnostic[] = [];
  const sectionMarkup: string[] = [];
  const iconAssets: Array<{ path: string; svg: string }> = [];
  let recipeApplied = false;

  for (const decision of aggregate.sections) {
    const recipeMarkup = adapterRecipeMarkup(decision, opts);
    if (recipeMarkup) {
      recipeApplied = true;
      sectionMarkup.push(recipeMarkup);
      provenanceFlags.push('adapter-recipe#' + decision.spec.sectionIndex + ': platform recipe upgraded section to blocks');
      continue;
    }

    sectionMarkup.push(decision.blocks);
    expectedText.push(...decision.expectedText);
    bodyText.push(...decision.bodyText);
    assets.push(...decision.expectedAssets);
    provenanceFlags.push(...decision.provenanceFlags);
    fallbackDiagnostics.push(...decision.fallbackDiagnostics);
    iconAssets.push(...decision.iconAssets);
  }

  const header =
    '<?php\n/**\n * Title: ' +
    sanitizePatternHeaderField(opts.title) +
    '\n * Slug: ' +
    sanitizePatternHeaderField(opts.patternSlug) +
    '\n' +
    ' * Categories: featured\n * Inserter: false\n */\n?>\n';

  // Media post-pass: the engine's native reconstruction emits source <img src>
  // / url() verbatim (the source CDN/variant URL) and routes ONLY island media
  // through mediaUrlMap — so a native wp:image keeps its remote URL and trips
  // the hasUnmigratedRemoteAsset gate. Rewrite the assembled body against the
  // run's source→upload map so migrated images resolve locally. Island URLs are
  // already local (not source keys) → no-op, so this is safe to apply globally.
  const rawBodyMarkup = sectionMarkup.join('\n\n') + '\n';
  const bodyMarkup = opts.mediaUrlMap
    ? rewriteMediaUrls(rawBodyMarkup, opts.mediaUrlMap)
    : rawBodyMarkup;
  const effectiveFallbackDiagnostics = recipeApplied ? fallbackDiagnostics : aggregate.fallbackDiagnostics;
  const heroIsCover = sectionMarkup.length > 0 && /^\s*<!-- wp:cover\b/.test(sectionMarkup[0]);
  return {
    php: header + bodyMarkup,
    body: bodyMarkup,
    expectedText: recipeApplied ? uniqueNonEmpty(expectedText) : aggregate.expectedText,
    bodyText: recipeApplied ? uniqueNonEmpty(bodyText) : aggregate.bodyText,
    expectedAssets: recipeApplied ? uniqueNonEmpty(assets) : aggregate.expectedAssets,
    provenanceFlags: recipeApplied ? provenanceFlags : aggregate.provenanceFlags,
    fallbackDiagnostics: fallbackDiagnosticsForDla(effectiveFallbackDiagnostics, opts),
    sectionsRendered: sectionMarkup.length,
    iconAssets: recipeApplied ? iconAssets : aggregate.iconAssets,
    heroIsCover,
  };
}

function renderOptionsFrom(opts: ReconstructOptions): SectionRenderOptions {
  return {
    // The blocks reconstruct path carries NO source CSS, so it must select the
    // interpretive structured strategy — clean, theme-styled canonical blocks built
    // from the SectionSpec (renderCover/renderCardGrid/…), self-contained and not
    // dependent on carried source classes. The engine default (preserve-dom) is for
    // the carried-CSS paths (local-convert, theme-carry) and would render unstyled here.
    strategy: structuredStrategy,
    ...(opts.mediaUrlMap ? { mediaUrlMap: opts.mediaUrlMap } : {}),
    ...(opts.convertedSections ? { convertedSections: opts.convertedSections } : {}),
    ...(opts.paletteTokens ? { paletteTokens: opts.paletteTokens } : {}),
    ...(opts.fontFamilies ? { fontFamilies: opts.fontFamilies } : {}),
    ...(opts.sourceUrl ? { sourceUrl: opts.sourceUrl } : {}),
    ...(opts.slug ? { slug: opts.slug } : {}),
  };
}

function adapterRecipeMarkup(decision: NativeSectionDecision, opts: ReconstructOptions): string | null {
  if (decision.decision !== 'fallback' || !opts.adapterBlocks) return null;
  const source = decision.spec.sectionHtml ?? decision.spec.styledHtml;
  if (!source) return null;
  return applyBlockRecipe(source, opts.adapterBlocks, {
    url: opts.sourceUrl ?? '',
    mediaMap: opts.mediaUrlMap ? Object.fromEntries(opts.mediaUrlMap) : undefined,
  });
}

function fallbackDiagnosticsForDla(diagnostics: FallbackDiagnostic[], opts: ReconstructOptions): FallbackDiagnostic[] {
  if (opts.sourceUrl) return diagnostics;
  return diagnostics.map((diagnostic) =>
    diagnostic.page === opts.patternSlug ? diagnostic : { ...diagnostic, page: opts.patternSlug },
  );
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
