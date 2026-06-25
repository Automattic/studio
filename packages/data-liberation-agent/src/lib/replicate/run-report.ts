// src/lib/replicate/run-report.ts
// Assembles the verdict-first run report the operator reads to answer "is this
// liberation good?". Order: verdict → summary → details. Responsiveness is the
// HARD gate (fail); fallbacks/misfits/provenance flags are warnings.
import { deriveSectionParityStatus, type SectionParity } from './section-parity.js';
import type { StyleAuditResult } from './style-audit.js';

export interface ClusterReport { key: string; representative: string; built: boolean; gatePassed: boolean; }
export interface ArchetypeResponsive { archetype: string; responsive: boolean; }
/** Per content page: the sampled section-parity records. An EMPTY `sections` array means
 *  the page was reconstructed but never measured → unverified → hard fail (no evidence ≠
 *  matches). Posts/products are template-rendered and are NOT listed here. */
export interface PageParity { page: string; sections: SectionParity[]; }
export interface RunReportInput {
  site: string;
  clusters: ClusterReport[];
  pagesComposed: number;
  pagesMisfit: number;
  responsive: ArchetypeResponsive[];
  provenanceFlags: number;
  fallbackPages: number;
  /** Sections emitted as verbatim core/html islands (coverage-gated fallback). Warning-level. */
  htmlFallbackSections?: number;
  /** Fallback islands by reason, e.g. { dropped_images: 2 }. Detail in fallback-diagnostics.json. */
  htmlFallbackByReason?: Record<string, number>;
  /** Total source landmarks that weren't placed anywhere (body section, header, or footer). Warning-level. */
  unassignedRegions?: number;
  /** Chrome-fidelity audit: CSS corrections auto-applied to site.css (display/opacity/text-decoration/etc.). Informational — never triggers warn. */
  chromeCorrections?: number;
  /** Chrome-fidelity audit: source chrome elements that didn't survive the carry. Warning-level — investigate. */
  droppedChrome?: number;
  /** Style-usage audit (blocks path): supports-vs-css dial. INFORMATIONAL —
   * never a verdict input; a low percent is a posture observation. */
  styleAudit?: StyleAuditResult;
  /** Registered-metadata block-contract issue count (emitter-bug dial).
   * WARNING-level observability only — never a verdict input. */
  contractIssues?: number;
  /** Per-page visual-parity records. When present, the verdict is gated on them: any
   *  unaccepted divergent section, or any reconstructed page with no sampled sections,
   *  is a HARD fail. Absent → parity gate off (back-compat). */
  pageParity?: PageParity[];
  cost?: { tokens?: number; subagents?: number; skillCalls?: number };
  qualitativeNotes?: string[];
  knownGaps?: string[];
}
export type Verdict = 'pass' | 'warn' | 'fail';
export interface RunReport {
  site: string;
  verdict: { overall: Verdict; perArchetype: ArchetypeResponsive[] };
  summary: {
    clustersBuilt: number; clustersFailed: number;
    pagesComposed: number; pagesMisfit: number;
    responsivePass: number; responsiveFail: number;
    provenanceFlags: number; fallbackPages: number;
    htmlFallbackSections: number;
    htmlFallbackByReason: Record<string, number>;
    unassignedRegions: number;
    chromeCorrections: number;
    droppedChrome: number;
    styleAudit: StyleAuditResult | null;
    contractIssues: number;
    sectionsDivergent: number; sectionsAccepted: number; pagesParityUnverified: number;
    cost: { tokens?: number; subagents?: number; skillCalls?: number };
  };
  details: { clusters: ClusterReport[]; qualitativeNotes: string[]; knownGaps: string[] };
}

export function buildRunReport(input: RunReportInput): RunReport {
  const clustersFailed = input.clusters.filter((c) => !c.built || !c.gatePassed).length;
  const responsiveFail = input.responsive.filter((r) => !r.responsive).length;
  const responsivePass = input.responsive.length - responsiveFail;
  const htmlFallbackSections = input.htmlFallbackSections ?? 0;

  // Section-parity gate (faithful recreation). Re-derive each section's status from its
  // measured signals + acceptance — NOT a stored `status` — so the verdict is a function
  // of the table, not the agent's prose (schema-locked). A reconstructed page with no
  // sampled sections is "unverified" → hard fail (prove-it-works: no evidence ≠ matches).
  const parityPages = input.pageParity ?? [];
  let sectionsDivergent = 0;
  let sectionsAccepted = 0;
  let pagesParityUnverified = 0;
  for (const pp of parityPages) {
    if (pp.sections.length === 0) {
      pagesParityUnverified += 1;
      continue;
    }
    for (const s of pp.sections) {
      const status = deriveSectionParityStatus(s.signals, s.acceptance);
      if (status === 'divergent') sectionsDivergent += 1;
      else if (status === 'accepted') sectionsAccepted += 1;
    }
  }
  const parityFail = sectionsDivergent > 0 || pagesParityUnverified > 0;

  let overall: Verdict;
  if (clustersFailed > 0 || responsiveFail > 0 || parityFail) {
    overall = 'fail';
  } else if (
    input.fallbackPages > 0 || input.pagesMisfit > 0 ||
    input.provenanceFlags > 0 || htmlFallbackSections > 0 || (input.knownGaps?.length ?? 0) > 0 ||
    (input.unassignedRegions ?? 0) > 0 || (input.droppedChrome ?? 0) > 0
  ) {
    overall = 'warn';
  } else {
    overall = 'pass';
  }

  return {
    site: input.site,
    verdict: { overall, perArchetype: input.responsive },
    summary: {
      clustersBuilt: input.clusters.length - clustersFailed,
      clustersFailed,
      pagesComposed: input.pagesComposed,
      pagesMisfit: input.pagesMisfit,
      responsivePass,
      responsiveFail,
      provenanceFlags: input.provenanceFlags,
      fallbackPages: input.fallbackPages,
      htmlFallbackSections,
      htmlFallbackByReason: input.htmlFallbackByReason ?? {},
      unassignedRegions: input.unassignedRegions ?? 0,
      chromeCorrections: input.chromeCorrections ?? 0,
      droppedChrome: input.droppedChrome ?? 0,
      styleAudit: input.styleAudit ?? null,
      contractIssues: input.contractIssues ?? 0,
      sectionsDivergent,
      sectionsAccepted,
      pagesParityUnverified,
      cost: input.cost ?? {},
    },
    details: {
      clusters: input.clusters,
      qualitativeNotes: input.qualitativeNotes ?? [],
      knownGaps: input.knownGaps ?? [],
    },
  };
}
