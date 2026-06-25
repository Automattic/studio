import { describe, expect, it } from 'vitest';
import { describeJudgment } from './watch.js';

describe('describeJudgment', () => {
  it('gives theme pieces specific activity labels', () => {
    expect(describeJudgment({
      kind: 'theme-piece',
      rationale: 'foundation ready',
      inputs: { outputDir: 'output/example.com', themePiece: 'foundation' },
    }, true)).toBe('Generating theme foundation');
    expect(describeJudgment({
      kind: 'theme-piece',
      rationale: 'header ready',
      inputs: { outputDir: 'output/example.com', themePiece: 'header' },
    }, true)).toBe('Generating header');
    expect(describeJudgment({
      kind: 'theme-piece',
      rationale: 'homepage ready',
      inputs: { outputDir: 'output/example.com', themePiece: 'homepage' },
    }, true)).toBe('Generating home page');
  });
});
