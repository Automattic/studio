// src/lib/replicate/normalize/compose-page.ts
import { composeInstantiate, type LayoutSkeleton } from '../compose-instantiate.js';
import { validateBlockContract, type BlockContractIssue } from '../block-contract.js';
import { blockMarkupRoundtrips } from '../../streaming/block-markup-validate.js';
import { segmentPage } from './segment.js';
import { rewriteInternalHrefs } from '../local-site/href-rewrite.js';
import { emitSectionBlocks } from './emit-blocks.js';
import { findDroppedClasses, type SectionStylingDrop } from './styling-conservation.js';
import type { InstanceStyleSheet } from './instance-styles.js';
import type { LocalPage, NormalizeReportEntry, RevealBehavior, Section, SectionBehavior } from '../local-site/types.js';

export interface ComposePageResult {
  postContent: string;
  report: NormalizeReportEntry[];
  formsConverted: number;
  /** Registered-metadata contract issues (WARNING-level — the emitter is
   * contract-clean by construction; non-empty = an emitter bug to fix). */
  contractIssues: BlockContractIssue[];
  /** Source CSS classes that did NOT survive a section's block conversion
   * (WARNING-level styling-conservation diagnostic). Empty on a clean page;
   * non-empty = a dropped styling hook the carried CSS targeted. */
  stylingDrops: SectionStylingDrop[];
}

export interface ComposePageOpts {
  /** nativeBehaviors: tag every body section with the detected reveal. The
   * source observed document.querySelectorAll('section') — all sections —
   * so tagging is uniform, mirroring source semantics exactly. */
  reveal?: RevealBehavior;
  /** B1: per-section DOM-pattern detection callback (inversion — compose-page
   * gains no detection imports; the handler closes over the source assets).
   * A specific behavior (tabs/slider/modal) beats the uniform reveal: one
   * behavior per section (the wrapper block is singular). Runs on BOTH paths
   * — tagging guarantees verbatim inner (content survival); `native` decides
   * the wrapper. */
  detectSection?: (s: Section) => SectionBehavior | undefined;
  /** nativeBehaviors path marker. true → tagged sections emit the dla/<kind>
   * directive wrapper; false/absent (carry/default) → the SAME verbatim inner
   * rides a plain core/group wrapper (no plugin dependency; the carried
   * source JS drives the intact DOM). reveal is caller-gated to native. */
  native?: boolean;
  /** Site page slugs: internal hrefs (shop.html, ./shop.html, /shop.html) in
   * the page body are rewritten to WP permalink form (/shop/) BEFORE
   * segmentation, so every emitted anchor — buttons, inline links, verbatim
   * sections — links to the live page instead of a dead .html path. JS-
   * rendered links are the runtime click shim's job (theme-files). */
  pageSlugs?: string[];
  /** Shared instance-style sheet: per-element inline `style=` is carried as a
   * lib-i<hash> class + a stylesheet rule registered here (fixer-safe), instead
   * of an inline style attr the block fixer would strip. The caller (ingest)
   * passes one sheet across all pages so identical declarations dedupe, then
   * emits sheet.toCss() into the carried instance-styles.css. */
  instanceStyles?: InstanceStyleSheet;
  /** Carry path: preserve interactive subtrees (search/forms, button menus,
   * inline-svg icons) and empty CSS-background hooks VERBATIM as core/html
   * islands instead of letting the block conversion drop the <svg>/controls/
   * classes. Query-loop MOUNTS (empty id-bearing divs) are excluded — they
   * still emit as anchor-groups for injectQueryLoops. Default false. */
  verbatimInteractive?: boolean;
  /** Local compose path: convert eligible source forms into Jetpack Forms blocks.
   * Default false so existing non-local callers remain byte-identical. */
  jetpackForms?: boolean;
}

export function composePage(page: LocalPage, opts: ComposePageOpts = {}): ComposePageResult {
  const native = opts.native === true;
  const sourceHtml = opts.pageSlugs?.length
    ? rewriteInternalHrefs(page.html, opts.pageSlugs)
    : page.html;
  const bodySections = segmentPage(sourceHtml)
    .filter((s) => s.role === 'body')
    .map((s) => {
      const sectionBehavior = opts.detectSection?.(s);
      // Specific per-section behavior beats the uniform reveal (one wrapper).
      if (sectionBehavior) return { ...s, behavior: sectionBehavior };
      return opts.reveal ? { ...s, behavior: opts.reveal } : s;
    });
  // Genuinely empty page: nothing to validate, skip the roundtrip gate.
  if (bodySections.length === 0)
    return { postContent: '', report: [], formsConverted: 0, contractIssues: [], stylingDrops: [] };

  const skeleton: LayoutSkeleton = { sections: [] };
  const pageContent: Record<string, string> = {};
  const report: NormalizeReportEntry[] = [];
  const stylingDrops: SectionStylingDrop[] = [];
  let formsConverted = 0;

  for (const section of bodySections) {
    const { markup, confidence, formsConverted: sectionFormsConverted } = emitSectionBlocks(section, {
      behaviorWrapper: native ? 'dla' : 'group',
      instanceStyles: opts.instanceStyles,
      verbatimInteractive: opts.verbatimInteractive,
      jetpackForms: opts.jetpackForms,
    });
    formsConverted += sectionFormsConverted;
    // Styling-conservation: surface any source class the conversion dropped
    // (the carried CSS that targeted it no longer matches). Warning-level.
    // Sections converted to a Jetpack Form are SKIPPED — their source form
    // structure (form-card/field/field-row/…) is intentionally replaced by the
    // Jetpack block markup, so those drops are by-design, not lost styling.
    const droppedClasses = sectionFormsConverted > 0 ? [] : findDroppedClasses(section.html, markup);
    if (droppedClasses.length > 0) stylingDrops.push({ sectionId: section.id, droppedClasses });
    skeleton.sections.push({ type: 'content', slots: [section.id] });
    pageContent[section.id] = markup;
    // blockType reflects the WRAPPER EMITTED: carry-tagged sections wrap as
    // plain groups (per-kind counts stay native-only by construction). The
    // reveal branch always emits dla/reveal — reveal is caller-gated to native.
    const blockType =
      section.behavior && (native || section.behavior.kind === 'reveal')
        ? `dla/${section.behavior.kind}`
        : 'group';
    report.push({ sectionId: section.id, blockType, confidence });
  }

  const composed = composeInstantiate(skeleton, pageContent, {});
  // Unreachable today (every slot is filled with non-empty group markup) —
  // fence against future composeInstantiate changes causing silent partial loss.
  if (composed.misfit) {
    throw new Error(`compose mismatch for "${page.slug}": ${JSON.stringify(composed.sanity)}`);
  }
  // Strip composeInstantiate's "<!-- section:type -->" marker lines; keep only block markup.
  const postContent = composed.postContent
    .split('\n')
    .filter((line) => !/^<!--\s*section:/.test(line))
    .join('\n')
    .trim();

  const check = blockMarkupRoundtrips(postContent);
  if (!check.ok) {
    throw new Error(`composed markup for "${page.slug}" failed roundtrip: ${check.reason}`);
  }
  // Warning-level sibling of the roundtrip gate: emitted attrs vs registered
  // core metadata (never throws; dla/* + core/html allowlisted in the check).
  return { postContent, report, formsConverted, contractIssues: validateBlockContract(postContent), stylingDrops };
}
