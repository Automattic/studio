import { describe, expect, it } from 'vitest';
import {
  findFreeReplacement,
  fallbackReplacement,
  firstFamilyToken,
} from './font-substitution.js';

describe('firstFamilyToken', () => {
  it('extracts and lowercases the first family of a stack', () => {
    expect(firstFamilyToken("quasimoda, Arial, 'Helvetica Neue', sans-serif")).toBe('quasimoda');
    expect(firstFamilyToken('"Proxima Nova", sans-serif')).toBe('proxima nova');
  });
  it('returns null for empty', () => {
    expect(firstFamilyToken('')).toBeNull();
    expect(firstFamilyToken(null)).toBeNull();
    expect(firstFamilyToken(undefined)).toBeNull();
  });
});

describe('findFreeReplacement', () => {
  it('maps getsnooz body font quasimoda → Hanken Grotesk (geometric-humanist match)', () => {
    const r = findFreeReplacement('quasimoda, sans-serif');
    expect(r?.family).toBe('Hanken Grotesk');
    expect(r?.faces.length).toBeGreaterThanOrEqual(1);
    // Self-hostable from gstatic (not the typekit CDN).
    expect(r?.faces.every((f) => f.url.includes('fonts.gstatic.com'))).toBe(true);
    expect(r?.rationale).toMatch(/quasimoda/i);
  });

  it('matches by case-insensitive substring on the first family token', () => {
    expect(findFreeReplacement('QUASIMODA')?.family).toBe('Hanken Grotesk');
    expect(findFreeReplacement('Proxima Nova, sans-serif')?.family).toBe('Montserrat');
    expect(findFreeReplacement('Avenir Next, sans-serif')?.family).toBe('Inter');
  });

  it('never substitutes CSS generics or common system fonts', () => {
    expect(findFreeReplacement('sans-serif')).toBeNull();
    expect(findFreeReplacement('Arial, sans-serif')).toBeNull();
    expect(findFreeReplacement('Helvetica Neue, Helvetica, sans-serif')).toBeNull();
    expect(findFreeReplacement(null)).toBeNull();
  });

  it('returns null for an unmapped family (caller uses fallbackReplacement)', () => {
    expect(findFreeReplacement('Larsseit, sans-serif')).toBeNull();
    expect(findFreeReplacement('SomeUnknownFoundryFont')).toBeNull();
  });
});

describe('fallbackReplacement', () => {
  it('picks a serif lookalike for serif-ish names', () => {
    expect(fallbackReplacement('Mystery Garamond Pro').family).toBe('EB Garamond');
    expect(fallbackReplacement('Custom Serif').family).toBe('EB Garamond');
  });
  it('picks a sans lookalike otherwise', () => {
    expect(fallbackReplacement('wfont_abc123').family).toBe('Inter');
    expect(fallbackReplacement('Some Sans Display').family).toBe('Inter');
    expect(fallbackReplacement(undefined).family).toBe('Inter');
  });
});
