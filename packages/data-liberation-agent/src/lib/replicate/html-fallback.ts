//
// Verbatim core/html fallback
// ===========================
// When a section's structured render drops content (see section-coverage.ts),
// we emit the section's source outerHTML VERBATIM as a `core/html` block rather
// than ship the lossy blocks — mirroring h2bc's "unsupported -> core/html"
// model. The tradeoff: that one section loses block-editability/theming, but
// nothing is dropped or guessed ([[feedback_never_lose_source_content]]).
//
// "Verbatim" = content-faithful, MINUS active/unsafe content. The validate-
// artifacts injection gate rejects `<script>`, inline `on*=` handlers, and raw
// `<?php`, so the island is sanitized to clear all three before it can ship.
// Media URLs and internal links are rewritten through the same maps the rest of
// the reconstruction uses, so the island points at local uploads + imported
// pages.
//
import { rewriteMediaUrls } from '../streaming/media-url-rewrite.js';
import { rewriteInternalLinks, type InternalLinkMap } from '../streaming/internal-link-rewrite.js';
import { scanForInjection } from './validate-artifacts.js';
import { PIPELINE_ISLAND_OPENER } from '../wordpress/block-policy.js';

export interface HtmlFallbackOpts {
  /** Source media URL -> local upload URL (same map the block path uses). */
  mediaUrlMap?: Map<string, string>;
  /** Source-path -> local-permalink map (#2), for inline links in the island. */
  linkMap?: InternalLinkMap;
}

/** Remove script/style/comment blocks, inline event handlers, and PHP tags. */
export function sanitize(html: string): string {
  return html
    // Paired script/style including their contents.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    // Any residual/unclosed script/style tags.
    .replace(/<\/?(?:script|style)\b[^>]*>/gi, '')
    // PHP (incl. short tags) — no <?php may survive the injection gate.
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<\?/g, '')
    // HTML comments — strips noise AND any literal `<!-- wp:… -->` lookalikes
    // that would otherwise break block parsing of the surrounding markup.
    .replace(/<!--[\s\S]*?-->/g, '')
    // Inline event handlers (onclick/onerror/onload/…), quoted or bare.
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

const WP_LAYOUT_MARKER = /(?:is-layout-(?:constrained|flow|flex)|wp-block-|has-global-padding)/;

/** True when the markup carries WP-layout classes the replica block theme styles
 *  responsively (`is-layout-*`, `wp-block-*`, `has-global-padding`). Used to pick
 *  the responsive `sectionHtml` snapshot over the frozen `styledHtml` for WP
 *  sources, so the island reflows via the theme's CSS instead of captured pixels. */
export function isWpLayoutMarkup(html: string): boolean {
  return WP_LAYOUT_MARKER.test(html);
}

export type IslandTier = 'responsive' | 'styled' | 'verbatim';

/** Choose which captured snapshot the core/html island should use, and classify
 *  the result. WP-native sections (the replica block theme styles their classes)
 *  use the clean, responsive `sectionHtml`; otherwise the `styledHtml` snapshot
 *  (computed dims inlined) is load-bearing; with no styled snapshot, the bare
 *  `sectionHtml` is the verbatim floor. Pure — no I/O. */
export function selectIslandSource(
  section: { sectionHtml?: string; styledHtml?: string },
): { source: string; tier: IslandTier } {
  if (section.sectionHtml && isWpLayoutMarkup(section.sectionHtml)) {
    return { source: section.sectionHtml ?? section.styledHtml ?? '', tier: 'responsive' };
  }
  if (section.styledHtml) return { source: section.styledHtml, tier: 'styled' };
  return { source: section.sectionHtml ?? '', tier: 'verbatim' };
}

/**
 * Build a sanitized, URL-rewritten `core/html` block from a section's source
 * outerHTML. Throws if sanitization left any injection vector (defensive — a bad
 * island must never silently ship past the gate).
 *
 * The opening delimiter carries the PIPELINE_ISLAND_OPENER marker
 * (`metadata.name = "lib-coverage-island"`): install-time validation
 * (validateReplicaInputs) rejects hand-authored wp:html in theme files but
 * accepts pipeline-emitted coverage islands by this marker, so a
 * previously-reconstructed theme can be reinstalled. The marker is markup-only
 * (a WP-supported block attribute) — it also labels the island in the editor
 * List View.
 */
export function buildHtmlFallbackBlock(sectionHtml: string, opts: HtmlFallbackOpts = {}): string {
  let inner = sanitize(sectionHtml);
  if (opts.mediaUrlMap && opts.mediaUrlMap.size > 0) inner = rewriteMediaUrls(inner, opts.mediaUrlMap);
  if (opts.linkMap && opts.linkMap.size > 0) inner = rewriteInternalLinks(inner, opts.linkMap);

  const violations = scanForInjection(inner);
  if (violations.length > 0) {
    throw new Error(`html-fallback sanitization left injection vectors: ${violations.join('; ')}`);
  }

  return `${PIPELINE_ISLAND_OPENER}\n${inner.trim()}\n<!-- /wp:html -->`;
}
