// src/lib/replicate/normalize/instance-styles.test.ts
import { describe, it, expect } from 'vitest';
import { InstanceStyleSheet, mergeInstanceStyleCss, normalizeDeclarations } from './instance-styles.js';

describe('normalizeDeclarations', () => {
  it('trims, collapses whitespace, and drops empties (content-addressable form)', () => {
    expect(normalizeDeclarations('  margin: 20px 0 0 ;  font-size:  clamp(3rem,9vw,6.5rem) ; ')).toBe(
      'margin:20px 0 0;font-size:clamp(3rem,9vw,6.5rem)',
    );
  });

  it('normalizes equivalent declaration strings to the SAME canonical form (dedup key)', () => {
    const a = normalizeDeclarations('aspect-ratio: 5/4');
    const b = normalizeDeclarations('  aspect-ratio:5/4  ');
    expect(a).toBe(b);
    expect(a).toBe('aspect-ratio:5/4');
  });

  it('returns empty string for whitespace-only / empty input', () => {
    expect(normalizeDeclarations('   ')).toBe('');
    expect(normalizeDeclarations(';;')).toBe('');
    expect(normalizeDeclarations('')).toBe('');
  });
});

describe('InstanceStyleSheet', () => {
  it('returns a deterministic lib-i class for an inline style and registers the rule', () => {
    const sheet = new InstanceStyleSheet();
    const cls = sheet.classFor('font-size:clamp(3rem,9vw,6.5rem)');
    expect(cls).toMatch(/^lib-i[0-9a-f]{10}$/);
    expect(sheet.size).toBe(1);
    expect(sheet.toCss()).toBe(`.${cls}{font-size:clamp(3rem,9vw,6.5rem)}`);
  });

  it('is content-addressed: identical declarations across instances dedupe to ONE class + ONE rule', () => {
    const sheet = new InstanceStyleSheet();
    const a = sheet.classFor('aspect-ratio:5/4');
    const b = sheet.classFor('  aspect-ratio: 5/4 '); // equivalent after normalize
    expect(a).toBe(b);
    expect(sheet.size).toBe(1);
  });

  it('distinct declarations get distinct classes', () => {
    const sheet = new InstanceStyleSheet();
    const a = sheet.classFor('max-width:46ch');
    const b = sheet.classFor('max-width:60ch');
    expect(a).not.toBe(b);
    expect(sheet.size).toBe(2);
  });

  it('returns null for an empty / whitespace-only style (nothing to carry)', () => {
    const sheet = new InstanceStyleSheet();
    expect(sheet.classFor('')).toBeNull();
    expect(sheet.classFor('   ')).toBeNull();
    expect(sheet.classFor(undefined)).toBeNull();
    expect(sheet.size).toBe(0);
  });

  it('emits rules sorted by class for byte-stable output', () => {
    const sheet = new InstanceStyleSheet();
    sheet.classFor('color:red');
    sheet.classFor('color:blue');
    sheet.classFor('color:green');
    const lines = sheet.toCss().split('\n');
    const sorted = [...lines].sort();
    expect(lines).toEqual(sorted);
  });

  it('is deterministic across sheets: same declaration -> same class', () => {
    const a = new InstanceStyleSheet().classFor('display:grid;grid-template-columns:1fr');
    const b = new InstanceStyleSheet().classFor('display:grid;grid-template-columns:1fr');
    expect(a).toBe(b);
  });

  it('toCss is empty when nothing was registered', () => {
    expect(new InstanceStyleSheet().toCss()).toBe('');
  });
});

describe('mergeInstanceStyleCss', () => {
  it('unions chunks, dedups identical rule lines, and sorts (byte-stable)', () => {
    const a = '.lib-ib{color:blue}\n.lib-ia{color:red}';
    const b = '.lib-ia{color:red}\n.lib-ic{color:green}'; // .lib-ia overlaps
    expect(mergeInstanceStyleCss(a, b)).toBe(
      '.lib-ia{color:red}\n.lib-ib{color:blue}\n.lib-ic{color:green}',
    );
  });

  it('ignores empty / undefined chunks', () => {
    expect(mergeInstanceStyleCss('', undefined, '.lib-ia{color:red}')).toBe('.lib-ia{color:red}');
    expect(mergeInstanceStyleCss('', undefined)).toBe('');
  });
});
