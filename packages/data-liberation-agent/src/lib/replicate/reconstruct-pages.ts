// src/lib/replicate/reconstruct-pages.ts
//
// Deterministic per-PAGE reconstruction core. Given a page's captured section
// specs, produce the theme files that render it as block sections: a pattern
// (`patterns/page-<slug>.php`), a template that wires header→pattern→footer
// (`templates/page-<slug>.html`, plus `front-page.html` for the home page), and
// the pattern's icon SVG assets — all gated through validate_artifacts.
//
// WHY THIS EXISTS
// The /liberate→replicate flow historically reconstructed only ONE representative
// per layout cluster and rendered every other page through page.html with carried
// source HTML (raw Wix/Shopify markup) — which looks drastically different from
// the source. This module reconstructs EVERY page from ITS OWN specs (no shared
// cluster skeleton, no carried-HTML fallback), the same path proven on getsnooz.
// The MCP handler (liberate_reconstruct_pages) composes this with extraction,
// media install, and the Studio write/flush; this part is pure + unit-tested.

import { reconstructPagePattern, type FontFamilyToken } from './page-reconstruct.js';
import { validateArtifacts, type ValidationReport } from './validate-artifacts.js';
import { rewriteInternalLinks, type InternalLinkMap } from '../streaming/internal-link-rewrite.js';
import type { SectionSpec } from './section-extract.js';
import type { PaletteToken } from './footer-color.js';
import type { FallbackDiagnostic } from './fallback-diagnostic.js';
import { computeTemplateVariant, type TemplateVariant } from './page-template-plan.js';

/** A theme file to write, path relative to the theme root. */
export interface ReconstructedFile {
  path: string;
  content: string;
}

export interface PageReconstructionResult {
  slug: string;
  patternSlug: string;
  /** pattern php + per-page template(s) + icon SVG assets, theme-root-relative. */
  files: ReconstructedFile[];
  /** The page's post_content: the reconstructed block markup with literal
   *  theme-asset URLs (no PHP) — written into the WP post so it's a real, editable
   *  block page (not a Classic block wrapping carried HTML). */
  postContent: string;
  /** validate_artifacts report for the pattern — caller MUST NOT install when !ok. */
  gate: ValidationReport;
  expectedAssets: string[];
  provenanceFlags: string[];
  sectionsRendered: number;
  iconAssetCount: number;
  /** Sections emitted as UNSTYLED verbatim core/html islands (coverage-gated
   *  fallback, no source CSS → renders bare). These are the fidelity gaps. */
  fallbackSections: number;
  /** Sections emitted as STYLED core/html islands (R4b floor: computed styles
   *  inlined → renders faithfully). Visible, not hidden, but not block-editable. */
  styledFallbackSections: number;
  /** Structured fallback records (#1), one per core/html island emitted. */
  fallbackDiagnostics: FallbackDiagnostic[];
  /** The page-template variant (drives which collapsed template the page uses). */
  variant: TemplateVariant;
  /** The rendered page-template content (header→main→post-content→footer) — the
   *  handler writes this as templates/page-<slug>.html only when the collapse is
   *  toggled OFF; otherwise the planner emits the deduped variant template. */
  template: string;
}

/** Swap the pattern's `get_theme_file_uri()` PHP asset refs for literal
 *  theme-relative URLs, so the block markup is valid in post_content (which is
 *  NOT PHP-evaluated — the PHP would otherwise render as literal text). */
function toPostContent(body: string, themeSlug: string): string {
  return body.replace(
    /<\?php echo esc_url\(get_theme_file_uri\('([^']+)'\)\); \?>/g,
    (_m, rel: string) => `/wp-content/themes/${themeSlug}/${rel}`,
  );
}

// WP slug guard for filenames + block-attribute pattern slugs (mirrors the
// theme-scaffold check; sanitize_title-shaped).
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * A page template shell: header part → reconstructed pattern → footer part.
 * When the page's hero is a full-bleed cover, the header template-part is tagged
 * with the `site-header-overlay` class so the theme renders it as a transparent
 * overlay on the hero (white nav over the photo). Other pages get the solid
 * header. The header distinction lives HERE, in the template — not in a global
 * `.home:has(cover)` CSS override.
 */
export function buildPageTemplate(overlayHeader = false, fullWidth = false): string {
  const headerPart = overlayHeader
    ? `<!-- wp:template-part {"slug":"header","tagName":"header","className":"site-header-overlay"} /-->`
    : `<!-- wp:template-part {"slug":"header","tagName":"header"} /-->`;
  // Full-width vs constrained DEFERS TO THE SOURCE (fullWidth): a source page with
  // full-bleed sections renders full-width so the hero + alignfull bands stretch
  // edge-to-edge (a `constrained` main/post-content would box them to ~content
  // width — the regression where the hero rendered ~1000px); each section still
  // constrains its OWN inner content. A source page with boxed content stays
  // constrained. An overlay-header page also zeroes the main top margin/padding so
  // the hero is flush with the page top (the absolute header floats above it).
  const layoutType = fullWidth ? 'default' : 'constrained';
  const mainAttrs = overlayHeader
    ? `"style":{"spacing":{"margin":{"top":"0px"},"padding":{"top":"0px"}}},"layout":{"type":"${layoutType}"}`
    : `"layout":{"type":"${layoutType}"}`;
  const topZeroStyle = overlayHeader ? ' style="margin-top:0px;padding-top:0px"' : '';
  const mainGroup = `<!-- wp:group {"tagName":"main",${mainAttrs}} -->
<main class="wp-block-group"${topZeroStyle}>`;
  const postContent = `<!-- wp:post-content {"layout":{"type":"${layoutType}"}} /-->`;
  // Render the PAGE's post_content (which the reconstruction writes as block
  // markup) — so the page is a real, editable block page. The theme still ships
  // the reconstructed pattern as a library entry.
  return `${headerPart}

${mainGroup}
${postContent}
</main>
<!-- /wp:group -->

<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
`;
}

/**
 * Build all theme files for one reconstructed page from its section specs.
 * Pure: specs in, files + gate report out. The caller installs the files ONLY
 * when `gate.ok` (a failing gate means escaping/injection/provenance violated —
 * never ship it). Throws on an unsafe slug rather than emitting a bad path.
 */
export function buildPageReconstruction(
  sections: SectionSpec[],
  opts: {
    slug: string;
    title: string;
    themeSlug: string;
    isHome?: boolean;
    paletteTokens?: PaletteToken[];
    fontFamilies?: FontFamilyToken[];
    /**
     * Source-path → local-permalink map (built from `redirect-map.json` via
     * `buildInternalLinkMap`). When supplied, page-body links (inline + CTA
     * hrefs) are rewritten to their imported permalinks — the same map the
     * nav/footer rewrite consumes, so body links agree with the menu. Absent →
     * links pass through unchanged (back-compat).
     */
    linkMap?: InternalLinkMap;
    /** Source media URL -> local upload URL, for rewriting core/html fallback islands. */
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
     * Pre-resolved HTML→blocks conversions keyed by SectionSpec.sectionIndex
     * (from convertSemanticSections). Passed straight to reconstructPagePattern;
     * absent → structured render only.
     */
    convertedSections?: Map<number, { markup: string | null; wpHtmlResidue: number }>;
  },
): PageReconstructionResult {
  if (!SAFE_SLUG.test(opts.slug)) throw new Error(`unsafe page slug: "${opts.slug}"`);
  if (!SAFE_SLUG.test(opts.themeSlug)) throw new Error(`unsafe theme slug: "${opts.themeSlug}"`);

  const patternSlug = `${opts.themeSlug}/page-${opts.slug}`;
  const r = reconstructPagePattern(sections, {
    patternSlug,
    slug: opts.slug,
    title: opts.title,
    paletteTokens: opts.paletteTokens,
    fontFamilies: opts.fontFamilies,
    mediaUrlMap: opts.mediaUrlMap,
    adapterBlocks: opts.adapterBlocks,
    sourceUrl: opts.sourceUrl,
    convertedSections: opts.convertedSections,
  });

  // Rewrite same-site body links to local permalinks BEFORE the gate, so the
  // gate validates the final shipped markup. Only href attribute values change;
  // text/assets are untouched, so provenance still holds.
  const php = opts.linkMap ? rewriteInternalLinks(r.php, opts.linkMap) : r.php;
  const body = opts.linkMap ? rewriteInternalLinks(r.body, opts.linkMap) : r.body;

  // The provenance/injection/escaping gate. The reconstruct output is validated
  // against its OWN captured corpus (expectedText ∪ bodyText) — this catches
  // escaping/injection and that emitted copy traces to captured source text.
  const gate = validateArtifacts({
    patterns: [
      {
        slug: patternSlug,
        php,
        spec: {
          interactionModel: 'static',
          expectedText: r.expectedText,
          bodyText: r.bodyText,
          expectedAssets: r.expectedAssets,
        },
      },
    ],
  });

  const variant = computeTemplateVariant(sections, r.heroIsCover);
  const template = buildPageTemplate(variant.overlayHeader, variant.fullWidth);
  // NOTE: templates/page-<slug>.html is intentionally NOT emitted here — the
  // handler's collapse planner writes the deduped variant template instead (and
  // the per-slug file only when collapseTemplates is toggled OFF). Home still
  // gets front-page.html (its own variant), which WP resolves without assignment.
  const files: ReconstructedFile[] = [
    { path: `patterns/page-${opts.slug}.php`, content: php },
    ...r.iconAssets.map((a) => ({ path: a.path, content: a.svg })),
  ];
  if (opts.isHome) {
    files.push({ path: 'templates/front-page.html', content: template });
  }

  return {
    slug: opts.slug,
    patternSlug,
    files,
    postContent: toPostContent(body, opts.themeSlug),
    gate,
    expectedAssets: r.expectedAssets,
    provenanceFlags: r.provenanceFlags,
    sectionsRendered: r.sectionsRendered,
    iconAssetCount: r.iconAssets.length,
    fallbackSections: r.provenanceFlags.filter((f) => f.startsWith('html-fallback#')).length,
    styledFallbackSections: r.provenanceFlags.filter(
      (f) => f.startsWith('html-fallback-styled#') || f.startsWith('html-fallback-responsive#'),
    ).length,
    fallbackDiagnostics: r.fallbackDiagnostics,
    variant,
    template,
  };
}
