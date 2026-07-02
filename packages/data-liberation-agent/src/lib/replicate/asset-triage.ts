// src/lib/replicate/asset-triage.ts
// Reader + applier for <outputDir>/asset-triage.json (Neptune technique #7).
// The file is written by the triage skill stage (vision agent classifying
// decorative candidates); this module is the deterministic consumer. ABSENT
// or malformed file = null = zero behavior change (fail-open, keep-by-default).
// Triage affects blocks-path PRESENTATION only — WXR/extraction media are
// never touched. Removal records carry the agent's 1-sentence description so
// downstream (fallback diagnostics, match-section) can pick a structural
// replacement (wp:separator / parent border / background) instead of guessing.
// See docs/superpowers/specs/2026-06-10-neptune-best-parts-design.md (section E).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SectionSpec } from './section-extract.js';
import { selectorKey } from './triage-candidates.js';

export interface AssetTriageEntry {
  url: string;
  sectionSelector: string;
  verdict: 'keep' | 'decoration';
  description: string;
}

export interface AssetTriageFile {
  schema: 1;
  site: string;
  entries: AssetTriageEntry[];
}

export interface AssetRemoval {
  url: string;
  sectionSelector: string;
  description: string;
}

export function loadAssetTriage(outputDir: string): AssetTriageFile | null {
  const path = join(outputDir, 'asset-triage.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AssetTriageFile;
    if (parsed.schema !== 1 || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function applyAssetTriage(
  specs: SectionSpec[],
  triage: AssetTriageFile,
): { specs: SectionSpec[]; removed: AssetRemoval[] } {
  const decorations = new Map<string, AssetTriageEntry>();
  for (const e of triage.entries) {
    if (e.verdict === 'decoration') decorations.set(e.url + ' ' + e.sectionSelector, e);
  }
  if (decorations.size === 0) return { specs, removed: [] };

  const removed: AssetRemoval[] = [];
  const out = specs.map(spec => {
    const selector = selectorKey(spec);
    const images = (spec.images ?? []).filter(image => {
      const hit = decorations.get(image.url + ' ' + selector);
      if (hit === undefined) return true;
      removed.push({ url: image.url, sectionSelector: selector, description: hit.description });
      return false;
    });
    // no removal: return original ref so untouched specs stay identity-comparable
    return images.length === (spec.images ?? []).length ? spec : { ...spec, images };
  });
  return { specs: out, removed };
}
