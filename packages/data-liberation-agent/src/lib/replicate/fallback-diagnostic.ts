// src/lib/replicate/fallback-diagnostic.ts
//
// Structured, machine-actionable record for a coverage-gated core/html island
// (#1). Turns "N sections fell back" into "section X fell back because of dropped
// media; repair = recover_dropped_media" — readable by the reconstruction agent.
// Pure; warning-level. See 2026-06-04-section-identifiers-design.md.
import type { SectionSpec } from './section-extract.js';
import type { CoverageResult } from './section-coverage.js';
import type { AssetRemoval } from './asset-triage.js';

export type FallbackReasonCode = 'dropped_images' | 'text_coverage_below_floor' | 'decorative_asset_triaged';
export type FallbackRepairClass = 'recover_dropped_media' | 'restructure_section_blocks' | 'replace_with_structural_block';

export interface FallbackDiagnostic {
  id: string;
  page: string;
  sectionIndex: number;
  interactionModel: string;
  selector: string;
  severity: 'warning';
  reasonCode: FallbackReasonCode;
  /** 'none' = not an island record (decorative_asset_triaged removals). */
  islandKind: 'verbatim' | 'styled' | 'responsive' | 'none';
  droppedImages: string[];
  textCoverage: number;
  suggestedRepairClass: FallbackRepairClass;
  sourceHtmlPreview: string;
  emittedBlockPreview: string;
}

const PREVIEW = 200; // chars; preview budget — enough for agent triage, small enough not to bloat the JSON

export function buildFallbackDiagnostic(args: {
  page: string;
  slug: string;
  section: SectionSpec;
  coverage: CoverageResult;
  islandKind: 'verbatim' | 'styled' | 'responsive';
  islandMarkup: string;
}): FallbackDiagnostic {
  const { page, slug, section, coverage, islandKind, islandMarkup } = args;
  const reasonCode: FallbackReasonCode =
    coverage.missingImages.length > 0 ? 'dropped_images' : 'text_coverage_below_floor';
  const suggestedRepairClass: FallbackRepairClass =
    reasonCode === 'dropped_images' ? 'recover_dropped_media' : 'restructure_section_blocks';
  const sourceHtmlPreview = ((section.styledHtml ?? section.sectionHtml ?? '') as string).slice(0, PREVIEW);
  return {
    id: `${slug}-s${section.sectionIndex}-${reasonCode}`,
    page,
    sectionIndex: section.sectionIndex,
    interactionModel: String(section.interactionModel),
    selector: section.selector ?? '',
    severity: 'warning',
    reasonCode,
    islandKind,
    droppedImages: coverage.missingImages,
    textCoverage: Math.round(coverage.textCoverage * 100) / 100,
    suggestedRepairClass,
    sourceHtmlPreview,
    emittedBlockPreview: islandMarkup.slice(0, PREVIEW),
  };
}

/**
 * Diagnostic record for a triage-removed decorative asset (Neptune #7). Not a
 * core/html island fallback — a warning-level audit trail: which image was
 * dropped from which section, plus the vision agent's 1-sentence description
 * (carried in `sourceHtmlPreview`, the record's free-text channel) so the
 * structural replacement (wp:separator / parent border / background) can be
 * chosen from what the visual actually was instead of guessed.
 */
export function buildTriageRemovalDiagnostic(args: {
  page: string;
  slug: string;
  sectionIndex: number;
  interactionModel: string;
  removal: AssetRemoval;
  ordinal: number;
}): FallbackDiagnostic {
  const { page, slug, sectionIndex, interactionModel, removal, ordinal } = args;
  return {
    id: `${slug}-s${sectionIndex}-decorative_asset_triaged-${ordinal}`,
    page,
    sectionIndex,
    interactionModel,
    selector: removal.sectionSelector,
    severity: 'warning',
    reasonCode: 'decorative_asset_triaged',
    islandKind: 'none',
    droppedImages: [removal.url],
    textCoverage: 1, // no text impact — the removal is image-only
    suggestedRepairClass: 'replace_with_structural_block',
    sourceHtmlPreview: removal.description.slice(0, PREVIEW),
    emittedBlockPreview: '',
  };
}
