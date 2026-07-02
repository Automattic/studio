// src/lib/replicate/triage-candidates.ts
// Deterministic candidate selection for asset triage (Neptune technique #7).
// Only assets that LOOK decorative enter the candidate list — SVGs, extreme
// aspect ratios (divider strips), tiny glyphs, background images in textless
// sections. Ordinary content imagery (photos, product shots) NEVER becomes a
// candidate: keep-by-default is the never-lose-source-content boundary. The
// vision agent (skill stage) classifies candidates; absent triage output, the
// pipeline behaves exactly as before.
// See docs/superpowers/specs/2026-06-10-neptune-best-parts-design.md (section E).
import type { SectionSpec } from './section-extract.js';

export type TriageReason = 'svg' | 'extreme-aspect' | 'background-only' | 'tiny';

/** The join key all triage surfaces share — selector when captured, stable index fallback otherwise. Drift here breaks the candidates → triage-file → apply join SILENTLY, so every caller must use this. */
export function selectorKey(spec: Pick<SectionSpec, 'selector' | 'sectionIndex'>): string {
  return spec.selector ?? `section-index-${spec.sectionIndex}`;
}

export interface TriageCandidate {
  url: string;
  sectionSelector: string;
  reason: TriageReason;
  width: number;
  height: number;
  alt: string;
}

const EXTREME_ASPECT = 8;
const TINY_PX = 48;

export function selectTriageCandidates(specs: SectionSpec[]): TriageCandidate[] {
  const out: TriageCandidate[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const selector = selectorKey(spec);
    const hasText = (spec.headings?.length ?? 0) > 0 || (spec.bodyText?.length ?? 0) > 0;
    for (const image of spec.images ?? []) {
      const reason = classify(image.url, image.kind, image.width, image.height, hasText);
      if (reason === null) continue;
      const key = image.url + ' ' + selector;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url: image.url, sectionSelector: selector, reason, width: image.width, height: image.height, alt: image.alt });
    }
  }
  return out;
}

function classify(url: string, kind: 'img' | 'background', width: number, height: number, hasText: boolean): TriageReason | null {
  if (/\.svg(\?|#|$)/i.test(url) || url.startsWith('data:image/svg')) return 'svg';
  if (width > 0 && height > 0) {
    const aspect = width / height;
    if (aspect > EXTREME_ASPECT || aspect < 1 / EXTREME_ASPECT) return 'extreme-aspect';
    if (width < TINY_PX || height < TINY_PX) return 'tiny';
  }
  if (kind === 'background' && !hasText) return 'background-only';
  return null;
}
