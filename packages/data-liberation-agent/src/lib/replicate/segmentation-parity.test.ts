import { describe, it, expect } from 'vitest';
import { scoreSegmentation, type SourceBand } from './segmentation-parity.js';
import type { SectionSpec } from './section-extract.js';

function spec(top: number, height: number, bg: string): SectionSpec {
  return {
    sectionIndex: 0,
    interactionModel: 'static',
    top,
    height,
    headings: [],
    bodyText: [],
    buttonLabels: [],
    images: [],
    icons: [],
    backgroundBrightness: 255,
    backgroundColor: bg,
    gradient: null,
    gradientSource: null,
    motionProfile: { motionClass: 'none', signals: [], animatedElements: 0 },
    dividerAbove: false,
    dividerBelow: false,
    layout: { columnCount: 1 },
    textAlign: 'left',
    mediaLayout: null,
    fullBleed: false,
  } as unknown as SectionSpec;
}

const bands: SourceBand[] = [
  { top: 0, bottom: 600, bg: 'rgb(255, 255, 255)' },
  { top: 600, bottom: 1000, bg: 'rgb(31, 31, 31)' }, // dark Journey band
  { top: 1000, bottom: 1600, bg: 'rgb(255, 255, 255)' }, // light Specialties band
];

describe('scoreSegmentation', () => {
  it('rewards reproducing every source band boundary with matching bg', () => {
    const specs = [
      spec(0, 600, 'rgb(255, 255, 255)'),
      spec(600, 400, 'rgb(31, 31, 31)'),
      spec(1000, 600, 'rgb(255, 255, 255)'),
    ];
    const s = scoreSegmentation(bands, specs);
    expect(s.boundaryRecall).toBe(1); // both interior boundaries (600, 1000) matched
    expect(s.bgFidelity).toBe(1);
    expect(s.composite).toBe(1);
  });

  it('penalizes a MERGE (one section spanning two source bands)', () => {
    // The Journey+Specialties merge: one section from 600..1600 swallows the
    // boundary at 1000, so that boundary is unrecalled.
    const specs = [spec(0, 600, 'rgb(255, 255, 255)'), spec(600, 1000, 'rgb(31, 31, 31)')];
    const s = scoreSegmentation(bands, specs);
    expect(s.boundaryRecall).toBe(0.5); // boundary 600 matched, 1000 missed
    expect(s.composite).toBeLessThan(1);
  });

  it('penalizes background-color drift (band rendered white instead of dark)', () => {
    const specs = [
      spec(0, 600, 'rgb(255, 255, 255)'),
      spec(600, 400, 'rgb(255, 255, 255)'), // should be dark, rendered white
      spec(1000, 600, 'rgb(255, 255, 255)'),
    ];
    const s = scoreSegmentation(bands, specs);
    expect(s.boundaryRecall).toBe(1);
    expect(s.bgFidelity).toBeCloseTo(2 / 3, 2); // the dark band's section fails ΔE
    expect(s.avgBgDeltaE).toBeGreaterThan(0);
  });

  it('rewards reproducing a repeated row as a multi-track section, penalizes flatten', () => {
    const repeats = [{ top: 1050, bottom: 1400, count: 3 }]; // a 3-card row in the light band
    const flat = [spec(0, 600, 'rgb(255, 255, 255)'), spec(600, 400, 'rgb(31, 31, 31)'), spec(1000, 600, 'rgb(255, 255, 255)')];
    // the covering section has columnCount 1 (flattened) → repetitionRecall 0
    const flatScore = scoreSegmentation(bands, flat, { repeats });
    expect(flatScore.sourceRepeatCount).toBe(1);
    expect(flatScore.repetitionRecall).toBe(0);

    // give the covering section 3 columns → repetitionRecall 1
    const gridSpec = spec(1000, 600, 'rgb(255, 255, 255)');
    (gridSpec as unknown as { layout: { columnCount: number } }).layout = { columnCount: 3 };
    const grid = [spec(0, 600, 'rgb(255, 255, 255)'), spec(600, 400, 'rgb(31, 31, 31)'), gridSpec];
    const gridScore = scoreSegmentation(bands, grid, { repeats });
    expect(gridScore.repetitionRecall).toBe(1);
    expect(gridScore.composite).toBeGreaterThan(flatScore.composite);
  });

  it('credits carousel/gallery models as reproducing a repeat despite low columnCount', () => {
    const repeats = [{ top: 1050, bottom: 1400, count: 6 }]; // a 6-item row in the light band
    // A horizontal-showcase (carousel) scrolls its 6 items but reports columnCount 1.
    // Track-count alone would fail it, but the repetition IS reproduced.
    const carousel = spec(1000, 600, 'rgb(255, 255, 255)');
    (carousel as unknown as { interactionModel: string }).interactionModel = 'horizontal-showcase';
    (carousel as unknown as { layout: { columnCount: number } }).layout = { columnCount: 1 };
    const specs = [spec(0, 600, 'rgb(255, 255, 255)'), spec(600, 400, 'rgb(31, 31, 31)'), carousel];
    expect(scoreSegmentation(bands, specs, { repeats }).repetitionRecall).toBe(1);

    // A genuinely flattened grid (static, 1 column) still fails — crediting is
    // scoped to scroll/masonry/strip models, so it can't mask a real flatten.
    const flat = spec(1000, 600, 'rgb(255, 255, 255)');
    (flat as unknown as { layout: { columnCount: number } }).layout = { columnCount: 1 };
    const flatSpecs = [spec(0, 600, 'rgb(255, 255, 255)'), spec(600, 400, 'rgb(31, 31, 31)'), flat];
    expect(scoreSegmentation(bands, flatSpecs, { repeats }).repetitionRecall).toBe(0);
  });

  it('credits a boundary reproduced by a section BOTTOM (gap before next section)', () => {
    const b: SourceBand[] = [
      { top: 0, bottom: 600, bg: 'rgb(255, 255, 255)' },
      { top: 600, bottom: 1200, bg: 'rgb(31, 31, 31)' },
    ];
    // The hero ends at 600 (its bottom reproduces the boundary), but the next
    // section starts late at 800 — no section TOP is near 600. Matching tops only
    // would miss it; matching the section bottom recalls it.
    const specs = [spec(0, 600, 'rgb(255, 255, 255)'), spec(800, 400, 'rgb(31, 31, 31)')];
    expect(scoreSegmentation(b, specs).boundaryRecall).toBe(1);
  });

  it('handles the no-bands / single-band degenerate case', () => {
    const s = scoreSegmentation([{ top: 0, bottom: 800, bg: 'rgb(255, 255, 255)' }], [spec(0, 800, 'rgb(255, 255, 255)')]);
    expect(s.boundaryRecall).toBe(1); // no interior boundaries to miss
    expect(s.composite).toBe(1);
  });
});
