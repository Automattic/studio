// src/lib/replicate/responsive-check.ts
// The HARD responsiveness acceptance gate, expressed as a pure function over
// metrics measured from a deployed replica at 390px: (1) no horizontal overflow,
// (2) every section reflowed (none stayed at desktop width), (3) no content
// renders past the fold. A 1px tolerance absorbs sub-pixel rounding.
export interface ResponsiveMetrics {
  scrollWidth: number;
  viewportWidth: number;
  sectionsTotal: number;
  sectionsReflowed: number;
  /**
   * Count of leaf content elements (text / images) whose box extends beyond the
   * viewport, measured by `getBoundingClientRect` which IGNORES clipping. This
   * closes the `overflow-x:clip` blind spot: a fixed-width R4b styled island
   * keeps `scrollWidth == viewport` because an ancestor clips it, yet its content
   * is amputated off-screen. Optional (defaults to 0) for back-compat. A non-zero
   * count is the lever that DEMOTES a styled island — it fails responsiveness, so
   * the ladder must climb to R4a (reflowing core blocks) rather than stop at R4b.
   */
  contentPastFoldCount?: number;
}
export interface ResponsiveResult { ok: boolean; reasons: string[]; }

export function evaluateResponsive(m: ResponsiveMetrics): ResponsiveResult {
  const reasons: string[] = [];
  if (m.scrollWidth > m.viewportWidth + 1) {
    reasons.push(`horizontal overflow: scrollWidth ${m.scrollWidth} > viewport ${m.viewportWidth}`);
  }
  if (m.sectionsReflowed < m.sectionsTotal) {
    reasons.push(`${m.sectionsTotal - m.sectionsReflowed} of ${m.sectionsTotal} sections did not reflow`);
  }
  if ((m.contentPastFoldCount ?? 0) > 0) {
    reasons.push(
      `${m.contentPastFoldCount} content element(s) render past the fold (clipped by overflow-x, not reflowed) ` +
        `— a fixed-layout styled island; rebuild via R4a into reflowing blocks`,
    );
  }
  return { ok: reasons.length === 0, reasons };
}
