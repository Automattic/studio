import { colorDeltaE2000 } from './color-delta.js';

// src/lib/replicate/section-parity.ts
// Per-section visual-parity contract — the unit the faithful-recreation gate keys on.
// Pure: status derivation only. The SCORER that fills `signals` from rendered DOM /
// sampled pixels (and computes `columnCountMatch`) is the section-rebuild *capability*
// spec; this module defines what "matches the source" MEANS, measured, and who may
// accept a divergence. See docs/superpowers/specs/2026-05-28-enforce-faithful-recreation-design.md.

/** CIE2000 ΔE above which a section's background color counts as a real divergence.
 *  Start at 10 (clearly-different color); tune from QA evidence like TEXT_FLOOR. */
export const BG_DELTA_E_FLOOR = 10;

/** Robust structural signals — chosen because they survive the font-substitution and
 *  text-reflow noise that makes whole-section pixel-diff unreliable, and because they are
 *  exactly the observed flatten failures (bg color, column count, dropped section/media,
 *  unstyled island). */
export interface SectionParitySignals {
  /** Replica did NOT drop or merge this section away. */
  sectionPresent: boolean;
  /** CIE2000 ΔE of the band background, source vs replica. */
  bgDeltaE: number;
  /** 3-card grid stayed 3; a 2-column band stayed 2. (Capability spec computes from DOM;
   *  defaults true until then so the gate never falsely blocks on an unimplemented signal.) */
  columnCountMatch: boolean;
  /** Captured image(s) present and placed in the band. */
  mediaPresent: boolean;
  /** A core/html fallback island landed on a CSS-LAYOUT section (carries HTML, not CSS →
   *  renders unstyled). A text-only island does NOT set this. */
  fallbackUnstyled: boolean;
}

export type DivergenceReason =
  | 'section-dropped'
  | 'bg-color'
  | 'column-flatten'
  | 'media-dropped'
  | 'unstyled-island';

/** Reasons that are always FIXABLE, never a genuine WP/source rendering constraint —
 *  so the agent may not self-accept them as Class C. Under the current signal set this
 *  is every reason, so class-c acceptance never validly applies to a detected divergence;
 *  a true sub-threshold WP constraint does not trip these signals (it stays `match` with a
 *  pixel-delta note the agent may annotate). Accepting a real divergence is the operator's call. */
const NEVER_CLASS_C: ReadonlySet<DivergenceReason> = new Set<DivergenceReason>([
  'section-dropped',
  'bg-color',
  'column-flatten',
  'media-dropped',
  'unstyled-island',
]);

/** Who accepted a divergent section, and the evidence. */
export interface SectionAcceptance {
  by: 'human' | 'class-c';
  /** Required, non-empty: operator rationale, or sampled-pixel proof for class-c. */
  proof: string;
}

export type SectionStatus = 'match' | 'divergent' | 'accepted';

export interface SectionParity {
  /** Section id / Y-band label. */
  band: string;
  signals: SectionParitySignals;
  /** 0..10 gap-to-target score (for the human report; the verdict re-derives status). */
  score: number;
  status: SectionStatus;
  /** Sampled pixels backing the score — "prove it works": no pass without evidence. */
  evidence: { srcSample: string; repSample: string };
  acceptance?: SectionAcceptance;
}

/** Which robust signals tripped. Empty → the section matches the source. */
export function divergenceReasons(s: SectionParitySignals): DivergenceReason[] {
  const reasons: DivergenceReason[] = [];
  if (!s.sectionPresent) reasons.push('section-dropped');
  if (s.bgDeltaE > BG_DELTA_E_FLOOR) reasons.push('bg-color');
  if (!s.columnCountMatch) reasons.push('column-flatten');
  if (!s.mediaPresent) reasons.push('media-dropped');
  if (s.fallbackUnstyled) reasons.push('unstyled-island');
  return reasons;
}

function isAcceptanceValid(acceptance: SectionAcceptance, reasons: DivergenceReason[]): boolean {
  if (!acceptance.proof.trim()) return false; // schema-locked: no blank sign-offs
  if (acceptance.by === 'human') return true; // operator may sign off on any divergence
  // class-c: a genuine WP/source constraint — never valid for a fixable structural reason.
  return reasons.every((r) => !NEVER_CLASS_C.has(r));
}

/** Measured per-section metrics — source side from the `SectionSpec`, replica side read
 *  from the live replica DOM (see `verify.ts`). Paired to the source spec by section index.
 *  `evaluateSectionParity` is pure over these (mirrors `evaluateResponsive`); all I/O —
 *  the DOM walk and computed-color read — happens in the caller. */
export interface SectionParityMetrics {
  sourceColumnCount: number;        // spec.columnCount
  replicaColumnCount: number;       // measured: top-level side-by-side children at desktop
  sourceBg: string;                 // spec.backgroundColor (rgb/rgba string)
  replicaBg: string;                // measured: computed background of the rendered section
  sourceHasMedia: boolean;          // spec.images.length > 0
  replicaHasMedia: boolean;         // measured: <img> or background-image present in the section
  sourceIsCssLayout: boolean;       // spec.columnCount >= 2 || (spec.cells?.length ?? 0) >= 2
  isHtmlFallback: boolean;          // a provenance flag for the unstyled coverage island exists
  sectionPresentInReplica: boolean; // the replica rendered a section at this index
}

/** Minimal source-side descriptor (extracted by the caller from a `SectionSpec`), so this
 *  module stays decoupled from the full spec shape. */
export interface SourceSectionDescriptor {
  columnCount: number;       // spec.layout.columnCount
  backgroundColor: string;   // spec.backgroundColor
  hasMedia: boolean;         // spec.images.length > 0
  isCssLayout: boolean;      // columnCount >= 2 || cells >= 2
  isHtmlFallback: boolean;   // a provenance flag for the unstyled coverage island exists
}

/** Replica-side measurement read from the live DOM (see `verify.ts`). */
export interface ReplicaSectionMeasure {
  columnCount: number;
  bg: string;
  hasMedia: boolean;
}

/** Given the top offsets of a columns block's children, return how many sit in the
 *  largest single horizontal row (within `tolPx`). This is how the replica's RENDERED
 *  column count is read: declared columns that CSS collapsed to a vertical stack have
 *  spread-out tops → largest row is 1, catching a visual flatten that an element count
 *  would miss. Pure kernel of the in-browser DOM walk in `verify.ts`. */
export function largestRowGroupSize(tops: number[], tolPx = 6): number {
  if (tops.length === 0) return 0;
  let best = 1;
  for (const anchor of tops) {
    const inRow = tops.filter((t) => Math.abs(t - anchor) <= tolPx).length;
    if (inRow > best) best = inRow;
  }
  return best;
}

/** Pair a source section with its replica measurement (by index) into scorer metrics. A
 *  `null` replica means the replica produced no section at this index (dropped/merged). */
export function toSectionParityMetrics(
  src: SourceSectionDescriptor,
  replica: ReplicaSectionMeasure | null,
): SectionParityMetrics {
  return {
    sourceColumnCount: src.columnCount,
    replicaColumnCount: replica?.columnCount ?? 0,
    sourceBg: src.backgroundColor,
    replicaBg: replica?.bg ?? '',
    sourceHasMedia: src.hasMedia,
    replicaHasMedia: replica?.hasMedia ?? false,
    sourceIsCssLayout: src.isCssLayout,
    isHtmlFallback: src.isHtmlFallback,
    sectionPresentInReplica: replica !== null,
  };
}

/** Turn measured metrics into the five robust signals. Pure. A replica that meets OR
 *  exceeds the source column count is a match (over-splitting is not the failure guarded
 *  here); a `3 → 1` collapse fails. */
export function evaluateSectionParity(m: SectionParityMetrics): SectionParitySignals {
  return {
    sectionPresent: m.sectionPresentInReplica,
    bgDeltaE: colorDeltaE2000(m.sourceBg, m.replicaBg),
    columnCountMatch: m.replicaColumnCount >= m.sourceColumnCount,
    mediaPresent: !m.sourceHasMedia || m.replicaHasMedia,
    fallbackUnstyled: m.isHtmlFallback && m.sourceIsCssLayout,
  };
}

/** The single source of truth for a section's status. The run-report verdict re-derives
 *  from `signals` + `acceptance` rather than trusting a stored `status`, so prose can't
 *  override the measured table. */
export function deriveSectionParityStatus(
  signals: SectionParitySignals,
  acceptance?: SectionAcceptance,
): SectionStatus {
  const reasons = divergenceReasons(signals);
  if (reasons.length === 0) return 'match';
  if (acceptance && isAcceptanceValid(acceptance, reasons)) return 'accepted';
  return 'divergent';
}
