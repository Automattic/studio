import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Regression guard: the faithful-recreation enforcement must not silently regress in the
// skill text. These assert the escape hatches removed in the enforcement-policy spec stay
// removed and the measured-gate anchors stay present. See
// docs/superpowers/specs/2026-05-28-enforce-faithful-recreation-design.md.
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const designQa = read('skills/design-qa/SKILL.md');
const replicate = read('skills/replicate-with-blocks/SKILL.md');
const liberate = read('skills/liberate/SKILL.md');

describe('skill enforcement — escape hatches stay closed', () => {
  it('design-qa no longer says "stop regardless" of remaining gaps', () => {
    expect(designQa).not.toMatch(/stop regardless/i);
  });
  it('replicate no longer classes the visual gate as "Soft — iterate, then surface gaps"', () => {
    expect(replicate).not.toContain('Soft — iterate, then surface gaps');
  });
  it('design-qa no longer offers "explicitly moved to qaGaps as an accepted gap"', () => {
    expect(designQa).not.toMatch(/explicitly moved to `?qaGaps/i);
  });
});

describe('skill enforcement — measured-gate anchors stay present', () => {
  it('design-qa anchors the gate on the measured SectionParity contract', () => {
    expect(designQa).toContain('SectionParity');
    expect(designQa).toContain('deriveSectionParityStatus');
  });
  it('replicate marks visual parity a HARD gate and forbids "known gap" shipping', () => {
    expect(replicate).toMatch(/Visual-parity gate.*\*\*Hard\*\*/);
    expect(replicate).toMatch(/known gap/i);
  });
  it('all three skills route decisions to the operator (escalate-then-ask)', () => {
    for (const txt of [designQa, replicate, liberate]) {
      expect(txt).toMatch(/operator/i);
    }
    // The reconstruct loop's exhaustion handling (escalation ladder / circuit-breaker)
    // lives in the reconstruct-owning skills, NOT the liberate front door — liberate
    // is now a thin detect→discover→path-checkpoint→dispatch dispatcher, so its
    // operator hand-off is the path question, not a reconstruct circuit-breaker.
    for (const txt of [designQa, replicate]) {
      expect(txt).toMatch(/escalation ladder|circuit-breaker/i);
    }
  });
});
