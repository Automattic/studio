// src/lib/replicate/compose-instantiate.ts
//
// Deterministic per-page composition: fill a cluster's layout skeleton with this
// page's captured content into known slots. Returns misfit=true (→ route to the
// compose-page-blocks SKILL) when content doesn't cleanly map. The sanity block
// makes clustering false-positives loud, not silent.
//
//   skeleton + pageContent ──▶ fill slots ──▶ { postContent, misfit, sanity }
//                                   │
//                                   ├─ unfilled slot  ─┐
//                                   └─ section mismatch┴─▶ misfit=true
//

export interface SectionSkeleton { type: string; slots: string[]; }
export interface LayoutSkeleton { sections: SectionSkeleton[]; }
export interface ComposeSanity { unfilledSlots: string[]; sectionCountMismatch: boolean; }
export interface ComposeResult { postContent: string; misfit: boolean; sanity: ComposeSanity; }

export function composeInstantiate(
  skeleton: LayoutSkeleton,
  pageContent: Record<string, string | number>,
  _mediaMap: Record<string, string>,
): ComposeResult {
  const unfilledSlots: string[] = [];
  const parts: string[] = [];

  for (const section of skeleton.sections) {
    let block = `<!-- section:${section.type} -->`;
    for (const slot of section.slots) {
      const value = pageContent[slot];
      if (value == null || value === '') unfilledSlots.push(slot);
      else block += `\n${String(value)}`;
    }
    parts.push(block);
  }

  const extraSections = Number(pageContent.__extraSections ?? 0);
  const sectionCountMismatch = extraSections > 0;
  const misfit = unfilledSlots.length > 0 || sectionCountMismatch;

  return {
    postContent: parts.join('\n'),
    misfit,
    sanity: { unfilledSlots, sectionCountMismatch },
  };
}
