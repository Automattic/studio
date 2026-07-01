// src/lib/replicate/refine-report.ts
// Refine-coverage validator (Neptune technique #2): every visual finding a
// match-section run records MUST be accounted as applied or skipped — silent
// drops are the failure mode this exists to kill. Pure function; the MCP
// handler reads <outputDir>/refine/<slug>/*.json and feeds them here.
// See docs/superpowers/specs/2026-06-10-neptune-best-parts-design.md (section B).
export interface RefineFinding {
  id: string;
  region: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  block_change?: string | null;
  style_change?: string | null;
  affects_layout: boolean;
}

export interface RefineSectionReport {
  schema: 1;
  slug: string;
  sourceUrl: string;
  index: number;
  findings: RefineFinding[];
  applied: Array<{ id: string; summary: string }>;
  skipped: Array<{ id: string; reason: string }>;
}

export interface RefineValidation {
  ok: boolean;
  errors: string[];
  sections: number;
  findings: number;
  applied: number;
  skipped: number;
}

export function validateRefineReports(reports: RefineSectionReport[]): RefineValidation {
  const errors: string[] = [];
  let findings = 0;
  let applied = 0;
  let skipped = 0;

  reports.forEach((r, ri) => {
    const at = `section[${ri}] (index ${typeof r?.index === 'number' ? r.index : '?'})`;
    if (typeof r !== 'object' || r === null || !Array.isArray(r.findings) || !Array.isArray(r.applied) || !Array.isArray(r.skipped)) {
      errors.push(`${at}: malformed report — findings/applied/skipped arrays are required`);
      return;
    }
    const ids = new Set<string>();
    for (const f of r.findings) {
      if (typeof f?.id !== 'string' || f.id === '') { errors.push(`${at}: finding with missing id`); continue; }
      if (ids.has(f.id)) errors.push(`${at}: duplicate finding id "${f.id}"`);
      ids.add(f.id);
    }
    const appliedIds = new Set(r.applied.map(a => a?.id).filter((x): x is string => typeof x === 'string'));
    const skippedIds = new Set(r.skipped.map(s => s?.id).filter((x): x is string => typeof x === 'string'));
    for (const id of ids) {
      const inA = appliedIds.has(id), inS = skippedIds.has(id);
      if (inA && inS) errors.push(`${at}: finding "${id}" appears in both applied and skipped`);
      if (!inA && !inS) errors.push(`${at}: finding "${id}" is UNACCOUNTED — add it to applied (with summary) or skipped (with reason)`);
    }
    for (const a of r.applied) if (a?.id && !ids.has(a.id)) errors.push(`${at}: applied id "${a.id}" has no matching finding`);
    for (const s of r.skipped) if (s?.id && !ids.has(s.id)) errors.push(`${at}: skipped id "${s.id}" has no matching finding`);
    findings += ids.size;
    applied += r.applied.length;
    skipped += r.skipped.length;
  });

  return { ok: errors.length === 0, errors, sections: reports.length, findings, applied, skipped };
}
