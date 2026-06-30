// src/lib/replicate/refine-report.test.ts
import { describe, it, expect } from 'vitest';
import { validateRefineReports, type RefineSectionReport } from './refine-report.js';

function section(over: Partial<RefineSectionReport> = {}): RefineSectionReport {
  return {
    schema: 1, slug: 'sample-page', sourceUrl: 'https://example.test/sample-page', index: 0,
    findings: [
      { id: 'hero-heading-size', region: 'Hero heading', severity: 'high', description: 'size differs', block_change: null, style_change: 'fontSize → preset:large', affects_layout: true },
      { id: 'cta-color', region: 'CTA', severity: 'low', description: 'color drift', block_change: null, style_change: 'textColor → accent', affects_layout: false },
    ],
    applied: [{ id: 'hero-heading-size', summary: 'set fontSize large' }],
    skipped: [{ id: 'cta-color', reason: 'within token-mapping tolerance' }],
    ...over,
  };
}

describe('validateRefineReports', () => {
  it('passes when every finding is accounted exactly once', () => {
    const v = validateRefineReports([section()]);
    expect(v.ok).toBe(true);
    expect(v.findings).toBe(2);
    expect(v.applied).toBe(1);
    expect(v.skipped).toBe(1);
  });

  it('fails naming each unaccounted finding id', () => {
    const v = validateRefineReports([section({ skipped: [] })]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('cta-color');
  });

  it('fails when an id is both applied and skipped', () => {
    const v = validateRefineReports([section({ applied: [{ id: 'cta-color', summary: 'x' }] })]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/cta-color.*(both|applied and skipped)/i);
  });

  it('fails on orphan applied id not present in findings', () => {
    const v = validateRefineReports([section({ applied: [...section().applied, { id: 'ghost', summary: 'x' }] })]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('ghost');
  });

  it('fails on orphan skipped id not present in findings', () => {
    const v = validateRefineReports([section({ skipped: [...section().skipped, { id: 'ghost-skip', reason: 'x' }] })]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('ghost-skip');
  });

  it('fails on duplicate finding ids within a section', () => {
    const dup = section();
    dup.findings = [...dup.findings, { ...dup.findings[0] }];
    const v = validateRefineReports([dup]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/duplicate/i);
  });

  it('rejects malformed shapes loudly', () => {
    const v = validateRefineReports([{ schema: 1, slug: 's' } as unknown as RefineSectionReport]);
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });
});
