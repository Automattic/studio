// src/lib/replicate/region-audit.ts
//
// Reconciles source landmarks against what the build placed (#2). Body sections
// join by selector; chrome joins by role; tiny/empty regions are non_actionable.
// An actionable landmark that maps to nothing is `unassigned` — the dropped-nav
// signal. Pure. See 2026-06-04-section-identifiers-design.md.
import type { SourceLandmark } from './section-extract.js';

export type RegionAssignmentKind =
  | 'page_body_section' | 'header_part' | 'footer_part' | 'non_actionable' | 'unassigned';

export interface RegionAssignment { landmark: SourceLandmark; kind: RegionAssignmentKind; }

export interface PlacedRegion {
  kind: 'page_body_section' | 'header_part' | 'footer_part';
  selector?: string;
  role?: 'header' | 'nav' | 'footer' | 'aside' | 'complementary';
}

export interface RegionSelectionReport {
  page: string;
  entryUrl: string;
  assignments: RegionAssignment[];
  unassignedRegions: SourceLandmark[];
  counts: { sourceLandmarks: Record<string, number>; assigned: number; unassigned: number; nonActionable: number };
}

const ACTIONABLE_TEXT_MIN = 24;
const ACTIONABLE_LINK_MIN = 2;

function normalizePositionalSelector(selector: string): string {
  return selector.replace(/:nth-of-type\(\d+\)/g, ':nth-of-type(1)');
}

interface PlacementIndex {
  exact: Map<string, PlacedRegion>;
  normalized: Map<string, PlacedRegion[]>;
  sourceCounts: Map<string, number>;
  sourceRoleCounts: Map<string, number>;
}

function roleKey(role: SourceLandmark['role'], selector: string): string {
  return `${role}\u0000${selector}`;
}

function requiresRoleQualifiedSelector(role: SourceLandmark['role']): boolean {
  return role === 'aside' || role === 'complementary';
}

function buildPlacementIndex(census: SourceLandmark[], placed: PlacedRegion[]): PlacementIndex {
  const exact = new Map<string, PlacedRegion>();
  const normalized = new Map<string, PlacedRegion[]>();
  const sourceCounts = new Map<string, number>();
  const sourceRoleCounts = new Map<string, number>();
  for (const l of census) {
    const key = normalizePositionalSelector(l.selector);
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
    const rKey = roleKey(l.role, key);
    sourceRoleCounts.set(rKey, (sourceRoleCounts.get(rKey) ?? 0) + 1);
  }
  for (const p of placed) {
    if (!p.selector) continue;
    exact.set(p.selector, p);
    const key = normalizePositionalSelector(p.selector);
    const entries = normalized.get(key) ?? [];
    entries.push(p);
    normalized.set(key, entries);
  }
  return { exact, normalized, sourceCounts, sourceRoleCounts };
}

function placedBySelector(l: SourceLandmark, index: PlacementIndex): PlacedRegion | undefined {
  const exact = index.exact.get(l.selector);
  const roleQualified = requiresRoleQualifiedSelector(l.role);
  if (exact) return exact;

  const key = normalizePositionalSelector(l.selector);
  const candidates = index.normalized.get(key) ?? [];
  if (candidates.length === 0) return undefined;

  const roleCandidates = candidates.filter((p) => p.role === l.role || (!roleQualified && p.role === undefined));
  if (roleCandidates.length === 1 && (index.sourceRoleCounts.get(roleKey(l.role, key)) ?? 0) === 1) {
    return roleCandidates[0];
  }

  if (!roleQualified && candidates.length === 1 && (index.sourceCounts.get(key) ?? 0) === 1) {
    return candidates[0];
  }

  return undefined;
}

function classify(l: SourceLandmark, placed: PlacedRegion[], index: PlacementIndex): RegionAssignmentKind {
  if (l.textLength < ACTIONABLE_TEXT_MIN && l.mediaCount === 0 && (l.linkCount ?? 0) < ACTIONABLE_LINK_MIN) return 'non_actionable';
  const hasHeader = placed.some((p) => p.kind === 'header_part');
  const hasFooter = placed.some((p) => p.kind === 'footer_part');
  const bodySelectors = new Set(placed.filter((p) => p.kind === 'page_body_section').map((p) => p.selector));
  if ((l.role === 'header' || l.role === 'nav') && hasHeader) return 'header_part';
  if (l.role === 'footer' && hasFooter) return 'footer_part';
  if (l.role === 'main' || l.role === 'article') return bodySelectors.size > 0 ? 'page_body_section' : 'unassigned';
  if (l.role === 'aside' || l.role === 'complementary') {
    const selectorPlacement = placedBySelector(l, index);
    if (selectorPlacement) return selectorPlacement.kind;
    const placedLandmark = placed.find((p) => p.role === l.role && p.selector === undefined);
    if (placedLandmark) return placedLandmark.kind;
    return 'unassigned';
  }
  if (bodySelectors.has(l.selector) || placedBySelector(l, index)?.kind === 'page_body_section') return 'page_body_section';
  return 'unassigned';
}

export function reconcileRegions(
  census: SourceLandmark[],
  placed: PlacedRegion[],
  page = '',
  entryUrl = '',
): RegionSelectionReport {
  const index = buildPlacementIndex(census, placed);
  const assignments = census.map((l) => ({ landmark: l, kind: classify(l, placed, index) }));
  const sourceLandmarks: Record<string, number> = {};
  for (const l of census) sourceLandmarks[l.role] = (sourceLandmarks[l.role] ?? 0) + 1;
  const unassignedRegions = assignments.filter((a) => a.kind === 'unassigned').map((a) => a.landmark);
  return {
    page, entryUrl, assignments, unassignedRegions,
    counts: {
      sourceLandmarks,
      assigned: assignments.filter((a) => ['page_body_section', 'header_part', 'footer_part'].includes(a.kind)).length,
      unassigned: unassignedRegions.length,
      nonActionable: assignments.filter((a) => a.kind === 'non_actionable').length,
    },
  };
}
