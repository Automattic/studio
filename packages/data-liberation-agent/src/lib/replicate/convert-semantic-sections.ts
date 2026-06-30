//
// Semantic-section pre-conversion (async)
// =======================================
// Bridges the async block-fixer sidecar and the SYNCHRONOUS reconstructor. For a
// page's sections, send the SEMANTIC ones (isSemanticHtml) to rawConvert and return
// a Map<sectionIndex, {markup, wpHtmlResidue}> the reconstructor consumes as data —
// so reconstructPagePattern (~75 callers) stays sync. Sanitizes BEFORE the parser
// (scripts must never reach rawHandler). Sentinel/residue results are kept in the
// map; the reconstructor's clean-check rejects them and falls back.
//
import type { SectionSpec } from './section-extract.js';
import type { RawConvertResult } from '../streaming/block-fixer-client.js';
import { isSemanticHtml } from './semantic-html.js';
import { sanitize } from '@automattic/blocks-engine/theme';

export interface RawConverter {
  rawConvert(items: string[]): Promise<RawConvertResult[]>;
}

export async function convertSemanticSections(
  sections: SectionSpec[],
  client: RawConverter,
): Promise<Map<number, { markup: string | null; wpHtmlResidue: number }>> {
  const semantic = sections.filter((s) => s.sectionHtml && isSemanticHtml(s.sectionHtml));
  const map = new Map<number, { markup: string | null; wpHtmlResidue: number }>();
  if (semantic.length === 0) return map;

  const items = semantic.map((s) => sanitize(s.sectionHtml as string));
  const results = await client.rawConvert(items);
  semantic.forEach((s, i) => {
    const r = results[i] ?? { html: null, wpHtmlResidue: Infinity };
    map.set(s.sectionIndex, { markup: r.html, wpHtmlResidue: r.wpHtmlResidue });
  });
  return map;
}
