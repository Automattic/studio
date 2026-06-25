// src/lib/replicate/page-reconstruct.ts
//
// Deterministic spec -> block-pattern renderer for non-homepage content pages.
//
//   SectionSpec[] (from liberate_section_extract detail:"full")
//        │  stripChrome (drop header/nav + sitewide footer sections)
//        │  renderSection (model -> faithful core-block markup, verbatim copy)
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

import type { SectionSpec, SectionSpecImage, SectionSpecIcon, SectionSpecCell } from './section-extract.js';
import { nearestToken, brightness, type PaletteToken } from './footer-color.js';
import type { ExtractedReview } from './review-extract.js';
import * as cheerio from 'cheerio';
import { measureSectionCoverage, measureConvertedCoverage, foldText } from './section-coverage.js';
import { buildHtmlFallbackBlock, selectIslandSource } from './html-fallback.js';
import { rewriteMediaUrls } from '../streaming/media-url-rewrite.js';
import { hasUnmigratedRemoteAsset, scanForInjection } from './validate-artifacts.js';
import { applyBlockRecipe } from './apply-block-recipe.js';
import { buildFallbackDiagnostic, type FallbackDiagnostic } from './fallback-diagnostic.js';
import { formToBlocks, SKIPPED_FIELD_KINDS } from './form-blocks.js';

/**
 * A source-VERBATIM FAQ question/answer pair. The renderer emits these as a
 * `wp:details` accordion (faithful to the source's expand/collapse UX). FAQ
 * answers that are JS-hydrated and absent from a static capture must be
 * re-captured with the accordions expanded and attached here — NEVER invented.
 * When a question's answer could not be captured, leave `answer` empty and the
 * renderer emits the missing-content placeholder + a provenance flag.
 */
export interface FaqPair {
  question: string;
  answer: string;
}

/** A spec section may carry source-verbatim FAQ pairs (re-captured from an accordion). */
type SectionSpecWithFaqs = SectionSpec & { faqs?: FaqPair[] };

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
// HTML escaping — mirrors theme-scaffold.escapeHtml. Source text is escaped on
// the way into block markup so a stray "<" / "&" / quote in captured copy can't
// break the block comment or inject markup.
// ---------------------------------------------------------------------------
import { escapeHtml } from '../html-escape.js';
export { escapeHtml };

/** Collapse whitespace; drop zero-width + soft-hyphen noise. Keeps copy verbatim. */
export function normalizeCopy(s: string): string {
  return s
    .replace(/­/g, '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip tags + collapse whitespace to the visible text of an `<h>`/`<p>` inner
 *  HTML — used to seed the page provenance gate's text corpus from converted
 *  native blocks (their headings/paragraphs trace by construction). */
const visibleText = (h: string): string => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const MISSING_IMAGE_PLACEHOLDER = '[image unavailable — not captured]';

/**
 * Minimum side (px) for an image to qualify as a section's LEAD photo. Below
 * this it's decorative — a quote-mark glyph, badge, or icon that a page builder
 * renders as a small <img>. Blowing such a graphic up to fill a hero/text-band
 * lead slot is the "giant quotation mark where the product photo should be"
 * artifact, so the lead-image slots skip sub-threshold images.
 */
const MIN_LEAD_IMAGE_PX = 200;
/** Cell/card images (team headshots, product thumbnails) are legitimately
 *  smaller than a hero lead photo, so they use a lower floor — still well above
 *  decorative-glyph size (quote marks / tiny icons are <40px). Without this a
 *  ~180px circular team avatar is dropped and a member renders as text-only. */
const MIN_CELL_IMAGE_PX = 90;

/** First image large enough to be a real lead photo (not a decorative glyph). */
function pickLeadImage(images: SectionSpecImage[]): SectionSpecImage | undefined {
  return images.find((im) => Math.min(im.width || 0, im.height || 0) >= MIN_LEAD_IMAGE_PX);
}

/**
 * Neutralize a value interpolated into the PHP pattern doc-comment header so a
 * crafted source-derived title/slug cannot break OUT of the doc-comment and
 * inject executable PHP. A title shaped like a comment-close + code + comment-open
 * would, in PHP, close the doc-comment early, run the code, then re-open a comment
 * that swallows the rest through the real header close — a comment-breakout RCE.
 * (`validate_artifacts` also defends this via a tempered header match, but the
 * renderer must never EMIT such a header in the first place.) The header is
 * metadata only, never rendered copy, so stripping comment/PHP-tag delimiters and
 * collapsing to one line is lossless here.
 */
export function sanitizePatternHeaderField(s: string): string {
  return s
    .replace(/\*\//g, '') // cannot close the doc-comment early
    .replace(/\/\*/g, '') // cannot open a nested comment
    .replace(/<\?/g, '') // no PHP open tag
    .replace(/\?>/g, '') // no PHP close tag
    .replace(/[\r\n]+/g, ' ') // single line
    .trim();
}

/** A WP media-library URL is the migrated form; anything else is a capture gap. */
function isWpUrl(u: string): boolean {
  return /\/wp-content\/uploads\//i.test(u);
}

/**
 * True when a section sits on a colorful LIGHT background tint (the source's
 * mint feature bands), so it should render on the raised surface token instead
 * of flattening to white. Excludes white/near-white (brightness >=245), dark
 * bands (<100 — those need an inverse-text treatment, handled separately), and
 * neutral greys (low saturation). Navy text stays readable on the light mint, so
 * no per-emitter text-color cascade is needed for this case.
 */
function isTintedSection(s: SectionSpec): boolean {
  const b = s.backgroundBrightness;
  if (b >= 245 || b < 100) return false;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s.backgroundColor || '');
  if (!m) return false;
  const sat = Math.max(+m[1], +m[2], +m[3]) - Math.min(+m[1], +m[2], +m[3]);
  return sat >= 25;
}

/** Footer/nav chrome detection — the sitewide footer leaks into every page
 *  capture as trailing sections. We render page body only; header + footer come
 *  from the theme parts, so a captured footer section must be stripped or the
 *  page shows TWO footers (the reconstructed one + the theme footer part). */
function isChromeSection(s: SectionSpec): boolean {
  if (s.interactionModel === 'footer' || s.interactionModel === 'nav') return true;
  const heads = s.headings.map((h) => normalizeCopy(h).toLowerCase());
  const body = (s.bodyText ?? []).map((b) => normalizeCopy(b));
  const buttons = (s.buttonLabels ?? []).map((b) => normalizeCopy(b));
  const allText = [...heads, ...body, ...buttons];
  // GENERIC footer signal: a copyright / attribution line. Only footers carry
  // "© <year>", "all rights reserved", "website by", "powered by" — and
  // stripChrome only removes TRAILING sections, so a stray mid-page mention
  // can't be falsely stripped. (This is what swiftlumber's footer carries:
  // "© 2026 Website by Tokuda Technology".)
  const hasCopyright = allText.some((t) =>
    /(?:©|\(c\)\s|copyright\b|all rights reserved|website by|powered by)/i.test(t),
  );
  // getsnooz's footer nav + newsletter (kept for back-compat).
  const hasFooterNav = heads.includes('shop') && heads.includes('support') && heads.includes('company');
  const hasNewsletter = body.some((b) => /get some good snooz/i.test(b));
  return hasCopyright || hasFooterNav || hasNewsletter;
}

/** Leading site-header chrome: a SHORT top-of-page band dominated by nav links
 *  (+ logo), with no real prose. When the section detector captures the whole
 *  page as <section> tiles (flat Wix pages), the header tile arrives as a
 *  `static` section rather than model `nav`, so the nav-model check alone misses
 *  it and the page renders the menu/contact block above its content. The theme
 *  supplies its own header part, so a leading header band is always redundant.
 *  Guarded by height so a tall hero or content band can never match. */
function isHeaderChrome(s: SectionSpec): boolean {
  if (s.interactionModel === 'nav') return true;
  if (s.height > 200) return false; // headers are thin; heroes/content are tall
  const body = (s.bodyText ?? []).map((b) => normalizeCopy(b)).filter(Boolean);
  const heads = s.headings.map((h) => normalizeCopy(h)).filter(Boolean);
  const shortLinkish = body.filter((b) => b.length <= 30).length;
  const hasLongProse = [...body, ...heads].some((t) => t.length > 80);
  return shortLinkish >= 3 && !hasLongProse;
}

/**
 * Drop trailing sitewide chrome (footer + newsletter) and leading header/nav.
 * Only strips from the ends — a dark-bg content band in the page middle (e.g.
 * the "100 Night Happiness Guarantee" block) is preserved.
 */
export function stripChrome(sections: SectionSpec[]): SectionSpec[] {
  let start = 0;
  let end = sections.length;
  while (start < end && isHeaderChrome(sections[start])) start++;
  while (end > start && isChromeSection(sections[end - 1])) end--;
  return sections.slice(start, end);
}

// ---------------------------------------------------------------------------
// Block emitters. Each returns { markup, expectedText, bodyText, assets, flags }.
// ---------------------------------------------------------------------------

interface BlockOut {
  markup: string;
  expectedText: string[];
  bodyText: string[];
  assets: string[];
  flags: string[];
  /** Theme SVG assets this block references (path relative to the theme root + bytes). */
  iconAssets: Array<{ path: string; svg: string }>;
}

function emptyOut(): BlockOut {
  return { markup: '', expectedText: [], bodyText: [], assets: [], flags: [], iconAssets: [] };
}

/**
 * Sanitize a source-captured inline SVG before it's written as a theme asset and
 * referenced from a `core/image`. Loading SVG via `<img src>` already prevents
 * script execution in browsers, but strip active content defensively (the SVG is
 * source-derived = attacker-controlled per the project trust boundary): no
 * <script>, <foreignObject>, event-handler attributes, or javascript: URLs.
 */
export function sanitizeSvgAsset(svg: string): string {
  return (
    svg
      .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
      // SMIL animation elements can set event-handler attributes at runtime
      // (e.g. <set attributeName="onload" to="…">) — a direct-navigation XSS
      // vector that the on*= attribute strip below misses. A static icon glyph
      // never animates, so drop these wholesale (both self-closing and paired).
      .replace(/<(set|animate|animateTransform|animateMotion)\b[\s\S]*?(?:\/>|<\/\1\s*>)/gi, '')
      // External / script href on <a>/<use>/<image> (tracking + SSRF-ish on
      // direct navigation). Keep local #fragment refs and inline data:image.
      .replace(
        /\s(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|data:(?!image\/))[^"']*["']/gi,
        '',
      )
      .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
      .replace(/javascript:/gi, '')
      .trim()
  );
}

/**
 * Force a (monochrome) icon glyph to a single fill color. Captured icons often
 * carry no fill (colored by page CSS, which an <img>-loaded SVG ignores → they
 * default to black); on a dark card surface that's invisible. Drop existing
 * fill/stroke colors (keep `none`) and set fill on the root <svg> so a pathless
 * glyph inherits it.
 */
function recolorSvg(svg: string, hex: string): string {
  const stripped = svg
    .replace(/\sfill="(?!none")[^"]*"/gi, '')
    .replace(/\sstroke="(?!none")[^"]*"/gi, '');
  return stripped.replace(/<svg\b/i, `<svg fill="${hex}"`);
}

/** Shared render context threaded through a single reconstructPagePattern call. */
interface RenderCtx {
  /** Alternating side index for media-text bands. */
  mediaTextIndex: number;
  /** Monotonic counter for unique icon-asset filenames across the page. */
  iconCounter: number;
  /** Theme palette tokens for mapping captured card backgrounds → token slugs. */
  paletteTokens: PaletteToken[];
  /** Theme fontFamily tokens for mapping captured cell families → token slugs. */
  fontFamilies: FontFamilyToken[];
}

/**
 * Emit a cell icon as a `core/image` referencing a theme SVG asset via the
 * gate-sanctioned `get_theme_file_uri()` form (theme-relative, no slug needed;
 * wp:html is banned so the glyph can't be inlined). Registers the sanitized SVG
 * bytes on `out.iconAssets` for the driver to write to assets/. Returns '' when
 * the icon has no usable markup.
 */
function iconImageBlock(
  icon: SectionSpecIcon,
  out: BlockOut,
  ctx: RenderCtx,
  opts: { sizePx?: number; fill?: string; align?: 'left' | 'center' | 'right' } = {},
): string {
  const sizePx = opts.sizePx ?? 48;
  if (icon.kind !== 'svg' || !icon.markup) return '';
  let svg = sanitizeSvgAsset(icon.markup);
  if (!svg || !/<svg[\s>]/i.test(svg)) return '';
  // Captured icon glyphs usually carry NO fill (the source colors them via page
  // CSS, which doesn't apply to an <img>-loaded SVG) — so they default to black.
  // On a dark card the icon must be light or it's invisible; force the fill.
  if (opts.fill) svg = recolorSvg(svg, opts.fill);
  const path = `assets/icon-${ctx.iconCounter++}.svg`;
  out.iconAssets.push({ path, svg });
  const src = `<?php echo esc_url(get_theme_file_uri('${path}')); ?>`;
  // Honor the source icon placement (left when the card content is left-aligned —
  // a centered icon over left text is the mismatch). 'left' = no align (default
  // left in the block flow, not a float).
  const align = opts.align ?? 'center';
  const alignAttr = align === 'center' ? ',"align":"center"' : align === 'right' ? ',"align":"right"' : '';
  const alignClass = align === 'center' ? ' aligncenter' : align === 'right' ? ' alignright' : '';
  return (
    `<!-- wp:image {"width":"${sizePx}px","height":"${sizePx}px","sizeSlug":"full"${alignAttr}} -->\n` +
    `<figure class="wp-block-image${alignClass} size-full is-resized"><img src="${src}" alt="" style="width:${sizePx}px;height:${sizePx}px"/></figure>\n` +
    `<!-- /wp:image -->`
  );
}

/** Pick the first usable WP image; if none reached the library, flag it. */
function resolveImage(
  img: SectionSpecImage | undefined,
  out: BlockOut,
  context: string,
): { url: string; alt: string; usable: boolean } {
  if (!img) {
    out.flags.push(`${context}: no image in spec — placeholder emitted`);
    return { url: '', alt: MISSING_IMAGE_PLACEHOLDER, usable: false };
  }
  if (!isWpUrl(img.url)) {
    out.flags.push(`${context}: image not in WP library (${img.sourceUrl}) — placeholder emitted`);
    return { url: '', alt: MISSING_IMAGE_PLACEHOLDER, usable: false };
  }
  return { url: img.url, alt: img.alt || '', usable: true };
}

function imageBlock(
  img: SectionSpecImage | undefined,
  out: BlockOut,
  context: string,
  opts: { rounded?: boolean; align?: 'center' | null } = {},
): string {
  const r = resolveImage(img, out, context);
  const roundStyle = opts.rounded ? ',"style":{"border":{"radius":"12px"}}' : '';
  const roundClass = opts.rounded ? ' has-custom-border' : '';
  const alignAttr = opts.align === 'center' ? ',"align":"center"' : '';
  const alignClass = opts.align === 'center' ? ' aligncenter' : '';
  if (!r.usable) {
    // A sized placeholder paragraph (gate-exempt text) instead of an unrelated photo.
    return (
      `<!-- wp:paragraph {"align":"center","textColor":"text-subtle","fontSize":"small"} -->\n` +
      `<p class="has-text-align-center has-text-subtle-color has-text-color has-small-font-size">${escapeHtml(
        MISSING_IMAGE_PLACEHOLDER,
      )}</p>\n<!-- /wp:paragraph -->`
    );
  }
  out.assets.push(r.url);
  // Carry the source's RENDERED width so the image isn't blown up to the full
  // container (a 532px photo rendered container-wide). max-width:100% keeps it
  // responsive AND lets it fill a narrower column (media-text) — capped there,
  // intrinsic when standalone. height:auto preserves aspect.
  const w = img && img.width && img.height ? Math.round(img.width) : 0;
  const widthAttr = w ? `,"width":"${w}px"` : '';
  const resizedClass = w ? ' is-resized' : '';
  const dimStyle = w ? `width:${w}px;max-width:100%;height:auto;` : '';
  const borderStyle = opts.rounded ? 'border-radius:12px;' : '';
  const imgStyle = dimStyle || borderStyle ? ` style="${dimStyle}${borderStyle}"` : '';
  return (
    `<!-- wp:image {"sizeSlug":"large"${widthAttr}${alignAttr}${roundStyle}} -->\n` +
    `<figure class="wp-block-image${alignClass} size-large${roundClass}${resizedClass}"><img src="${escapeHtml(
      r.url,
    )}" alt="${escapeHtml(r.alt)}"${imgStyle}/></figure>\n` +
    `<!-- /wp:image -->`
  );
}

/**
 * A responsive font size that equals the captured px at a 1440px viewport and
 * scales down on mobile (so a faithful 92px hero headline doesn't overflow the
 * 390px responsiveness gate). Returns '' for a missing/zero size.
 */
function responsiveFontSize(px: number | undefined): string {
  if (!px || px <= 0) return '';
  const floor = Math.min(px, Math.max(16, Math.round(px * 0.5)));
  const vw = (px / 14.4).toFixed(1); // == px at 1440px wide
  return `clamp(${floor}px, ${vw}vw, ${px}px)`;
}

// Reproduce a measured vertical-padding value (px, captured at 1440 desktop)
// as a responsive CSS length so section whitespace scales down on mobile rather
// than dwarfing a small screen. Small values are emitted literally (a clamp with
// min>max is invalid, and there's nothing to scale below ~24px).
function responsiveSpace(px: number): string {
  const p = Math.max(0, Math.round(px));
  if (p < 24) return `${p}px`;
  const floor = Math.max(16, Math.round(p * 0.45));
  const vw = (p / 14.4).toFixed(2); // == px at 1440px wide
  return `clamp(${floor}px, ${vw}vw, ${p}px)`;
}

// Pull the geometrically-measured top/bottom padding off a section's layout.
// Only present when section-extract measured it (content-box vs section-box);
// absent → wrapSection keeps its preset spacing for back-compat.
function sectionPad(s: SectionSpec): { padTopPx?: number; padBottomPx?: number } {
  const t = s.layout?.padTopPx;
  const b = s.layout?.padBottomPx;
  return {
    ...(typeof t === 'number' ? { padTopPx: t } : {}),
    ...(typeof b === 'number' ? { padBottomPx: b } : {}),
  };
}

// Reproduce the section's source text alignment. When section-extract didn't
// capture `textAlign` (older specs / unit fixtures) we preserve the historical
// hard-centered behavior so existing output and tests don't shift; a real
// extraction always sets it, so left-aligned source bands render left.
function centerOf(s: SectionSpec): boolean {
  return s.textAlign == null ? true : s.textAlign === 'center';
}
// CSS flex justify for a button row. Mirrors the text helpers' capability
// (center vs left) so a button row never diverges from the copy beside it —
// headingBlock/paragraphBlock don't emit right alignment yet, so a 'right'
// section renders left text and must not right-justify its buttons.
function buttonJustify(s: SectionSpec): 'left' | 'center' {
  return centerOf(s) ? 'center' : 'left';
}

// Build a block typography style (attr JSON fragment + inline style) from a
// computed font-size clamp + line-height ratio. Both are gate-safe (px/clamp/
// unitless number — no hex, no URL). Line-height is bounded to a sane range so a
// mismeasured value can't wreck leading.
function typographyStyle(fontCss: string, lineHeight?: number): { attr: string; inline: string } {
  const attrParts: string[] = [];
  const inlineParts: string[] = [];
  if (fontCss) {
    attrParts.push(`"fontSize":"${fontCss}"`);
    inlineParts.push(`font-size:${fontCss}`);
  }
  if (typeof lineHeight === 'number' && lineHeight >= 0.8 && lineHeight <= 2.4) {
    attrParts.push(`"lineHeight":"${lineHeight}"`);
    inlineParts.push(`line-height:${lineHeight}`);
  }
  return {
    attr: attrParts.length ? `"style":{"typography":{${attrParts.join(',')}}},` : '',
    inline: inlineParts.length ? ` style="${inlineParts.join(';')}"` : '',
  };
}

/** Registered theme fontFamily token ({slug, family}); used to map a captured
 *  computed font-family to the nearest registered token (the gate wants a token,
 *  not a raw family, and the file must be self-hosted). */
export interface FontFamilyToken {
  slug: string;
  family: string;
}
function familyHash(s: string): string | null {
  const m = s.match(/[0-9a-f]{10,}/i);
  return m ? m[0].toLowerCase() : null;
}
/** Does a computed font-family (first token, lowercased) reference this token? Exact
 *  name match, Wix obfuscated-handle hash match (wfont_5499e3_<hash> vs wf_<hash>,
 *  matched when one hash contains the other), or ≥4-char substring overlap. */
function familyMatches(c: string, t: FontFamilyToken): boolean {
  const first = (t.family || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  const slug = (t.slug || '').toLowerCase();
  if (first && first === c) return true;
  const ch = familyHash(c);
  if (ch) {
    const th = familyHash(t.family) || familyHash(slug);
    if (th && (th.includes(ch) || ch.includes(th))) return true;
  }
  if (first && first.length >= 4 && (c.includes(first) || first.includes(c))) return true;
  return false;
}
/**
 * Map a captured computed font-family to a theme fontFamily token SLUG. Only the
 * theme's two primary faces render reliably — `display` (the captured heading
 * face) and `body` (the body face/substitute); the many extra captured Wix
 * handles often carry broken fontFace (a `file.woff2` stub) that WP drops, so
 * mapping to them would render nothing. So: a family that IS the display face →
 * `display`; anything else → `body` (the other primary face). This reproduces a
 * source that mixes faces (a sans eyebrow over a serif headline, or a serif body
 * on a sans-default theme) using only faces that actually render. Site-agnostic.
 */
function nearestFamily(computed: string | undefined, tokens: FontFamilyToken[]): string | null {
  if (!computed || tokens.length === 0) return null;
  const c = computed.replace(/["']/g, '').trim().toLowerCase();
  if (!c || c === 'inherit' || c === 'sans-serif' || c === 'serif') return null;
  const display = tokens.find((t) => t.slug === 'display');
  const body = tokens.find((t) => t.slug === 'body');
  // Check body BEFORE display so that an exact or substring name match on the
  // body token wins even when the display token's name CONTAINS the body name as
  // a prefix/substring (e.g. display="Caldera Display", body="Caldera": a
  // paragraph computed as "caldera" must map to body, not display). The
  // catch-all at the end still maps unrecognised handles to body by elimination.
  if (body && familyMatches(c, body)) return 'body';
  if (display && familyMatches(c, display)) return 'display';
  // Matches neither primary face by name (a Wix handle whose own face WP dropped):
  // classify by elimination — not the display face → the body face.
  if (body) return 'body';
  return null;
}

function headingBlock(
  text: string,
  out: BlockOut,
  opts: {
    level?: number;
    center?: boolean;
    muted?: boolean;
    inverse?: boolean;
    sizePx?: number;
    fontFamily?: string | null;
    lineHeight?: number;
  } = {},
): string {
  const t = normalizeCopy(text);
  if (!t) return '';
  out.expectedText.push(t);
  const level = opts.level ?? 2;
  const centerAttr = opts.center ? '"textAlign":"center",' : '';
  const centerClass = opts.center ? ' has-text-align-center' : '';
  const colorSlug = opts.inverse ? 'text-inverse' : opts.muted ? 'text-muted' : 'text-default';
  // Reproduce the source's heading size (responsive clamp) + line-height when
  // captured, so an eyebrow label and a headline keep their real sizes instead of
  // the generic level scale (which inverts them).
  const fontCss = responsiveFontSize(opts.sizePx);
  const ts = typographyStyle(fontCss, opts.lineHeight);
  // Per-heading family when the source mixes families (a sans eyebrow over a serif
  // headline); falls back to the heading display family.
  const familySlug = opts.fontFamily || 'display';
  return (
    `<!-- wp:heading {${centerAttr}${ts.attr}"level":${level},"fontFamily":"${familySlug}","textColor":"${colorSlug}"} -->\n` +
    `<h${level} class="wp-block-heading${centerClass} has-${colorSlug}-color has-text-color has-${familySlug}-font-family"${ts.inline}>${escapeHtml(
      t,
    )}</h${level}>\n<!-- /wp:heading -->`
  );
}

function paragraphBlock(
  text: string,
  out: BlockOut,
  opts: {
    center?: boolean;
    muted?: boolean;
    size?: string;
    inverse?: boolean;
    sizePx?: number;
    fontFamily?: string | null;
    lineHeight?: number;
  } = {},
): string {
  const t = normalizeCopy(text);
  if (!t) return '';
  out.bodyText.push(t);
  const centerAttr = opts.center ? '"align":"center",' : '';
  const centerClass = opts.center ? 'has-text-align-center ' : '';
  const colorSlug = opts.inverse ? 'text-inverse' : opts.muted === false ? 'text-default' : 'text-muted';
  // Reproduce the source prose size (responsive clamp) when captured and in a
  // sane body range — takes precedence over the size slug. Out-of-range values
  // (tiny captions / heading-sized) fall back to the slug / theme scale.
  const px = opts.sizePx && opts.sizePx >= 11 && opts.sizePx <= 32 ? opts.sizePx : 0;
  const fontCss = responsiveFontSize(px);
  const ts = typographyStyle(fontCss, opts.lineHeight);
  const sizeAttr = !fontCss && opts.size ? `"fontSize":"${opts.size}",` : '';
  const sizeClass = !fontCss && opts.size ? ` has-${opts.size}-font-size` : '';
  // Per-paragraph family when the source body diverges from the theme body family
  // (e.g. a serif body on a sans-default theme). Absent → theme body family.
  const familyAttr = opts.fontFamily ? `"fontFamily":"${opts.fontFamily}",` : '';
  const familyClass = opts.fontFamily ? ` has-${opts.fontFamily}-font-family` : '';
  return (
    `<!-- wp:paragraph {${centerAttr}${ts.attr}${sizeAttr}${familyAttr}"textColor":"${colorSlug}"} -->\n` +
    `<p class="${centerClass}has-${colorSlug}-color has-text-color${sizeClass}${familyClass}"${ts.inline}>${escapeHtml(
      t,
    )}</p>\n<!-- /wp:paragraph -->`
  );
}

function buttonBlock(label: string, out: BlockOut, opts: { align?: 'left' | 'center' | 'right' } = {}): string {
  const t = normalizeCopy(label);
  if (!t) return '';
  out.expectedText.push(t);
  const justify = opts.align ?? 'center';
  const justifyClass = ` is-content-justification-${justify}`;
  // Static, hrefless CTA: source interactivity (add-to-cart) did not survive
  // extraction, so we emit an honest non-linking button rather than invent a URL.
  return (
    `<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"${justify}"}} -->\n` +
    `<div class="wp-block-buttons${justifyClass}">\n` +
    `<!-- wp:button {"backgroundColor":"accent-primary","textColor":"text-inverse"} -->\n` +
    `<div class="wp-block-button"><a class="wp-block-button__link has-text-inverse-color has-accent-primary-background-color has-text-color has-background wp-element-button">${escapeHtml(
      t,
    )}</a></div>\n` +
    `<!-- /wp:button -->\n</div>\n<!-- /wp:buttons -->`
  );
}

/** rgb()/rgba() → #rrggbb (for recoloring a button icon SVG to the text color). */
function rgbToHex(rgb: string): string | null {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const h = (n: string) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
}

/**
 * A structured section CTA: reproduces the source button's destination (href),
 * colors (captured bg/text mapped to theme tokens — a white CTA renders white,
 * not the brand green), and inline icon (shipped as a theme SVG asset, recolored
 * to the text color, referenced via get_theme_file_uri — wp:html is banned).
 * Falls back to the default accent pill when colors/href/icon weren't captured.
 */
function ctaButton(
  out: BlockOut,
  ctx: RenderCtx,
  btn: { label: string; href?: string; background?: string | null; color?: string | null; icon?: SectionSpecIcon | null; iconAfter?: boolean },
  opts: { align?: 'left' | 'center' } = {},
): string {
  const t = normalizeCopy(btn.label);
  if (!t && !btn.icon) return '';
  if (t) out.expectedText.push(t);
  const justify = opts.align ?? 'center';
  const justifyClass = ` is-content-justification-${justify}`;
  // Map captured colors to theme tokens; default to the accent pill.
  const bgToken = btn.background ? nearestToken(btn.background, ctx.paletteTokens) : null;
  const textTok = btn.color ? nearestToken(btn.color, ctx.paletteTokens) : null;
  const bg = bgToken ?? 'accent-primary';
  // Text color: the captured token, else contrast-based off the button background
  // (a dark/green button gets light text, a light button dark) — never blindly
  // text-default, which produced black text on the green CTA.
  let text: string;
  if (textTok) {
    text = textTok;
  } else {
    const bgHex = ctx.paletteTokens.find((t) => t.slug === bg)?.hex;
    text = bgHex && brightness(bgHex) >= 140 ? 'text-default' : 'text-inverse';
  }
  // Inline icon → theme SVG asset, recolored to the button text color so it's
  // visible on the button surface. Placed on the side the SOURCE captured it
  // (iconAfter — geometry-derived, not assumed), with the margin between icon and
  // label on the correct side.
  let iconImg = '';
  if (btn.icon && btn.icon.kind === 'svg' && btn.icon.markup) {
    let svg = sanitizeSvgAsset(btn.icon.markup);
    if (svg && /<svg[\s>]/i.test(svg)) {
      const fillHex = btn.color ? rgbToHex(btn.color) : null;
      if (fillHex) svg = recolorSvg(svg, fillHex);
      const path = `assets/icon-${ctx.iconCounter++}.svg`;
      out.iconAssets.push({ path, svg });
      const src = `<?php echo esc_url(get_theme_file_uri('${path}')); ?>`;
      const margin = btn.iconAfter ? 'margin-left:8px' : 'margin-right:8px';
      iconImg = `<img src="${src}" alt="" style="width:18px;height:18px;vertical-align:middle;${margin}"/>`;
    }
  }
  // Destination: same-origin path / external URL / tel: — honest non-linking when absent.
  const href = btn.href ? ` href="${escapeHtml(btn.href)}"` : '';
  const inner = btn.iconAfter ? `${escapeHtml(t)}${iconImg}` : `${iconImg}${escapeHtml(t)}`;
  return (
    `<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"${justify}"}} -->\n` +
    `<div class="wp-block-buttons${justifyClass}">\n` +
    `<!-- wp:button {"backgroundColor":"${bg}","textColor":"${text}"} -->\n` +
    `<div class="wp-block-button"><a class="wp-block-button__link has-${text}-color has-${bg}-background-color has-text-color has-background wp-element-button"${href}>${inner}</a></div>\n` +
    `<!-- /wp:button -->\n</div>\n<!-- /wp:buttons -->`
  );
}

/** Emit a section's CTAs from the structured `buttons` capture when present,
 *  else fall back to the plain label list. Shared by the section renderers. */
function sectionButtons(s: SectionSpec, out: BlockOut, ctx: RenderCtx): string[] {
  const align = buttonJustify(s);
  if (s.buttons && s.buttons.length) {
    return s.buttons.map((b) => ctaButton(out, ctx, b, { align })).filter(Boolean);
  }
  return s.buttonLabels.map((b) => ctaButton(out, ctx, { label: b }, { align })).filter(Boolean);
}

/** A centered, constrained text band (hero / intro / static). */
function renderTextBand(s: SectionSpec, ctx: RenderCtx): BlockOut {
  const out = emptyOut();
  const parts: string[] = [];
  // A dark band (e.g. a cover-with-headline that fell back here because its hero
  // photo wasn't captured, or any dark section) MUST render its copy in the
  // inverse (light) color, or the heading/body is dark-on-dark and invisible.
  // Generic: keyed off the captured background brightness, not any one site.
  const dark = isDarkSection(s);
  s.headings.forEach((h, i) =>
    parts.push(headingBlock(h, out, { level: i === 0 ? 1 : 2, center: centerOf(s), inverse: dark, sizePx: s.headingSizes?.[i], fontFamily: s.headingFamilies?.[i] || undefined, lineHeight: s.headingLineHeights?.[i] })),
  );
  (s.bodyText ?? []).forEach((b, i) => parts.push(paragraphBlock(b, out, { center: centerOf(s), inverse: dark, sizePx: s.bodyTextSizes?.[i], fontFamily: s.bodyFamilies?.[i] || undefined, lineHeight: s.bodyLineHeights?.[i] })));
  parts.push(...sectionButtons(s, out, ctx));
  // A single lead image (if present) below the copy — only a real photo, never a
  // decorative glyph (a small quote-mark/badge <img> would otherwise fill the slot).
  const lead = pickLeadImage(s.images);
  if (lead) parts.push(imageBlock(lead, out, `${s.interactionModel}#${s.sectionIndex}`, { align: centerOf(s) ? 'center' : null, rounded: true }));
  // A row of additional same-scale images (a thumbnail/sample strip the lead
  // image alone would drop) renders as a gallery below the lead. Gated to 3+
  // content-sized non-lead images so a normal text band with one stray glyph
  // never sprouts a gallery — this recovers e.g. a product page's wood-sample row.
  const extra = s.images.filter(
    (im) => im.url !== lead?.url && isWpUrl(im.url) && Math.min(im.width || 0, im.height || 0) >= 90,
  );
  if (extra.length >= 3) {
    const g = galleryBlock(extra, out);
    if (g) parts.push(g);
  } else {
    // 1–2 additional REAL-PHOTO images: render each as its own image block rather
    // than dropping it — an extractor often MERGES consecutive image rows into one
    // section, so a "2nd" image is real content (a stacked media row). Use the
    // lead-photo floor (not the gallery ≥90) so a decorative glyph/badge that
    // pickLeadImage already rejected isn't sprouted here.
    for (const im of extra.filter((im) => Math.min(im.width || 0, im.height || 0) >= MIN_LEAD_IMAGE_PX)) {
      parts.push(imageBlock(im, out, `${s.interactionModel}#${s.sectionIndex}.extra`, { align: centerOf(s) ? 'center' : null, rounded: true }));
    }
  }
  out.markup = wrapSection(parts.filter(Boolean), { constrained: '760px', center: centerOf(s), inverse: dark, raised: isTintedSection(s), bgColor: s.backgroundColor, ...sectionPad(s) });
  return out;
}

/** Full-bleed hero cover: a wp:cover with the hero photo as background and the
 *  headline / subhead / CTA overlaid in white over a dim — the faithful form for
 *  a full-width cover band (text OVER the image), vs renderTextBand stacking the
 *  photo below black copy. Falls back to a centered text band when there's no
 *  usable full-bleed photo. */
function renderCover(s: SectionSpec, ctx: RenderCtx): BlockOut {
  const lead = pickLeadImage(s.images);
  if (!lead || !isWpUrl(lead.url)) return renderTextBand(s, ctx);
  const out = emptyOut();
  out.assets.push(lead.url);
  const inner: string[] = [];
  s.headings.forEach((h, i) => inner.push(headingBlock(h, out, { level: i === 0 ? 1 : 2, center: centerOf(s), inverse: true, sizePx: s.headingSizes?.[i], fontFamily: s.headingFamilies?.[i] || undefined, lineHeight: s.headingLineHeights?.[i] })));
  (s.bodyText ?? []).forEach((b, i) => inner.push(paragraphBlock(b, out, { center: centerOf(s), inverse: true, sizePx: s.bodyTextSizes?.[i], fontFamily: s.bodyFamilies?.[i] || undefined, lineHeight: s.bodyLineHeights?.[i] })));
  inner.push(...sectionButtons(s, out, ctx));
  const innerMarkup = inner.filter(Boolean).join('\n');
  const url = escapeHtml(lead.url);
  // Reproduce the source hero's RENDERED height (a tall fixed cover, often ~full
  // viewport) instead of letting the cover shrink to its content. Clamped to a
  // sane range. A top-anchored hero cover also zeroes its own top margin so it's
  // flush with the page top (the overlay header floats above it).
  const minHpx = Math.max(480, Math.min(Math.round(s.height || 520), 1000));
  // Emit the hero height as a PROPORTIONAL vw of the 1440-px desktop capture
  // width, not a fixed desktop px — a fixed px is too tall at narrower viewports
  // (733px captured at 1440 → ~513px at 1008, which `50.9vw` reproduces, but
  // `733px` does not). vw scales the cover the way the source's proportional hero
  // does. (Capture width is the settled desktop page; see AGENTS.md.)
  const minVw = Math.round((minHpx / 1440) * 1000) / 10;
  out.markup =
    `<!-- wp:cover {"url":"${url}","dimRatio":40,"overlayColor":"surface-inverse","isUserOverlayColor":true,"minHeight":${minVw},"minHeightUnit":"vw","align":"full","style":{"spacing":{"margin":{"top":"0px"}}},"layout":{"type":"constrained"}} -->\n` +
    `<div class="wp-block-cover alignfull" style="margin-top:0px;min-height:${minVw}vw">` +
    // Canonical core/cover order: the background <img> precedes the dim <span>
    // (WP's save() validator rejects span-before-img). Keeps the pattern valid in
    // the editor, matching what the block fixer normalizes post_content to.
    `<img class="wp-block-cover__image-background" src="${url}" alt="${escapeHtml(lead.alt || '')}" data-object-fit="cover"/>` +
    `<span aria-hidden="true" class="wp-block-cover__background has-surface-inverse-background-color has-background-dim-40 has-background-dim"></span>\n` +
    `<div class="wp-block-cover__inner-container">\n${innerMarkup}\n</div>\n` +
    `</div>\n<!-- /wp:cover -->`;
  return out;
}

/** media-text: one image beside a heading + paragraph (alternating sides). */
function renderMediaText(s: SectionSpec, flip: boolean, ctx: RenderCtx): BlockOut {
  const out = emptyOut();
  const textParts: string[] = [];
  s.headings.forEach((h, i) => textParts.push(headingBlock(h, out, { level: 2, sizePx: s.headingSizes?.[i], fontFamily: s.headingFamilies?.[i] || undefined, lineHeight: s.headingLineHeights?.[i] })));
  (s.bodyText ?? []).forEach((b, i) => textParts.push(paragraphBlock(b, out, { sizePx: s.bodyTextSizes?.[i], fontFamily: s.bodyFamilies?.[i] || undefined, lineHeight: s.bodyLineHeights?.[i] })));
  textParts.push(...sectionButtons(s, out, ctx));
  // Prefer a real lead photo over a decorative glyph (a small quote-mark <img>
  // would otherwise fill the media column).
  const lead = pickLeadImage(s.images) ?? s.images[0];
  const imgMarkup = imageBlock(lead, out, `media-text#${s.sectionIndex}`, { rounded: true });
  const textCol = column(textParts.filter(Boolean), '55%');
  const imgCol = column([imgMarkup], '45%');
  const cols = flip ? [imgCol, textCol] : [textCol, imgCol];
  const blocks: string[] = [columns(cols)];
  // A row of additional same-scale images (a sample/thumbnail strip) renders as
  // a gallery below the 2-up — the single media-column image would otherwise drop
  // it. Same gate as renderTextBand (3+ content-sized non-lead images).
  const extra = s.images.filter(
    (im) => im.url !== lead?.url && isWpUrl(im.url) && Math.min(im.width || 0, im.height || 0) >= 90,
  );
  if (extra.length >= 3) {
    const g = galleryBlock(extra, out);
    if (g) blocks.push(g);
  } else {
    // 1–2 additional REAL-PHOTO images: a media-text section with a 2nd photo is
    // usually two stacked media rows the extractor merged — render each extra as
    // its own image block (centered, below the 2-up) so no captured photo drops.
    // Lead-photo floor (not the gallery ≥90) keeps a decorative glyph out.
    for (const im of extra.filter((im) => Math.min(im.width || 0, im.height || 0) >= MIN_LEAD_IMAGE_PX)) {
      blocks.push(imageBlock(im, out, `media-text#${s.sectionIndex}.extra`, { align: 'center', rounded: true }));
    }
  }
  out.markup = wrapSection(blocks, { wide: '1100px', raised: isTintedSection(s), bgColor: s.backgroundColor, ...sectionPad(s) });
  return out;
}

/** product-card-row / project-card-grid: a grid of image+title+desc(+button) cards.
 *  Replo captures duplicate desktop/mobile DOM, so headings/buttons can arrive
 *  repeated. We dedupe leading repeats and bound the card count by the number of
 *  real images so a responsive-duplicate heading run never spawns phantom
 *  placeholder cards. */
function renderCardGrid(s: SectionSpec, withButtons: boolean): BlockOut {
  const out = emptyOut();
  const headings = dedupeAdjacent(s.headings);
  const bodyText = s.bodyText ?? [];
  // Each card is anchored by an image (card grids are image-led). When there are
  // more distinct headings than images, fall back to heading-led cards.
  const cardCount =
    s.images.length > 0 ? s.images.length : Math.min(headings.length, bodyText.length || headings.length);
  const cards: string[] = [];
  for (let i = 0; i < cardCount; i++) {
    const cardParts: string[] = [];
    if (s.images.length > 0) {
      cardParts.push(imageBlock(s.images[i], out, `${s.interactionModel}#${s.sectionIndex}.card${i}`, { rounded: true }));
    }
    if (headings[i]) cardParts.push(headingBlock(headings[i], out, { level: 3, center: centerOf(s), sizePx: s.headingSizes?.[i], fontFamily: s.headingFamilies?.[i] || undefined, lineHeight: s.headingLineHeights?.[i] }));
    if (bodyText[i]) cardParts.push(paragraphBlock(bodyText[i], out, { center: centerOf(s), size: 'small', sizePx: s.bodyTextSizes?.[i], fontFamily: s.bodyFamilies?.[i] || undefined, lineHeight: s.bodyLineHeights?.[i] }));
    if (withButtons && s.buttonLabels[i]) cardParts.push(buttonBlock(s.buttonLabels[i], out, { align: buttonJustify(s) }));
    if (cardParts.filter(Boolean).length) cards.push(column(cardParts.filter(Boolean)));
  }
  // Body text not consumed per-card (a section intro) renders above the grid.
  const extra: string[] = [];
  for (let i = cardCount; i < bodyText.length; i++) extra.push(paragraphBlock(bodyText[i], out, { center: centerOf(s) }));
  out.markup = wrapSection([...extra.filter(Boolean), columns(cards)], { wide: '1100px', raised: isTintedSection(s), bgColor: s.backgroundColor, ...sectionPad(s) });
  return out;
}

/** Collapse a run of identical adjacent strings (Replo desktop/mobile DOM dupes). */
function dedupeAdjacent(arr: string[]): string[] {
  const out: string[] = [];
  for (const x of arr) {
    if (out.length === 0 || normalizeCopy(out[out.length - 1]) !== normalizeCopy(x)) out.push(x);
  }
  return out;
}

/** review-grid: verbatim source reviews (stars + quote + author). Never synthesized.
 *  On a dark source band (e.g. getsnooz's navy reviews) the band renders on the
 *  inverse surface with light text; on a light band it keeps the mint raised
 *  surface with dark text. */
function renderReviewGrid(s: SectionSpec): BlockOut {
  const out = emptyOut();
  const dark = isDarkSection(s);
  const bodyColor = dark ? 'text-inverse' : 'text-default';
  const mutedColor = dark ? 'text-inverse' : 'text-muted';
  // A centered review paragraph in the band's text color (kept as a local helper
  // so quote/author/rating all track the dark-vs-light treatment consistently).
  const reviewP = (text: string, slug: string, small = false): string =>
    `<!-- wp:paragraph {"align":"center","textColor":"${slug}"${small ? ',"fontSize":"small"' : ''}} -->\n` +
    `<p class="has-text-align-center has-${slug}-color has-text-color${small ? ' has-small-font-size' : ''}">${escapeHtml(
      text,
    )}</p>\n<!-- /wp:paragraph -->`;

  const intro: string[] = [];
  // A leading heading (e.g. "Loved by Thousands") is band copy, not a review.
  s.headings
    .map((h, origIdx) => ({ h, origIdx }))
    .filter(({ h }) => !/^\s*-/.test(h))
    .slice(0, 1)
    .forEach(({ h, origIdx }) => intro.push(headingBlock(h, out, { level: 2, center: centerOf(s), inverse: dark, sizePx: s.headingSizes?.[origIdx], fontFamily: s.headingFamilies?.[origIdx] || undefined, lineHeight: s.headingLineHeights?.[origIdx] })));

  const reviews: ExtractedReview[] = s.reviews ?? [];
  const cards: string[] = [];
  if (reviews.length === 0) {
    // The deterministic review extractor didn't structure this band into
    // reviews[], but the section's verbatim copy may still carry the review
    // prose in bodyText (rating line + quote + byline). Prefer rendering that
    // captured text verbatim over a "not captured" placeholder — the content
    // IS present, just unstructured. Only when there is NO captured body copy
    // do we emit the honest missing-content placeholder + flag.
    const captured = (s.bodyText ?? []).map((b) => normalizeCopy(b)).filter(Boolean);
    if (captured.length > 0) {
      const parts: string[] = [];
      for (const line of captured) {
        out.bodyText.push(line);
        const isRating = /\d(?:\.\d)?\s*\/\s*5|rating|\breviews?\b/i.test(line) && line.length < 60;
        parts.push(reviewP(line, isRating ? mutedColor : bodyColor, isRating));
      }
      cards.push(column(parts.filter(Boolean)));
    } else {
      out.flags.push(
        `review-grid#${s.sectionIndex}: review band detected but no verbatim reviews captured — placeholder emitted`,
      );
      cards.push(column([reviewP('[reviews not captured]', dark ? 'text-inverse' : 'text-subtle')]));
    }
  } else {
    for (const r of reviews) {
      const parts: string[] = [];
      const starCount = Math.max(0, Math.min(5, Math.round(r.stars || 0)));
      // Star glyphs are a gate-exempt decorative run (accent on either surface).
      if (starCount > 0) parts.push(reviewP('★'.repeat(starCount), 'accent-primary'));
      const quote = normalizeCopy(r.quote);
      if (quote) {
        out.bodyText.push(quote);
        parts.push(reviewP(quote, bodyColor));
      }
      if (r.author) {
        const author = normalizeCopy(r.author);
        out.bodyText.push(author);
        parts.push(reviewP(author, mutedColor, true));
      }
      cards.push(column(parts.filter(Boolean)));
    }
  }
  out.markup = wrapSection([...intro.filter(Boolean), columns(cards)], {
    wide: '1100px',
    inverse: dark,
    raised: !dark,
    bgColor: s.backgroundColor,
    ...sectionPad(s),
  });
  return out;
}

/** A responsive wp:gallery grid of WP-library images. A single flex `columns`
 *  row gives every image 1/N width (25 images → unreadable thumbnails); a gallery
 *  block wraps to a fixed column count at a sensible size. */
function galleryBlock(
  images: SectionSpecImage[],
  out: BlockOut,
  opts: { sectionHeight?: number } = {},
): string {
  const usable = images.filter((im) => isWpUrl(im.url));
  if (usable.length === 0) return '';
  const cols = Math.min(4, usable.length);
  // Fixed-height "justified row" sizing: pick ONE target row height from the
  // gallery's LANDSCAPE items (so the strip is constrained to the height of the
  // horizontal images, like the source), then size every item to that height with
  // its width following its OWN aspect — so items RETAIN their aspect ratio and
  // are never stretched. We carry width+height via core/image's `width`/`height`
  // ATTRIBUTES (which survive block-fixer canonicalization, unlike inline
  // flex/aspect-ratio on the figure). The theme's is-resized scroller rule sizes
  // each figure to its image and exempts these from the responsive height reset.
  const sized = usable.filter((im) => im.width && im.height);
  const landscape = sized.filter((im) => im.width! >= im.height!);
  const basis = (landscape.length ? landscape : sized).map((im) => im.height! * Math.min(560, im.width!) / im.width!);
  // Median target height across the basis set, clamped to a sane scroller range.
  const sortedH = basis.slice().sort((a, b) => a - b);
  const rowH = sortedH.length
    ? Math.max(140, Math.min(460, Math.round(sortedH[Math.floor(sortedH.length / 2)])))
    : 0;
  const figures = usable.map((im) => {
    out.assets.push(im.url);
    if (im.width && im.height && rowH) {
      // Uniform row height; per-item width preserves the item's own aspect.
      const w = Math.max(80, Math.min(900, Math.round((rowH * im.width) / im.height)));
      return (
        `<!-- wp:image {"width":"${w}px","height":"${rowH}px","sizeSlug":"large","linkDestination":"none"} -->\n` +
        `<figure class="wp-block-image size-large is-resized"><img src="${escapeHtml(im.url)}" alt="${escapeHtml(im.alt || '')}" style="width:${w}px;height:${rowH}px"/></figure>\n` +
        `<!-- /wp:image -->`
      );
    }
    return (
      `<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->\n` +
      `<figure class="wp-block-image size-large"><img src="${escapeHtml(im.url)}" alt="${escapeHtml(im.alt || '')}"/></figure>\n` +
      `<!-- /wp:image -->`
    );
  });
  // Strip vs wrapping grid DEFERS TO THE SOURCE: a gallery whose section is
  // tall enough for several item rows (height ≥ 2× the computed row height)
  // wraps in the source — render it as a wrapping CROPPED grid; a scroller
  // would hide everything past the right edge. A single-row gallery is the
  // page-builder carousel shape — render the scroller strip. No/zero section
  // height (supplementary strips inside mixed sections, old specs) keeps the
  // scroller (back-compat).
  const multiRow = !!(opts.sectionHeight && rowH && opts.sectionHeight >= rowH * 2);
  if (multiRow) {
    // imageCrop:true / is-cropped: in the wrapping grid, core's uniform-cell
    // crop (object-fit:cover) reproduces the source's even rows; each item
    // still carries its explicit size so the block-fixer keeps the dimensions.
    return (
      `<!-- wp:gallery {"columns":${cols},"imageCrop":true,"linkTo":"none","sizeSlug":"large"} -->\n` +
      `<figure class="wp-block-gallery has-nested-images columns-${cols} is-cropped">\n${figures.join('\n')}\n</figure>\n` +
      `<!-- /wp:gallery -->`
    );
  }
  // is-gallery-scroller turns the grid into a horizontal swipe/scroll-navigable
  // strip with snap points (theme CSS) — page builders show galleries as a
  // carousel; WP core has no native carousel block, and this needs no JS/plugin.
  // Small sets that fit just render as a row.
  //
  // imageCrop:false / NO is-cropped: core's "cropped" mode forces every item to a
  // uniform cell via object-fit:cover, which DISTORTS items away from their source
  // aspect. We instead size each item explicitly (core/image width+height, above)
  // so it RETAINS its source aspect ratio; the theme's is-resized scroller rule
  // sizes the figure to that image.
  return (
    `<!-- wp:gallery {"columns":${cols},"imageCrop":false,"linkTo":"none","sizeSlug":"large","className":"is-gallery-scroller"} -->\n` +
    `<figure class="wp-block-gallery has-nested-images columns-${cols} is-gallery-scroller">\n${figures.join('\n')}\n</figure>\n` +
    `<!-- /wp:gallery -->`
  );
}

/** color-block-grid / logo-strip / gallery: a band of images, no per-image copy.
 *  Rendered as a responsive gallery grid (not a single N-wide flex row). */
function renderImageRow(s: SectionSpec): BlockOut {
  const out = emptyOut();
  const parts: string[] = [];
  s.headings.forEach((h, i) => parts.push(headingBlock(h, out, { level: 2, center: centerOf(s), sizePx: s.headingSizes?.[i], fontFamily: s.headingFamilies?.[i] || undefined, lineHeight: s.headingLineHeights?.[i] })));
  (s.bodyText ?? []).forEach((b, i) => parts.push(paragraphBlock(b, out, { center: centerOf(s), sizePx: s.bodyTextSizes?.[i], fontFamily: s.bodyFamilies?.[i] || undefined, lineHeight: s.bodyLineHeights?.[i] })));
  const gallery = galleryBlock(s.images, out, { sectionHeight: s.height });
  if (gallery) parts.push(gallery);
  out.markup = wrapSection(parts.filter(Boolean), { wide: '1100px', raised: isTintedSection(s), bgColor: s.backgroundColor, ...sectionPad(s) });
  return out;
}

/** FAQ accordion: verbatim Q/A pairs as wp:details. Never synthesizes answers. */
function renderFaq(s: SectionSpecWithFaqs): BlockOut {
  const out = emptyOut();
  const parts: string[] = [];
  // A leading "Frequently Asked Questions" heading is band copy.
  s.headings.slice(0, 1).forEach((h, i) => parts.push(headingBlock(h, out, { level: 2, center: centerOf(s), sizePx: s.headingSizes?.[i], fontFamily: s.headingFamilies?.[i] || undefined, lineHeight: s.headingLineHeights?.[i] })));
  const faqs = s.faqs ?? [];
  for (const f of faqs) {
    const q = normalizeCopy(f.question);
    if (!q) continue;
    out.expectedText.push(q);
    const a = normalizeCopy(f.answer);
    let answerBlock: string;
    if (a) {
      out.bodyText.push(a);
      answerBlock =
        `<!-- wp:paragraph {"textColor":"text-muted"} -->\n` +
        `<p class="has-text-muted-color has-text-color">${escapeHtml(a)}</p>\n<!-- /wp:paragraph -->`;
    } else {
      out.flags.push(`faq#${s.sectionIndex}: answer for "${q}" not captured — placeholder emitted`);
      answerBlock =
        `<!-- wp:paragraph {"textColor":"text-subtle"} -->\n` +
        `<p class="has-text-subtle-color has-text-color">[answer not captured]</p>\n<!-- /wp:paragraph -->`;
    }
    parts.push(
      `<!-- wp:details -->\n<details class="wp-block-details"><summary>${escapeHtml(q)}</summary>\n` +
        `${answerBlock}\n</details>\n<!-- /wp:details -->`,
    );
  }
  out.markup = wrapSection(parts.filter(Boolean), { constrained: '760px', raised: isTintedSection(s), bgColor: s.backgroundColor, ...sectionPad(s) });
  return out;
}

// --- structural helpers ----------------------------------------------------

function column(parts: string[], width?: string): string {
  const widthAttr = width ? `{"width":"${width}"}` : '';
  const widthStyle = width ? ` style="flex-basis:${width}"` : '';
  return (
    `<!-- wp:column ${widthAttr} -->\n` +
    `<div class="wp-block-column"${widthStyle}>\n${parts.join('\n')}\n</div>\n` +
    `<!-- /wp:column -->`
  );
}

function columns(cols: string[], opts: { fullBleed?: boolean } = {}): string {
  if (cols.length === 0) return '';
  // Full-bleed: the source's card row spans the viewport edge-to-edge with the
  // cards flush (no gap). align:full + blockGap:0 reproduce that; otherwise the
  // columns stay constrained with the default inter-card gap.
  const attr = opts.fullBleed
    ? `"verticalAlignment":"center","align":"full","style":{"spacing":{"blockGap":"0"}}`
    : `"verticalAlignment":"center"`;
  const cls = opts.fullBleed
    ? 'wp-block-columns alignfull are-vertically-aligned-center'
    : 'wp-block-columns are-vertically-aligned-center';
  return (
    `<!-- wp:columns {${attr}} -->\n` +
    `<div class="${cls}">\n${cols.join('\n')}\n</div>\n` +
    `<!-- /wp:columns -->`
  );
}

function wrapSection(
  parts: string[],
  opts: {
    constrained?: string;
    wide?: string;
    center?: boolean;
    raised?: boolean;
    inverse?: boolean;
    /** Exact captured section background (hex/rgb) — painted edge-to-edge when
     *  the band is neither the raised nor inverse token. Lets a pale-tint band
     *  (e.g. the source's pale-blue newsletter strip) render its real color. */
    bgColor?: string;
    padTopPx?: number;
    padBottomPx?: number;
    /** The source band spans the viewport edge-to-edge (captured containerWidth ≈
     *  viewport). Drop the width constraint AND the horizontal padding so the
     *  content (e.g. a card row) is flush to the edges like the source. */
    fullBleed?: boolean;
  },
): string {
  const body = parts.filter(Boolean).join('\n');
  if (!body) return '';
  const layout = opts.fullBleed
    ? `"layout":{"type":"default"}`
    : opts.constrained
      ? `"layout":{"type":"constrained","contentSize":"${opts.constrained}"}`
      : opts.wide
        ? `"layout":{"type":"constrained","wideSize":"${opts.wide}"}`
        : `"layout":{"type":"constrained"}`;
  const hpadJson = opts.fullBleed ? `"left":"0","right":"0"` : `"left":"var:preset|spacing|40","right":"var:preset|spacing|40"`;
  const hpadL = opts.fullBleed ? '0px' : 'var(--wp--preset--spacing--40)';
  const hpadR = hpadL;
  // Background precedence: inverse (dark band, needs light text) > an EXACT
  // captured tint > raised token (approximation fallback). Painting the exact
  // captured OPAQUE tint beats the generic surface-raised so the source's real
  // pale-blue/pale-pink band renders its true color instead of a grey
  // approximation. Skipped when: near-white (page surface shows through) or the
  // capture carries a low alpha (a faint translucent tint would over-saturate
  // if stamped solid — fall back to the raised token in that case).
  const customBg = !opts.inverse ? opaqueTintHex(opts.bgColor) : null;
  const colorAttr = opts.inverse
    ? '"backgroundColor":"surface-inverse","textColor":"text-inverse",'
    : customBg
      ? ''
      : opts.raised
        ? '"backgroundColor":"surface-raised",'
        : '';
  const styleColor = !opts.inverse && customBg ? `"color":{"background":"${customBg}"},` : '';
  const bgClass = opts.inverse
    ? ' has-surface-inverse-background-color has-text-inverse-color has-text-color has-background'
    : customBg
      ? ' has-background'
      : opts.raised
        ? ' has-surface-raised-background-color has-background'
        : '';
  const bgInlineStyle = !opts.inverse && customBg ? `background-color:${customBg};` : '';
  // Vertical padding: trust the geometrically-measured value when section-extract
  // captured it (faithful whitespace — page-builder `padding` reads 0); otherwise
  // fall back to the theme spacing preset. Horizontal padding stays preset.
  const topVal = typeof opts.padTopPx === 'number' ? responsiveSpace(opts.padTopPx) : 'var:preset|spacing|60';
  const botVal =
    typeof opts.padBottomPx === 'number' ? responsiveSpace(opts.padBottomPx) : 'var:preset|spacing|60';
  const cssLen = (v: string): string =>
    v.startsWith('var:preset|spacing|') ? `var(--wp--preset--spacing--${v.split('|').pop()})` : v;
  // Zero inter-section margin: sections butt directly so there are NO white gaps
  // between them (WP's default top-level block-gap would otherwise insert a
  // margin above each section — the source stacks its bands edge-to-edge). All
  // vertical rhythm comes from each section's own captured padding.
  return (
    `<!-- wp:group {"tagName":"section","align":"full",${colorAttr}"style":{${styleColor}"spacing":{"margin":{"top":"0","bottom":"0"},"padding":{"top":"${topVal}","bottom":"${botVal}",${hpadJson}},"blockGap":"var:preset|spacing|40"}},${layout}} -->\n` +
    `<section class="wp-block-group alignfull${bgClass}" style="margin-top:0;margin-bottom:0;${bgInlineStyle}padding-top:${cssLen(topVal)};padding-right:${hpadR};padding-bottom:${cssLen(botVal)};padding-left:${hpadL}">\n` +
    `${body}\n` +
    `</section>\n<!-- /wp:group -->`
  );
}

/**
 * Return a `#rrggbb` hex for a captured section background ONLY when it is a
 * meaningful, effectively-opaque tint worth painting edge-to-edge. Returns null
 * for: missing color, near-white (let the page surface show), or a low-alpha
 * translucent tint (alpha < 0.6 — painting it solid would over-saturate vs. the
 * source's faint wash, so the caller falls back to the raised token).
 */
function opaqueTintHex(color: string | null | undefined): string | null {
  if (!color) return null;
  const s = color.trim();
  const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(s);
  let r: number, g: number, b: number;
  if (rgba) {
    const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    if (alpha < 0.6) return null; // faint translucent tint → use raised token instead
    [r, g, b] = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  } else {
    const hex = /^#?([0-9a-f]{6})$/i.exec(s);
    if (!hex) return null; // unknown keyword/format — don't risk it
    r = parseInt(hex[1].slice(0, 2), 16);
    g = parseInt(hex[1].slice(2, 4), 16);
    b = parseInt(hex[1].slice(4, 6), 16);
  }
  const bright = (r + g + b) / 3;
  if (bright >= 248) return null; // near-white → page surface shows through
  // A near-neutral light grey (tiny channel spread) is not a design tint — the
  // raised token / page surface covers it. Only paint genuinely COLORED tints
  // (e.g. pale blue rgb(232,239,241) spread 9, pale pink) edge-to-edge.
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread <= 6 && bright >= 230) return null;
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** A section whose captured background is dark (needs inverse/light text). */
function isDarkSection(s: SectionSpec): boolean {
  return s.backgroundBrightness < 100;
}

/**
 * Uniform multi-cell content grid — an icon-feature row ("Built-In Sounds /
 * Bluetooth Speaker / Night Light"), sound-library columns (Classic / Nature /
 * Ambient), or a comparison's column triplet (labels / Go 2 / Go v1). Each
 * captured cell becomes one column with its title, body lines, optional lead
 * image, and button. Band-level headings (a heading that is NOT a cell title —
 * e.g. "Three bedtime essentials.") render above the grid. This is what keeps a
 * grid section from collapsing into one stacked text band that also drops the
 * mid-size cell labels the flat-array capture missed.
 */
function renderCellGrid(s: SectionSpec, ctx: RenderCtx): BlockOut {
  const out = emptyOut();
  const cells = s.cells ?? [];
  const cellHeadSet = new Set(cells.map((c) => normalizeCopy(c.heading ?? '')).filter(Boolean));
  const intro: string[] = [];
  s.headings.forEach((h, i) => {
    if (cellHeadSet.has(normalizeCopy(h))) return; // a cell title — rendered in its column
    intro.push(headingBlock(h, out, { level: i === 0 ? 2 : 3, center: centerOf(s), sizePx: s.headingSizes?.[i], fontFamily: s.headingFamilies?.[i] || undefined, lineHeight: s.headingLineHeights?.[i] }));
  });
  const cols: string[] = [];
  for (const c of cells) {
    // A styled card: the captured cell container background mapped to the nearest
    // theme token (dark card → light text + rounded surface), so feature cards
    // render DISTINCTLY instead of flattening into one band.
    const cardToken = c.background ? nearestToken(c.background, ctx.paletteTokens) : null;
    const cardDark = c.background ? brightness(c.background) < 140 : false;
    // The card's own captured alignment (left/center) drives its text and icon —
    // not the section's — so a left-aligned card with a centered icon never
    // happens unless the source did it. Falls back to the section alignment when
    // a cell carries no captured alignment (older specs / hand-built fixtures).
    const cellCenter = c.align ? c.align === 'center' : centerOf(s);
    const iconAlign = c.iconAlign ?? (cellCenter ? 'center' : 'left');
    const parts: string[] = [];
    // A small inline icon (speaker / bluetooth / sun glyph, comparison check/X)
    // tops the cell — shipped as a theme SVG asset, referenced via core/image.
    // On a dark card the glyph is recolored white (else it renders default black).
    if (c.icon) parts.push(iconImageBlock(c.icon, out, ctx, { align: iconAlign, ...(cardDark ? { fill: '#ffffff' } : {}) }));
    if (c.image && isWpUrl(c.image.url) && Math.min(c.image.width || 0, c.image.height || 0) >= MIN_CELL_IMAGE_PX) {
      parts.push(imageBlock(c.image, out, `cell#${s.sectionIndex}`, { rounded: true }));
    }
    // Per-cell family (a sans card title over a serif body) mapped to a token.
    const cellHeadFamily = nearestFamily(c.headingFamily, ctx.fontFamilies) || undefined;
    const cellBodyFamily = nearestFamily(c.bodyFamily, ctx.fontFamilies) || undefined;
    if (c.heading)
      parts.push(
        headingBlock(c.heading, out, {
          level: 3,
          center: cellCenter,
          inverse: cardDark,
          sizePx: c.headingSize,
          fontFamily: cellHeadFamily,
          lineHeight: c.headingLineHeight,
        }),
      );
    for (const b of c.body)
      parts.push(
        paragraphBlock(b, out, {
          center: cellCenter,
          size: 'small',
          inverse: cardDark,
          fontFamily: cellBodyFamily,
          lineHeight: c.bodyLineHeight,
        }),
      );
    if (c.button) parts.push(buttonBlock(c.button, out, { align: cellCenter ? 'center' : 'left' }));
    const kept = parts.filter(Boolean);
    if (!kept.length) continue;
    cols.push(column(cardToken ? [cardGroup(kept, cardToken, cardDark, c.radius ?? 0, c.padding ?? null)] : kept));
  }
  // Section-level images no cell claimed: a page-builder photo|card column-strip
  // captures its photo COLUMN as a section-level (often background-kind) image,
  // not as any cell's image — the grid would silently drop it and the coverage
  // gate would then demote the whole section to an island. Render each as its
  // own image column so the photo stays a real grid column.
  const claimedImageUrls = new Set(cells.map((c) => c.image?.url).filter(Boolean));
  for (const im of s.images ?? []) {
    if (claimedImageUrls.has(im.url)) continue;
    if (!isWpUrl(im.url) || Math.min(im.width || 0, im.height || 0) < MIN_CELL_IMAGE_PX) continue;
    cols.push(column([imageBlock(im, out, `cell-media#${s.sectionIndex}`, { rounded: true })]));
  }
  // A source band whose captured container spans ~the full viewport is a
  // full-bleed card row (the cards touch the edges, flush) — reproduce that
  // instead of a constrained 1100px box with side margins + inter-card gaps.
  const fullBleed = (s.layout?.containerWidth ?? 0) >= 1380;
  out.markup = wrapSection([...intro.filter(Boolean), columns(cols, { fullBleed })], {
    ...(fullBleed ? { fullBleed: true } : { wide: '1100px' }),
    raised: isTintedSection(s),
    bgColor: s.backgroundColor,
    ...sectionPad(s),
  });
  return out;
}

/** Wrap a cell's content in a styled card group: token background, light text on a
 *  dark card, rounded corners, and padding. Radius is capped to a sane range.
 *  When the source card's geometric inner padding was captured it's reproduced
 *  (responsive, so it scales down on mobile); otherwise the theme preset is used. */
function cardGroup(
  parts: string[],
  bgToken: string,
  dark: boolean,
  radius: number,
  padding: { top: number; right: number; bottom: number; left: number } | null,
): string {
  const textToken = dark ? 'text-inverse' : 'text-default';
  // Default to FLAT corners (0) when the source card has no captured radius — page
  // builders (Wix/Squarespace) are overwhelmingly square; a phantom 12px radius is
  // a visible mismatch the source never has. A genuinely-rounded source card carries
  // a captured radius > 0 and is reproduced (capped to a sane range).
  const r = radius > 0 ? Math.min(radius, 32) : 0;
  const cssLen = (v: string): string =>
    v.startsWith('var:preset|spacing|') ? `var(--wp--preset--spacing--${v.split('|').pop()})` : v;
  // Captured px → responsive clamp; clamp the raw value to a sane card range so a
  // mismeasured outlier can't produce an absurd inset. No capture → preset.
  const side = (px: number | undefined): string =>
    typeof px === 'number' ? responsiveSpace(Math.max(8, Math.min(96, px))) : 'var:preset|spacing|40';
  const pt = side(padding?.top);
  const pr = side(padding?.right);
  const pb = side(padding?.bottom);
  const pl = side(padding?.left);
  // is-replica-card lets theme CSS stretch sibling cards to equal height (the
  // source renders a uniform card grid equal-height; a WP group is otherwise
  // content-height, leaving ragged card bottoms).
  return (
    `<!-- wp:group {"className":"is-replica-card","style":{"spacing":{"padding":{"top":"${pt}","bottom":"${pb}","left":"${pl}","right":"${pr}"}},"border":{"radius":"${r}px"}},"backgroundColor":"${bgToken}","textColor":"${textToken}","layout":{"type":"constrained"}} -->\n` +
    `<div class="wp-block-group is-replica-card has-${textToken}-color has-${bgToken}-background-color has-text-color has-background" style="border-radius:${r}px;padding-top:${cssLen(pt)};padding-right:${cssLen(pr)};padding-bottom:${cssLen(pb)};padding-left:${cssLen(pl)}">\n${parts.join('\n')}\n</div>\n` +
    `<!-- /wp:group -->`
  );
}

/** Models with their own specialized renderers — never overridden by the cell grid. */
const NON_CELL_GRID_MODELS = new Set([
  'product-card-row',
  'project-card-grid',
  'blog-card-grid',
  'review-grid',
  'testimonial',
]);

/** Models that otherwise fall through `renderSection`'s switch to `renderTextBand`
 *  (a single centered column). These are the ONLY models eligible for the relaxed
 *  column-count un-flatten below — so a hero/cover/media-text band is never swept into a
 *  card grid by column count alone (the cell check runs before the media-text check). */
const FLATTEN_PRONE_MODELS = new Set([
  'static',
  'cta',
  'price-list',
  'app-download',
  'horizontal-showcase',
]);

/** Models whose multi-image layouts own their rendering — a captured 2-up
 *  `mediaLayout` must not re-route them to media-text (a gallery/card/review band
 *  is not a single image beside text even if one image happens to sit beside a label). */
const MEDIA_LAYOUT_DENY = new Set([
  'gallery',
  'logo-strip',
  'color-block-grid',
  'marquee-strip',
  'product-card-row',
  'project-card-grid',
  'blog-card-grid',
  'review-grid',
  'testimonial',
]);

// ---------------------------------------------------------------------------
// Section dispatch
// ---------------------------------------------------------------------------

function renderSection(s: SectionSpecWithFaqs, ctx: RenderCtx): BlockOut {
  // A section carrying re-captured FAQ pairs renders as an accordion regardless
  // of its geometric interaction model.
  if (s.faqs && s.faqs.length) return renderFaq(s);
  // A uniform multi-cell content grid: >=2 cells each carrying BOTH a title and
  // body (a genuine feature/column grid, not a hero's text|image split or a
  // single CTA). Card grids / reviews keep their specialized paths.
  // A uniform multi-cell content grid. The base trigger needs cells carrying BOTH a
  // heading and body (an unambiguous feature grid). RELAXED un-flatten: when the source
  // reported >=2 columns AND the model would otherwise flatten to a centered text band,
  // >=2 cells carrying ANY content (heading/body/image/icon/button) is enough — so a
  // numbered-card band whose cells are heading-only stops collapsing into one column. The
  // relaxed path is gated to FLATTEN_PRONE_MODELS so heroes/covers/media-text (which run
  // their own checks after this) are never swept into a card grid by column count alone.
  const cellHasHeadingAndBody = (c: SectionSpecCell) => !!(c.heading && c.body.length > 0);
  const cellHasAnyContent = (c: SectionSpecCell) =>
    !!(c.heading || c.body.length > 0 || c.image || c.icon || c.button);
  if (
    s.cells &&
    !NON_CELL_GRID_MODELS.has(s.interactionModel) &&
    (s.cells.filter(cellHasHeadingAndBody).length >= 2 ||
      (FLATTEN_PRONE_MODELS.has(s.interactionModel) &&
        s.layout.columnCount >= 2 &&
        s.cells.filter(cellHasAnyContent).length >= 2))
  ) {
    return renderCellGrid(s, ctx);
  }
  // The source places a large image BESIDE the text (a 2-up media row) — render
  // media-text with the captured side, regardless of the geometric model, so the
  // arrangement isn't stacked. Skipped for gallery/card/review models (their
  // multi-image layouts own their rendering) and when there's no lead image or
  // text to pair. This is what makes a flat-Wix content tile (e.g. a product
  // page's photo|description row) reproduce its real two-column layout.
  if (
    s.mediaLayout &&
    !MEDIA_LAYOUT_DENY.has(s.interactionModel) &&
    pickLeadImage(s.images) &&
    (s.headings.length > 0 || (s.bodyText ?? []).length > 0)
  ) {
    ctx.mediaTextIndex++;
    return renderMediaText(s, s.mediaLayout === 'image-left', ctx);
  }
  switch (s.interactionModel) {
    case 'media-text': {
      const flip = ctx.mediaTextIndex % 2 === 1;
      ctx.mediaTextIndex++;
      return renderMediaText(s, flip, ctx);
    }
    case 'product-card-row':
      return renderCardGrid(s, /* withButtons */ true);
    case 'project-card-grid':
    case 'blog-card-grid':
      return renderCardGrid(s, /* withButtons */ false);
    case 'review-grid':
    case 'testimonial':
      return renderReviewGrid(s);
    case 'color-block-grid':
    case 'logo-strip':
    case 'gallery':
    case 'marquee-strip':
      return renderImageRow(s);
    case 'columns':
      // A two-up columns band: if it has both copy and one image, treat as media-text;
      // otherwise a centered text band.
      if (s.images.length === 1 && (s.headings.length || (s.bodyText ?? []).length)) {
        return renderMediaText(s, false, ctx);
      }
      return renderTextBand(s, ctx);
    case 'cover-with-headline': {
      const coverLead = pickLeadImage(s.images);
      // A FULL-BLEED hero with a wide background photo (≥1000px) is a
      // text-OVER-photo cover (the title sits on the image) — render it as a
      // wp:cover, not a side-by-side. Routing it to media-text produced the
      // common failure where the hero became a flat dark band with a dark
      // (often invisible) heading beside a shrunken photo. Mirrors the
      // animated-cover branch. Generic: keyed on the captured fullBleed flag +
      // image width, not any one site.
      if (coverLead && isWpUrl(coverLead.url) && s.fullBleed && (coverLead.width || 0) >= 1000) {
        return renderCover(s, ctx);
      }
      // A non-full-bleed hero with a REAL lead photo renders as a 2-column
      // media-text (text | image). Without a photo it's a centered band.
      if (coverLead && (s.headings.length || (s.bodyText ?? []).length)) {
        const flip = ctx.mediaTextIndex % 2 === 1;
        ctx.mediaTextIndex++;
        return renderMediaText(s, flip, ctx);
      }
      return renderTextBand(s, ctx);
    }
    case 'animated-cover': {
      // A full-bleed hero cover needs a WIDE background photo (≥1000px). A
      // smaller content image is a media band (a mid-page story section), not a
      // cover — render it as media-text so it isn't turned into a full-bleed
      // text-over-photo band.
      const coverLead = pickLeadImage(s.images);
      if (coverLead && isWpUrl(coverLead.url) && (coverLead.width || 0) >= 1000) {
        return renderCover(s, ctx);
      }
      if (coverLead && (s.headings.length || (s.bodyText ?? []).length)) {
        const flip = ctx.mediaTextIndex % 2 === 1;
        ctx.mediaTextIndex++;
        return renderMediaText(s, flip, ctx);
      }
      return renderTextBand(s, ctx);
    }
    case 'static':
    case 'cta':
    case 'price-list':
    case 'app-download':
    case 'horizontal-showcase':
    default:
      return renderTextBand(s, ctx);
  }
}

/**
 * Render a section's captured forms (F2) as jetpack/contact-form markup,
 * register the EMITTED fields' labels/options + the submit label with the
 * provenance corpus, and flag skipped fields (file/hidden — they emit no text,
 * so there is nothing for the gate to trace; the flag records the gap).
 *
 * Corpus note: the DOM walk's bodyText captures only visible <p>/<li> text, so
 * form <label> text is NOT already in the captured corpus — it must be
 * registered here. (The page gate compares emitted visible text against THIS
 * result's expectedText∪bodyText; the labels also render front-side via
 * Jetpack's server render, so verification can find them on the page.)
 */
function renderSectionForms(s: SectionSpec, expectedText: string[], flags: string[]): string {
  if (!s.forms || s.forms.length === 0) return '';
  const parts: string[] = [];
  for (const form of s.forms) {
    const fb = formToBlocks(form);
    parts.push(fb.markup);
    for (const f of form.fields) {
      if (SKIPPED_FIELD_KINDS.has(f.kind)) continue;
      expectedText.push(f.label, ...(f.options ?? []));
    }
    expectedText.push(form.submitLabel);
    for (const sk of fb.skipped) {
      flags.push(
        'form-field-skipped#' + s.sectionIndex + ': ' + sk.kind + ' field "' + sk.label + '" has no Jetpack form equivalent',
      );
    }
  }
  return parts.join('\n');
}

/**
 * Reconstruct a full page pattern from its captured section specs.
 * Chrome (header/footer/nav) is stripped; only page-body sections are rendered.
 */
export function reconstructPagePattern(
  sections: SectionSpec[],
  opts: ReconstructOptions,
): ReconstructResult {
  // Drop body entries that merely repeat a heading. Page-builders often mark a
  // headline as a styled <p> (≥28px → captured as a heading) that is ALSO a
  // <p> (captured as body), so without this the renderer emits the line twice.
  // Resolve each section's captured per-element font-families (computed names) to
  // registered theme fontFamily token slugs once, here — the renderers then read
  // headingFamilies/bodyFamilies as slugs. '' means "no token match → use the
  // block default family". Then drop body entries that merely repeat a heading
  // (page-builders mark a headline as a styled <p> captured as both heading AND
  // body), keeping the parallel typography arrays index-aligned.
  const famTokens = opts.fontFamilies ?? [];
  const resolveFamilies = (names?: string[]): string[] | undefined =>
    names ? names.map((n) => nearestFamily(n, famTokens) ?? '') : undefined;
  // Resolve captured font-family names to theme tokens. A bodyText paragraph
  // matching a heading is usually genuine (heading tags and <p>/<li> are
  // disjoint selectors, e.g. a 34px subheading AND an 18px paragraph of the
  // same copy) — EXCEPT when the heading was PROMOTED from a styled <p>
  // (page-builders mark headlines as ≥28px paragraphs): then heading and body
  // captured the SAME element and the replica would show the line twice. The
  // two cases are distinguishable from the section's source HTML: the text
  // appearing ONCE means promoted-echo (drop the body copy), twice means
  // genuine duplicate (keep — never-lose-source-content). No sectionHtml →
  // can't verify → keep (back-compat, never guess toward dropping).
  const body = stripChrome(sections).map((s) => {
    const headFamSlugs = resolveFamilies(s.headingFamilies);
    const bodyFamSlugs = resolveFamilies(s.bodyFamilies);
    let out = s;
    if (headFamSlugs || bodyFamSlugs) {
      out = {
        ...out,
        ...(headFamSlugs ? { headingFamilies: headFamSlugs } : {}),
        ...(bodyFamSlugs ? { bodyFamilies: bodyFamSlugs } : {}),
      };
    }
    const srcHtml = s.sectionHtml ?? s.styledHtml;
    if (srcHtml && (out.bodyText ?? []).length && out.headings.length) {
      // Compare against the DECODED source text (cheerio) with the same glyph
      // folding as the coverage gates: headings/bodyText are decoded DOM
      // captures ("Food & Drink") while raw sectionHtml carries entities
      // ("Food &amp; Drink") — a raw-substring count reads every such text as
      // absent (count 0) and would drop a genuine duplicate. Same bug class
      // the coverage gate fixed in 0d35541.
      const srcText = foldText(cheerio.load(srcHtml, null, false).root().text());
      const headingSet = new Set(out.headings.map((h) => foldText(h)));
      const countOccurrences = (needle: string): number => {
        if (!needle) return 0;
        let count = 0;
        for (let i = srcText.indexOf(needle); i !== -1; i = srcText.indexOf(needle, i + needle.length)) count++;
        return count;
      };
      const keep = (out.bodyText ?? []).map((b) => {
        const n = foldText(b);
        // Drop ONLY the verified promoted-echo case: the text matches a heading
        // AND appears exactly once in the source. Count 0 means the comparison
        // failed to find it at all — can't verify → keep (never guess toward
        // dropping).
        return !(headingSet.has(n) && countOccurrences(n) === 1);
      });
      if (keep.includes(false)) {
        const filterAligned = <T>(arr: T[]): T[] => arr.filter((_, i) => keep[i] !== false);
        out = {
          ...out,
          bodyText: (out.bodyText ?? []).filter((_, i) => keep[i]),
          ...(out.bodyTextSizes ? { bodyTextSizes: filterAligned(out.bodyTextSizes) } : {}),
          ...(out.bodyFamilies ? { bodyFamilies: filterAligned(out.bodyFamilies) } : {}),
          ...(out.bodyLineHeights ? { bodyLineHeights: filterAligned(out.bodyLineHeights) } : {}),
        };
      }
    }
    return out;
  });
  const expectedText: string[] = [];
  const bodyText: string[] = [];
  const assets: string[] = [];
  const provenanceFlags: string[] = [];
  const fallbackDiagnostics: FallbackDiagnostic[] = [];
  const sectionMarkup: string[] = [];
  const iconAssets: Array<{ path: string; svg: string }> = [];
  const ctx: RenderCtx = {
    mediaTextIndex: 0,
    iconCounter: 0,
    paletteTokens: opts.paletteTokens ?? [],
    fontFamilies: opts.fontFamilies ?? [],
  };

  for (const s of body) {
    // First-choice GENERAL HTML→blocks: if the async handler pre-converted this
    // (semantic) section via rawHandler and the result is clean — zero wp:html AND
    // the coverage gate passes — emit the native blocks and skip the structured
    // render + island entirely. rawHandler is a deterministic structural transform
    // (re-delimits captured HTML, never paraphrases), so the blocks are source-
    // verbatim; like core/html islands their text traces by construction.
    const conv = opts.convertedSections?.get(s.sectionIndex);
    if (conv && conv.markup && conv.wpHtmlResidue === 0) {
      let markup = conv.markup;
      if (opts.mediaUrlMap && opts.mediaUrlMap.size > 0) markup = rewriteMediaUrls(markup, opts.mediaUrlMap);
      // rawHandler preserves the source <img src>; if a non-downloaded asset's
      // remote URL survived the media rewrite, the drift gate would fail the whole
      // page (the structured render placeholders non-WP images, so it never does).
      // Coverage can't catch this — the CDN URL is present in BOTH the markup and
      // captured.imageUrls, so it reads as "covered". Fall through to the structured
      // render instead.
      // Acceptance must imply the page gate (validateArtifacts) will PASS this
      // section — that gate is all-or-nothing, so an accepted-but-poison section
      // drops the WHOLE page. Beyond residue/coverage/provenance, mirror the gate's
      // remote-asset, unresolved-placeholder ({{…}}), and injection checks here; a
      // section that would trip them falls through to the structured render (which
      // drops such content, so the page still passes — today's behavior).
      const gateSafe =
        !hasUnmigratedRemoteAsset(markup) &&
        !/\{\{[\w -]+\}\}/.test(markup) &&
        scanForInjection(markup).length === 0;
      if (gateSafe) {
        const captured = {
          texts: [...s.headings, ...(s.bodyText ?? []), ...(s.buttonLabels ?? [])],
          imageUrls: (s.images ?? []).map((im) => im.url).filter(Boolean),
        };
        const cov = measureConvertedCoverage(captured, markup);
        if (!cov.lost) {
          sectionMarkup.push(markup);
          // Register the converted section's OWN <h>/<p> visible text into the gate
          // corpus: rawHandler faithfully emits sub-headings the extraction didn't
          // capture as headings, and the page provenance gate only knows the
          // structured corpus. Corpus-expansion is link-rewrite-safe (unlike span-
          // stripping). Content LOSS is guarded independently by the coverage check.
          for (const m of markup.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)) expectedText.push(visibleText(m[1]));
          for (const m of markup.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) bodyText.push(visibleText(m[1]));
          assets.push(...captured.imageUrls);
          provenanceFlags.push(
            `html-to-blocks#${s.sectionIndex}: converted native blocks ` +
              `(0 wp:html, text ${Math.round(cov.textCoverage * 100)}%)`,
          );
          // Captured forms still emit on the converted path: rawHandler turns the
          // source <form> into inert paragraphs (or drops the inputs), so the
          // LIVE jetpack/contact-form is appended after the converted blocks.
          const convFormBlock = renderSectionForms(s, expectedText, provenanceFlags);
          if (convFormBlock) sectionMarkup.push(convFormBlock);
          continue;
        }
      }
    }

    // Captured forms (F2): placement decision (v1) — each form renders AFTER the
    // section's text content, INSIDE the section group (faithful to the dominant
    // contact-section shape: copy above, form below; no geometric interleaving).
    // The walk's button capture re-captures the form's own <button type=submit>
    // as a section CTA, so rendering buttonLabels verbatim would put a dead
    // core/button twin next to the live form submit — for form sections only,
    // suppress ONE CTA occurrence per form submit label (count-based: each form
    // contributes exactly one submit, so a SECOND identically-labeled source
    // button is legitimate content and survives). Coverage still sees the label:
    // it lives in the submit button's saved inner HTML, which the raw-markup
    // haystack includes.
    let renderSpec = s;
    if (s.forms && s.forms.length > 0) {
      // One suppression budget per array: buttonLabels, buttons, AND cells[]
      // all capture the SAME source buttons (a form section that routes to the
      // cell grid carries its submit as a cell.button too), so each array gets
      // its own count of the submits.
      const submitBudget = (): Map<string, number> => {
        const m = new Map<string, number>();
        for (const f of s.forms ?? []) {
          const k = normalizeCopy(f.submitLabel).toLowerCase();
          m.set(k, (m.get(k) ?? 0) + 1);
        }
        return m;
      };
      const dropOncePerSubmit = (m: Map<string, number>) => (label: string) => {
        const k = normalizeCopy(label).toLowerCase();
        const left = m.get(k) ?? 0;
        if (left > 0) {
          m.set(k, left - 1);
          return false; // the form's own submit, re-captured as a CTA — suppress
        }
        return true;
      };
      const keepLabel = dropOncePerSubmit(submitBudget());
      const keepButton = dropOncePerSubmit(submitBudget());
      const keepCellButton = dropOncePerSubmit(submitBudget());
      // Field-label echo cells: the walk also re-captures the form's own FIELD
      // labels as content cells (heading = the label, body = the required-"*"
      // marker). Left in, ≥2 such cells route the section to the CELL GRID,
      // which ignores s.images — the dropped photo then trips the coverage
      // island and the live jetpack form is discarded with the structured
      // render. A cell is the field's echo ONLY when it carries nothing real
      // beyond the label (no image/icon/button, body all marker noise); a
      // genuine content cell sharing a field's label survives. Budgeted per
      // field occurrence, same rationale as the submit suppression.
      const fieldBudget = new Map<string, number>();
      for (const f of s.forms ?? []) {
        for (const fld of f.fields) {
          const k = normalizeCopy(fld.label).toLowerCase();
          fieldBudget.set(k, (fieldBudget.get(k) ?? 0) + 1);
        }
      }
      const cellIsFieldEcho = (c: NonNullable<SectionSpec['cells']>[number]): boolean => {
        if (!c.heading || c.image || c.icon || c.button) return false;
        if ((c.body ?? []).some((b) => /[a-z0-9]/i.test(normalizeCopy(b)))) return false;
        const k = normalizeCopy(c.heading).toLowerCase();
        const left = fieldBudget.get(k) ?? 0;
        if (left <= 0) return false;
        fieldBudget.set(k, left - 1);
        return true;
      };
      const cellsSansFieldEchoes = s.cells?.filter((c) => !cellIsFieldEcho(c));
      renderSpec = {
        ...s,
        buttonLabels: (s.buttonLabels ?? []).filter(keepLabel),
        ...(s.buttons ? { buttons: s.buttons.filter((b) => keepButton(b.label)) } : {}),
        // Cells path: the cell grid renders cell.button directly, escaping the
        // array filters above — null out ONE cell.button per submit label so the
        // homepage form band doesn't render a dead CTA twin above the live form.
        ...(cellsSansFieldEchoes
          ? {
              cells: cellsSansFieldEchoes.map((c) => {
                if (!(c.button && !keepCellButton(c.button))) return c;
                // This cell IS the form's submit, re-captured by the walk. Drop
                // the dead button — and when the walk ALSO echoed the button's
                // text as the cell's heading (the largest-font text node of a
                // submit-widget cell is the button itself), drop that too: the
                // source shows the label once, so the replica must not render
                // an h3 twin above the live form. Tightly scoped to the
                // suppressed cell + identical text — a genuine same-label
                // heading elsewhere in the grid is untouched.
                const headingEchoesButton =
                  c.heading != null && normalizeCopy(c.heading).toLowerCase() === normalizeCopy(c.button).toLowerCase();
                return { ...c, button: null, ...(headingEchoesButton ? { heading: null } : {}) };
              }),
            }
          : {}),
      };
    }
    const out = renderSection(renderSpec, ctx);
    const formBlock = renderSectionForms(s, out.expectedText, out.flags);
    if (formBlock) {
      // Embed inside the section wrapper when the renderer produced the standard
      // group shape; otherwise (cover/empty) append after it. NOTE: if the
      // coverage gate below still islands this section, the island's verbatim
      // source HTML carries the (dead) source form — the jetpack form is NOT
      // also emitted there, deliberately, so the page never shows two forms.
      const SECTION_CLOSE = '</section>\n<!-- /wp:group -->';
      out.markup = out.markup.endsWith(SECTION_CLOSE)
        ? out.markup.slice(0, -SECTION_CLOSE.length) + formBlock + '\n' + SECTION_CLOSE
        : out.markup
          ? out.markup + '\n\n' + formBlock
          : formBlock;
    }

    // Coverage-gated verbatim fallback: if the structured render dropped captured
    // content (media-first rule) and the section's source HTML is available, emit
    // a sanitized `core/html` island INSTEAD — nothing is dropped, at the cost of
    // this one section's block-editability. Runs BEFORE the empty-markup skip so a
    // section that rendered to nothing but had real content still falls back. The
    // island is provenance-exempt at the gate (verbatim by construction).
    const captured = {
      texts: [...s.headings, ...(s.bodyText ?? []), ...(s.buttonLabels ?? [])],
      imageUrls: (s.images ?? []).map((im) => im.url).filter(Boolean),
    };
    let cov = measureSectionCoverage(captured, out.markup);
    // Media recovery: when the loss includes ONLY recoverable images — local
    // uploads URLs at/above the decorative floor that a renderer path simply
    // didn't place (cell grid ignoring section images, lead-photo threshold,
    // cover paths) — append them as image blocks inside the section instead of
    // demoting it to an island. The island gives up block editability AND mobile
    // reflow (fixed-width source snapshot) for what is just an unplaced photo.
    // Re-measure after appending: a section that ALSO lost text still islands.
    if (cov.lost && cov.missingImages.length > 0) {
      const recoverable = cov.missingImages.map((url) => (s.images ?? []).find((im) => im.url === url)).filter(
        (im): im is SectionSpecImage =>
          !!im && isWpUrl(im.url) && Math.min(im.width || 0, im.height || 0) >= MIN_CELL_IMAGE_PX,
      );
      if (recoverable.length === cov.missingImages.length) {
        const recovered = recoverable
          .map((im) => imageBlock(im, out, `recovered#${s.sectionIndex}`, { align: centerOf(s) ? 'center' : null, rounded: true }))
          .filter(Boolean);
        const SECTION_CLOSE = '</section>\n<!-- /wp:group -->';
        const augmented = out.markup.endsWith(SECTION_CLOSE)
          ? out.markup.slice(0, -SECTION_CLOSE.length) + recovered.join('\n') + '\n' + SECTION_CLOSE
          : (out.markup ? out.markup + '\n\n' : '') + recovered.join('\n');
        const reMeasured = measureSectionCoverage(captured, augmented);
        if (!reMeasured.lost) {
          out.markup = augmented;
          cov = reMeasured;
          out.flags.push(
            `media-recovered#${s.sectionIndex}: appended ${recovered.length} dropped image(s) as blocks (island averted)`,
          );
        }
      }
    }
    if (cov.lost && (s.styledHtml || s.sectionHtml)) {
      // Blocks path: give the adapter's block recipe first crack at the source
      // HTML before falling back to the opaque core/html island. The recipe is
      // only wired when adapterBlocks is present (blocks reconstruct path); the
      // carry/theme path never sets it, so it falls through unchanged.
      // Recipes parse raw platform structure (sqs-block classes, CDN image
      // URLs), so feed the LESS-transformed sectionHtml first — styledHtml is the
      // R4b snapshot with inlined <style> blocks that would pollute the output.
      // (The verbatim core/html fallback below keeps its styledHtml-first floor.)
      const recipeSource = (s.sectionHtml ?? s.styledHtml) as string;
      const recipeMarkup = opts.adapterBlocks
        ? applyBlockRecipe(recipeSource, opts.adapterBlocks, {
            url: opts.sourceUrl ?? '',
            mediaMap: opts.mediaUrlMap ? Object.fromEntries(opts.mediaUrlMap) : undefined,
          })
        : null;
      if (recipeMarkup) {
        sectionMarkup.push(recipeMarkup);
        provenanceFlags.push(`adapter-recipe#${s.sectionIndex}: platform recipe upgraded section to blocks`);
        continue;
      }
      // Source-aware snapshot selection: WP-native sections use the clean,
      // responsive sectionHtml (theme styles their classes); non-WP keep the
      // styledHtml snapshot, where the inlined dims are load-bearing. `tier`
      // drives the provenance: `responsive`/`styled` are NOT bare divergences;
      // only `verbatim` (bare `html-fallback#`) is the unstyled signal.
      const { source, tier } = selectIslandSource(s);
      const island = buildHtmlFallbackBlock(source, { mediaUrlMap: opts.mediaUrlMap });
      sectionMarkup.push(island);
      provenanceFlags.push(
        `html-fallback${tier === 'verbatim' ? '' : `-${tier}`}#${s.sectionIndex}: structured render dropped content ` +
          `(${cov.missingImages.length} images missing, text ${Math.round(cov.textCoverage * 100)}%) — ` +
          `emitted ${tier} core/html`,
      );
      fallbackDiagnostics.push(
        buildFallbackDiagnostic({
          page: opts.sourceUrl ?? opts.patternSlug,
          slug: opts.slug ?? opts.patternSlug,
          section: s,
          coverage: cov,
          islandKind: tier,
          islandMarkup: island,
        }),
      );
      continue;
    }

    if (!out.markup) continue;
    sectionMarkup.push(out.markup);
    expectedText.push(...out.expectedText);
    bodyText.push(...out.bodyText);
    assets.push(...out.assets);
    provenanceFlags.push(...out.flags);
    iconAssets.push(...out.iconAssets);
  }

  const header =
    `<?php\n/**\n * Title: ${sanitizePatternHeaderField(opts.title)}\n * Slug: ${sanitizePatternHeaderField(
      opts.patternSlug,
    )}\n` +
    ` * Categories: featured\n * Inserter: false\n */\n?>\n`;

  // The hero is a full-bleed cover when the first rendered section is a wp:cover.
  // The template uses this to wire the OVERLAY header (transparent, over the
  // photo) vs the solid header — the chrome distinction lives in the template.
  const heroIsCover = sectionMarkup.length > 0 && /^\s*<!-- wp:cover\b/.test(sectionMarkup[0]);

  const bodyMarkup = sectionMarkup.join('\n\n') + '\n';
  return {
    php: header + bodyMarkup,
    body: bodyMarkup,
    expectedText: dedupe(expectedText),
    bodyText: dedupe(bodyText),
    expectedAssets: dedupe(assets),
    provenanceFlags,
    fallbackDiagnostics,
    sectionsRendered: sectionMarkup.length,
    iconAssets,
    heroIsCover,
  };
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}
