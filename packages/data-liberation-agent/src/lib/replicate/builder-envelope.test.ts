import { describe, it, expect } from 'vitest';
import { parseBuilderEnvelope, parseBuilderEnvelopeText, recoverJsonObject } from './builder-envelope.js';

// Minimal valid envelope factory — has a pattern using is-style-lib-callout.
const validWithVariation = (slug: string) => ({
  patterns: [{ slug: 'a', php: `<!-- wp:group {"className":"is-style-${slug}"} --><!-- /wp:group -->` }],
  blockStyleVariations: [{
    slug,
    title: 'Callout',
    blockTypes: ['core/group'],
    styles: { color: { background: '#fff' } },
  }],
});

describe('parseBuilderEnvelope', () => {
  it('accepts a valid envelope and defaults flags/notes', () => {
    const r = parseBuilderEnvelope({ patterns: [{ slug: 'site/section-1', php: '<!-- wp:paragraph -->' }] });
    expect(r.ok).toBe(true);
    expect(r.envelope?.patterns).toHaveLength(1);
    expect(r.envelope?.sitewideFlags).toEqual([]);
    expect(r.envelope?.notes).toEqual([]);
  });
  it('rejects a non-object', () => {
    expect(parseBuilderEnvelope('nope').ok).toBe(false);
    expect(parseBuilderEnvelope(null).ok).toBe(false);
  });
  it('rejects a missing patterns array', () => {
    expect(parseBuilderEnvelope({ sitewideFlags: [] }).ok).toBe(false);
  });
  it('rejects a pattern missing slug or php', () => {
    const r = parseBuilderEnvelope({ patterns: [{ slug: 'x' }] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /php must be a string/.test(e))).toBe(true);
  });
  it('rejects non-array sitewideFlags', () => {
    expect(parseBuilderEnvelope({ patterns: [], sitewideFlags: 'x' }).ok).toBe(false);
  });
});

describe('recoverJsonObject', () => {
  it('recovers the largest balanced object from prose-wrapped output', () => {
    // Largest-wins assumption: the real envelope dwarfs any JSON snippet the
    // model echoes in surrounding prose (here {"slug":"x"} is a decoy).
    const raw = 'Looking at the section… {"slug":"x"} here is the result:\n{"patterns":[{"slug":"a","php":"<!-- wp:group --><!-- /wp:group -->"}],"sitewideFlags":[],"notes":["done"]}\nHope that helps!';
    const r = parseBuilderEnvelopeText(raw);
    expect(r.ok).toBe(true);
    expect(r.envelope!.patterns[0].slug).toBe('a');
  });

  it('handles braces inside string values', () => {
    const raw = 'x {"patterns":[{"slug":"a","php":"body { color: red; }"}]} y';
    expect(recoverJsonObject(raw)).toContain('color: red');
  });

  it('fails with a preview when nothing parses', () => {
    const r = parseBuilderEnvelopeText('no json here at all');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('not valid JSON');
  });

  it('returns undefined for an unterminated escaped-quote string', () => {
    // The \" keeps the scanner in string mode to end-of-input — no balanced
    // object is ever closed, so recovery must fail loudly, not hang or guess.
    const raw = 'pre {"key":"value\\" tail';
    expect(recoverJsonObject(raw)).toBeUndefined();
    const r = parseBuilderEnvelopeText(raw);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('not valid JSON');
  });
});

describe('hardening', () => {
  it('rejects unknown top-level keys', () => {
    const r = parseBuilderEnvelope({ patterns: [], bogus: 1 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('bogus');
  });

  it('rejects a declared variation whose class is unused in any pattern', () => {
    const r = parseBuilderEnvelope({
      patterns: [{ slug: 'a', php: '<!-- wp:group --><!-- /wp:group -->' }],
      blockStyleVariations: [{ slug: 'lib-callout', title: 'Callout', blockTypes: ['core/group'], styles: {} }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('is-style-lib-callout');
  });

  it('accepts a variation whose class is used, and rejects non lib- slugs', () => {
    const used = parseBuilderEnvelope({
      patterns: [{ slug: 'a', php: '<!-- wp:group {"className":"is-style-lib-callout"} --><!-- /wp:group -->' }],
      blockStyleVariations: [{ slug: 'lib-callout', title: 'Callout', blockTypes: ['core/group'], styles: {} }],
    });
    expect(used.ok).toBe(true);
    const badSlug = parseBuilderEnvelope({
      patterns: [{ slug: 'a', php: '<!-- wp:group {"className":"is-style-callout"} --><!-- /wp:group -->' }],
      blockStyleVariations: [{ slug: 'callout', title: 'Callout', blockTypes: ['core/group'], styles: {} }],
    });
    expect(badSlug.ok).toBe(false);
  });
});

describe('inventory-aware redeclare guard', () => {
  it('slug in existingVariationSlugs → error naming the slug and the remedy', () => {
    const r = parseBuilderEnvelope(
      validWithVariation('lib-callout'),
      { existingVariationSlugs: ['lib-callout'] },
    );
    expect(r.ok).toBe(false);
    const msg = r.errors.join(' ');
    expect(msg).toContain('"lib-callout"');
    expect(msg).toContain('redeclares an existing variation');
    expect(msg).toContain('is-style-lib-callout');
  });

  it('novel slug with inventory present → ok', () => {
    const r = parseBuilderEnvelope(
      validWithVariation('lib-callout'),
      { existingVariationSlugs: ['lib-hero', 'lib-card'] },
    );
    expect(r.ok).toBe(true);
  });

  it('no inventory (opts absent) → no redeclare check, back-compat', () => {
    const r = parseBuilderEnvelope(validWithVariation('lib-callout'));
    expect(r.ok).toBe(true);
  });

  it('parseBuilderEnvelopeText threads opts to parseBuilderEnvelope', () => {
    const raw = JSON.stringify(validWithVariation('lib-callout'));
    const r = parseBuilderEnvelopeText(raw, { existingVariationSlugs: ['lib-callout'] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('redeclares an existing variation');
  });
});
