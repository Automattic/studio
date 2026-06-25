import { describe, it, expect } from 'vitest';
import {
  deriveSectionParityStatus,
  divergenceReasons,
  evaluateSectionParity,
  toSectionParityMetrics,
  largestRowGroupSize,
  BG_DELTA_E_FLOOR,
  type SectionParitySignals,
  type SectionParityMetrics,
  type SourceSectionDescriptor,
  type ReplicaSectionMeasure,
} from './section-parity.js';

const metrics = (over: Partial<SectionParityMetrics> = {}): SectionParityMetrics => ({
  sourceColumnCount: 1,
  replicaColumnCount: 1,
  sourceBg: 'rgb(255, 255, 255)',
  replicaBg: 'rgb(255, 255, 255)',
  sourceHasMedia: false,
  replicaHasMedia: false,
  sourceIsCssLayout: false,
  isHtmlFallback: false,
  sectionPresentInReplica: true,
  ...over,
});

const ok = (): SectionParitySignals => ({
  sectionPresent: true,
  bgDeltaE: 1,
  columnCountMatch: true,
  mediaPresent: true,
  fallbackUnstyled: false,
});

describe('divergenceReasons', () => {
  it('no reasons when all signals are good', () => {
    expect(divergenceReasons(ok())).toEqual([]);
  });
  it('flags a dropped section', () => {
    expect(divergenceReasons({ ...ok(), sectionPresent: false })).toContain('section-dropped');
  });
  it('flags a background color delta above the floor', () => {
    expect(divergenceReasons({ ...ok(), bgDeltaE: BG_DELTA_E_FLOOR + 1 })).toContain('bg-color');
  });
  it('does not flag a background delta at or below the floor', () => {
    expect(divergenceReasons({ ...ok(), bgDeltaE: BG_DELTA_E_FLOOR })).not.toContain('bg-color');
  });
  it('flags a column-count flatten', () => {
    expect(divergenceReasons({ ...ok(), columnCountMatch: false })).toContain('column-flatten');
  });
  it('flags dropped media', () => {
    expect(divergenceReasons({ ...ok(), mediaPresent: false })).toContain('media-dropped');
  });
  it('flags an unstyled fallback island', () => {
    expect(divergenceReasons({ ...ok(), fallbackUnstyled: true })).toContain('unstyled-island');
  });
});

describe('deriveSectionParityStatus', () => {
  it('match when no signal diverges', () => {
    expect(deriveSectionParityStatus(ok())).toBe('match');
  });
  it('divergent when a signal diverges and there is no acceptance', () => {
    expect(deriveSectionParityStatus({ ...ok(), columnCountMatch: false })).toBe('divergent');
  });
  it('accepted when a human signs off with a reason', () => {
    expect(
      deriveSectionParityStatus(
        { ...ok(), columnCountMatch: false },
        { by: 'human', proof: 'operator approved the simplified layout' },
      ),
    ).toBe('accepted');
  });
  it('still divergent when a human sign-off has no proof', () => {
    expect(
      deriveSectionParityStatus({ ...ok(), columnCountMatch: false }, { by: 'human', proof: '' }),
    ).toBe('divergent');
  });
  it('integrates with evaluateSectionParity output', () => {
    const signals = evaluateSectionParity(metrics({ sourceColumnCount: 3, replicaColumnCount: 1 }));
    expect(deriveSectionParityStatus(signals)).toBe('divergent');
  });
  it('rejects class-c acceptance for a structural divergence even with proof', () => {
    // wrong background color is fixable, not a genuine WP rendering constraint —
    // the agent may not self-accept it.
    expect(
      deriveSectionParityStatus(
        { ...ok(), bgDeltaE: 40 },
        { by: 'class-c', proof: 'sampled #aaaaaa vs #bbbbbb' },
      ),
    ).toBe('divergent');
  });
});

describe('evaluateSectionParity', () => {
  it('all signals good when source and replica match', () => {
    const s = evaluateSectionParity(metrics());
    expect(divergenceReasons(s)).toEqual([]);
  });
  it('columnCountMatch false when the replica has fewer columns than the source (flatten)', () => {
    const s = evaluateSectionParity(metrics({ sourceColumnCount: 3, replicaColumnCount: 1 }));
    expect(s.columnCountMatch).toBe(false);
  });
  it('columnCountMatch true when the replica meets or exceeds the source column count', () => {
    expect(evaluateSectionParity(metrics({ sourceColumnCount: 2, replicaColumnCount: 2 })).columnCountMatch).toBe(true);
    expect(evaluateSectionParity(metrics({ sourceColumnCount: 2, replicaColumnCount: 3 })).columnCountMatch).toBe(true);
  });
  it('bgDeltaE measures the source-captured bg against the replica rendered bg', () => {
    const s = evaluateSectionParity(metrics({ sourceBg: 'rgb(200, 220, 255)', replicaBg: 'rgb(255, 255, 255)' }));
    expect(s.bgDeltaE).toBeGreaterThan(BG_DELTA_E_FLOOR);
  });
  it('mediaPresent false when the source had media the replica dropped', () => {
    const s = evaluateSectionParity(metrics({ sourceHasMedia: true, replicaHasMedia: false }));
    expect(s.mediaPresent).toBe(false);
  });
  it('mediaPresent true when the source had no media to lose', () => {
    expect(evaluateSectionParity(metrics({ sourceHasMedia: false, replicaHasMedia: false })).mediaPresent).toBe(true);
  });
  it('fallbackUnstyled true only when an island lands on a CSS-layout section', () => {
    expect(evaluateSectionParity(metrics({ isHtmlFallback: true, sourceIsCssLayout: true })).fallbackUnstyled).toBe(true);
    expect(evaluateSectionParity(metrics({ isHtmlFallback: true, sourceIsCssLayout: false })).fallbackUnstyled).toBe(false);
  });
  it('sectionPresent reflects whether the replica rendered a section at this index', () => {
    expect(evaluateSectionParity(metrics({ sectionPresentInReplica: false })).sectionPresent).toBe(false);
  });
});

describe('largestRowGroupSize', () => {
  it('counts columns laid out side-by-side as one row', () => {
    // three columns sharing a top → 3 rendered columns
    expect(largestRowGroupSize([100, 102, 99])).toBe(3);
  });
  it('detects a CSS-collapsed grid (columns stacked vertically) as 1', () => {
    // declared 3 columns but stacked → tops far apart → largest row is 1
    expect(largestRowGroupSize([100, 400, 700])).toBe(1);
  });
  it('returns 0 for no columns', () => {
    expect(largestRowGroupSize([])).toBe(0);
  });
  it('tolerates sub-pixel jitter within a row', () => {
    expect(largestRowGroupSize([200, 203, 198, 201])).toBe(4);
  });
});

describe('toSectionParityMetrics', () => {
  const src: SourceSectionDescriptor = {
    columnCount: 3,
    backgroundColor: 'rgb(204, 198, 198)',
    hasMedia: true,
    isCssLayout: true,
    isHtmlFallback: false,
  };
  const rep: ReplicaSectionMeasure = {
    columnCount: 3,
    bg: 'rgb(204, 198, 198)',
    hasMedia: true,
  };

  it('combines source descriptor + replica measurement into scorer metrics', () => {
    const m = toSectionParityMetrics(src, rep);
    expect(m.sourceColumnCount).toBe(3);
    expect(m.replicaColumnCount).toBe(3);
    expect(m.sourceBg).toBe('rgb(204, 198, 198)');
    expect(m.replicaBg).toBe('rgb(204, 198, 198)');
    expect(m.sectionPresentInReplica).toBe(true);
    expect(evaluateSectionParity(m).columnCountMatch).toBe(true);
  });

  it('marks the section absent when the replica produced no matching section', () => {
    const m = toSectionParityMetrics(src, null);
    expect(m.sectionPresentInReplica).toBe(false);
    // a dropped 3-column section reads as a column collapse too (0 < 3)
    expect(evaluateSectionParity(m).columnCountMatch).toBe(false);
    expect(evaluateSectionParity(m).sectionPresent).toBe(false);
  });
});
